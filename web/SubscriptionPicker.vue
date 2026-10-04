<script setup>
import {ref,computed} from 'vue';
import Icon from './Icon.vue';
import {languageLabels, engineLanguage} from './engine-labels.js';
const props=defineProps({sources:Array,modelValue:Array});
const emit=defineEmits(['update:modelValue']);
const search=ref(''),engine=ref('all'),dragged=ref(null);
const available=computed(()=>props.sources.filter(source=>!props.modelValue.includes(source.id) &&
    (engine.value==='all'||engineLanguage(source.script?.engine)===engine.value) && `${source.name} ${source.script?.file} ${languageLabels[engineLanguage(source.script?.engine)] || ''}`.toLowerCase().includes(search.value.toLowerCase())));
const chosen=computed(()=>props.modelValue.map(id=>props.sources.find(source=>source.id===id)).filter(Boolean));
const engines=computed(()=>Object.keys(languageLabels).filter(key=>props.sources.some(source=>engineLanguage(source.script?.engine)===key)));
const set=value=>emit('update:modelValue',value);
const add=id=>set([...props.modelValue,id]);
const remove=id=>set(props.modelValue.filter(value=>value!==id));
function move(id,offset){const ids=[...props.modelValue],index=ids.indexOf(id),next=index+offset;if(next<0||next>=ids.length)return;[ids[index],ids[next]]=[ids[next],ids[index]];set(ids);}
function drop(id){if(!dragged.value||dragged.value===id)return;const ids=props.modelValue.filter(value=>value!==dragged.value);ids.splice(ids.indexOf(id),0,dragged.value);set(ids);dragged.value=null;}
</script>
<template>
  <div class="omni-picker"><span class="picker-label">选择源</span><div class="picker-frame">
    <InputGroup><InputGroupInput v-model="search" aria-label="筛选待选源" placeholder="搜索名称 / 类型" /><InputGroupAddon><Icon name="search" :size="16" /></InputGroupAddon></InputGroup>
    <div class="picker-types"><Button v-for="key in engines" :key="key" :variant="engine===key?'default':'secondary'" size="xs" type="button" :aria-pressed="engine===key" @click="engine=engine===key?'all':key">{{languageLabels[key]}}</Button></div>
    <p class="picker-count">待选 {{available.length}} / 已选 {{chosen.length}}</p>
    <div class="subscription-picker">
      <section class="pick-available"><header class="picker-title"><span>待选列表</span><Button variant="ghost" size="xs" type="button" :disabled="!available.length" @click="set([...modelValue,...available.map(s=>s.id)])">添加全部</Button></header>
        <div class="pick-list"><div v-for="source in available" :key="source.id" class="pick-source"><Checkbox :model-value="false" :aria-label="'添加'+source.name" @update:model-value="add(source.id)" /><span class="grow">{{source.name}}</span><Badge variant="secondary">{{languageLabels[engineLanguage(source.script?.engine)]}}</Badge></div><div v-if="!available.length" class="pick-empty">没有待选源</div></div>
      </section>
      <section class="pick-chosen"><header class="picker-title"><span>已选列表（拖拽可排序）</span><Button variant="ghost" size="xs" type="button" :disabled="!chosen.length" @click="set([])">清空</Button></header>
        <div class="chosen-list"><div v-for="(source,index) in chosen" :key="source.id" class="chosen-source" draggable="true" :class="{dragging:dragged===source.id}" @dragstart="dragged=source.id" @dragend="dragged=null" @dragover.prevent @drop.prevent="drop(source.id)"><Checkbox :model-value="true" :aria-label="'移除'+source.name" @update:model-value="remove(source.id)" /><Icon name="grip" :size="14" class="drag-handle" /><span class="grow">{{source.name}}</span><Badge variant="secondary">{{languageLabels[engineLanguage(source.script?.engine)]}}</Badge><div class="reorder-actions"><Button variant="ghost" size="icon-xs" type="button" :aria-label="'上移'+source.name" :disabled="index===0" @click="move(source.id,-1)"><Icon name="up" :size="12" /></Button><Button variant="ghost" size="icon-xs" type="button" :aria-label="'下移'+source.name" :disabled="index===chosen.length-1" @click="move(source.id,1)"><Icon name="down" :size="12" /></Button></div></div><div v-if="!chosen.length" class="pick-empty">从左侧选择源</div></div>
      </section>
    </div>
  </div></div>
</template>
