// Protocol fixtures migrated to native drpy3 hooks. This is test data generation,
// never imported by the application or shipped in the runtime image.
export function ruleFixture(code) {
    return `const setResult = rows => rows.map(row => ({...row,vod_id:row.vod_id??row.url,vod_name:row.vod_name??row.title,vod_pic:row.vod_pic??row.img??'',vod_remarks:row.vod_remarks??row.desc??''}));
let context;
const getProxyUrl=()=>context.proxyUrl;
const raw=(()=>{${code};return rule;})();
const bind=(ctx,id)=>Object.assign(raw,{...ctx.__rt.hostEnv.env,params:ctx.__rt.hostEnv.env.ext,orId:id??ctx.input});
const list=result=>Array.isArray(result)?{list:result}:result;
export default {meta:{title:raw.title,lang:'dr3'},rule:{host:raw.host||'',class_name:raw.class_name||'',class_url:raw.class_url||''},
init(ctx){context=ctx.__rt.hostEnv.env;},
home:async function(ctx,...args){context=ctx.__rt.hostEnv.env;return typeof raw.class_parse==='function'?raw.class_parse.apply(bind(ctx),args):{class:[]};},
homeVod:async function(ctx){context=ctx.__rt.hostEnv.env;return typeof raw.推荐==='function'?list(await raw.推荐.call(bind(ctx))):{list:[]};},
category:async function(ctx,...args){context=ctx.__rt.hostEnv.env;return typeof raw.一级==='function'?list(await raw.一级.apply(bind(ctx),args)):{list:[]};},
search:async function(ctx,...args){context=ctx.__rt.hostEnv.env;return typeof raw.搜索==='function'?list(await raw.搜索.apply(bind(ctx),args)):{list:[]};},
detail:async function(ctx,id){context=ctx.__rt.hostEnv.env;const vod=typeof raw.二级==='function'?await raw.二级.call(bind(ctx,id),[id]):{};return vod.list?vod:{list:[vod]};},
play:async function(ctx,flag,id){context=ctx.__rt.hostEnv.env;return raw.lazy?raw.lazy.call(bind(ctx,id),flag,id):{parse:0,url:id};},
proxy:async function(ctx,params){context=ctx.__rt.hostEnv.env;return raw.proxy_rule.call(bind(ctx),params);},
action:async function(ctx,...args){context=ctx.__rt.hostEnv.env;return raw.action.apply(bind(ctx),args);}};`;
}
export function moduleFixture(code) {
    const body=code.replace(/export\s+function\s+__jsEvalReturn/g,'function __jsEvalReturn').replace(/export\s+default\s*/g,'const fixtureDefault = ');
    return `let host; const getProxyUrl=()=>host.proxyUrl;\n${body}\nconst fixture=typeof __jsEvalReturn==='function'?__jsEvalReturn():fixtureDefault;
const source={meta:{lang:'dr3'},rule:{}};
for(const method of ['init','home','homeVod','category','search','detail','play','proxy','action']){
source[method]=async function(ctx,...args){host=ctx.__rt.hostEnv.env;if(method==='init')return fixture.init?.({...host,ext:args[0]});return fixture[method]?.(...args)??(method==='home'?{class:[]}:{list:[]});};}
export default source;`;
}
