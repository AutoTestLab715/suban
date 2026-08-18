"""Extract purchaser/Party-A contact details from procurement notice text."""
from __future__ import annotations

import html
import re
from dataclasses import dataclass
from typing import Iterable

_TAG_RE = re.compile(r"<[^>]+>")
_SPACE_RE = re.compile(r"[\s\u00a0\u3000]+")
_MOBILE_RE = re.compile(r"(?<!\d)1[3-9]\d{9}(?!\d)")
_LANDLINE_RE = re.compile(r"(?<!\d)0\d{2,3}[\-－—\s]?\d{7,8}(?:[\-转]\d{1,6})?(?!\d)")
_SERVICE_RE = re.compile(r"(?<!\d)(?:400|800)[\-－—\s]?\d{3}[\-－—\s]?\d{4}(?!\d)")
_BARE_PHONE_RE = re.compile(r"(?<!\d)\d{7,8}(?!\d)")
_EMAIL_RE = re.compile(r"(?<![\w.+-])[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}(?![\w.-])", re.I)

_START_PATTERNS = [
    ("采购人信息", re.compile(r"(?:^|\s)(?:1\s*[.、．]\s*)?采购人(?:（甲方）|\(甲方\))?(?:单位)?信息\s*[:：]?")),
    ("采购人甲方", re.compile(r"(?:^|\s)采购人\s*(?:（甲方）|\(甲方\))\s*[:：]?")),
    ("采购人", re.compile(r"(?:^|\s)(?:1\s*[.、．]\s*)?采购人(?:单位)?\s*[:：]")),
    ("采购单位", re.compile(r"(?:^|\s)(?:1\s*[.、．]\s*)?采购单位(?:信息)?\s*[:：]?")),
    ("招标人", re.compile(r"(?:^|\s)(?:1\s*[.、．]\s*)?招标人(?:信息)?\s*[:：]?")),
    ("甲方", re.compile(r"(?:^|\s)甲方\s*[:：]")),
]
_END_RE = re.compile(
    r"\s(?:2\s*[.、．]\s*)?(?:采购代理机构|采购代理|采购执行机构|采购机构|代理机构|招标代理)(?:信息)?\s*[:：]?"
    r"|\s(?:供应商|成交供应商|中标供应商)\s*(?:（乙方）|\(乙方\)|乙方)?\s*[:：]?"
    r"|\s乙方\s*[:：]|\s(?:3\s*[.、．]\s*)?项目联系方式\s*[:：]?"
)
_PHONE_VALUE_RE = re.compile(
    r"(?:联系方式|联系电话|联系号码|办公电话|手机号码|手机|电话)\s*[:：]\s*"
    r"(.{5,100}?)(?=\s(?:地址|联系地址|联系人|项目联系人|电子邮箱|电子邮件|邮箱|传真|邮编|"
    r"2\s*[.、．]|3\s*[.、．]|采购代理|代理机构|供应商|乙方|项目联系方式)\s*[:：]?|$)"
)
_PERSON_RE = re.compile(
    r"(?:项目联系人|联系人|联\s*系\s*人|经办人)\s*[:：]\s*"
    r"([\u4e00-\u9fffA-Za-z·•]{2,20})(?=\s|电话|手机|联系方式|$)"
)
_ADDRESS_RE = re.compile(
    r"(?:联系地址|地址)\s*[:：]\s*(.{4,180}?)(?=\s(?:联系方式|联系电话|联系号码|电话|手机|"
    r"联系人|电子邮箱|电子邮件|邮箱|传真|邮编|2\s*[.、．]|3\s*[.、．]|采购代理|供应商|乙方)\s*[:：]?|$)"
)

_FULLWIDTH = str.maketrans("０１２３４５６７８９（）－：", "0123456789()-:")


@dataclass
class Candidate:
    kind: str
    text: str
    base_score: int


def normalize_text(value: object) -> str:
    text = html.unescape(str(value or ""))
    text = _TAG_RE.sub(" ", text)
    text = text.translate(_FULLWIDTH)
    return _SPACE_RE.sub(" ", text).strip()


