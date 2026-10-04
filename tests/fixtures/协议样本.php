<?php
class Spider {
    private $params = '';
    public function init($params) { $this->params = $params; return []; }
    public function homeContent($filter) { return ['class' => [['type_id' => 'movie', 'type_name' => '电影']]]; }
    public function homeVideoContent() { return ['list' => [$this->item('样本电影')]]; }
    public function categoryContent($tid, $pg, $filter, $extend) { return ['page' => $pg, 'list' => [$this->item("$tid-$pg-$this->params")]]; }
    public function detailContent($ids) { return ['list' => [array_merge($this->item('样本电影'), ['vod_id' => $ids[0], 'vod_play_from' => '测试', 'vod_play_url' => '正片$https://example.invalid/video.mp4'])]]; }
    public function searchContent($key, $quick, $pg) { return ['list' => [$this->item($key)]]; }
    public function playerContent($flag, $id, $flags) { return ['parse' => 0, 'url' => $id]; }
    public function proxy($params) { return [200, 'text/plain', 'hello']; }
    public function action($name, $value) { return ['name' => $name, 'value' => $value]; }
    private function item($name) { return ['vod_id' => 'one', 'vod_name' => $name, 'vod_pic' => '', 'vod_remarks' => '测试']; }
}

