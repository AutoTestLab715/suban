#!/bin/bash
set -u
echo "=== ccgp lock ==="
if [ -f /opt/ccgp-portal/crawler.lock ]; then
  PID=$(cat /opt/ccgp-portal/crawler.lock | tr -d '[:space:]')
  echo "lock pid=$PID"
  if kill -0 "$PID" 2>/dev/null; then
    echo "ALIVE"
    ps -fp "$PID" || true
  else
    echo "DEAD -> clear"
    rm -f /opt/ccgp-portal/crawler.lock
  fi
else
  echo "no crawler.lock"
fi

echo "=== guangdong lock ==="
if [ -f /opt/guangdong-portal/crawler.lock ]; then
  PID=$(cat /opt/guangdong-portal/crawler.lock | tr -d '[:space:]')
  echo "lock pid=$PID"
  if kill -0 "$PID" 2>/dev/null; then
    echo "ALIVE"
  else
    echo "DEAD -> clear"
    rm -f /opt/guangdong-portal/crawler.lock
  fi
fi

echo "=== start ccgp if free ==="
if [ ! -f /opt/ccgp-portal/crawler.lock ] || ! kill -0 "$(cat /opt/ccgp-portal/crawler.lock 2>/dev/null)" 2>/dev/null; then
  rm -f /opt/ccgp-portal/crawler.lock
  nohup flock -xn /tmp/ccgp_crawl_daily.lock -c '/opt/ccgp-portal/crawl_daily.sh' >> /opt/ccgp-portal/output/daily_cron.log 2>&1 &
  echo "ccgp started pid=$!"
else
  echo "ccgp still held"
fi

echo "=== refresh log ==="
tail -40 /tmp/manual_refresh_all_20260810_091848.log

echo "=== source logs ==="
for f in /opt/fujian-qwjsy/output/daily_zfcg_20260810.log \
         /opt/fujian-qwjsy/output/daily_gxt_20260810.log \
         /opt/fujian-qwjsy/output/daily_kjt_20260810.log \
         /opt/fujian-qwjsy/output/daily_plap_20260810.log \
         /opt/fujian-qwjsy/output/daily_easy_prt_20260810.log \
         /opt/fujian-qwjsy/output/daily_fyc_20260810.log \
         /opt/guangdong-portal/output/daily_cron.log \
         /opt/ccgp-portal/output/daily_cron.log; do
  if [ -f "$f" ]; then
    echo "-- $f --"
    tail -6 "$f"
  fi
done

echo "=== procs ==="
ps aux | grep -E 'crawler\.py|fujian_qwjsy_crawler|plap_crawler|gxt_zcfg|kjt_xxgk|easy_prt|crawl_daily' | grep -v grep | head -40
