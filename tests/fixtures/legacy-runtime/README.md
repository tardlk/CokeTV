# 旧运行副本样本

`php-bridge.txt` 与 `t4-daemon.txt` 原样取自 CokeTV 提交
`ae89c27570537c8931f0747a3c2185880a6b94e3` 的
`engine/spider/php/_bridge.php` 和 `engine/spider/py/core/t4_daemon.py`。
沿用项目 GPL-3.0 许可，仅用于临时数据目录中的升级回归。

旧 PHP 桥接不识别 `localProxy|proxy`；旧 Python 守护进程允许入站
`pickle.loads`。测试将其放入已有运行目录，随后用当前宿主启动，
实际验证 PHP 代理、JSON 入站及无害 pickle 数据包拒绝行为。
这些文件不属于发行框架，不复制到正式运行目录，也不需要网络或 Git 历史。
