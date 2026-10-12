<script setup>
import {ref,onMounted,onBeforeUnmount} from 'vue';
import Icon from './Icon.vue';
const props=defineProps({subscription:{type:Object,required:true},baseUrl:{type:String,required:true},api:{type:Function,required:true}});
const emit=defineEmits(['copy']);
const status=ref(null),error=ref('');let disposed=false,timer;
async function poll(){
    try {const value=await props.api(`/admin/subscriptions/${encodeURIComponent(props.subscription.id)}/emby`);if(disposed)return;status.value=value;if(value.preparing>0)timer=setTimeout(poll,2500);}
    catch(e){if(!disposed)error.value=e.message;}
}
onMounted(async()=>{
    if(!props.subscription.enabled||!props.subscription.instances?.length)return;
    try {const value=await props.api(`/admin/subscriptions/${encodeURIComponent(props.subscription.id)}/emby/prepare`,{});if(disposed)return;status.value=value;if(value.preparing>0)timer=setTimeout(poll,2500);}
    catch(e){if(!disposed)error.value=e.message;}
});
onBeforeUnmount(()=>{disposed=true;clearTimeout(timer);});
</script>
<template>
  <FieldGroup class="gap-4 mt-5">
    <Field><FieldLabel for="emby-connection-server">服务器地址</FieldLabel><div class="subscription-link"><Input id="emby-connection-server" :model-value="baseUrl" readonly aria-label="Emby服务器地址" /><Button variant="secondary" size="icon" aria-label="复制Emby服务器地址" @click="emit('copy',baseUrl)"><Icon name="copy" /></Button></div></Field>
    <Field><FieldLabel for="emby-connection-user">用户名</FieldLabel><div class="subscription-link"><Input id="emby-connection-user" model-value="coke" readonly aria-label="Emby用户名" /><Button variant="secondary" size="icon" aria-label="复制Emby用户名" @click="emit('copy','coke')"><Icon name="copy" /></Button></div></Field>
    <Field><FieldLabel for="emby-connection-password">密码</FieldLabel><div class="subscription-link"><Input id="emby-connection-password" :model-value="subscription.token" readonly aria-label="Emby密码" /><Button variant="secondary" size="icon" aria-label="复制Emby密码" @click="emit('copy',subscription.token)"><Icon name="copy" /></Button></div></Field>
    <FieldDescription v-if="!subscription.enabled">此订阅已停用，播放器连接会被拒绝。</FieldDescription>
    <FieldDescription v-else-if="!subscription.instances?.length">请先将要观看的源加入此订阅。</FieldDescription>
    <FieldDescription v-else>在支持Emby的播放器中填写以上信息即可。只显示此订阅内启用的源；首次读取会自动准备推荐目录，无需另建账号或媒体库。</FieldDescription>
    <FieldDescription>密码即本订阅Token，请妥善保管。修改或重置Token后，需要在Emby播放器中更新密码并重新登录。</FieldDescription>
    <p v-if="status?.preparing" role="status" class="text-xs text-muted-foreground">正在准备 {{status.preparing}} 个源的播放目录，可先复制连接信息。</p>
    <p v-else-if="status?.failed" role="status" class="text-xs text-muted-foreground">部分源目录读取失败，请在源编辑页验证后，在播放器刷新重试。</p>
    <p v-if="error" role="alert" class="text-xs text-destructive">{{error}}</p>
  </FieldGroup>
</template>
