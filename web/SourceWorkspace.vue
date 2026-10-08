<script setup>
import {ref, computed, onMounted, onBeforeUnmount, defineAsyncComponent} from 'vue';
import Icon from './Icon.vue';
import {engineLabels, engineDescriptions} from './engine-labels.js';
import {useMediaQuery} from '@vueuse/core';
const envOpen=ref(true),sidebarTab=ref('env'),envQuery=ref('');
const narrow=useMediaQuery('(max-width: 900px)');
const CodeEditor=defineAsyncComponent(()=>import('./CodeEditor.vue'));
const props = defineProps({source: Object, sources: Array, api: Function});
const emit = defineEmits(['close', 'saved']);
const engineNames=engineLabels;
const params=ref(props.source.params || ''),originalParams=ref(props.source.params || '');
const script = ref(null), code = ref(''), originalCode = ref(''), rows = ref([]), defaults = ref({}), originalEnv = ref('{}');
const loading = ref(true), busy = ref(false), message = ref(''), error = ref(''), method = ref('home'), value = ref(''), flag = ref(''), result = ref(null), logs = ref([]), showJson = ref(false), leaveDialog = ref(false);
const secret = key => /cookie|token|password|secret|api.?key|auth/i.test(key);
const inferredType = value => typeof value === 'object' ? 'json' : typeof value;
function environment() {
    const values = {}; const keys = new Set();
    for (const row of rows.value) {
        const key = row.key.trim();
        if (!key && !row.value) continue;
        if (!key) throw new Error('请填写变量名');
        if (keys.has(key)) throw new Error(`变量名重复：${key}`); keys.add(key);
        values[key] = row.type === 'json' ? JSON.parse(row.value) : row.type === 'number' ? Number(row.value) : row.type === 'boolean' ? row.value === 'true' : row.value;
        if (row.type === 'number' && (!row.value.trim() || !Number.isFinite(values[key]))) throw new Error(`数值无效：${key}`);
    }
    return values;
}
const envDirty = computed(() => { try { return JSON.stringify(environment()) !== originalEnv.value; } catch { return true; } });
const codeDirty = computed(() => code.value !== originalCode.value);
const paramsDirty = computed(() => params.value !== originalParams.value);
const dirty = computed(() => codeDirty.value || envDirty.value || paramsDirty.value);
let leaveAction = null;
function requestLeave(action) {
    if (dirty.value) { leaveAction = action; leaveDialog.value = true; }
    else action();
}
function confirmLeave() {
    const action = leaveAction; leaveAction = null; leaveDialog.value = false;
    action?.();
}
defineExpose({dirty, requestLeave});
async function loadEnvironment() {
    const data = await props.api(`/admin/instances/${props.source.id}/environment`);
    defaults.value = data.defaults;
    rows.value = Object.entries(data.values).map(([key, value]) => ({key, type: inferredType(value), value: typeof value === 'object' ? JSON.stringify(value) : String(value), show: false}));
    originalEnv.value = JSON.stringify(data.values);
}
async function task(fn, success = '') {
    if (busy.value) return; busy.value = true; error.value = ''; message.value = '';
    try { await fn(); message.value = success; } catch (failure) { error.value = failure.message; } finally { busy.value = false; }
}
async function saveCode() {
    await props.api('/admin/scripts', {engine: script.value.engine, name: script.value.file, code: code.value});
    originalCode.value = code.value;
    script.value = await props.api(`/admin/scripts/${props.source.scriptId}`);
    emit('saved');
}
async function saveEnv() {
    await props.api(`/admin/instances/${props.source.id}/environment`, {values: environment()}, 'PUT');
    await loadEnvironment(); emit('saved');
}
async function saveParams() {
    const state = await props.api('/admin/state');
    const current = state.instances.find(instance => instance.id === props.source.id);
    if (!current) throw new Error('源已不存在，请返回列表刷新');
    await props.api(`/admin/instances/${props.source.id}`, {...current, params: params.value}, 'PUT');
    originalParams.value = params.value; emit('saved');
}
async function verify() {
    result.value = null;
    try { result.value = await props.api(`/admin/verify/${props.source.id}`, {step: method.value, value: value.value, flag: flag.value}); }
    finally { logs.value = await props.api(`/admin/logs?source=${props.source.id}`); }
}
function next(step, id) { method.value = step; value.value = String(id || ''); }
function close() { requestLeave(() => emit('close')); }
function beforeUnload(event) { if (dirty.value) { event.preventDefault(); event.returnValue = ''; } }
async function restore(revision) {
    if (codeDirty.value) throw new Error('请先保存或撤销代码修改，再恢复历史版本');
    await props.api(`/admin/scripts/${script.value.id}/restore`, {revision});
    script.value = await props.api(`/admin/scripts/${script.value.id}`); code.value = script.value.code; originalCode.value = code.value; emit('saved');
}
onMounted(async () => {
    await task(async () => {
        script.value = await props.api(`/admin/scripts/${props.source.scriptId}`);
        code.value = script.value.code; originalCode.value = code.value;
        await loadEnvironment();
    });
    loading.value = false; window.addEventListener('beforeunload', beforeUnload);
});
onBeforeUnmount(() => window.removeEventListener('beforeunload', beforeUnload));
</script>

