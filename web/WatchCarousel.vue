<script setup>
import {ref, watch, onBeforeUnmount} from 'vue';
import emblaCarouselVue from 'embla-carousel-vue';
import {ArrowLeft, ArrowRight} from '@lucide/vue';
const props = defineProps({items: {type: Array, required: true}});
const emit = defineEmits(['select']);
const [viewport, carousel] = emblaCarouselVue({align: 'start', loop: true});
const selected = ref(0);
let timer;
const syncSelected = api => { selected.value = api.selectedScrollSnap(); };
watch(carousel, (api, previous) => {
    previous?.off('select', syncSelected); previous?.off('reInit', syncSelected);
    if (api) { api.on('select', syncSelected); api.on('reInit', syncSelected); syncSelected(api); }
});
watch(() => [carousel.value, props.items.length], () => {
    clearInterval(timer);
    if (carousel.value && props.items.length > 1) timer = setInterval(() => {
        if (document.visibilityState !== 'hidden' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) carousel.value?.scrollNext();
    }, 5000);
});
function open(item, event) { if (!event.defaultPrevented) emit('select', item); }
function keyboard(event) {
    if (event.key === 'ArrowLeft') { event.preventDefault(); carousel.value?.scrollPrev(); }
    if (event.key === 'ArrowRight') { event.preventDefault(); carousel.value?.scrollNext(); }
}
onBeforeUnmount(() => {
    clearInterval(timer);
    carousel.value?.off('select', syncSelected); carousel.value?.off('reInit', syncSelected);
});
</script>

<template>
  <section class="watch-carousel" role="region" aria-roledescription="轮播" aria-label="热播推荐" @keydown="keyboard">
    <div ref="viewport" class="watch-carousel-viewport"><div class="watch-carousel-track">
      <div v-for="(item,index) in items" :key="item.title+item.backgroundImage" class="watch-carousel-slide" role="group" aria-roledescription="幻灯片" :aria-label="`${index+1} / ${items.length}`" :aria-hidden="index!==selected">
        <button class="watch-carousel-card" :tabindex="index===selected?0:-1" :aria-label="`搜索全部源：${item.title}`" @click="open(item,$event)">
          <img class="watch-carousel-image" :src="item.backgroundImage" alt="" referrerpolicy="no-referrer" draggable="false" :fetchpriority="index===0?'high':'auto'" @error="$event.target.style.visibility='hidden'" />
          <span class="watch-carousel-shade" aria-hidden="true" />
          <span class="watch-carousel-content"><span class="watch-carousel-container"><span class="watch-carousel-copy">
            <span v-if="item.genre" class="watch-carousel-genre-row"><span class="watch-carousel-genre">{{item.genre}}</span></span>
            <span role="heading" aria-level="1" class="watch-carousel-title">{{item.title}}</span>
            <span v-if="item.subtitle" class="watch-carousel-subtitle">{{item.subtitle}}</span>
            <span v-if="item.actors" class="watch-carousel-actors">{{item.actors}}</span>
            <span v-if="item.description" class="watch-carousel-description">{{item.description}}</span>
          </span></span></span>
        </button>
      </div>
    </div></div>
    <template v-if="items.length>1">
      <button class="watch-carousel-arrow watch-carousel-prev" aria-label="上一张轮播图" @click="carousel?.scrollPrev()"><ArrowLeft /></button>
      <button class="watch-carousel-arrow watch-carousel-next" aria-label="下一张轮播图" @click="carousel?.scrollNext()"><ArrowRight /></button>
      <div class="watch-carousel-dots"><button v-for="(item,index) in items" :key="index" :class="{'is-selected':index===selected}" :aria-label="`切换到第 ${index+1} 张轮播图`" :aria-current="index===selected?'true':undefined" @click="carousel?.scrollTo(index)" /></div>
    </template>
  </section>
</template>

