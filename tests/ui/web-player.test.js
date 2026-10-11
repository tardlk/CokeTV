import {afterEach, describe, expect, it, vi} from 'vitest';
import {flushPromises, mount} from '@vue/test-utils';
import WebPlayer from '../../web/WebPlayer.vue';

const state=vi.hoisted(()=>({player:null}));
vi.mock('artplayer',()=>({default:class {
    constructor(options){this.options=options;this.video=document.createElement('video');this.handlers={};this.currentTime=0;this.duration=100;this.layers={};state.player=this;}
    set url(value){this.value=value;if(value) (this.options.customType[this.type]||this.options.customType.auto)(this.video,value);}
    get url(){return this.value;}
    on(event,callback){this.handlers[event]=callback;}
    pause(){}
    play(){return Promise.resolve();}
    destroy(){}
}}));
let wrapper;
afterEach(()=>{wrapper?.unmount();wrapper=null;vi.unstubAllGlobals();});
describe('网页直连播放',()=>{
    it('没有CORS许可的原生媒体直接交给video，不先fetch探测或请求NAS媒体代理',async()=>{
        const fetch=vi.fn().mockRejectedValue(new TypeError('CORS blocked'));vi.stubGlobal('fetch',fetch);
        const url='https://cdn.example.test/opaque?signature=fixture';
        wrapper=mount(WebPlayer,{props:{media:{url,type:'native',direct:true}}});await flushPromises();
        expect(state.player.video.src).toBe(url);expect(fetch).not.toHaveBeenCalled();
        expect(state.player.video.hasAttribute('crossorigin')).toBe(false);
    });
    it('未知格式直连也不进行跨域fetch；错误和切集不会自动回退NAS',async()=>{
        const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
        wrapper=mount(WebPlayer,{props:{media:{url:'https://cdn.example.test/first',direct:true}}});await flushPromises();
        expect(state.player.video.src).toBe('https://cdn.example.test/first');
        state.player.handlers['video:error']();
        expect(wrapper.emitted('error')[0][0]).toContain('直连播放失败');
        await wrapper.setProps({media:{url:'https://cdn.example.test/second',type:'native',direct:true}});await flushPromises();
        expect(state.player.video.src).toBe('https://cdn.example.test/second');expect(fetch).not.toHaveBeenCalled();
    });
});
