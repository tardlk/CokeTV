<script setup>
import {ref, onMounted, onBeforeUnmount} from 'vue';
import Icon from './Icon.vue';
const props = defineProps({api: {type: Function, required: true}});
const account = ref(null), device = ref('alipaymini'), image = ref(''), status = ref(''), error = ref(''), loading = ref(true), requesting = ref(false);
let timer, generation = 0;
const devices = {alipaymini: '支付宝小程序', wechatmini: '微信小程序', tv: '电视', web: '网页', android: '安卓手机', ios: '苹果手机'};
const states = {waiting: '请使用 115 App 扫码，并在手机上确认。', scanned: '已扫码，请在手机上确认。', confirmed: '登录信息已保存。', canceled: '已取消登录，可以重新获取二维码。', expired: '二维码已过期，请重新获取。'};
const savedTime = value => value ? new Intl.DateTimeFormat('zh-CN', {dateStyle: 'medium', timeStyle: 'short'}).format(new Date(value)) : '';
async function load() {
    loading.value = true; error.value = '';
    try { const data = await props.api('/admin/netdisk'); account.value = data.providers.find(item => item.id === '115'); }
    catch (failure) { error.value = failure.message; }
    finally { loading.value = false; }
}
async function start() {
    if (requesting.value) return;
    const version = ++generation;
    clearTimeout(timer); requesting.value = true; image.value = ''; error.value = ''; status.value = '';
    try {
        const session = await props.api('/admin/netdisk/115/login', {device: device.value});
        const qr = await props.api(`/admin/netdisk/115/login/${session.id}/image`);
        if (version !== generation) return;
        image.value = qr.image; status.value = states.waiting;
        const poll = async () => {
            try {
                const data = await props.api(`/admin/netdisk/115/login/${session.id}/poll`, {});
                if (version !== generation) return;
                status.value = data.retrying ? '等待 115 返回状态，可继续扫码。' : states[data.status] || '请重新获取二维码。';
                if (data.account) account.value = {...account.value, ...data.account};
                if (['confirmed', 'canceled', 'expired'].includes(data.status)) { image.value = ''; return; }
                timer = setTimeout(poll, 3000);
            } catch (failure) { if (version === generation) { error.value = failure.message; status.value = '状态查询失败，请重新获取二维码。'; image.value = ''; } }
        };
        timer = setTimeout(poll, 2500);
    } catch (failure) { if (version === generation) error.value = failure.message; }
    finally { if (version === generation) requesting.value = false; }
}
onMounted(load);
onBeforeUnmount(() => { generation++; clearTimeout(timer); });
</script>
<template>
  <div class="page-heading"><div><h1>网盘管理</h1><p>登录网盘，供源和订阅共用。</p></div><Button variant="outline" :disabled="loading" @click="load"><Icon name="refresh" />刷新状态</Button></div>
  <Alert v-if="error" variant="destructive" class="mb-5"><AlertTitle>操作未完成</AlertTitle><AlertDescription>{{error}}</AlertDescription></Alert>
  <Skeleton v-if="loading" class="h-64 w-full" />
  <div v-else class="netdisk-layout">
    <section class="settings-section">
      <div class="netdisk-heading"><span class="netdisk-logo">115</span><div><h2>115 网盘</h2><Badge :variant="account?.connected?'default':'secondary'">{{account?.connected?'已保存登录信息':'未登录'}}</Badge></div></div>
      <p v-if="account?.connected" class="netdisk-saved">保存于 {{savedTime(account.savedAt)}}</p>
      <p class="section-description">使用 115 App 扫码登录，登录信息只保存在服务器。</p>
      <FieldGroup><Field><FieldLabel for="netdisk-device">登录设备</FieldLabel><NativeSelect id="netdisk-device" v-model="device" :disabled="requesting"><option v-for="(label,key) in devices" :key="key" :value="key">{{label}}</option></NativeSelect><FieldDescription>选择不常用的设备，避免影响同类设备上的已有登录。</FieldDescription></Field></FieldGroup>
      <div class="netdisk-actions"><Button :disabled="requesting" @click="start"><Icon name="key" />{{requesting?'正在获取…':image?'重新获取二维码':account?.connected?'重新扫码登录':'扫码登录'}}</Button></div>
      <div v-if="image" class="netdisk-qr"><img :src="image" alt="115 登录二维码" /><p>请使用 115 App 扫码</p></div>
      <p v-if="status" role="status" class="netdisk-status">{{status}}</p>
    </section>
    <section class="settings-section"><h2>如何配合源使用</h2><ol class="netdisk-steps"><li>在这里登录 115。</li><li>在源管理中导入你自己的资源搜索源。</li><li>源返回 115 分享链接后，服务器会展开视频分集，再交给播放器。</li></ol><p class="section-description">同一个账号可以供多个源使用，无需在每个源里重复填写登录信息。</p><p class="section-description">当前支持 115 分享读取与播放，不会自动转存或删除网盘文件。视频能否播放还取决于客户端对编码的支持。</p></section>
  </div>
</template>
<style scoped>
.netdisk-layout{display:grid;grid-template-columns:minmax(300px,440px) minmax(300px,1fr);gap:20px}.netdisk-heading{display:flex;align-items:center;gap:16px;margin-bottom:18px}.netdisk-heading h2{margin-bottom:8px}.netdisk-logo{display:grid;place-items:center;background:#eff8f4;color:#22a06b;width:64px;height:64px;border-radius:16px;font-size:23px;font-weight:800}.netdisk-saved{font-size:13px;color:var(--muted-foreground);margin:0 0 12px}.netdisk-actions{margin-top:20px}.netdisk-qr{margin:22px 0 0;text-align:center}.netdisk-qr img{display:block;width:240px;height:240px;margin:auto;image-rendering:pixelated}.netdisk-qr p{font-size:13px;color:var(--muted-foreground);margin:10px 0}.netdisk-status{margin:16px 0 0;font-size:14px;color:var(--muted-foreground)}.netdisk-steps{margin:8px 0 20px;padding-left:22px;line-height:2.2;color:var(--foreground)}@media(max-width:1000px){.netdisk-layout{grid-template-columns:1fr}}
</style>
