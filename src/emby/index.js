import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {LRUCache} from 'lru-cache';
import {EmbyStore} from './store.js';
import {Catalog} from './catalog.js';
import {fail,text,digest,suppliedToken,clientInfo,userDTO} from './auth.js';
import {itemDTO,sourceDTO} from './dto.js';
import {createPlaybackSessions} from '../playback.js';
import {uniqueSubscriptionByToken} from '../subscriptions.js';

const id=()=>randomUUID().replaceAll('-','');
const count=(value,fallback,max)=>{const n=value===undefined?fallback:Number(value);if(!Number.isSafeInteger(n)||n<1||n>max)throw fail('数量或页数超出范围');return n;};

export async function registerEmby(app,{store,content,baseUrl,serveMedia,isNetdiskCurrent,targetGuard}) {
    const db=await new EmbyStore(store).init(),catalog=new Catalog(db,store,content);
    const mediaSessions=createPlaybackSessions();
    const pins=new LRUCache({max:64,maxSize:32*1024*1024,ttl:2*60000,sizeCalculation:rows=>Math.max(1,Buffer.byteLength(JSON.stringify(rows)))});
    const rates=new Map();
    const rate=(request,kind,max)=>{
        const key=kind+':'+request.ip,now=Date.now();let bucket=rates.get(key);
        if(!bucket||now-bucket.at>=60000){bucket={at:now,count:0};rates.set(key,bucket);}
        if(rates.size>10000){for(const [k,b]of rates)if(now-b.at>=60000)rates.delete(k);if(rates.size>10000)throw fail('请求繁忙',429);}
        if(++bucket.count>max)throw fail('请求过于频繁，请稍后重试',429);
    };
    // The fixed login name identifies the protocol. The password selects one
    // unique enabled subscription; no separate account or password is stored.
    const viewer=sub=>({id:digest(JSON.stringify(['emby-subscription',db.get('meta','server'),sub.id])).slice(0,32),name:'coke',subscriptionId:sub.id});
    const subscription=subscriptionId=>{
        const sub=store.state.subscriptions.find(s=>s.id===subscriptionId);
        if(!sub||uniqueSubscriptionByToken(store.state,sub.token)!==sub)throw fail('观看订阅已停用、令牌重复或不存在',401);
        return sub;
    };
    const authenticate=request=>{
        const token=suppliedToken(request),key=digest(token),session=db.get('sessions',key);
        if(!session||session.kind!=='subscription'||session.expires<=Date.now())throw fail('访问凭据无效或已过期',401);
        const sub=subscription(session.subscriptionId),user=viewer(sub);
        if(session.subscriptionRevision!==digest(sub.token)||session.userId!==user.id)throw fail('订阅凭据已重置，请重新登录',401);
        const userId=request.params.userId||request.query.UserId||request.query.userId;
        if(userId&&userId!==user.id)throw fail('不能访问其他订阅的观看记录',403);
        return {user,sub,session,key,token};
    };
    const allowed=(ctx,source)=>ctx.sub.instances.includes(source)&&store.state.instances.some(i=>i.id===source&&i.enabled);
    const rows=ctx=>catalog.items(ctx.user,ctx.sub);
    const findItem=(ctx,itemId)=>{
        const library=catalog.libraries(ctx.user,ctx.sub).find(l=>l.id===itemId);
        const item=rows(ctx).find(i=>i.id===itemId)||(library?libraryDTO(library):null);
        if(!item)throw fail('条目不存在或不在观看范围内',404);return item;
    };
    const dto=(request,ctx,item)=>itemDTO(item,{db,serverId:db.get('meta','server'),user:ctx.user,base:baseUrl(request),token:ctx.token});
    const libraryDTO=l=>({id:l.id,name:l.name,type:'CollectionFolder',kind:l.kind,parentId:db.get('meta','server')});
    const checkOrigin=request=>{
        if(['GET','HEAD','OPTIONS'].includes(request.method))return;
        if(request.headers['sec-fetch-site']==='cross-site')throw fail('不允许跨站修改',403);
        if(!request.headers.origin)return;
        const origins=[`${request.protocol}://${request.headers.host}`,store.state.settings.publicUrl].filter(Boolean).map(value=>{try{return new URL(value).origin;}catch{return '';}});
        if(!origins.includes(request.headers.origin))throw fail('不允许跨站修改',403);
    };
    const admin=(method,url,handler)=>app.route({method,url:'/admin/emby'+url,onRequest:async request=>checkOrigin(request),handler:async(request,reply)=>{
        reply.header('Cache-Control','private, no-store');
        // Opening an existing disabled database is an explicit management read.
        if(!db.db){try{await fs.access(path.join(db.directory,'emby.sqlite'));await db.open();}catch(error){if(error.code!=='ENOENT')throw error;}}
        return handler(request,reply);
    }});
    admin('GET','',()=>({mode:'subscription',serverId:db.get('meta','server')||null,login:{username:'coke',passwordMode:'subscription-token'},libraries:db.all('libraries'),jobs:[...catalog.jobs.values()],storageBytes:db.bytes||0,basePath:''}));
    const libraryBody=(body,previous={})=>{
        const sourceId=text(body.sourceId??previous.sourceId,'源ID');
        if(!store.state.instances.some(i=>i.id===sourceId&&i.enabled))throw fail('请选择启用的源');
        const kind=body.kind??previous.kind;if(!['Movie','Series'].includes(kind))throw fail('请选择电影或剧集');
        return {name:text(body.name??previous.name,'媒体库名称',100),sourceId,kind,category:String(body.category??previous.category??'').slice(0,200),pages:count(body.pages??previous.pages,1,10),maxItems:count(body.maxItems??previous.maxItems,100,1000)};
    };
    admin('POST','/libraries',async request=>{
        await db.open();if(db.all('libraries').length>=32)throw fail('媒体库达到32个上限');
        const library={id:id(),...libraryBody(request.body||{}),count:0,items:0};db.put('libraries',library.id,library);return library;
    });
    admin('PUT','/libraries/:libraryId',request=>{
        const old=db.get('libraries',request.params.libraryId);if(!old)throw fail('媒体库不存在',404);
        const next={...old,...libraryBody(request.body||{},old)};
        if(next.sourceId!==old.sourceId||next.kind!==old.kind)throw fail('源与类型不可直接修改，请新建媒体库');
        db.put('libraries',old.id,next);return next;
    });
    admin('DELETE','/libraries/:libraryId',request=>{
        const key=request.params.libraryId;
        for(const job of catalog.jobs.values())if(job.libraryId===key)job.cancelled=true;
        db.transaction(()=>{for(const item of db.all('catalog:'+key))db.remove('catalog:'+key,item.id);db.remove('libraries',key);});pins.clear();return {ok:true};
    });
    for(const [suffix,add]of [['sync',false],['items',true]])admin('POST','/libraries/:libraryId/'+suffix,request=>{
        const library=db.get('libraries',request.params.libraryId);if(!library)throw fail('媒体库不存在',404);
        if([...catalog.jobs.values()].some(j=>j.libraryId===library.id&&['queued','running'].includes(j.status)))throw fail('该媒体库正在同步',409);
        const job=catalog.job(library,request,add?{vodId:text(String(request.body?.vodId??''),'影片ID',10000)}:{});return {...job};
    });
    admin('GET','/jobs/:jobId',request=>{const job=catalog.jobs.get(request.params.jobId);if(!job)throw fail('任务不存在',404);return {...job};});
    admin('DELETE','/jobs/:jobId',request=>{const job=catalog.jobs.get(request.params.jobId);if(!job)throw fail('任务不存在',404);job.cancelled=true;return {ok:true};});
    admin('GET','/libraries/:libraryId/items',request=>db.all('catalog:'+request.params.libraryId).filter(i=>['Movie','Series'].includes(i.type)).map(i=>({id:i.id,name:i.name,type:i.type,vodId:i.vodId})));
    admin('DELETE','/libraries/:libraryId/items/:itemId',request=>{
        const key=request.params.libraryId,item=db.get('catalog:'+key,request.params.itemId);if(!item)throw fail('条目不存在',404);
        db.transaction(()=>{for(const row of db.all('catalog:'+key))if(row.vodId===item.vodId)db.remove('catalog:'+key,row.id);});pins.clear();return {ok:true};
    });
    admin('GET','/search',async request=>{
        const sourceId=text(request.query.sourceId,'源ID'),wd=text(request.query.wd,'搜索关键词');
        const library={sourceId},resolved=catalog.source(library);if(!resolved.instance.searchable)throw fail('源不支持搜索');
        let result=await content.query(request,resolved,{wd,pg:'1'});if(typeof result==='string')result=JSON.parse(result);
        return {list:(result.list||[]).slice(0,100).map(v=>({vod_id:String(v.vod_id),vod_name:String(v.vod_name||'').slice(0,300)}))};
    });

    app.post('/admin/subscriptions/:id/emby/prepare',{onRequest:async request=>checkOrigin(request)},async(request,reply)=>{
        reply.header('Cache-Control','private, no-store');
        const sub=store.state.subscriptions.find(s=>s.id===request.params.id);
        if(!sub||uniqueSubscriptionByToken(store.state,sub.token)!==sub)throw fail('订阅已停用、不存在或Token重复',409);
        await db.open();const {pending,...status}=catalog.prepare(request,sub);return status;
    });
    app.get('/admin/subscriptions/:id/emby',async(request,reply)=>{
        reply.header('Cache-Control','private, no-store');
        const sub=store.state.subscriptions.find(s=>s.id===request.params.id);
        if(!sub||uniqueSubscriptionByToken(store.state,sub.token)!==sub)throw fail('订阅已停用、不存在或Token重复',409);
        return catalog.status(sub);
    });

    const register=(methods,url,handler,{publicRoute=false,media=false}={})=>{
        const lower=url.split('/').map(part=>part.startsWith(':')?part:part.toLowerCase()).join('/');
        for(const route of new Set([url,lower,...[url,lower].map(p=>'/emby'+p)]))app.route({method:methods,url:route,handler:async(request,reply)=>{
            reply.header('Cache-Control','private, no-store');checkOrigin(request);
            if(!media)rate(request,'request',1200);
            await db.open();
            let ctx=publicRoute?null:authenticate(request);
            if(ctx&&['/Items','/Users/:userId/Items','/Search/Hints','/Users/:userId/Items/Latest'].includes(url)){await catalog.ready(request,ctx.sub);ctx=authenticate(request);}
            else if(ctx&&['/Users/:userId/Views','/Library/MediaFolders','/Library/VirtualFolders','/Items/Counts','/Users/:userId/Items/Resume','/Shows/NextUp'].includes(url))catalog.prepare(request,ctx.sub);
            return handler(request,reply,ctx);
        }});
    };
    register(['GET','POST'],'/System/Ping',(_request,reply)=>reply.type('text/plain').send('Emby Server'),{publicRoute:true});
    const system=()=>({Id:db.get('meta','server'),ServerName:'CokeTV',Version:'4.8.0.0',ProductName:'CokeTV',OperatingSystem:'Node.js',StartupWizardCompleted:true,SupportsLibraryMonitor:false,SupportsLocalPortConfiguration:false});
    register('GET','/System/Info/Public',system,{publicRoute:true});register('GET','/System/Info',system);
    register('GET','/Users/Public',()=>[],{publicRoute:true});
    register('POST','/Users/AuthenticateByName',async(request,reply)=>{
        rate(request,'login',20);
        const body=request.body||{},name=typeof body.Username==='string'?body.Username:body.username;
        const password=body.Pw??body.pw??body.Password;
        const sub=typeof password==='string'&&password.length<=200?uniqueSubscriptionByToken(store.state,password):undefined;
        if(typeof name!=='string'||name.toLowerCase()!=='coke'||!sub)throw fail('账号或订阅Token错误',401);
        const user=viewer(sub),token=randomBytes(32).toString('base64url'),key=digest(token),client=clientInfo(request);
        for(const s of db.all('sessions'))if(s.expires<=Date.now())db.remove('sessions',s.id);
        const sessions=db.all('sessions').filter(s=>s.userId===user.id);
        for(const s of sessions.filter(s=>s.DeviceId===client.DeviceId))db.remove('sessions',s.id);
        if(sessions.length>=32)db.remove('sessions',sessions[0].id);
        if(db.all('sessions').length>=4096)throw fail('观看会话达到上限，请退出闲置设备',429);
        const session={id:key,kind:'subscription',userId:user.id,subscriptionId:sub.id,subscriptionRevision:digest(sub.token),expires:Date.now()+30*86400000,...client};db.put('sessions',key,session);
        return {User:userDTO(user,db.get('meta','server')),AccessToken:token,ServerId:db.get('meta','server'),SessionInfo:{Id:key.slice(0,32),UserId:user.id,UserName:user.name,...client,PlayState:{},AdditionalUsers:[]}};
    },{publicRoute:true});
    for(const route of ['/Users/:userId','/Users/Me'])register('GET',route,(_request,_reply,ctx)=>userDTO(ctx.user,db.get('meta','server')));
    register('GET','/Users',(_request,_reply,ctx)=>[userDTO(ctx.user,db.get('meta','server'))]);
    for(const route of ['/Users/:userId/Items/Root','/Users/:userId/Items//','/Items/Root'])register('GET',route,()=>({Id:db.get('meta','server'),ServerId:db.get('meta','server'),Name:'CokeTV',Type:'UserRootFolder',IsFolder:true}));
    for(const route of ['/Users/:userId/Views','/Library/MediaFolders'])register('GET',route,(request,_reply,ctx)=>{
        const items=catalog.libraries(ctx.user,ctx.sub).map(l=>dto(request,ctx,libraryDTO(l)));return {Items:items,TotalRecordCount:items.length,StartIndex:0};
    });
    register('GET','/Library/VirtualFolders',(_request,_reply,ctx)=>catalog.libraries(ctx.user,ctx.sub).map(l=>({Name:l.name,ItemId:l.id,CollectionType:l.kind==='Mixed'?'':l.kind==='Series'?'tvshows':'movies',Locations:[],RefreshStatus:'Idle',LibraryOptions:{EnableRealtimeMonitor:false}})));
    const list=(request,reply,ctx,mode='items')=>{
        const q=request.query;let items=rows(ctx),libraries=catalog.libraries(ctx.user,ctx.sub).map(libraryDTO);
        if(mode==='resume')items=items.filter(i=>{const s=db.get('userdata',`${ctx.user.id}:${i.id}`);return s?.position>0&&!s.played;});
        else if(mode==='next') {
            const groups=new Map();for(const i of items.filter(i=>i.type==='Episode').sort((a,b)=>a.parentIndex-b.parentIndex||a.index-b.index)){const group=groups.get(i.seriesId)||[];group.push(i);groups.set(i.seriesId,group);}
            items=[...groups.values()].flatMap(group=>{
                if(!group.some(i=>{const s=db.get('userdata',`${ctx.user.id}:${i.id}`);return s?.played||s?.position>0;}))return [];
                return group.find(i=>!db.get('userdata',`${ctx.user.id}:${i.id}`)?.played)||[];
            });
        } else {
            const key=ctx.key+':'+JSON.stringify(Object.fromEntries(Object.entries(q).filter(([k])=>!['StartIndex','Limit','api_key','ApiKey','Fields','EnableUserData','EnableImages'].includes(k)).sort()));
            const start=Number(q.StartIndex||0);
            if(start===0||!pins.has(key))pins.set(key,items);
            items=(pins.get(key)||[]).filter(i=>allowed(ctx,i.sourceId)&&db.get('libraries',i.libraryId));
            if(q.ParentId===db.get('meta','server')) {
                if(String(q.Recursive).toLowerCase()==='true')items=[...libraries,...items];else items=libraries;
            }else if(q.ParentId) {
                const descendants=new Set([q.ParentId]);if(String(q.Recursive).toLowerCase()==='true')for(let pass=0;pass<4;pass++)for(const i of items)if(descendants.has(i.parentId))descendants.add(i.id);
                items=items.filter(i=>descendants.has(i.parentId));
            }else if(String(q.Recursive).toLowerCase()!=='true'&&!q.IncludeItemTypes&&!q.SearchTerm)items=libraries;
        }
        if(q.SeriesId)items=items.filter(i=>i.seriesId===q.SeriesId);
        if(request.params.seriesId) {
            const series=findItem(ctx,request.params.seriesId);if(series.type!=='Series')throw fail('剧集不存在',404);
            items=rows(ctx).filter(i=>i.seriesId===series.id&&i.type===(mode==='seasons'?'Season':'Episode'));
            if(q.SeasonId)items=items.filter(i=>i.seasonId===q.SeasonId);
        }
        if(q.IncludeItemTypes) {
            const types=String(q.IncludeItemTypes).split(',');if(types.some(type=>['CollectionFolder','UserView'].includes(type))&&!q.ParentId)items=[...items.filter(i=>i.type!=='CollectionFolder'),...libraries];
            items=items.filter(i=>types.includes(i.type));
        }
        if(q.ExcludeItemTypes)items=items.filter(i=>!String(q.ExcludeItemTypes).split(',').includes(i.type));
        if(q.Ids)items=items.filter(i=>String(q.Ids).split(',').includes(i.id));
        if(q.SearchTerm)items=items.filter(i=>i.name.toLowerCase().includes(String(q.SearchTerm).toLowerCase()));
        const filters=String(q.Filters||'').split(',');
        if(filters.includes('IsFavorite')||q.IsFavorite==='true')items=items.filter(i=>db.get('userdata',`${ctx.user.id}:${i.id}`)?.favorite);
        if(filters.includes('IsPlayed')||q.IsPlayed==='true')items=items.filter(i=>db.get('userdata',`${ctx.user.id}:${i.id}`)?.played);
        if(filters.includes('IsUnplayed')||q.IsPlayed==='false')items=items.filter(i=>!db.get('userdata',`${ctx.user.id}:${i.id}`)?.played);
        if(filters.includes('IsResumable'))items=items.filter(i=>{const s=db.get('userdata',`${ctx.user.id}:${i.id}`);return s?.position>0&&!s.played;});
        const descending=String(q.SortOrder).toLowerCase()==='descending';
        items.sort((a,b)=>{
            let order=String(q.SortBy||'').includes('IndexNumber')||['episodes','seasons','next'].includes(mode)?(a.parentIndex||0)-(b.parentIndex||0)||(a.index||0)-(b.index||0):a.name.localeCompare(b.name,'zh');
            order=order||a.id.localeCompare(b.id);return descending?-order:order;
        });
        const start=Number(q.StartIndex||0),limit=Number(q.Limit||100);
        if(!Number.isSafeInteger(start)||start<0||!Number.isSafeInteger(limit)||limit<1||limit>1000)throw fail('分页参数无效');
        const selected=items.slice(start,start+limit).map(i=>dto(request,ctx,i));
        if(mode==='latest')return selected;
        return {Items:selected,TotalRecordCount:items.length,StartIndex:start};
    };
    for(const url of ['/Items','/Users/:userId/Items'])register('GET',url,(r,p,c)=>list(r,p,c));
    for(const url of ['/Items/:itemId','/Users/:userId/Items/:itemId'])register('GET',url,(r,_p,c)=>dto(r,c,findItem(c,r.params.itemId)));
    register('GET','/Users/:userId/Items/Resume',(r,p,c)=>list(r,p,c,'resume'));
    register('GET','/Users/:userId/Items/Latest',(r,p,c)=>list(r,p,c,'latest'));
    register('GET','/Shows/NextUp',(r,p,c)=>list(r,p,c,'next'));
    register('GET','/Shows/:seriesId/Seasons',(r,p,c)=>list(r,p,c,'seasons'));
    register('GET','/Shows/:seriesId/Episodes',(r,p,c)=>list(r,p,c,'episodes'));
    register('GET','/Items/Counts',(_r,_p,c)=>{const items=rows(c);return {MovieCount:items.filter(i=>i.type==='Movie').length,SeriesCount:items.filter(i=>i.type==='Series').length,EpisodeCount:items.filter(i=>i.type==='Episode').length};});
    for(const route of ['/Items/:itemId/LocalTrailers','/Users/:userId/Items/:itemId/LocalTrailers'])register('GET',route,(request,_reply,ctx)=>{findItem(ctx,request.params.itemId);return [];});
    register('GET','/Search/Hints',(request,_reply,ctx)=>{
        const value=text(request.query.SearchTerm,'搜索关键词');const hints=rows(ctx).filter(i=>i.name.toLowerCase().includes(value.toLowerCase())).slice(0,100).map(i=>({Id:i.id,Name:i.name,Type:i.type,ItemId:i.id}));return {SearchHints:hints,TotalRecordCount:hints.length};
    });
    register(['GET','HEAD'],'/Items/:itemId/Images/:imageType',async(request,reply,ctx)=>{
        const item=findItem(ctx,request.params.itemId);if(request.params.imageType.toLowerCase()!=='primary'||!item.image)throw fail('图片不存在',404);
        await targetGuard(new URL(item.image));
        return serveMedia(request,reply,item.image,{},undefined);
    });
    const playInfo=(request,_reply,ctx)=>{
        if(request.body?.UserId&&request.body.UserId!==ctx.user.id)throw fail('不能访问其他订阅的观看记录',403);
        const item=findItem(ctx,request.params.itemId);if(!item.versions?.length)throw fail('请选择影片或分集',422);
        const selected=request.body?.MediaSourceId||request.query.MediaSourceId;
        const versions=selected?item.versions.filter(v=>v.id===selected):item.versions;
        if(!versions.length)throw fail('播放版本不存在',404);
        const sessionId=randomBytes(24).toString('base64url');
        for(const p of db.all('plays'))if(p.expires<Date.now())db.remove('plays',p.id);
        if(db.all('plays').length>=1000)throw fail('播放会话过多',429);
        db.put('plays',sessionId,{id:sessionId,itemId:item.id,userId:ctx.user.id,sessionKey:ctx.key,started:Date.now(),expires:Date.now()+12*3600000});
        return {MediaSources:versions.map(v=>sourceDTO(item,v,baseUrl(request),ctx.token,sessionId)),PlaySessionId:sessionId};
    };
    register(['GET','POST'],'/Items/:itemId/PlaybackInfo',playInfo);
    const mediaUrl=(request,ctx,item,media)=>{
        const ext=/^(m3u8|mp4|mkv|ts|webm|mov|avi)$/.test(media.type)?media.type:'bin';
        const ticket=mediaSessions.create(item.sourceId,media.url,media.headers,{userId:ctx.user.id,sessionKey:ctx.key,netdiskRevision:media.netdiskRevision,itemId:item.id});
        return `${baseUrl(request)}/emby/Media/${ticket}/stream.${ext}?api_key=${encodeURIComponent(ctx.token)}`;
    };
    const stream=async(request,reply,ctx)=>{
        rate(request,'stream',120);
        const item=findItem(ctx,request.params.itemId),versionId=request.query.MediaSourceId;
        const version=versionId?item.versions?.find(v=>v.id===versionId):item.versions?.[0];if(!version)throw fail('播放版本不存在',404);
        const media=await catalog.play(request,item,version,ctx.sub);
        const current=authenticate(request);if(!allowed(current,item.sourceId)||!isNetdiskCurrent(media.netdiskRevision))throw fail('源或网盘账号已更新，请刷新',403);
        if(media.direct) {await targetGuard(new URL(media.url));return reply.redirect(media.url);}
        return reply.redirect(mediaUrl(request,ctx,item,{...media,type:media.type||version.container}));
    };
    for(const url of ['/Videos/:itemId/stream','/Videos/:itemId/stream.:extension','/Videos/:itemId/original'])register(['GET','HEAD'],url,stream);
    register(['GET','HEAD'],'/Media/:ticket/:file',async(request,reply,ctx)=>{
        const session=mediaSessions.get(request.params.ticket);
        if(!session||session.userId!==ctx.user.id||session.sessionKey!==ctx.key||!allowed(ctx,session.source)||!isNetdiskCurrent(session.netdiskRevision)||!/^stream\.(bin|m3u8|mp4|mkv|ts|webm|mov|avi)$/.test(request.params.file))throw fail('媒体引用已过期或无权访问',403);
        const item=findItem(ctx,session.itemId);
        return serveMedia(request,reply,session.url,session.headers,ctx.sub.token,undefined,url=>mediaUrl(request,ctx,item,{...session,url}));
    },{media:true});
    const changeState=(request,reply,ctx,kind)=>{
        const item=findItem(ctx,request.params.itemId),key=ctx.user.id+':'+item.id,old=db.get('userdata',key)||{};
        const value=request.method!=='DELETE';const next={...old,id:key,userId:ctx.user.id,itemId:item.id,[kind]:value};
        if(kind==='played'&&value)next.position=0;
        db.put('userdata',key,next);return dto(request,ctx,item).UserData;
    };
    register(['POST','DELETE'],'/Users/:userId/FavoriteItems/:itemId',(r,p,c)=>changeState(r,p,c,'favorite'));
    register(['POST','DELETE'],'/Users/:userId/PlayedItems/:itemId',(r,p,c)=>changeState(r,p,c,'played'));
    for(const action of ['Playing','Playing/Progress','Playing/Stopped'])register('POST','/Sessions/'+action,(request,reply,ctx)=>{
        const body=request.body||{},item=findItem(ctx,String(body.ItemId||'')),key=ctx.user.id+':'+item.id;
        if(!item.versions?.length)throw fail('不可播放条目');
        let play;
        if(body.PlaySessionId){play=db.get('plays',body.PlaySessionId);if(!play||play.userId!==ctx.user.id||play.itemId!==item.id||play.sessionKey!==ctx.key||play.expires<=Date.now())throw fail('播放会话无效',403);}
        const position=Number(body.PositionTicks||0),duration=Number(body.RunTimeTicks||0);
        if(!Number.isSafeInteger(position)||position<0||position>7*86400*1e7||!Number.isSafeInteger(duration)||duration<0||duration>7*86400*1e7)throw fail('播放进度无效');
        const old=db.get('userdata',key)||{},started=play?.started||Date.now();
        if(!old.started||started>=old.started)db.put('userdata',key,{...old,id:key,userId:ctx.user.id,itemId:item.id,position,duration:duration||old.duration||0,started,played:duration>0&&position>=duration*0.9,updated:Date.now()});
        if(action==='Playing/Stopped'&&play)db.remove('plays',play.id);
        return reply.code(204).send();
    });
    register('POST','/Sessions/Logout',(request,reply,ctx)=>{db.remove('sessions',ctx.key);pins.clear();return reply.code(204).send();});
    register('GET','/Sessions',(_r,_p,ctx)=>[{Id:ctx.key.slice(0,32),UserId:ctx.user.id,UserName:ctx.user.name,Client:ctx.session.Client,DeviceId:ctx.session.DeviceId,DeviceName:ctx.session.DeviceName,PlayState:{},SupportsRemoteControl:false}]);
    register(['GET','POST'],'/DisplayPreferences/:preferenceId',(request,reply,ctx)=>{
        const preferenceId=text(request.params.preferenceId,'偏好ID',100),client=String(request.query.Client||'').slice(0,100),key=JSON.stringify([ctx.user.id,preferenceId,client]);
        if(request.method==='POST') {
            const body=request.body;if(!body||typeof body!=='object'||Array.isArray(body)||Buffer.byteLength(JSON.stringify(body))>16384)throw fail('显示偏好无效');
            if(db.all('preferences').length>=2048&&!db.get('preferences',key))throw fail('显示偏好数量已达上限',413);
            const value=Object.fromEntries(Object.entries(body).filter(([k])=>['ViewType','SortBy','SortOrder','IndexBy','ScrollDirection','RememberIndexing','RememberSorting','CustomPrefs'].includes(k)));
            db.put('preferences',key,value);return reply.code(204).send();
        }
        return {Id:preferenceId,ViewType:'Poster',SortBy:'SortName',SortOrder:'Ascending',CustomPrefs:{},...db.get('preferences',key)};
    });
    register('POST','/Sessions/Capabilities/Full',(_r,reply)=>reply.code(204).send());
    app.addHook('onClose',async()=>{await catalog.close();db.close();});
    return {db,catalog};
}
