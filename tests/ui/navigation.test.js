import {test, expect, vi, beforeEach, afterEach} from 'vitest';
import {mount, flushPromises} from '@vue/test-utils';
import App from '../../web/App.vue';
import {registerUI} from '../../web/register-ui.js';
vi.mock('../../web/CodeEditor.vue', () => ({__esModule: true, default: {props: ['modelValue'], emits: ['update:modelValue'], template: '<textarea class="editor-code" :value="modelValue" @input="$emit(\'update:modelValue\',$event.target.value)" />'}}));
vi.mock('../../web/WatchApp.vue', () => ({__esModule: true, default: {props: ['sources', 'api'], template: '<div class="public-watch">public watch</div>'}}));
let wrapper, requests;
beforeEach(() => {
    window.matchMedia = vi.fn(() => ({matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}}));
    global.ResizeObserver = class {observe() {} unobserve() {} disconnect() {}};
    sessionStorage.setItem('coketv-access', btoa(':fixture-password'));
    history.replaceState({}, '', '/sources/source/edit');
    const source = {id: 'source', scriptId: 'script', name: 'sample', params: '', enabled: true, searchable: true, filterable: false};
    const state = {instances: [source], scripts: [{id: 'script', engine: 'js', file: 'sample.js'}], subscriptions: [], settings: {publicUrl: '', timeout: 30000, env: {}, plugins: [], parses: [], lives: []}};
    requests = [];
    vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
        requests.push({url, method: options.method});
        const value = url === '/access/status' ? {requiresSetup: false} : url === '/admin/state' ? state : url === '/admin/scripts/script' ? {id: 'script', file: 'sample.js', engine: 'js', code: 'var rule={};', revisions: []} : url === '/watch/sources' ? [{...source, script: {engine: 'js'}}] : {values: {sample: 'original'}, defaults: {}};
        return {ok: true, json: async () => structuredClone(value)};
    }));
});
afterEach(() => {wrapper?.unmount(); document.body.innerHTML = ''; sessionStorage.clear(); history.replaceState({}, '', '/'); vi.unstubAllGlobals();});
const button = text => [...document.querySelectorAll('button')].find(item => item.textContent.trim() === text);
async function start() {
    wrapper = mount(App, {attachTo: document.body, global: {plugins: [{install: registerUI}]}});
    await vi.waitFor(() => expect(wrapper.find('.editor-code').exists()).toBe(true));
}
test.each(['params', 'env', 'code'])('浏览器返回时保护未保存的 %s，取消保留内容、确认才离开', async kind => {
    await start();
    let selector;
    if (kind === 'params') {button('扩展参数').click(); await flushPromises(); selector = '#source-params';}
    else selector = kind === 'env' ? '[aria-label="变量值 1"]' : '.editor-code';
    await wrapper.find(selector).setValue('unsaved-changes');
    history.replaceState({}, '', '/'); window.dispatchEvent(new PopStateEvent('popstate'));
    await flushPromises();
    expect(wrapper.find('.workspace-shell').exists()).toBe(true);
    expect(document.body.textContent).toContain('放弃未保存的修改？');
    expect(location.pathname).toBe('/sources/source/edit');
    button('继续编辑').click(); await flushPromises();
    expect(wrapper.find(selector).element.value).toBe('unsaved-changes');
    history.replaceState({}, '', '/'); window.dispatchEvent(new PopStateEvent('popstate'));
    await flushPromises(); button('放弃并返回').click(); await flushPromises();
    await vi.waitFor(() => expect(wrapper.find('.public-watch').exists()).toBe(true));
    expect(location.pathname).toBe('/');
    expect(requests.some(item => item.method === 'PUT' || item.method === 'POST')).toBe(false);
});
test('没有修改时浏览器返回管理页会退出编辑器，页面与 URL 一致', async () => {
    await start(); history.replaceState({}, '', '/admin'); window.dispatchEvent(new PopStateEvent('popstate'));
    await flushPromises();
    expect(wrapper.find('.workspace-shell').exists()).toBe(false);
    expect(wrapper.find('.source-table').exists()).toBe(true);
});
test.each(['back', 'forward'])('真实 history.%s 的取消与确认保持历史位置和编辑内容', async direction => {
    history.replaceState({'coketv-position': 0}, '', '/admin');
    history.pushState({'coketv-position': 1}, '', '/sources/source/edit');
    if (direction === 'forward') {
        history.pushState({'coketv-position': 2}, '', '/'); history.back();
        await vi.waitFor(() => expect(location.pathname).toBe('/sources/source/edit'));
    }
    await start(); await wrapper.find('.editor-code').setValue('changed-code');
    history[direction]();
    await vi.waitFor(() => {
        expect(document.body.textContent).toContain('放弃未保存的修改？');
        expect(location.pathname).toBe('/sources/source/edit');
    });
    button('继续编辑').click(); await flushPromises();
    expect(wrapper.find('.editor-code').element.value).toBe('changed-code');
    history[direction]();
    await vi.waitFor(() => {
        expect(document.body.textContent).toContain('放弃未保存的修改？');
        expect(location.pathname).toBe('/sources/source/edit');
    });
    button('放弃并返回').click();
    await vi.waitFor(() => {
        expect(location.pathname).toBe(direction === 'back' ? '/admin' : '/');
        expect(wrapper.find('.workspace-shell').exists()).toBe(false);
    });
    history[direction === 'back' ? 'forward' : 'back']();
    await vi.waitFor(() => expect(wrapper.find('.editor-code').exists()).toBe(true));
    expect(location.pathname).toBe('/sources/source/edit');
    expect(wrapper.find('.editor-code').element.value).toBe('var rule={};');
});
