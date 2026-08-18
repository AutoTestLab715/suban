#!/bin/bash
echo "=== refresh main ==="
tail -50 /tmp/manual_refresh_all_20260810_091848.log
echo
echo "=== retry ==="
ls -t /tmp/manual_retry_*.log 2>/dev/null | head -1 | xargs -I{} sh -c 'echo {}; tail -30 {}'
echo
echo "=== procs ==="
ps aux | grep -E 'crawler\.py|fujian_qwjsy_crawler|plap_crawler|gxt_zcfg|kjt_xxgk|easy_prt|crawl_daily|fyc_crawler' | grep -v grep || echo none
echo
echo "=== latest source logs ==="
for f in /opt/fujian-qwjsy/output/daily_zfcg_20260810.log \
         /opt/fujian-qwjsy/output/daily_kjt_20260810.log \
         /opt/fujian-qwjsy/output/daily_plap_20260810.log \
         /opt/fujian-qwjsy/output/daily_easy_prt_20260810.log \
         /opt/fujian-qwjsy/output/daily_fyc_20260810.log \
         /opt/ccgp-portal/output/daily_cron.log \
         /opt/guangdong-portal/output/daily_cron.log; do
  [ -f "$f" ] || continue
  echo "-- $f --"
  tail -8 "$f"
  echo
done

echo "=== DB latest notice_time by table ==="
source /opt/fujian-qwjsy/.env
mysql -N -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" biaoxun <<'SQL'
SELECT 'notices_zfcg', COUNT(*), MAX(notice_time) FROM notices WHERE source='zfcg';
SELECT 'ccgp', COUNT(*), MAX(notice_time) FROM ccgp;
SELECT 'guangdong', COUNT(*), MAX(notice_time) FROM guangdong;
SELECT 'plap', COUNT(*), MAX(publish_time) FROM plap;
SELECT 'easy_prt', COUNT(*), MAX(notice_time) FROM easy_prt;
SELECT 'gxt_zcfg', COUNT(*), MAX(publish_time) FROM gxt_zcfg;
SELECT 'notices_kjt', COUNT(*), MAX(notice_time) FROM notices WHERE source='kjt';
SQL
