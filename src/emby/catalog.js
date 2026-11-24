import {sourceAvailable} from '../paths.js';
import {digest,fail,text} from './auth.js';

const object=value=>{if(typeof value==='string')value=JSON.parse(value);if(!value||typeof value!=='object')throw fail('源返回了无效目录',502);return value;};
const plain=value=>String(value||'').replace(/<[^>]*>/g,'').slice(0,5000);
export function playlists(vod) {
    const names=String(vod.vod_play_from||'').split('$$$');
    return String(vod.vod_play_url||'').split('$$$').map((line,index)=>({name:names[index]||`线路 ${index+1}`,episodes:line.split('#').filter(Boolean).map(raw=>{
        const at=raw.indexOf('$');return {name:at<0?'正片':raw.slice(0,at),play:at<0?raw:raw.slice(at+1)};
    }).filter(e=>e.play)})).filter(l=>l.episodes.length);
}
function episodeNumber(name) {
    let match=name.match(/S(\d{1,3})[ ._-]*E(\d{1,4})/i);if(match)return {season:Number(match[1]),episode:Number(match[2])};
    match=name.match(/(?:第\s*|^E(?:P)?[ ._-]*|^)(\d{1,4})(?:\s*集|[ ._-]|$)/i);return match?{season:1,episode:Number(match[1])}:null;
}
export class Catalog {
    constructor(db,store,content) {this.db=db;this.store=store;this.content=content;this.jobs=new Map();this.queue=Promise.resolve();this.closed=false;this.autoQueue=Promise.resolve();this.pending=new Map();this.recent=new Map();}
    status(subscription) {
        const sourceIds=subscription.instances.filter(id=>this.store.state.instances.some(i=>i.id===id&&sourceAvailable(this.store.state,i)));
        const selected=this.db.all('libraries').filter(l=>sourceIds.includes(l.sourceId));
        return {sources:sourceIds.length,ready:selected.filter(l=>l.syncedAt).length,preparing:selected.filter(l=>this.pending.has(l.id)).length,failed:selected.filter(l=>l.attemptedAt&&!l.syncedAt&&!this.pending.has(l.id)).length};
    }
    prepare(request,subscription) {
        if(this.closed)throw fail('服务正在关闭',503);
        const sources=subscription.instances.flatMap(id=>{const source=this.store.state.instances.find(i=>i.id===id&&sourceAvailable(this.store.state,i));return source?[source]:[];});
        const libraries=this.db.all('libraries');
        for(const source of sources) {
            let selected=libraries.filter(l=>l.sourceId===source.id);
            if(!selected.length) {
                if(libraries.length>=32)throw fail('Emby目录达到32个源上限，请减少订阅源范围',413);
                const library={id:this.db.id(JSON.stringify(['subscription-source',source.id])),sourceId:source.id,name:source.name,kind:'Mixed',automatic:true,category:'',pages:1,maxItems:100,count:0,items:0};
                this.db.put('libraries',library.id,library);libraries.push(library);selected=[library];
            }
            for(const library of selected) {
                // Preserve pre-existing explicit catalogs and stable IDs.
                if(!library.automatic&&library.syncedAt)continue;
                const last=Math.max(library.syncedAt||0,library.attemptedAt||0),ttl=library.syncedAt?10*60000:60000;
                if(this.pending.has(library.id)||Date.now()-last<ttl)continue;
                const context={protocol:request.protocol,headers:{host:request.headers.host,'user-agent':request.headers['user-agent']},params:{},query:{},activity:request.server?.activity?.context(request)};
                const task=this.autoQueue.then(async()=>{
                    if(this.closed||!this.db.get('libraries',library.id))return;
                    const existing=[...this.jobs.values()].find(j=>j.libraryId===library.id&&['queued','running'].includes(j.status));
                    if(existing)await this.queue;
                    else {this.job(library,context);await this.queue;}
                    const current=this.db.get('libraries',library.id);
                    if(current)this.db.put('libraries',library.id,{...current,attemptedAt:Date.now()});
                }).catch(()=>{}).finally(()=>this.pending.delete(library.id));
                this.pending.set(library.id,task);this.autoQueue=task;
            }
        }
        const selected=libraries.filter(l=>sources.some(s=>s.id===l.sourceId));
        return {...this.status(subscription),pending:selected.flatMap(l=>this.pending.has(l.id)?[this.pending.get(l.id)]:[])};
    }
    async ready(request,subscription) {
        const state=this.prepare(request,subscription);
        const populated=()=>this.catalogs(subscription).some(l=>l.items>0);
        if(populated()||!state.pending.length)return;
        let timer;try {
            const finished=await Promise.race([Promise.all(state.pending).then(()=>true),new Promise(resolve=>{timer=setTimeout(()=>resolve(false),15000);})]);
            if(!finished&&!populated())throw fail('首次播放目录正在准备，请稍后在播放器刷新',503);
        }finally{clearTimeout(timer);}
    }
    source(library) {
        const instance=this.store.state.instances.find(i=>i.id===library.sourceId&&sourceAvailable(this.store.state,i));
        if(!instance)throw fail('源不存在或已停用',409);return this.store.resolve(instance.id);
    }
    catalogs(subscription) {return this.db.all('libraries').filter(l=>subscription.instances.includes(l.sourceId)&&this.store.state.instances.some(i=>i.id===l.sourceId&&sourceAvailable(this.store.state,i)));}
    projections(library) {
        return library.kind==='Mixed'?['Movie','Series'].map(kind=>({...library,id:this.db.id(JSON.stringify(['source-view',library.id,kind])),catalogId:library.id,kind,name:library.name+(kind==='Movie'?' · 电影':' · 剧集')})):[library];
    }
    libraries(user,subscription) {return this.catalogs(subscription).flatMap(l=>this.projections(l));}
    items(user,subscription,libraryId) {return this.catalogs(subscription).filter(l=>!libraryId||l.id===libraryId).flatMap(l=>{
        const views=this.projections(l);
        return this.db.all('catalog:'+l.id).map(item=>l.kind==='Mixed'&&['Movie','Series'].includes(item.type)?{...item,parentId:views.find(v=>v.kind===item.type).id}:item);
    });}
    async detail(request,library,vodId) {
        const resolved=this.source(library);
        const value=object(await this.content.query(request,resolved,{ac:'detail',ids:vodId}));
        const vod=value.list?.find(v=>String(v.vod_id)===vodId)||value.list?.[0];
        if(!vod||!vod.vod_name)throw fail('源没有返回影片详情',502);
        const lines=playlists(vod);if(!lines.length)throw fail('影片没有可播放分集',422);
        if(lines.reduce((n,l)=>n+l.episodes.length,0)>2000)throw fail('单作品分集超过2000项限制',413);
        if(new Set(lines.map(l=>l.name)).size!==lines.length)throw fail('线路名称重复，无法稳定定位，请修正源',422);
        for(const line of lines)if(new Set(line.episodes.map(e=>e.name)).size!==line.episodes.length)throw fail('分集名称重复，无法稳定定位，请修正源',422);
        return {vod,lines};
    }
    locator(sourceId,line,episode) {
        return {flag:line.name,name:episode.name,...(episode.play.startsWith('coketv-netdisk:')?{identity:this.content.identity(episode.play,sourceId)}:{})};
    }
    async build(request,library,vodId) {
        const {vod,lines}=await this.detail(request,library,vodId);
        // Allocate stable IDs in one transaction per work. Individual identity
        // inserts otherwise fsync thousands of times while blocking all HTTP.
        return this.db.transaction(()=>this.buildRows(library,vodId,vod,lines));
    }
    buildRows(library,vodId,vod,lines) {
        const rootKey=JSON.stringify([library.id,library.sourceId,vodId]);
        const row=(key,type,name,parent,extra={})=>{const item={id:this.db.id(key),type,name:plain(name).slice(0,300),libraryId:library.id,sourceId:library.sourceId,vodId,parentId:parent,overview:plain(vod.vod_content),image:/^https?:\/\//i.test(vod.vod_pic||'')?String(vod.vod_pic).split('@')[0]:'',year:Number(String(vod.vod_year||'').match(/\d{4}/)?.[0])||null,genres:String(vod.vod_class||vod.type_name||'').split(/[,，/]/).filter(Boolean).slice(0,20),...extra};return {...item,etag:digest(JSON.stringify(item))};};
        const version=(line,e)=>{if(e.version)return {...e.version,name:line.name};const locator=this.locator(library.sourceId,line,e);return {id:this.db.id(JSON.stringify([rootKey,'version',locator.identity||line.name,e.name])),name:line.name,locator,container:(e.name.match(/\.(mp4|mkv|webm|mov|avi|m3u8|ts)$/i)||e.play.match(/\.(mp4|mkv|webm|mov|avi|m3u8|ts)(?:[?#]|$)/i))?.[1]?.toLowerCase()||'mp4'};};
        const result=[];
        const classification=String(vod.type_name||vod.vod_type||'');
        const episodes=lines[0].episodes,numbers=episodes.map(e=>episodeNumber(e.name));
        const episodic=/电视剧|连续剧|剧集|动漫|综艺|series|tvshow/i.test(classification)||episodes.some(e=>/S\d{1,3}[ ._-]*E\d{1,4}/i.test(e.name))||(episodes.length>1&&numbers.every(n=>n&&n.episode<1000)&&new Set(numbers.map(n=>`${n.season}:${n.episode}`)).size===numbers.length);
        const kind=library.kind==='Mixed'?(/电影|movie/i.test(classification)?'Movie':episodic?'Series':'Movie'):library.kind;
        if(kind==='Movie') {
            const versions=lines.flatMap(line=>line.episodes.map(e=>({...version(line,e),name:line.name+(line.episodes.length>1?' · '+e.name:'')})));
            return [row(rootKey,'Movie',vod.vod_name,library.id,{versions})];
        }
        const series=row(rootKey,'Series',vod.vod_name,library.id),entries=new Map(),used=new Set();result.push(series);
        for(const line of lines)for(const e of line.episodes) {
            const number=episodeNumber(e.name),identity=number?`${number.season}:${number.episode}`:'name:'+e.name;
            if(!entries.has(identity))entries.set(identity,{identity,name:e.name,number,versions:[]});
            entries.get(identity).versions.push(version(line,e));
            if(number?.season===1)used.add(number.episode);
        }
        let fallback=1;
        for(const entry of entries.values())if(!entry.number) {
            while(used.has(fallback))fallback++;
            entry.number={season:1,episode:fallback};used.add(fallback++);
        }
        const seasons=new Map();
        for(const entry of [...entries.values()].sort((a,b)=>a.number.season-b.number.season||a.number.episode-b.number.episode)) {
            const {number,identity,versions}=entry;
            if(!seasons.has(number.season)) {
                const season=row(rootKey+':season:'+number.season,'Season','第 '+number.season+' 季',series.id,{seriesId:series.id,seriesName:series.name,index:number.season});
                result.push(season);seasons.set(number.season,season);
            }
            const season=seasons.get(number.season);
            const counts=new Map();for(const v of versions)counts.set(v.locator.flag,(counts.get(v.locator.flag)||0)+1);
            for(const v of versions)if(counts.get(v.locator.flag)>1)v.name+=' · '+v.locator.name;
            result.push(row(rootKey+':episode:'+identity,'Episode',entry.name,season.id,{seriesId:series.id,seriesName:series.name,seasonId:season.id,seasonName:season.name,index:number.episode,parentIndex:number.season,versions}));
        }
        return result;
    }
    collapseCached(library,items) {
        const works=new Map();for(const item of items){if(!works.has(item.vodId))works.set(item.vodId,[]);works.get(item.vodId).push(item);}
        return [...works.entries()].flatMap(([vodId,rows])=>{
            const roots=rows.filter(i=>['Movie','Series'].includes(i.type)),first=roots[0];if(!first)return rows;
            const key=JSON.stringify([library.id,library.sourceId,vodId]);
            if(roots.length===1&&first.id===this.db.get('identity',key))return rows;
            const grouped=new Map();
            for(const item of rows)for(const version of item.versions||[]) {
                const locator=version.locator;if(!locator?.flag||!locator.name)return rows;
                if(!grouped.has(locator.flag))grouped.set(locator.flag,new Map());
                grouped.get(locator.flag).set(locator.name,{name:locator.name,version});
            }
            if(!grouped.size)return rows;
            const lines=[...grouped].map(([name,episodes])=>({name,episodes:[...episodes.values()]}));
            const sample=(first.versions||[])[0]||rows.find(i=>i.seriesId===first.id&&i.versions?.length)?.versions[0];
            const suffix=sample?(first.type==='Movie'?` · ${sample.locator.name} [${sample.locator.flag}]`:` [${sample.locator.flag}]`):'';
            const name=suffix&&first.name.endsWith(suffix)?first.name.slice(0,-suffix.length):first.name;
            const vod={vod_name:name,type_name:first.type==='Movie'?'电影':'电视剧',vod_content:first.overview,vod_pic:first.image,vod_year:first.year,vod_class:first.genres?.join(',')};
            return this.db.transaction(()=>this.buildRows(library,vodId,vod,lines));
        });
    }
    mergeLegacyState(library,old,next) {
        const roots=new Map(),versions=new Map(),mappings=new Map();
        for(const item of next) {
            if(['Movie','Series','Season'].includes(item.type))roots.set(JSON.stringify([item.vodId,item.type,item.type==='Season'?item.index:null]),item);
            for(const version of item.versions||[]) {
                versions.set(version.id,item);
                if(version.locator.identity)versions.set(JSON.stringify([item.vodId,version.locator.identity]),item);
            }
        }
        for(const item of old) {
            const target=roots.get(JSON.stringify([item.vodId,item.type,item.type==='Season'?item.index:null]))
                ||(item.versions||[]).flatMap(v=>versions.get(v.id)||versions.get(JSON.stringify([item.vodId,v.locator.identity]))||[])[0];
            if(target&&target.id!==item.id) {
                mappings.set(item.id,target.id);
                this.db.put('aliases',item.id,{itemId:target.id,libraryId:library.id});
            }
        }
        if(!mappings.size)return;
        const groups=new Map();
        for(const state of this.db.all('userdata')) {
            const itemId=mappings.get(state.itemId);if(!itemId||!state.userId)continue;
            const key=state.userId+':'+itemId;
            if(!groups.has(key))groups.set(key,{itemId,userId:state.userId,states:[this.db.get('userdata',key)].filter(Boolean)});
            groups.get(key).states.push(state);
        }
        for(const [key,{itemId,userId,states}]of groups) {
            states.sort((a,b)=>(b.updated||b.started||0)-(a.updated||a.started||0)||(b.position||0)-(a.position||0));
            const latest=states[0];
            this.db.put('userdata',key,{...latest,id:key,itemId,userId,favorite:states.some(s=>s.favorite),played:latest.played??states.some(s=>s.played)});
        }
    }
    async play(request,item,version,subscription) {
        const library=this.db.get('libraries',item.libraryId);if(!library)throw fail('媒体库不存在',404);
        const {lines}=await this.detail(request,library,item.vodId);
        const line=lines.find(l=>l.name===version.locator.flag);
        const episode=line?.episodes.find(e=>version.locator.identity?e.play.startsWith('coketv-netdisk:')&&this.content.identity(e.play,item.sourceId)===version.locator.identity:e.name===version.locator.name);
        if(!episode)throw fail('分集或版本已变化，请在播放器刷新目录',409);
        const media=await this.content.play(request,this.source(library),{play:episode.play,flag:line.name},{native:true,subscription,clientUserAgent:true});
        if(media.parse===1)throw fail('此源需要网页解析，Emby无法直接播放',422);
        const now=Date.now();for(const [key,at] of this.recent)if(now-at>12*3600000)this.recent.delete(key);
        if(this.recent.size>=500)this.recent.delete(this.recent.keys().next().value);
        this.recent.set(JSON.stringify([item.libraryId,item.vodId]),now);
        return media;
    }
    job(library,request,{vodId}={}) {
        if(this.closed)throw fail('服务正在关闭',503);
        if([...this.jobs.values()].filter(j=>j.status==='queued'||j.status==='running').length>=8)throw fail('同步任务已满，请稍后重试',429);
        const id=digest(String(Date.now())+Math.random()).slice(0,32);
        const job={id,libraryId:library.id,status:'queued',completed:0,discovered:0,errors:[]};this.jobs.set(id,job);
        if(this.jobs.size>50)for(const [key,value]of this.jobs){if(!['running','queued'].includes(value.status)){this.jobs.delete(key);break;}}
        const execute=async()=>{
            if(this.closed||job.cancelled){job.status='cancelled';return;}
            job.status='running';
            try {
                const resolved=this.source(library),ids=[];
                if(vodId)ids.push(vodId);
                else for(let page=1;page<=library.pages;page++) {
                    if(this.closed||job.cancelled)break;
                    const q=library.category?{ac:'list',t:library.category,pg:String(page)}:{};
                    let data=object(await this.content.query(request,resolved,q));
                    if(library.automatic&&!data.list?.length&&data.class?.[0]?.type_id!==undefined)data=object(await this.content.query(request,resolved,{ac:'list',t:String(data.class[0].type_id),pg:'1'}));
                    for(const item of data.list||[])if(item.vod_id!==undefined&&!ids.includes(String(item.vod_id)))ids.push(text(String(item.vod_id),'影片ID',10000));
                    if(!library.category||ids.length>=library.maxItems||!(data.list?.length))break;
                }
                const selected=ids.slice(0,library.automatic?Math.min(20,library.maxItems):library.maxItems);job.discovered=selected.length;
                const old=this.db.all('catalog:'+library.id),cached=this.collapseCached(library,old),automatic=library.automatic&&!vodId;
                const totals=this.db.db.get("SELECT COUNT(*) AS count, COALESCE(SUM(length(CAST(body AS BLOB))),0) AS bytes FROM records WHERE namespace LIKE 'catalog:%'");
                const sizes=new WeakMap(),bytes=value=>value.reduce((sum,item)=>{
                    if(!sizes.has(item))sizes.set(item,Buffer.byteLength(JSON.stringify(item)));return sum+sizes.get(item);
                },0),oldBytes=bytes(old);
                const fits=value=>value.length<=10000&&new Set(value.map(i=>i.vodId)).size<=library.maxItems&&totals.count-old.length+value.length<=20000&&totals.bytes-oldBytes+bytes(value)<=20*1024*1024;
                const protectedIds=new Set(automatic?this.db.all('userdata').filter(s=>s.favorite||s.played||s.position>0).map(s=>s.itemId):[]);
                const protectedWorks=new Set(old.filter(i=>protectedIds.has(i.id)||this.recent.has(JSON.stringify([library.id,i.vodId]))).map(i=>i.vodId));
                if(automatic&&protectedWorks.size>library.maxItems)throw fail('观看记录目录达到容量上限',413);
                const next=vodId?[...cached]:automatic?cached.filter(i=>protectedWorks.has(i.vodId)):[];
                for(const id of selected) {
                    if(this.closed||job.cancelled)break;
                    try {
                        const rows=await this.build(request,library,id);
                        if(automatic&&!fits([...next.filter(i=>i.vodId!==id),...rows])) {
                            job.errors.push({vodId:id,message:'目录容量不足，已跳过此作品并保留观看记录'});continue;
                        }
                        for(let i=next.length-1;i>=0;i--)if(next[i].vodId===id)next.splice(i,1);
                        next.push(...rows);job.completed++;
                    }catch(error){job.errors.push({vodId:id,message:error.message==='线路名称重复，无法稳定定位，请修正源'?error.message:'详情同步失败，请检查源及网盘授权'});if(!vodId&&!automatic)next.push(...cached.filter(i=>i.vodId===id));}
                    if(next.length>10000)throw fail('单媒体库条目超过10000项限制',413);
                }
                if(this.closed||job.cancelled){job.status='cancelled';return;}
                this.source(library);
                const current=this.db.get('libraries',library.id);if(!current)throw fail('媒体库已删除',409);
                if(automatic) {
                    const keep=new Set(next.map(i=>i.vodId));
                    for(const id of new Set(cached.map(i=>i.vodId))) {
                        if(keep.has(id)||keep.size>=library.maxItems)continue;
                        const rows=cached.filter(i=>i.vodId===id);
                        if(fits([...next,...rows])){next.push(...rows);keep.add(id);}
                    }
                }
                if(next.length>10000)throw fail('单媒体库条目超过10000项限制',413);
                const works=new Set(next.map(i=>i.vodId));if(works.size>library.maxItems)throw fail('作品达到媒体库上限，请调整范围',413);
                if(selected.length&&job.completed===0)throw fail('本次同步全部失败，保留原媒体库',502);
                if(totals.count-old.length+next.length>20000||totals.bytes-oldBytes+bytes(next)>20*1024*1024)throw fail('媒体目录达到20000项/20MiB全局限制',413);
                this.db.transaction(()=>{
                    this.mergeLegacyState(library,old,next);
                    for(const item of old)this.db.remove('catalog:'+library.id,item.id);
                    for(const item of next)this.db.put('catalog:'+library.id,item.id,item);
                    this.db.put('libraries',library.id,{...current,syncedAt:Date.now(),count:works.size,items:next.length});
                });
                job.status='complete';
            }catch{job.status='failed';job.message='同步失败，原目录已保留；请检查范围、容量或源状态';}
        };
        this.queue=this.queue.then(execute).catch(()=>{});return job;
    }
    async close() {this.closed=true;await this.autoQueue;await this.queue;}
}
