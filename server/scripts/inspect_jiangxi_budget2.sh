#!/bin/bash
set -euo pipefail
source /opt/fujian-qwjsy/.env
MYSQL=(mysql -N -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" biaoxun)

echo "=== budget samples ==="
"${MYSQL[@]}" -e "SELECT budget, successful_money, LEFT(title,50) FROM jiangxi WHERE budget<>'' ORDER BY notice_time DESC LIMIT 15;"

echo "=== counts ==="
"${MYSQL[@]}" -e "SELECT 'budget_has_dot', COUNT(*) FROM jiangxi WHERE budget LIKE '%.%';"
"${MYSQL[@]}" -e "SELECT 'budget_int_only', COUNT(*) FROM jiangxi WHERE budget REGEXP '^[0-9]+$';"
"${MYSQL[@]}" -e "SELECT 'budget_nonempty', COUNT(*) FROM jiangxi WHERE budget<>'';"
"${MYSQL[@]}" -e "SELECT 'sm_nonempty', COUNT(*) FROM jiangxi WHERE successful_money<>'';"

echo "=== successful_money samples ==="
"${MYSQL[@]}" -e "SELECT budget, successful_money, LEFT(title,50) FROM jiangxi WHERE successful_money<>'' ORDER BY notice_time DESC LIMIT 10;"

echo "=== content with 预算 ==="
"${MYSQL[@]}" -e "SELECT budget, LEFT(content_text,200) FROM jiangxi WHERE content_text LIKE '%预算%' AND budget<>'' LIMIT 5;"

echo "=== crawler budget refs ==="
grep -nE 'budget|successful|万元|金额' /opt/jiangxi-portal/crawler.py | head -80

echo "=== ls portal ==="
ls /opt/jiangxi-portal/
