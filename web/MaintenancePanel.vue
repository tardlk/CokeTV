<script setup>
import {ref, computed, onMounted, onUnmounted} from 'vue';
import Icon from './Icon.vue';

const props = defineProps({api: {type: Function, required: true}, download: {type: Function, required: true}});
const tab = ref('logs');
const logs = ref([]), backups = ref({items: [], keep: 7, intervalHours: 24, last: null});
const loadingLogs = ref(true), loadingBackups = ref(true), busy = ref(false), error = ref('');
const level = ref('all'), category = ref('all'), keyword = ref(''), autoRefresh = ref(true);
const levels = [{value: 'all', label: '全部级别'}, {value: 'error', label: '错误'}, {value: 'warn', label: '警告'}, {value: 'info', label: '信息'}];
const categories = [{value: 'all', label: '全部类型'}, {value: 'client', label: '客户端访问'}, {value: 'playback', label: '播放'}, {value: 'spider', label: '爬虫'}, {value: 'system', label: '系统'}];
const categoryText = entry => categories.find(item => item.value === (entry.category || 'system'))?.label || '系统';
const filtered = computed(() => logs.value.filter(entry => (level.value === 'all' || entry.level === level.value) &&
    (category.value === 'all' || (entry.category || 'system') === category.value) &&
    (!keyword.value || [entry.message, entry.source, entry.sourceName, entry.clientIp, entry.client, entry.device, entry.protocol, entry.subscription, entry.title, entry.episode, entry.requestId].join(' ').toLowerCase().includes(keyword.value.toLowerCase()))));
const sizeText = value => value < 1024 ? `${value} B` : value < 1048576 ? `${(value / 1024).toFixed(1)} KB` : `${(value / 1048576).toFixed(1)} MB`;
const timeText = value => new Intl.DateTimeFormat('zh-CN', {dateStyle: 'medium', timeStyle: 'medium'}).format(new Date(value));
const clock = value => value ? new Date(value).toLocaleTimeString('zh-CN', {hour12: false}) : '';
let logsPending = false, refreshTimer;
async function loadLogs(silent = false) {
    if (logsPending) return;
    logsPending = true;
    if (!silent) loadingLogs.value = true;
    try { logs.value = await props.api('/admin/logs?limit=400'); }
    catch (failure) { error.value = failure.message; }
    finally { loadingLogs.value = false; logsPending = false; }
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
onMounted(() => {
    refresh();
    refreshTimer = setInterval(() => { if (autoRefresh.value && tab.value === 'logs' && !document.hidden) loadLogs(true); }, 5000);
});
onUnmounted(() => clearInterval(refreshTimer));
</script>
<template>
  <div class="page-heading"><div><h1>运行维护</h1><p>查看运行日志，管理数据快照。</p></div><Button variant="outline" :disabled="loadingLogs || loadingBackups" @click="refresh"><Icon name="refresh" />刷新</Button></div>
  <Alert v-if="error" variant="destructive" class="mb-5"><AlertTitle>操作未完成</AlertTitle><AlertDescription>{{error}}</AlertDescription></Alert>
  <Tabs v-model="tab">
    <TabsList><TabsTrigger value="logs">运行日志</TabsTrigger><TabsTrigger value="backups">数据快照</TabsTrigger></TabsList>
    <TabsContent value="logs">
      <div class="maintenance-toolbar">
        <NativeSelect v-model="level" class="filter-select" aria-label="日志级别"><option v-for="item in levels" :key="item.value" :value="item.value">{{item.label}}</option></NativeSelect>
        <NativeSelect v-model="category" class="filter-select" aria-label="日志类型"><option v-for="item in categories" :key="item.value" :value="item.value">{{item.label}}</option></NativeSelect>
        <InputGroup class="w-[240px]"><InputGroupInput v-model="keyword" aria-label="过滤日志" placeholder="搜索 IP、客户端、源、影片" /><InputGroupAddon><Icon name="search" :size="16" /></InputGroupAddon></InputGroup>
        <label class="log-auto-refresh"><input v-model="autoRefresh" type="checkbox" aria-label="自动刷新日志" />自动刷新</label>
        <Button variant="outline" size="sm" @click="download('/admin/logs/download', 'coketv-logs.txt')"><Icon name="download" :size="14" />下载日志</Button>
      </div>
      <Skeleton v-if="loadingLogs" class="h-64 w-full" />
      <div v-else class="log-panel" role="log" aria-label="运行日志">
        <div v-for="(entry, index) in filtered" :key="index" class="log-line">
          <span class="log-time" :title="entry.time">{{clock(entry.time)}}</span>
          <Badge :variant="entry.level === 'error' ? 'destructive' : 'secondary'">{{entry.level || 'info'}}</Badge>
          <span class="log-source">{{categoryText(entry)}}</span>
          <div class="log-content">
            <span class="log-message">{{entry.message}}</span>
            <div v-if="entry.clientIp || entry.sourceName || entry.requestId" class="log-details">
              <span v-if="entry.clientIp">{{entry.clientIp}}</span><span v-if="entry.client">{{entry.client}}</span><span v-if="entry.device">{{entry.device}}</span>
              <span v-if="entry.sourceName || entry.source">源：{{entry.sourceName || entry.source}}</span><span v-if="entry.subscription">订阅：{{entry.subscription}}</span>
              <span v-if="entry.title">{{entry.title}} {{entry.episode || ''}}</span><span v-if="entry.requestId">请求 {{entry.requestId}}</span>
              <span v-if="entry.statuses">状态 {{Object.entries(entry.statuses).map(([status, count]) => `${status} × ${count}`).join('，')}}</span>
            </div>
          </div>
        </div>
        <p v-if="!filtered.length" class="log-empty">暂无日志</p>
      </div>
      <p class="maintenance-note">每 5 秒刷新最近 400 条；媒体和源代理请求按 30 秒汇总，错误即时记录。客户端名称来自请求标识；取链成功不代表设备已播放出画面。日志按大小轮转，隐藏令牌与授权头。</p>
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
.log-content{min-width:0;flex:1}
.log-details{display:flex;gap:4px 12px;flex-wrap:wrap;margin-top:3px;color:var(--muted-foreground);font-size:11px;overflow-wrap:anywhere}
.log-auto-refresh{display:flex;gap:6px;align-items:center;font-size:12px;cursor:pointer}
.log-empty{padding:36px;text-align:center;color:var(--muted-foreground)}
.maintenance-note{margin-top:14px;font-size:12px;line-height:1.75;color:var(--muted-foreground)}
.maintenance-note code{font-size:11px}
</style>
