#!/bin/bash
set -a
. /opt/fujian-qwjsy/.env
set +a
mysql -h"$MYSQL_HOST" -P"$MYSQL_PORT" -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" <<'SQL'
SELECT notice_name, COUNT(*) cnt FROM ccgp GROUP BY notice_name ORDER BY cnt DESC LIMIT 30;
SELECT COUNT(*) intent_cnt FROM ccgp WHERE title LIKE '%采购意向%' OR notice_type LIKE '%意向%' OR notice_name LIKE '%意向%';
SELECT notice_type, LEFT(title,60) title FROM ccgp WHERE title LIKE '%采购意向%' LIMIT 10;
SELECT LEFT(region,80) region, COUNT(*) cnt FROM ccgp GROUP BY LEFT(region,80) ORDER BY cnt DESC LIMIT 15;
SELECT budget, COUNT(*) cnt FROM ccgp GROUP BY budget ORDER BY cnt DESC LIMIT 10;
SELECT purchaser, COUNT(*) cnt FROM ccgp GROUP BY purchaser ORDER BY cnt DESC LIMIT 10;
SQL
