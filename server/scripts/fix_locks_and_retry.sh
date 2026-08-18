#!/bin/bash
set -u
LOG=/tmp/manual_retry_$(date +%Y%m%d_%H%M%S).log
echo "[$(date '+%F %T')] fix locks + retry" | tee "$LOG"

# CCGP: crawler.lock 被 app.py PID 误占，清掉后重跑
if [ -f /opt/ccgp-portal/crawler.lock ]; then
  PID=$(tr -d '[:space:]' </opt/ccgp-portal/crawler.lock)
  CMD=$(ps -o cmd= -p "$PID" 2>/dev/null || true)
  echo "ccgp lock pid=$PID cmd=$CMD" | tee -a "$LOG"
  if echo "$CMD" | grep -q 'app.py'; then
    echo "clear false ccgp lock held by app.py" | tee -a "$LOG"
    rm -f /opt/ccgp-portal/crawler.lock
  elif ! kill -0 "$PID" 2>/dev/null; then
    echo "clear dead ccgp lock" | tee -a "$LOG"
    rm -f /opt/ccgp-portal/crawler.lock
  fi
fi

# 重试 kjt / ccgp（zfcg 仍在跑则不管）
(
  echo "[$(date '+%F %T')] retry kjt" | tee -a "$LOG"
  flock -xn /tmp/fujian_crawl_kjt.lock -c '/opt/fujian-qwjsy/crawl_daily.sh kjt'
  echo "[$(date '+%F %T')] kjt exit=$?" | tee -a "$LOG"
) >>"$LOG" 2>&1 &

(
  echo "[$(date '+%F %T')] retry ccgp" | tee -a "$LOG"
  flock -xn /tmp/ccgp_crawl_daily.lock -c '/opt/ccgp-portal/crawl_daily.sh'
  echo "[$(date '+%F %T')] ccgp exit=$?" | tee -a "$LOG"
) >>"$LOG" 2>&1 &

echo "LOG=$LOG"
sleep 3
tail -20 "$LOG"
ps aux | grep -E 'kjt_xxgk|ccgp-portal.*crawler|fujian_qwjsy_crawler' | grep -v grep | head -20
