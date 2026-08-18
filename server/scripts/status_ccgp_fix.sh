#!/bin/bash
echo "=== fix log ==="
tail -50 /tmp/ccgp_fix_20260810_105338.log
echo "=== procs ==="
ps aux | grep -E 'ccgp-portal.*crawler|backfill_ccgp|fix_ccgp' | grep -v grep || echo none
source /opt/fujian-qwjsy/.env
mysql -N -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" biaoxun <<'SQL'
SELECT 'today', COUNT(*), MAX(notice_time) FROM ccgp WHERE notice_time >= CURDATE();
SELECT notice_type, COUNT(*) c FROM ccgp WHERE notice_time >= CURDATE() GROUP BY notice_type ORDER BY c DESC;
SELECT 'tender_ok', COUNT(*) FROM ccgp WHERE notice_time >= CURDATE() AND notice_type IN ('公开招标','公开招标公告','邀请招标','竞争性磋商','竞争性谈判','询价公告','单一来源','更正公告','资格预审','其他公告');
SELECT 'win_ok', COUNT(*) FROM ccgp WHERE notice_time >= CURDATE() AND notice_type IN ('中标公告','成交公告','终止公告','废标公告');
SELECT LEFT(title,40), notice_type, notice_time FROM ccgp WHERE notice_time >= CURDATE() ORDER BY notice_time DESC LIMIT 8;
SQL
