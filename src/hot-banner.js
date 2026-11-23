import axios from 'axios';

const ENDPOINT = 'https://pbaccess.video.qq.com/trpc.vector_layout.page_view.PageService/getPage?video_appid=3000010&vversion_platform=2';
const TTL = 5 * 60000, RETRY = 60000, MAX_STALE = 24 * 3600000;
const clean = (value, max = 200) => typeof value === 'string' ? value.replace(/<[^>]*>/g, '').trim().slice(0, max) : '';

export function parseHotBanner(data) {
    const banner = [], seen = new Set();
    for (const block of Array.isArray(data?.data?.CardList) ? data.data.CardList : []) {
        if (block?.type !== 'pc_carousel') continue;
        for (const card of Array.isArray(block.children_list?.list?.cards) ? block.children_list.list.cards : []) {
            const item = card?.params, title = clean(item?.title || item?.title_pc);
            if (!title || seen.has(title)) continue;
            let image;
            try { image = new URL(item.pic_ori_2880x900); } catch { continue; }
            if (image.protocol !== 'https:' || image.hostname !== 'tv.puui.qpic.cn' || image.port || image.username || image.password || image.href.length > 4096) continue;
            const actors = clean(item.topic_label, 500).split(' / ');
            banner.push({title, backgroundImage: image.href, genre: clean(item.main_genre, 40),
                subtitle: clean(item.stitle_pc || item.material_video_subtitle),
                actors: actors.length > 1 ? actors.slice(1).join(' / ') : actors[0], description: clean(item.rec_normal_reason, 500)});
            seen.add(title);
            if (banner.length === 5) return banner;
        }
    }
    return banner;
}

// Fixed public editorial feed: callers cannot select a URL, headers or body.
// No account cookies/identifiers, redirect or general proxy is involved.
async function requestBanner() {
    const params = {page_type: 'channel', page_id: '100113', scene: 'channel', new_mark_label_enabled: '1'};
    const response = await axios({url: ENDPOINT, method: 'POST', timeout: 8000, maxRedirects: 0, maxContentLength: 4 * 1024 * 1024,
        headers: {'Content-Type': 'application/json'},
        data: {page_params: params, page_bypass_params: {params: {...params, platform_id: '2', caller_id: '3000010', data_mode: 'default', user_mode: 'default'}, scene: 'channel', app_version: ''}, page_context: null}});
    return response.data;
}

export function createHotBanner({request = requestBanner, now = Date.now, onError = () => {}} = {}) {
    let cached = [], expires = 0, successfulAt = 0, pending;
    const result = () => ({banner: structuredClone(cached), remainingMs: Math.max(0, expires - now())});
    return {
        async get() {
            if (expires > now()) return result();
            if (!pending) pending = (async () => {
                try {
                    const banner = parseHotBanner(await request());
                    if (!banner.length) throw new Error('Empty banner');
                    cached = banner; successfulAt = now(); expires = now() + TTL;
                } catch {
                    if (now() - successfulAt >= MAX_STALE) cached = [];
                    expires = now() + RETRY;
                    onError();
                }
            })().finally(() => { pending = null; });
            await pending;
            return result();
        },
    };
}
