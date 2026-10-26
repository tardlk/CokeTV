export function sourceTemplate(language, name) {
    if (language === 'dr3') return `// drpy3：在 rule 中填写规则，按需添加 async 钩子。
export default {
    meta: {title: ${JSON.stringify(name)}, lang: 'dr3'},
    rule: {host: '', searchable: 0, filterable: 0},
};
`;
    throw Object.assign(new Error('只支持 drpy3 源'), {statusCode: 400});
}
