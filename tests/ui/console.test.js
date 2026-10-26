import {describe,it,expect,beforeEach,afterEach,vi} from 'vitest';
import {mount,flushPromises} from '@vue/test-utils';
import App from '../../web/App.vue';
import {registerUI} from '../../web/register-ui.js';
vi.mock('../../web/SourceWorkspace.vue',()=>({__esModule:true,default:{props:['source'],template:'<div class="workspace-shell">编辑 {{source.name}}</div>'}}));

let wrapper,state,requests,setupRequired;
const initial=()=>({scripts:[{id:'script',file:'样本.js',engine:'dr3'}],instances:[
    {id:'a',scriptId:'script',name:'源A',params:'',enabled:true,searchable:true,filterable:false,tags:[]},
    {id:'b',scriptId:'script',name:'源B',params:'second',enabled:false,searchable:true,filterable:false,tags:[]},
],subscriptions:[],settings:{env:{},parses:[],lives:[]},runtime:{started:false}});
function useAllEngines(){
    state.scripts=['js','dr2','dr3','cat','py','php'].map(engine=>({id:engine,file:engine+'.source',engine}));
    state.instances=state.scripts.map(script=>({...initial().instances[0],id:script.id,scriptId:script.id,name:script.id+'源'}));
}
function button(text,root=wrapper){return root.findAll('button').find(item=>item.text().trim()===text);}
async function start(){wrapper=mount(App,{attachTo:document.body,global:{plugins:[{install:registerUI}]}});await flushPromises();}
beforeEach(()=>{
    history.replaceState({},'','/admin');state=initial();requests=[];setupRequired=false;
    sessionStorage.setItem('coketv-access',btoa(':test'));
    window.matchMedia=vi.fn(()=>({matches:false,addEventListener:vi.fn(),removeEventListener:vi.fn(),addListener:vi.fn(),removeListener:vi.fn()}));
    global.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};
    HTMLElement.prototype.scrollIntoView=vi.fn();
    vi.stubGlobal('fetch',vi.fn(async(url,options={})=>{
        const payload=options.body instanceof FormData?{engine:options.body.get('engine'),file:options.body.get('file')}:options.body?JSON.parse(options.body):null;
        requests.push({url,method:options.method||'GET',payload});
        if(url==='/access/status')return {ok:true,status:200,json:async()=>({requiresSetup:setupRequired})};
        if(url==='/admin/access/setup'){setupRequired=false;return {ok:true,status:200,json:async()=>({ok:true})};}
        if(url==='/admin/instances/batch'&&options.method==='POST')for(const instance of state.instances)if(payload.ids.includes(instance.id))instance.enabled=payload.enabled;
        if(url.startsWith('/admin/scripts/')&&options.method==='DELETE'){
            const ids=url==='/admin/scripts/batch'?payload.ids:[url.split('/').at(-1)];
            const removed=state.instances.filter(item=>ids.includes(item.scriptId)).map(item=>item.id);
            state.scripts=state.scripts.filter(script=>!ids.includes(script.id));state.instances=state.instances.filter(item=>!ids.includes(item.scriptId));
            for(const sub of state.subscriptions)sub.instances=sub.instances.filter(id=>!removed.includes(id));
        }
        if(url.startsWith('/admin/instances/')&&options.method==='PUT')Object.assign(state.instances.find(s=>s.id===url.split('/').at(-1)),payload);
        if(url==='/admin/subscriptions'&&options.method==='POST')state.subscriptions.push({id:'s',...payload,token:payload.token||'test'});
        if(url.startsWith('/admin/subscriptions/')&&options.method==='PUT')Object.assign(state.subscriptions.find(s=>s.id===url.split('/').at(-1)),payload);
        if(url==='/admin/scripts/create'&&options.method==='POST'){
            const script={id:'created',engine:'dr3',file:payload.name+'.js'};
            state.scripts.push(script);state.instances.push({...initial().instances[0],id:'created-source',scriptId:script.id,name:payload.name});
            return {ok:true,status:200,json:async()=>script};
        }
        return {ok:true,status:200,json:async()=>structuredClone(url==='/admin/state'?state:{ok:true})};
    }));
});
afterEach(()=>{wrapper?.unmount();document.body.innerHTML='';sessionStorage.clear();history.replaceState({},'','/');vi.unstubAllGlobals();});

