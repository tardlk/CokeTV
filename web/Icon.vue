<script setup>
import {computed} from 'vue';
import {Layers, Radio, Settings2, Search, Plus, Upload, RefreshCw, ChevronLeft, ChevronRight, ArrowLeft, ArrowUp, ArrowDown, ArrowUpRight, Check, X, Code2, SlidersHorizontal, Play, Copy, Trash2, Link2, GripVertical, FileCode2, ShieldCheck, LogOut, CircleHelp, Monitor, FolderOpen, Save, Braces, Terminal, Eye, EyeOff, KeyRound, CheckCircle2, AlertCircle, Clock3, Circle, Sparkles, Rss, UserRound, Pencil, Package, BookOpen, Ellipsis} from '@lucide/vue';
const props = defineProps({name: String, size: {type:Number, default:18}});
const icons = {rss:Rss,user:UserRound,edit:Pencil,package:Package,book:BookOpen,more:Ellipsis,layers:Layers,radio:Radio,settings:Settings2,search:Search,plus:Plus,upload:Upload,refresh:RefreshCw,left:ChevronLeft,right:ChevronRight,back:ArrowLeft,up:ArrowUp,down:ArrowDown,external:ArrowUpRight,check:Check,x:X,code:Code2,sliders:SlidersHorizontal,play:Play,copy:Copy,trash:Trash2,link:Link2,grip:GripVertical,file:FileCode2,shield:ShieldCheck,logout:LogOut,help:CircleHelp,monitor:Monitor,folder:FolderOpen,save:Save,braces:Braces,terminal:Terminal,eye:Eye,hidden:EyeOff,key:KeyRound,success:CheckCircle2,error:AlertCircle,clock:Clock3,circle:Circle,sparkles:Sparkles, Rss, UserRound, Pencil, Package, BookOpen, Ellipsis};
const component=computed(()=>icons[props.name] || Circle);
</script>
<template><component :is="component" :size="size" :stroke-width="2" aria-hidden="true" class="ui-icon" /></template>
