#!/bin/bash
set -a
. /opt/fujian-qwjsy/.env
set +a
mysql -h"$MYSQL_HOST" -P"$MYSQL_PORT" -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" <<'SQL'
SELECT 'zfcg' src, notice_type, COUNT(*) cnt FROM notices WHERE source='zfcg' GROUP BY notice_type ORDER BY cnt DESC LIMIT 50;
SELECT 'ccgp' src, notice_type, COUNT(*) cnt FROM ccgp GROUP BY notice_type ORDER BY cnt DESC;
SELECT 'easy_prt' src, notice_type, COUNT(*) cnt FROM easy_prt GROUP BY notice_type ORDER BY cnt DESC;
SQL
