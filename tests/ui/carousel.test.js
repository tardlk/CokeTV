import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {mount, flushPromises} from '@vue/test-utils';
import {nextTick} from 'vue';
import WatchCarousel from '../../web/WatchCarousel.vue';
import WatchApp from '../../web/WatchApp.vue';
import {registerUI} from '../../web/register-ui.js';
const state = vi.hoisted(() => ({handlers: new Map(), index: 0, api: null}));
vi.mock('embla-carousel-vue', async () => {
    const {ref, shallowRef, onMounted} = await import('vue');
    return {default: () => {
        const api = {
            selectedScrollSnap: () => state.index,
            on: vi.fn((name, fn) => { state.handlers.set(name, fn); return api; }),
            off: vi.fn((name) => { state.handlers.delete(name); return api; }),
            scrollNext: vi.fn(), scrollPrev: vi.fn(), scrollTo: vi.fn(),
        };
        state.api = api;
        const instance = shallowRef(); onMounted(() => { instance.value = api; });
        return [ref(), instance];
    }};
});
const items = ['热播甲', '热播乙'].map(title => ({title, backgroundImage: 'https://tv.puui.qpic.cn/a.jpg', genre: '剧情', subtitle: '副标题', actors: '演员甲', description: '推荐简介'}));
let wrapper;
beforeEach(() => {
    state.handlers.clear(); state.index = 0;
    vi.useFakeTimers(); localStorage.clear(); history.replaceState({}, '', '/watch?source=a'); window.scrollTo = vi.fn();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    vi.stubGlobal('matchMedia', vi.fn(() => ({matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn()})));
});
afterEach(() => { wrapper?.unmount(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = ''; });
async function start(slides = items) { wrapper = mount(WatchCarousel, {props: {items: slides}}); await flushPromises(); }
describe('首页轮播交互', () => {
    it('导航脚本同时提供轮播与列表，不请求内置热播接口，换源后分别处理', async () => {
        const api = vi.fn(async url => url === '/watch/banner' ? {banner: items.slice(1)} : {class: [], list: [{vod_id:'one',vod_name:'脚本推荐'}], banner: items.slice(0,1)});
        const sources = [{id:'a',name:'导航',enabled:true,navigation:true}, {id:'b',name:'普通源',enabled:true,searchable:true}];
        wrapper = mount(WatchApp, {props:{sources,api},global:{plugins:[{install:registerUI}]},attachTo:document.body});
        await flushPromises(); expect(wrapper.find('.watch-carousel-title').text()).toBe('热播甲');
        expect(wrapper.find('.watch-video-card').text()).toContain('脚本推荐'); expect(api.mock.calls.some(([url])=>url==='/watch/banner')).toBe(false);
        history.replaceState({},'','/watch?source=b');window.dispatchEvent(new PopStateEvent('popstate'));await flushPromises();
        expect(api.mock.calls.filter(([url])=>url==='/watch/banner')).toHaveLength(1);
        expect(wrapper.find('.watch-carousel-title').text()).toBe('热播乙');
    });
    it('导航脚本没有轮播时不混入内置轮播，推荐仍可点击全源搜索', async () => {
        const api = vi.fn(async url => url.startsWith('/watch/search') ? {groups:[]} : {class:[],list:[{vod_id:'one',vod_name:'脚本推荐'}],banner:[]});
        wrapper = mount(WatchApp,{props:{sources:[{id:'a',name:'导航',enabled:true,navigation:true}],api},global:{plugins:[{install:registerUI}]},attachTo:document.body});
        await flushPromises();expect(wrapper.find('.watch-carousel').exists()).toBe(false);
        await wrapper.find('.watch-video-card button').trigger('click');await flushPromises();
        expect(new URLSearchParams(location.search).get('nav')).toBe('脚本推荐');expect(api.mock.calls.some(([url])=>url==='/watch/banner')).toBe(false);
    });
    it('呈现标题、标签、描述、箭头和圆点，点击传递热播片名', async () => {
        await start(); expect(wrapper.findAll('.watch-carousel-slide')).toHaveLength(2);
        expect(wrapper.find('.watch-carousel-copy').text()).toContain('副标题演员甲推荐简介');
        expect(wrapper.find('img').attributes('referrerpolicy')).toBe('no-referrer');
        await wrapper.find('.watch-carousel-card').trigger('click'); expect(wrapper.emitted('select')[0][0].title).toBe('热播甲');
    });
    it('箭头、圆点和键盘操作同一个轮播，拖动后的点击不误触搜索', async () => {
        await start(); await wrapper.find('[aria-label="下一张轮播图"]').trigger('click'); expect(state.api.scrollNext).toHaveBeenCalledOnce();
        await wrapper.find('[aria-label="上一张轮播图"]').trigger('click'); expect(state.api.scrollPrev).toHaveBeenCalledOnce();
        await wrapper.find('[aria-label="切换到第 2 张轮播图"]').trigger('click'); expect(state.api.scrollTo).toHaveBeenCalledWith(1);
        await wrapper.find('section').trigger('keydown', {key: 'ArrowRight'}); expect(state.api.scrollNext).toHaveBeenCalledTimes(2);
        state.index = 1; state.handlers.get('select')(state.api); await nextTick();
        expect(wrapper.find('[aria-current="true"]').attributes('aria-label')).toContain('第 2 张');
        expect(wrapper.findAll('.watch-carousel-card')[0].attributes('tabindex')).toBe('-1');
        const cancelled = new MouseEvent('click', {bubbles: true, cancelable: true}); cancelled.preventDefault();
        wrapper.findAll('.watch-carousel-card')[1].element.dispatchEvent(cancelled); expect(wrapper.emitted('select')).toBeUndefined();
    });
    it('五秒自动切换，隐藏或减少动态效果时暂停，离开后清除定时器', async () => {
        await start(); await vi.advanceTimersByTimeAsync(5000); expect(state.api.scrollNext).toHaveBeenCalledOnce();
        vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
        await vi.advanceTimersByTimeAsync(5000); expect(state.api.scrollNext).toHaveBeenCalledOnce();
        vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
        vi.mocked(window.matchMedia).mockReturnValue({matches: true});
        await vi.advanceTimersByTimeAsync(5000); expect(state.api.scrollNext).toHaveBeenCalledOnce();
        wrapper.unmount(); expect(vi.getTimerCount()).toBe(0); wrapper = null;
    });
    it('单张不显示切换控件，也不启动自动切换', async () => {
        await start(items.slice(0, 1)); expect(wrapper.find('.watch-carousel-dots').exists()).toBe(false);
        await vi.advanceTimersByTimeAsync(10000); expect(state.api.scrollNext).not.toHaveBeenCalled();
    });
    it('热播点击进入全源搜索，返回首页复用海报，不在分类和搜索页展示', async () => {
        const api = vi.fn(async url => url === '/watch/banner' ? {banner: items} : url.startsWith('/watch/search') ? {groups: []} : {class: [{type_id: 'movie', type_name: '电影'}], list: []});
        wrapper = mount(WatchApp, {props: {sources: [{id: 'a', name: '源A', enabled: true, searchable: false}], api}, global: {plugins: [{install: registerUI}]}, attachTo: document.body});
        await flushPromises(); await wrapper.find('.watch-carousel-card').trigger('click'); await flushPromises();
        expect(new URLSearchParams(location.search).get('nav')).toBe('热播甲'); expect(api).toHaveBeenLastCalledWith('/watch/search?wd=%E7%83%AD%E6%92%AD%E7%94%B2&pg=1');
        expect(wrapper.find('.watch-carousel').exists()).toBe(false);
        await wrapper.find('.watch-brand').trigger('click'); await flushPromises();
        expect(wrapper.find('.watch-carousel').exists()).toBe(true); expect(api.mock.calls.filter(([url]) => url === '/watch/banner')).toHaveLength(1);
        await wrapper.findAll('[role="tab"]').find(v => v.text() === '电影').trigger('mousedown', {button: 0}); await flushPromises();
        expect(wrapper.find('.watch-carousel').exists()).toBe(false);
    });
});
