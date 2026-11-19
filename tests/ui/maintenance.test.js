import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {mount, flushPromises} from '@vue/test-utils';
import MaintenancePanel from '../../web/MaintenancePanel.vue';
import {registerUI} from '../../web/register-ui.js';

let wrapper, requests, downloads;
const entries = [
    {time: '2026-10-26T02:00:00.000Z', level: 'info', source: 'service', message: '服务已启动'},
    {time: '2026-10-26T02:01:00.000Z', level: 'error', source: 'http', message: '源执行失败'},
    {time: '2026-10-26T02:02:00.000Z', level: 'info', category: 'playback', message: '取链成功 · NAS 转发', sourceName: '样本源', clientIp: '192.168.1.20', client: 'FongMi', title: '样本影片', episode: '第1集', requestId: 'req-a'},
];
const backup = {name: 'coketv-20261026-020000-abcdef.zip', size: 2048, time: '2026-10-26T02:00:00.000Z'};

beforeEach(() => {
    requests = []; downloads = [];
    global.ResizeObserver = class {observe() {} unobserve() {} disconnect() {}};
    window.matchMedia = vi.fn(() => ({matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}}));
    HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { wrapper?.unmount(); document.body.innerHTML = ''; vi.useRealTimers(); });

async function start() {
    const api = vi.fn(async (url, body) => {
        requests.push({url, body});
        if (url === '/admin/logs?limit=400') return structuredClone(entries);
        if (url === '/admin/backups' && body === undefined) return {items: [backup], keep: 7, intervalHours: 24, last: backup};
        if (url === '/admin/backups' && body) return {ok: true, backup};
        return {ok: true};
    });
    wrapper = mount(MaintenancePanel, {attachTo: document.body, props: {api, download: (url, name) => downloads.push({url, name})}, global: {plugins: [{install: registerUI}]}});
    await flushPromises();
}
const button = text => [...document.querySelectorAll('button')].find(item => item.textContent.trim() === text);

describe('运行维护页面', () => {
    it('展示日志、按级别过滤并下载已脱敏日志', async () => {
        await start();
        expect(document.body.textContent).toContain('服务已启动');
        expect(document.body.textContent).toContain('源执行失败');
        const select = document.querySelector('[aria-label="日志级别"]');
        select.value = 'error'; select.dispatchEvent(new Event('change', {bubbles: true})); await flushPromises();
        expect(document.querySelector('.log-panel').textContent).toContain('源执行失败');
        expect(document.querySelector('.log-panel').textContent).not.toContain('服务已启动');
        button('下载日志').click(); await flushPromises();
        expect(downloads).toContainEqual({url: '/admin/logs/download', name: 'coketv-logs.txt'});
    });

    it('展示快照列表，可立即创建并下载', async () => {
        await start();
        const tab = [...document.querySelectorAll('[role="tab"]')].find(item => item.textContent.trim() === '数据快照');
        tab.focus(); tab.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true})); await flushPromises();
        expect(document.body.textContent).toContain(backup.name);
        expect(document.body.textContent).toContain('2.0 KB');
        button('立即快照').click(); await flushPromises();
        expect(requests.some(request => request.url === '/admin/backups' && request.body)).toBe(true);
        const download = document.querySelector(`[aria-label="下载快照 ${backup.name}"]`);
        download.click(); await flushPromises();
        expect(downloads).toContainEqual({url: `/admin/backups/${backup.name}`, name: backup.name});
    });

    it('按类型与IP筛选并展示客户端、源和剧集', async () => {
        await start();
        const select = document.querySelector('[aria-label="日志类型"]');
        select.value = 'playback'; select.dispatchEvent(new Event('change', {bubbles: true})); await flushPromises();
        const panel = () => document.querySelector('.log-panel').textContent;
        expect(panel()).toContain('192.168.1.20'); expect(panel()).toContain('FongMi'); expect(panel()).toContain('样本源');
        expect(panel()).toContain('样本影片'); expect(panel()).toContain('第1集'); expect(panel()).not.toContain('服务已启动');
        const search = wrapper.find('[aria-label="过滤日志"]');
        await search.setValue('192.168.1.99'); expect(panel()).toContain('暂无日志');
        await search.setValue('192.168.1.20'); expect(panel()).toContain('NAS 转发');
    });

    it('自动刷新可关闭，切换快照及卸载后停止轮询', async () => {
        vi.useFakeTimers({toFake: ['setInterval', 'clearInterval']});
        await start();
        const count = () => requests.filter(request => request.url === '/admin/logs?limit=400').length;
        await vi.advanceTimersByTimeAsync(5000); expect(count()).toBe(2);
        await wrapper.find('[aria-label="自动刷新日志"]').setValue(false);
        await vi.advanceTimersByTimeAsync(10000); expect(count()).toBe(2);
        await wrapper.find('[aria-label="自动刷新日志"]').setValue(true);
        const tab = [...document.querySelectorAll('[role="tab"]')].find(item => item.textContent.trim() === '数据快照');
        tab.focus(); tab.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true})); await flushPromises();
        await vi.advanceTimersByTimeAsync(5000); expect(count()).toBe(2);
        wrapper.unmount(); wrapper = null;
        expect(vi.getTimerCount()).toBe(0);
    });
});
