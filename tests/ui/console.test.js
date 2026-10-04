import {describe,it,expect,beforeEach,afterEach,vi} from 'vitest';
import {mount,flushPromises} from '@vue/test-utils';
import App from '../../web/App.vue';
import {registerUI} from '../../web/register-ui.js';
vi.mock('../../web/SourceWorkspace.vue',()=>({__esModule:true,default:{props:['source'],template:'<div class="workspace-shell">编辑 {{source.name}}</div>'}}));

let wrapper,state,requests;
const initial=()=>({scripts:[{id:'script',file:'样本.js',engine:'js'}],instances:[
    {id:'a',scriptId:'script',name:'源A',params:'',enabled:true,searchable:true,filterable:false,tags:[]},
    {id:'b',scriptId:'script',name:'源B',params:'second',enabled:false,searchable:true,filterable:false,tags:[]},
],subscriptions:[],settings:{publicUrl:'',timeout:30000,pythonPath:'python3',phpPath:'php',browserPath:'',env:{},plugins:[],parses:[],lives:[]},runtime:{started:false},baseUrl:'http://localhost'});
function useAllEngines(){
    state.scripts=['js','dr2','cat','py','php'].map(engine=>({id:engine,file:engine+'.source',engine}));
    state.instances=state.scripts.map(script=>({...initial().instances[0],id:script.id,scriptId:script.id,name:script.id+'源'}));
}
function button(text,root=wrapper){return root.findAll('button').find(item=>item.text().trim()===text);}
async function start(){wrapper=mount(App,{attachTo:document.body,global:{plugins:[{install:registerUI}]}});await flushPromises();}
beforeEach(()=>{
    state=initial();requests=[];
    sessionStorage.setItem('coketv-access',btoa(':test'));
    window.matchMedia=vi.fn(()=>({matches:false,addEventListener:vi.fn(),removeEventListener:vi.fn(),addListener:vi.fn(),removeListener:vi.fn()}));
    global.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};
    HTMLElement.prototype.scrollIntoView=vi.fn();
    vi.stubGlobal('fetch',vi.fn(async(url,options={})=>{
        const payload=options.body instanceof FormData?{engine:options.body.get('engine'),file:options.body.get('file')}:options.body?JSON.parse(options.body):null;
        requests.push({url,method:options.method||'GET',payload});
        if(url==='/admin/instances/batch')for(const instance of state.instances)if(payload.ids.includes(instance.id))instance.enabled=payload.enabled;
        if(url.startsWith('/admin/instances/')&&options.method==='PUT')Object.assign(state.instances.find(s=>s.id===url.split('/').at(-1)),payload);
        if(url==='/admin/subscriptions'&&options.method==='POST')state.subscriptions.push({id:'s',token:'test',...payload});
        if(url==='/admin/scripts/create'&&options.method==='POST'){
            const script={id:'created',engine:payload.type,file:payload.name+'.'+payload.type};
            state.scripts.push(script);state.instances.push({...initial().instances[0],id:'created-source',scriptId:script.id,name:payload.name});
            return {ok:true,status:200,json:async()=>script};
        }
        return {ok:true,status:200,json:async()=>structuredClone(url==='/admin/state'?state:{ok:true})};
    }));
});
afterEach(()=>{wrapper?.unmount();document.body.innerHTML='';sessionStorage.clear();history.replaceState({},'','/');vi.unstubAllGlobals();});

