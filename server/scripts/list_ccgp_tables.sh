#!/bin/bash
set -a
. /opt/fujian-qwjsy/.env
set +a
mysql -h"$MYSQL_HOST" -P"$MYSQL_PORT" -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" <<'SQL'
SHOW TABLES LIKE '%ccgp%';
SHOW TABLES;
SQL
