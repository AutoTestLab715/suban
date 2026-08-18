#!/bin/bash
set -a
. /opt/fujian-qwjsy/.env
set +a
mysql -h"$MYSQL_HOST" -P"$MYSQL_PORT" -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" <<'SQL'
DESC ccgp;
SELECT COUNT(*) AS cnt FROM ccgp;
SELECT notice_type, COUNT(*) cnt FROM ccgp GROUP BY notice_type ORDER BY cnt DESC LIMIT 40;
SELECT id, title, notice_type, notice_time, region, purchaser, budget, LEFT(url,80) url
FROM ccgp ORDER BY notice_time DESC LIMIT 5;
SHOW INDEX FROM ccgp;
SQL
