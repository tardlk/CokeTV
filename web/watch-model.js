export function resultObject(value) {
    if (typeof value === 'string') { try { return JSON.parse(value); } catch { throw new Error('源返回的数据不是有效 JSON'); } }
    if (!value || typeof value !== 'object') throw new Error('源没有返回有效数据');
    return value;
}
export function playlists(vod) {
    const names = String(vod?.vod_play_from || '').split('$$$');
    return String(vod?.vod_play_url || '').split('$$$').map((group, index) => ({
        name: names[index] || `线路 ${index + 1}`,
        episodes: group.split('#').filter(Boolean).map((value, episode) => {
            const split = value.indexOf('$');
            const name = split < 0 ? `第 ${episode + 1} 集` : value.slice(0, split) || `第 ${episode + 1} 集`;
            return {name: name === '嗅探播放' ? '正片' : name, id: split < 0 ? value : value.slice(split + 1), index: episode};
        }).filter(item => item.id),
    })).filter(line => line.episodes.length);
}
export function plainText(value) {
    return String(value || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();
}
export function detailText(value) {
    const text = plainText(value);
    return /^https?:\/\/\S+$/.test(text) || /没有二级.*只有一级|^导演$|^主演$/.test(text) ? '' : text;
}
export function safeImage(value) {
    const url = String(value || '').split('@')[0];
    return /^(https?:\/\/|\/(?!\/)|data:image\/(png|jpeg|webp);base64,)/i.test(url) ? url : '';
}
export function readWatchStorage(key) {
    try { const value = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(value) ? value : []; } catch { return []; }
}
export function saveWatchStorage(key, items) {
    try { localStorage.setItem(key, JSON.stringify(items.slice(0, 100))); } catch {}
}
