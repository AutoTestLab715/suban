#!/bin/bash
set -a
. /opt/fujian-qwjsy/.env
set +a
mysql -h"$MYSQL_HOST" -P"$MYSQL_PORT" -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" <<'SQL'
SELECT notice_type, COUNT(*) c FROM ccgp GROUP BY notice_type ORDER BY c DESC;
SELECT notice_name, COUNT(*) c FROM ccgp GROUP BY notice_name ORDER BY c DESC LIMIT 20;
-- misclassified samples: win-ish title in tender types
SELECT notice_type, LEFT(title,70) t FROM ccgp
WHERE notice_type IN ('公开招标','竞争性磋商','竞争性谈判','更正公告','其他公告')
 AND (title LIKE '%中标%' OR title LIKE '%成交公告%' OR title LIKE '%结果公告%' OR title LIKE '%终止%')
LIMIT 15;
-- tender-ish in win types
SELECT notice_type, LEFT(title,70) t FROM ccgp
WHERE notice_type IN ('中标公告','成交公告','终止公告','废标公告')
 AND (title LIKE '%招标公告%' OR title LIKE '%磋商公告%' OR title LIKE '%谈判公告%' OR title LIKE '%征集%')
LIMIT 15;
SELECT COUNT(*) future FROM ccgp WHERE notice_time > NOW();
SQL
