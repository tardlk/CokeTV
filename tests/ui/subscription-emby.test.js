import {test,expect,vi,afterEach} from 'vitest';
import {mount,flushPromises} from '@vue/test-utils';
import {registerUI} from '../../web/register-ui.js';
import SubscriptionEmby from '../../web/SubscriptionEmby.vue';
let wrapper;afterEach(()=>{wrapper?.unmount();vi.useRealTimers();});
test('订阅Emby三字段只读且分别复制，自动准备目录，离开停止轮询',async()=>{
    vi.useFakeTimers();const api=vi.fn(async()=>({sources:1,ready:0,preparing:1}));
    wrapper=mount(SubscriptionEmby,{props:{api,baseUrl:'https://coketv.example.test',subscription:{id:'sub',token:'private-sub-token',enabled:true,instances:['source']}},global:{plugins:[{install:registerUI}]}});await flushPromises();
    expect(wrapper.get('[aria-label="Emby服务器地址"]').element.value).toBe('https://coketv.example.test');expect(wrapper.get('[aria-label="Emby用户名"]').element.value).toBe('coke');expect(wrapper.get('[aria-label="Emby密码"]').element.value).toBe('private-sub-token');
    for(const input of wrapper.findAll('input'))expect(input.element.readOnly).toBe(true);
    for(const name of ['复制Emby服务器地址','复制Emby用户名','复制Emby密码'])await wrapper.get(`[aria-label="${name}"]`).trigger('click');
    expect(wrapper.emitted('copy')).toEqual([['https://coketv.example.test'],['coke'],['private-sub-token']]);
    expect(api).toHaveBeenCalledWith('/admin/subscriptions/sub/emby/prepare',{});expect(wrapper.text()).toContain('无需另建账号或媒体库');expect(wrapper.text()).not.toContain('启用服务');
    wrapper.unmount();const calls=api.mock.calls.length;await vi.advanceTimersByTimeAsync(10000);expect(api.mock.calls.length).toBe(calls);
});
test('停用/空订阅不执行源；准备失败展示错误且保留连接信息',async()=>{
    const api=vi.fn(async()=>{throw Error('源目录读取失败');});
    wrapper=mount(SubscriptionEmby,{props:{api,baseUrl:'http://localhost',subscription:{id:'sub',token:'token',enabled:false,instances:['source']}},global:{plugins:[{install:registerUI}]}});await flushPromises();expect(api).not.toHaveBeenCalled();expect(wrapper.text()).toContain('已停用');wrapper.unmount();
    wrapper=mount(SubscriptionEmby,{props:{api,baseUrl:'http://localhost',subscription:{id:'sub',token:'token',enabled:true,instances:['source']}},global:{plugins:[{install:registerUI}]}});await flushPromises();expect(wrapper.get('[role="alert"]').text()).toContain('源目录读取失败');expect(wrapper.get('[aria-label="Emby密码"]').element.value).toBe('token');
});
