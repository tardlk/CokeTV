import {beforeEach, afterEach, describe, it, vi, expect} from 'vitest';
import {mount, flushPromises} from '@vue/test-utils';
import App from '../../web/App.vue';
import {registerUI} from '../../web/register-ui.js';
vi.mock('../../web/WatchApp.vue', () => ({__esModule: true, default: {props: ['sources', 'api'], emits: ['close'], template: '<div class="public-watch"><button @click="$emit(\'close\')">管理后台</button><span v-for="source in sources">{{source.name}}</span></div>'}}));
vi.mock('../../web/SourceWorkspace.vue', () => ({__esModule: true, default: {props: ['source'], template: '<div class="workspace-shell">编辑 {{source.name}}</div>'}}));
let wrapper, requests, setup;
const publicSources = [{id: 'source', name: '公开影视源', enabled: true, searchable: true, filterable: true, script: {engine: 'js'}}];
const adminState = {scripts: [{id: 'script', engine: 'js', file: '源.js'}], instances: [{id: 'source', name: '公开影视源', scriptId: 'script', enabled: true}], subscriptions: [], settings: {publicUrl: '', timeout: 30000, env: {}, plugins: [], parses: [], lives: []}};
beforeEach(() => {
    requests = []; setup = false; sessionStorage.clear(); history.replaceState({}, '', '/');
    window.matchMedia = vi.fn(() => ({matches: false, addEventListener() {}, removeEventListener() {}}));
    global.ResizeObserver = class {observe() {} unobserve() {} disconnect() {}};
    vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
        requests.push({url, options});
        if (url === '/watch/sources') return {ok: true, json: async () => publicSources};
        if (url === '/access/status') return {ok: true, json: async () => ({requiresSetup: setup})};
        if (url === '/admin/state') {
            const ok = options.headers?.Authorization === 'Basic ' + btoa(':admin-password');
            return {ok, status: ok ? 200 : 401, json: async () => ok ? adminState : {error: '访问密码不正确'}};
        }
        return {ok: true, json: async () => ({})};
    }));
});
afterEach(() => { wrapper?.unmount(); document.body.innerHTML = ''; sessionStorage.clear(); history.replaceState({}, '', '/'); vi.unstubAllGlobals(); });
async function start(path = '/') {
    history.replaceState({}, '', path);
    wrapper = mount(App, {attachTo: document.body, global: {plugins: [{install: registerUI}]}});
    await flushPromises();
}
describe('观影公开，管理需要密码', () => {
    it.each(['/', '/watch', '/watch/play?source=source&vod=one', '/watch/history'])('%s 匿名直接进入观影，不读取管理状态或发送管理凭据', async path => {
        await start(path);
        expect(wrapper.find('.public-watch').text()).toContain('公开影视源');
        expect(wrapper.find('#login-password').exists()).toBe(false);
        expect(requests.map(item => item.url)).toEqual(['/watch/sources']);
        expect(requests[0].options.headers.Authorization).toBeUndefined();
        expect(requests[0].options.credentials).toBe('omit');
    });
    it('首次打开首页不要求创建密码；进入管理后台才出现首次设置', async () => {
        setup = true; await start();
        expect(wrapper.find('.public-watch').exists()).toBe(true);
        expect(wrapper.find('#new-password').exists()).toBe(false);
        await wrapper.find('.public-watch button').trigger('click'); await flushPromises();
        expect(location.pathname).toBe('/admin'); expect(wrapper.find('#new-password').exists()).toBe(true);
        expect(requests.some(item => item.url === '/admin/state')).toBe(false);
        await wrapper.findAll('button').find(item => item.text() === '返回观影').trigger('click'); await flushPromises();
        expect(location.pathname).toBe('/'); expect(wrapper.find('.public-watch').exists()).toBe(true);
    });
    it('进入管理才输入密码，登录后能管理，退出清除凭据并可返回匿名观影', async () => {
        await start(); await wrapper.find('.public-watch button').trigger('click'); await flushPromises();
        expect(wrapper.find('#login-password').exists()).toBe(true); expect(wrapper.find('.source-table').exists()).toBe(false);
        await wrapper.find('#login-password').setValue('admin-password'); await wrapper.find('form').trigger('submit'); await flushPromises();
        expect(wrapper.find('.source-table').exists()).toBe(true);
        await wrapper.find('[aria-label="退出"]').trigger('click'); await flushPromises();
        expect(sessionStorage.getItem('coketv-access')).toBeNull(); expect(wrapper.find('#login-password').exists()).toBe(true);
        await wrapper.findAll('button').find(item => item.text() === '返回观影').trigger('click'); await flushPromises();
        expect(wrapper.find('.public-watch').exists()).toBe(true);
        expect(requests.at(-1).options.headers.Authorization).toBeUndefined();
    });
    it.each(['/admin', '/sources/source/edit'])('直接访问 %s 也必须管理密码登录', async path => {
        await start(path); expect(wrapper.find('#login-password').exists()).toBe(true);
        expect(wrapper.find('.workspace-shell').exists()).toBe(false);
        expect(wrapper.find('.public-watch').exists()).toBe(false);
    });
    it('已有管理凭据也不附带到公开观影请求', async () => {
        sessionStorage.setItem('coketv-access', btoa(':admin-password')); await start();
        expect(requests.map(item => item.url)).toEqual(['/watch/sources']);
        expect(requests[0].options.headers.Authorization).toBeUndefined();
    });
});
