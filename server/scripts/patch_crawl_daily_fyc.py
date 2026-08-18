#!/usr/bin/env python3
from pathlib import Path

p = Path("/opt/fujian-qwjsy/crawl_daily.sh")
sh = p.read_text(encoding="utf-8")
if "fyc)" in sh:
    print("already patched")
    raise SystemExit(0)
sh = sh.replace(
    """    easy_prt)
      run_one easy_prt "$ROOT/easy_prt_portal/crawler.py" --lookback-days "$LOOKBACK"
      ;;
""",
    """    fyc)
      run_one fyc "$ROOT/fyc_crawler.py" --daily --lookback-days "$LOOKBACK" --limit 0 --pages 0
      ;;
    easy_prt)
      run_one easy_prt "$ROOT/easy_prt_portal/crawler.py" --lookback-days "$LOOKBACK"
      ;;
""",
)
p.write_text(sh, encoding="utf-8")
print("crawl_daily patched")
