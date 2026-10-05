export function sourceTemplate(language, name) {
    if (language === 'js') return `// 在这里编写 drpyS 规则，或粘贴源代码。
var rule = {
    title: ${JSON.stringify(name)},
    host: '',
    searchable: 0,
    filterable: 0,
};
`;
    if (language === 'py') return `# 在这里编写 HIPY Spider，或粘贴源代码。
class Spider:
    def __init__(self, t4_api=""):
        self.proxy = t4_api
        self.extend = ""

    def setExtendInfo(self, extend):
        self.extend = extend

    def getName(self):
        return ${JSON.stringify(name)}

    def init(self, extend=""):
        pass

    def getDependence(self):
        return []

    def homeContent(self, filter):
        return {"class": []}

    def homeVideoContent(self):
        return {"list": []}
`;
    if (language === 'php') return `<?php
// 在这里编写 PHP Spider，或粘贴源代码。
class Spider {
    public function init($extend = '') {}
    public function homeContent($filter) { return ['class' => []]; }
    public function homeVideoContent() { return ['list' => []]; }
}
`;
    throw Object.assign(new Error('请选择 JS、Python 或 PHP'), {statusCode: 400});
}
