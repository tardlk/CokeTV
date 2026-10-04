
export function buildSubscription(state, subscription, baseUrl) {
    const base = baseUrl.replace(/\/$/, '');
    const sites = subscription.instances.flatMap(id => {
        const instance = state.instances.find(s => s.id === id && s.enabled);
        const script = instance && state.scripts.find(s => s.id === instance.scriptId);
        if (!script) return [];
        const api = new URL(`${base}/api/${instance.id}`);
        api.searchParams.set('token', subscription.token);
        return [{key: `lite_${instance.id}`, name: instance.name, type: 4, api: api.href,
            searchable: instance.searchable ? 1 : 0, quickSearch: 0, filterable: instance.filterable ? 1 : 0,
            ext: instance.params || '', engine: script.engine}];
    });
    return {sites, parses: state.settings.parses || [], lives: state.settings.lives || [], flags: []};
}
export function authorizedSubscription(state, supplied, instanceId) {
    return state.subscriptions.find(s => s.enabled && s.token === supplied && (!instanceId || s.instances.includes(instanceId)));
}
