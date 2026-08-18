#!/bin/bash
set -euo pipefail

echo "=== 5001 监听 ==="
ss -tlnp 2>/dev/null | grep 5001 || netstat -tlnp 2>/dev/null | grep 5001 || true

echo
echo "=== 进程 ==="
pid=$(ss -tlnp 2>/dev/null | grep ':5001' | sed -n 's/.*pid=\([0-9]*\).*/\1/p' | head -1)
if [ -z "$pid" ]; then
  pid=$(lsof -ti:5001 2>/dev/null | head -1)
fi
if [ -n "$pid" ]; then
  ps -fp "$pid"
  echo "cwd: $(readlink -f /proc/$pid/cwd 2>/dev/null)"
  echo "cmd: $(tr '\0' ' ' < /proc/$pid/cmdline 2>/dev/null)"
fi

echo
echo "=== /opt 下含 5001 的配置 ==="
grep -r "5001" /opt --include="*.py" --include="*.js" --include="*.json" --include="*.sh" --include="*.env" 2>/dev/null | head -20

echo
echo "=== systemd 服务 ==="
grep -r "5001" /etc/systemd/system /usr/lib/systemd/system 2>/dev/null | head -10

echo
echo "=== 本机 HTTP 探测 ==="
curl -sS -m 5 -D- http://127.0.0.1:5001/ -o /tmp/p5001_body.txt 2>&1 | head -20
echo "--- body head ---"
head -c 2000 /tmp/p5001_body.txt 2>/dev/null; echo
