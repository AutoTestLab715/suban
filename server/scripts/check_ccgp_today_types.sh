#!/bin/bash
set -u
source /opt/fujian-qwjsy/.env
echo "=== today notice_type ==="
mysql -N -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" biaoxun -e "
SELECT notice_type, COUNT(*) c FROM ccgp WHERE notice_time >= '2026-08-10 00:00:00' GROUP BY notice_type ORDER BY c DESC;
SELECT 'api_tender', COUNT(*) FROM ccgp WHERE notice_time >= '2026-08-10' AND notice_type IN ('公开招标','公开招标公告','邀请招标','竞争性磋商','竞争性谈判','询价公告','单一来源','更正公告','资格预审','其他公告');
SELECT 'api_win', COUNT(*) FROM ccgp WHERE notice_time >= '2026-08-10' AND notice_type IN ('中标公告','成交公告','终止公告','废标公告');
SELECT 'tab_bad', COUNT(*) FROM ccgp WHERE notice_time >= '2026-08-10' AND notice_type IN ('招标公告','中标公告');
"
