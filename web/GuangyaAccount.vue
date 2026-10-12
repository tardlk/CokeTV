<script setup>
import {ref,watch,onBeforeUnmount} from 'vue';
import Icon from './Icon.vue';
const props=defineProps({api:{type:Function,required:true},account:Object});
const emit=defineEmits(['saved']);
const image=ref(''),status=ref(''),error=ref(''),requesting=ref(false),method=ref('scan'),updating=ref(false);
const accessToken=ref(''),refreshToken=ref(''),deviceId=ref(''),clientId=ref('aMe-8VSlkrbQXpUR');
let timer,generation=0,disposed=false;
const states={waiting:'请使用光鸭云盘 App 扫码并确认。',confirmed:'光鸭登录信息已保存。',expired:'二维码已过期，请重新获取。',canceled:'已取消授权，可重新扫码。'};
function cancel(){generation++;clearTimeout(timer);image.value='';status.value='';requesting.value=false;}
watch(method,()=>{cancel();error.value='';accessToken.value='';refreshToken.value='';deviceId.value='';});
async function start(){
    if(requesting.value)return;
    cancel();const version=generation;requesting.value=true;error.value='';
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
    cancel();const version=generation;error.value='';requesting.value=true;
    try{
        const result=await props.api('/admin/netdisk/guangya/account',{accessToken:accessToken.value.trim(),refreshToken:refreshToken.value.trim(),clientId:clientId.value.trim(),deviceId:deviceId.value.trim()});
        if(version!==generation)return;
        emit('saved',result.account);accessToken.value='';refreshToken.value='';deviceId.value='';status.value=states.confirmed;
    }catch(failure){if(version===generation)error.value=failure.message;}
    finally{if(version===generation)requesting.value=false;}
}
async function setTransfer(event){
    error.value='';updating.value=true;
    try{const result=await props.api('/admin/netdisk/guangya/options',{allowTransfer:event.target.checked});if(!disposed)emit('saved',result.account);}
    catch(failure){if(!disposed){error.value=failure.message;event.target.checked=props.account?.allowTransfer===true;}}
    finally{if(!disposed)updating.value=false;}
}
onBeforeUnmount(()=>{disposed=true;cancel();accessToken.value='';refreshToken.value='';deviceId.value='';});
</script>
<template>
  <div class="drive-account-panel">
    <Alert v-if="error" variant="destructive"><AlertTitle>授权未完成</AlertTitle><AlertDescription>{{error}}</AlertDescription></Alert>
    <Tabs v-model="method"><TabsList class="grid w-full grid-cols-2"><TabsTrigger value="scan">扫码登录</TabsTrigger><TabsTrigger value="existing">使用已有登录信息</TabsTrigger></TabsList>
      <TabsContent value="scan" class="mt-4"><p class="text-sm text-muted-foreground">使用光鸭云盘 App 扫码并确认，登录信息只保存在服务器。</p><div class="drive-account-actions"><Button :disabled="requesting" @click="start"><Icon name="key" />{{requesting?'正在获取…':image?'重新获取二维码':account?.connected?'重新扫码登录光鸭':'获取二维码'}}</Button><Button v-if="image" variant="outline" @click="cancel">取消扫码</Button></div><div v-if="image" class="drive-account-qr"><img :src="image" alt="光鸭登录二维码" /></div></TabsContent>
      <TabsContent value="existing" class="mt-4"><form class="drive-account-form" @submit.prevent="saveExisting"><p class="text-sm text-muted-foreground">可复用已登录浏览器的授权。已有授权不会回显，保存后替换本机授权。</p><Field><FieldLabel for="guangya-access">访问令牌</FieldLabel><Input id="guangya-access" v-model="accessToken" type="password" autocomplete="off" required /></Field><Field><FieldLabel for="guangya-refresh">刷新令牌</FieldLabel><Input id="guangya-refresh" v-model="refreshToken" type="password" autocomplete="off" required /></Field><Field><FieldLabel for="guangya-client">客户端 ID</FieldLabel><Input id="guangya-client" v-model="clientId" required /></Field><Field><FieldLabel for="guangya-device">设备 ID</FieldLabel><Input id="guangya-device" v-model="deviceId" autocomplete="off" required /></Field><Button type="submit" :disabled="requesting"><Icon name="save" />{{requesting?'正在保存…':'验证并保存授权'}}</Button></form></TabsContent>
    </Tabs>
    <p v-if="status" role="status" class="text-sm text-muted-foreground">{{status}}</p>
    <div class="rounded-lg border p-4"><label class="flex items-center gap-2 text-sm"><input type="checkbox" aria-label="允许光鸭按需转存" :checked="account?.allowTransfer===true" :disabled="!account?.connected||requesting||updating" @change="setTransfer" />允许按需转存到 CokeTV 专用目录</label><p class="mt-2 text-xs text-muted-foreground leading-relaxed">部分分享需保存后播放。开启后仅新增所选视频副本，复用已有副本，不移动、删除或自动清理云盘文件。</p></div>
  </div>
</template>
