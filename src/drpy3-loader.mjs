// Native ESM graph: drpy3 alias, per-instance module state and ?bytes assets.
import {readFile} from 'node:fs/promises';
let runtimeUrl, sourceUrl;
export function initialize(data) { ({runtimeUrl, sourceUrl} = data); }
export async function resolve(specifier, context, nextResolve) {
    const parent = context.parentURL && new URL(context.parentURL);
    const namespace = parent?.searchParams.get('coketvDr3');
    if (namespace && specifier === 'drpy3') return {url: runtimeUrl, shortCircuit: true};
    const result = await nextResolve(specifier, context);
    if (namespace && result.url.startsWith(sourceUrl)) {
        const url = new URL(result.url);
        url.searchParams.set('coketvDr3', namespace);
        return {...result, url: url.href};
    }
    return result;
}
export async function load(url, context, nextLoad) {
    const parsed = new URL(url);
    if (url.startsWith(sourceUrl) && parsed.searchParams.has('coketvDr3') && parsed.searchParams.has('bytes')) {
        const bytes = await readFile(parsed);
        return {format: 'module', source: `export default new Uint8Array(${JSON.stringify([...bytes])});`, shortCircuit: true};
    }
    return nextLoad(url, context);
}
