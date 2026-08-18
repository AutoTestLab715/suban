#!/bin/bash
set -a
. /opt/fujian-qwjsy/.env
set +a
mysql -h"$MYSQL_HOST" -P"$MYSQL_PORT" -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" -e "
SELECT notice_type, COUNT(*) cnt FROM plap GROUP BY notice_type ORDER BY cnt DESC LIMIT 30;
SELECT notice_type, LEFT(title,50) title FROM plap WHERE title LIKE '%政策%' OR notice_type IN ('00104','001041','60','61') LIMIT 15;
"
