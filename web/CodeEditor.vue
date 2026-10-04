<script setup>
import {ref,onMounted,onBeforeUnmount,watch} from 'vue';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
import 'monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/python/python.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/php/php.contribution.js';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker.js?worker';
const props=defineProps({modelValue:String,engine:String});
const emit=defineEmits(['update:modelValue','save']);
const container=ref(null);let editor,model,change;
self.MonacoEnvironment={getWorker:()=>new EditorWorker()};
onMounted(()=>{
  model=monaco.editor.createModel(props.modelValue||'',props.engine==='py'?'python':props.engine==='php'?'php':'javascript');
  editor=monaco.editor.create(container.value,{model,theme:'vs',automaticLayout:true,fontSize:14,fontFamily:'Menlo, Monaco, monospace',lineHeight:21,wordWrap:'on',minimap:{enabled:true},scrollBeyondLastLine:false,padding:{top:0,bottom:12},ariaLabel:'源脚本代码',tabSize:4});
  change=editor.onDidChangeModelContent(()=>emit('update:modelValue',editor.getValue()));
  editor.addCommand(monaco.KeyMod.CtrlCmd|monaco.KeyCode.KeyS,()=>emit('save'));
});
watch(()=>props.modelValue,value=>{if(model&&value!==model.getValue())model.setValue(value||'');});
onBeforeUnmount(()=>{change?.dispose();editor?.dispose();model?.dispose();});
</script>
<template><div ref="container" class="code-editor"></div></template>
