import {randomBytes,createHash} from 'node:crypto';
import JSONbig from 'json-bigint';
import QRCode from 'qrcode';
import {LRUCache} from 'lru-cache';
import {guardedHttp} from '../outbound.js';
import {assertTargetAllowed} from '../ssrf.js';
import {validateGuangyaCredentials} from './guangya-account.js';

const json=JSONbig({storeAsString:true,protoAction:'error',constructorAction:'error'});
const API='https://api.guangyapan.com', AUTH='https://account.guangyapan.com', WEB='https://www.guangyapan.com';
const CLIENT='aMe-8VSlkrbQXpUR';
const MEDIA=/\.(mp4|mkv|webm|m4v|mov|avi|flv|ts|m2ts|mpeg|mpg|wmv|3gp)$/i;
const fail=(message,statusCode=400)=>Object.assign(Error(message),{statusCode});
const id=value=>{if(typeof value==='number'&&!Number.isSafeInteger(value))throw fail('光鸭文件标识超过安全范围');const text=String(value??'');if(!/^[A-Za-z0-9_-]{1,200}$/.test(text))throw fail('光鸭文件标识无效');return text;};
export function parseGuangyaShare(input){
    let url;try{url=new URL(input);}catch{throw fail('请输入完整的光鸭分享链接');}
    const match=url.pathname.match(/^\/s\/([A-Za-z0-9_-]{1,200})\/?$/);
    if(!['http:','https:'].includes(url.protocol)||!['www.guangyapan.com','guangyapan.com'].includes(url.hostname)||url.port||url.username||url.password||!match)throw fail('不是有效的光鸭分享链接');
    const code=url.searchParams.get('code')||'';if(!/^[A-Za-z0-9]{0,64}$/.test(code))throw fail('光鸭提取码格式不正确');
    return {shareId:match[1],code};
}
export class Guangya {
    constructor({accounts,request,now=Date.now}={}){this.accounts=accounts;this.now=now;this.request=request||(options=>guardedHttp({...options,maxRedirects:0},url=>assertTargetAllowed(url,{allowPrivate:false})));this.sessions=new Map();this.refreshing=null;this.transfers=new Map();this.directoryPending=new Map();this.copies=new LRUCache({max:200,ttl:600000});this.directories=new LRUCache({max:500,ttl:600000});}
    headers(account){return {Accept:'application/json','Content-Type':'application/json',did:account.deviceId,dt:'4',Origin:WEB,Referer:WEB+'/'};}
    authHeaders(account){return {'Content-Type':'application/json',Accept:'application/json','X-Client-Id':account.clientId,'X-Client-Version':'0.0.1','X-Device-Id':account.deviceId,'X-Device-Sign':'wdi10.'+account.deviceId+'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx','X-Device-Model':'chrome%2F147.0.0.0','X-Device-Name':'PC-Chrome','X-OS-Version':'MacIntel','X-Platform-Version':'1','X-Protocol-Version':'301','X-SDK-Version':'9.0.2','X-Net-Work-Type':'NONE','X-Provider-Name':'NONE'};}
    async http(url,body,headers,method='POST'){
        let response;try{response=await this.request({url,method,headers,...(body===undefined?{}:{data:JSON.stringify(body)}),timeout:20000,responseType:'text'});}catch{throw fail('光鸭网络请求失败，请稍后重试',502);}
        let value;try{if(typeof response.data==='string'&&Buffer.byteLength(response.data)>2*1024*1024)throw Error();value=typeof response.data==='string'?json.parse(response.data):response.data;}catch{throw fail('光鸭接口返回格式异常',502);}
        if(!value||typeof value!=='object'||Array.isArray(value))throw fail('光鸭接口返回格式异常',502);
        return {status:response.status,value};
    }
    async accountCall(path,body,account){return this.http(AUTH+path,body,this.authHeaders(account));}
    async refresh(){
        if(this.refreshing)return this.refreshing;
        const account=this.accounts.value();if(!account)throw fail('请管理员在网盘管理登录光鸭',401);
        const work=(async()=>{
            const {status,value}=await this.accountCall('/v1/auth/token',{client_id:account.clientId,grant_type:'refresh_token',refresh_token:account.refreshToken},account);
            if(status!==200||!value.access_token)throw fail('光鸭登录已失效，请重新扫码',401);
            await this.accounts.updateTokens(account.revision,{accessToken:value.access_token,refreshToken:value.refresh_token||account.refreshToken,expiresAt:this.expires(value)});
        })();
        this.refreshing=work;try{await work;}finally{if(this.refreshing===work)this.refreshing=null;}
    }
    expires(value){const seconds=Number(value.expires_in);return this.now()+(Number.isFinite(seconds)&&seconds>0?Math.min(seconds,604800):3600)*1000;}
    async api(path,body,{authenticated=true}={}){
        let account=this.accounts.value();if(authenticated&&!account)throw fail('请管理员在网盘管理登录光鸭',401);
        if(authenticated&&account.expiresAt<=this.now()+30000){await this.refresh();account=this.accounts.value();}
        const anonymous={deviceId:'0'.repeat(32)};
        const send=a=>this.http(API+'/userres/v1/'+path,body,{...this.headers(a||anonymous),...(authenticated?{Authorization:'Bearer '+a.accessToken}:{})});
        let response=await send(account);
        if(authenticated&&(response.status===401||Number(response.value.code)===401)){
            if(this.accounts.value()?.accessToken===account.accessToken)await this.refresh();
            account=this.accounts.value();response=await send(account);
        }
        const {status,value}=response,code=Number(value.code||0);
        if(status===401||code===401)throw fail('光鸭登录已失效，请重新扫码',401);
        if(code===207)throw Object.assign(fail('光鸭分享未开放直接下载（207），请确认登录及分享权限',409),{apiCode:code});
        if([205,206,504].includes(code))throw fail('光鸭分享下载受平台流量或权限限制，请在官方页面确认',409);
        if(status!==200||code!==0||value.error)throw Object.assign(fail('光鸭请求未成功'+(code?'（代码 '+code+'）':'')+'，请检查分享或稍后重试',502),{apiCode:code});
        if(!value.data||typeof value.data!=='object')throw fail('光鸭接口返回格式异常',502);
        return value.data;
    }
    async validateCredentials(credentials){
        validateGuangyaCredentials(credentials);
        const {status,value}=await this.http(AUTH+'/v1/user/me',undefined,{...this.authHeaders(credentials),Authorization:'Bearer '+credentials.accessToken},'GET');
        if(status!==200||!value.sub)throw fail('光鸭登录信息无效，请重新登录',401);
    }
    async startLogin(){
        for(const [key,s] of this.sessions)if(s.expiresAt<=this.now())this.sessions.delete(key);
        if(this.sessions.size>=8)throw fail('登录二维码过多，请稍后重试',429);
        const credentials={clientId:CLIENT,deviceId:randomBytes(16).toString('hex')};
        const {status,value}=await this.accountCall('/v1/auth/device/code',{client_id:CLIENT,scope:'user'},credentials);
        if(status!==200||typeof value.device_code!=='string'||!value.device_code||value.device_code.length>4096)throw fail('光鸭没有返回有效二维码',502);
        let url;try{url=new URL(value.verification_uri_complete||value.verification_url);}catch{throw fail('光鸭二维码地址无效',502);}
        if(url.protocol!=='https:'||!['www.guangyapan.com','account.guangyapan.com','guangyapan.com'].includes(url.hostname)||url.port||url.username||url.password)throw fail('光鸭二维码地址无效',502);
        const session={...credentials,deviceCode:value.device_code,expiresAt:this.now()+Math.max(30,Math.min(Number(value.expires_in)||120,600))*1000,interval:Math.max(2000,Math.min(Number(value.interval)||3,15)*1000),lastPoll:-Infinity,status:'waiting',image:await QRCode.toDataURL(url.href,{width:256,margin:2})};
        const key=randomBytes(24).toString('base64url');this.sessions.set(key,session);return {id:key,expiresAt:session.expiresAt};
    }
    async qrImage(key){const s=this.sessions.get(key);if(!s||s.expiresAt<=this.now())throw fail('二维码不存在或已过期',410);return s.image;}
    async pollLogin(key){
        const s=this.sessions.get(key);if(!s)throw fail('二维码不存在或已过期',410);
        if(s.pending)return s.pending;
        const result=()=>({status:s.status,...(s.status==='confirmed'?{account:this.accounts.status()}:{}),expiresAt:s.expiresAt});
        if(s.status!=='waiting')return result();
        if(s.expiresAt<=this.now()){s.status='expired';return result();}
        if(this.now()-s.lastPoll<s.interval)return result();
        s.lastPoll=this.now();
        const pending=(async()=>{
            const {status,value}=await this.accountCall('/v1/auth/token',{client_id:s.clientId,grant_type:'urn:ietf:params:oauth:grant-type:device_code',device_code:s.deviceCode},s);
            if(status===200&&value.access_token){await this.accounts.save({accessToken:value.access_token,refreshToken:value.refresh_token,expiresAt:this.expires(value),clientId:s.clientId,deviceId:s.deviceId});s.status='confirmed';s.deviceCode='';s.image='';}
            else if(value.error==='slow_down')s.interval=Math.min(15000,s.interval+5000);
            else if(value.error==='expired_token')s.status='expired';
            else if(value.error==='access_denied')s.status='canceled';
            else if(value.error!=='authorization_pending')throw fail('光鸭扫码状态异常，请重试',502);
            return result();
        })();
        s.pending=pending;try{return await pending;}finally{if(s.pending===pending)s.pending=null;}
    }
    async listShare(input){
        const authenticated=!!this.accounts.value();
        const share=parseGuangyaShare(input), token=await this.api('get_share_access_token',share,{authenticated});
        if(typeof token.accessToken!=='string'||!token.accessToken||token.accessToken.length>16384)throw fail('光鸭没有返回有效分享令牌',502);
        const files=[],folders=[{id:'',path:''}],seenFolders=new Set(['']);let requests=0;
        while(folders.length){
            const folder=folders.shift();let cursor=0,received=0;const cursors=new Set([0]);
            for(;;){
                if(++requests>200)throw fail('光鸭分享目录请求超过上限',413);
                const data=await this.api('get_share_page_files_list',{accessToken:token.accessToken,parentId:folder.id,pageSize:100,cursor,orderBy:0,sortType:0},{authenticated});
                const list=Object.keys(data).length===0?[]:data.list;
                if(!Array.isArray(list))throw fail('光鸭分享目录返回异常',502);
                received+=list.length;
                for(const item of list){
                    const name=String(item.fileName||''),fileId=id(item.fileId);
                    if(Number(item.resType)===2&&!seenFolders.has(fileId)){
                        if(seenFolders.size>=500)throw fail('光鸭分享文件夹数量超过上限',413);
                        seenFolders.add(fileId);folders.push({id:fileId,path:folder.path+name+'/'});
                    }else if(Number(item.resType)===1&&MEDIA.test(name)){
                        if(files.length>=10000)throw fail('光鸭分享视频数量超过上限',413);
                        files.push({...share,shareToken:token.accessToken,fileId,name,path:folder.path+name,size:Number(item.fileSize||0)});
                    }
                }
                const total=Number(data.total||0),next=Number(data.cursor);
                if(total>0&&received>=total)break;
                if(data.hasMore===false||(!total&&!data.hasMore&&list.length<100))break;
                if(!Number.isSafeInteger(next)||next<=0){if(total>received||data.hasMore)throw fail('光鸭分享分页不完整，请稍后重试',502);break;}
                if(!list.length||cursors.has(next))throw fail('光鸭分享分页异常，请稍后重试',502);
                cursors.add(next);cursor=next;
            }
        }
        if(!files.length)throw fail('分享中没有支持的视频文件',404);
        return files.sort((a,b)=>a.name.localeCompare(b.name,'zh-Hans-CN',{numeric:true})||a.path.localeCompare(b.path));
    }
    async resolveFile(file){
        if(typeof file?.shareToken!=='string'||!file.shareToken||file.shareToken.length>16384)throw fail('光鸭播放引用无效');
        let data;
        try{data=await this.api('get_share_download_url',{accessToken:file.shareToken,fileId:id(file.fileId)});}
        catch(error){
            if(![143,207].includes(error.apiCode))throw error;
            if(!this.accounts.value()?.allowTransfer)throw fail(`此光鸭分享需要保存后播放（代码${error.apiCode}），请管理员在网盘管理开启按需转存`,409);
            const fileId=await this.transferFile(file);
            data=await this.api('get_res_download_url',{fileId});
        }
        let url;try{url=new URL(data.signedURL||data.downloadUrl);}catch{throw fail('光鸭未返回有效播放地址',502);}
        if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw fail('光鸭播放地址不可用',502);
        return {url:url.href,headers:{}};
    }
    transferScope(revision){if(this.accounts.value()?.revision!==revision||!this.accounts.value()?.allowTransfer)throw fail('光鸭账号或转存授权已变化，请刷新后重试',409);}
    async ownList(parentId){
        const result=[];
        for(let page=0;page<200;page++){
            const data=await this.api('file/get_file_list',{parentId,page,pageSize:100,orderBy:3,sortType:1});
            const list=Object.keys(data).length===0?[]:data.list;
            if(!Array.isArray(list))throw fail('光鸭个人目录返回异常',502);
            result.push(...list);
            if(list.length<100||(Number(data.total)>0&&result.length>=Number(data.total)))return result;
        }
        throw fail('光鸭专用目录查找超过上限',413);
    }
    async ensureDirectory(revision,parentId,name){
        const key=JSON.stringify([revision,parentId,name]);
        if(this.directories.has(key))return this.directories.get(key);
        if(this.directoryPending.has(key))return this.directoryPending.get(key);
        const work=(async()=>{
            this.transferScope(revision);
            const find=items=>items.find(item=>item.fileName===name);
            let entry=find(await this.ownList(parentId));
            if(entry){if(Number(entry.resType)!==2)throw fail('光鸭CokeTV目录名称与已有文件冲突，不会覆盖',409);return id(entry.fileId);}
            this.transferScope(revision);
            try{const created=await this.api('file/create_dir',{parentId,dirName:name,failIfNameExist:true});if(created.fileId)return id(created.fileId);}
            catch(error){entry=find(await this.ownList(parentId));if(!entry||Number(entry.resType)!==2)throw error;return id(entry.fileId);}
            entry=find(await this.ownList(parentId));if(!entry||Number(entry.resType)!==2)throw fail('光鸭专用目录创建未完成',502);return id(entry.fileId);
        })();
        this.directoryPending.set(key,work);
        try{const value=await work;this.directories.set(key,value);return value;}finally{this.directoryPending.delete(key);}
    }
    async transferFile(file){
        const revision=this.accounts.value()?.revision;this.transferScope(revision);
        const key=JSON.stringify([revision,file.shareId,file.fileId]);
        if(this.copies.has(key))return this.copies.get(key);
        if(this.transfers.has(key))return this.transfers.get(key);
        if(this.transfers.size>=4)throw fail('光鸭转存繁忙，请稍后重试',429);
        const work=(async()=>{
            const root=await this.ensureDirectory(revision,'','CokeTV');
            const name='item-'+createHash('sha256').update(JSON.stringify([file.shareId,file.fileId])).digest('hex').slice(0,24);
            const folder=await this.ensureDirectory(revision,root,name);
            const matching=items=>items.find(item=>Number(item.resType)===1&&item.fileName===file.name&&(!file.size||Number(item.fileSize)===file.size));
            let contents=await this.ownList(folder),existing=matching(contents);
            if(existing)return id(existing.fileId);
            if(contents.length)throw fail('光鸭专用目录含有其他内容，不会覆盖，请管理员检查',409);
            this.transferScope(revision);
            const restored=await this.api('restore_share',{accessToken:file.shareToken,fileIds:[id(file.fileId)],parentId:folder});
            if(!restored.taskId)throw fail('光鸭没有返回有效转存任务',502);
            const taskId=id(restored.taskId);let complete=false;
            for(let attempt=0;attempt<30;attempt++){
                this.transferScope(revision);
                const task=await this.api('get_task_status',{taskId});
                if(Number(task.status)===2){if(task.detail?.code&&Number(task.detail.code)!==0)throw fail('光鸭转存任务失败，请在官方页面确认权限',502);complete=true;break;}
                if([-1,3].includes(Number(task.status)))throw fail('光鸭转存任务失败，请在官方页面确认',502);
                await new Promise(resolve=>setTimeout(resolve,300));
            }
            if(!complete)throw fail('光鸭转存仍在进行，请稍后重试；不会删除网盘文件',504);
            this.transferScope(revision);contents=await this.ownList(folder);existing=matching(contents);
            if(!existing)throw fail('光鸭转存后尚未找到对应视频，请稍后重试',502);
            return id(existing.fileId);
        })();
        this.transfers.set(key,work);
        try{const value=await work;this.transferScope(revision);this.copies.set(key,value);return value;}finally{this.transfers.delete(key);}
    }
}
