#!/usr/bin/env bash
# Run one source per cron invocation. Calling without an argument keeps the old all-source behavior.
set -u

SOURCE="${1:-all}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PYTHON="${PYTHON:-$ROOT/.venv/bin/python}"
LOG_DIR="$ROOT/output"
LOOKBACK="${CRAWL_LOOKBACK_DAYS:-}"
KJT_PAGES="${KJT_DAILY_PAGES:-5}"
GXT_PAGES="${GXT_DAILY_PAGES:-5}"
PLAP_PAGES="${PLAP_DAILY_PAGES:-5}"
if [ -z "$LOOKBACK" ] && [ -f "$ROOT/schedule.json" ]; then
  LOOKBACK="$($PYTHON -c "import json;print(json.load(open('$ROOT/schedule.json')).get('lookback_days',3))")"
fi
LOOKBACK="${LOOKBACK:-3}"
STAMP="$(date '+%Y%m%d')"
START="$(date -d "$LOOKBACK days ago" '+%F 00:00:00')"
END="$(date '+%F 23:59:59')"

mkdir -p "$LOG_DIR"
SUMMARY="$LOG_DIR/daily_$STAMP.log"
echo "[$(date '+%F %T')] daily start source=$SOURCE lookback=${LOOKBACK}d ${START} .. ${END}" | tee -a "$SUMMARY"

run_one() {
  local name="$1"
  shift
  local log="$LOG_DIR/daily_${name}_$STAMP.log"
  echo "[$(date '+%F %T')] start $name -> $log" | tee -a "$SUMMARY"
  "$PYTHON" "$@" >>"$log" 2>&1
  local code=$?
  echo "[$(date '+%F %T')] $name exit=$code" | tee -a "$SUMMARY"
  return "$code"
}

run_source() {
  case "$1" in
    kjt)
      run_one kjt "$ROOT/kjt_xxgk_crawler.py" --pages "$KJT_PAGES" --limit 0 --prepage 50 \
        --workers "${KJT_WORKERS:-2}" --delay-lo "${KJT_DELAY_LO:-4}" --delay-hi "${KJT_DELAY_HI:-8}"
      ;;
    gxt)
      run_one gxt "$ROOT/gxt_zcfg_crawler.py" --pages "$GXT_PAGES" --limit 0 \
        --workers "${GXT_WORKERS:-2}" --delay-lo "${GXT_DELAY_LO:-3}" --delay-hi "${GXT_DELAY_HI:-8}"
      ;;
    plap)
      run_one plap "$ROOT/plap_crawler.py" --pages "$PLAP_PAGES" --limit 0 --prepage 20 \
        --delay-lo "${PLAP_DELAY_LO:-2}" --delay-hi "${PLAP_DELAY_HI:-5}"
      ;;
    zfcg)
      run_one zfcg "$ROOT/fujian_qwjsy_crawler.py" --unsafe-list --pages 0 --limit 0 \
        --start "$START" --end "$END" --workers "${ZFCG_WORKERS:-3}" --delay "${ZFCG_DELAY:-2}" \
        --list-delay "${ZFCG_LIST_DELAY:-4}" --rest-every 50 --rest-seconds 60 \
        --block-pause 900 --retries 3
      ;;
    railway)
      run_one railway "$ROOT/china_railway_crawler.py" --scheduled
      ;;
    cnnc)
      run_one cnnc "$ROOT/cnnc_crawler.py" --sleep 2
      ;;
    *)
      return 64
      ;;
  esac
}

if [ "$SOURCE" != "all" ]; then
  run_source "$SOURCE"
  code=$?
  echo "[$(date '+%F %T')] daily done source=$SOURCE code=$code" | tee -a "$SUMMARY"
  exit "$code"
fi

# Manual no-argument invocation retains the previous parallel behavior.
run_source kjt & KJT_PID=$!
run_source gxt & GXT_PID=$!
run_source plap & PLAP_PID=$!
run_source zfcg & ZFCG_PID=$!
run_source cnnc & CNNC_PID=$!
wait "$KJT_PID"; KJT_CODE=$?
wait "$GXT_PID"; GXT_CODE=$?
wait "$PLAP_PID"; PLAP_CODE=$?
wait "$ZFCG_PID"; ZFCG_CODE=$?
wait "$CNNC_PID"; CNNC_CODE=$?
echo "[$(date '+%F %T')] daily done kjt=$KJT_CODE gxt=$GXT_CODE plap=$PLAP_CODE zfcg=$ZFCG_CODE cnnc=$CNNC_CODE" | tee -a "$SUMMARY"
exit 0