<style scoped>
.watch-carousel{position:relative;width:100%;background:#000;color:#fff;flex:none}
.watch-carousel-viewport{overflow:hidden}.watch-carousel-track{display:flex;touch-action:pan-y pinch-zoom}.watch-carousel-slide{flex:0 0 100%;min-width:0}
.watch-carousel-card{position:relative;display:block;width:100%;height:clamp(200px,20vh,350px);overflow:hidden;border:0;padding:0;background:#000;text-align:left;color:#fff;font:inherit;cursor:pointer;outline-offset:-3px}
.watch-carousel-image,.watch-carousel-shade{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center;transition:all 1s ease-in-out}
.watch-carousel-shade{background:linear-gradient(90deg,rgba(0,0,0,.85) 0%,rgba(0,0,0,.7) 20%,rgba(0,0,0,.5) 40%,rgba(0,0,0,.3) 60%,rgba(0,0,0,.15) 75%,rgba(0,0,0,.05) 90%,transparent 100%),linear-gradient(180deg,rgba(0,0,0,.3) 0%,transparent 15%,transparent 85%,rgba(0,0,0,.4) 100%),radial-gradient(ellipse at right center,transparent 0%,rgba(0,0,0,.1) 70%,rgba(0,0,0,.3) 100%)}
.watch-carousel-content{position:relative;z-index:1;height:100%;display:flex;align-items:center}.watch-carousel-container{display:block;width:100%;margin:0 auto;padding:0 12px}.watch-carousel-copy{display:block;max-width:576px}
.watch-carousel-genre-row{display:block;margin-bottom:8px}.watch-carousel-genre{display:inline-block;padding:4px 8px;border-radius:9999px;background:rgb(34 197 94 / .2);color:#22c55e;font-size:12px;line-height:16px;font-weight:500}
.watch-carousel-title{display:block;font-size:20px;line-height:1.25;font-weight:700;margin-bottom:8px;letter-spacing:normal}.watch-carousel-subtitle{display:block;font-size:14px;line-height:20px;color:rgb(255 255 255 / .9);margin-bottom:8px}
.watch-carousel-actors{display:block;font-size:12px;line-height:16px;color:rgb(255 255 255 / .8);margin-bottom:8px}.watch-carousel-description{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;font-size:12px;line-height:16px;color:rgb(255 255 255 / .7);margin-bottom:16px}
.watch-carousel-arrow{display:none;position:absolute;z-index:2;top:50%;transform:translateY(-50%);align-items:center;justify-content:center;width:32px;height:32px;padding:0;border:1px solid rgb(255 255 255 / .2);border-radius:9999px;background:rgb(0 0 0 / .3);color:white;transition:background .15s,border-color .15s}.watch-carousel-arrow:hover{background:rgb(0 0 0 / .5);border-color:rgb(255 255 255 / .4)}.watch-carousel-arrow svg{width:16px;height:16px}.watch-carousel-prev{left:16px}.watch-carousel-next{right:16px}
.watch-carousel-dots{position:absolute;bottom:16px;left:50%;transform:translateX(-50%);z-index:2;display:flex;gap:8px}.watch-carousel-dots button{width:8px;height:8px;border:0;padding:0;border-radius:9999px;background:rgb(255 255 255 / .5);transition:all .3s}.watch-carousel-dots button:hover{background:rgb(255 255 255 / .7)}.watch-carousel-dots button.is-selected{background:#fff;box-shadow:0 10px 15px -3px rgb(255 255 255 / .5),0 4px 6px -4px rgb(255 255 255 / .5);transform:scale(1.1)}
@media(min-width:640px){.watch-carousel-container{max-width:640px}}
@media(min-width:768px){.watch-carousel-card{height:clamp(300px,35vh,500px)}.watch-carousel-container{max-width:768px;padding:0 16px}.watch-carousel-copy{max-width:672px}.watch-carousel-genre-row,.watch-carousel-title,.watch-carousel-subtitle,.watch-carousel-actors{margin-bottom:16px}.watch-carousel-genre{padding:4px 12px;font-size:14px;line-height:20px}.watch-carousel-title{font-size:30px}.watch-carousel-subtitle{font-size:18px;line-height:28px}.watch-carousel-actors,.watch-carousel-description{font-size:14px;line-height:20px}.watch-carousel-description{-webkit-line-clamp:3;margin-bottom:24px}.watch-carousel-arrow{display:flex}.watch-carousel-dots button{width:12px;height:12px}}
@media(min-width:1024px){.watch-carousel-card{height:clamp(300px,40vh,600px)}.watch-carousel-container{max-width:1024px}.watch-carousel-title{font-size:48px}.watch-carousel-subtitle{font-size:20px;line-height:28px}.watch-carousel-description{font-size:16px;line-height:24px}}
@media(min-width:1280px){.watch-carousel-container{max-width:1280px}}@media(min-width:1536px){.watch-carousel-container{max-width:1536px}}
@media(prefers-reduced-motion:reduce){.watch-carousel-image,.watch-carousel-shade,.watch-carousel-dots button{transition:none}}
</style>
