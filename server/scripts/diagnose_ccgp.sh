#!/bin/bash
set -u
source /opt/fujian-qwjsy/.env
echo "=== DB ccgp ==="
mysql -N -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" biaoxun <<'SQL'
SELECT COUNT(*), MAX(notice_time), MAX(crawled_at), MAX(updated_at) FROM ccgp;
SELECT DATE(notice_time) d, COUNT(*) c FROM ccgp WHERE notice_time >= DATE_SUB(NOW(), INTERVAL 7 DAY) GROUP BY DATE(notice_time) ORDER BY d DESC;
SELECT id, LEFT(title,50), notice_time, crawled_at FROM ccgp ORDER BY notice_time DESC LIMIT 8;
SQL

echo "=== lock / procs ==="
ls -la /opt/ccgp-portal/crawler.lock /tmp/ccgp_crawl_daily.lock 2>/dev/null || true
if [ -f /opt/ccgp-portal/crawler.lock ]; then
  PID=$(tr -d '[:space:]' </opt/ccgp-portal/crawler.lock)
  echo "crawler.lock pid=$PID"
  ps -fp "$PID" 2>/dev/null || echo "pid dead"
fi
ps aux | grep -E 'ccgp-portal.*crawler|crawl_daily' | grep -v grep || echo 'no crawl proc'

echo "=== cron log tail ==="
tail -40 /opt/ccgp-portal/output/daily_cron.log 2>/dev/null

echo "=== crawl_daily.sh ==="
cat /opt/ccgp-portal/crawl_daily.sh

echo "=== recent output files ==="
ls -lt /opt/ccgp-portal/output/ | head -15
