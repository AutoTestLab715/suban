#!/bin/bash
set -u
STAMP="$(date '+%Y%m%d_%H%M%S')"
LOG="/tmp/manual_refresh_all_${STAMP}.log"
echo "[$(date '+%F %T')] manual refresh all sources start" | tee "$LOG"

run() {
  local name="$1"
  local cmd="$2"
  local lock="$3"
  echo "[$(date '+%F %T')] >>> start $name" | tee -a "$LOG"
  if flock -xn "$lock" -c "$cmd" >>"$LOG" 2>&1; then
    echo "[$(date '+%F %T')] <<< $name OK" | tee -a "$LOG"
  else
    local code=$?
    if [ "$code" -eq 1 ]; then
      echo "[$(date '+%F %T')] <<< $name SKIPPED (already running)" | tee -a "$LOG"
    else
      echo "[$(date '+%F %T')] <<< $name FAIL exit=$code" | tee -a "$LOG"
    fi
  fi
}

# Parallel groups that don't share resources heavily
(
  run zfcg '/opt/fujian-qwjsy/crawl_daily.sh zfcg' /tmp/fujian_crawl_zfcg.lock
) &
(
  run gxt '/opt/fujian-qwjsy/crawl_daily.sh gxt' /tmp/fujian_crawl_gxt.lock
) &
(
  run kjt '/opt/fujian-qwjsy/crawl_daily.sh kjt' /tmp/fujian_crawl_kjt.lock
) &
(
  run ccgp '/opt/ccgp-portal/crawl_daily.sh' /tmp/ccgp_crawl_daily.lock
) &
(
  run guangdong '/opt/guangdong-portal/crawl_daily.sh' /tmp/guangdong_crawl_daily.lock
) &
wait

(
  run plap '/opt/fujian-qwjsy/crawl_daily.sh plap' /tmp/fujian_crawl_plap.lock
) &
(
  run easy_prt '/opt/fujian-qwjsy/crawl_daily.sh easy_prt' /tmp/fujian_crawl_easy_prt.lock
) &
(
  run fyc '/opt/fujian-qwjsy/crawl_daily.sh fyc' /tmp/fujian_crawl_fyc.lock
) &
wait

echo "[$(date '+%F %T')] manual refresh all sources done" | tee -a "$LOG"
echo "LOG=$LOG"
