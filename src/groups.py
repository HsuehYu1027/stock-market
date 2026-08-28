"""載入 config/groups.yaml 並把成分股對應到當日行情。

族群定義完全來自 YAML，程式碼不寫死任何族群名稱或成分股。
"""

from __future__ import annotations

from pathlib import Path

import yaml

from .normalize import Quote

DEFAULT_CONFIG = Path(__file__).resolve().parent.parent / "config" / "groups.yaml"


def load_groups(path: Path | str = DEFAULT_CONFIG) -> dict[str, list[str]]:
    """回傳 {族群名稱: [股票代號]}。代號一律正規化為字串。"""
    raw = yaml.safe_load(Path(path).read_text(encoding="utf-8")) or {}
    groups: dict[str, list[str]] = {}
    for name, codes in raw.items():
        if not codes:
            groups[str(name)] = []  # 允許留空的骨架族群
            continue
        # 去重但保留 YAML 中的順序
        seen: dict[str, None] = {}
        for code in codes:
            seen.setdefault(str(code).strip(), None)
        groups[str(name)] = list(seen)
    return groups


def resolve(
    groups: dict[str, list[str]], quotes: list[Quote]
) -> tuple[dict[str, list[Quote]], dict[str, list[str]]]:
    """把代號清單換成當日報價。

    一檔股票可同時屬於多個族群，這裡不做互斥處理。
    清單中當日查無資料的代號（打錯、已下市、全日無成交）收集到 missing，
    交由輸出 JSON 回報，而不是靜靜地忽略。
    """
    by_code = {q.code: q for q in quotes}
    resolved: dict[str, list[Quote]] = {}
    missing: dict[str, list[str]] = {}
    for name, codes in groups.items():
        found, absent = [], []
        for code in codes:
            quote = by_code.get(code)
            (found if quote else absent).append(quote if quote else code)
        resolved[name] = found
        if absent:
            missing[name] = absent
    return resolved, missing
