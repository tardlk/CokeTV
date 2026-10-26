import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {mount, flushPromises} from '@vue/test-utils';
import {defineComponent} from 'vue';
import WatchApp from '../../web/WatchApp.vue';
import {registerUI} from '../../web/register-ui.js';
import {playlists} from '../../web/watch-model.js';

let wrapper, api, pending;
// 轻量替身：真实 WebPlayer 会拉起 ArtPlayer/HLS.js，这里只暴露 media prop 供断言。
const PlayerStub = defineComponent({name: 'WebPlayer', props: ['media', 'resume', 'previous', 'next'], template: '<div class="player-stub" />'});
const sources = [{id: 'a', name: '测试源', enabled: true, searchable: true, filterable: true, script: {engine: 'dr3'}}, {id: 'disabled', name: '停用源', enabled: false, script: {engine: 'py'}}];
const detail = {vod_id: 'one', vod_name: '样本电影', vod_content: '<p>影片简介</p>', vod_play_from: '主线$$$备用', vod_play_url: '第1集$https://fixture.invalid/1.m3u8#第2集$https://fixture.invalid/2.mp4$$$正片$https://fixture.invalid/backup.mp4'};
beforeEach(() => {
    localStorage.clear(); history.replaceState({}, '', '/watch?source=a');
    window.scrollTo = vi.fn(); window.HTMLElement.prototype.scrollIntoView = vi.fn();
    api = vi.fn(async (url, body) => {
        if (url.endsWith('/play')) return pending ? await pending : {url: '/watch/media/fixture', type: 'm3u8'};
        if (url.includes('ac=detail')) return {list: [detail]};
        return {class: [{type_id: 'movie', type_name: '电影'}], list: [{vod_id: 'one', vod_name: '样本电影'}], pagecount: 2};
    });
    pending = null;
});
afterEach(() => { wrapper?.unmount(); document.body.innerHTML = ''; localStorage.clear(); history.replaceState({}, '', '/'); });
async function start(path, mockSources = sources, mockApi = api) {
    if (path) history.replaceState({}, '', path);
    wrapper = mount(WatchApp, {props: {sources: mockSources, api: mockApi}, attachTo: document.body, global: {plugins: [{install: registerUI}], stubs: {WebPlayer: PlayerStub}}});
    await flushPromises(); return wrapper;
}
function button(text) { return wrapper.findAll('button').find(item => item.text().trim() === text); }
describe('网页观影流程', () => {
    it('TVBox 多线路与剧集 ID 保持完整，包括 URL 中的美元符', () => {
        expect(playlists({...detail, vod_play_url: '正片$https://fixture.invalid/a$b'}).at(0).episodes[0].id).toBe('https://fixture.invalid/a$b');
        expect(playlists(detail).map(item => item.episodes.length)).toEqual([2, 1]);
    });
    it('浏览、搜索、详情、选集、切换线路和收藏形成完整流程', async () => {
        await start(); expect(wrapper.findAll('.watch-video-card')).toHaveLength(1);
        await wrapper.find('[aria-label="搜索影片"]').setValue('样本'); await wrapper.find('form').trigger('submit'); await flushPromises();
        expect(api.mock.calls.some(([url]) => url.includes('wd=%E6%A0%B7%E6%9C%AC'))).toBe(true);
        await wrapper.find('.watch-video-card button').trigger('click'); await flushPromises();
        expect(location.pathname).toBe('/watch/play'); expect(wrapper.find('h1').text()).toBe('样本电影');
        expect(api).toHaveBeenCalledWith('/watch/sources/a/play', {play: 'https://fixture.invalid/1.m3u8', flag: '主线'});
        await button('第2集').trigger('click'); await flushPromises();
        expect(api).toHaveBeenLastCalledWith('/watch/sources/a/play', {play: 'https://fixture.invalid/2.mp4', flag: '主线'});
        await wrapper.findAll('[role="tab"]').find(item => item.text() === '备用').trigger('mousedown', {button: 0}); await flushPromises();
        expect(api).toHaveBeenLastCalledWith('/watch/sources/a/play', {play: 'https://fixture.invalid/backup.mp4', flag: '备用'});
        await wrapper.find('[aria-label="收藏影片"]').trigger('click'); expect(JSON.parse(localStorage.getItem('coketv-watch-favorites'))[0].vod).toBe('one');
        expect(wrapper.find('[aria-label="取消收藏"]').exists()).toBe(true);
    });
    it('点击搜索框打开下拉，点击搜索图标提交关键词并显示搜索状态', async () => {
        await start();
        await wrapper.find('[aria-label="搜索影片"]').trigger('focus'); await flushPromises();
        expect(document.querySelector('.watch-search-panel').textContent).toContain('在 测试源 中搜索');
        await wrapper.find('[aria-label="搜索影片"]').setValue(' 样本 ');
        await wrapper.find('[aria-label="提交搜索"]').trigger('click'); await flushPromises();
        expect(new URLSearchParams(location.search).get('search')).toBe('样本');
        expect(api).toHaveBeenLastCalledWith('/watch/sources/a?wd=%E6%A0%B7%E6%9C%AC&pg=1');
        expect(wrapper.find('.watch-search-status').text()).toContain('“样本”');
        expect(JSON.parse(localStorage.getItem('coketv-search-history'))).toEqual(['样本']);
        await wrapper.find('[aria-label="搜索影片"]').trigger('click'); await flushPromises();
        expect(document.querySelector('.watch-search-panel').textContent).toContain('搜索记录');
    });
    it('搜索按钮和回车使用同一表单入口，首页失败也不阻止搜索', async () => {
        api.mockImplementation(async url => {
            if (!url.includes('wd=')) throw new Error('首页不可用');
            return {list: [{vod_id: 'one', vod_name: '搜索成功'}], pagecount: 1};
        });
        await start(); expect(wrapper.text()).toContain('首页不可用');
        await wrapper.find('[aria-label="搜索影片"]').setValue('成功');
        const submit = wrapper.find('.watch-search button[type="submit"]');
        expect(submit.text()).toBe('搜索'); submit.element.click(); await flushPromises();
        expect(wrapper.find('.watch-video-card').text()).toBe('搜索成功');
        expect(wrapper.find('.watch-error').exists()).toBe(false);
        expect(api).toHaveBeenLastCalledWith('/watch/sources/a?wd=%E6%88%90%E5%8A%9F&pg=1');
    });
    it('无首页目录的源引导搜索，并显示来源限制；返回首页不会残留搜索提示', async () => {
        api.mockImplementation(async url => url.includes('wd=')
            ? {list: [{vod_id: 'one', vod_name: '希望'}], pagecount: 1, notice: '仅提供前7条搜索建议。'}
            : {class: [], list: [], notice: '网站验证阻止首页读取，搜索仍可使用。'});
        await start();
        expect(wrapper.text()).toContain('网站验证阻止首页读取，搜索仍可使用。');
        expect(wrapper.text()).not.toContain('暂无影片');
        await button('搜索影片').trigger('click'); await flushPromises();
        expect(document.activeElement).toBe(wrapper.find('[aria-label="搜索影片"]').element);
        expect(api).toHaveBeenCalledTimes(1);
        await wrapper.find('[aria-label="搜索影片"]').setValue('希望');
        await wrapper.find('form').trigger('submit'); await flushPromises();
        expect(wrapper.find('.watch-video-card').text()).toBe('希望');
        expect(wrapper.text()).toContain('仅提供前7条搜索建议。');
        expect(wrapper.text()).not.toContain('网站验证阻止首页读取');
        await button('返回首页').trigger('click'); await flushPromises();
        expect(wrapper.text()).toContain('网站验证阻止首页读取');
        expect(wrapper.text()).not.toContain('仅提供前7条搜索建议。');
    });
    it('无分类的空首页提供搜索入口，普通空分类和不可搜索源保留切换源提示', async () => {
        api.mockResolvedValue({class: [], list: []});
        await start();
        expect(wrapper.text()).toContain('此源暂未提供首页影片，请输入片名搜索。');
        expect(button('搜索影片')).toBeDefined();
        await wrapper.setProps({sources: [{...sources[0], searchable: false}]});
        expect(button('搜索影片')).toBeUndefined();
        expect(wrapper.text()).toContain('暂无影片');
        wrapper.unmount(); document.body.innerHTML = '';
        api.mockResolvedValue({class: [{type_id: 'movie', type_name: '电影'}], list: []});
        await start('/watch?source=a&category=movie');
        expect(button('搜索影片')).toBeUndefined();
        expect(wrapper.text()).toContain('选择其他分类，或更换源。');
    });
    it('源的浏览提示只作为文本显示，拒绝将 HTML 注入页面', async () => {
        api.mockResolvedValue({class: [], list: [], notice: '<img src=x onerror="alert(1)">请输入片名搜索。'});
        await start();
        expect(wrapper.text()).toContain('请输入片名搜索。');
        expect(wrapper.find('img[src="x"]').exists()).toBe(false);
        expect(wrapper.find('[onerror]').exists()).toBe(false);
    });
    it('空搜索打开输入提示，不触发重复首页请求；不可搜索源提示切换', async () => {
        await start(); api.mockClear();
        await wrapper.find('[aria-label="提交搜索"]').trigger('click'); await flushPromises();
        expect(api).not.toHaveBeenCalled();
        expect(wrapper.find('[aria-label="搜索影片"]').attributes('aria-expanded')).toBe('true');
        await wrapper.setProps({sources: [{...sources[0], searchable: false}]});
        await wrapper.find('[aria-label="提交搜索"]').trigger('click'); await flushPromises();
        expect(document.querySelector('.watch-search-panel').textContent).toContain('此源不支持搜索');
        expect(api).not.toHaveBeenCalled();
    });
    it('桌面与手机影视站均打开选源，选源后进入对应首页', async () => {
        await start();
        await button('影视站').trigger('click'); await flushPromises();
        expect(document.querySelector('[role="dialog"]').textContent).toContain('选择影视源');
        document.querySelector('.watch-source-list button').click(); await flushPromises();
        expect(document.querySelector('[role="dialog"]')).toBeNull();
        expect(location.pathname).toBe('/watch');
        await wrapper.find('.watch-mobile-nav a[href="/watch"]').trigger('click'); await flushPromises();
        expect(document.querySelector('[role="dialog"]').textContent).toContain('选择影视源');
    });
    it('直接刷新播放页保留源、线路和选集，不进入管理页面', async () => {
        await start('/watch/play?source=a&vod=one&line=0&episode=1');
        expect(api).toHaveBeenLastCalledWith('/watch/sources/a/play', {play: 'https://fixture.invalid/2.mp4', flag: '主线'});
        expect(wrapper.find('.watch-episode[aria-current="true"]').text()).toBe('第2集');
        expect(wrapper.text()).toContain('影片简介');
    });
    it('停用源不会执行，用户可选择其他源', async () => {
        await start('/watch?source=disabled'); expect(api).not.toHaveBeenCalled(); expect(wrapper.text()).toContain('此源不存在或已停用');
        await wrapper.find('[aria-label="选择影视源"]').trigger('click'); await flushPromises();
        expect(document.querySelector('.watch-source-list').textContent).not.toContain('停用源');
    });
    it('解析失败显示原因，未配置解析时给出可执行提示', async () => {
        api.mockImplementation(async url => url.endsWith('/play') ? {needsParse: true, parses: []} : {list: [detail]});
        await start('/watch/play?source=a&vod=one');
        expect(wrapper.text()).toContain('此源需要解析，请在设置中添加解析服务或切换播放线路');
    });
    it('切换剧集时过期响应不会覆盖当前播放器', async () => {
        let resolveFirst;
        pending = new Promise(resolve => { resolveFirst = resolve; });
        await start('/watch/play?source=a&vod=one');
        pending = null; await button('第2集').trigger('click'); await flushPromises();
        resolveFirst({url: '/watch/media/stale'}); await flushPromises();
        expect(wrapper.find('.player-stub').exists()).toBe(true);
        const historyItem = JSON.parse(localStorage.getItem('coketv-watch-history'))[0];
        expect(historyItem.episode).toBe(1);
    });
    it('选集/切线路只解析播放、不重载详情、不重建播放器且保持自动播放', async () => {
        await start('/watch/play?source=a&vod=one');
        expect(api.mock.calls.filter(([url]) => url.includes('ac=detail'))).toHaveLength(1);
        const player = wrapper.findComponent(PlayerStub);
        expect(player.props('media').autoplay).toBe(false);
        const element = wrapper.find('.player-stub').element;
        api.mockClear();
        await button('第2集').trigger('click'); await flushPromises();
        expect(api.mock.calls.filter(([url]) => url.includes('ac=detail'))).toHaveLength(0);
        expect(api.mock.calls.filter(([url]) => url.endsWith('/play'))).toHaveLength(1);
        const after = wrapper.findComponent(PlayerStub);
        expect(after.props('media').autoplay).toBe(true);
        // 同一个 DOM 节点 ⇒ 播放器实例未被卸载重建，进度与设置得以保留。
        expect(wrapper.find('.player-stub').element).toBe(element);
    });

    it('导航源点击影片触发全源聚合搜索，结果分组并可切换源', async () => {
        const navigationSources = [
            {id: 'nav', name: '导航热播', enabled: true, searchable: false, navigation: true, script: {engine: 'dr3'}},
            {id: 'a', name: '搜索甲', enabled: true, searchable: true, filterable: false, script: {engine: 'dr3'}},
            {id: 'b', name: '搜索乙', enabled: true, searchable: true, filterable: false, script: {engine: 'dr3'}},
        ];
        const navigationApi = vi.fn(async (url, body) => {
            if (url === '/watch/sources/nav') return {class: [], list: [{vod_id: 'hot-1', vod_name: '测试片'}]};
            if (url.startsWith('/watch/search?')) return {query: '测试片', groups: [
                {source: {id: 'a', name: '搜索甲'}, results: [{vod_id: 'a-1', vod_name: '测试片 · 搜索甲'}], pagecount: 1},
                {source: {id: 'b', name: '搜索乙'}, results: [], pagecount: 0, error: '站点暂时不可用'},
            ], truncated: false};
            if (url.includes('ac=detail')) return {list: [detail]};
            if (url.endsWith('/play')) return {url: '/watch/media/fixture', type: 'm3u8'};
            return {class: [], list: []};
        });
        await start('/watch?source=nav', navigationSources, navigationApi);
        expect(wrapper.find('[aria-label="搜索影片"]').attributes('placeholder')).toBe('搜索全部源');
        expect(wrapper.findAll('.watch-video-card')).toHaveLength(1);
        await wrapper.find('.watch-video-card button').trigger('click'); await flushPromises();
        expect(new URLSearchParams(location.search).get('nav')).toBe('测试片');
        expect(navigationApi.mock.calls.some(([url]) => url.startsWith('/watch/search?'))).toBe(true);
        expect(wrapper.findAll('.watch-nav-group')).toHaveLength(2);
        expect(wrapper.text()).toContain('搜索甲');
        expect(wrapper.text()).toContain('站点暂时不可用');
        await wrapper.find('.watch-nav-group .watch-video-card button').trigger('click'); await flushPromises();
        expect(location.pathname).toBe('/watch/play');
        expect(new URLSearchParams(location.search).get('source')).toBe('a');
        expect(new URLSearchParams(location.search).get('vod')).toBe('a-1');
    });
});
