<script>
import {ref, computed, onMounted, onBeforeUnmount, defineAsyncComponent} from 'vue';
import Icon from './Icon.vue';
import SubscriptionPicker from './SubscriptionPicker.vue';
import AppNavigation from './AppNavigation.vue';
import {engineLabels, languageLabels, engineLanguage} from './engine-labels.js';
import {Toaster, toast} from 'vue-sonner';
const SourceWorkspace=defineAsyncComponent(()=>import('./SourceWorkspace.vue'));
const WatchApp=defineAsyncComponent(()=>import('./WatchApp.vue'));
const SourceImport=defineAsyncComponent(()=>import('./SourceImport.vue'));

export default {
    components: {SourceWorkspace, WatchApp, SourceImport, Icon, SubscriptionPicker, Toaster, AppNavigation},
    setup() {
        const workspaceSource = ref(null);
        const isAdminPath = () => location.pathname === '/admin' || /^\/sources\/[^/]+\/edit$/.test(location.pathname);
        const watching = ref(!isAdminPath());
        const publicSources = ref(null), watchLoading = ref(false), watchError = ref('');
        async function openWatch() { history.pushState({}, '', '/'); watching.value = true; await loadWatch(); }
        async function closeWatch() { history.pushState({}, '', '/admin'); workspaceSource.value = null; page.value = 'sources'; watching.value = false; await loadAdminAccess(); }
        async function syncWatch() {
            watching.value = !isAdminPath();
            if (watching.value) await loadWatch(); else await loadAdminAccess();
        }
        const state = ref(null), page = ref('sources'), query = ref(''), engine = ref('all'), selected = ref([]), currentPage = ref(1);
        const auth = ref(sessionStorage.getItem('coketv-access') || ''), login = ref({password: ''}), loginError = ref('');
        const requiresSetup = ref(false), accessLoading = ref(true), newPassword = ref(''), confirmPassword = ref(''), setupCode = ref('');
        const busy = ref(false), notices = ref([]), modal = ref(null), form = ref({}), dependencies = ref(null);
        const pageSize=ref(20);
        const confirming = ref(null), settings = ref({}), importFile = ref(null), targetAllowlistText = ref('');
        const labels = engineLabels;
        const notify=(message,error=false)=>error?toast.error(message):toast.success(message);
        async function watchApi(url, body) {
            const response = await fetch(url, {method: body === undefined ? 'GET' : 'POST', credentials: 'omit', headers: body === undefined ? {} : {'Content-Type': 'application/json'}, body: body === undefined ? undefined : JSON.stringify(body)});
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || '请求失败');
            return data;
        }
        async function loadWatch() {
            watchLoading.value = true; watchError.value = '';
            try { publicSources.value = await watchApi('/watch/sources'); }
            catch (error) { watchError.value = error.message; }
            finally { watchLoading.value = false; }
        }
        async function api(url, body, method = body === undefined ? 'GET' : 'POST') {
            const response = await fetch(url, {method, headers: {Authorization: `Basic ${auth.value}`, ...(body && !(body instanceof FormData) ? {'Content-Type': 'application/json'} : {})}, body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body)});
            const data = await response.json();
            if (!response.ok) { if (response.status === 401 || data.code === 'ACCESS_SETUP_REQUIRED') { auth.value = ''; state.value = null; sessionStorage.removeItem('coketv-access'); } if (data.code === 'ACCESS_SETUP_REQUIRED') requiresSetup.value = true; throw Object.assign(new Error(data.error || '请求失败'), {code: data.code}); }
            return data;
        }
        async function load() {
            state.value = await api('/admin/state');
            settings.value = {...state.value.settings, timeout: state.value.settings.timeout / 1000,
                jsonPublic: state.value.settings.jsonPublic === true,
                allowPrivateTargets: state.value.settings.allowPrivateTargets !== false,
                envText: JSON.stringify(state.value.settings.env, null, 2), pluginsText: JSON.stringify(state.value.settings.plugins, null, 2),
                parsesText: JSON.stringify(state.value.settings.parses, null, 2), livesText: JSON.stringify(state.value.settings.lives, null, 2)};
            targetAllowlistText.value = (state.value.settings.targetAllowlist || []).join('\n');
        }
        async function action(fn, message) {
            if (busy.value) return; busy.value = true;
            try { await fn(); if (message) notify(message); } catch (error) { notify(error.message, true); } finally { busy.value = false; }
        }
        async function signIn() {
            if (busy.value) return; busy.value = true;
            auth.value = btoa(unescape(encodeURIComponent(`:${login.value.password}`))); loginError.value = '';
            try { await load(); sessionStorage.setItem('coketv-access', auth.value); login.value.password = ''; const id=location.pathname.match(/^\/sources\/([^/]+)\/edit$/)?.[1]; const source=sources.value.find(s=>s.id===id); if(source){workspaceSource.value=source;page.value='workspace';} }
            catch (error) { loginError.value = error.message; auth.value = ''; } finally { busy.value = false; }
        }
        async function createPassword() {
            if (busy.value) return;
            loginError.value = '';
            if (newPassword.value !== confirmPassword.value) {loginError.value='两次输入的密码不一致';return;}
            busy.value = true;
            try {
                auth.value = '';
                await api('/admin/access/setup', {password: newPassword.value, confirmPassword: confirmPassword.value, setupCode: setupCode.value});
                requiresSetup.value = false;
                auth.value = btoa(unescape(encodeURIComponent(`:${newPassword.value}`)));
                newPassword.value = ''; confirmPassword.value = ''; setupCode.value = '';
                await load(); sessionStorage.setItem('coketv-access', auth.value);
                const id=location.pathname.match(/^\/sources\/([^/]+)\/edit$/)?.[1];const source=sources.value.find(s=>s.id===id);if(source){workspaceSource.value=source;page.value='workspace';}
            } catch(error) {loginError.value=error.message;auth.value='';} finally {busy.value=false;}
        }
        const sources = computed(() => (state.value?.instances || []).map(instance => ({...instance, script: state.value.scripts.find(s => s.id === instance.scriptId)})));
        const filtered = computed(() => sources.value.filter(source => (engine.value === 'all' || engineLanguage(source.script?.engine) === engine.value) &&
            `${source.name} ${source.script?.file}`.toLowerCase().includes(query.value.toLowerCase())));
        const totalPages = computed(() => Math.max(1, Math.ceil(filtered.value.length / pageSize.value)));
        const visible = computed(() => filtered.value.slice((Math.min(currentPage.value, totalPages.value) - 1) * pageSize.value, Math.min(currentPage.value, totalPages.value) * pageSize.value));
        const enabledCount = computed(() => sources.value.filter(s => s.enabled).length);
        function toggle(id) { selected.value = selected.value.includes(id) ? selected.value.filter(s => s !== id) : [...selected.value, id]; }
        function selectVisible() { const all = visible.value.every(s => selected.value.includes(s.id)); for (const source of visible.value) if (all ? selected.value.includes(source.id) : !selected.value.includes(source.id)) toggle(source.id); }
        async function switchSource(source) { await api(`/admin/instances/${source.id}`, {...source, enabled: !source.enabled}, 'PUT'); await load(); }
        async function batch(enabled) { await api('/admin/instances/batch', {ids: selected.value, enabled}); selected.value = []; await load(); }
        function removeSelected() {
            const ids = [...selected.value];
            if (!ids.length || busy.value) return;
            confirm('删除所选源', `将删除选中的 ${ids.length} 个源实例，并移除所有订阅中的引用。脚本文件保留，可重新创建实例。`, async () => {
                await api('/admin/instances/batch', {ids}, 'DELETE');
                selected.value = []; await load();
            }, '删除');
        }
        function editInstance() { form.value = {name: '', scriptId: state.value.scripts[0]?.id || '', params: '', enabled: true, searchable: true, filterable: false}; modal.value = 'instance'; }
        function renameSource(source) { form.value = {id: source.id, name: source.name}; modal.value = 'rename'; }
        async function saveName() {
            const current = (await api('/admin/state')).instances.find(item => item.id === form.value.id);
            if (!current) throw new Error('源已不存在，请刷新列表');
            await api(`/admin/instances/${current.id}`, {...current, name: form.value.name}, 'PUT');
            await load(); modal.value = null;
        }
        async function saveInstance() {
            const current = form.value.id ? (await api('/admin/state')).instances.find(item => item.id === form.value.id) : form.value;
            if (!current) throw new Error('源已不存在，请刷新列表');
            const value = {...current, name: form.value.name};
            await api(form.value.id ? `/admin/instances/${form.value.id}` : '/admin/instances', value, form.value.id ? 'PUT' : 'POST'); await load(); modal.value = null;
        }
        async function editScript(source) {
            workspaceSource.value = source; page.value = 'workspace';
            history.pushState({}, '', `/sources/${source.id}/edit`);
        }
        function closeWorkspace() { workspaceSource.value = null; page.value = 'sources'; history.replaceState({}, '', '/admin'); }
        function newScript() { form.value = {type: 'js', name: ''}; modal.value = 'editor'; }
        async function saveScript() {
            const name = form.value.name.trim().replace(/\.(js|py|php)$/i, '');
            if (!name) throw new Error('请填写脚本名');
            const script = await api('/admin/scripts/create', {type: form.value.type, name});
            await load();
            const source = sources.value.find(item => item.scriptId === script.id);
            if (!source) throw new Error('源已创建，请刷新列表后进入编辑');
            modal.value = null; await editScript(source);
        }
        function requestFile() { document.getElementById('source-upload').click(); }
        function openSourceImport() { modal.value = 'sourceImport'; }
        async function tvboxImported() { try { await load(); } catch (error) { notify(error.message, true); } }
        async function importSelected(engine='auto') {
            const data = new FormData(); data.append('engine', engine); data.append('file', importFile.value);
            try { await api('/admin/upload', data); }
            catch (error) {
                if (error.code === 'IMPORT_ENGINE_REQUIRED') { form.value={engine:'js'};modal.value='import';return; }
                throw error;
            }
            await load();importFile.value=null;modal.value=null;notify('文件已导入');
        }
        async function upload(event) {
            const file=event.target.files[0];event.target.value='';if(!file)return;
            modal.value = null;
            importFile.value=file;await action(()=>importSelected());
        }
        function confirm(title, message, callback, actionLabel = '确认操作') { confirming.value = {title, message, callback, actionLabel}; }
        async function acceptConfirm() { const item = confirming.value; if (!item || busy.value) return; confirming.value = null; await action(item.callback, '操作已完成'); }
        function removeSource(source) { confirm('移除站点实例', `将“${source.name}”从所有订阅中移除。对应脚本仍保留，可重新创建实例。`, async () => { await api(`/admin/instances/${source.id}`, undefined, 'DELETE'); await load(); }); }
        function openLinks(sub) { form.value={...sub}; modal.value='links'; }
        async function switchCapability(source,key) {await api(`/admin/instances/${source.id}`, {...source,[key]:!source[key]},'PUT');await load();}
        function openSubscription(sub) { form.value = sub ? {...sub, instances: [...sub.instances]} : {name: '', description:'',enabled: true, instances: []}; modal.value = 'subscription'; }
        async function saveSubscription() { await api(form.value.id ? `/admin/subscriptions/${form.value.id}` : '/admin/subscriptions', form.value, form.value.id ? 'PUT' : 'POST'); await load(); modal.value = null; }
        const subscriptionUrl = sub => `${state.value.settings.publicUrl || state.value.baseUrl}/subscription/${sub.id}?token=${sub.token}`;
        async function copy(text) { try { await navigator.clipboard.writeText(text); notify('已复制'); } catch { form.value = {title: '复制链接', content: text}; modal.value = 'text'; } }
        async function preview(sub) { form.value = {title: `${sub.name} · TVBox 配置`, content: JSON.stringify(await api(`/admin/subscriptions/${sub.id}/preview`), null, 2)}; modal.value = 'text'; }
        function deleteSub(sub) { confirm('删除订阅', `删除“${sub.name}”后，原订阅链接将失效，源脚本与站点实例不受影响。`, async () => { await api(`/admin/subscriptions/${sub.id}`, undefined, 'DELETE'); await load(); }); }
        function resetToken(sub) { confirm('重置订阅链接', '重置后需要在 TVBox 中更新订阅链接。', async () => { await api(`/admin/subscriptions/${sub.id}/token`, {}); await load(); }); }
        async function saveSettings() {
            const value = {...settings.value, timeout: Number(settings.value.timeout) * 1000, env: JSON.parse(settings.value.envText), plugins: JSON.parse(settings.value.pluginsText), parses: JSON.parse(settings.value.parsesText), lives: JSON.parse(settings.value.livesText), jsonPublic: settings.value.jsonPublic === true, allowPrivateTargets: settings.value.allowPrivateTargets !== false, targetAllowlist: targetAllowlistText.value.split(/[\s,]+/).filter(Boolean)};
            delete value.targetAllowlistText;
            await api('/admin/settings', value, 'PUT'); await load();
        }
        async function checkDependencies() { dependencies.value = await api('/admin/dependencies'); }
        async function exportConfig() { const value = await api('/admin/export'); const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], {type: 'application/json'})); link.download = 'coketv-config.json'; link.click(); URL.revokeObjectURL(link.href); }
        async function importConfig(event) {
            const file = event.target.files[0]; if (!file) return;
            try {
                const value = JSON.parse(await file.text());
                confirm('导入管理配置', '将替换站点实例和订阅。源脚本须已存在，解释器路径等运行设置继续使用当前值。', async () => { await api('/admin/import', value); await load(); });
            } catch (error) { notify(error.message, true); }
            event.target.value = '';
        }
        async function scan() { await api('/admin/scan', {}); await load(); }
        function logout() { auth.value = ''; state.value = null; sessionStorage.removeItem('coketv-access'); }
        const modalTitle=computed(()=>modal.value==='sourceImport'?'导入源':modal.value==='import'?'选择 JS 运行格式':modal.value==='rename'?'重命名源':modal.value==='links'?'订阅地址':modal.value==='instance'?(form.value.id?'编辑源':'新建源实例'):modal.value==='editor'?'添加源':modal.value==='subscription'?(form.value.id?'配置订阅':'新建订阅'):form.value.title || '');
        async function loadAdminAccess() {
            accessLoading.value = true; loginError.value = '';
            try { const access = await api('/access/status'); requiresSetup.value=access.requiresSetup; }
            catch(error){loginError.value=error.message;}
            finally {accessLoading.value=false;}
            if(requiresSetup.value){auth.value='';sessionStorage.removeItem('coketv-access');return;}
            if (auth.value) await action(load);
            const id = location.pathname.match(/^\/sources\/([^/]+)\/edit$/)?.[1]; if (id && state.value) { const source = sources.value.find(s => s.id === id); if (source) {workspaceSource.value=source; page.value='workspace';} }
        }
        onMounted(async () => { window.addEventListener('popstate', syncWatch); await syncWatch(); });
        onBeforeUnmount(() => window.removeEventListener('popstate', syncWatch));
        return {removeSelected,openSourceImport,tvboxImported,publicSources,watchLoading,watchError,watchApi,loadWatch,watching,openWatch,closeWatch,requiresSetup,accessLoading,newPassword,confirmPassword,setupCode,createPassword,requestFile,languageLabels,engineLanguage,renameSource,saveName,importSelected,importFile,pageSize,openLinks,switchCapability,modalTitle, workspaceSource, closeWorkspace, api, state, page, query, engine, selected, currentPage, totalPages, visible, filtered, sources, enabledCount, auth, login, loginError, busy, notices, modal, form, dependencies, confirming, settings, labels,
            action, signIn, toggle, selectVisible, switchSource, batch, editInstance, saveInstance, editScript, newScript, saveScript, upload, removeSource, openSubscription, saveSubscription, subscriptionUrl, copy, preview, deleteSub, resetToken, saveSettings, checkDependencies, exportConfig, importConfig, logout, acceptConfirm, load, scan, targetAllowlistText};
    }
};
</script>
<template>
  <Toaster rich-colors position="bottom-right" />
  <WatchApp v-if="watching && publicSources" :sources="publicSources" :api="watchApi" @close="closeWatch" />
  <div v-else-if="watching" class="login-layout"><Alert v-if="watchError"><AlertTitle>观影页面加载失败</AlertTitle><AlertDescription>{{watchError}}<Button variant="outline" size="sm" :disabled="watchLoading" @click="loadWatch">重试</Button><Button variant="ghost" size="sm" @click="closeWatch">管理后台</Button></AlertDescription></Alert><Skeleton v-else class="h-52 w-80" /></div>
  <div v-else-if="accessLoading" class="login-layout"><Skeleton class="h-52 w-80" /></div>
  <div v-else-if="requiresSetup" class="login-layout"><section class="login-form-area"><form class="login-form" @submit.prevent="createPassword"><div><h2>CokeTV 管理后台</h2><p>首次进入管理后台，请填写初始化码并创建访问密码。</p></div><FieldGroup><Field><FieldLabel for="setup-code">初始化码</FieldLabel><Input id="setup-code" v-model="setupCode" type="text" autocomplete="one-time-code" :disabled="busy" required autofocus /><p class="text-muted-foreground text-sm">见服务启动日志或 data/setup-code.txt</p></Field><Field><FieldLabel for="new-password">新密码</FieldLabel><Input id="new-password" v-model="newPassword" type="password" autocomplete="new-password" minlength="6" maxlength="200" :disabled="busy" required autofocus /></Field><Field :data-invalid="!!loginError"><FieldLabel for="confirm-password">确认密码</FieldLabel><Input id="confirm-password" v-model="confirmPassword" type="password" autocomplete="new-password" :disabled="busy" :aria-invalid="!!loginError" required /><FieldError v-if="loginError">{{loginError}}</FieldError></Field></FieldGroup><Button type="submit" :disabled="busy">{{busy?'创建中…':'创建并进入'}}</Button><Button type="button" variant="ghost" @click="openWatch">返回观影</Button></form></section></div>
  <div v-else-if="!auth || !state" class="login-layout">
    <section class="login-form-area"><form class="login-form" @submit.prevent="signIn"><h2>CokeTV 管理后台</h2><FieldGroup><Field :data-invalid="!!loginError"><FieldLabel for="login-password">访问密码</FieldLabel><Input id="login-password" v-model="login.password" type="password" autocomplete="current-password" :aria-invalid="!!loginError" :disabled="busy" required autofocus /><FieldError v-if="loginError">{{loginError}}</FieldError></Field></FieldGroup><Button type="submit" :disabled="busy">{{busy?'验证中…':'进入'}}</Button><Button type="button" variant="ghost" @click="openWatch">返回观影</Button></form></section>
  </div>
  <SourceWorkspace v-else-if="page==='workspace' && workspaceSource" :key="workspaceSource.id" :source="workspaceSource" :sources="sources" :api="api" @close="closeWorkspace" @saved="action(load)" />
  <SidebarProvider v-else>
    <Sidebar collapsible="icon">
      <SidebarHeader><a class="brand-lockup" href="/admin" @click.prevent="page='sources'"><span class="brand-mark"><Icon name="layers" /></span><div class="group-data-[collapsible=icon]:hidden"><strong>CokeTV</strong><small>v0.1.0</small></div></a></SidebarHeader>
      <SidebarContent><AppNavigation :page="page" :sources="sources.length" :subscriptions="state.subscriptions.length" @navigate="page=$event" @watch="openWatch" /></SidebarContent>
