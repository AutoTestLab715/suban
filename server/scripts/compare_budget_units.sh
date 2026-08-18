#!/bin/bash
set -euo pipefail
source /opt/fujian-qwjsy/.env
MYSQL="mysql -N -u${MYSQL_USER} -p${MYSQL_PASSWORD} biaoxun"

echo "=== jiangxi crawler budget write ==="
grep -nE 'budget|万元|万' /opt/jiangxi-portal/*.py 2>/dev/null | head -50 || true

echo "=== zfcg samples ==="
$MYSQL -e "SELECT budget FROM notices WHERE source='zfcg' AND budget<>'' ORDER BY notice_time DESC LIMIT 5;"

echo "=== guangdong samples ==="
$MYSQL -e "SELECT budget FROM guangdong WHERE budget<>'' ORDER BY notice_time DESC LIMIT 5;"

echo "=== jiangxi with unit chars ==="
$MYSQL -e "SELECT COUNT(*) FROM jiangxi WHERE budget REGEXP '[万元]';"
$MYSQL -e "SELECT budget FROM jiangxi WHERE budget REGEXP '[万元]' LIMIT 5;"
