import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createRequire} from 'node:module';

const client = createRequire(import.meta.url)('../src/cat-client.cjs');
test('猫影视连接程序：错误数据/重定向/错误状态、请求取消与串行生命周期', async () => {
    let mode = 'normal', requests = 0, acknowledge;
    const remote = http.createServer(async (req, res) => {
        requests++;
        if (mode === 'redirect') { res.writeHead(302,{Location:'http://127.0.0.1:1/credential-must-not-arrive'});res.end('redirect');return; }
        if (mode === 'invalid') { res.end('<html>not JSON</html>');return; }
        if (mode === 'revoked') { res.writeHead(403,{'Content-Type':'application/json'});res.end('{"error":"订阅已失效"}');return; }
        if (mode === 'cancel') { acknowledge();return; }
        res.setHeader('Content-Type','application/json');
        res.end(JSON.stringify(mode === 'bad-manifest' ? {sites:[{id:'../invalid',name:'站点'}]} : {sites:[],timeout:30000}));
    });
    await new Promise(resolve=>remote.listen(0,'127.0.0.1',resolve));
    const config={version:1,endpoint:`http://127.0.0.1:${remote.address().port}/cat/sub/fake-token`};
    try {
        const address=await client.start(config), base=`http://127.0.0.1:${address.port}`;
        assert.equal((await fetch(base+'/config')).status,200);
        for(const [next,status] of [['redirect',502],['invalid',502],['revoked',403],['bad-manifest',502]]){
            mode=next;const response=await fetch(base+'/config');assert.equal(response.status,status);
            const data=await response.json();assert.ok(data.error);assert.ok(!JSON.stringify(data).includes('fake-token'));
        }
        mode='normal';
        const count=requests;
        const malformed=await fetch(base+'/spider/coketv_one/3/home',{method:'POST',headers:{'Content-Type':'application/json'},body:'[]'});
        assert.equal(malformed.status,400);assert.equal(requests,count);
        assert.equal((await fetch(base+'/spider/coketv_one/3/home')).status,405);
        assert.equal((await fetch(base+'/spider/coketv_one/3/action',{method:'POST'})).status,404);
        mode='cancel';
        const arrived=new Promise(resolve=>{acknowledge=resolve;});
        const pending=fetch(base+'/config').then(response=>response.json()).catch(error=>error);
        await arrived;await client.stop();await pending;
        const [first,second]=await Promise.all([client.start(config),client.start(config)]);
        await assert.rejects(fetch(`http://127.0.0.1:${first.port}/check`));
        assert.equal((await fetch(`http://127.0.0.1:${second.port}/check`)).status,200);
        await assert.rejects(client.start({version:1,endpoint:'file:///tmp/private'}));
        const recovered=await client.start(config);assert.equal((await fetch(`http://127.0.0.1:${recovered.port}/check`)).status,200);
    } finally {
        await client.stop();remote.closeAllConnections();await new Promise(resolve=>remote.close(resolve));
    }
});
