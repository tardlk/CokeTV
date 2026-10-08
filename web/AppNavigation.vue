<script setup>
import Icon from './Icon.vue';
import {useSidebar} from './components/ui/sidebar';
defineProps({page:String,sources:Number,subscriptions:Number});
const emit=defineEmits(['navigate','watch']);
const {setOpenMobile}=useSidebar();
function navigate(page){emit('navigate',page);setOpenMobile(false);}
</script>
<template>
  <SidebarGroup class="omni-navigation"><SidebarGroupContent><SidebarMenu>
    <SidebarMenuItem><SidebarMenuButton tooltip="网页观影" @click="emit('watch');setOpenMobile(false)"><Icon name="play" /><span>网页观影</span></SidebarMenuButton></SidebarMenuItem>
    <SidebarMenuItem><SidebarMenuButton :is-active="page==='sources'" tooltip="源管理" @click="navigate('sources')"><Icon name="code" /><span>源管理</span></SidebarMenuButton></SidebarMenuItem>
    <SidebarMenuItem><SidebarMenuButton :is-active="page==='subscriptions'" tooltip="订阅管理" @click="navigate('subscriptions')"><Icon name="rss" /><span>订阅管理</span></SidebarMenuButton></SidebarMenuItem>
    <SidebarMenuItem><SidebarMenuButton :is-active="page==='netdisk'" tooltip="网盘管理" @click="navigate('netdisk')"><Icon name="folder" /><span>网盘管理</span></SidebarMenuButton></SidebarMenuItem>
    <SidebarMenuItem><SidebarMenuButton :is-active="page==='settings'" tooltip="设置" @click="navigate('settings')"><Icon name="settings" /><span>设置</span></SidebarMenuButton></SidebarMenuItem>
  </SidebarMenu></SidebarGroupContent></SidebarGroup>
</template>
