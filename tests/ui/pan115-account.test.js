import {test,expect,vi,afterEach} from 'vitest';
import {mount,flushPromises} from '@vue/test-utils';
import {registerUI} from '../../web/register-ui.js';
import Pan115Account from '../../web/Pan115Account.vue';
let wrapper;afterEach(()=>{wrapper?.unmount();vi.useRealTimers();});
const button=text=>wrapper.findAll('button').find(b=>b.text()===text);
test('115扫码确认只返回保存状态，取消或离开后停止轮询',async()=>{
    vi.useFakeTimers();const api=vi.fn(async(url,body)=>{if(url.endsWith('/login')){expect(body).toEqual({device:'alipaymini'});return {id:'fixture'};}if(url.endsWith('/image'))return {image:'data:image/png;base64,AAAA'};return {status:'confirmed',account:{connected:true,device:'alipaymini'}};});
    wrapper=mount(Pan115Account,{props:{api},global:{plugins:[{install:registerUI}]}});await button('获取二维码').trigger('click');await flushPromises();expect(wrapper.find('img').attributes('alt')).toBe('115 登录二维码');await vi.advanceTimersByTimeAsync(2500);expect(wrapper.emitted('saved')[0][0].connected).toBe(true);expect(wrapper.find('img').exists()).toBe(false);expect(wrapper.text()).toContain('115 登录信息已保存。');
    await button('获取二维码').trigger('click');await flushPromises();await button('取消扫码').trigger('click');const calls=api.mock.calls.length;await vi.advanceTimersByTimeAsync(10000);expect(api.mock.calls.length).toBe(calls);
});
test('115已有Cookie掩码输入，只提交所选设备，保存后清空且不回显',async()=>{
    const api=vi.fn(async()=>({account:{connected:true,device:'web'}}));wrapper=mount(Pan115Account,{props:{api,account:{connected:true,device:'web'}},global:{plugins:[{install:registerUI}]}});await button('使用已有登录信息').trigger('keydown',{key:'Enter'});await flushPromises();expect(wrapper.get('#netdisk-cookie').attributes('type')).toBe('password');await wrapper.get('#netdisk-cookie').setValue('UID=1; CID=fixture; SEID=private');await wrapper.get('form').trigger('submit');await flushPromises();expect(api).toHaveBeenCalledWith('/admin/netdisk/115/account',{device:'web',cookie:'UID=1; CID=fixture; SEID=private'});expect(wrapper.get('#netdisk-cookie').element.value).toBe('');expect(wrapper.text()).not.toContain('SEID=private');
});
test('切换登录设备会取消旧二维码和轮询',async()=>{
    vi.useFakeTimers();const api=vi.fn(async url=>url.endsWith('/image')?{image:'data:image/png;base64,AAAA'}:{id:'fixture'});wrapper=mount(Pan115Account,{props:{api},global:{plugins:[{install:registerUI}]}});await button('获取二维码').trigger('click');await flushPromises();expect(wrapper.find('img').exists()).toBe(true);await wrapper.get('#netdisk-device').setValue('web');await flushPromises();expect(wrapper.find('img').exists()).toBe(false);const calls=api.mock.calls.length;await vi.advanceTimersByTimeAsync(10000);expect(api.mock.calls.length).toBe(calls);
});
