export function buildContext(baseUrl, instance, script, {proxyPath = '', token = ''} = {}) {
    const base = baseUrl.replace(/\/$/, '');
    const moduleName = script.file.replace(/\.[^.]+$/, '');
    const params = new URLSearchParams({do: script.engine === 'cat' ? 'cat' : script.engine, extend: instance.params || ''});
    if (token) params.set('token', token);
    const proxyUrl = `${base}/proxy/${encodeURIComponent(instance.id || moduleName)}/?${params}`;
    return {
        requestHost: base, proxyUrl, proxyPath, publicUrl: `${base}/public/`, jsonUrl: `${base}/json/`,
        httpUrl: `${base}/http`, imageApi: `${base}/image`, mediaProxyUrl: `${base}/mediaProxy`,
        webdavProxyUrl: `${base}/webdav/`, ftpProxyUrl: `${base}/ftp/`,
        hostname: new URL(base).host, hostUrl: new URL(base).hostname,
        wsName: new URL(base).host, wsScheme: base.startsWith('https:') ? 'wss' : 'ws', ext: instance.params || '', allowCustomParams: true,
    };
}
