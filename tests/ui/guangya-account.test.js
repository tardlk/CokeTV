import {afterEach,expect,it,vi} from 'vitest';
import {mount,flushPromises} from '@vue/test-utils';
import {registerUI} from '../../web/register-ui.js';
import GuangyaAccount from '../../web/GuangyaAccount.vue';
let wrapper;
afterEach(()=>{wrapper?.unmount();vi.useRealTimers();});
it('光鸭扫码确认显示保存状态；离开页面停止轮询',async()=>{
    vi.useFakeTimers();const api=vi.fn(async url=>url.endsWith('/login')?{id:'session'}:url.endsWith('/image')?{image:'data:image/png;base64,fixture'}:{status:'confirmed',account:{connected:true,savedAt:123}});
    wrapper=mount(GuangyaAccount,{props:{api},global:{plugins:[{install:registerUI}]}});
    await wrapper.findAll('button').find(b=>b.text()==='获取二维码').trigger('click');await flushPromises();expect(wrapper.find('img').attributes('alt')).toBe('光鸭登录二维码');
    await vi.advanceTimersByTimeAsync(3000);await flushPromises();expect(wrapper.emitted('saved')[0][0].connected).toBe(true);expect(wrapper.text()).toContain('光鸭登录信息已保存');expect(wrapper.find('img').exists()).toBe(false);
    wrapper.unmount();wrapper=null;api.mockClear();await vi.advanceTimersByTimeAsync(10000);expect(api).not.toHaveBeenCalled();
});
it('复用浏览器授权只提交私密字段，保存后清空；转存开关失败恢复原值',async()=>{
    const api=vi.fn(async(url,body)=>{
        if(url.endsWith('/account'))return {account:{connected:true,allowTransfer:false}};
        throw Error('保存失败');
    });
    wrapper=mount(GuangyaAccount,{props:{api,account:{connected:true,allowTransfer:false}},global:{plugins:[{install:registerUI}]}});
    await wrapper.findAll('button').find(b=>b.text()==='使用已有登录信息').trigger('keydown',{key:'Enter'});
    for(const field of ['access','refresh']){expect(wrapper.find('#guangya-'+field).attributes('type')).toBe('password');await wrapper.find('#guangya-'+field).setValue('fixture-'+field);}
    await wrapper.find('#guangya-device').setValue('a'.repeat(32));await wrapper.find('form').trigger('submit');await flushPromises();
    expect(api).toHaveBeenCalledWith('/admin/netdisk/guangya/account',{accessToken:'fixture-access',refreshToken:'fixture-refresh',clientId:'aMe-8VSlkrbQXpUR',deviceId:'a'.repeat(32)});
    expect(wrapper.emitted('saved')[0][0].connected).toBe(true);expect(wrapper.find('#guangya-access').element.value).toBe('');expect(wrapper.find('#guangya-refresh').element.value).toBe('');
    expect(wrapper.find('#guangya-access').element.value).toBe('');expect(wrapper.find('#guangya-refresh').element.value).toBe('');
    await wrapper.find('input[type=checkbox]').setValue(true);await flushPromises();expect(api).toHaveBeenCalledWith('/admin/netdisk/guangya/options',{allowTransfer:true});expect(wrapper.find('input[type=checkbox]').element.checked).toBe(false);expect(wrapper.text()).toContain('保存失败');
});
