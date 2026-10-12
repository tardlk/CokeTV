// Synthetic, offline sources only. Never copied into the distribution engine.
export const marker = 'compat_fixture_';
const queries = [{}, {ac:'list',t:'movie',pg:'2'}, {wd:'样片',quick:'',pg:'2'}, {ac:'detail',ids:'one,two'}, {play:'https://media.example.test/fixture.mp4'}];
const js = `var rule={title:'契约样本',host:'https://fixture.example.test',
class_parse:async function(filter){return {class:[{type_id:'movie',type_name:'样片'}],list:[{vod_id:'home',vod_name:'首页'}],filter};},
推荐:async()=>[],一级:async function(tid,pg,filter,extend){return [{vod_id:'category',vod_name:JSON.stringify({tid,pg,filter,extend})}];},
搜索:async function(wd,quick,pg){return {list:[],args:{wd,quick,pg}};},二级:async function(ids){return {list:[],ids};},
lazy:async function(flag,id,flags){return {parse:0,url:id,args:{flag,flags}};},
proxy_rule:async()=>[200,'text/plain','fixture-proxy'],action:async(name,value)=>({name,value})};`;
const cat = `let config;export default {init:async value=>{config=value;},
home:async filter=>({class:[{type_id:'movie',type_name:'样片'}],list:[{vod_id:'home',vod_name:'首页'}],filter}),homeVod:async()=>({list:[]}),
category:async(tid,pg,filter,extend)=>({list:[],args:{tid,pg,filter,extend},config}),
search:async(wd,quick,pg)=>({list:[],args:{wd,quick,pg}}),detailContent:async ids=>({list:[],ids}),
play:async(flag='default-flag',id,flags='default-flags')=>({parse:0,url:id,args:{flag,flags}}),
proxy:async()=>[200,'text/plain','fixture-proxy'],action:async(name,value)=>({name,value})};`;
const python = `from base.spider import BaseSpider
class Spider(BaseSpider):
    def init(self,extend=''): self.extend=extend
    def homeContent(self,filter): return {'class':[{'type_id':'movie','type_name':'样片'}],'filter':filter}
    def homeVideoContent(self): return {'list':[{'vod_id':'home','vod_name':'首页'}]}
    def categoryContent(self,tid,pg,filter,extend): return {'list':[],'args':{'tid':tid,'pg':pg,'filter':filter,'extend':extend}}
    def searchContent(self,wd,quick,pg=1): return {'list':[],'args':{'wd':wd,'quick':quick,'pg':pg}}
    def detailContent(self,ids): return {'list':[],'ids':ids}
    def playerContent(self,flag,id,vipFlags=None): return {'parse':0,'url':id,'args':{'flag':flag,'flags':vipFlags}}
    def localProxy(self,params): return [200,'text/plain','fixture-proxy']
    def isVideoFormat(self,url): return False
    def manualVideoCheck(self): return False
`;
const php = `<?php require_once __DIR__.'/lib/spider.php';
class Spider extends BaseSpider {
public function homeContent($filter){return ['class'=>[['type_id'=>'movie','type_name'=>'样片']],'filter'=>$filter];}
public function homeVideoContent(){return ['list'=>[['vod_id'=>'home','vod_name'=>'首页']]];}
public function categoryContent($tid,$pg=1,$filter=[],$extend=[]){return ['list'=>[],'args'=>compact('tid','pg','filter','extend')];}
public function searchContent($wd,$quick=false,$pg=1){return ['list'=>[],'args'=>compact('wd','quick','pg')];}
public function detailContent($ids){return ['list'=>[],'ids'=>$ids];}
public function playerContent($flag,$id,$vipFlags=[]){return ['parse'=>0,'url'=>$id,'args'=>['flag'=>$flag,'flags'=>$vipFlags]];}
public function localProxy($params){return [200,'text/plain','fixture-proxy'];}
}`;
const pyHelper = body => python.replace("return {'class':[{'type_id':'movie','type_name':'样片'}],'filter':filter}",body);
export const sources = [
    {engine:'js',name:'js',code:js,queries:[...queries,{ac:'action',action:'echo',value:'fixture'}]},
    {engine:'cat',name:'cat',code:cat,queries:[...queries,{ac:'action',action:'echo',value:'fixture'}, {filter:null}, {ac:'list',t:'movie',pg:'-2',ext:'invalid'}]},
    {engine:'py',name:'py',code:python,queries:[...queries,{ac:'list',t:'123',pg:'2'},{wd:'123',quick:'0',pg:'2'}]},
    {engine:'php',name:'php',code:php,queries},
    {engine:'cat',name:'cat_cold',code:`export default {init:async()=>{},home:async()=>({class:[],extracted:strExtract('a=fixture','a=(.*)',1),subtitle:lrcToSrt('[00:01.00]样片'),database:typeof DataBase,jsonBig:typeof JsonBig}),homeVod:async()=>({list:[]})};`,queries:[{}]},
    {engine:'py',name:'py_partial',code:`from base.spider import BaseSpider\nclass Spider(BaseSpider):\n    def homeContent(self,filter): return {'class':[{'type_id':'minimal','type_name':'最小源'}]}\n`,queries:[{}, {ac:'list',t:'movie'}, {wd:'样片'}]},
    {engine:'py',name:'py_build_url',code:pyHelper("return {'class':[],'value':self.buildUrl('https://fixture.example.test/x?raw=YQ==&flag',{'page':2})}"),queries:[{}]},
    {engine:'py',name:'py_hex',code:pyHelper("return {'class':[],'value':self.bytesToHexString(bytes([1,255]),False)}"),queries:[{}]},
    {engine:'py',name:'py_hls',code:pyHelper("return {'class':[],'value':self.fixAdM3u8('#EXTM3U\\n#EXTINF:4,\\na.ts\\n#EXTINF:4,\\nb.ts','https://fixture.example.test/live/index.m3u8')}"),queries:[{}]},
    {engine:'py',name:'py_rsa',code:pyHelper("\n        from Crypto.PublicKey import RSA\n        key=RSA.generate(1024)\n        public=''.join(key.publickey().export_key().decode().splitlines()[1:-1])\n        private=''.join(key.export_key().decode().splitlines()[1:-1])\n        encoded=self.rsa_public_encode('fixture',public)\n        return {'class':[],'value':self.rsa_private_decode(encoded,private)=='fixture'}"),queries:[{}]},
    {engine:'php',name:'php_env',code:`<?php require_once __DIR__.'/lib/spider.php'; class Spider extends BaseSpider {private $initial;public function init($extend=''){$this->initial=$this->getProxyUrl();}public function homeContent($filter){return ['class'=>[],'proxy'=>$this->getProxyUrl(),'initial'=>$this->initial];}}`,queries:[{}]},
    {engine:'php',name:'php_large',code:`<?php require_once __DIR__.'/lib/spider.php'; class Spider extends BaseSpider {public function homeContent($filter){return ['class'=>[],'payload'=>str_repeat('x',11*1024*1024)];}}`,queries:[{}]},
    {engine:'js',name:'child',code:`var rule={title:'child',host:'https://fixture.example.test',class_parse:async function(){return {class:[],proxy:this.getProxyUrl()};},推荐:async()=>[],custom:()=> 'fixture-custom',action:async(name,value)=>({name,value})};`,queries:[{}]},
    {engine:'js',name:'cross_missing',code:`var rule={title:'missing',host:'https://fixture.example.test',class_parse:async function(){return {class:[],missing:(await this.getRule('${marker}absent'))===null};},推荐:async()=>[]};`,queries:[{}]},
    {engine:'js',name:'cross_child',code:`var rule={title:'cross',host:'https://fixture.example.test',class_parse:async function(){const child=await this.getRule('${marker}child');return {class:[],title:child.title,child:await child.callRuleFn('class_parse',[1]),unknown:await child.callRuleFn('not_a_method',[]),customType:typeof(await child.callRuleFn('custom',[]))};},推荐:async()=>[]};`,queries:[{}]},
    {engine:'cat',name:'refresh',code:`let count=0;export default {init:async()=>{count++},home:async()=>({class:[],count}),homeVod:async()=>[]};`,queries:[{},{refresh:'1'},{}]},
    {engine:'cat',name:'home_budget',timeout:2000,code:`const previous=process.env.API_TIMEOUT;export default {
        init:async()=>{},action:async name=>{if(name==='configure')process.env.API_TIMEOUT='2';else if(previous===undefined)delete process.env.API_TIMEOUT;else process.env.API_TIMEOUT=previous;return {configured:name==='configure'};},
        home:async()=>{await new Promise(r=>setTimeout(r,1400));return {class:[],phase:'home'};},
        homeVod:async()=>{await new Promise(r=>setTimeout(r,1400));return [{vod_id:'budget',vod_name:'per-method'}];}
    };`,queries:[{ac:'action',action:'configure'},{},{ac:'action',action:'restore'}]},
    {engine:'cat',name:'action_budget',timeout:20,code:`export default {init:async()=>{},home:async()=>({class:[]}),homeVod:async()=>[],action:async()=>{await new Promise(r=>setTimeout(r,50));return {completed:true};}};`,queries:[{ac:'other',action:'delay'}]},
];
export const extension = engine => engine==='py'?'.py':engine==='php'?'.php':'.js';
