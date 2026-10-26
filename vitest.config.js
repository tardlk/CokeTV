import {defineConfig} from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import path from 'path';
import {fileURLToPath} from 'url';
import {readFileSync} from 'fs';
const root=path.dirname(fileURLToPath(import.meta.url));
const {version}=JSON.parse(readFileSync(path.join(root,'package.json'),'utf8'));
export default defineConfig({plugins:[vue()],resolve:{alias:{'@':path.join(root,'web')}},define:{__APP_VERSION__:JSON.stringify(version)},test:{environment:'jsdom',include:['tests/ui/*.test.js']}});
