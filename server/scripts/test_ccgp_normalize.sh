#!/bin/bash
set -u
echo "=== normalize source ==="
sed -n '896,940p; 1225,1240p' /opt/ccgp-portal/crawler.py
echo "=== test normalize ==="
cd /opt/ccgp-portal
./.venv/bin/python <<'PY'
from crawler import _normalize_ccgp_notice_type as n
print(repr(n("招标公告", "公开招标")))
print(repr(n("招标公告", "")))
print(repr(n("", "公开招标")))
print(repr(n("公开招标公告", "公开招标")))
PY
echo "=== crawl procs ==="
pgrep -af 'crawler.py|crawl_daily' || true
ps -ef | grep -E 'crawler.py' | grep -v grep || true
echo "=== lock ==="
cat /opt/ccgp-portal/crawler.lock 2>/dev/null; echo
ls -la /opt/ccgp-portal/crawler.lock
