import axios from 'axios';
import {load} from 'cheerio';

export function parseCmsResponse(body, type) {
    if (Number(type) === 0) {
        const $ = load(String(body), {xmlMode: true});
        if (!$('rss').length || !$('list').length) throw new Error('接口没有返回 TVBox XML 采集数据');
        const text = (node, key) => $(node).children(key).first().text().trim();
        const list = $('list > video').toArray().map(node => {
            const groups = $(node).find('dl > dd').toArray();
            return {vod_id: text(node, 'id'), vod_name: text(node, 'name'), vod_pic: text(node, 'pic'),
                vod_remarks: text(node, 'note'), type_id: text(node, 'tid'), type_name: text(node, 'type'),
                vod_year: text(node, 'year'), vod_area: text(node, 'area'), vod_actor: text(node, 'actor'),
                vod_director: text(node, 'director'), vod_content: text(node, 'des'),
                vod_play_from: groups.map(group => $(group).attr('flag') || '线路').join('$$$'),
                vod_play_url: groups.map(group => $(group).text().trim()).join('$$$')};
        });
        const classes = $('class > ty').toArray().map(node => ({type_id: $(node).attr('id'), type_name: $(node).text().trim()}));
        return {class: classes, list, page: Number($('list').attr('page')) || 1,
            pagecount: Number($('list').attr('pagecount')) || 1, total: Number($('list').attr('recordcount')) || list.length};
    }
    let data = body;
    if (typeof data === 'string') { try { data = JSON.parse(data.replace(/^\uFEFF/, '')); } catch { throw new Error('接口没有返回有效的 JSON 采集数据'); } }
    if (!data || typeof data !== 'object' || !Array.isArray(data.list)) throw new Error('接口没有返回 TVBox JSON 采集数据');
    if (data.list.some(item => !item || typeof item !== 'object' || !('vod_id' in item) || !('vod_name' in item))) throw new Error('接口影片字段不符合 TVBox 采集协议');
    return {...data, class: Array.isArray(data.class) ? data.class : [], page: Number(data.page) || 1, pagecount: Number(data.pagecount) || 1};
}
export function cmsScript(config) {
    return `// CokeTV TVBox 采集源 · lang: 'catvod'\nimport {createCmsSpider} from '../../utils/tvbox-cms.js';\nconst spider = createCmsSpider(${JSON.stringify(config, null, 2)});\nexport function __jsEvalReturn() { return spider; }\n`;
}
export function createCmsSpider(config) {
    let cachedHome;
    async function request(query = {}) {
        const url = new URL(config.api);
        for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
        const response = await axios.get(url.href, {responseType: 'text', timeout: 20000, maxContentLength: 8 * 1024 * 1024,
            headers: {'User-Agent': 'Mozilla/5.0', ...(config.headers || {})}});
        const data = parseCmsResponse(response.data, config.type);
        const base = response.request?.res?.responseUrl || url.href;
        data.list = data.list.map(item => {
            if (typeof item.vod_pic !== 'string' || !item.vod_pic.trim()) return item;
            try {
                const picture = new URL(item.vod_pic.trim(), base);
                return ['http:', 'https:'].includes(picture.protocol) ? {...item, vod_pic: picture.href} : item;
            } catch { return item; }
        });
        if (config.categories?.length && data.class.length) data.class = data.class.filter(item => config.categories.includes(item.type_name));
        return data;
    }
    return {
        init: async () => { cachedHome = undefined; },
        home: async () => { cachedHome = await request(); return {class: cachedHome.class, filters: {}}; },
        homeVod: async () => {
            const data = cachedHome || await request();
            if (!data.list.length || data.list.every(item => typeof item.vod_pic === 'string' && item.vod_pic.trim())) return {list: data.list};
            const full = await request({ac: Number(config.type) === 0 ? 'videolist' : 'detail', pg: 1});
            return {list: full.list};
        },
        category: async (tid, pg) => request({ac: Number(config.type) === 0 ? 'videolist' : 'detail', t: tid, pg}),
        detail: async id => request({ac: Number(config.type) === 0 ? 'videolist' : 'detail', ids: id}),
        search: async (wd, quick, pg) => request({ac: Number(config.type) === 0 ? 'videolist' : 'detail', wd, pg}),
        play: async (flag, id) => {
            const direct = /\.(m3u8|mp4|m4v|webm|mov|flv|ts|mp3|m4a|aac)(?:[?#]|$)/i.test(id);
            return {parse: direct || /m3u8|mp4|直链/i.test(flag) ? 0 : 1, url: id, ...(config.playHeaders ? {header: config.playHeaders} : {})};
        },
    };
}
