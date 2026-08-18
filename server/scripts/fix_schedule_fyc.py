#!/usr/bin/env python3
"""Fix schedule_util KeyError for fyc and update schedule UI meta."""
from __future__ import annotations

from pathlib import Path

ROOT = Path("/opt/fujian-qwjsy")


def patch_schedule_util() -> None:
    path = ROOT / "schedule_util.py"
    text = path.read_text(encoding="utf-8")
    if '"fyc":' not in text.split("DEFAULT_SOURCE_TIMES")[1].split("DEFAULT:")[0]:
        text = text.replace(
            '    "easy_prt": [{"hour": 12, "minute": 45}],\n    "railway": [],',
            '    "easy_prt": [{"hour": 12, "minute": 45}],\n    "fyc": [{"hour": 10, "minute": 30}],\n    "railway": [],',
        )
    text = text.replace(
        "        defaults = DEFAULT_SOURCE_TIMES[source]",
        "        defaults = DEFAULT_SOURCE_TIMES.get(source, [{\"hour\": 8, \"minute\": 0}])",
    )
    path.write_text(text, encoding="utf-8")


def patch_index() -> None:
    path = ROOT / "templates/index.html"
    idx = path.read_text(encoding="utf-8")
    if 'source:"fyc"' not in idx:
        idx = idx.replace(
            '  {source:"easy_prt",label:"工采通公告抓取",fallback:{hour:12,minute:45}},\n];',
            '  {source:"easy_prt",label:"工采通公告抓取",fallback:{hour:12,minute:45}},\n  {source:"fyc",label:"福易采",fallback:{hour:10,minute:30}},\n];',
        )
    if "福易采自动增量" not in idx:
        idx = idx.replace(
            "采购网 + 科技厅 + 工信厅 + 军队采购网 + 工采通公告抓取 + 国铁采购网自动增量",
            "采购网 + 科技厅 + 工信厅 + 军队采购网 + 工采通 + 福易采 + 国铁采购网自动增量",
        )
    path.write_text(idx, encoding="utf-8")


def main() -> None:
    patch_schedule_util()
    patch_index()
    import schedule_util

    view = schedule_util.public_view()
    print("ok", view.get("label", "")[:80])


if __name__ == "__main__":
    main()
