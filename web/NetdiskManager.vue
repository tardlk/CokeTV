<script setup>
import {ref,onMounted} from 'vue';
import Icon from './Icon.vue';
import Pan115Account from './Pan115Account.vue';
import GuangyaAccount from './GuangyaAccount.vue';
const props=defineProps({api:{type:Function,required:true}});
const providers=ref([]),loading=ref(true),error=ref(''),selected=ref(null),removing=ref(null),busy=ref(false);
const platforms=[{id:'115',name:'115 网盘',mark:'115',description:'扫码或 Cookie 授权',play:'客户端直连 · 不转存'},{id:'guangya',name:'光鸭云盘',mark:'光鸭',description:'扫码或已有授权',play:'客户端直连 · 可选按需转存'}];
const account=id=>providers.value.find(item=>item.id===id);
const savedTime=value=>value?new Intl.DateTimeFormat('zh-CN',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value)):'';
async function load(){loading.value=true;error.value='';try{const data=await props.api('/admin/netdisk');providers.value=data.providers;}catch(failure){error.value=failure.message;}finally{loading.value=false;}}
function saved(id,value){providers.value=providers.value.map(item=>item.id===id?{id:item.id,name:item.name,...value}:item);if(!providers.value.some(item=>item.id===id))providers.value.push({id,...value});}
async function remove(){
    if(!removing.value||busy.value)return;
    busy.value=true;error.value='';
    try{const id=removing.value.id,result=await props.api(`/admin/netdisk/${id}/account/remove`,{revision:removing.value.revision});saved(id,result.account);removing.value=null;}
    catch(failure){error.value=failure.message;}
    finally{busy.value=false;}
}
onMounted(load);
</script>
<template>
  <div class="page-heading"><div><h1>网盘管理</h1><p>统一管理网盘授权，供源和订阅共用。</p></div><Button variant="outline" :disabled="loading" @click="load"><Icon name="refresh" />刷新状态</Button></div>
  <Alert v-if="error" variant="destructive" class="mb-5"><AlertTitle>操作未完成</AlertTitle><AlertDescription>{{error}}</AlertDescription></Alert>
  <Skeleton v-if="loading" class="h-48 w-full" />
  <div v-else class="drive-grid">
    <article v-for="platform in platforms" :key="platform.id" class="drive-card" :class="{'drive-card-connected':account(platform.id)?.connected}">
      <div class="drive-card-top"><span class="drive-logo" :class="'drive-logo-'+platform.id">{{platform.mark}}</span><div class="drive-card-title"><h2>{{platform.name}}</h2><Badge :variant="account(platform.id)?.connected?'default':'secondary'">{{account(platform.id)?.connected?'已保存授权':'未配置'}}</Badge></div><div v-if="account(platform.id)?.connected" class="drive-card-tools"><Button variant="ghost" size="icon" :aria-label="'编辑'+platform.name+'授权'" @click="selected=platform"><Icon name="edit" :size="16" /></Button><Button variant="ghost" size="icon" :aria-label="'移除'+platform.name+'授权'" @click="removing={...platform,revision:account(platform.id)?.revision}"><Icon name="trash" :size="16" /></Button></div></div>
      <p class="drive-card-description">{{platform.description}}</p><p class="drive-card-detail">{{platform.play}}</p>
      <p v-if="account(platform.id)?.savedAt" class="drive-card-time">保存于 {{savedTime(account(platform.id).savedAt)}}</p><p v-else class="drive-card-time">配置后即可用于源播放</p>
      <Button class="w-full" :variant="account(platform.id)?.connected?'outline':'secondary'" :aria-label="'配置'+platform.name+'授权'" @click="selected=platform"><Icon :name="account(platform.id)?.connected?'settings':'plus'" />{{account(platform.id)?.connected?'管理授权':'配置授权'}}</Button>
    </article>
  </div>
  <p v-if="!loading" class="drive-page-note">已保存表示服务器已存有授权；能否使用取决于平台状态。登录信息不会下发给源或播放器。</p>
  <Dialog :open="!!selected" @update:open="value=>{if(!value)selected=null}"><DialogContent class="drive-dialog sm:max-w-xl"><DialogHeader><DialogTitle>{{account(selected?.id)?.connected?'管理':'配置'}}{{selected?.name}}授权</DialogTitle><DialogDescription>授权仅保存在服务器，同一网盘供所有源和订阅共用。</DialogDescription></DialogHeader><Pan115Account v-if="selected?.id==='115'" :api="api" :account="account('115')" @saved="saved('115',$event)" /><GuangyaAccount v-else-if="selected?.id==='guangya'" :api="api" :account="account('guangya')" @saved="saved('guangya',$event)" /><DialogFooter><Button variant="outline" @click="selected=null">完成</Button></DialogFooter></DialogContent></Dialog>
  <AlertDialog :open="!!removing" @update:open="value=>{if(!value&&!busy)removing=null}"><AlertDialogContent @escape-key-down="event=>{if(busy)event.preventDefault()}"><AlertDialogHeader><AlertDialogTitle>移除{{removing?.name}}授权？</AlertDialogTitle><AlertDialogDescription>仅移除 CokeTV 保存的本机授权，所有源将暂停使用此网盘，重新授权后可恢复。不会删除云盘中的文件或副本。</AlertDialogDescription></AlertDialogHeader><p v-if="error" role="alert" class="text-sm text-destructive">{{error}}</p><AlertDialogFooter><AlertDialogCancel :disabled="busy">取消</AlertDialogCancel><Button variant="destructive" :disabled="busy" @click="remove">{{busy?'正在移除…':'移除本机授权'}}</Button></AlertDialogFooter></AlertDialogContent></AlertDialog>
</template>
<style>
.drive-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,340px));gap:16px}.drive-card{border:1px solid var(--border);border-radius:14px;background:var(--card);padding:20px;transition:border-color .15s,box-shadow .15s}.drive-card:hover{box-shadow:0 3px 14px #102b1608}.drive-card-connected{border-color:color-mix(in srgb,var(--primary) 25%,var(--border))}.drive-card-top{display:flex;gap:12px;align-items:center}.drive-logo{display:grid;place-items:center;flex-shrink:0;width:48px;height:48px;border-radius:12px;font-size:19px;font-weight:750;background:#eef4ff;color:#355bd9}.drive-logo-guangya{background:#fff5e7;color:#ba701e}.drive-card-title{flex:1;min-width:0}.drive-card-title h2{font-size:15px;font-weight:600;margin-bottom:5px}.drive-card-tools{display:flex;align-self:flex-start;margin:-7px -7px 0 0}.drive-card-tools button{width:28px;height:28px}.drive-card-description{font-size:13px;margin:18px 0 5px}.drive-card-detail,.drive-card-time,.drive-page-note{font-size:12px;color:var(--muted-foreground)}.drive-card-time{margin:18px 0 14px}.drive-page-note{margin-top:20px;line-height:1.7}.drive-dialog{max-height:90dvh;overflow-y:auto}.drive-account-panel{display:grid;gap:16px}.drive-account-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px}.drive-account-qr img{display:block;width:220px;height:220px;max-width:100%;object-fit:contain;margin:20px auto;image-rendering:pixelated}.drive-account-form{display:grid;gap:16px}.drive-account-form>button{justify-self:start}@media(max-width:640px){.drive-grid{grid-template-columns:1fr}.drive-card{padding:16px}}
</style>
