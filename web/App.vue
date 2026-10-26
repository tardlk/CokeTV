<script>
import {ref, computed, onMounted, onBeforeUnmount, defineAsyncComponent} from 'vue';
import Icon from './Icon.vue';
import SubscriptionPicker from './SubscriptionPicker.vue';
import SubscriptionEmby from './SubscriptionEmby.vue';
import AppNavigation from './AppNavigation.vue';
import {sourceStatus} from './engine-labels.js';
import {Toaster, toast} from 'vue-sonner';
import {initializeNavigation, pushRoute, replaceRoute, routePosition, routeURL} from './navigation.js';
const SourceWorkspace=defineAsyncComponent(()=>import('./SourceWorkspace.vue'));
const WatchApp=defineAsyncComponent(()=>import('./WatchApp.vue'));
const NetdiskManager=defineAsyncComponent(()=>import('./NetdiskManager.vue'));

export default {
    components: {SourceWorkspace, WatchApp, NetdiskManager, SubscriptionEmby, Icon, SubscriptionPicker, Toaster, AppNavigation},
    setup() {
        const workspaceSource = ref(null);
        const workspace = ref(null);
        initializeNavigation();
        let workspaceRoute = null, restoring = null, allowLeave = false;
        const isAdminPath = () => location.pathname === '/admin' || /^\/sources\/[^/]+\/edit$/.test(location.pathname);
        const watching = ref(!isAdminPath());
        const publicSources = ref(null), watchLoading = ref(false), watchError = ref('');
        async function openWatch() { pushRoute('/'); watching.value = true; await loadWatch(); }
        async function closeWatch() { pushRoute('/admin'); workspaceSource.value = null; page.value = 'sources'; watching.value = false; await loadAdminAccess(); }
        async function applyRoute() {
            workspaceSource.value = null; page.value = 'sources';
            watching.value = !isAdminPath();
            if (watching.value) await loadWatch(); else await loadAdminAccess();
        }
        async function syncWatch(event) {
            if (restoring && routeURL() === workspaceRoute?.url) { restoring(); restoring = null; return; }
            if (event?.type === 'popstate' && workspace.value?.dirty && workspaceRoute && !allowLeave) {
                const target = {url: routeURL(), position: routePosition()};
                if (target.url === workspaceRoute.url) return;
                const delta = target.position === null ? 0 : workspaceRoute.position - target.position;
                let restored = Promise.resolve();
                if (delta) {
                    restored = new Promise(resolve => { restoring = resolve; });
                    history.go(delta);
                } else replaceRoute(workspaceRoute.url);
                workspace.value.requestLeave(async () => {
                    await restored;
                    if (delta) { allowLeave = true; history.go(-delta); }
                    else { replaceRoute(target.url); await applyRoute(); }
                });
                return;
            }
            allowLeave = false;
            await applyRoute();
        }
        function rememberWorkspaceRoute() { workspaceRoute = {url: routeURL(), position: routePosition()}; }
        const state = ref(null), page = ref('sources'), query = ref(''), engine = ref('all'), selected = ref([]), currentPage = ref(1);
        const auth = ref(sessionStorage.getItem('coketv-access') || ''), login = ref({password: ''}), loginError = ref('');
        const requiresSetup = ref(false), accessLoading = ref(true), newPassword = ref(''), confirmPassword = ref('');
        const busy = ref(false), modal = ref(null), form = ref({});
        const pageSize=ref(20);
        const confirming = ref(null), importFile = ref(null);
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

        }
        async function action(fn, message) {
            if (busy.value) return; busy.value = true;
            try { await fn(); if (message) notify(message); } catch (error) { notify(error.message, true); } finally { busy.value = false; }
        }
        async function signIn() {
            if (busy.value) return; busy.value = true;
            auth.value = btoa(unescape(encodeURIComponent(`:${login.value.password}`))); loginError.value = '';
            try { await load(); sessionStorage.setItem('coketv-access', auth.value); login.value.password = ''; const id=location.pathname.match(/^\/sources\/([^/]+)\/edit$/)?.[1]; const source=sources.value.find(s=>s.id===id); if(source){workspaceSource.value=source;page.value='workspace';rememberWorkspaceRoute();} }
            catch (error) { loginError.value = error.message; auth.value = ''; } finally { busy.value = false; }
        }
        async function createPassword() {
            if (busy.value) return;
            loginError.value = '';
            if (newPassword.value !== confirmPassword.value) {loginError.value='两次输入的密码不一致';return;}
            busy.value = true;
            try {
                auth.value = '';
                await api('/admin/access/setup', {password: newPassword.value, confirmPassword: confirmPassword.value});
                requiresSetup.value = false;
                auth.value = btoa(unescape(encodeURIComponent(`:${newPassword.value}`)));
                newPassword.value = ''; confirmPassword.value = '';
                await load(); sessionStorage.setItem('coketv-access', auth.value);
                const id=location.pathname.match(/^\/sources\/([^/]+)\/edit$/)?.[1];const source=sources.value.find(s=>s.id===id);if(source){workspaceSource.value=source;page.value='workspace';rememberWorkspaceRoute();}
            } catch(error) {loginError.value=error.message;auth.value='';} finally {busy.value=false;}
        }
        const sources = computed(() => (state.value?.instances || []).map(instance => ({...instance, script: state.value.scripts.find(s => s.id === instance.scriptId)})));
        const scriptRows = computed(() => [...sources.value, ...(state.value?.scripts || []).filter(script => !sources.value.some(source => source.scriptId === script.id)).map(script => ({id:script.id,scriptId:script.id,name:script.name || script.file,script,orphan:true,enabled:false}))]);
        const filtered = computed(() => scriptRows.value.filter(source => (engine.value === 'all' || sourceStatus(source.script?.engine) === engine.value) &&
            `${source.name} ${source.script?.file}`.toLowerCase().includes(query.value.toLowerCase())));
        const totalPages = computed(() => Math.max(1, Math.ceil(filtered.value.length / pageSize.value)));
        const visible = computed(() => filtered.value.slice((Math.min(currentPage.value, totalPages.value) - 1) * pageSize.value, Math.min(currentPage.value, totalPages.value) * pageSize.value));
        const enabledCount = computed(() => sources.value.filter(s => s.enabled).length);
        function toggle(id) { selected.value = selected.value.includes(id) ? selected.value.filter(s => s !== id) : [...selected.value, id]; }
        function selectVisible() { const all = visible.value.every(s => selected.value.includes(s.id)); for (const source of visible.value) if (all ? selected.value.includes(source.id) : !selected.value.includes(source.id)) toggle(source.id); }
        async function switchSource(source) { await api(`/admin/instances/${source.id}`, {...source, enabled: !source.enabled}, 'PUT'); await load(); }
        async function batch(enabled) { await api('/admin/instances/batch', {ids: selected.value.filter(id=>sources.value.some(source=>source.id===id)), enabled}); selected.value = []; await load(); }
        function removeSelected() {
            const ids = [...new Set(scriptRows.value.filter(source=>selected.value.includes(source.id)).map(source=>source.scriptId))];
            if (!ids.length || busy.value) return;
            const count = sources.value.filter(source=>ids.includes(source.scriptId)).length;
            confirm('删除所选脚本', `将永久删除选中的 ${ids.length} 个脚本文件、历史版本及 ${count} 个关联源的配置，并移除订阅引用。此操作无法恢复。`, async () => {
                await api('/admin/scripts/batch', {ids}, 'DELETE');
                selected.value = []; await load();
            }, '删除');
        }
        function renameSource(source) { form.value = {id: source.id, name: source.name}; modal.value = 'rename'; }
        async function saveName() {
            const current = (await api('/admin/state')).instances.find(item => item.id === form.value.id);
            if (!current) throw new Error('源已不存在，请刷新列表');
            await api(`/admin/instances/${current.id}`, {...current, name: form.value.name}, 'PUT');
            await load(); modal.value = null;
        }
        async function editScript(source) {
            workspaceSource.value = source; page.value = 'workspace';
            pushRoute(`/sources/${source.id}/edit`); rememberWorkspaceRoute();
        }
        function closeWorkspace() { workspaceSource.value = null; page.value = 'sources'; replaceRoute('/admin'); }
        function newScript() { form.value = {name: ''}; modal.value = 'editor'; }
        async function saveScript() {
            const name = form.value.name.trim().replace(/\.js$/i, '');
            if (!name) throw new Error('请填写脚本名');
            const script = await api('/admin/scripts/create', {name});
            await load();
            const source = sources.value.find(item => item.scriptId === script.id);
            if (!source) throw new Error('源已创建，请刷新列表后进入编辑');
            modal.value = null; await editScript(source);
        }
        function requestFile() { document.getElementById('source-upload').click(); }
        async function importSelected() {
            const data = new FormData(); data.append('file', importFile.value);
            await api('/admin/upload', data);
            await load();importFile.value=null;modal.value=null;notify('文件已导入');
        }
        async function upload(event) {
            const file=event.target.files[0];event.target.value='';if(!file)return;
            modal.value = null;
            importFile.value=file;await action(()=>importSelected());
        }
        function confirm(title, message, callback, actionLabel = '确认操作') { confirming.value = {title, message, callback, actionLabel}; }
        async function acceptConfirm() { const item = confirming.value; if (!item || busy.value) return; confirming.value = null; await action(() => item.callback(), '操作已完成'); }
        function removeSource(source) {
            const count = sources.value.filter(item=>item.scriptId===source.scriptId).length;
            confirm('删除脚本', `将永久删除“${source.script.file}”文件、历史版本及 ${count} 个关联源的配置，并移除订阅引用。此操作无法恢复。`, async () => {
                await api(`/admin/scripts/${source.scriptId}`, undefined, 'DELETE'); await load();
            }, '删除');
        }
        function openLinks(sub) { form.value={...sub}; modal.value='links'; }
        async function switchCapability(source,key) {await api(`/admin/instances/${source.id}`, {...source,[key]:!source[key]},'PUT');await load();}
        function openSubscription(sub) { form.value = sub ? {...sub, instances: [...sub.instances]} : {name: '', description:'',token:'',enabled: true, instances: []}; modal.value = 'subscription'; }
        async function saveSubscription() { await api(form.value.id ? `/admin/subscriptions/${form.value.id}` : '/admin/subscriptions', form.value, form.value.id ? 'PUT' : 'POST'); await load(); modal.value = null; }
        const subscriptionBase = () => window.location.origin;
        const shortSubscription = sub => typeof sub.token === 'string' && sub.token.length >= 1 && sub.token.length <= 200 && !/[^A-Za-z0-9_-]/.test(sub.token) && state.value.subscriptions.filter(item => item.token === sub.token).length === 1;
        const subscriptionUrl = sub => shortSubscription(sub) ? `${subscriptionBase()}/tvbox/${encodeURIComponent(sub.token)}` : `${subscriptionBase()}/subscription/${encodeURIComponent(sub.id)}?token=${encodeURIComponent(sub.token)}`;
        const catSubscriptionUrl = sub => `${subscriptionBase()}/cat/${shortSubscription(sub) ? '' : encodeURIComponent(sub.id) + '/'}${encodeURIComponent(sub.token)}/index.js.md5`;
        async function copy(text) { try { await navigator.clipboard.writeText(text); notify('已复制'); } catch { form.value = {title: '复制链接', content: text}; modal.value = 'text'; } }
        async function preview(sub) { form.value = {title: `${sub.name} · TVBox 配置`, content: JSON.stringify(await api(`/admin/subscriptions/${sub.id}/preview`), null, 2)}; modal.value = 'text'; }
        function deleteSub(sub) { confirm('删除订阅', `删除“${sub.name}”后，原订阅链接将失效，源脚本与站点实例不受影响。`, async () => { await api(`/admin/subscriptions/${sub.id}`, undefined, 'DELETE'); await load(); }); }
        function resetToken(sub) { confirm('重置订阅链接', '重置后需要在 TVBox 和猫影视中更新订阅链接，并在 Emby 中更新密码重新登录。', async () => { await api(`/admin/subscriptions/${sub.id}/token`, {}); await load(); modal.value=null; }); }
        function logout() { auth.value = ''; state.value = null; sessionStorage.removeItem('coketv-access'); }
        const modalTitle=computed(()=>modal.value==='rename'?'重命名源':modal.value==='links'?'订阅地址':modal.value==='editor'?'添加源':modal.value==='subscription'?(form.value.id?'配置订阅':'新建订阅'):form.value.title || '');
        async function loadAdminAccess() {
            accessLoading.value = true; loginError.value = '';
            try { const access = await api('/access/status'); requiresSetup.value=access.requiresSetup; }
            catch(error){loginError.value=error.message;}
            finally {accessLoading.value=false;}
            if(requiresSetup.value){auth.value='';sessionStorage.removeItem('coketv-access');return;}
            if (auth.value) await action(load);
            const id = location.pathname.match(/^\/sources\/([^/]+)\/edit$/)?.[1]; if (id && state.value) { const source = sources.value.find(s => s.id === id); if (source) {workspaceSource.value=source; page.value='workspace';rememberWorkspaceRoute();} }
        }
        onMounted(async () => { window.addEventListener('popstate', syncWatch); await syncWatch(); });
        onBeforeUnmount(() => window.removeEventListener('popstate', syncWatch));
        return {workspace,removeSelected,publicSources,watchLoading,watchError,watchApi,loadWatch,watching,openWatch,closeWatch,requiresSetup,accessLoading,newPassword,confirmPassword,createPassword,requestFile,renameSource,saveName,pageSize,openLinks,switchCapability,modalTitle, workspaceSource, closeWorkspace, api, state, page, query, engine, selected, currentPage, totalPages, visible, filtered, sources, scriptRows, enabledCount, auth, login, loginError, busy, modal, form, confirming,
            action, signIn, toggle, selectVisible, switchSource, batch, editScript, newScript, saveScript, upload, removeSource, openSubscription, saveSubscription, subscriptionBase, subscriptionUrl, catSubscriptionUrl, copy, preview, deleteSub, resetToken, logout, acceptConfirm, load};
    }
};
</script>
<template>
  <Toaster rich-colors position="bottom-right" />
  <WatchApp v-if="watching && publicSources" :sources="publicSources" :api="watchApi" @close="closeWatch" />
  <div v-else-if="watching" class="login-layout"><Alert v-if="watchError"><AlertTitle>观影页面加载失败</AlertTitle><AlertDescription>{{watchError}}<Button variant="outline" size="sm" :disabled="watchLoading" @click="loadWatch">重试</Button><Button variant="ghost" size="sm" @click="closeWatch">管理后台</Button></AlertDescription></Alert><Skeleton v-else class="h-52 w-80" /></div>
  <div v-else-if="accessLoading" class="login-layout"><Skeleton class="h-52 w-80" /></div>
  <div v-else-if="requiresSetup" class="login-layout"><section class="login-form-area"><form class="login-form" @submit.prevent="createPassword"><div><h2>CokeTV 管理后台</h2><p>首次进入管理后台，请创建访问密码。</p></div><FieldGroup><Field><FieldLabel for="new-password">新密码</FieldLabel><Input id="new-password" v-model="newPassword" type="password" autocomplete="new-password" minlength="6" maxlength="200" :disabled="busy" required autofocus /></Field><Field :data-invalid="!!loginError"><FieldLabel for="confirm-password">确认密码</FieldLabel><Input id="confirm-password" v-model="confirmPassword" type="password" autocomplete="new-password" :disabled="busy" :aria-invalid="!!loginError" required /><FieldError v-if="loginError">{{loginError}}</FieldError></Field></FieldGroup><Button type="submit" :disabled="busy">{{busy?'创建中…':'创建并进入'}}</Button><Button type="button" variant="ghost" @click="openWatch">返回观影</Button></form></section></div>
  <div v-else-if="!auth || !state" class="login-layout">
    <section class="login-form-area"><form class="login-form" @submit.prevent="signIn"><h2>CokeTV 管理后台</h2><FieldGroup><Field :data-invalid="!!loginError"><FieldLabel for="login-password">访问密码</FieldLabel><Input id="login-password" v-model="login.password" type="password" autocomplete="current-password" :aria-invalid="!!loginError" :disabled="busy" required autofocus /><FieldError v-if="loginError">{{loginError}}</FieldError></Field></FieldGroup><Button type="submit" :disabled="busy">{{busy?'验证中…':'进入'}}</Button><Button type="button" variant="ghost" @click="openWatch">返回观影</Button></form></section>
  </div>
  <SourceWorkspace v-else-if="page==='workspace' && workspaceSource" ref="workspace" :key="workspaceSource.id" :source="workspaceSource" :sources="sources" :api="api" @close="closeWorkspace" @saved="action(load)" />
  <SidebarProvider v-else>
    <Sidebar collapsible="icon">
      <SidebarHeader><a class="brand-lockup" href="/admin" @click.prevent="page='sources'"><span class="brand-mark"><Icon name="layers" /></span><div class="group-data-[collapsible=icon]:hidden"><strong>CokeTV</strong><small>v0.2.0</small></div></a></SidebarHeader>
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
            <NativeSelect v-if="sources.some(source=>source.script?.engine!=='dr3')" v-model="engine" class="filter-select" aria-label="迁移状态筛选" @update:model-value="currentPage=1"><option value="all">全部</option><option value="current">drpy3</option><option value="legacy">待迁移</option></NativeSelect>
            <Button size="sm" class="px-3!" @click="newScript"><Icon name="plus" />添加源</Button>
            <Button variant="outline" size="sm" :disabled="busy" @click="requestFile"><Icon name="upload" />导入脚本</Button><input id="source-upload" class="sr-only" type="file" accept=".js,.zip" @change="upload" />
          </div>
          <div v-if="selected.length" class="selection-tools"><span>已选择 {{selected.length}} 个源</span><Button variant="outline" size="sm" :disabled="busy||!selected.some(id=>sources.some(source=>source.id===id))" @click="action(()=>batch(true),'已启用')">启用</Button><Button variant="outline" size="sm" :disabled="busy||!selected.some(id=>sources.some(source=>source.id===id))" @click="action(()=>batch(false),'已停用')">停用</Button><Button variant="destructive" size="sm" :disabled="busy" @click="removeSelected"><Icon name="trash" data-icon="inline-start" />删除</Button><Button variant="ghost" size="sm" :disabled="busy" @click="selected=[]">取消选择</Button></div>
          <div class="source-table"><Table><TableHeader><TableRow>
            <TableHead class="select-column"><Checkbox :model-value="visible.length>0&&visible.every(s=>selected.includes(s.id))" aria-label="选择当前页" @update:model-value="selectVisible" /></TableHead><TableHead class="name-column">名称</TableHead><TableHead class="state-column">状态</TableHead><TableHead class="capability-column">搜索</TableHead><TableHead class="capability-column">筛选</TableHead><TableHead class="action-column">操作</TableHead>
          </TableRow></TableHeader><TableBody><TableRow v-for="source in visible" :key="source.id" :data-state="selected.includes(source.id)?'selected':undefined">
            <TableCell><Checkbox :model-value="selected.includes(source.id)" :aria-label="'选择'+source.name" @update:model-value="toggle(source.id)" /></TableCell>
            <TableCell><div class="source-name"><span v-if="source.orphan">{{source.name}}</span><button v-else class="source-title-button" :title="'单击重命名 · '+source.script?.file" @click="renameSource(source)">{{source.name}}</button></div></TableCell>
            <TableCell><div class="flex items-center gap-2"><Switch :model-value="source.enabled" :aria-label="(source.enabled?'停用':'启用')+source.name" :disabled="busy||source.orphan||source.migrationRequired||source.script?.engine!=='dr3'" @update:model-value="action(()=>switchSource(source))" /><Badge v-if="source.orphan" variant="secondary">未使用</Badge><Badge v-else-if="source.migrationRequired||source.script?.engine!=='dr3'" variant="secondary">待迁移</Badge></div></TableCell>
            <TableCell><Button variant="outline" size="xs" :aria-label="'切换搜索能力'+source.name" :disabled="busy||source.orphan" @click="action(()=>switchCapability(source,'searchable'))">{{source.searchable?'是':'否'}}</Button></TableCell>
            <TableCell><Button variant="outline" size="xs" :aria-label="'切换筛选能力'+source.name" :disabled="busy||source.orphan" @click="action(()=>switchCapability(source,'filterable'))">{{source.filterable?'是':'否'}}</Button></TableCell>
            <TableCell><div class="row-actions"><Button variant="ghost" size="icon-sm" aria-label="编辑" title="编辑脚本" :disabled="source.orphan" @click="action(()=>editScript(source))"><Icon name="code" :size="16" /></Button><Button variant="ghost" size="icon-sm" aria-label="删除脚本" title="删除脚本" @click="removeSource(source)"><Icon name="trash" :size="16" /></Button></div></TableCell>
          </TableRow><TableRow v-if="!visible.length"><TableCell colspan="6"><Empty><EmptyHeader><EmptyMedia variant="icon"><Icon name="search" /></EmptyMedia><EmptyTitle>没有匹配的源</EmptyTitle><EmptyDescription>调整筛选条件，或导入一个脚本。</EmptyDescription></EmptyHeader></Empty></TableCell></TableRow></TableBody></Table></div>
          <footer class="table-foot"><span>共 {{filtered.length}} 条<span class="source-totals"> · {{state.scripts.length}} 个脚本 · {{enabledCount}} 个启用</span></span><div class="pagination"><NativeSelect v-model.number="pageSize" aria-label="每页条数" @update:model-value="currentPage=1"><option :value="20">20 条/页</option><option :value="50">50 条/页</option><option :value="100">100 条/页</option></NativeSelect><Button variant="ghost" size="icon-sm" aria-label="上一页" :disabled="currentPage<=1" @click="currentPage--"><Icon name="left" /></Button><Button v-for="n in totalPages" :key="n" v-show="Math.abs(n-currentPage)<3||n===1||n===totalPages" :variant="n===currentPage?'default':'ghost'" size="icon-sm" :aria-label="'第'+n+'页'" @click="currentPage=n">{{n}}</Button><Button variant="ghost" size="icon-sm" aria-label="下一页" :disabled="currentPage>=totalPages" @click="currentPage++"><Icon name="right" /></Button></div></footer>
        </template>
        <template v-else-if="page==='subscriptions'">
          <h1 class="sr-only">订阅管理</h1><div class="subscription-toolbar"><Button size="sm" @click="openSubscription()"><Icon name="plus" />新建订阅</Button></div>
          <div class="subscription-grid"><article v-for="sub in state.subscriptions" :key="sub.id" class="subscription-item"><Button variant="ghost" size="icon-xs" class="subscription-delete" aria-label="删除订阅" @click="deleteSub(sub)"><Icon name="x" :size="14" /></Button><div class="subscription-heading"><span class="subscription-symbol">{{sub.name.slice(0,1)}}</span><div><h2>{{sub.name}}</h2><p v-if="sub.description">{{sub.description}}</p></div></div><div class="subscription-actions"><Icon name="rss" :size="14" /><Badge variant="secondary">订阅 · {{sub.instances.length}} 源</Badge><span v-if="!sub.enabled" class="text-xs text-muted-foreground">停用</span><div class="subscription-buttons"><Button variant="ghost" size="icon-xs" aria-label="配置订阅" title="编辑" @click="openSubscription(sub)"><Icon name="edit" :size="16" /></Button><Button variant="ghost" size="icon-xs" aria-label="订阅链接" title="订阅链接" @click="openLinks(sub)"><Icon name="link" :size="16" /></Button></div></div></article></div>
          <Empty v-if="!state.subscriptions.length"><EmptyHeader><EmptyMedia variant="icon"><Icon name="radio" /></EmptyMedia><EmptyTitle>创建第一个订阅</EmptyTitle><EmptyDescription>选好源，将订阅链接填入 TVBox。</EmptyDescription></EmptyHeader><EmptyContent><Button @click="openSubscription()">新建订阅</Button></EmptyContent></Empty>
        </template>
        <NetdiskManager v-else-if="page==='netdisk'" :api="api" />

      </main>
    </SidebarInset>
  </SidebarProvider>
  <Dialog :open="!!modal" @update:open="!$event&&!busy&&(modal=null)"><DialogContent :class="[modal==='subscription'?'subscription-dialog sm:max-w-[768px]':['text'].includes(modal)?'sm:max-w-[960px]':'sm:max-w-[512px]']" :show-close-button="!busy"><DialogHeader><DialogTitle>{{modalTitle}}</DialogTitle><DialogDescription class="sr-only">{{modal==='rename'?'只修改显示名称，脚本文件与源配置保持不变。':modal==='subscription'?'选择站点并排列顺序，保存后更新订阅。':modal==='editor'?'填写脚本名，保存后进入编辑页面。':'查看并复制配置内容。'}}</DialogDescription></DialogHeader><div class="dialog-scroll">

    <form v-if="modal==='rename'" @submit.prevent="action(saveName,'名称已更新')"><FieldGroup><Field><FieldLabel for="source-name">名称</FieldLabel><Input id="source-name" v-model="form.name" required maxlength="200" /></Field></FieldGroup><DialogFooter class="mt-6"><Button type="button" variant="outline" @click="modal=null">取消</Button><Button type="submit" :disabled="busy">{{busy?'保存中…':'保存名称'}}</Button></DialogFooter></form>
    <form v-else-if="modal==='editor'" @submit.prevent="action(saveScript,'源已创建')"><FieldGroup><Field><FieldLabel for="new-name">脚本名</FieldLabel><Input id="new-name" v-model="form.name" required maxlength="176" placeholder="例如：我的影视源" /></Field></FieldGroup><DialogFooter class="mt-6"><Button type="button" variant="outline" @click="modal=null">取消</Button><Button type="submit" :disabled="busy">{{busy?'创建中…':'保存'}}</Button></DialogFooter></form>
    <form id="subscription-form" v-else-if="modal==='subscription'" @submit.prevent="action(saveSubscription,'订阅已保存')"><FieldGroup class="gap-4"><Field><FieldLabel for="subscription-name">订阅名称</FieldLabel><Input id="subscription-name" v-model="form.name" placeholder="订阅名称" required /></Field><Field><FieldLabel for="subscription-description">描述</FieldLabel><Textarea id="subscription-description" v-model="form.description" rows="2" placeholder="订阅描述信息" /></Field><Field><FieldLabel for="subscription-token">访问令牌</FieldLabel><Input id="subscription-token" v-model="form.token" :placeholder="form.id ? '填写访问令牌' : '留空自动生成'" :required="!!form.id" maxlength="200" pattern="[A-Za-z0-9_-]{1,200}" autocomplete="off" spellcheck="false" /><FieldDescription>支持1–200位字母、数字、短横线和下划线。新建时留空自动生成；修改后需在 TVBox 和猫影视更新链接，并在 Emby 更新密码重新登录。</FieldDescription></Field><Field orientation="horizontal"><Checkbox id="subscription-enabled" v-model="form.enabled" /><FieldLabel for="subscription-enabled">启用订阅</FieldLabel></Field><SubscriptionPicker :sources="sources" v-model="form.instances" /></FieldGroup></form>
    <div v-else-if="modal==='links'" class="subscription-address">
      <Tabs default-value="tvbox">
        <TabsList class="w-full"><TabsTrigger value="tvbox" class="flex-1"><Icon name="monitor" :size="16" />TVBox</TabsTrigger><TabsTrigger value="cat" class="flex-1"><Icon name="rss" :size="16" />猫影视</TabsTrigger><TabsTrigger value="emby" class="flex-1"><Icon name="play" :size="16" />Emby</TabsTrigger></TabsList>
        <TabsContent value="tvbox"><FieldGroup class="gap-4 mt-5"><Field><FieldLabel>影视 / TVBox</FieldLabel><div class="subscription-link"><Input :model-value="subscriptionUrl(form)" readonly aria-label="订阅链接" /><Button variant="secondary" size="icon" aria-label="复制订阅链接" @click="copy(subscriptionUrl(form))"><Icon name="copy" /></Button></div></Field></FieldGroup><div class="flex gap-2 mt-4"><Button variant="outline" size="sm" @click="action(()=>preview(form))"><Icon name="braces" />预览配置</Button><Button variant="outline" size="sm" @click="resetToken(form)">重置链接</Button></div></TabsContent>
        <TabsContent value="cat"><FieldGroup class="gap-4 mt-5"><Field><FieldLabel>猫影视 / Miraplay</FieldLabel><div class="subscription-link"><Input :model-value="catSubscriptionUrl(form)" readonly aria-label="猫影视订阅链接" /><Button variant="secondary" size="icon" aria-label="复制猫影视订阅链接" @click="copy(catSubscriptionUrl(form))"><Icon name="copy" /></Button></div><FieldDescription>在支持 Node.js 源的猫影视或 Miraplay 中导入此链接。手机需能访问此服务，电脑或服务器需保持运行。</FieldDescription><FieldDescription>增减源或调整顺序后，在播放器刷新订阅。链接含访问凭证，请妥善保管。</FieldDescription></Field></FieldGroup><div class="flex gap-2 mt-4"><Button variant="outline" size="sm" @click="resetToken(form)">重置链接</Button></div></TabsContent>
        <TabsContent value="emby"><SubscriptionEmby :subscription="form" :base-url="subscriptionBase()" :api="api" @copy="copy" /></TabsContent>
      </Tabs>
    </div>
    <div v-else-if="modal==='text'"><pre class="result-code">{{form.content}}</pre><DialogFooter class="mt-4"><Button variant="outline" @click="copy(form.content)">复制内容</Button><Button @click="modal=null">完成</Button></DialogFooter></div>
  </div><DialogFooter v-if="modal==='subscription'"><span class="dialog-footer-note">已选择 {{form.instances.length}} 个源</span><Button type="button" variant="outline" @click="modal=null">取消</Button><Button type="submit" form="subscription-form" :disabled="busy">保存订阅</Button></DialogFooter></DialogContent></Dialog>
  <AlertDialog :open="!!confirming" @update:open="!$event&&(confirming=null)"><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{{confirming?.title}}</AlertDialogTitle><AlertDialogDescription>{{confirming?.message}}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel @click="confirming=null">取消</AlertDialogCancel><AlertDialogAction as-child><Button :variant="confirming?.actionLabel==='删除'?'destructive':'default'" @click.capture="acceptConfirm">{{confirming?.actionLabel||'确认操作'}}</Button></AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
</template>
