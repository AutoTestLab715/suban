#!/bin/bash
bash /tmp/status_ccgp_fix.sh
echo "=== newest crawled ==="
source /opt/fujian-qwjsy/.env
mysql -N -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" biaoxun <<'SQL'
SELECT LEFT(title,40), notice_type, notice_time, crawled_at
FROM ccgp ORDER BY crawled_at DESC LIMIT 8;
SELECT 'today_max', MAX(notice_time), COUNT(*) FROM ccgp WHERE notice_time >= CURDATE();
SELECT 'bad_coarse', COUNT(*) FROM ccgp WHERE notice_type IN ('招标公告');
SQL
echo "=== crawl proc ==="
pgrep -af 'crawler.py --daily --lookback 2' || echo crawl_done
ls -t /tmp/ccgp_repipe_*.log | head -1 | xargs tail -20
