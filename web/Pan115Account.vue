<script setup>
import {ref,watch,onBeforeUnmount} from 'vue';
import Icon from './Icon.vue';
const props=defineProps({api:{type:Function,required:true},account:Object});
const emit=defineEmits(['saved']);
const device=ref(props.account?.device||'alipaymini'),method=ref('scan'),cookie=ref(''),image=ref(''),status=ref(''),error=ref(''),requesting=ref(false);
const devices={alipaymini:'支付宝小程序',wechatmini:'微信小程序',tv:'电视',web:'网页',android:'安卓手机',ios:'苹果手机',qandroid:'115管理安卓版'};
const states={waiting:'请使用 115 App 扫码，并在手机上确认。',scanned:'已扫码，请在手机上确认。',confirmed:'115 登录信息已保存。',canceled:'已取消登录，可以重新获取二维码。',expired:'二维码已过期，请重新获取。'};
let timer,generation=0;
function cancel(){generation++;clearTimeout(timer);image.value='';status.value='';requesting.value=false;}
watch([method,device],()=>{cancel();cookie.value='';error.value='';});
async function start(){
    if(requesting.value)return;
    cancel();const version=generation;requesting.value=true;error.value='';
    try{
        const session=await props.api('/admin/netdisk/115/login',{device:device.value});
        const qr=await props.api(`/admin/netdisk/115/login/${session.id}/image`);
        if(version!==generation)return;
        image.value=qr.image;status.value=states.waiting;
        const poll=async()=>{
            try{
                const data=await props.api(`/admin/netdisk/115/login/${session.id}/poll`,{});
                if(version!==generation)return;
                status.value=data.retrying?'等待 115 返回状态，可继续扫码。':states[data.status]||'请重新获取二维码。';
                if(data.account)emit('saved',data.account);
                if(['confirmed','canceled','expired'].includes(data.status)){image.value='';return;}
                timer=setTimeout(poll,3000);
            }catch(failure){if(version===generation){error.value=failure.message;image.value='';}}
        };
        timer=setTimeout(poll,2500);
    }catch(failure){if(version===generation)error.value=failure.message;}
    finally{if(version===generation)requesting.value=false;}
}
async function saveExisting(){
    if(requesting.value)return;
    cancel();const version=generation;error.value='';requesting.value=true;
    try{
        const data=await props.api('/admin/netdisk/115/account',{cookie:cookie.value.trim(),device:device.value});
        if(version!==generation)return;
        emit('saved',data.account);cookie.value='';status.value=states.confirmed;
    }catch(failure){if(version===generation)error.value=failure.message;}
    finally{if(version===generation)requesting.value=false;}
}
onBeforeUnmount(()=>{cancel();cookie.value='';});
</script>
<template>
  <div class="drive-account-panel">
    <Alert v-if="error" variant="destructive"><AlertTitle>授权未完成</AlertTitle><AlertDescription>{{error}}</AlertDescription></Alert>
    <Tabs v-model="method"><TabsList class="grid w-full grid-cols-2"><TabsTrigger value="scan">扫码登录</TabsTrigger><TabsTrigger value="existing">使用已有登录信息</TabsTrigger></TabsList>
      <Field class="mt-4"><FieldLabel for="netdisk-device">登录设备</FieldLabel><NativeSelect id="netdisk-device" v-model="device" :disabled="requesting"><option v-for="(label,key) in devices" :key="key" :value="key">{{label}}</option></NativeSelect><FieldDescription>选择不常用的设备，避免影响同类设备上的已有登录。</FieldDescription></Field>
      <TabsContent value="scan" class="mt-4"><p class="text-sm text-muted-foreground">使用 115 App 扫码确认，授权保存后供所有源和订阅共用。</p><div class="drive-account-actions"><Button :disabled="requesting" @click="start"><Icon name="key" />{{requesting?'正在获取…':image?'重新获取二维码':account?.connected?'重新扫码登录':'获取二维码'}}</Button><Button v-if="image" variant="outline" @click="cancel">取消扫码</Button></div><div v-if="image" class="drive-account-qr"><img :src="image" alt="115 登录二维码" /></div></TabsContent>
      <TabsContent value="existing" class="mt-4"><form class="drive-account-form" @submit.prevent="saveExisting"><Field><FieldLabel for="netdisk-cookie">Cookie</FieldLabel><Input id="netdisk-cookie" v-model="cookie" type="password" autocomplete="off" placeholder="输入新的 115 Cookie" required /><FieldDescription>需包含 UID、CID、SEID。已有授权不会回显，保存后替换本机授权。</FieldDescription></Field><Button type="submit" :disabled="requesting"><Icon name="save" />{{requesting?'正在保存…':'保存授权'}}</Button></form></TabsContent>
    </Tabs>
    <p v-if="status" role="status" class="text-sm text-muted-foreground">{{status}}</p>
  </div>
</template>
