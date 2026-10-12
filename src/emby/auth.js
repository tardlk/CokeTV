// go-emby login_compat.go/main.go request forms adapted with owner permission.
import {createHash} from 'node:crypto';
export const fail=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode});
export const digest=value=>createHash('sha256').update(String(value)).digest('hex');
export const text=(value,label,max=200)=>{if(typeof value!=='string'||!value.trim()||value.length>max)throw fail(label+'无效');return value.trim();};
export function clientInfo(request) {
    const raw=request.headers['x-emby-authorization']||request.headers.authorization||'';
    if(raw.length>4096)throw fail('客户端标识过长');
    const fields={};for(const match of raw.matchAll(/([a-z]+)\s*=\s*"([^"\r\n]*)"/gi))fields[match[1].toLowerCase()]=match[2].slice(0,200);
    return {Client:fields.client||'Emby',DeviceName:fields.device||'播放器',DeviceId:fields.deviceid||String(request.query.DeviceId||'unknown').slice(0,200),ApplicationVersion:fields.version||''};
}
export function suppliedToken(request) {
    const values=[request.headers['x-emby-token'],request.headers['x-mediabrowser-token'],request.query.api_key,request.query.ApiKey,request.query.AccessToken];
    for(const raw of [request.headers.authorization,request.headers['x-emby-authorization'],request.query['X-Emby-Authorization']]) {
        if(typeof raw!=='string')continue;
        if(raw.length>4096)throw fail('访问凭据无效',401);
        const matches=[...raw.matchAll(/\bToken\s*=\s*"([^"\r\n]*)"/gi)].map(m=>m[1]);values.push(...matches);
        if(/^Bearer /i.test(raw))values.push(raw.slice(7));
    }
    const tokens=values.filter(v=>v!==undefined&&v!=='');
    if(!tokens.length||tokens.some(v=>typeof v!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(v))||new Set(tokens).size!==1)throw fail('访问凭据无效或已过期',401);
    return tokens[0];
}
export const userDTO=(user,serverId)=>({Id:user.id,Name:user.name,ServerId:serverId,HasPassword:true,HasConfiguredPassword:true,Configuration:{},Policy:{IsAdministrator:false,EnableMediaPlayback:true,EnableAudioPlaybackTranscoding:false,EnableVideoPlaybackTranscoding:false,EnableContentDeletion:false}});
