export const engineLabels = {js: 'JS', dr2: 'DR2', cat: 'CatVod', php: 'PHP', py: 'HIPY'};
export const languageLabels = {js: 'JS', py: 'Python', php: 'PHP'};
export const engineLanguage = engine => ({js: 'js', dr2: 'js', cat: 'js', py: 'py', php: 'php'})[engine];
export const engineDescriptions = {
    js: 'JavaScript · drpyS 规则引擎',
    dr2: 'JavaScript · DR2 规则兼容引擎',
    cat: 'JavaScript · CatVod 模块接口',
    php: 'PHP · Spider 类接口',
    py: 'Python · HIPY Spider 接口',
};
