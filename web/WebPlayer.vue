<script setup>
import {ref, onMounted, onBeforeUnmount, watch} from 'vue';
import Artplayer from 'artplayer';
import Hls from 'hls.js';

const props = defineProps({media: Object, resume: Number, previous: Boolean, next: Boolean});
const emit = defineEmits(['previous', 'next', 'ended', 'progress', 'error']);
const container = ref(null);
let art, transport, probe, generation = 0, lastProgress = 0, activeContext;
function clearTransport() { probe?.abort(); probe = null; transport?.destroy(); transport = null; }
function icon(component) { return component === 'prev' ? '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M5 4h2v16H5zM19 4v16L8 12z"/></svg>' : '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M17 4h2v16h-2zM5 4v16l11-8z"/></svg>'; }
function report(message) { emit('error', message); }
function formatTime(seconds) { const value = Math.max(0, Math.floor(seconds || 0)); return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`; }
function updateTime() { const layer = art?.layers['watch-time']; if (layer) { layer.children[0].textContent = formatTime(art.currentTime); layer.children[1].textContent = formatTime(art.duration); } }
function loadMedia() {
    if (!art) return;
    generation++; clearTransport(); lastProgress = 0;
    activeContext = props.media?.context;
    if (!props.media?.url) { art.pause(); art.video.removeAttribute('src'); art.video.load(); return; }
    art.type = props.media.type || 'auto';
    art.url = props.media.url;
    if (props.media.autoplay) art.play().catch(() => {});
}
onMounted(() => {
    art = new Artplayer({
        container: container.value, url: '', theme: '#34d399', lang: 'zh-cn', volume: .7,
        autoplay: false, autoSize: false, fullscreen: true,
        setting: true, playbackRate: true, aspectRatio: true,
        hotkey: true, mutex: true, miniProgressBar: true, playsInline: true,
        moreVideoAttr: {'aria-label': '视频播放器', playsinline: true},
        controls: [
            {name: 'previous', position: 'left', index: 5, html: icon('prev'), tooltip: '上一集', click: () => { if (props.previous) emit('previous'); }},
            {name: 'next', position: 'left', index: 15, html: icon('next'), tooltip: '下一集', click: () => { if (props.next) emit('next'); }},
        ],
        layers: [
            {name: 'watch-time', html: '<span>00:00</span><span>00:00</span>', style: {position: 'absolute', height: '18px', left: '10px', right: '10px', bottom: '50px', display: 'flex', justifyContent: 'space-between', pointerEvents: 'none'}},
            {name: 'media-info', html: '<button type="button" aria-label="媒体信息" title="媒体信息"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="22" height="22"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7v1"/></svg></button>', style: {position: 'absolute', height: '22px', top: '10px', right: '10px'}, click: () => { art.info.show = !art.info.show; }},
        ],
        customType: {
            auto: detectMedia, m3u8: loadHls,
            flv: loadTransport, ts: loadTransport,
        },
    });
    art.on('video:loadedmetadata', () => { updateTime(); if (props.resume > 0 && props.resume < art.duration - 2) art.currentTime = props.resume; if (props.media?.autoplay) art.play().catch(() => {}); });
    art.on('video:timeupdate', () => {
        updateTime();
        if (Math.abs(art.currentTime - lastProgress) >= 5) { lastProgress = art.currentTime; emit('progress', art.currentTime, art.duration, activeContext); }
    });
    art.on('video:pause', () => emit('progress', art.currentTime, art.duration, activeContext));
    art.on('video:ended', () => emit('ended'));
    art.on('video:error', () => { if (props.media?.url) report('视频无法播放，请重试或切换线路；浏览器可能不支持此视频的编码。'); });
    loadMedia();
});
function loadHls(video, url) {
    clearTransport();
    if (Hls.isSupported()) {
        const hls = new Hls(); transport = hls;
        hls.loadSource(url); hls.attachMedia(video);
        hls.on(Hls.Events.ERROR, (_, data) => { if (data.fatal) { hls.destroy(); report('视频加载失败，请重试或切换线路。'); } });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) video.src = url;
    else report('当前浏览器不支持 HLS 播放，请使用新版 Chrome、Edge 或 Safari。');
}
async function detectMedia(video, url) {
    const version = generation, controller = new AbortController(); probe = controller;
    try {
        const response = await fetch(url, {headers: {Range: 'bytes=0-511'}, signal: controller.signal});
        if (!response.ok) throw new Error('媒体地址返回错误，请重新选择剧集或切换线路。');
        const type = response.headers.get('content-type') || '';
        const reader = response.body?.getReader();
        const bytes = reader ? (await reader.read()).value : new Uint8Array();
        await reader?.cancel();
        if (version !== generation || !art) return;
        probe = null;
        if (/mpegurl/i.test(type) || new TextDecoder().decode(bytes?.subarray(0, 16)).trimStart().startsWith('#EXTM3U')) loadHls(video, url);
        else if (/flv/i.test(type) || (bytes?.[0] === 70 && bytes?.[1] === 76 && bytes?.[2] === 86)) loadTransport(video, url, 'flv');
        else if (/mp2t/i.test(type)) loadTransport(video, url, 'ts');
        else video.src = url;
    } catch (failure) { if (version === generation && failure.name !== 'AbortError') report(failure.message); }
}
async function loadTransport(video, url, detectedType) {
    const version = generation;
    const {default: mpegts} = await import('mpegts.js');
    if (version !== generation || !art) return;
    if (!mpegts.isSupported()) { report('当前浏览器不支持 FLV/TS 播放。'); return; }
    clearTransport();
    const player = mpegts.createPlayer({type: (typeof detectedType === 'string' ? detectedType : props.media.type) === 'ts' ? 'mpegts' : 'flv', url}); transport = player;
    player.attachMediaElement(video); player.load();
    player.on(mpegts.Events.ERROR, () => report('视频加载失败，请重试或切换线路。'));
}
watch(() => props.media, loadMedia);
onBeforeUnmount(() => { generation++; clearTransport(); if (art) { emit('progress', art.currentTime, art.duration, activeContext); art.destroy(false); art = null; } });
</script>
<template><div ref="container" class="watch-player" /></template>
