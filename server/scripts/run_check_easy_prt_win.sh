#!/bin/bash
set -a
. /opt/fujian-qwjsy/.env
set +a
mysql -h"$MYSQL_HOST" -P"$MYSQL_PORT" -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" < /tmp/check_easy_prt_win.sql
