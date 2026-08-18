#!/bin/bash
set -euo pipefail
echo "=== 5000 ==="
ss -tlnp | grep 5000 || true
pid=$(ss -tlnp | grep ':5000' | sed -n 's/.*pid=\([0-9]*\).*/\1/p' | head -1)
[ -n "$pid" ] && ps -fp "$pid" && readlink -f /proc/$pid/cwd && tr '\0' ' ' < /proc/$pid/cmdline && echo
echo "=== 5001 ==="
ss -tlnp | grep 5001 || true
echo "=== /opt 项目 ==="
ls -la /opt/ | head -30
echo "=== fujian-qwjsy ==="
ls -la /opt/fujian-qwjsy/ 2>/dev/null | head -25
echo "=== fyc-portal ==="
ls -la /opt/fyc-portal/ 2>/dev/null | head -20
