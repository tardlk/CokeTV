import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {mount, flushPromises} from '@vue/test-utils';
import MaintenancePanel from '../../web/MaintenancePanel.vue';
import {registerUI} from '../../web/register-ui.js';

let wrapper, requests, downloads;
const entries = [
    {time: '2026-10-26T02:00:00.000Z', level: 'info', source: 'service', message: '服务已启动'},
    {time: '2026-10-26T02:01:00.000Z', level: 'error', source: 'http', message: '源执行失败'},
];
const backup = {name: 'coketv-20261026-020000-abcdef.zip', size: 2048, time: '2026-10-26T02:00:00.000Z'};

beforeEach(() => {
    requests = []; downloads = [];
    global.ResizeObserver = class {observe() {} unobserve() {} disconnect() {}};
    window.matchMedia = vi.fn(() => ({matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}}));
    HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { wrapper?.unmount(); document.body.innerHTML = ''; });

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
});
