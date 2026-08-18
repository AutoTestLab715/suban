#!/bin/bash
set -euo pipefail
ROOT_PASS=$(/www/server/panel/pyenv/bin/python3 <<'PY'
import sys
sys.path.insert(0, "/www/server/panel/class")
import public
print(public.M("config").where("id=?", (1,)).getField("mysql_root"))
PY
)
export MYSQL_PWD="$ROOT_PASS"

echo "=== fyc 表结构 ==="
mysql -uroot biaoxun -e "DESCRIBE fyc;" 2>/dev/null

echo
echo "=== fyc 数据统计 ==="
mysql -uroot biaoxun -N -e "
SELECT COUNT(*) AS total FROM fyc;
SELECT MIN(publish_time), MAX(publish_time) FROM fyc;
SELECT notice_type, COUNT(*) c FROM fyc GROUP BY notice_type ORDER BY c DESC LIMIT 10;
SELECT region, COUNT(*) c FROM fyc GROUP BY region ORDER BY c DESC LIMIT 10;
" 2>/dev/null

echo
echo "=== 最新 5 条 ==="
mysql -uroot biaoxun -e "SELECT id, LEFT(title,60) title, publish_time, region, notice_type FROM fyc ORDER BY publish_time DESC LIMIT 5;" 2>/dev/null

echo
echo "=== /api/notices 样本 ==="
curl -sS -m 5 "http://127.0.0.1:5001/api/notices?page=1&page_size=3" 2>/dev/null | python3 -m json.tool 2>/dev/null | head -80

echo
echo "=== /api/crawl/status ==="
curl -sS -m 5 http://127.0.0.1:5001/api/crawl/status 2>/dev/null | python3 -m json.tool 2>/dev/null | head -40

echo
echo "=== /health ==="
curl -sS http://127.0.0.1:5001/health 2>/dev/null; echo

echo
echo "=== .env (脱敏) ==="
grep -v PASSWORD /opt/fyc-portal/.env 2>/dev/null || true
