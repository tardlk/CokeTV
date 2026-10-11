<script setup>
import {ref,onBeforeUnmount} from 'vue';
import Icon from './Icon.vue';
const props=defineProps({api:{type:Function,required:true},account:Object});
const emit=defineEmits(['saved']);
const image=ref(''),status=ref(''),error=ref(''),requesting=ref(false),importing=ref(false);
const accessToken=ref(''),refreshToken=ref(''),deviceId=ref(''),clientId=ref('aMe-8VSlkrbQXpUR');
let timer,generation=0;
const states={waiting:'请使用光鸭云盘 App 扫码并确认。',confirmed:'光鸭登录信息已保存。',expired:'二维码已过期，请重新获取。',canceled:'已取消授权，可重新扫码。'};
async function start(){
    if(requesting.value)return;
    const version=++generation;clearTimeout(timer);requesting.value=true;error.value='';image.value='';status.value='';
    try{
        const session=await props.api('/admin/netdisk/guangya/login',{});
        const qr=await props.api(`/admin/netdisk/guangya/login/${session.id}/image`);
        if(version!==generation)return;
        image.value=qr.image;status.value=states.waiting;
        const poll=async()=>{
            try{
                const data=await props.api(`/admin/netdisk/guangya/login/${session.id}/poll`,{});
                if(version!==generation)return;
                status.value=states[data.status]||'等待光鸭返回授权状态。';
                if(data.account)emit('saved',data.account);
                if(['confirmed','expired','canceled'].includes(data.status)){image.value='';return;}
                timer=setTimeout(poll,3000);
            }catch(failure){if(version===generation){error.value=failure.message;image.value='';}}
        };
        timer=setTimeout(poll,3000);
    }catch(failure){if(version===generation)error.value=failure.message;}
    finally{if(version===generation)requesting.value=false;}
}
async function saveExisting(){
    if(requesting.value)return;
    ++generation;clearTimeout(timer);image.value='';error.value='';requesting.value=true;
    try{
        const result=await props.api('/admin/netdisk/guangya/account',{accessToken:accessToken.value.trim(),refreshToken:refreshToken.value.trim(),clientId:clientId.value.trim(),deviceId:deviceId.value.trim()});
        emit('saved',result.account);accessToken.value='';refreshToken.value='';deviceId.value='';importing.value=false;status.value=states.confirmed;
    }catch(failure){error.value=failure.message;}
    finally{requesting.value=false;}
}
async function setTransfer(event){
    error.value='';
    try{const result=await props.api('/admin/netdisk/guangya/options',{allowTransfer:event.target.checked});emit('saved',result.account);}
    catch(failure){error.value=failure.message;event.target.checked=props.account?.allowTransfer===true;}
}
onBeforeUnmount(()=>{generation++;clearTimeout(timer);accessToken.value='';refreshToken.value='';});
</script>
<template>
  <section class="settings-section guangya-account">
    <h2>光鸭云盘</h2><Badge :variant="account?.connected?'default':'secondary'">{{account?.connected?'已保存登录信息':'未登录'}}</Badge>
    <p class="section-description">登录信息保存在服务器，供源和订阅共用。视频由客户端直连获取；不会移动或删除已有文件。</p>
    <label class="guangya-transfer"><input type="checkbox" aria-label="允许光鸭按需转存" :checked="account?.allowTransfer===true" :disabled="!account?.connected||requesting" @change="setTransfer" />允许按需转存到 CokeTV 专用目录</label>
    <p class="section-description">部分分享需要保存后才能取播放地址。开启后只新增所选视频的副本，复用已保存文件，不自动清理云盘文件。</p>
    <Alert v-if="error" variant="destructive"><AlertTitle>光鸭登录未完成</AlertTitle><AlertDescription>{{error}}</AlertDescription></Alert>
    <div class="guangya-actions"><Button :disabled="requesting" @click="start"><Icon name="key" />{{requesting?'正在处理…':account?.connected?'重新扫码登录光鸭':'扫码登录光鸭'}}</Button><Button variant="outline" :disabled="requesting" @click="importing=!importing">使用已有登录信息</Button></div>
    <form v-if="importing" class="guangya-import" @submit.prevent="saveExisting">
      <p>可复用已登录浏览器的授权，令牌只写入本机服务器私有账号文件。</p>
      <Field><FieldLabel for="guangya-access">访问令牌</FieldLabel><Input id="guangya-access" v-model="accessToken" type="password" autocomplete="off" required /></Field>
      <Field><FieldLabel for="guangya-refresh">刷新令牌</FieldLabel><Input id="guangya-refresh" v-model="refreshToken" type="password" autocomplete="off" required /></Field>
      <Field><FieldLabel for="guangya-client">客户端 ID</FieldLabel><Input id="guangya-client" v-model="clientId" required /></Field>
      <Field><FieldLabel for="guangya-device">设备 ID</FieldLabel><Input id="guangya-device" v-model="deviceId" required /></Field>
      <Button type="submit" :disabled="requesting">验证并保存光鸭授权</Button>
    </form>
    <div v-if="image" class="guangya-qr"><img :src="image" alt="光鸭登录二维码" /></div>
    <p v-if="status" role="status">{{status}}</p>
  </section>
</template>
<style scoped>
.guangya-account{margin-top:20px}.guangya-transfer{display:flex;gap:8px;align-items:center;margin:16px 0}.guangya-actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:18px}.guangya-import{display:grid;gap:16px;max-width:560px;margin-top:20px}.guangya-qr img{width:240px;height:240px;display:block;margin:20px 0}
</style>
