import {readFileSync} from 'node:fs';

// package.json is the single runtime source of truth; the Dockerfile ships it
// beside src/, and the frontend receives the same value through Vite define.
export const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
