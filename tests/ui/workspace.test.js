import {describe,it,expect,beforeEach,afterEach,vi} from 'vitest';
import {mount,flushPromises} from '@vue/test-utils';
import SourceWorkspace from '../../web/SourceWorkspace.vue';
import {registerUI} from '../../web/register-ui.js';
vi.mock('../../web/CodeEditor.vue',()=>({default:{template:'<div aria-label="编辑器样本"></div>'}}));

let wrapper,values,api;
const source={id:'instance',scriptId:'script',name:'样本源'};
beforeEach(()=>{
    window.matchMedia=vi.fn(()=>({matches:false,addEventListener:vi.fn(),removeEventListener:vi.fn(),addListener:vi.fn(),removeListener:vi.fn()}));
    global.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};
    values={quark_cookie:'private',retry:0,enabled:false};
    api=vi.fn(async(url,body)=>{
        if(url==='/admin/scripts/script')return {id:'script',file:'样本.js',engine:'js',code:'var rule={};',revisions:[]};
        if(url==='/admin/state')return {instances:[{...source,params:'',enabled:false,searchable:true,filterable:false,tags:['电影']}]};
        if(url==='/admin/instances/instance')return {...body};
        if(body)values=body.values;
        return {values:structuredClone(values),defaults:{retry:3}};
    });
});
afterEach(()=>{wrapper?.unmount();document.body.innerHTML='';});
async function start(){
    wrapper=mount(SourceWorkspace,{attachTo:document.body,props:{source,sources:[source],api},global:{plugins:[{install:registerUI}],stubs:{CodeEditor:true}}});
    await flushPromises();
}
const button=text=>wrapper.findAll('button').find(item=>item.text().trim()===text);
describe('本源配置表单',()=>{
    it('脚本页保存实例参数，保留其他配置并阻止未保存验证',async()=>{
        await start();await button('扩展参数').trigger('click');await flushPromises();
        await wrapper.find('#source-params').setValue('https://example.invalid/config.json');
        expect(button('执行验证').attributes('disabled')).toBeDefined();
        await button('返回源管理').trigger('click');await flushPromises();
        expect(document.body.textContent).toContain('放弃未保存的修改？');
        [...document.querySelectorAll('button')].find(item=>item.textContent.trim()==='继续编辑').click();await flushPromises();
        await button('保存扩展参数').trigger('click');await flushPromises();
        expect(api).toHaveBeenCalledWith('/admin/instances/instance',{...source,params:'https://example.invalid/config.json',enabled:false,searchable:true,filterable:false,tags:['电影']},'PUT');
        expect(button('保存扩展参数').attributes('disabled')).toBeDefined();
        expect(button('执行验证').attributes('disabled')).toBeUndefined();
        await button('返回源管理').trigger('click');expect(wrapper.emitted('close')).toHaveLength(1);
    });
    it('Cookie 默认隐藏，保存数字 0 和布尔 false 时保留类型',async()=>{
        await start();
        expect(wrapper.find('[aria-label="变量值 1"]').attributes('type')).toBe('password');
        await wrapper.find('[aria-label="变量值 1"]').setValue('updated');
        await button('保存本源配置').trigger('click');await flushPromises();
        expect(api).toHaveBeenCalledWith('/admin/instances/instance/environment',{values:{quark_cookie:'updated',retry:0,enabled:false}},'PUT');
        expect(button('保存本源配置').attributes('disabled')).toBeDefined();
    });
    it('重复变量名阻止提交，未保存修改触发退出确认',async()=>{
        await start();await button('添加变量').trigger('click');
        await wrapper.find('[aria-label="变量名 4"]').setValue('retry');
        await wrapper.find('[aria-label="变量值 4"]').setValue('1');
        await button('保存本源配置').trigger('click');await flushPromises();
        expect(wrapper.text()).toContain('变量名重复：retry');
        expect(api.mock.calls.some(([,body])=>body)).toBe(false);
        await button('返回源管理').trigger('click');await flushPromises();
        expect(document.body.textContent).toContain('放弃未保存的修改？');
        expect(wrapper.emitted('close')).toBeUndefined();
    });
});
