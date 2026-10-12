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
        const sourceIds=subscription.instances.filter(id=>this.store.state.instances.some(i=>i.id===id&&i.enabled));
        const selected=this.db.all('libraries').filter(l=>sourceIds.includes(l.sourceId));
        return {sources:sourceIds.length,ready:selected.filter(l=>l.syncedAt).length,preparing:selected.filter(l=>this.pending.has(l.id)).length,failed:selected.filter(l=>l.attemptedAt&&!l.syncedAt&&!this.pending.has(l.id)).length};
    }
    prepare(request,subscription) {
        if(this.closed)throw fail('服务正在关闭',503);
        const sources=subscription.instances.flatMap(id=>{const source=this.store.state.instances.find(i=>i.id===id&&i.enabled);return source?[source]:[];});
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
                const context={protocol:request.protocol,headers:{host:request.headers.host,'user-agent':request.headers['user-agent']},params:{},query:{}};
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
        if(this.items(null,subscription).length||!state.pending.length)return;
        let timer;try {
            const finished=await Promise.race([Promise.all(state.pending).then(()=>true),new Promise(resolve=>{timer=setTimeout(()=>resolve(false),15000);})]);
            if(!finished&&!this.items(null,subscription).length)throw fail('首次播放目录正在准备，请稍后在播放器刷新',503);
        }finally{clearTimeout(timer);}
    }
    source(library) {
        const instance=this.store.state.instances.find(i=>i.id===library.sourceId&&i.enabled);
        if(!instance)throw fail('源不存在或已停用',409);return this.store.resolve(instance.id);
    }
    catalogs(subscription) {return this.db.all('libraries').filter(l=>subscription.instances.includes(l.sourceId)&&this.store.state.instances.some(i=>i.id===l.sourceId&&i.enabled));}
    projections(library) {
        return library.kind==='Mixed'?['Movie','Series'].map(kind=>({...library,id:this.db.id(JSON.stringify(['source-view',library.id,kind])),catalogId:library.id,kind,name:library.name+(kind==='Movie'?' · 电影':' · 剧集')})):[library];
    }
    libraries(user,subscription) {return this.catalogs(subscription).flatMap(l=>this.projections(l));}
    items(user,subscription) {return this.catalogs(subscription).flatMap(l=>{
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
        const rootKey=JSON.stringify([library.id,library.sourceId,vodId]);
        const row=(key,type,name,parent,extra={})=>{const item={id:this.db.id(key),type,name:plain(name).slice(0,300),libraryId:library.id,sourceId:library.sourceId,vodId,parentId:parent,overview:plain(vod.vod_content),image:/^https?:\/\//i.test(vod.vod_pic||'')?String(vod.vod_pic).split('@')[0]:'',year:Number(String(vod.vod_year||'').match(/\d{4}/)?.[0])||null,genres:String(vod.vod_class||vod.type_name||'').split(/[,，/]/).filter(Boolean).slice(0,20),...extra};return {...item,etag:digest(JSON.stringify(item))};};
        const version=(line,e)=>{const locator=this.locator(library.sourceId,line,e);return {id:this.db.id(JSON.stringify([rootKey,'version',locator.identity||line.name,e.name])),name:line.name,locator,container:(e.name.match(/\.(mp4|mkv|webm|mov|avi|m3u8|ts)$/i)||e.play.match(/\.(mp4|mkv|webm|mov|avi|m3u8|ts)(?:[?#]|$)/i))?.[1]?.toLowerCase()||'mp4'};};
        const result=[];
        const classification=String(vod.type_name||vod.vod_type||'');
        const episodes=lines[0].episodes,numbers=episodes.map(e=>episodeNumber(e.name));
        const episodic=/电视剧|连续剧|剧集|动漫|综艺|series|tvshow/i.test(classification)||episodes.some(e=>/S\d{1,3}[ ._-]*E\d{1,4}/i.test(e.name))||(episodes.length>1&&numbers.every(n=>n&&n.episode<1000)&&new Set(numbers.map(n=>`${n.season}:${n.episode}`)).size===numbers.length);
        const kind=library.kind==='Mixed'?(/电影|movie/i.test(classification)?'Movie':episodic?'Series':'Movie'):library.kind;
        if(kind==='Movie') {
            if(lines.every(l=>l.episodes.length===1))result.push(row(rootKey,'Movie',vod.vod_name,library.id,{versions:lines.map(l=>version(l,l.episodes[0]))}));
            else for(const line of lines)for(const e of line.episodes)result.push(row(rootKey+JSON.stringify([line.name,e.name]),'Movie',`${vod.vod_name} · ${e.name} [${line.name}]`,library.id,{versions:[version(line,e)]}));
            return result;
        }
        const numbered=lines.map(l=>l.episodes.map(e=>episodeNumber(e.name)));
        const keys=numbered.map(list=>list.map(n=>n&&`${n.season}:${n.episode}`));
        const align=numbered.every(list=>list.every(Boolean))&&keys.every(list=>new Set(list).size===list.length&&[...list].sort().join('|')===[...keys[0]].sort().join('|'));
        // Ambiguous lines become separate series versions, never invented seasons.
        const groups=align?[lines]:lines.map(l=>[l]);
        for(const group of groups) {
            const key=rootKey+(align?'':JSON.stringify(['line',group[0].name]));
            const series=row(key,'Series',vod.vod_name+(align?'':` [${group[0].name}]`),library.id);
            result.push(series);const seasons=new Map();
            for(const [index,e] of group[0].episodes.entries()) {
                const number=episodeNumber(e.name)||{season:1,episode:index+1};
                if(!seasons.has(number.season)) {
                    const season=row(key+':season:'+number.season,'Season','第 '+number.season+' 季',series.id,{seriesId:series.id,seriesName:series.name,index:number.season});
                    result.push(season);seasons.set(number.season,season);
                }
                const season=seasons.get(number.season),identity=align?`${number.season}:${number.episode}`:this.locator(library.sourceId,group[0],e).identity||e.name;
                const versions=group.map(line=>{
                    const counterpart=align?line.episodes.find(candidate=>{const n=episodeNumber(candidate.name);return n?.season===number.season&&n.episode===number.episode;}):e;
                    return version(line,counterpart);
                });
                result.push(row(key+':episode:'+identity,'Episode',e.name,season.id,{seriesId:series.id,seriesName:series.name,seasonId:season.id,seasonName:season.name,index:number.episode,parentIndex:number.season,versions}));
            }
        }
        return result;
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
                const old=this.db.all('catalog:'+library.id),next=vodId?[...old]:[];
                for(const id of selected) {
                    if(this.closed||job.cancelled)break;
                    try {
                        const rows=await this.build(request,library,id);
                        for(let i=next.length-1;i>=0;i--)if(next[i].vodId===id)next.splice(i,1);
                        next.push(...rows);job.completed++;
                    }catch(error){job.errors.push({vodId:id,message:'详情同步失败，请检查源及网盘授权'});if(!vodId)next.push(...old.filter(i=>i.vodId===id));}
                    if(next.length>10000)throw fail('单媒体库条目超过10000项限制',413);
                }
                if(this.closed||job.cancelled){job.status='cancelled';return;}
                this.source(library);
                const current=this.db.get('libraries',library.id);if(!current)throw fail('媒体库已删除',409);
                if(library.automatic&&!vodId) {
                    const protectedIds=new Set(this.db.all('userdata').filter(s=>s.favorite||s.played||s.position>0).map(s=>s.itemId));
                    const protectedWorks=new Set(old.filter(i=>protectedIds.has(i.id)||this.recent.has(JSON.stringify([library.id,i.vodId]))).map(i=>i.vodId));
                    if(protectedWorks.size>library.maxItems)throw fail('观看记录目录达到容量上限',413);
                    const keep=new Set([...new Set([...protectedWorks,...next.map(i=>i.vodId),...old.map(i=>i.vodId)])].slice(0,library.maxItems));
                    const fresh=new Set(next.map(i=>i.vodId));next.push(...old.filter(i=>keep.has(i.vodId)&&!fresh.has(i.vodId)));
                    for(let i=next.length-1;i>=0;i--)if(!keep.has(next[i].vodId))next.splice(i,1);
                }
                if(next.length>10000)throw fail('单媒体库条目超过10000项限制',413);
                const works=new Set(next.map(i=>i.vodId));if(works.size>library.maxItems)throw fail('作品达到媒体库上限，请调整范围',413);
                if(selected.length&&job.completed===0)throw fail('本次同步全部失败，保留原媒体库',502);
                const totals=this.db.db.get("SELECT COUNT(*) AS count, COALESCE(SUM(length(CAST(body AS BLOB))),0) AS bytes FROM records WHERE namespace LIKE 'catalog:%'");
                const bytes=value=>value.reduce((sum,item)=>sum+Buffer.byteLength(JSON.stringify(item)),0);
                if(totals.count-old.length+next.length>20000||totals.bytes-bytes(old)+bytes(next)>20*1024*1024)throw fail('媒体目录达到20000项/20MiB全局限制',413);
                this.db.transaction(()=>{
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
