<script setup>
import {ref, computed, onMounted} from 'vue';
import Icon from './Icon.vue';

const props = defineProps({api: {type: Function, required: true}, download: {type: Function, required: true}});
const tab = ref('logs');
const logs = ref([]), backups = ref({items: [], keep: 7, intervalHours: 24, last: null});
const loadingLogs = ref(true), loadingBackups = ref(true), busy = ref(false), error = ref('');
const level = ref('all'), keyword = ref('');
const levels = [{value: 'all', label: '全部级别'}, {value: 'error', label: '错误'}, {value: 'warn', label: '警告'}, {value: 'info', label: '信息'}];
const filtered = computed(() => logs.value.filter(entry => (level.value === 'all' || entry.level === level.value) &&
    (!keyword.value || `${entry.message || ''} ${entry.source || ''}`.toLowerCase().includes(keyword.value.toLowerCase()))));
const sizeText = value => value < 1024 ? `${value} B` : value < 1048576 ? `${(value / 1024).toFixed(1)} KB` : `${(value / 1048576).toFixed(1)} MB`;
const timeText = value => new Intl.DateTimeFormat('zh-CN', {dateStyle: 'medium', timeStyle: 'medium'}).format(new Date(value));
const clock = value => String(value || '').slice(11, 19);
async function loadLogs() {
    loadingLogs.value = true;
    try { logs.value = await props.api('/admin/logs?limit=400'); }
    catch (failure) { error.value = failure.message; }
    finally { loadingLogs.value = false; }
}
async function loadBackups() {
    loadingBackups.value = true;
    try { backups.value = await props.api('/admin/backups'); }
    catch (failure) { error.value = failure.message; }
    finally { loadingBackups.value = false; }
}
async function refresh() { error.value = ''; await Promise.all([loadLogs(), loadBackups()]); }
async function snapshot() {
    if (busy.value) return;
    busy.value = true; error.value = '';
    try { await props.api('/admin/backups', {}); await loadBackups(); }
    catch (failure) { error.value = failure.message; }
    finally { busy.value = false; }
}
function downloadBackup(item) { props.download(`/admin/backups/${encodeURIComponent(item.name)}`, item.name); }
onMounted(refresh);
</script>
<template>
  <div class="page-heading"><div><h1>运行维护</h1><p>查看运行日志，管理数据快照。</p></div><Button variant="outline" :disabled="loadingLogs || loadingBackups" @click="refresh"><Icon name="refresh" />刷新</Button></div>
  <Alert v-if="error" variant="destructive" class="mb-5"><AlertTitle>操作未完成</AlertTitle><AlertDescription>{{error}}</AlertDescription></Alert>
  <Tabs v-model="tab">
    <TabsList><TabsTrigger value="logs">运行日志</TabsTrigger><TabsTrigger value="backups">数据快照</TabsTrigger></TabsList>
    <TabsContent value="logs">
      <div class="maintenance-toolbar">
        <NativeSelect v-model="level" class="filter-select" aria-label="日志级别"><option v-for="item in levels" :key="item.value" :value="item.value">{{item.label}}</option></NativeSelect>
        <InputGroup class="w-[240px]"><InputGroupInput v-model="keyword" aria-label="过滤日志" placeholder="搜索日志" /><InputGroupAddon><Icon name="search" :size="16" /></InputGroupAddon></InputGroup>
        <Button variant="outline" size="sm" @click="download('/admin/logs/download', 'coketv-logs.txt')"><Icon name="download" :size="14" />下载日志</Button>
      </div>
      <Skeleton v-if="loadingLogs" class="h-64 w-full" />
      <div v-else class="log-panel" role="log" aria-label="运行日志">
        <div v-for="(entry, index) in filtered" :key="index" class="log-line">
          <span class="log-time">{{clock(entry.time)}}</span>
          <Badge :variant="entry.level === 'error' ? 'destructive' : 'secondary'">{{entry.level || 'info'}}</Badge>
          <span v-if="entry.source" class="log-source">{{entry.source}}</span>
          <span class="log-message">{{entry.message}}</span>
        </div>
        <p v-if="!filtered.length" class="log-empty">暂无日志</p>
      </div>
      <p class="maintenance-note">日志同时写入 <code>data/logs/coketv.log</code>，按大小轮转；下载内容已隐藏令牌与授权头。</p>
    </TabsContent>
    <TabsContent value="backups">
      <div class="maintenance-toolbar">
        <Button size="sm" :disabled="busy" @click="snapshot"><Icon name="plus" />立即快照</Button>
        <span class="maintenance-meta">每 {{backups.intervalHours}} 小时自动快照，保留最近 {{backups.keep}} 份</span>
      </div>
      <Skeleton v-if="loadingBackups" class="h-48 w-full" />
      <template v-else>
        <div class="source-table"><Table><TableHeader><TableRow><TableHead>快照文件</TableHead><TableHead>创建时间</TableHead><TableHead>大小</TableHead><TableHead class="action-column">操作</TableHead></TableRow></TableHeader><TableBody>
          <TableRow v-for="item in backups.items" :key="item.name"><TableCell><code>{{item.name}}</code></TableCell><TableCell>{{timeText(item.time)}}</TableCell><TableCell>{{sizeText(item.size)}}</TableCell><TableCell><Button variant="outline" size="xs" :aria-label="'下载快照 '+item.name" @click="downloadBackup(item)"><Icon name="download" :size="14" />下载</Button></TableCell></TableRow>
          <TableRow v-if="!backups.items.length"><TableCell colspan="4"><Empty><EmptyHeader><EmptyMedia variant="icon"><Icon name="package" /></EmptyMedia><EmptyTitle>还没有数据快照</EmptyTitle><EmptyDescription>点击“立即快照”创建第一份，或等待自动快照。</EmptyDescription></EmptyHeader></Empty></TableCell></TableRow>
        </TableBody></Table></div>
        <p class="maintenance-note">快照包含运行状态、管理凭据、源脚本与历史、源 ENV 和持久 KV，不含可重建的运行库。恢复时停止服务，解压覆盖 data 目录后重启；快照含敏感凭据，请妥善保管。</p>
      </template>
    </TabsContent>
  </Tabs>
</template>
<style>
.maintenance-toolbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:16px 0}
.maintenance-meta{font-size:12px;color:var(--muted-foreground)}
.log-panel{max-height:56vh;overflow:auto;border:1px solid var(--border);border-radius:10px;background:var(--card);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
.log-line{display:flex;gap:8px;align-items:baseline;padding:6px 12px;border-bottom:1px solid color-mix(in srgb,var(--border) 55%,transparent)}
.log-line:last-child{border-bottom:0}
.log-time{color:var(--muted-foreground);font-variant-numeric:tabular-nums;flex-shrink:0}
.log-source{color:var(--muted-foreground);flex-shrink:0}
.log-message{white-space:pre-wrap;overflow-wrap:anywhere}
.log-empty{padding:36px;text-align:center;color:var(--muted-foreground)}
.maintenance-note{margin-top:14px;font-size:12px;line-height:1.75;color:var(--muted-foreground)}
.maintenance-note code{font-size:11px}
</style>
