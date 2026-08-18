#!/usr/bin/env python3
"""Patch ccgp_db.upsert_many so notice_type stays API-compatible for mini-program filters."""
from pathlib import Path

path = Path("/opt/ccgp-portal/ccgp_db.py")
text = path.read_text(encoding="utf-8")

helper = '''
# 小程序 / biaoxunApi sourceExactTypes.ccgp 使用的细粒度 notice_type
API_CCGP_TENDER = {
    "公开招标",
    "公开招标公告",
    "邀请招标",
    "竞争性磋商",
    "竞争性谈判",
    "询价公告",
    "单一来源",
    "更正公告",
    "资格预审",
    "其他公告",
}
API_CCGP_WIN = {"中标公告", "成交公告", "终止公告", "废标公告"}
API_CCGP_INTENT = {"采购意向"}
API_CCGP_ALL = API_CCGP_TENDER | API_CCGP_WIN | API_CCGP_INTENT


def to_api_notice_type(cat: str, fine: str, raw_type: str = "", title: str = "") -> tuple[str, str]:
    """返回 (notice_type给API过滤, notice_name展示)。"""
    raw = str(raw_type or "").strip()
    fine_s = str(fine or "").strip()
    cat_s = str(cat or "").strip()
    title_s = str(title or "")

    if raw in API_CCGP_ALL:
        display = fine_s or raw
        return raw, display

    # fine / 标题启发 → API 类型
    blob = f"{title_s} {fine_s} {raw}"
    if cat_s == CATEGORY_INTENT or "采购意向" in blob or ("意向" in title_s and "采购" in title_s):
        return "采购意向", fine_s or "采购意向"
    if any(k in blob for k in ("流标", "废标")):
        return "废标公告", fine_s or "废标公告"
    if "终止" in blob or "中止" in blob:
        return "终止公告", fine_s or "终止公告"
    if any(k in blob for k in ("成交公示", "成交公告", "成交结果", "结果公告", "合同公告", "合同公示")):
        return "成交公告", fine_s or "成交公告"
    if "中标" in blob:
        return "中标公告", fine_s or "中标公告"
    if any(k in blob for k in ("竞争性磋商", "磋商公告", "磋商")):
        return "竞争性磋商", fine_s or "竞争性磋商公告"
    if any(k in blob for k in ("竞争性谈判", "谈判公告", "谈判")):
        return "竞争性谈判", fine_s or "竞争性谈判公告"
    if "询价" in blob:
        return "询价公告", fine_s or "询价公告"
    if "单一来源" in blob:
        return "单一来源", fine_s or "单一来源"
    if any(k in blob for k in ("更正", "变更", "补充公告")):
        return "更正公告", fine_s or "更正公告"
    if "资格预审" in blob:
        return "资格预审", fine_s or "资格预审"
    if "邀请招标" in blob:
        return "邀请招标", fine_s or "邀请招标"
    if "公开招标公告" in blob:
        return "公开招标公告", fine_s or "公开招标公告"
    if any(k in blob for k in ("公开招标", "招标公告", "征集", "比选", "竞价")):
        return "公开招标", fine_s or "招标公告"
    if cat_s == CATEGORY_AWARD:
        return "成交公告", fine_s or "成交公告"
    if cat_s == CATEGORY_TENDER:
        return "公开招标", fine_s or "招标公告"
    return (raw or "其他公告"), (fine_s or raw or "其他公告")

'''

if "def to_api_notice_type(" not in text:
    anchor = "def classify_notice("
    if anchor not in text:
        raise SystemExit("classify_notice not found")
    text = text.replace(anchor, helper + anchor, 1)

old = '''        cat, fine = classify_notice(
            item.get("title"),
            item.get("notice_type"),
            item.get("notice_name"),
        )
        values.append(
            [
                _clip(item.get("id") or make_id(url), 64),
                _clip(item.get("source") or "ccgp", 16),
                _clip(item.get("title") or "", 512),
                sanitize_notice_time(item.get("notice_time"), url=url),
                _clip(item.get("region") or "", 128),
                _clip(fine, 128),
                _clip(cat, 128),
                _clip(item.get("channel") or cat, 64),
'''

new = '''        cat, fine = classify_notice(
            item.get("title"),
            item.get("notice_type"),
            item.get("notice_name"),
        )
        api_type, display_name = to_api_notice_type(
            cat,
            fine,
            str(item.get("notice_type") or ""),
            str(item.get("title") or ""),
        )
        values.append(
            [
                _clip(item.get("id") or make_id(url), 64),
                _clip(item.get("source") or "ccgp", 16),
                _clip(item.get("title") or "", 512),
                sanitize_notice_time(item.get("notice_time"), url=url),
                _clip(item.get("region") or "", 128),
                _clip(display_name, 128),
                _clip(api_type, 128),
                _clip(item.get("channel") or cat, 64),
'''

if old not in text:
    if "api_type, display_name = to_api_notice_type(" in text:
        print("upsert already patched")
    else:
        raise SystemExit("upsert target not found")
else:
    text = text.replace(old, new, 1)
    path.write_text(text, encoding="utf-8")
    print("upsert patched")

import py_compile
py_compile.compile(str(path), doraise=True)
print("syntax ok")

# quick unit check
import importlib.util
spec = importlib.util.spec_from_file_location("ccgp_db", path)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
print(mod.to_api_notice_type("招标公告", "招标公告", "公开招标", "某某公开招标公告"))
print(mod.to_api_notice_type("招标公告", "招标公告", "招标公告", "某某招标公告"))
print(mod.to_api_notice_type("中标公告", "成交公告", "", "某某成交公告"))