<SidebarRail />
    </Sidebar>
    <SidebarInset>
      <header class="console-header"><div class="console-header-title"><SidebarTrigger /><Separator orientation="vertical" class="h-16" /><strong>管理后台</strong></div><div class="console-header-actions"><Button variant="ghost" size="icon" aria-label="网页观影" title="网页观影" @click="openWatch"><Icon name="monitor" :size="16" /></Button><Button variant="ghost" size="icon" aria-label="退出" title="退出" @click="logout"><Icon name="logout" :size="18" /></Button></div></header>
      <main class="console-main">
        <template v-if="page==='sources'">
          <h1 class="sr-only">源管理</h1>
          <div class="data-toolbar">
            <InputGroup class="w-[240px]"><InputGroupInput v-model="query" aria-label="搜索源" placeholder="按名称搜索" @update:model-value="currentPage=1" /><InputGroupAddon><Icon name="search" :size="16" /></InputGroupAddon></InputGroup>
            <NativeSelect v-model="engine" class="filter-select" aria-label="类型筛选" @update:model-value="currentPage=1"><option value="all">全部</option><option v-for="(label,key) in languageLabels" :key="key" :value="key">{{label}}</option></NativeSelect>
            <Button size="sm" class="px-3!" @click="newScript"><Icon name="plus" />添加源</Button>
            <Button variant="outline" size="sm" :disabled="busy" @click="openSourceImport"><Icon name="upload" />导入</Button><input id="source-upload" class="sr-only" type="file" accept=".js,.py,.php,.zip" @change="upload" />
          </div>
          <div v-if="selected.length" class="selection-tools"><span>已选择 {{selected.length}} 个源</span><Button variant="outline" size="sm" :disabled="busy" @click="action(()=>batch(true),'已启用')">启用</Button><Button variant="outline" size="sm" :disabled="busy" @click="action(()=>batch(false),'已停用')">停用</Button><Button variant="destructive" size="sm" :disabled="busy" @click="removeSelected"><Icon name="trash" data-icon="inline-start" />删除</Button><Button variant="ghost" size="sm" :disabled="busy" @click="selected=[]">取消选择</Button></div>
          <div class="source-table"><Table><TableHeader><TableRow>
            <TableHead class="select-column"><Checkbox :model-value="visible.length>0&&visible.every(s=>selected.includes(s.id))" aria-label="选择当前页" @update:model-value="selectVisible" /></TableHead><TableHead class="name-column">名称</TableHead><TableHead class="engine-column">类型</TableHead><TableHead class="state-column">状态</TableHead><TableHead class="capability-column">搜索</TableHead><TableHead class="capability-column">筛选</TableHead><TableHead class="action-column">操作</TableHead>
          </TableRow></TableHeader><TableBody><TableRow v-for="source in visible" :key="source.id" :data-state="selected.includes(source.id)?'selected':undefined">
            <TableCell><Checkbox :model-value="selected.includes(source.id)" :aria-label="'选择'+source.name" @update:model-value="toggle(source.id)" /></TableCell>
            <TableCell><div class="source-name"><button class="source-title-button" :title="'单击重命名 · '+source.script?.file" @click="renameSource(source)">{{source.name}}</button></div></TableCell>
            <TableCell><Badge variant="default" class="engine-badge">{{languageLabels[engineLanguage(source.script?.engine)]}}</Badge></TableCell>
            <TableCell><Switch :model-value="source.enabled" :aria-label="(source.enabled?'停用':'启用')+source.name" :disabled="busy" @update:model-value="action(()=>switchSource(source))" /></TableCell>
            <TableCell><Button variant="outline" size="xs" :aria-label="'切换搜索能力'+source.name" :disabled="busy" @click="action(()=>switchCapability(source,'searchable'))">{{source.searchable?'是':'否'}}</Button></TableCell>
            <TableCell><Button variant="outline" size="xs" :aria-label="'切换筛选能力'+source.name" :disabled="busy" @click="action(()=>switchCapability(source,'filterable'))">{{source.filterable?'是':'否'}}</Button></TableCell>
            <TableCell><div class="row-actions"><Button variant="ghost" size="icon-sm" aria-label="编辑" title="编辑脚本" @click="action(()=>editScript(source))"><Icon name="code" :size="16" /></Button><Button variant="ghost" size="icon-sm" aria-label="移除站点" title="移除站点" @click="removeSource(source)"><Icon name="trash" :size="16" /></Button></div></TableCell>
          </TableRow><TableRow v-if="!visible.length"><TableCell colspan="7"><Empty><EmptyHeader><EmptyMedia variant="icon"><Icon name="search" /></EmptyMedia><EmptyTitle>没有匹配的源</EmptyTitle><EmptyDescription>调整筛选条件，或导入一个脚本。</EmptyDescription></EmptyHeader></Empty></TableCell></TableRow></TableBody></Table></div>
          <footer class="table-foot"><span>共 {{filtered.length}} 条<span class="source-totals"> · {{state.scripts.length}} 个脚本 · {{enabledCount}} 个启用</span></span><div class="pagination"><NativeSelect v-model.number="pageSize" aria-label="每页条数" @update:model-value="currentPage=1"><option :value="20">20 条/页</option><option :value="50">50 条/页</option><option :value="100">100 条/页</option></NativeSelect><Button variant="ghost" size="icon-sm" aria-label="上一页" :disabled="currentPage<=1" @click="currentPage--"><Icon name="left" /></Button><Button v-for="n in totalPages" :key="n" v-show="Math.abs(n-currentPage)<3||n===1||n===totalPages" :variant="n===currentPage?'default':'ghost'" size="icon-sm" :aria-label="'第'+n+'页'" @click="currentPage=n">{{n}}</Button><Button variant="ghost" size="icon-sm" aria-label="下一页" :disabled="currentPage>=totalPages" @click="currentPage++"><Icon name="right" /></Button></div></footer>
        </template>
        <template v-else-if="page==='subscriptions'">
          <h1 class="sr-only">订阅管理</h1><div class="subscription-toolbar"><Button size="sm" @click="openSubscription()"><Icon name="plus" />新建订阅</Button></div>
          <div class="subscription-grid"><article v-for="sub in state.subscriptions" :key="sub.id" class="subscription-item"><Button variant="ghost" size="icon-xs" class="subscription-delete" aria-label="删除订阅" @click="deleteSub(sub)"><Icon name="x" :size="14" /></Button><div class="subscription-heading"><span class="subscription-symbol">{{sub.name.slice(0,1)}}</span><div><h2>{{sub.name}}</h2><p v-if="sub.description">{{sub.description}}</p></div></div><div class="subscription-actions"><Icon name="rss" :size="14" /><Badge variant="secondary">订阅 · {{sub.instances.length}} 源</Badge><span v-if="!sub.enabled" class="text-xs text-muted-foreground">停用</span><div class="subscription-buttons"><Button variant="ghost" size="icon-xs" aria-label="配置订阅" title="编辑" @click="openSubscription(sub)"><Icon name="edit" :size="16" /></Button><Button variant="ghost" size="icon-xs" aria-label="订阅链接" title="订阅链接" @click="openLinks(sub)"><Icon name="link" :size="16" /></Button></div></div></article></div>
          <Empty v-if="!state.subscriptions.length"><EmptyHeader><EmptyMedia variant="icon"><Icon name="radio" /></EmptyMedia><EmptyTitle>创建第一个订阅</EmptyTitle><EmptyDescription>选好源，将订阅链接填入 TVBox。</EmptyDescription></EmptyHeader><EmptyContent><Button @click="openSubscription()">新建订阅</Button></EmptyContent></Empty>
        </template>
        <template v-else-if="page==='settings'">
          <div class="page-heading"><div><h1>设置</h1><p>服务连接、运行环境与共享默认配置。</p></div><Button :disabled="busy" @click="action(saveSettings,'设置已保存')"><Icon name="save" data-icon="inline-start" />保存设置</Button></div>
          <div class="settings-layout"><section class="settings-section"><h2>连接与运行</h2><p class="section-description">配置服务器可达地址，以及源需要的运行环境。</p><FieldGroup><Field><FieldLabel for="public-url">服务对外地址</FieldLabel><Input id="public-url" v-model="settings.publicUrl" placeholder="https://drpy.example.com" /><FieldDescription>留空使用当前地址；电视访问时填写服务器可达地址。</FieldDescription></Field><Field><FieldLabel for="timeout">执行超时（秒）</FieldLabel><Input id="timeout" v-model.number="settings.timeout" type="number" min="1" max="300" /></Field><Field><FieldLabel for="python-path">Python 解释器</FieldLabel><Input id="python-path" v-model="settings.pythonPath" /></Field><Field><FieldLabel for="php-path">PHP 解释器</FieldLabel><Input id="php-path" v-model="settings.phpPath" /></Field><Field><FieldLabel for="browser-path">Chrome / Chromium 路径</FieldLabel><Input id="browser-path" v-model="settings.browserPath" placeholder="按源需要配置，可留空" /></Field><div class="flex gap-2 flex-wrap"><Button variant="outline" size="sm" @click="action(checkDependencies)">检测环境</Button><Button variant="outline" size="sm" @click="editInstance()">新建实例</Button><Button variant="outline" size="sm" :disabled="busy" @click="action(scan,'扫描完成')">扫描源目录</Button><Button variant="outline" size="sm" @click="action(exportConfig)">导出配置</Button><Button variant="outline" size="sm" as-child><label>导入配置<input class="sr-only" type="file" accept=".json" @change="importConfig" /></label></Button></div></FieldGroup><div v-if="dependencies" class="dependency-results"><div v-for="key in ['node','python','php']" :key="key"><Icon :name="dependencies[key].ok?'success':'error'" :size="15" /><strong>{{key}}</strong><span>{{dependencies[key].ok?dependencies[key].version:dependencies[key].error}}</span></div></div></section>
          <section class="settings-section"><h2>代理与参数安全</h2><p class="section-description">媒体代理出口与 /json/ 参数文件的访问策略。公网部署建议关闭内网目标并保持参数文件私有。</p><FieldGroup><Field orientation="horizontal"><Checkbox id="allow-private-targets" v-model="settings.allowPrivateTargets" /><FieldLabel for="allow-private-targets">允许媒体代理访问内网地址</FieldLabel></Field><FieldDescription>家庭访问 NAS/内网媒体需要开启；公网部署建议关闭。云元数据地址（169.254.169.254 等）无论设置如何都拒绝。</FieldDescription><Field orientation="horizontal"><Checkbox id="json-public" v-model="settings.jsonPublic" /><FieldLabel for="json-public">允许匿名读取 /json/ 参数文件</FieldLabel></Field><FieldDescription>参数文件可能含 Cookie/Token；默认仅管理员、订阅 Token 与源内部请求可读。</FieldDescription><Field><FieldLabel for="target-allowlist">代理目标白名单</FieldLabel><Textarea id="target-allowlist" v-model="targetAllowlistText" rows="4" placeholder="每行一个 host 或 CIDR，例如 192.168.1.10、10.0.0.0/8" spellcheck="false" /><FieldDescription>留空表示不限制；非空时只允许名单内的目标地址。</FieldDescription></Field></FieldGroup></section>
          <section class="settings-section"><h2>全局默认环境变量</h2><p class="section-description">专属 Cookie 与 Token 请在源编辑页配置。这里只填写需要共用的默认值。</p><FieldGroup><Field><FieldLabel for="default-env">默认 ENV · JSON 对象</FieldLabel><Textarea id="default-env" v-model="settings.envText" rows="16" class="json-input" spellcheck="false" /><FieldDescription>本源配置优先；未配置的键继承这些默认值。</FieldDescription></Field></FieldGroup></section>
          <section class="settings-section settings-wide"><h2>订阅扩展与辅助插件</h2><p class="section-description">保留源需要的解析器、直播和外部服务配置。</p><FieldGroup><Field><FieldLabel for="parses">解析器 · JSON 数组</FieldLabel><Textarea id="parses" v-model="settings.parsesText" rows="5" class="json-input" /></Field><Field><FieldLabel for="lives">直播配置 · JSON 数组</FieldLabel><Textarea id="lives" v-model="settings.livesText" rows="5" class="json-input" /></Field><Field><FieldLabel for="plugins">外部插件 · JSON 数组</FieldLabel><Textarea id="plugins" v-model="settings.pluginsText" rows="5" class="json-input" /></Field></FieldGroup></section></div>
        </template>
      </main>
    </SidebarInset>
  </SidebarProvider>
  <Dialog :open="!!modal" @update:open="!$event&&!busy&&(modal=null)"><DialogContent :class="[modal==='sourceImport'?'tvbox-import-dialog sm:max-w-[860px]':modal==='subscription'?'subscription-dialog sm:max-w-[768px]':modal==='instance'?'sm:max-w-[672px]':['text'].includes(modal)?'sm:max-w-[960px]':'sm:max-w-[512px]']" :show-close-button="!busy"><DialogHeader><DialogTitle>{{modalTitle}}</DialogTitle><DialogDescription class="sr-only">{{modal==='sourceImport'?'导入 TVBox 配置链接或本地脚本源包。':modal==='import'?'此文件无法自动判断运行格式，选择后继续导入。':modal==='rename'?'只修改显示名称，脚本文件与源配置保持不变。':modal==='subscription'?'选择站点并排列顺序，保存后更新订阅。':modal==='editor'?'选择类型、填写脚本名，保存后进入编辑页面。':modal==='instance'?'创建使用已有脚本的源实例。':'查看并复制配置内容。'}}</DialogDescription></DialogHeader><div class="dialog-scroll">
    <SourceImport v-if="modal==='sourceImport'" :api="api" @file="requestFile" @busy="busy=$event" @imported="tvboxImported" @close="modal=null" />
    <form v-else-if="modal==='import'" @submit.prevent="action(()=>importSelected(form.engine))"><FieldGroup><Field><FieldLabel for="import-engine">运行格式</FieldLabel><NativeSelect id="import-engine" v-model="form.engine"><option value="js">JS · drpyS</option><option value="dr2">JS · DR2</option><option value="cat">JS · CatVod</option></NativeSelect></Field></FieldGroup><DialogFooter class="mt-6"><Button type="button" variant="outline" @click="modal=null;importFile=null">取消</Button><Button type="submit" :disabled="busy">导入</Button></DialogFooter></form>
    <form v-else-if="modal==='rename'" @submit.prevent="action(saveName,'名称已更新')"><FieldGroup><Field><FieldLabel for="source-name">名称</FieldLabel><Input id="source-name" v-model="form.name" required maxlength="200" /></Field></FieldGroup><DialogFooter class="mt-6"><Button type="button" variant="outline" @click="modal=null">取消</Button><Button type="submit" :disabled="busy">{{busy?'保存中…':'保存名称'}}</Button></DialogFooter></form>
    <form v-else-if="modal==='instance'" @submit.prevent="action(saveInstance,'站点已保存')"><FieldGroup><Field><FieldLabel for="instance-name">显示名称</FieldLabel><Input id="instance-name" v-model="form.name" required /></Field><Field v-if="!form.id"><FieldLabel for="instance-script">源脚本</FieldLabel><NativeSelect id="instance-script" v-model="form.scriptId" class="w-full"><option v-for="script in state.scripts" :key="script.id" :value="script.id">{{labels[script.engine]}} · {{script.file}}</option></NativeSelect></Field></FieldGroup><DialogFooter class="mt-6"><Button type="button" variant="outline" @click="modal=null">取消</Button><Button type="submit" :disabled="busy">{{busy?'保存中…':'保存站点'}}</Button></DialogFooter></form>
    <form v-else-if="modal==='editor'" @submit.prevent="action(saveScript,'源已创建')"><FieldGroup><Field><FieldLabel for="new-type">类型</FieldLabel><NativeSelect id="new-type" v-model="form.type"><option value="js">JS</option><option value="py">Python</option><option value="php">PHP</option></NativeSelect></Field><Field><FieldLabel for="new-name">脚本名</FieldLabel><Input id="new-name" v-model="form.name" required maxlength="176" placeholder="例如：我的影视源" /></Field></FieldGroup><DialogFooter class="mt-6"><Button type="button" variant="outline" @click="modal=null">取消</Button><Button type="submit" :disabled="busy">{{busy?'创建中…':'保存'}}</Button></DialogFooter></form>
    <form id="subscription-form" v-else-if="modal==='subscription'" @submit.prevent="action(saveSubscription,'订阅已保存')"><FieldGroup class="gap-4"><Field><FieldLabel for="subscription-name">订阅名称</FieldLabel><Input id="subscription-name" v-model="form.name" placeholder="订阅名称" required /></Field><Field><FieldLabel for="subscription-description">描述</FieldLabel><Textarea id="subscription-description" v-model="form.description" rows="2" placeholder="订阅描述信息" /></Field><Field v-if="form.token"><FieldLabel for="subscription-token">访问令牌</FieldLabel><Input id="subscription-token" :model-value="form.token" readonly /><FieldDescription>订阅地址携带此令牌。重置后需要在 TVBox 更新链接。</FieldDescription></Field><Field orientation="horizontal"><Checkbox id="subscription-enabled" v-model="form.enabled" /><FieldLabel for="subscription-enabled">启用订阅</FieldLabel></Field><SubscriptionPicker :sources="sources" v-model="form.instances" /></FieldGroup></form>
    <div v-else-if="modal==='links'" class="subscription-address"><Tabs default-value="tvbox"><TabsList class="w-full"><TabsTrigger value="tvbox" class="flex-1"><Icon name="monitor" :size="16" />TVBox</TabsTrigger></TabsList><TabsContent value="tvbox"><FieldGroup class="gap-4 mt-5"><Field><FieldLabel>影视 / TVBox</FieldLabel><div class="subscription-link"><Input :model-value="subscriptionUrl(form)" readonly aria-label="订阅链接" /><Button variant="secondary" size="icon" aria-label="复制订阅链接" @click="copy(subscriptionUrl(form))"><Icon name="copy" /></Button></div></Field></FieldGroup><div class="flex gap-2 mt-4"><Button variant="outline" size="sm" @click="action(()=>preview(form))"><Icon name="braces" />预览配置</Button><Button variant="outline" size="sm" @click="resetToken(form)">重置链接</Button></div></TabsContent></Tabs></div>
    <div v-else-if="modal==='text'"><pre class="result-code">{{form.content}}</pre><DialogFooter class="mt-4"><Button variant="outline" @click="copy(form.content)">复制内容</Button><Button @click="modal=null">完成</Button></DialogFooter></div>
  </div><DialogFooter v-if="modal==='subscription'"><span class="dialog-footer-note">已选择 {{form.instances.length}} 个源</span><Button type="button" variant="outline" @click="modal=null">取消</Button><Button type="submit" form="subscription-form" :disabled="busy">保存订阅</Button></DialogFooter></DialogContent></Dialog>
  <AlertDialog :open="!!confirming" @update:open="!$event&&(confirming=null)"><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{{confirming?.title}}</AlertDialogTitle><AlertDialogDescription>{{confirming?.message}}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel @click="confirming=null">取消</AlertDialogCancel><AlertDialogAction as-child><Button :variant="confirming?.actionLabel==='删除'?'destructive':'default'" @click.capture="acceptConfirm">{{confirming?.actionLabel||'确认操作'}}</Button></AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
</template>
