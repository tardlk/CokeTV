import {test,expect,vi,afterEach,beforeEach} from 'vitest';
import {mount,flushPromises} from '@vue/test-utils';
import {registerUI} from '../../web/register-ui.js';
import NetdiskManager from '../../web/NetdiskManager.vue';
let wrapper;
beforeEach(()=>{window.matchMedia=vi.fn(()=>({matches:false,addEventListener(){},removeEventListener(){}}));global.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};});
afterEach(()=>{wrapper?.unmount();document.body.innerHTML='';vi.useRealTimers();});
const mountPage=api=>mount(NetdiskManager,{props:{api},attachTo:document.body,global:{plugins:[{install:registerUI}]}});
const button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===text);
const click=async selector=>{document.querySelector(selector).click();await flushPromises();};
test('平台卡片显示真实保存状态，配置才打开授权弹窗，不回显既有凭据',async()=>{
    const api=vi.fn(async()=>({providers:[{id:'115',connected:true,savedAt:1791430278233,device:'web',revision:'r115'},{id:'guangya',connected:false}]}));
    wrapper=mountPage(api);await flushPromises();expect(wrapper.findAll('.drive-card')).toHaveLength(2);expect(wrapper.text()).toContain('已保存授权');expect(wrapper.text()).not.toContain('授权有效');expect(document.querySelector('input[type=password]')).toBeNull();
    await click('[aria-label="配置115 网盘授权"]');expect(document.querySelector('[role=dialog]').textContent).toContain('管理115 网盘授权');expect(document.querySelector('#netdisk-device').value).toBe('web');expect(api).toHaveBeenCalledTimes(1);
    button('使用已有登录信息').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));await flushPromises();expect(document.querySelector('#netdisk-cookie').type).toBe('password');expect(document.querySelector('#netdisk-cookie').value).toBe('');
});
test('关闭授权弹窗停止轮询，重新打开光鸭面板没有上次二维码',async()=>{
    vi.useFakeTimers();const api=vi.fn(async url=>url==='/admin/netdisk'?{providers:[{id:'115',connected:false},{id:'guangya',connected:false}]}:url.endsWith('/image')?{image:'data:image/png;base64,AAAA'}:url.endsWith('/poll')?{status:'waiting'}:{id:'fixture-login'});
    wrapper=mountPage(api);await flushPromises();await click('[aria-label="配置115 网盘授权"]');button('获取二维码').click();await flushPromises();expect(document.querySelector('img[alt="115 登录二维码"]')).not.toBeNull();
    button('完成').click();await flushPromises();const count=api.mock.calls.length;await vi.advanceTimersByTimeAsync(15000);expect(api.mock.calls.length).toBe(count);
    await click('[aria-label="配置光鸭云盘授权"]');expect(document.querySelector('img')).toBeNull();expect(document.querySelector('[role=dialog]').textContent).toContain('允许按需转存');
});
test('移除授权先确认，失败保留弹窗，成功只更新目标网盘状态',async()=>{
    let fail=true;const api=vi.fn(async(url,body)=>{if(url==='/admin/netdisk')return {providers:[{id:'115',connected:true,revision:'r115'},{id:'guangya',connected:true,revision:'rgy'}]};expect(url).toBe('/admin/netdisk/115/account/remove');expect(body).toEqual({revision:'r115'});if(fail)throw Error('请重试');return {account:{connected:false}};});
    wrapper=mountPage(api);await flushPromises();await click('[aria-label="移除115 网盘授权"]');expect(api).toHaveBeenCalledTimes(1);expect(document.querySelector('[role=alertdialog]').textContent).toContain('不会删除云盘中的文件');button('取消').click();await flushPromises();expect(api).toHaveBeenCalledTimes(1);
    await click('[aria-label="移除115 网盘授权"]');button('移除本机授权').click();await flushPromises();expect(document.querySelector('[role=alertdialog]').textContent).toContain('请重试');expect(wrapper.findAll('.drive-card')[0].text()).toContain('已保存授权');
    fail=false;button('移除本机授权').click();await flushPromises();expect(document.querySelector('[role=alertdialog]')).toBeNull();expect(wrapper.findAll('.drive-card')[0].text()).toContain('未配置');expect(wrapper.findAll('.drive-card')[1].text()).toContain('已保存授权');
});
test('状态接口失败显示错误且允许重试',async()=>{let fail=true;const api=vi.fn(async()=>{if(fail)throw Error('请稍后重试');return {providers:[]};});wrapper=mountPage(api);await flushPromises();expect(wrapper.text()).toContain('请稍后重试');fail=false;button('刷新状态').click();await flushPromises();expect(wrapper.findAll('.drive-card')).toHaveLength(2);});
