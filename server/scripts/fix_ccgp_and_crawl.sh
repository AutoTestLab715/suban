#!/bin/bash
set -u
LOG=/tmp/ccgp_fix_$(date +%Y%m%d_%H%M%S).log
echo "[$(date '+%F %T')] fix ccgp types + crawl" | tee "$LOG"

# 清误锁
rm -f /opt/ccgp-portal/crawler.lock /opt/ccgp-portal/crawler.stop
# 若 status.json 卡住 running，尽量清掉
python3 - <<'PY' 2>/dev/null || true
import json
from pathlib import Path
p = Path('/opt/ccgp-portal/status.json')
if p.exists() and p.stat().st_size:
    try:
        d = json.loads(p.read_text(encoding='utf-8') or '{}')
    except Exception:
        d = {}
    if d.get('running'):
        d['running'] = False
        d['message'] = 'cleared stale running'
        p.write_text(json.dumps(d, ensure_ascii=False, indent=2), encoding='utf-8')
        print('cleared status running')
PY

# 先回填已有错误类型
if [ -f /tmp/backfill_ccgp_notice_type.py ]; then
  /opt/fujian-qwjsy/.venv/bin/python /tmp/backfill_ccgp_notice_type.py --apply >>"$LOG" 2>&1
else
  echo "backfill script missing" | tee -a "$LOG"
fi

# 再抓近 2 天增量（含今日）
echo "[$(date '+%F %T')] start crawl lookback=2" | tee -a "$LOG"
cd /opt/ccgp-portal
flock -xn /tmp/ccgp_crawl_daily.lock -c './.venv/bin/python crawler.py --daily --lookback 2' >>"$LOG" 2>&1
CODE=$?
echo "[$(date '+%F %T')] crawl exit=$CODE" | tee -a "$LOG"

# 抓完再回填一次，避免 crawler 又写成「招标公告/中标公告」
if [ -f /tmp/backfill_ccgp_notice_type.py ]; then
  /opt/fujian-qwjsy/.venv/bin/python /tmp/backfill_ccgp_notice_type.py --apply >>"$LOG" 2>&1
fi

source /opt/fujian-qwjsy/.env
mysql -N -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" biaoxun -e "
SELECT 'total', COUNT(*), MAX(notice_time) FROM ccgp;
SELECT 'today', COUNT(*) FROM ccgp WHERE notice_time >= CURDATE();
SELECT 'today_tender_ok', COUNT(*) FROM ccgp WHERE notice_time >= CURDATE() AND notice_type IN ('公开招标','公开招标公告','邀请招标','竞争性磋商','竞争性谈判','询价公告','单一来源','更正公告','资格预审','其他公告');
SELECT 'today_win_ok', COUNT(*) FROM ccgp WHERE notice_time >= CURDATE() AND notice_type IN ('中标公告','成交公告','终止公告','废标公告');
SELECT notice_type, COUNT(*) c FROM ccgp WHERE notice_time >= CURDATE() GROUP BY notice_type ORDER BY c DESC LIMIT 15;
" | tee -a "$LOG"

echo "LOG=$LOG"
