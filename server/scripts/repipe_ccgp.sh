#!/bin/bash
set -u
LOG=/tmp/ccgp_repipe_$(date +%Y%m%d_%H%M%S).log
echo "[$(date '+%F %T')] stop old crawl + patch db + backfill + recrawl" | tee "$LOG"

# stop running ccgp crawler
if [ -f /opt/ccgp-portal/crawler.lock ]; then
  PID=$(tr -d '[:space:]' </opt/ccgp-portal/crawler.lock)
  if kill -0 "$PID" 2>/dev/null; then
    echo "stopping pid=$PID" | tee -a "$LOG"
    touch /opt/ccgp-portal/crawler.stop
    kill "$PID" 2>/dev/null || true
    sleep 2
    kill -9 "$PID" 2>/dev/null || true
  fi
fi
rm -f /opt/ccgp-portal/crawler.lock /opt/ccgp-portal/crawler.stop
# also kill flock parent if any
pkill -f '/opt/ccgp-portal/.venv/bin/python crawler.py --daily' 2>/dev/null || true
pkill -f './.venv/bin/python crawler.py --daily --lookback 2' 2>/dev/null || true
sleep 1

python3 /tmp/patch_ccgp_db_api_types.py | tee -a "$LOG"

echo "[$(date '+%F %T')] backfill" | tee -a "$LOG"
/opt/fujian-qwjsy/.venv/bin/python /tmp/backfill_ccgp_notice_type.py --apply >>"$LOG" 2>&1

echo "[$(date '+%F %T')] crawl lookback=2" | tee -a "$LOG"
cd /opt/ccgp-portal
nohup flock -xn /tmp/ccgp_crawl_daily.lock -c './.venv/bin/python crawler.py --daily --lookback 2' >>"$LOG" 2>&1 &
echo "crawl launched pid=$!" | tee -a "$LOG"
sleep 8
pgrep -af 'ccgp-portal|crawler.py --daily --lookback 2' | tee -a "$LOG" || true
source /opt/fujian-qwjsy/.env
mysql -N -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" biaoxun <<'SQL' | tee -a "$LOG"
SELECT 'today', COUNT(*), MAX(notice_time) FROM ccgp WHERE notice_time >= CURDATE();
SELECT notice_type, COUNT(*) c FROM ccgp WHERE notice_time >= CURDATE() GROUP BY notice_type ORDER BY c DESC;
SELECT 'tender_ok', COUNT(*) FROM ccgp WHERE notice_time >= CURDATE() AND notice_type IN ('公开招标','公开招标公告','邀请招标','竞争性磋商','竞争性谈判','询价公告','单一来源','更正公告','资格预审','其他公告');
SELECT 'win_ok', COUNT(*) FROM ccgp WHERE notice_time >= CURDATE() AND notice_type IN ('中标公告','成交公告','终止公告','废标公告');
SELECT 'bad_coarse', COUNT(*) FROM ccgp WHERE notice_time >= CURDATE() AND notice_type IN ('招标公告');
SQL
echo "LOG=$LOG"
