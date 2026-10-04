/* @header({title: '协议样本', searchable: 1, filterable: 1}) */
var rule = {
    title: '协议样本', host: 'https://example.invalid', url: '/fyclass/fypage', searchUrl: '/search/**',
    class_parse: async function () { return {class: [{type_id: 'movie', type_name: '电影'}], filters: {}}; },
    推荐: async function () { return setResult([{title: '样本电影', img: '', desc: '测试', url: 'one'}]); },
    一级: async function (tid, pg) { return setResult([{title: `${tid}-${pg}-${this.params || ''}`, url: 'one', img: '', desc: '测试'}]); },
    二级: async function () { return {vod_id: this.orId, vod_name: '样本电影', vod_play_from: '测试', vod_play_url: '正片$https://example.invalid/video.mp4'}; },
    搜索: async function (key) { return setResult([{title: key, url: 'one', img: '', desc: '测试'}]); },
    play_parse: true,
    lazy: async function (flag, id) { return {parse: 0, url: id === 'proxy' ? getProxyUrl() + '&text=hello' : id === 'legacy-proxy' ? this.requestHost + '/proxy/' + encodeURIComponent('协议样本') + '/?text=hello' : id}; },
    proxy_rule: async function (params) {
        if (params.bytes) return [200, 'application/octet-stream', Buffer.from('二进制').toString('base64'), {}, 1];
        if (params.stream) return [200, 'application/octet-stream', params.stream, {}, 3];
        return [200, 'text/plain', params.text || 'hello'];
    },
    action: async function (name, value) { if (name === 'save-env') ENV.set('fixture_cookie', value); return {name, value}; },
};
