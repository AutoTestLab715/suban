#!/usr/bin/env python3
"""将 ccgp.notice_type 统一为三大类，notice_name 为细类。

用法（在服务器 /opt/ccgp-portal 环境）:
  /opt/ccgp-portal/.venv/bin/python /tmp/relabel_ccgp_notice_types.py
  /opt/ccgp-portal/.venv/bin/python /tmp/relabel_ccgp_notice_types.py --apply
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path("/opt/ccgp-portal")
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from ccgp_db import relabel_notice_types  # noqa: E402


def main() -> None:
    apply_mode = "--apply" in sys.argv
    limit = 0
    for arg in sys.argv[1:]:
        if arg.startswith("--limit="):
            limit = int(arg.split("=", 1)[1])
    result = relabel_notice_types(limit=limit, dry_run=not apply_mode)
    print(json.dumps(result, ensure_ascii=False, indent=2, default=str))
    if not apply_mode:
        print("dry-run only; pass --apply to update", file=sys.stderr)


if __name__ == "__main__":
    main()
