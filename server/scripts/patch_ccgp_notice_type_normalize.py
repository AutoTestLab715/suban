#!/usr/bin/env python3
"""Patch /opt/ccgp-portal/crawler.py to normalize coarse notice_type labels."""
from pathlib import Path

path = Path("/opt/ccgp-portal/crawler.py")
text = path.read_text(encoding="utf-8")

helper = '''
def _normalize_ccgp_notice_type(raw: object, channel_name: str = "") -> str:
    """Map coarse/official labels to API sourceExactTypes values."""
    text = str(raw or "").strip()
    channel = str(channel_name or "").strip()
    if channel and channel != "全部":
        # Prefer channel type when list meta only gave coarse Tab labels.
        if text in {"", "招标公告", "招标采购", "中标公告"}:
            return channel
    alias = {
        "招标公告": "公开招标",
        "招标采购": "公开招标",
        "公开招标公告": "公开招标公告",
        "采购更正公告": "更正公告",
        "变更公告": "更正公告",
        "流标公告": "废标公告",
        "结果公告": "成交公告",
        "成交结果公告": "成交公告",
        "中标结果公告": "中标公告",
        "合同公告": "成交公告",
        "合同公示": "成交公告",
    }
    if text in alias:
        return alias[text]
    return text or (channel if channel != "全部" else "")

'''

if "_normalize_ccgp_notice_type" not in text:
    # Insert helper before crawl()
    anchor = "\ndef crawl("
    if anchor not in text:
        raise SystemExit("crawl() not found")
    text = text.replace(anchor, helper + anchor, 1)

old = '''                "notice_name": (
                    r.get("notice_name")
                    or (type_name if type_name != "全部" else "")
                    or r.get("notice_type")
                    or ""
                ),
                "notice_type": r.get("notice_type") or (type_name if type_name != "全部" else ""),
'''

new = '''                "notice_name": (
                    r.get("notice_name")
                    or (type_name if type_name != "全部" else "")
                    or r.get("notice_type")
                    or ""
                ),
                "notice_type": _normalize_ccgp_notice_type(
                    r.get("notice_type") or "",
                    type_name if type_name != "全部" else "",
                ),
'''

if old not in text:
    if "_normalize_ccgp_notice_type(\n                    r.get(\"notice_type\")" in text:
        print("already patched")
    else:
        raise SystemExit("target notice_type assignment not found")
else:
    text = text.replace(old, new, 1)
    path.write_text(text, encoding="utf-8")
    print("patched ok")

# syntax check
import py_compile
py_compile.compile(str(path), doraise=True)
print("syntax ok")
