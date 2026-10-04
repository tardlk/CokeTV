class Spider:
    def __init__(self, t4_api=''):
        self.proxy = t4_api
        self.params = ''

    def setExtendInfo(self, params):
        self.params = params
        self.extend = params

    def getDependence(self):
        return []

    def init(self, dependencies):
        return {}

    def homeContent(self, filter):
        return {'class': [{'type_id': 'movie', 'type_name': '电影'}]}

    def homeVideoContent(self):
        return {'list': [self.item('样本电影')]}

    def categoryContent(self, tid, pg, filter, extend):
        return {'page': pg, 'list': [self.item(f'{tid}-{pg}-{self.params}')]}

    def detailContent(self, ids):
        return {'list': [{**self.item('样本电影'), 'vod_id': ids[0], 'vod_play_from': '测试', 'vod_play_url': '正片$https://example.invalid/video.mp4'}]}

    def searchContent(self, key, quick, pg):
        return {'list': [self.item(key)]}

    def playerContent(self, flag, id, flags):
        return {'parse': 0, 'url': id}

    def localProxy(self, params):
        return [200, 'text/plain', 'hello']

    def action(self, name, value):
        return {'name': name, 'value': value}

    def item(self, name):
        return {'vod_id': 'one', 'vod_name': name, 'vod_pic': '', 'vod_remarks': '测试'}
