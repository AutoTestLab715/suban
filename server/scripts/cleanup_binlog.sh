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

echo "=== 复制状态 ==="
REPLICA=$(mysql -uroot -N -e "SHOW REPLICA STATUS\G" 2>/dev/null | grep -c "Master_Host" || true)
SLAVE=$(mysql -uroot -N -e "SHOW SLAVE STATUS\G" 2>/dev/null | grep -c "Master_Host" || true)
if [ "$REPLICA" -gt 0 ] || [ "$SLAVE" -gt 0 ]; then
  echo "检测到主从复制，中止"
  exit 1
fi
echo "无主从复制"

echo
echo "=== 清理前 ==="
mysql -uroot -e "SHOW BINARY LOGS;"
echo "磁盘:"
df -h / | tail -1
du -ch /www/server/data/mysql-bin.* 2>/dev/null | tail -1

CURRENT=$(mysql -uroot -N -e "SHOW MASTER STATUS;" | awk '{print $1}')
echo "保留当前日志: $CURRENT"

mysql -uroot -e "PURGE BINARY LOGS TO '$CURRENT';"
mysql -uroot -e "SET GLOBAL binlog_expire_logs_seconds = 604800;"

echo
echo "=== 清理后 ==="
mysql -uroot -e "SHOW BINARY LOGS;"
mysql -uroot -N -e "SHOW VARIABLES LIKE 'binlog_expire_logs_seconds';"
echo "磁盘:"
df -h / | tail -1
du -ch /www/server/data/mysql-bin.* 2>/dev/null | tail -1 || echo "0 total"
