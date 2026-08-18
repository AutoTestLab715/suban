#!/bin/bash
set -u
echo "=== db upsert ==="
grep -n 'notice_type\|upsert\|INSERT' /opt/ccgp-portal/db.py | head -40
echo "=== other notice_type writes in crawler ==="
grep -n 'notice_type' /opt/ccgp-portal/crawler.py
echo "=== recent status ==="
python3 - <<'PY'
import json
from pathlib import Path
p=Path('/opt/ccgp-portal/status.json')
print(p.read_text(encoding='utf-8')[:2000] if p.exists() else 'no status')
PY
echo "=== sample just inserted ==="
source /opt/fujian-qwjsy/.env
mysql -N -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" biaoxun <<'SQL'
SELECT id, notice_type, notice_name, purchase_manner, channel, crawled_at
FROM ccgp WHERE crawled_at >= '2026-08-10 10:54:00' ORDER BY crawled_at DESC LIMIT 5;
SQL
# Check if running process has old code in memory - inspect open file
PID=$(cat /opt/ccgp-portal/crawler.lock 2>/dev/null || true)
echo "PID=$PID"
if [ -n "$PID" ]; then
  ls -l /proc/$PID/cwd /proc/$PID/exe 2>/dev/null
  # Does the process still have the function? Hard to check. Kill and restart after verifying disk.
fi
