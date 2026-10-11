import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes} from 'node:crypto';

const validToken=value=>typeof value==='string'&&/^[A-Za-z0-9._~+/=-]{1,16384}$/.test(value);
export function validateGuangyaCredentials(value) {
    if(!validToken(value?.accessToken)||!validToken(value?.refreshToken)||!/^\w[\w-]{0,127}$/.test(value.clientId||'')||!/^[a-f0-9]{32}$/i.test(value.deviceId||'')) throw Error('光鸭登录信息格式无效');
    if(value.allowTransfer!==undefined&&typeof value.allowTransfer!=='boolean')throw Error('光鸭转存选项无效');
    return value;
}
const validate=validateGuangyaCredentials;
export class GuangyaAccountStore {
    constructor(directory){this.directory=path.join(directory,'netdisk');this.file=path.join(this.directory,'guangya.json');this.account=null;this.pending=Promise.resolve();}
    async init(){
        await fs.mkdir(this.directory,{recursive:true,mode:0o700});
        if((await fs.lstat(this.directory)).isSymbolicLink())throw Error('网盘凭据目录不能是符号链接');
        await fs.chmod(this.directory,0o700);
        try{
            const stat=await fs.lstat(this.file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>65536)throw Error();
            const value=validate(JSON.parse(await fs.readFile(this.file,'utf8')));
            if(value.version!==1||!/^guangya:[a-f0-9]{32}$/.test(value.revision)||!Number.isFinite(value.savedAt)||!Number.isFinite(value.expiresAt))throw Error();
            this.account=value;await fs.chmod(this.file,0o600);
        }catch(error){if(error.code!=='ENOENT')throw Error('光鸭凭据文件损坏或不可读，已保留原文件');}
        return this;
    }
    value(){return this.account?{...this.account}:null;}
    status(){return this.account?{provider:'guangya',connected:true,revision:this.account.revision,savedAt:this.account.savedAt,allowTransfer:this.account.allowTransfer===true}:{provider:'guangya',connected:false,allowTransfer:false};}
    async write(value){
        const temporary=this.file+'.'+randomBytes(8).toString('hex')+'.tmp';
        try{await fs.writeFile(temporary,JSON.stringify(value,null,2),{mode:0o600,flag:'wx'});await fs.rename(temporary,this.file);this.account=value;}
        finally{await fs.rm(temporary,{force:true});}
        return this.status();
    }
    transact(work){const result=this.pending.then(work);this.pending=result.catch(()=>{});return result;}
    save(credentials){
        validate(credentials);
        return this.transact(()=>this.write({...credentials,allowTransfer:credentials.allowTransfer??this.account?.allowTransfer??false,expiresAt:Number(credentials.expiresAt)||Date.now()+3600000,version:1,revision:'guangya:'+randomBytes(16).toString('hex'),savedAt:Date.now()}));
    }
    updateTokens(revision,credentials){
        return this.transact(()=>{
            if(!this.account||this.account.revision!==revision)throw Object.assign(Error('光鸭账号已更新，请重试'),{statusCode:409});
            const value=validate({...this.account,...credentials,revision});return this.write(value);
        });
    }
    setTransferAllowed(value){
        if(typeof value!=='boolean')throw Error('光鸭转存选项无效');
        return this.transact(()=>{if(!this.account)throw Error('请先登录光鸭');return this.write({...this.account,allowTransfer:value});});
    }
}
