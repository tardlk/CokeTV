import {defineConfig} from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import {fileURLToPath} from 'url';
import {readFileSync} from 'fs';
const root = path.dirname(fileURLToPath(import.meta.url));
const {version} = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
export default defineConfig({root: path.join(root, 'web'), plugins: [vue(),tailwindcss()], resolve:{alias:{'@':path.join(root,'web')}}, define: {__APP_VERSION__: JSON.stringify(version)}, build: {outDir: path.join(root, 'dist'), emptyOutDir: true}});
