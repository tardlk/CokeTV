import {defineConfig} from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import {fileURLToPath} from 'url';
const root = path.dirname(fileURLToPath(import.meta.url));
export default defineConfig({root: path.join(root, 'web'), plugins: [vue(),tailwindcss()], resolve:{alias:{'@':path.join(root,'web')}}, build: {outDir: path.join(root, 'dist'), emptyOutDir: true}});
