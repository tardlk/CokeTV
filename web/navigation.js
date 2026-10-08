const positionKey = 'coketv-position';
export const routePosition = () => Number.isSafeInteger(history.state?.[positionKey]) ? history.state[positionKey] : null;
export const routeURL = () => location.pathname + location.search + location.hash;
export function initializeNavigation() {
    if (routePosition() === null) history.replaceState({...history.state, [positionKey]: 0}, '', routeURL());
}
export function pushRoute(url) {
    initializeNavigation();
    history.pushState({...history.state, [positionKey]: routePosition() + 1}, '', url);
}
export function replaceRoute(url) { history.replaceState(history.state, '', url); }
