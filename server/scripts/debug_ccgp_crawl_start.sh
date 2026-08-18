#!/bin/bash
echo "=== fix log end ==="
tail -80 /tmp/ccgp_fix_20260810_105338.log
echo "=== procs ==="
ps aux | grep -E 'ccgp|fix_ccgp|backfill' | grep -v grep || echo none
echo "=== locks ==="
ls -la /opt/ccgp-portal/crawler.lock /tmp/ccgp_crawl_daily.lock 2>/dev/null
cat /opt/ccgp-portal/crawler.lock 2>/dev/null; echo
echo "=== today bad rows ==="
source /opt/fujian-qwjsy/.env
mysql -N -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" biaoxun <<'SQL'
SELECT notice_type, notice_name, notice_time, crawled_at, LEFT(title,36)
FROM ccgp
WHERE notice_time >= CURDATE() AND notice_type IN ('招标公告','中标公告')
ORDER BY notice_time DESC LIMIT 20;
SELECT 'crawled_after_1054', COUNT(*) FROM ccgp WHERE crawled_at >= '2026-08-10 10:54:00';
SQL
echo "=== patch present? ==="
grep -n '_normalize_ccgp_notice_type' /opt/ccgp-portal/crawler.py | head
