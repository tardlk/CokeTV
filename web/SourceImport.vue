<script setup>
import {ref, computed} from 'vue';
import {Link2, Upload, CheckCircle2} from '@lucide/vue';
import {engineLabels} from './engine-labels.js';
const props = defineProps({api: Function});
const emit = defineEmits(['file', 'busy', 'imported', 'close']);
const tab = ref('tvbox'), url = ref(''), busy = ref(false), error = ref(''), preview = ref(null), selected = ref([]), engines = ref({}), result = ref(null);
const chosen = computed(() => selected.value.filter(id => { const item = preview.value?.entries.find(entry => entry.id === id); return item?.status === 'ready' || (item?.status === 'needsEngine' && engines.value[id]); }));
const skipped = computed(() => preview.value?.entries.filter(item => item.status === 'skipped').length || 0);
const labels = {script: '脚本', cmsJson: 'JSON 采集', cmsXml: 'XML 采集'};
function loading(value) { busy.value = value; emit('busy', value); }
async function read() {
    if (busy.value) return;
    loading(true); error.value = ''; result.value = null; preview.value = null;
    try {
        preview.value = await props.api('/admin/import/tvbox/preview', {url: url.value.trim()});
        engines.value = {}; selected.value = preview.value.entries.filter(item => item.status === 'ready').map(item => item.id);
    } catch (failure) { error.value = failure.message; }
    finally { loading(false); }
}
function toggle(id, checked) { selected.value = checked ? [...new Set([...selected.value, id])] : selected.value.filter(item => item !== id); }
function engineSelected(id) { toggle(id, !!engines.value[id]); }
async function importSelected() {
    if (busy.value || !chosen.value.length) return;
    loading(true); error.value = '';
    try {
        result.value = await props.api('/admin/import/tvbox', {previewId: preview.value.previewId, ids: chosen.value, engines: engines.value});
        emit('imported', result.value);
    } catch (failure) { error.value = failure.message; }
    finally { loading(false); }
}
</script>
<template>
  <Tabs v-model="tab"><TabsList class="w-full"><TabsTrigger value="tvbox" :disabled="busy"><Link2 />TVBox 链接</TabsTrigger><TabsTrigger value="file" :disabled="busy"><Upload />本地文件</TabsTrigger></TabsList>
    <TabsContent value="tvbox" class="mt-4">
      <form @submit.prevent="read"><FieldGroup><Field :data-invalid="!!error"><FieldLabel for="tvbox-url">TVBox 配置链接</FieldLabel><Input id="tvbox-url" v-model="url" type="url" placeholder="https://example.com/tvbox.json" :disabled="busy" :aria-invalid="!!error" required /><FieldDescription>读取配置后选择要导入的源。</FieldDescription></Field></FieldGroup><div class="flex justify-end mt-3"><Button type="submit" :disabled="busy">{{busy&&!preview?'正在读取…':'读取链接'}}</Button></div></form>
      <p v-if="busy&&!preview" class="tvbox-import-progress" role="status">正在读取站点和脚本…</p>
      <Alert v-if="error" variant="destructive" class="mt-4"><AlertDescription>{{error}}</AlertDescription></Alert>
      <template v-if="preview">
        <p class="tvbox-import-summary">共 {{preview.total}} 个站点 · 已选择 {{chosen.length}} 个 · 跳过 {{skipped}} 个</p>
        <div class="tvbox-import-table"><Table><TableHeader><TableRow><TableHead class="w-9"><Checkbox aria-label="选择全部兼容源" :model-value="preview.entries.some(item=>item.status==='ready')&&preview.entries.filter(item=>item.status==='ready').every(item=>selected.includes(item.id))" :disabled="busy||!!result" @update:model-value="selected=$event?preview.entries.filter(item=>item.status==='ready').map(item=>item.id):[]" /></TableHead><TableHead>名称</TableHead><TableHead class="w-32">类型</TableHead><TableHead>结果</TableHead></TableRow></TableHeader><TableBody><TableRow v-for="item in preview.entries" :key="item.id"><TableCell><Checkbox :aria-label="'导入'+item.name" :model-value="selected.includes(item.id)" :disabled="busy||!!result||item.status==='skipped'||(item.status==='needsEngine'&&!engines[item.id])" @update:model-value="toggle(item.id,$event)" /></TableCell><TableCell class="font-medium">{{item.name}}</TableCell><TableCell><NativeSelect v-if="item.status==='needsEngine'" v-model="engines[item.id]" :aria-label="item.name+'运行格式'" :disabled="busy||!!result" @update:model-value="engineSelected(item.id)"><option value="">选择格式</option><option value="js">JS · drpyS</option><option value="dr2">JS · DR2</option></NativeSelect><span v-else>{{labels[item.kind]||'—'}}<small v-if="item.kind==='script'"> · {{engineLabels[item.engine]}}</small></span></TableCell><TableCell><span :class="item.status==='skipped'?'text-muted-foreground':''">{{item.reason}}</span></TableCell></TableRow></TableBody></Table></div>
        <p class="tvbox-import-note">脚本经过格式和语法检查；实际播放仍取决于站点、解析及源凭据。</p>
        <Alert v-if="result" class="mt-4"><CheckCircle2 /><AlertDescription role="status">已导入 {{result.imported}} 个源，{{result.existing}} 个已存在。{{skipped?'跳过 '+skipped+' 个不兼容或无法读取的站点。':''}}</AlertDescription></Alert>
      </template>
      <DialogFooter class="mt-5"><Button type="button" variant="outline" :disabled="busy" @click="emit('close')">{{result?'完成':'取消'}}</Button><Button v-if="preview&&!result" :disabled="busy||!chosen.length" @click="importSelected">{{busy?'导入中…':'导入所选（'+chosen.length+'）'}}</Button></DialogFooter>
    </TabsContent>
    <TabsContent value="file" class="mt-4"><Empty><EmptyHeader><EmptyMedia variant="icon"><Upload /></EmptyMedia><EmptyTitle>导入脚本或源包</EmptyTitle><EmptyDescription>支持 JS、Python、PHP 脚本和 ZIP。</EmptyDescription></EmptyHeader><EmptyContent><Button @click="emit('file')">选择文件</Button></EmptyContent></Empty></TabsContent>
  </Tabs>
</template>
