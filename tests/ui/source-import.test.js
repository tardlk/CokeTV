import {describe, it, expect, vi, afterEach} from 'vitest';
import {mount, flushPromises} from '@vue/test-utils';
import SourceImport from '../../web/SourceImport.vue';
import {registerUI} from '../../web/register-ui.js';
let wrapper;
const preview = {previewId: 'preview', total: 3, ready: 1, entries: [
    {id:'0',name:'采集源',kind:'cmsJson',status:'ready',engine:'cat',reason:'采集协议读取通过'},
    {id:'1',name:'未标记源',kind:'script',status:'needsEngine',reason:'请选择 JS 运行格式'},
    {id:'2',name:'JAR源',status:'skipped',reason:'此站点依赖 Android JAR'},
]};
const start = async api => { wrapper=mount(SourceImport,{props:{api},global:{plugins:[{install:registerUI}]}});await flushPromises(); };
const read = async () => { await wrapper.find('#tvbox-url').setValue('https://fixture.invalid/tvbox.json'); await wrapper.find('form').trigger('submit'); await flushPromises(); };
afterEach(()=>{wrapper?.unmount();});
describe('TVBox链接导入',()=>{
    it('读取链接后选择兼容项，显示JAR跳过原因，提交固定预览ID',async()=>{
        const api=vi.fn(async url=>url.endsWith('/preview')?preview:{imported:1,existing:0});
        await start(api);await read();
        expect(api).toHaveBeenCalledWith('/admin/import/tvbox/preview',{url:'https://fixture.invalid/tvbox.json'});
        expect(wrapper.text()).toContain('已选择 1 个');expect(wrapper.text()).toContain('Android JAR');
        expect(wrapper.find('[aria-label="导入JAR源"]').attributes('disabled')).toBeDefined();
        await wrapper.findAll('button').find(item=>item.text().includes('导入所选')).trigger('click');await flushPromises();
        expect(api).toHaveBeenLastCalledWith('/admin/import/tvbox',{previewId:'preview',ids:['0'],engines:{}});
        expect(wrapper.text()).toContain('已导入 1 个源');expect(wrapper.emitted('imported')).toHaveLength(1);
    });
    it('歧义JS必须选择格式，选择后加入导入项',async()=>{
        const api=vi.fn(async url=>url.endsWith('/preview')?preview:{imported:2,existing:0});
        await start(api);await read();
        await wrapper.find('[aria-label="未标记源运行格式"]').setValue('dr2');
        await wrapper.findAll('button').find(item=>item.text().includes('导入所选')).trigger('click');await flushPromises();
        expect(api).toHaveBeenLastCalledWith('/admin/import/tvbox',{previewId:'preview',ids:['0','1'],engines:{'1':'dr2'}});
    });
    it('读取失败显示错误，可以修改链接重试，不触发保存',async()=>{
        const api=vi.fn().mockRejectedValueOnce(new Error('链接没有返回有效配置')).mockResolvedValueOnce(preview);
        await start(api);await read();expect(wrapper.text()).toContain('链接没有返回有效配置');
        expect(wrapper.find('.tvbox-import-table').exists()).toBe(false);
        await read();expect(wrapper.find('.tvbox-import-table').exists()).toBe(true);
        expect(wrapper.emitted('imported')).toBeUndefined();
    });
    it('本地文件入口继续触发文件选择，取消不保存',async()=>{
        const api=vi.fn();await start(api);
        await wrapper.findAll('[role="tab"]').find(item=>item.text().includes('本地文件')).trigger('mousedown',{button:0});
        await wrapper.findAll('button').find(item=>item.text()==='选择文件').trigger('click');
        expect(wrapper.emitted('file')).toHaveLength(1);expect(api).not.toHaveBeenCalled();
    });
});
