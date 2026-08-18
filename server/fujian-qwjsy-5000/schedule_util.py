#!/usr/bin/env python3
"""Per-source daily crawl schedule (multi-slot) and cron synchronization."""
from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
SCHEDULE_PATH = ROOT / "schedule.json"
CRON_MARKER = str(ROOT / "crawl_daily.sh")
SOURCE_ORDER = ("zfcg", "kjt", "gxt", "plap", "railway", "cnnc")
SOURCE_LABELS = {
    "cnnc": "核电公告",
    "zfcg": "政府采购网",
    "kjt": "省科技厅",
    "gxt": "省工信厅",
    "plap": "军队采购网",
    "railway": "国铁采购网",
}
# Stagger heavier sources; each source can later add more slots in the UI.
DEFAULT_SOURCE_TIMES: dict[str, list[dict[str, int]]] = {
    "cnnc": [{"hour": 11, "minute": 30}],
    "zfcg": [{"hour": 14, "minute": 0}],
    "kjt": [{"hour": 13, "minute": 30}],
    "gxt": [{"hour": 13, "minute": 0}],
    "plap": [{"hour": 12, "minute": 30}],
    "railway": [{"hour": 8, "minute": 30}],
}
DEFAULT: dict[str, Any] = {
    "enabled": True,
    "lookback_days": 3,
    "source_times": DEFAULT_SOURCE_TIMES,
}
MAX_SLOTS_PER_SOURCE = 8


def _clamp_int(value: object, default: int, lo: int, hi: int) -> int:
    try:
        n = int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        n = default
    return max(lo, min(hi, n))


def _normalize_slot(item: object, default_hour: int, default_minute: int) -> dict[str, int]:
    data = item if isinstance(item, dict) else {}
    return {
        "hour": _clamp_int(data.get("hour"), default_hour, 0, 23),
        "minute": _clamp_int(data.get("minute"), default_minute, 0, 59),
    }


def _normalize_source_slots(value: object, defaults: list[dict[str, int]]) -> list[dict[str, int]]:
    """Accept legacy single dict or a list of {hour, minute}."""
    default0 = defaults[0] if defaults else {"hour": 8, "minute": 0}
    raw_items: list[object]
    if isinstance(value, dict) and ("hour" in value or "minute" in value):
        raw_items = [value]
    elif isinstance(value, list):
        raw_items = value
    else:
        raw_items = []

    slots: list[dict[str, int]] = []
    seen: set[tuple[int, int]] = set()
    for item in raw_items:
        slot = _normalize_slot(item, default0["hour"], default0["minute"])
        key = (slot["hour"], slot["minute"])
        if key in seen:
            continue
        seen.add(key)
        slots.append(slot)
        if len(slots) >= MAX_SLOTS_PER_SOURCE:
            break
    if not slots:
        for item in defaults:
            slot = _normalize_slot(item, default0["hour"], default0["minute"])
            key = (slot["hour"], slot["minute"])
            if key in seen:
                continue
            seen.add(key)
            slots.append(slot)
    return slots or [dict(default0)]


def _normalize_source_times(data: dict[str, Any]) -> dict[str, list[dict[str, int]]]:
    raw = data.get("source_times")
    raw = raw if isinstance(raw, dict) else {}
    result: dict[str, list[dict[str, int]]] = {}
    for source in SOURCE_ORDER:
        defaults = DEFAULT_SOURCE_TIMES[source]
        result[source] = _normalize_source_slots(raw.get(source), defaults)
    return result


def normalize(raw: dict[str, Any] | None = None) -> dict[str, Any]:
    data = dict(DEFAULT)
    if raw:
        data.update(raw)
    source_times = _normalize_source_times(data)
    flat_times = [slot for source in SOURCE_ORDER for slot in source_times[source]]
    first = flat_times[0] if flat_times else {"hour": 8, "minute": 0}
    return {
        "hour": first["hour"],
        "minute": first["minute"],
        "times": flat_times,
        "source_times": source_times,
        "enabled": bool(data.get("enabled", True)),
        "lookback_days": _clamp_int(data.get("lookback_days"), 3, 1, 30),
    }


def load() -> dict[str, Any]:
    if not SCHEDULE_PATH.is_file():
        return normalize()
    try:
        raw = json.loads(SCHEDULE_PATH.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return normalize()
    return normalize(raw) if isinstance(raw, dict) else normalize()


def save(data: dict[str, Any]) -> dict[str, Any]:
    cfg = normalize(data)
    tmp = SCHEDULE_PATH.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(cfg, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(SCHEDULE_PATH)
    apply_cron(cfg)
    return cfg


def cron_line(source: str, hour: int, minute: int) -> str:
    lock = f"/tmp/fujian_crawl_{source}.lock"
    return (
        f"{minute} {hour} * * * flock -xn {lock} "
        f"-c '{ROOT}/crawl_daily.sh {source}' "
        f">> {ROOT}/output/daily_cron.log 2>&1"
    )


def _read_crontab() -> str:
    try:
        return subprocess.check_output(["crontab", "-l"], text=True, stderr=subprocess.DEVNULL)
    except subprocess.CalledProcessError:
        return ""


def apply_cron(cfg: dict[str, Any] | None = None) -> None:
    cfg = normalize(cfg or load())
    old = _read_crontab()
    kept = [line for line in old.splitlines() if CRON_MARKER not in line]
    while kept and not kept[-1].strip():
        kept.pop()
    if cfg["enabled"]:
        for source in SOURCE_ORDER:
            for slot in cfg["source_times"][source]:
                kept.append(cron_line(source, slot["hour"], slot["minute"]))
    body = ("\n".join(kept) + "\n") if kept else ""
    proc = subprocess.run(["crontab", "-"], input=body, text=True, capture_output=True)
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or "crontab write failed")


def public_view(cfg: dict[str, Any] | None = None) -> dict[str, Any]:
    cfg = normalize(cfg or load())
    source_times = cfg["source_times"]
    labels = {source: SOURCE_LABELS[source] for source in SOURCE_ORDER}
    parts: list[str] = []
    cron_lines: list[str] = []
    for source in SOURCE_ORDER:
        slots = source_times[source]
        times_text = "、".join(f"{s['hour']:02d}:{s['minute']:02d}" for s in slots)
        parts.append(f"{SOURCE_LABELS[source]} {times_text}")
        for slot in slots:
            cron_lines.append(cron_line(source, slot["hour"], slot["minute"]))
    times_label = "；".join(parts)
    return {
        **cfg,
        "time": f"{cfg['hour']:02d}:{cfg['minute']:02d}",
        "times_label": times_label,
        "source_labels": labels,
        "cron_lines": cron_lines if cfg["enabled"] else [],
        "label": (
            f"每天分别抓取：{times_label}"
            if cfg["enabled"]
            else "定时任务已关闭"
        ),
    }
