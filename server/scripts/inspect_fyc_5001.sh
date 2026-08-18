#!/bin/bash
set -euo pipefail
APP=/opt/fyc-portal

echo "=== 目录结构 ==="
ls -la "$APP" 2>/dev/null | head -25
echo
echo "=== app.py 端口与路由 ==="
grep -n "5001\|route\|@app" "$APP/app.py" 2>/dev/null | head -40

echo
echo "=== 数据文件/库 ==="
find "$APP" -maxdepth 3 \( -name "*.db" -o -name "*.sqlite" -o -name "*.json" -o -name "*.jsonl" -o -name "data" -type d \) 2>/dev/null | head -20
du -xh --max-depth=2 "$APP" 2>/dev/null | sort -hr | head -15

echo
echo "=== API 探测 ==="
for path in / /api /api/notices /notices /health /stats /list; do
  code=$(curl -sS -m 3 -o /tmp/api_body.txt -w "%{http_code}" "http://127.0.0.1:5001$path" 2>/dev/null || echo "err")
  size=$(wc -c < /tmp/api_body.txt 2>/dev/null || echo 0)
  echo "$path -> HTTP $code, ${size} bytes"
done

echo
echo "=== 首页摘要 ==="
curl -sS -m 5 http://127.0.0.1:5001/ 2>/dev/null | head -c 1500; echo

echo
echo "=== MySQL fyc 表 ==="
export MYSQL_PWD=123456
mysql -ubiaoxun biaoxun -N -e "SHOW TABLES LIKE 'fyc%'; SELECT COUNT(*) AS fyc_rows FROM fyc;" 2>/dev/null || echo "biaoxun user no access"

ROOT_PASS=$(/www/server/panel/pyenv/bin/python3 <<'PY'
import sys
sys.path.insert(0, "/www/server/panel/class")
import public
print(public.M("config").where("id=?", (1,)).getField("mysql_root"))
PY
)
export MYSQL_PWD="$ROOT_PASS"
mysql -uroot biaoxun -e "SHOW CREATE TABLE fyc\G" 2>/dev/null | head -30
mysql -uroot biaoxun -e "SELECT COUNT(*) AS total FROM fyc; SELECT region, COUNT(*) c FROM fyc GROUP BY region ORDER BY c DESC LIMIT 10;" 2>/dev/null
