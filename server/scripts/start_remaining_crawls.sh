#!/bin/bash
set -u
LOG=/tmp/manual_remaining_$(date +%Y%m%d_%H%M%S).log
echo "[$(date '+%F %T')] start remaining sources" | tee "$LOG"

start_one() {
  local name="$1"
  local cmd="$2"
  local lock="$3"
  if fuser "$lock" >/dev/null 2>&1; then
    echo "[$(date '+%F %T')] $name already locked/running" | tee -a "$LOG"
    return
  fi
  (
    echo "[$(date '+%F %T')] >>> $name" | tee -a "$LOG"
    flock -xn "$lock" -c "$cmd"
    echo "[$(date '+%F %T')] <<< $name exit=$?" | tee -a "$LOG"
  ) >>"$LOG" 2>&1 &
  echo "[$(date '+%F %T')] launched $name pid=$!" | tee -a "$LOG"
}

start_one plap '/opt/fujian-qwjsy/crawl_daily.sh plap' /tmp/fujian_crawl_plap.lock
start_one easy_prt '/opt/fujian-qwjsy/crawl_daily.sh easy_prt' /tmp/fujian_crawl_easy_prt.lock
start_one fyc '/opt/fujian-qwjsy/crawl_daily.sh fyc' /tmp/fujian_crawl_fyc.lock

sleep 2
ps aux | grep -E 'plap_crawler|easy_prt|fyc_crawler|crawl_daily.sh (plap|easy_prt|fyc)' | grep -v grep | head -20
echo "LOG=$LOG"