def _unique(values: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        value = value.strip(" ,，;；。/|")
        key = re.sub(r"[\s－—]", "-", value).lower()
        if value and key not in seen:
            seen.add(key)
            result.append(value)
    return result


def _clean_phone(value: str) -> str:
    value = value.translate(_FULLWIDTH)
    value = re.sub(r"\s+", "", value)
    value = value.replace("－", "-").replace("—", "-")
    return value.strip("-;,，；。")


def _extract_phones(section: str) -> list[str]:
    labeled_chunks = [m.group(1) for m in _PHONE_VALUE_RE.finditer(section)]
    phones: list[str] = []
    for chunk in labeled_chunks:
        for regex in (_MOBILE_RE, _LANDLINE_RE, _SERVICE_RE):
            phones.extend(_clean_phone(m.group(0)) for m in regex.finditer(chunk))
        # Some notices write an area-code phone followed by a second 7/8 digit number.
        phones.extend(_clean_phone(m.group(0)) for m in _BARE_PHONE_RE.finditer(chunk))
    if not phones:
        phones.extend(_clean_phone(m.group(0)) for m in _MOBILE_RE.finditer(section))
        phones.extend(_clean_phone(m.group(0)) for m in _LANDLINE_RE.finditer(section))
    # Avoid keeping the local-number fragment when it is already part of a landline.
    result = _unique(phones)
    return [p for p in result if not any(p != q and p in q for q in result)]


def _extract_people(section: str) -> list[str]:
    people = [m.group(1) for m in _PERSON_RE.finditer(section)]
    for match in _PHONE_VALUE_RE.finditer(section):
        chunk = match.group(1).strip()
        prefix = re.split(r"(?:1[3-9]\d{9}|0\d{2,3}[\-－—\s]?\d{7,8})", chunk, maxsplit=1)[0]
        prefix = prefix.strip(" /、,，;；:：")
        if re.fullmatch(r"[\u4e00-\u9fff·•]{2,12}", prefix):
            people.append(prefix)
    return _unique(people)


def _extract_evidence(section: str, phones: list[str], emails: list[str]) -> str:
    anchors = phones + emails + ["联系方式", "联系电话", "电话"]
    positions = [section.find(anchor) for anchor in anchors if anchor and section.find(anchor) >= 0]
    start = max(0, (min(positions) if positions else 0) - 100)
    return section[start : start + 300].strip()


def _candidate_sections(text: str, purchaser: str) -> list[Candidate]:
    candidates: list[Candidate] = []
    for label, pattern in _START_PATTERNS:
        for match in pattern.finditer(text):
            section = text[match.start() : match.start() + 1800]
            end = _END_RE.search(section, max(20, match.end() - match.start()))
            if end:
                section = section[: end.start()]
            if len(section) >= 12:
                candidates.append(Candidate(label, section, 62))

    purchaser = normalize_text(purchaser)
    if purchaser:
        start = 0
        for _ in range(4):
            pos = text.find(purchaser, start)
            if pos < 0:
                break
            window = text[max(0, pos - 120) : pos + len(purchaser) + 1100]
            end = _END_RE.search(window, max(20, window.find(purchaser) + len(purchaser)))
            if end:
                window = window[: end.start()]
            candidates.append(Candidate("甲方单位邻近段落", window, 45))
            start = pos + len(purchaser)

    return candidates


def extract_purchaser_contact(row: dict) -> dict:
    purchaser = normalize_text(row.get("purchaser"))
    text = normalize_text(row.get("content_text"))
    if len(text) < 20:
        text = normalize_text(row.get("content_html") or row.get("description"))

    best: dict | None = None
    for candidate in _candidate_sections(text, purchaser):
        section = candidate.text
        phones = _extract_phones(section)
        emails = _unique(m.group(0) for m in _EMAIL_RE.finditer(section))
        people = _extract_people(section)
        addresses = _unique(m.group(1).strip(" ,，;；。") for m in _ADDRESS_RE.finditer(section))
        score = candidate.base_score
        if purchaser and purchaser in section:
            score += 12
        if phones:
            score += 22
        if emails:
            score += 12
        if people:
            score += 8
        if addresses:
            score += 8
        if candidate.kind == "正文兜底" and purchaser and purchaser not in section:
            score -= 20

        current = {
            "purchaser": purchaser,
            "phones": phones,
            "emails": emails,
            "contact_people": people,
            "addresses": addresses[:2],
            "evidence": _extract_evidence(section, phones, emails),
            "match_basis": candidate.kind,
            "score": score,
        }
        if best is None or current["score"] > best["score"]:
            best = current

    if best is None:
        best = {
            "purchaser": purchaser,
            "phones": [],
            "emails": [],
            "contact_people": [],
            "addresses": [],
            "evidence": "",
            "match_basis": "未找到正文",
            "score": 0,
        }

    has_contact = bool(best["phones"] or best["emails"])
    score = best["score"]
    if not has_contact:
        confidence = "未提取"
    elif score >= 90:
        confidence = "高"
    elif score >= 68:
        confidence = "中"
    else:
        confidence = "低"
    best["confidence"] = confidence
    best["has_contact"] = has_contact
    return best

