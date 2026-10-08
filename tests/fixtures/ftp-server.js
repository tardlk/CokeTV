import net from 'node:net';

// A fixed local FTP protocol peer: no account or third-party server involved.
export async function createFtpFixture() {
    const sockets = new Set(), passiveServers = new Set(), commands = [];
    const bytes = Buffer.from('0123456789');
    const track = socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => {}); return socket; };
    const server = net.createServer(socket => {
        track(socket); socket.write('220 fixed FTP fixture\r\n');
        let pending = Promise.resolve(), buffer = '', dataSocket;
        async function command(line) {
            commands.push(line);
            const verb = line.split(' ')[0];
            const reply = text => { if (!socket.destroyed) socket.write(text + '\r\n'); };
            if (verb === 'USER') reply('331 password required');
            else if (verb === 'PASS') reply('230 logged in');
            else if (verb === 'FEAT') reply('211 no optional features');
            else if (verb === 'PWD') reply('257 "/"');
            else if (verb === 'EPSV') {
                let connected;
                dataSocket = new Promise(resolve => { connected = resolve; });
                const passive = net.createServer(data => { track(data); connected(data); passive.close(); });
                passiveServers.add(passive); passive.on('close', () => passiveServers.delete(passive));
                await new Promise(resolve => passive.listen(0, '127.0.0.1', resolve));
                reply(`229 Entering Extended Passive Mode (|||${passive.address().port}|)`);
            } else if (verb === 'LIST' || verb === 'RETR') {
                reply('150 data follows');
                const data = await dataSocket;
                data.end(verb === 'LIST' ? `-rw-r--r-- 1 fixture fixture ${bytes.length} Jan 01 2026 sample.mp4\r\n` : bytes, () => reply('226 transfer complete'));
            } else if (verb === 'QUIT') socket.end('221 goodbye\r\n');
            else reply('200 accepted');
        }
        socket.on('data', chunk => {
            buffer += chunk.toString();
            while (buffer.includes('\r\n')) {
                const end = buffer.indexOf('\r\n'), line = buffer.slice(0, end); buffer = buffer.slice(end + 2);
                pending = pending.then(() => command(line)).catch(() => socket.destroy());
            }
        });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return {port: server.address().port, bytes, commands, async close() {
        for (const socket of sockets) socket.destroy();
        await Promise.all([server, ...passiveServers].map(item => new Promise(resolve => item.close(resolve))));
    }};
}
