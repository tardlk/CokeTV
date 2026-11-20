// A dual-stack socket accepts IPv6 and IPv4 on the same port. IPv4-only
// kernels still need to boot; binding errors such as EADDRINUSE must surface.
export async function listenApp(app, {port = Number(process.env.PORT) || 54058, host = process.env.HOST || '::'} = {}) {
    try {
        return await app.listen({port, host, ipv6Only: false});
    } catch (error) {
        if (host !== '::' || !['EAFNOSUPPORT', 'EPROTONOSUPPORT', 'EADDRNOTAVAIL'].includes(error.code)) throw error;
        app.runner?.log({level: 'warn', source: 'service', message: `IPv6 监听不可用（${error.code}），改为 IPv4 监听`});
        return app.listen({port, host: '0.0.0.0'});
    }
}
