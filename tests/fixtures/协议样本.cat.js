let params = '';
const item = name => ({vod_id: 'one', vod_name: name, vod_pic: '', vod_remarks: '测试'});
export function __jsEvalReturn() {
    return {
        init: async function (config) { params = config.ext; },
        home: async function () { return {class: [{type_id: 'movie', type_name: '电影'}]}; },
        homeVod: async function () { return {list: [item('样本电影')]}; },
        category: async function (tid, pg) { return {page: pg, list: [item(`${tid}-${pg}-${params}`)]}; },
        detail: async function (id) { return {list: [{...item('样本电影'), vod_id: id, vod_play_from: '测试', vod_play_url: '正片$https://example.invalid/video.mp4'}]}; },
        search: async function (key) { return {list: [item(key)]}; },
        play: async function (flag, id) { return {parse: 0, url: id}; },
        proxy: async function () { return [200, 'text/plain', 'hello']; },
        action: async function (name, value) { return {name, value}; },
    };
}
