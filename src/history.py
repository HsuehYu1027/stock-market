"""從 data/ 底下既有的每日 JSON 累積歷史，計算成交值佔比的五日均。

刻意不做歷史回補：逐檔打 STOCK_DAY?stockNo= 要兩千次請求，對官方站台不友善。
改為每天跑、每天累積，跑滿五個交易日後 avg5 自動生效。
資料不足時回 None 而非 0 —— 「還沒有資料」和「沒有變化」是兩件事，
前端會顯示「累積中 (n/5 日)」而不是一個看起來像真值的 0。
"""

from __future__ import annotations

import json
from pathlib import Path

WINDOW = 5


def _daily_files(data_dir: Path, before: str) -> list[Path]:
    """取 before 之前（不含）的每日檔，日期新→舊排序。"""
    files = sorted(
        (p for p in data_dir.glob("[0-9]*-[0-9]*-[0-9]*.json") if p.stem < before),
        key=lambda p: p.stem,
        reverse=True,
    )
    return files[:WINDOW]


def load_share_history(data_dir: Path, before: str) -> dict[str, list[float]]:
    """回傳 {族群名稱: [近 N 日的 turnover_share]}，忽略讀不到／格式壞掉的檔。"""
    history: dict[str, list[float]] = {}
    for path in _daily_files(data_dir, before):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        for group in payload.get("groups", []):
            share = group.get("turnover_share")
            if share is not None:
                history.setdefault(group["name"], []).append(share)
    return history


def apply_history(groups: list[dict], data_dir: Path, date: str) -> None:
    """就地填入 turnover_share_avg5 / turnover_share_delta / history_days。"""
    history = load_share_history(Path(data_dir), before=date)
    for group in groups:
        past = history.get(group["name"], [])
        group["history_days"] = len(past)
        if len(past) < WINDOW:
            continue  # 維持 None，前端顯示「累積中」
        avg5 = sum(past) / len(past)
        group["turnover_share_avg5"] = avg5
        if group["turnover_share"] is not None:
            group["turnover_share_delta"] = group["turnover_share"] - avg5