describe('shadcn 控制台绑定',()=>{
    it('只输入访问密码即可进入，退出清除访问凭据',async()=>{
        sessionStorage.clear();await start();
        expect(wrapper.findAll('input')).toHaveLength(1);
        expect(wrapper.text()).not.toContain('管理员账号');
        await wrapper.find('#login-password').setValue('中文:password');await wrapper.find('form').trigger('submit');await flushPromises();
        const encoded=sessionStorage.getItem('coketv-access');
        expect(decodeURIComponent(escape(atob(encoded)))).toBe(':中文:password');
        expect(wrapper.find('[aria-label="账户菜单"]').exists()).toBe(false);
        await wrapper.find('[aria-label="退出"]').trigger('click');await flushPromises();
        expect(sessionStorage.getItem('coketv-access')).toBeNull();
        expect(wrapper.find('#login-password').exists()).toBe(true);
    });
    it('错误访问密码保持锁定并显示原因',async()=>{
        sessionStorage.clear();vi.stubGlobal('fetch',vi.fn(async()=>({ok:false,status:401,json:async()=>({error:'访问密码不正确'})})));
        await start();await wrapper.find('#login-password').setValue('wrong');await wrapper.find('form').trigger('submit');await flushPromises();
        expect(wrapper.text()).toContain('访问密码不正确');
        expect(wrapper.find('.source-table').exists()).toBe(false);
        expect(sessionStorage.getItem('coketv-access')).toBeNull();
    });
    it('导入直接打开文件选择，标签与添加源说明都已移除',async()=>{
        await start();
        const chooser=wrapper.find('#source-upload');const click=vi.spyOn(chooser.element,'click').mockImplementation(()=>{});
        await button('导入').trigger('click');expect(click).toHaveBeenCalledOnce();
        expect(wrapper.text()).not.toContain('标签');
        expect(document.querySelector('[role="menu"]')).toBeNull();
        await button('添加源').trigger('click');await flushPromises();
        expect(document.querySelector('[role="dialog"]').textContent).not.toContain('无需填写扩展名');
    });
    it('选中文件自动导入；仅无法判定 JS 时才选择格式',async()=>{
        await start();let ambiguous=true;
        const originalFetch=fetch;
        vi.stubGlobal('fetch',vi.fn(async(url,options)=>{
            if(url==='/admin/upload'&&ambiguous){ambiguous=false;return {ok:false,status:422,json:async()=>({error:'选择运行格式',code:'IMPORT_ENGINE_REQUIRED'})};}
            return originalFetch(url,options);
        }));
        const file=new File(['var rule = {};'],'外部源.js',{type:'text/javascript'});
        Object.defineProperty(wrapper.find('#source-upload').element,'files',{configurable:true,value:[file]});
        await wrapper.find('#source-upload').trigger('change');await flushPromises();
        expect(document.querySelector('[role="dialog"]').textContent).toContain('选择 JS 运行格式');
        const select=document.querySelector('#import-engine');select.value='dr2';select.dispatchEvent(new Event('change',{bubbles:true}));await flushPromises();
        [...document.querySelectorAll('[role="dialog"] button')].find(item=>item.textContent.trim()==='导入').click();await flushPromises();
        expect(requests.find(item=>item.url==='/admin/upload').payload.engine).toBe('dr2');
        expect(document.querySelector('[role="dialog"]')).toBeNull();
        expect(wrapper.find('#source-upload').element.value).toBe('');
    });
    it('语言筛选把 JS、DR2、CatVod 合并，添加源只选择三种类型',async()=>{
        useAllEngines();await start();
        expect(wrapper.findAll('.engine-badge').map(item=>item.text())).toEqual(['JS','JS','JS','Python','PHP']);
        const filter=wrapper.find('[aria-label="类型筛选"]');
        expect(filter.findAll('option').map(item=>item.text())).toEqual(['全部','JS','Python','PHP']);
        await filter.setValue('js');expect(wrapper.findAll('tbody tr')).toHaveLength(3);
        await filter.setValue('py');expect(wrapper.findAll('tbody tr').map(item=>item.text())).toHaveLength(1);
        expect(wrapper.find('tbody').text()).toContain('py源');
        await button('添加源').trigger('click');await flushPromises();
        expect([...document.querySelectorAll('#new-type option')].map(item=>item.value)).toEqual(['js','py','php']);
        expect(document.querySelector('#new-code')).toBeNull();
        expect(document.querySelector('#new-name').value).toBe('');
    });
    it.each(['js','py','php'])('创建 %s 自动补后缀并直接进入编辑页',async(type)=>{
        await start();await button('添加源').trigger('click');await flushPromises();
        const select=document.querySelector('#new-type');select.value=type;select.dispatchEvent(new Event('change',{bubbles:true}));
        const name=document.querySelector('#new-name');name.value='我的源.'+type;name.dispatchEvent(new Event('input',{bubbles:true}));
        await flushPromises();
        document.querySelector('[role="dialog"] form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await flushPromises();
        expect(requests.find(item=>item.url==='/admin/scripts/create').payload).toEqual({type,name:'我的源'});
        expect(wrapper.find('.workspace-shell').text()).toBe('编辑 我的源');
        expect(location.pathname).toBe('/sources/created-source/edit');
        expect(document.querySelector('[role="dialog"]')).toBeNull();
    });
    it('订阅选源用三种语言筛选，JS 分类包含全部三种 JS 引擎',async()=>{
        useAllEngines();await start();await button('订阅管理').trigger('click');await button('新建订阅').trigger('click');await flushPromises();
        const types=document.querySelector('.picker-types');
        expect([...types.querySelectorAll('button')].map(item=>item.textContent)).toEqual(['JS','Python','PHP']);
        [...types.querySelectorAll('button')].find(item=>item.textContent==='JS').click();await flushPromises();
        expect([...document.querySelectorAll('.pick-source')].map(item=>item.textContent)).toEqual(['js源JS','dr2源JS','cat源JS']);
        [...document.querySelectorAll('button')].find(item=>item.textContent.trim()==='添加全部').click();await flushPromises();
        expect(document.querySelectorAll('.chosen-source')).toHaveLength(3);
        expect([...document.querySelectorAll('.chosen-source [data-slot="badge"]')].map(item=>item.textContent)).toEqual(['JS','JS','JS']);
    });
    it('名称单击只重命名，保留最新参数、标签与能力',async()=>{
        await start();
        expect(wrapper.findAll('th').map(item=>item.text())).toEqual(['','名称','类型','状态','搜索','筛选','操作']);
        expect(wrapper.findAll('tbody tr')[0].text()).toContain('JS');
        expect(wrapper.find('[aria-label="配置源"]').exists()).toBe(false);
        await button('源B').trigger('click');await flushPromises();
        const dialog=document.querySelector('[role="dialog"]');
        expect(dialog.textContent).toContain('重命名源');
        expect(wrapper.find('.workspace-shell').exists()).toBe(false);
        expect(dialog.querySelector('#instance-params')).toBeNull();
        expect(dialog.querySelector('#instance-enabled')).toBeNull();
        expect(dialog.querySelector('#instance-search')).toBeNull();
        expect(dialog.querySelector('#instance-filter')).toBeNull();
        expect(dialog.querySelector('#instance-tags')).toBeNull();
        const name=dialog.querySelector('#source-name');name.value='改名';name.dispatchEvent(new Event('input',{bubbles:true}));
        // 另一处已修改参数与能力，保存名称时不能被旧表单覆盖。
        Object.assign(state.instances[1],{params:'updated-param',enabled:true,searchable:false,filterable:true,tags:['保留标签']});
        [...dialog.querySelectorAll('button')].find(item=>item.textContent.trim()==='保存名称').click();await flushPromises();
        expect(requests.find(item=>item.url==='/admin/instances/b'&&item.method==='PUT').payload).toMatchObject({name:'改名',params:'updated-param',enabled:true,searchable:false,filterable:true,tags:['保留标签']});
        expect(requests.some(item=>item.url==='/admin/scripts')).toBe(false);
    });
    it('取消重命名不提交，也不打开脚本页',async()=>{
        await start();await button('源A').trigger('click');await flushPromises();
        [...document.querySelectorAll('[role="dialog"] button')].find(item=>item.textContent.trim()==='取消').click();await flushPromises();
        expect(requests.some(item=>item.method==='PUT')).toBe(false);
        expect(wrapper.find('.workspace-shell').exists()).toBe(false);
        expect(button('源A')).toBeDefined();
    });
    it('分页与每页条数不丢失源，搜索后回到第一页',async()=>{
        state.instances=Array.from({length:23},(_,index)=>({...initial().instances[0],id:'source-'+index,name:'源'+index}));
        await start();expect(wrapper.findAll('tbody tr')).toHaveLength(20);
        await wrapper.find('[aria-label="下一页"]').trigger('click');await flushPromises();
        expect(wrapper.findAll('tbody tr')).toHaveLength(3);
        await wrapper.find('[aria-label="搜索源"]').setValue('源0');await flushPromises();
        expect(wrapper.findAll('tbody tr')).toHaveLength(1);
        await wrapper.find('[aria-label="搜索源"]').setValue('');
        await wrapper.find('[aria-label="每页条数"]').setValue('50');await flushPromises();
        expect(wrapper.findAll('tbody tr')).toHaveLength(23);
    });
    it('搜索能力切换保留启用状态与原有参数',async()=>{
        await start();await wrapper.find('[aria-label="切换搜索能力源B"]').trigger('click');await flushPromises();
        const request=requests.find(request=>request.url==='/admin/instances/b'&&request.method==='PUT');
        expect(request.payload).toMatchObject({searchable:false,enabled:false,params:'second'});
    });
    it('手机导航切换页面后自动收起侧栏',async()=>{
        window.matchMedia=vi.fn(()=>({matches:true,addEventListener:vi.fn(),removeEventListener:vi.fn(),addListener:vi.fn(),removeListener:vi.fn()}));
        await start();await button('切换侧栏').trigger('click');await flushPromises();
        const navigation=document.querySelector('[role="dialog"]');
        expect(navigation).not.toBeNull();
        [...navigation.querySelectorAll('button')].find(item=>item.textContent.trim()==='订阅管理').click();await flushPromises();
        expect(wrapper.find('h1').text()).toBe('订阅管理');
        expect(document.querySelector('[role="dialog"]')).toBeNull();
    });
    it('选择与批量停用提交准确的实例 ID',async()=>{
        await start();await wrapper.find('[aria-label="选择源A"]').trigger('click');await flushPromises();
        expect(wrapper.find('.selection-tools').text()).toContain('已选择 1');
        await button('停用',wrapper.find('.selection-tools')).trigger('click');await flushPromises();
        expect(requests.find(request=>request.url==='/admin/instances/batch').payload).toEqual({ids:['a'],enabled:false});
        expect(wrapper.find('[aria-label="启用源A"]').attributes('aria-checked')).toBe('false');
    });
    it('源开关通过实例更新 API 写入，不丢已有参数',async()=>{
        await start();await wrapper.find('[aria-label="启用源B"]').trigger('click');await flushPromises();
        const request=requests.find(request=>request.url==='/admin/instances/b'&&request.method==='PUT');
        expect(request.payload.enabled).toBe(true);expect(request.payload.params).toBe('second');
        expect(wrapper.find('[aria-label="停用源B"]').attributes('aria-checked')).toBe('true');
    });
    it('订阅选择、顺序与勾选状态进入保存数据',async()=>{
        await start();await button('订阅管理').trigger('click');await flushPromises();
        await button('新建订阅').trigger('click');await flushPromises();
        const name=document.querySelector('#subscription-name');name.value='测试电视';name.dispatchEvent(new Event('input',{bubbles:true}));
        const description=document.querySelector('#subscription-description');description.value='只给客厅使用';description.dispatchEvent(new Event('input',{bubbles:true}));
        document.querySelector('[aria-label="添加源A"]').click();await flushPromises();
        document.querySelector('[aria-label="添加源B"]').click();await flushPromises();
        document.querySelector('[aria-label="上移源B"]').click();await flushPromises();
        document.querySelector('#subscription-enabled').click();await flushPromises();
        const save=[...document.querySelectorAll('button')].find(item=>item.textContent.trim()==='保存订阅');save.click();await flushPromises();
        expect(requests.find(request=>request.url==='/admin/subscriptions'&&request.method==='POST').payload).toMatchObject({name:'测试电视',description:'只给客厅使用',enabled:false,instances:['b','a']});
    });
    it('取消编辑订阅不会提交修改',async()=>{
        await start();await button('订阅管理').trigger('click');await flushPromises();await button('新建订阅').trigger('click');await flushPromises();
        document.querySelector('[aria-label="添加源A"]').click();await flushPromises();
        const cancel=[...document.querySelectorAll('[role="dialog"] button')].find(button=>button.textContent.trim()==='取消');cancel.click();await flushPromises();
        expect(requests.some(request=>request.url==='/admin/subscriptions'&&request.method==='POST')).toBe(false);
    });
});
