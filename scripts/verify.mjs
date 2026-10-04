import fs from 'fs/promises';
import path from 'path';
import {ROOT} from '../src/paths.js';
const source = process.argv[2];
if (!source) { console.error('用法：npm run verify -- <站点ID> [服务地址]'); process.exit(1); }
const base = process.argv[3] || 'http://127.0.0.1:54058';
const directory = process.env.DATA_DIR || path.join(ROOT, 'data');
const credentials = process.env.ADMIN_PASSWORD ? {username: process.env.ADMIN_USER || 'admin', password: process.env.ADMIN_PASSWORD} : JSON.parse(await fs.readFile(path.join(directory, 'admin.json')));
const headers = {Authorization: `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64')}`};
const get = async query => {
    const response = await fetch(`${base}/api/${encodeURIComponent(source)}?${new URLSearchParams(query)}`, {headers});
    const body = await response.json();
    if (!response.ok || body.error) throw new Error(body.error || `HTTP ${response.status}`);
    return body;
};
try {
    const home = await get({});
    console.log(`首页：${home.class?.length || 0} 个分类，${home.list?.length || 0} 个推荐`);
    let list = home.list;
    if (home.class?.length) { const category = await get({ac: 'list', t: home.class[0].type_id, pg: '1'}); list = category.list; console.log(`分类：${list?.length || 0} 个条目`); }
    if (list?.[0]?.vod_id) { const detail = await get({ac: 'detail', ids: list[0].vod_id}); console.log(`详情：${detail.list?.[0]?.vod_name || '无名称'}，${detail.list?.[0]?.vod_play_url ? '有播放列表' : '无播放列表'}`); }
} catch (error) { console.error(error.message); process.exitCode = 1; }

