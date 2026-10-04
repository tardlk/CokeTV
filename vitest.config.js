import {defineConfig} from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import path from 'path';
import {fileURLToPath} from 'url';
const root=path.dirname(fileURLToPath(import.meta.url));
export default defineConfig({plugins:[vue()],resolve:{alias:{'@':path.join(root,'web')}},test:{environment:'jsdom',include:['tests/ui/*.test.js']}});
