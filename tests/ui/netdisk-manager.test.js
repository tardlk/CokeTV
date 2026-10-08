import {test,expect,vi,afterEach} from 'vitest';
import {mount,flushPromises} from '@vue/test-utils';
import {registerUI} from '../../web/register-ui.js';
import NetdiskManager from '../../web/NetdiskManager.vue';
let wrapper;
afterEach(()=>{wrapper?.unmount();vi.useRealTimers();});
test('网盘管理显示已保存状态，扫码流程只显示图片/状态，不显示凭据',async()=>{
    vi.useFakeTimers();
    const api=vi.fn(async(url,body)=>{
        if(url==='/admin/netdisk')return {providers:[{id:'115',connected:true,savedAt:1791430278233,device:'alipaymini'}]};
        if(url==='/admin/netdisk/115/login'){expect(body).toEqual({device:'alipaymini'});return {id:'fixture-login'};}
        if(url.endsWith('/image'))return {image:'data:image/png;base64,AAAA'};
        if(url.endsWith('/poll'))return {status:'confirmed',account:{connected:true,savedAt:1791430278233,device:'alipaymini'}};
        throw Error('unexpected');
    });
    wrapper=mount(NetdiskManager,{props:{api},global:{plugins:[{install:registerUI}]}});await flushPromises();
    expect(wrapper.text()).toContain('已保存登录信息');
    expect(wrapper.find('input[type=password]').exists()).toBe(false);
    await wrapper.findAll('button').find(b=>b.text().includes('重新扫码登录')).trigger('click');await flushPromises();
    expect(wrapper.find('img[alt="115 登录二维码"]').attributes('src')).toBe('data:image/png;base64,AAAA');
    await vi.advanceTimersByTimeAsync(2500);await flushPromises();
    expect(wrapper.text()).toContain('登录信息已保存。');
    expect(wrapper.find('img').exists()).toBe(false);
    expect(api.mock.calls.every(([url])=>!url.includes('cookie')&&!url.includes('token='))).toBe(true);
});
test('离开网盘页停止继续轮询，接口失败显示可理解的错误',async()=>{
    vi.useFakeTimers();
    const api=vi.fn(async url=>url==='/admin/netdisk'?{providers:[{id:'115',connected:false}]}:url.endsWith('/image')?{image:'data:image/png;base64,AAAA'}:url.endsWith('/poll')?{status:'waiting'}:{id:'fixture-login'});
    wrapper=mount(NetdiskManager,{props:{api},global:{plugins:[{install:registerUI}]}});await flushPromises();
    await wrapper.findAll('button').find(b=>b.text().includes('扫码登录')).trigger('click');await flushPromises();
    wrapper.unmount();const count=api.mock.calls.length;await vi.advanceTimersByTimeAsync(15000);expect(api.mock.calls.length).toBe(count);
    wrapper=mount(NetdiskManager,{props:{api:async()=>{throw Error('请稍后重试');}},global:{plugins:[{install:registerUI}]}});await flushPromises();
    expect(wrapper.text()).toContain('请稍后重试');
});
