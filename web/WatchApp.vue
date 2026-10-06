<script setup>
import {computed, ref, watch, onMounted, onBeforeUnmount, defineAsyncComponent, nextTick} from 'vue';
import {Film, Search, Settings2, UserRound, ArrowLeft, List, Grid2X2, ArrowDownUp, LocateFixed, ListVideo, SkipForward, Heart, Copy, Play, X, Filter, Check} from '@lucide/vue';
import {toast} from 'vue-sonner';
import {resultObject, playlists, plainText, detailText, safeImage, readWatchStorage, saveWatchStorage} from './watch-model.js';
import {engineLanguage, languageLabels} from './engine-labels.js';
import {InputGroupButton} from './components/ui/input-group/index.ts';
import {Popover, PopoverAnchor, PopoverContent} from './components/ui/popover/index.ts';
const WebPlayer = defineAsyncComponent(() => import('./WebPlayer.vue'));
const props = defineProps({sources: Array, api: Function});
const emit = defineEmits(['close']);
const enabled = computed(() => props.sources.filter(item => item.enabled));
function readRoute() {
    const q = new URLSearchParams(location.search);
    const saved = (() => { try { return localStorage.getItem('coketv-watch-source'); } catch { return ''; } })();
    return {path: location.pathname, source: q.get('source') || saved || enabled.value[0]?.id || '', vod: q.get('vod') || '', category: q.get('category') || 'home', search: q.get('search') || '', pg: Math.max(1, Number(q.get('pg')) || 1), line: Math.max(0, Number(q.get('line')) || 0), episode: Math.max(0, Number(q.get('episode')) || 0)};
}
const route = ref(readRoute()), keyword = ref(route.value.search);
const searchPanel = ref(false), searchInput = ref(null);
const searchRecords = ref(readWatchStorage('coketv-search-history').filter(item => typeof item === 'string').slice(0, 12));
const source = computed(() => enabled.value.find(item => item.id === route.value.source));
const isPlay = computed(() => route.value.path === '/watch/play');
const isHistory = computed(() => route.value.path === '/watch/history');
const home = ref({}), videos = ref([]), pageCount = ref(1), filters = ref({}), detail = ref(null);
const loading = ref(false), error = ref(''), playLoading = ref(false), playError = ref(''), media = ref(null), parsers = ref([]), parser = ref('auto'), needsParse = ref(false), resume = ref(0);
const sourceDialog = ref(false), episodeDialog = ref(false), sourceQuery = ref(''), sourceLanguage = ref('all');
const descending = ref(false), coverMode = ref(true), expanded = ref(false), libraryTab = ref('history');
const historyItems = ref(readWatchStorage('coketv-watch-history')), favorites = ref(readWatchStorage('coketv-watch-favorites'));
const lines = computed(() => playlists(detail.value));
const lineIndex = computed(() => Math.min(route.value.line, Math.max(0, lines.value.length - 1)));
const currentLine = computed(() => lines.value[lineIndex.value]);
const currentEpisode = computed(() => currentLine.value?.episodes[Math.min(route.value.episode, currentLine.value.episodes.length - 1)]);
const episodes = computed(() => descending.value ? [...(currentLine.value?.episodes || [])].reverse() : currentLine.value?.episodes || []);
const categories = computed(() => [{type_id: 'home', type_name: '首页'}, ...(home.value.class || []).filter(item => String(item.type_id) !== 'home')]);
const activeFilters = computed(() => source.value?.filterable ? home.value.filters?.[route.value.category] || [] : []);
const pickerSources = computed(() => enabled.value.filter(item => item.name.toLowerCase().includes(sourceQuery.value.toLowerCase()) && (sourceLanguage.value === 'all' || engineLanguage(item.script?.engine) === sourceLanguage.value)));
const favorite = computed(() => favorites.value.some(item => item.source === route.value.source && item.vod === route.value.vod));
const library = computed(() => libraryTab.value === 'history' ? historyItems.value : favorites.value);
const backdrop = computed(() => ({backgroundImage: `url(${JSON.stringify(safeImage(detail.value?.vod_pic))})`}));
const searchSuggestions = computed(() => [...new Set((home.value.list || []).map(item => plainText(item.vod_name)).filter(Boolean))].slice(0, 6));
const searching = computed(() => loading.value && !!route.value.search);
let dataVersion = 0, playVersion = 0;
function navigate(path, values = {}) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(values)) if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
    history.pushState({}, '', `${path}${query.size ? '?' + query : ''}`);
    route.value = readRoute();
}
function backToBrowse() { searchPanel.value = false; keyword.value = ''; navigate('/watch', {source: route.value.source}); }
function openSites() { searchPanel.value = false; sourceQuery.value = ''; sourceDialog.value = true; }
function selectSource(id) {
    try { localStorage.setItem('coketv-watch-source', id); } catch {}
    sourceDialog.value = false; filters.value = {}; keyword.value = '';
    navigate('/watch', {source: id});
}
function selectCategory(value) { filters.value = {}; navigate('/watch', {source: route.value.source, category: value}); }
function search() {
    const value = keyword.value.trim();
    if (!source.value || !source.value.searchable || !value) {
        searchPanel.value = true;
        searchInput.value?.$el?.focus();
        return;
    }
    searchPanel.value = false; keyword.value = value;
    searchRecords.value = [value, ...searchRecords.value.filter(item => item !== value)].slice(0, 12);
    saveWatchStorage('coketv-search-history', searchRecords.value);
    navigate('/watch', {source: route.value.source, search: value});
}
function searchRecord(value) { keyword.value = value; search(); }
function keepSearchFocus(event) { if (event.detail.originalEvent.target?.closest?.('.watch-search')) event.preventDefault(); }
function changePage(pg) { navigate('/watch', {...route.value, path: undefined, vod: undefined, pg}); }
function openVideo(vod) {
    const id = String(vod.vod_id ?? '');
    if (!id) return;
    const previous = historyItems.value.find(item => item.source === route.value.source && item.vod === id);
    navigate('/watch/play', {source: route.value.source, vod: id, line: previous?.line || 0, episode: previous?.episode || 0});
    window.scrollTo({top: 0});
}
function chooseEpisode(index, line = lineIndex.value) {
    episodeDialog.value = false;
    if (index === route.value.episode && line === route.value.line) { resolvePlay(true); return; }
    navigate('/watch/play', {source: route.value.source, vod: route.value.vod, line, episode: index});
}
function previousEpisode() { if (currentEpisode.value?.index > 0) chooseEpisode(currentEpisode.value.index - 1); }
function nextEpisode() { if (currentEpisode.value?.index < (currentLine.value?.episodes.length || 0) - 1) chooseEpisode(currentEpisode.value.index + 1); }
function episodeEnded() { saveProgress(0, 0, media.value?.context); nextEpisode(); }
async function locateEpisode() { await nextTick(); document.querySelector('.watch-episode[aria-current="true"]')?.scrollIntoView({behavior: 'smooth', block: 'nearest', inline: 'center'}); }
async function loadData() {
    const version = ++dataVersion; ++playVersion;
    media.value = null; detail.value = null; playError.value = ''; parsers.value = []; needsParse.value = false; parser.value = 'auto';
    error.value = ''; loading.value = true; expanded.value = false;
    if (isHistory.value) { loading.value = false; return; }
    if (!source.value) { loading.value = false; error.value = enabled.value.length ? '此源不存在或已停用，请选择其他源。' : '没有已启用的源，请先在源管理中启用。'; return; }
    const {source: id, vod, category, search: wd, pg} = route.value;
    try {
        if (isPlay.value) {
            const data = resultObject(await props.api(`/watch/sources/${id}?${new URLSearchParams({ac: 'detail', ids: vod})}`));
            if (version !== dataVersion) return;
            const list = Array.isArray(data.list) ? data.list : Array.isArray(data) ? data : [data];
            detail.value = list[0];
            if (!detail.value?.vod_name) throw new Error('源没有返回影片详情');
            if (currentEpisode.value) await resolvePlay(false);
        } else {
            let data;
            if (wd) {
                if (!source.value.searchable) throw new Error('此源不支持搜索，请切换源。');
                data = resultObject(await props.api(`/watch/sources/${id}?${new URLSearchParams({wd, pg})}`));
            } else {
                const homeResult = resultObject(await props.api(`/watch/sources/${id}`));
                if (version !== dataVersion) return;
                home.value = homeResult;
                data = homeResult;
                if (category !== 'home') {
                    const query = {ac: 'list', t: category, pg, ext: btoa(unescape(encodeURIComponent(JSON.stringify(filters.value))))};
                    data = resultObject(await props.api(`/watch/sources/${id}?${new URLSearchParams(query)}`));
                }
            }
            if (version !== dataVersion) return;
            videos.value = Array.isArray(data.list) ? data.list : [];
            pageCount.value = Math.max(pg, Number(data.pagecount) || (videos.value.length ? pg + 1 : pg));
        }
    } catch (failure) { if (version === dataVersion) error.value = failure.message; }
    finally { if (version === dataVersion) loading.value = false; }
}
async function resolvePlay(autoplay = false) {
    const episode = currentEpisode.value, line = currentLine.value;
    if (!episode || !line || !source.value) return;
    const version = ++playVersion;
    playLoading.value = true; playError.value = ''; media.value = null; needsParse.value = false;
    const context = {source: route.value.source, vod: route.value.vod, sourceName: source.value.name, vod_name: detail.value.vod_name, vod_pic: safeImage(detail.value.vod_pic), line: lineIndex.value, episode: episode.index, episodeName: episode.name};
    try {
        const data = await props.api(`/watch/sources/${context.source}/play`, {play: episode.id, flag: line.name, ...(parser.value !== 'auto' ? {parser: Number(parser.value)} : {})});
        if (version !== playVersion) return;
        parsers.value = data.parses || []; needsParse.value = !!data.needsParse;
        if (data.needsParse) { playError.value = parsers.value.length ? '请选择解析线路。' : '此源需要解析，请在设置中添加解析服务或切换播放线路。'; return; }
        const previous = historyItems.value.find(item => item.source === context.source && item.vod === context.vod && item.line === context.line && item.episode === context.episode);
        resume.value = previous?.time || 0;
        media.value = {...data, autoplay, context};
        saveProgress(resume.value, previous?.duration || 0, context);
    } catch (failure) { if (version === playVersion) playError.value = failure.message; }
    finally { if (version === playVersion) playLoading.value = false; }
}
function saveProgress(time, duration, context) {
    if (!context || !Number.isFinite(time)) return;
    historyItems.value = [{...context, time: Math.max(0, time), duration: Number.isFinite(duration) ? duration : 0, updated: Date.now()}, ...historyItems.value.filter(item => item.source !== context.source || item.vod !== context.vod)].slice(0, 100);
    saveWatchStorage('coketv-watch-history', historyItems.value);
}
function toggleFavorite() {
    if (!detail.value) return;
    const item = {source: route.value.source, vod: route.value.vod, sourceName: source.value?.name, vod_name: detail.value.vod_name, vod_pic: safeImage(detail.value.vod_pic)};
    favorites.value = favorite.value ? favorites.value.filter(entry => entry.source !== item.source || entry.vod !== item.vod) : [item, ...favorites.value];
    saveWatchStorage('coketv-watch-favorites', favorites.value);
}
async function copyLink() { try { await navigator.clipboard.writeText(location.href); toast.success('播放页面链接已复制'); } catch { toast.error('复制失败，请复制浏览器地址'); } }
function openHistory(item) { navigate('/watch/play', {source: item.source, vod: item.vod, line: item.line || 0, episode: item.episode || 0}); }
function removeHistory(item) {
    const list = libraryTab.value === 'history' ? historyItems : favorites;
    list.value = list.value.filter(entry => entry.source !== item.source || entry.vod !== item.vod);
    saveWatchStorage(`coketv-watch-${libraryTab.value === 'history' ? 'history' : 'favorites'}`, list.value);
}
function popstate() { route.value = readRoute(); keyword.value = route.value.search; }
// 用原始值拼键做比较：数组 getter 每次返回新数组，Vue 按 Object.is 比较，
// 会让「整体替换 route」总是触发 loadData，从而在切集/换线路时重载详情、
// 卸载播放器并丢失自动播放。拆成两条互不干扰的路径后，只有真正换片才重新加载。
watch(() => [route.value.path, route.value.source, route.value.vod, route.value.category, route.value.search, route.value.pg].join('|'), loadData);
watch(() => [route.value.line, route.value.episode].join('|'), () => {
    if (detail.value && isPlay.value) resolvePlay(true);
});
onMounted(() => { window.addEventListener('popstate', popstate); loadData(); });
onBeforeUnmount(() => { ++dataVersion; ++playVersion; window.removeEventListener('popstate', popstate); });
</script>
<template>
  <div class="watch-app watch-theme dark">
    <header class="watch-header"><div class="watch-header-inner">
      <a href="/watch" class="watch-brand" @click.prevent="backToBrowse">CokeTV</a>
      <Popover v-model:open="searchPanel"><PopoverAnchor as-child>
        <form class="watch-search" role="search" @submit.prevent="search"><InputGroup>
          <InputGroupInput ref="searchInput" v-model="keyword" aria-label="搜索影片" :placeholder="source && !source.searchable?'此源不支持搜索':'搜索影片'" :readonly="source && !source.searchable" :aria-expanded="searchPanel" aria-haspopup="dialog" maxlength="200" @focus="searchPanel=true" @click="searchPanel=true" @keydown.esc="searchPanel=false" />
          <InputGroupAddon><InputGroupButton type="button" size="icon-xs" aria-label="提交搜索" title="搜索" @click="search"><Search /></InputGroupButton></InputGroupAddon>
          <InputGroupAddon align="inline-end"><InputGroupButton v-if="keyword" type="button" size="icon-xs" aria-label="清除搜索" @click="backToBrowse"><X /></InputGroupButton><InputGroupButton type="submit" variant="secondary">{{searching?'搜索中…':'搜索'}}</InputGroupButton></InputGroupAddon>
        </InputGroup></form>
      </PopoverAnchor><PopoverContent class="watch-theme dark watch-search-panel" align="start" :side-offset="8" aria-label="影片搜索" @open-auto-focus.prevent @close-auto-focus.prevent @interact-outside="keepSearchFocus">
        <div class="watch-search-context"><span>{{source?.searchable?'在 '+source.name+' 中搜索':source?'此源不支持搜索':'请选择影视源'}}</span><Button variant="ghost" size="sm" @click="openSites">切换源</Button></div>
        <template v-if="source?.searchable">
          <section v-if="searchRecords.length"><h2>搜索记录</h2><div class="watch-search-records"><Button v-for="record in searchRecords" :key="record" variant="secondary" size="sm" @click="searchRecord(record)">{{record}}</Button></div></section>
          <section v-if="searchSuggestions.length"><h2>当前源推荐</h2><div class="watch-search-suggestions"><Button v-for="name in searchSuggestions" :key="name" variant="ghost" size="sm" @click="searchRecord(name)"><Search data-icon="inline-start" /><span class="truncate">{{name}}</span></Button></div></section>
          <p v-if="!searchRecords.length && !searchSuggestions.length">输入影片名，点击搜索或按回车。</p>
        </template>
      </PopoverContent></Popover>
      <nav class="watch-desktop-nav" aria-label="观影导航"><Button variant="ghost" size="sm" aria-haspopup="dialog" :aria-expanded="sourceDialog" @click="openSites"><Film data-icon="inline-start" />影视站</Button><Button variant="ghost" size="sm" @click="navigate('/watch/history')"><UserRound data-icon="inline-start" />我的</Button><Button variant="ghost" size="sm" @click="emit('close')"><Settings2 data-icon="inline-start" />管理后台</Button></nav>
    </div></header>
    <div v-if="isPlay && safeImage(detail?.vod_pic)" class="watch-backdrop" :style="backdrop" />
    <main :class="['watch-main',{'watch-play-main':isPlay}]">
      <template v-if="isHistory">
        <div class="watch-library-heading"><h1>我的</h1></div>
        <Tabs v-model="libraryTab"><TabsList><TabsTrigger value="history">观看历史</TabsTrigger><TabsTrigger value="favorites">我的收藏</TabsTrigger></TabsList></Tabs>
        <div v-if="library.length" class="watch-video-grid watch-library"><article v-for="item in library" :key="item.source+item.vod" class="watch-video-card"><button @click="openHistory(item)"><div class="watch-poster"><img v-if="safeImage(item.vod_pic)" :src="safeImage(item.vod_pic)" :alt="item.vod_name" loading="lazy" referrerpolicy="no-referrer" /><Film v-else /><span v-if="item.episodeName" class="watch-remark">{{item.episodeName}}</span></div><h3>{{item.vod_name}}</h3><p>{{item.sourceName}}</p></button><Button variant="ghost" size="icon-sm" :aria-label="'移除'+item.vod_name" class="watch-remove" @click="removeHistory(item)"><X /></Button></article></div>
        <Empty v-else><EmptyHeader><EmptyMedia variant="icon"><Film /></EmptyMedia><EmptyTitle>{{libraryTab==='history'?'暂无观看历史':'暂无收藏'}}</EmptyTitle><EmptyDescription>选择源并打开影片，开始观看。</EmptyDescription></EmptyHeader><EmptyContent><Button @click="backToBrowse">浏览影片</Button></EmptyContent></Empty>
      </template>
      <template v-else-if="isPlay">
        <template v-if="detail">
          <div class="watch-player-frame">
            <iframe v-if="media?.iframe" :src="media.iframe" title="网页解析播放器" allow="autoplay; fullscreen; picture-in-picture" referrerpolicy="no-referrer" sandbox="allow-scripts allow-same-origin allow-presentation" allowfullscreen />
            <WebPlayer v-else :media="media" :resume="resume" :previous="currentEpisode?.index>0" :next="currentEpisode?.index<(currentLine?.episodes.length||0)-1" @previous="previousEpisode" @next="nextEpisode" @ended="episodeEnded" @progress="saveProgress" @error="playError=$event" />
            <div v-if="playLoading || playError || !currentEpisode" class="watch-player-message" role="status"><span v-if="playLoading" class="watch-loading-icon"><Play /></span><p>{{playLoading?'正在获取播放地址…':playError||'此影片暂无可播放剧集'}}</p><Button v-if="!playLoading && currentEpisode && !needsParse" variant="secondary" size="sm" @click="resolvePlay(true)">重试</Button></div>
          </div>
          <div class="watch-detail-heading"><h1>{{detail.vod_name}}</h1><div class="watch-detail-actions"><Button variant="ghost" size="icon-sm" aria-label="返回影视站" title="返回影视站" @click="backToBrowse"><ArrowLeft /></Button><Button variant="ghost" size="icon-sm" :aria-label="favorite?'取消收藏':'收藏影片'" :aria-pressed="favorite" :class="{'watch-favorited':favorite}" @click="toggleFavorite"><Heart /></Button><Button variant="ghost" size="icon-sm" aria-label="复制播放页面链接" @click="copyLink"><Copy /></Button></div></div>
          <div v-if="detailText(detail.vod_content)" class="watch-description"><p :class="{'watch-description-expanded':expanded}" @click="expanded=!expanded">{{detailText(detail.vod_content)}}</p></div>
          <div v-if="parsers.length && (needsParse || parser!=='auto')" class="watch-parser"><Field><FieldLabel for="watch-parser">解析线路</FieldLabel><NativeSelect id="watch-parser" v-model="parser" @update:model-value="resolvePlay(true)"><option value="auto">自动选择</option><option v-for="item in parsers" :key="item.index" :value="String(item.index)">{{item.name}}</option></NativeSelect></Field></div>
          <section class="watch-episodes" aria-label="剧集">
            <Tabs v-if="lines.length>1" :model-value="String(lineIndex)" @update:model-value="chooseEpisode(0,Number($event))"><TabsList class="watch-line-tabs"><TabsTrigger v-for="(line,index) in lines" :key="index" :value="String(index)">{{line.name}}</TabsTrigger></TabsList></Tabs>
            <div class="watch-episode-toolbar"><span>共{{currentLine?.episodes.length||0}}集</span><div><Button variant="ghost" size="icon-sm" aria-label="下一集" title="下一集" :disabled="!(currentEpisode?.index<(currentLine?.episodes.length||0)-1)" @click="nextEpisode"><SkipForward /></Button><Button variant="ghost" size="icon-sm" aria-label="打开剧集列表" title="打开剧集列表" @click="episodeDialog=true"><ListVideo /></Button><Button variant="ghost" size="icon-sm" aria-label="快速定位到当前播放的剧集" title="定位当前剧集" @click="locateEpisode"><LocateFixed /></Button><Button variant="ghost" size="icon-sm" :aria-label="coverMode?'切换为简洁列表':'切换为封面列表'" :title="coverMode?'切换为简洁列表':'切换为封面列表'" @click="coverMode=!coverMode"><List v-if="coverMode" /><Grid2X2 v-else /></Button><Button variant="ghost" size="icon-sm" :aria-label="descending?'当前：倒序，点击切换为正序':'当前：正序，点击切换为倒序'" title="切换排序" @click="descending=!descending"><ArrowDownUp /></Button></div></div>
            <div :class="['watch-episode-list',{'watch-episode-covers':coverMode}]"><button v-for="episode in episodes" :key="episode.index" class="watch-episode" :aria-current="episode.index===currentEpisode?.index?'true':undefined" @click="chooseEpisode(episode.index)"><span v-if="coverMode" class="watch-episode-poster"><img v-if="safeImage(detail.vod_pic)" :src="safeImage(detail.vod_pic)" alt="" referrerpolicy="no-referrer" /><Play v-else /></span><span>{{episode.name}}</span></button></div>
          </section>
          <section v-if="detailText(detail.vod_actor) || detailText(detail.vod_director)" class="watch-credits"><h2>演职人员</h2><p v-if="detailText(detail.vod_director)"><span>导演</span>{{detailText(detail.vod_director)}}</p><p v-if="detailText(detail.vod_actor)"><span>主演</span>{{detailText(detail.vod_actor)}}</p></section>
        </template>
        <Skeleton v-else-if="loading" class="watch-player-skeleton" />
      </template>
      <template v-else>
        <div class="watch-browse-toolbar"><Tabs :model-value="route.search?'search':route.category" @update:model-value="selectCategory"><TabsList class="watch-category-tabs"><TabsTrigger v-for="item in categories" :key="item.type_id" :value="String(item.type_id)">{{item.type_name}}</TabsTrigger><TabsTrigger v-if="route.search" value="search">搜索结果</TabsTrigger></TabsList></Tabs><Button variant="ghost" size="sm" @click="sourceDialog=true"><Filter data-icon="inline-start" /><span class="truncate">{{source?.name||'选择源'}}</span></Button></div>
        <div v-if="activeFilters.length && !route.search" class="watch-filters"><Field v-for="group in activeFilters" :key="group.key"><FieldLabel :for="'watch-filter-'+group.key">{{group.name}}</FieldLabel><NativeSelect :id="'watch-filter-'+group.key" v-model="filters[group.key]" @update:model-value="loadData"><option value="">全部</option><option v-for="item in group.value||[]" :key="item.v" :value="item.v">{{item.n}}</option></NativeSelect></Field></div>
        <p v-if="route.search" class="watch-search-status" role="status">{{loading?'正在 '+source?.name+' 搜索“'+route.search+'”…':'“'+route.search+'” · '+source?.name+' · 第 '+route.pg+' 页'}}<Button variant="ghost" size="sm" @click="backToBrowse">返回首页</Button></p>
        <div v-if="loading" class="watch-video-grid"><div v-for="n in 12" :key="n"><Skeleton class="watch-poster" /><Skeleton class="h-5 mt-3 w-3/4" /></div></div>
        <div v-else-if="!error && videos.length" class="watch-video-grid"><article v-for="(vod,index) in videos" :key="String(vod.vod_id)+index" class="watch-video-card"><button @click="openVideo(vod)"><div class="watch-poster"><img v-if="safeImage(vod.vod_pic)" :src="safeImage(vod.vod_pic)" :alt="vod.vod_name" loading="lazy" referrerpolicy="no-referrer" @error="$event.target.style.visibility='hidden'" /><Film v-else /><span v-if="vod.vod_year" class="watch-year">{{vod.vod_year}}</span><span v-if="vod.vod_remarks" class="watch-remark">{{vod.vod_remarks}}</span></div><h3>{{vod.vod_name}}</h3><p v-if="vod.vod_blurb">{{plainText(vod.vod_blurb)}}</p></button></article></div>
        <Empty v-else-if="!error"><EmptyHeader><EmptyMedia variant="icon"><Film /></EmptyMedia><EmptyTitle>{{route.search?'没有找到影片':'暂无影片'}}</EmptyTitle><EmptyDescription>{{route.search?'尝试其他关键词或切换源。':'选择其他分类，或更换源。'}}</EmptyDescription></EmptyHeader><EmptyContent><Button variant="outline" @click="sourceDialog=true">切换源</Button></EmptyContent></Empty>
        <div v-if="!loading && !error && (route.category!=='home'||route.search)" class="watch-pagination"><Button variant="outline" size="sm" :disabled="route.pg<=1" @click="changePage(route.pg-1)">上一页</Button><span>第 {{route.pg}} 页</span><Button variant="outline" size="sm" :disabled="route.pg>=pageCount||!videos.length" @click="changePage(route.pg+1)">下一页</Button></div>
      </template>
      <Alert v-if="error" class="watch-error" variant="destructive"><AlertTitle>加载失败</AlertTitle><AlertDescription>{{error}}<div class="flex gap-2 mt-3"><Button variant="outline" size="sm" @click="loadData">重试</Button><Button variant="outline" size="sm" @click="sourceDialog=true">切换源</Button></div></AlertDescription></Alert>
    </main>
    <Button v-if="!isPlay && !isHistory" class="watch-source-fab" size="icon" aria-label="选择影视源" @click="sourceDialog=true"><Filter /></Button>
    <nav class="watch-mobile-nav" aria-label="观影导航"><a href="/watch" aria-haspopup="dialog" :aria-expanded="sourceDialog" :aria-current="!isHistory?'page':undefined" @click.prevent="openSites"><Film /><span>影视站</span></a><a href="/watch/history" :aria-current="isHistory?'page':undefined" @click.prevent="navigate('/watch/history')"><UserRound /><span>我的</span></a><a href="/admin" @click.prevent="emit('close')"><Settings2 /><span>管理后台</span></a></nav>
    <Dialog v-model:open="sourceDialog"><DialogContent class="watch-theme dark watch-source-dialog"><DialogHeader><DialogTitle>选择影视源</DialogTitle><DialogDescription class="sr-only">选择已启用的源浏览影片。</DialogDescription></DialogHeader><InputGroup><InputGroupInput v-model="sourceQuery" placeholder="搜索源" aria-label="搜索影视源" /><InputGroupAddon><Search /></InputGroupAddon></InputGroup><Field><FieldLabel class="sr-only" for="watch-source-language">源类型</FieldLabel><NativeSelect id="watch-source-language" v-model="sourceLanguage"><option value="all">全部类型</option><option v-for="(name,key) in languageLabels" :key="key" :value="key">{{name}}</option></NativeSelect></Field><div class="watch-source-list"><button v-for="item in pickerSources" :key="item.id" @click="selectSource(item.id)"><Film /><span>{{item.name}}</span><Badge>{{languageLabels[engineLanguage(item.script?.engine)]}}</Badge><Check v-if="item.id===source?.id" /></button><p v-if="!pickerSources.length">没有匹配的源</p></div></DialogContent></Dialog>
    <Dialog v-model:open="episodeDialog"><DialogContent class="watch-theme dark watch-episode-dialog"><DialogHeader><DialogTitle>选集</DialogTitle><DialogDescription class="sr-only">{{detail?.vod_name}}</DialogDescription></DialogHeader><Tabs v-if="lines.length>1" :model-value="String(lineIndex)" @update:model-value="chooseEpisode(0,Number($event))"><TabsList class="watch-line-tabs"><TabsTrigger v-for="(line,index) in lines" :key="index" :value="String(index)">{{line.name}}</TabsTrigger></TabsList></Tabs><div class="watch-episode-list"><button v-for="episode in episodes" :key="episode.index" class="watch-episode" :aria-current="episode.index===currentEpisode?.index?'true':undefined" @click="chooseEpisode(episode.index)">{{episode.name}}</button></div></DialogContent></Dialog>
  </div>
</template>
