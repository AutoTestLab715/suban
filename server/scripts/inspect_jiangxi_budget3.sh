#!/bin/bash
set -euo pipefail
source /opt/fujian-qwjsy/.env
MYSQL=(mysql -N -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" biaoxun)

echo "=== extract 预算金额 from content ==="
"${MYSQL[@]}" -e "
SELECT budget,
  SUBSTRING_INDEX(SUBSTRING_INDEX(content_text, '预算金额', -1), '\n', 1) AS from_content,
  LEFT(title, 40)
FROM jiangxi
WHERE content_text LIKE '%预算金额%' AND budget<>''
ORDER BY notice_time DESC
LIMIT 20;
"

echo "=== elevator row ==="
"${MYSQL[@]}" -e "
SELECT budget, successful_money,
  SUBSTRING(content_text, LOCATE('预算', content_text), 80)
FROM jiangxi
WHERE title LIKE '%历市镇卫生院门诊采购电梯%'
LIMIT 1;
"

echo "=== how many content have 万元 after 预算 ==="
"${MYSQL[@]}" -e "
SELECT
  SUM(content_text LIKE '%预算金额：%万元%' OR content_text LIKE '%预算金额:%万元%') AS yuan_wan,
  SUM(content_text REGEXP '预算金额[:：][[:space:]]*[0-9.]+[[:space:]]*万元') AS re_wan,
  SUM(content_text REGEXP '预算金额[:：][[:space:]]*[0-9.]+[[:space:]]*元') AS re_yuan,
  COUNT(*) AS total_with_budget_label
FROM jiangxi
WHERE content_text LIKE '%预算金额%';
"

echo "=== sample API list row (live) ==="
python3 - <<'PY'
import json, urllib.request
# peek crawler for list API
import re
src=open('/opt/jiangxi-portal/crawler.py',encoding='utf-8').read()
for pat in ['http','budget','list','api']:
    pass
# find list endpoint
m=re.findall(r'https?://[^\s\"\']+', src)
print('urls sample:', m[:15])
# find budget handling
idx=src.find('budget')
print(src[max(0,idx-200):idx+400])
PY