<template>
  <div class="workspace-shell">
    <header class="workspace-heading"><div><h1>{{source.name}}</h1><p>{{engineDescriptions[script?.engine] || ''}}</p></div><div class="workspace-save"><span v-if="dirty" class="unsaved-dot">未保存</span><Button variant="outline" size="sm" :disabled="busy || !script || !codeDirty" title="检查并保存脚本 (Ctrl+S)" @click="task(saveCode,'脚本已保存')">保存</Button><Button variant="outline" size="sm" @click="sidebarTab='params';envOpen=true">扩展参数</Button><Button variant="outline" size="sm" @click="envOpen=!envOpen">环境变量</Button><Button variant="outline" size="sm" @click="close">返回源管理</Button></div></header>
    <Alert v-if="error" variant="destructive" class="workspace-notice"><Icon name="error" /><AlertTitle>操作未完成</AlertTitle><AlertDescription>{{error}}</AlertDescription></Alert><Alert v-if="message" class="workspace-notice"><Icon name="check" /><AlertTitle>{{message}}</AlertTitle></Alert>
    <div v-if="loading" class="flex gap-4 p-4"><Skeleton class="h-56 w-1/4" /><Skeleton class="h-96 flex-1" /></div>
    <div v-else-if="script" class="workspace-body">
      <nav class="workspace-tools" aria-label="编辑器工具"><Button variant="ghost" size="icon" :class="{'tool-active':envOpen&&sidebarTab==='params'}" aria-label="扩展参数" title="扩展参数" @click="sidebarTab='params';envOpen=true"><Icon name="sliders" :size="20" /></Button><Button variant="ghost" size="icon" :class="{'tool-active':envOpen&&sidebarTab==='env'}" aria-label="本源环境变量" title="本源环境变量" @click="sidebarTab='env';envOpen=true"><Icon name="key" :size="20" /></Button></nav>
      <ResizablePanelGroup :direction="narrow?'vertical':'horizontal'" class="workspace-panels" :key="(narrow?'vertical':'horizontal')+envOpen">
        <ResizablePanel v-if="envOpen" :default-size="15.79" :min-size="12"><aside class="workspace-panel source-environment">
          <template v-if="sidebarTab==='env'"><div class="workspace-panel-title"><h2>本源环境变量</h2><Button variant="ghost" size="xs" @click="rows.push({key:'',value:'',type:'string',show:false})"><Icon name="plus" :size="14" />新建</Button></div><div class="environment-body"><InputGroup class="environment-search"><InputGroupInput v-model="envQuery" aria-label="搜索环境变量" placeholder="搜索环境变量" /><InputGroupAddon><Icon name="search" :size="16" /></InputGroupAddon></InputGroup><p class="environment-section-note">仅对“{{source.name}}”生效，脚本通过 ENV.get() 读取。</p>
            <div v-if="!rows.length" class="environment-empty"><Icon name="key" :size="48" /><p>暂无环境变量</p><p>点击“新建”按钮创建环境变量</p></div>
            <FieldGroup class="gap-2"><Field v-for="(row,index) in rows" :key="index" v-show="!envQuery||row.key.toLowerCase().includes(envQuery.toLowerCase())" class="environment-row"><FieldLabel :for="'env-key-'+index">变量 {{index+1}}</FieldLabel><div class="environment-key"><Input :id="'env-key-'+index" v-model="row.key" :aria-label="'变量名 '+(index+1)" placeholder="例如 quark_cookie" spellcheck="false" /><Button variant="ghost" size="icon-xs" :aria-label="'移除变量 '+(index+1)" @click="rows.splice(index,1)"><Icon name="x" :size="14" /></Button></div><FieldLabel :for="'env-value-'+index" class="sr-only">变量值 {{index+1}}</FieldLabel><div class="environment-value"><Textarea v-if="row.type==='json'" :id="'env-value-'+index" v-model="row.value" :aria-label="'变量值 '+(index+1)" rows="3" spellcheck="false" /><NativeSelect v-else-if="row.type==='boolean'" :id="'env-value-'+index" v-model="row.value" :aria-label="'变量值 '+(index+1)"><option value="true">true</option><option value="false">false</option></NativeSelect><Input v-else :id="'env-value-'+index" v-model="row.value" :type="secret(row.key)&&!row.show?'password':'text'" :aria-label="'变量值 '+(index+1)" placeholder="变量值" autocomplete="off" spellcheck="false" /><Button v-if="secret(row.key)" variant="ghost" size="icon-xs" :aria-label="(row.show?'隐藏':'显示')+'变量 '+(index+1)" @click="row.show=!row.show"><Icon :name="row.show?'hidden':'eye'" :size="14" /></Button></div><NativeSelect v-model="row.type" :aria-label="'变量类型 '+(index+1)"><option value="string">文本</option><option value="number">数字</option><option value="boolean">布尔值</option><option value="json">JSON</option></NativeSelect></Field></FieldGroup>
            <Button v-if="rows.length" variant="outline" size="sm" class="w-full" @click="rows.push({key:'',value:'',type:'string',show:false})"><Icon name="plus" :size="14" />添加变量</Button><div class="environment-save"><Button size="sm" :disabled="busy || !envDirty" @click="task(saveEnv,'本源环境变量已保存')">保存本源配置</Button><p class="environment-section-note">本源值优先。移除键后继承全局默认值。</p></div><details v-if="Object.keys(defaults).length" class="environment-defaults"><summary>全局默认值（{{Object.keys(defaults).length}}）</summary><div v-for="key in Object.keys(defaults)" :key="key"><code>{{key}}</code><span>{{rows.some(row=>row.key===key)?'本源覆盖':'继承'}}</span></div></details>
          </div></template>
          <template v-else-if="sidebarTab==='params'"><div class="workspace-panel-title"><h2>扩展参数</h2></div><div class="environment-body"><FieldGroup class="gap-3"><Field><FieldLabel for="source-params">本源扩展参数</FieldLabel><Textarea id="source-params" v-model="params" rows="8" class="json-input min-h-40" spellcheck="false" maxlength="50000" placeholder="按脚本要求填写网站地址、配置 URL 或其他文本；不需要时留空。" /><FieldDescription>只对“{{source.name}}”生效，同一脚本的其他实例不受影响。</FieldDescription></Field><Button size="sm" :disabled="busy || !paramsDirty" @click="task(saveParams,'扩展参数已保存')">保存扩展参数</Button></FieldGroup></div></template>

        </aside></ResizablePanel>
        <ResizableHandle v-if="!narrow&&envOpen" with-handle />
        <ResizablePanel :default-size="envOpen?52.63:68.42" :min-size="30"><section class="workspace-panel workspace-code"><div class="workspace-panel-title"><span>{{script.file}}</span><small>{{engineNames[script.engine]}}</small></div><CodeEditor v-model="code" :engine="script.engine" @save="task(saveCode,'脚本已保存')" /><div class="editor-foot"><span>UTF-8</span><span>{{code.split('\n').length}} 行</span></div><details v-if="script.revisions.length"><summary>历史版本（{{script.revisions.length}}）</summary><div class="revision-list"><div v-for="revision in script.revisions" :key="revision"><code>{{new Date(Number(revision.split('-')[0])).toLocaleString('zh-CN')}}</code><Button variant="outline" size="xs" :disabled="busy" @click="task(()=>restore(revision),'已恢复脚本版本')">恢复</Button></div></div></details></section></ResizablePanel>
        <ResizableHandle v-if="!narrow" with-handle />
        <ResizablePanel :default-size="31.58" :min-size="23"><section class="workspace-panel workspace-right"><ResizablePanelGroup direction="vertical">
          <ResizablePanel :default-size="70" :min-size="40"><section class="workspace-panel workspace-preview"><div class="workspace-panel-title"><h2>预览</h2><small>已保存版本</small></div><div class="preview-body"><form @submit.prevent="task(verify)"><NativeSelect v-model="method" aria-label="验证方法"><option value="home">首页</option><option value="category">分类</option><option value="search">搜索</option><option value="detail">详情</option><option value="play">播放</option></NativeSelect><Button size="sm" :disabled="busy || dirty"><Icon name="play" :size="14" />{{busy?'执行中…':'执行验证'}}</Button><Input v-if="method!=='home'" v-model="value" aria-label="接口参数" :placeholder="method==='search'?'搜索视频…':method==='category'?'分类 ID':method==='detail'?'内容 ID':'播放标识'" /><Input v-if="method==='play'" v-model="flag" aria-label="播放线路" placeholder="flag" /></form>
            <p v-if="dirty" class="workspace-section-note">请先保存代码、扩展参数和变量，再执行验证。</p>
            <div v-if="!result" class="preview-empty"><Icon name="monitor" :size="32" /><p>执行接口，预览返回内容</p></div>
            <template v-else><div class="result-caption">已返回数据 <span>{{result.cost}} ms</span></div><Tabs :model-value="showJson?'json':'preview'" @update:model-value="showJson=$event==='json'"><TabsList><TabsTrigger value="preview">预览</TabsTrigger><TabsTrigger value="json">JSON</TabsTrigger></TabsList><TabsContent value="json"><pre class="result-code">{{JSON.stringify(result.result,null,2)}}</pre></TabsContent><TabsContent value="preview"><div class="workspace-results"><Button v-for="category in result.result?.class || []" :key="category.type_id" variant="outline" size="sm" @click="next('category',category.type_id)">{{category.type_name}}</Button><div v-if="result.result?.list?.length" class="preview-cards"><article v-for="(item,index) in result.result.list" :key="index" class="preview-card"><div class="preview-poster"><img v-if="/^https?:\/\//i.test(item.vod_pic||'')" :src="item.vod_pic" :alt="item.vod_name||'封面'" loading="lazy" referrerpolicy="no-referrer" /><span v-else class="no-poster"><Icon name="monitor" :size="32" /></span><small v-if="item.vod_remarks">{{item.vod_remarks}}</small></div><button :disabled="!item.vod_id" @click="next('detail',item.vod_id)">{{item.vod_name || item.vod_id || '内容'}}</button><pre v-if="item.vod_play_url" class="result-code">{{item.vod_play_url}}</pre></article></div><p v-if="result.result?.url">播放地址：{{result.result.url}}</p></div></TabsContent></Tabs></template>
          </div></section></ResizablePanel>
          <ResizableHandle with-handle />
          <ResizablePanel :default-size="30" :min-size="15"><section class="workspace-panel workspace-logs"><div class="workspace-panel-title"><h2><Icon name="terminal" :size="14" />调试终端（{{logs.length}}）</h2><Button variant="ghost" size="icon-xs" aria-label="清空当前日志视图" title="清空日志视图" @click="logs=[]"><Icon name="trash" :size="14" /></Button></div><div class="terminal-body"><div v-for="(log,index) in logs" :key="index"><span class="terminal-time">[{{log.time.slice(11,23)}}]</span> <span class="terminal-kind">[源]</span> <span :class="log.level==='error'?'text-destructive':log.level==='warn'?'text-amber-600':'terminal-info'">[{{(log.level||'info').toUpperCase()}}]</span> {{log.message}}</div><span v-if="!logs.length" class="terminal-time">暂无日志</span></div></section></ResizablePanel>
        </ResizablePanelGroup></section></ResizablePanel>
      </ResizablePanelGroup>
    </div>
    <AlertDialog v-model:open="leaveDialog"><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>放弃未保存的修改？</AlertDialogTitle><AlertDialogDescription>代码、扩展参数或本源环境变量还没有保存。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>继续编辑</AlertDialogCancel><AlertDialogAction @click="confirmLeave">放弃并返回</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>
</template>