describe('shadcn 控制台绑定',()=>{
    it('无独立Emby侧栏，订阅链接提供TVBox/猫影视/Emby并使用浏览器当前地址',async()=>{
        state.subscriptions=[{id:'sub',name:'客厅',token:'Sub-token',enabled:true,instances:['a']}];vi.stubGlobal('location',new URL('https://coketv.example.test/admin'));
        await start();expect(button('Emby服务')).toBeUndefined();await button('订阅管理').trigger('click');await wrapper.find('[aria-label="订阅链接"]').trigger('click');await flushPromises();
        const tabs=[...document.querySelectorAll('[role="tab"]')];expect(tabs.map(t=>t.textContent.trim())).toEqual(['TVBox','猫影视','Emby']);
        tabs.find(t=>t.textContent.trim()==='Emby').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));await flushPromises();
        expect(document.querySelector('[aria-label="Emby服务器地址"]').value).toBe('https://coketv.example.test');expect(document.querySelector('[aria-label="Emby用户名"]').value).toBe('coke');expect(document.querySelector('[aria-label="Emby密码"]').value).toBe('Sub-token');
        expect(requests.some(r=>r.url==='/admin/subscriptions/sub/emby/prepare'&&r.method==='POST')).toBe(true);expect(requests.some(r=>r.url==='/admin/emby')).toBe(false);
    });
    it.each(['http://abc.com:54058','http://192.168.1.10:54058','https://tv.example.test'])('订阅链接跟随浏览器地址%s，忽略旧配置和后端地址',async origin=>{
        vi.stubGlobal('location',new URL(origin+'/admin'));
        state.settings.publicUrl='https://old.invalid';state.baseUrl='http://backend:54058';
        state.subscriptions=[{id:'sub',name:'客厅',token:'Sub-token',enabled:true,instances:['a']}];
        await start();await button('订阅管理').trigger('click');await wrapper.find('[aria-label="订阅链接"]').trigger('click');await flushPromises();
        expect(document.querySelector('input[aria-label="订阅链接"]').value).toBe(origin+'/tvbox/Sub-token');
        const tabs=[...document.querySelectorAll('[role="tab"]')];
        tabs.find(t=>t.textContent.trim()==='猫影视').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));await flushPromises();
        expect(document.querySelector('input[aria-label="猫影视订阅链接"]').value).toBe(origin+'/cat/Sub-token/index.js.md5');
        tabs.find(t=>t.textContent.trim()==='Emby').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));await flushPromises();
        expect(document.querySelector('[aria-label="Emby服务器地址"]').value).toBe(origin);
    });
    it('新建订阅可以填写自定义令牌，并用于两个订阅链接',async()=>{
        await start();await button('订阅管理').trigger('click');await button('新建订阅').trigger('click');await flushPromises();
        const input=document.querySelector('#subscription-token');
        expect(input).not.toBeNull();expect(input.readOnly).toBe(false);expect(input.value).toBe('');
        const name=document.querySelector('#subscription-name');name.value='客厅';name.dispatchEvent(new Event('input',{bubbles:true}));
        input.value='Living_room-2026';input.dispatchEvent(new Event('input',{bubbles:true}));await flushPromises();
        document.querySelector('#subscription-form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await flushPromises();
        expect(requests.find(r=>r.url==='/admin/subscriptions'&&r.method==='POST').payload.token).toBe('Living_room-2026');
        await wrapper.find('[aria-label="订阅链接"]').trigger('click');await flushPromises();
        expect(document.querySelector('input[aria-label="订阅链接"]').value).toBe(window.location.origin+'/tvbox/Living_room-2026');
        const cat=[...document.querySelectorAll('[role="tab"]')].find(item=>item.textContent.includes('猫影视'));
        cat.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));await flushPromises();
        expect(document.querySelector('input[aria-label="猫影视订阅链接"]').value).toContain('/Living_room-2026/index.js.md5');
    });
    it('编辑令牌取消不修改订阅，保存后提交自定义值并保留源顺序',async()=>{
        state.subscriptions=[{id:'sub',name:'客厅',token:'Old-token',enabled:true,instances:['b','a']}];
        await start();await button('订阅管理').trigger('click');await wrapper.find('[aria-label="配置订阅"]').trigger('click');await flushPromises();
        let input=document.querySelector('#subscription-token');expect(input.readOnly).toBe(false);
        input.value='Cancelled-token';input.dispatchEvent(new Event('input',{bubbles:true}));await flushPromises();
        [...document.querySelectorAll('[role="dialog"] button')].find(b=>b.textContent.trim()==='取消').click();await flushPromises();
        expect(state.subscriptions[0].token).toBe('Old-token');
        expect(requests.some(r=>r.method==='PUT'&&r.url==='/admin/subscriptions/sub')).toBe(false);
        await wrapper.find('[aria-label="配置订阅"]').trigger('click');await flushPromises();
        input=document.querySelector('#subscription-token');expect(input.value).toBe('Old-token');
        input.value='Saved-token';input.dispatchEvent(new Event('input',{bubbles:true}));await flushPromises();
        document.querySelector('#subscription-form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await flushPromises();
        const saved=requests.find(r=>r.method==='PUT'&&r.url==='/admin/subscriptions/sub').payload;
        expect(saved.token).toBe('Saved-token');expect(saved.instances).toEqual(['b','a']);expect(saved.enabled).toBe(true);
    });
    it('订阅窗口提供猫影视四文件入口并保留 TVBox 链接',async()=>{
        state.subscriptions=[{id:'cat-sub',name:'家庭订阅',token:'sub-token',enabled:true,instances:['a']}];
        vi.stubGlobal('location',new URL('https://coketv.example.test/admin'));
        await start();await button('订阅管理').trigger('click');
        await wrapper.find('[aria-label="订阅链接"]').trigger('click');await flushPromises();
        expect(document.querySelector('input[aria-label="订阅链接"]').value).toBe('https://coketv.example.test/tvbox/sub-token');
        const tab=[...document.querySelectorAll('[role="tab"]')].find(item=>item.textContent.includes('猫影视'));
        expect(tab).toBeDefined();tab.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));await flushPromises();
        expect(document.querySelector('input[aria-label="猫影视订阅链接"]').value).toBe('https://coketv.example.test/cat/sub-token/index.js.md5');
        expect(document.querySelector('[role="dialog"]').textContent).toContain('Miraplay');
        expect(document.querySelector('[aria-label="复制猫影视订阅链接"]')).not.toBeNull();
    });
    it('旧备份重复令牌仍显示带ID的兼容链接，避免短地址指向不明订阅',async()=>{
        state.subscriptions=[{id:'one',name:'一',token:'shared',enabled:true,instances:[]},{id:'two',name:'二',token:'shared',enabled:true,instances:[]}];
        await start();await button('订阅管理').trigger('click');
        await wrapper.findAll('[aria-label="订阅链接"]')[0].trigger('click');await flushPromises();
        expect(document.querySelector('input[aria-label="订阅链接"]').value).toBe(window.location.origin+'/subscription/one?token=shared');
        const cat=[...document.querySelectorAll('[role="tab"]')].find(item=>item.textContent.includes('猫影视'));
        cat.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));await flushPromises();
        expect(document.querySelector('input[aria-label="猫影视订阅链接"]').value).toBe(window.location.origin+'/cat/one/shared/index.js.md5');
    });
    it('首次进入创建密码，输入不一致不提交，成功后进入并保存新凭据',async()=>{
        setupRequired=true;await start();
        expect(wrapper.text()).toContain('首次进入管理后台');
        expect(requests.some(item=>item.url==='/admin/state')).toBe(false);
        expect(wrapper.find('#setup-code').exists()).toBe(false);
        expect(wrapper.text()).not.toContain('初始化码');
        expect(wrapper.findAll('input')).toHaveLength(2);
        await wrapper.find('#new-password').setValue('new-password');await wrapper.find('#confirm-password').setValue('different');
        await wrapper.find('form').trigger('submit');await flushPromises();
        expect(wrapper.text()).toContain('两次输入的密码不一致');
        expect(requests.some(item=>item.url==='/admin/access/setup')).toBe(false);
        await wrapper.find('#confirm-password').setValue('new-password');await wrapper.find('form').trigger('submit');await flushPromises();
        expect(requests.find(item=>item.url==='/admin/access/setup').payload).toEqual({password:'new-password',confirmPassword:'new-password'});
        expect(atob(sessionStorage.getItem('coketv-access'))).toBe(':new-password');
        expect(wrapper.find('.source-table').exists()).toBe(true);
        await wrapper.find('[aria-label="退出"]').trigger('click');await flushPromises();
        expect(wrapper.find('#new-password').exists()).toBe(false);
        expect(wrapper.find('#login-password').exists()).toBe(true);
    });
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
    it('导入脚本直接选择本地JS或ZIP，不再显示TVBox链接或运行格式选择',async()=>{
        await start();
        const chooser=wrapper.find('#source-upload');const click=vi.spyOn(chooser.element,'click').mockImplementation(()=>{});
        await button('导入脚本').trigger('click');await flushPromises();
        expect(click).toHaveBeenCalledOnce();expect(chooser.attributes('accept')).toBe('.js,.zip');
        expect(document.querySelector('#tvbox-url')).toBeNull();
        expect(document.querySelector('[role="dialog"]')).toBeNull();
        expect(wrapper.text()).not.toContain('标签');
        expect(document.querySelector('[role="menu"]')).toBeNull();
        await button('添加源').trigger('click');await flushPromises();
        expect(document.querySelector('[role="dialog"]').textContent).not.toContain('无需填写扩展名');
    });
    it('旧脚本导入失败后明确报错，不显示引擎选择',async()=>{
        await start();const file=new File(['var rule={};'],'old.js',{type:'text/javascript'});
        const previous=globalThis.fetch;
        globalThis.fetch=vi.fn(async(url,options)=>url==='/admin/upload'?{ok:false,status:422,json:async()=>({error:'只支持 drpy3 源',code:'IMPORT_DRPY3_REQUIRED'})}:previous(url,options));
        Object.defineProperty(wrapper.find('#source-upload').element,'files',{configurable:true,value:[file]});
        await wrapper.find('#source-upload').trigger('change');await flushPromises();
        expect(document.querySelector('#import-engine')).toBeNull();
    });
    it('待迁移源单独筛选，新建固定为drpy3',async()=>{
        useAllEngines();await start();const filter=wrapper.find('[aria-label="迁移状态筛选"]');
        expect(filter.findAll('option').map(item=>item.text())).toEqual(['全部','drpy3','待迁移']);
        await filter.setValue('current');expect(wrapper.findAll('tbody tr')).toHaveLength(1);
        await filter.setValue('legacy');expect(wrapper.findAll('tbody tr')).toHaveLength(5);
        await button('添加源').trigger('click');await flushPromises();expect(document.querySelector('#new-type')).toBeNull();
        const name=document.querySelector('#new-name');name.value='我的源.js';name.dispatchEvent(new Event('input',{bubbles:true}));
        await flushPromises();document.querySelector('[role="dialog"] form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await flushPromises();
        expect(requests.find(item=>item.url==='/admin/scripts/create').payload).toEqual({name:'我的源'});
        expect(wrapper.find('.workspace-shell').text()).toBe('编辑 我的源');
    });
    it('名称单击只重命名，保留最新参数、标签与能力',async()=>{
        await start();
        expect(wrapper.findAll('th').map(item=>item.text())).toEqual(['','名称','状态','搜索','筛选','操作']);
        expect(wrapper.find('[aria-label="迁移状态筛选"]').exists()).toBe(false);
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
    it('批量删除按脚本去重，确认后删除脚本和所有关联源',async()=>{
        await start();await wrapper.find('[aria-label="选择源A"]').trigger('click');await wrapper.find('[aria-label="选择源B"]').trigger('click');
        await button('删除',wrapper.find('.selection-tools')).trigger('click');await flushPromises();
        const dialog=document.querySelector('[role="alertdialog"]');
        expect(dialog.textContent).toContain('1 个脚本文件');expect(dialog.textContent).toContain('2 个关联源');expect(dialog.textContent).toContain('无法恢复');
        expect(dialog.querySelector('#delete-source-scripts')).toBeNull();expect(requests.some(item=>item.method==='DELETE')).toBe(false);
        [...dialog.querySelectorAll('button')].find(item=>item.textContent==='删除').click();await flushPromises();
        expect(requests.find(item=>item.method==='DELETE')).toMatchObject({url:'/admin/scripts/batch',payload:{ids:['script']}});
        expect(wrapper.find('.selection-tools').exists()).toBe(false);expect(state.instances).toHaveLength(0);expect(state.scripts).toHaveLength(0);
    });
    it('取消批量删除保留选择，不发送删除请求',async()=>{
        await start();await wrapper.find('[aria-label="选择源A"]').trigger('click');
        await button('删除',wrapper.find('.selection-tools')).trigger('click');await flushPromises();
        [...document.querySelectorAll('[role="alertdialog"] button')].find(item=>item.textContent==='取消').click();await flushPromises();
        expect(requests.some(item=>item.method==='DELETE')).toBe(false);expect(wrapper.find('.selection-tools').text()).toContain('已选择 1');
    });
    it('只选共享脚本的一个源，也明确提示并清理全部关联源',async()=>{
        await start();await wrapper.find('[aria-label="选择源A"]').trigger('click');
        await button('删除',wrapper.find('.selection-tools')).trigger('click');await flushPromises();
        const dialog=document.querySelector('[role="alertdialog"]');expect(dialog.textContent).toContain('2 个关联源');
        [...dialog.querySelectorAll('button')].find(item=>item.textContent==='删除').click();await flushPromises();
        expect(requests.find(item=>item.method==='DELETE')).toMatchObject({url:'/admin/scripts/batch',payload:{ids:['script']}});
        expect(state.instances).toHaveLength(0);
    });
    it('单行删除直接删除脚本，不再提供保留文件选项',async()=>{
        await start();await wrapper.find('[title="删除脚本"]').trigger('click');await flushPromises();
        let dialog=document.querySelector('[role="alertdialog"]');expect(dialog.textContent).toContain('样本.js');expect(dialog.textContent).toContain('2 个关联源');
        [...dialog.querySelectorAll('button')].find(item=>item.textContent==='取消').click();await flushPromises();expect(requests.some(item=>item.method==='DELETE')).toBe(false);
        await wrapper.find('[title="删除脚本"]').trigger('click');await flushPromises();dialog=document.querySelector('[role="alertdialog"]');
        [...dialog.querySelectorAll('button')].find(item=>item.textContent==='删除').click();await flushPromises();
        expect(requests.find(item=>item.method==='DELETE')).toMatchObject({url:'/admin/scripts/script',payload:null});expect(state.scripts).toHaveLength(0);
    });
    it('遗留未使用脚本出现在列表并可真删除，没有新建实例或扫描目录入口',async()=>{
        state.scripts.push({id:'orphan',engine:'dr3',file:'s.js',name:'s'});await start();
        expect(button('新建实例')).toBeUndefined();expect(button('扫描源目录')).toBeUndefined();expect(wrapper.findAll('tbody tr')).toHaveLength(3);
        const row=wrapper.findAll('tbody tr').find(row=>row.text().includes('未使用'));expect(row.text()).toContain('s');
        expect(row.find('[title="编辑脚本"]').attributes('disabled')).toBeDefined();await row.find('[title="删除脚本"]').trigger('click');await flushPromises();
        const dialog=document.querySelector('[role="alertdialog"]');expect(dialog.textContent).toContain('s.js');expect(dialog.textContent).toContain('0 个关联源');
        [...dialog.querySelectorAll('button')].find(item=>item.textContent==='删除').click();await flushPromises();
        expect(requests.find(item=>item.method==='DELETE').url).toBe('/admin/scripts/orphan');expect(state.scripts).toHaveLength(1);expect(state.instances).toHaveLength(2);
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
    it('管理侧栏只保留观影、源、订阅和网盘，移除整个设置页面',async()=>{
        await start();
        expect(wrapper.findAll('.omni-navigation button').map(item=>item.text().trim())).toEqual(['网页观影','源管理','订阅管理','网盘管理']);
        expect(button('设置')).toBeUndefined();expect(button('保存设置')).toBeUndefined();
        expect(wrapper.find('.settings-layout').exists()).toBe(false);
        expect(wrapper.find('#default-env').exists()).toBe(false);
        expect(requests.some(request=>request.url==='/admin/settings')).toBe(false);
    });
});
