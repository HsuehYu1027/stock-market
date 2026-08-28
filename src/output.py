"""輸出每日 JSON。所有金額與比率存原始數值，格式化留給前端。"""

from __future__ import annotations

import json
from pathlib import Path


def write_daily(payload: dict, data_dir: Path) -> tuple[Path, Path]:
    """寫入 data/YYYY-MM-DD.json 並同步 data/latest.json。"""
    data_dir = Path(data_dir)
    data_dir.mkdir(parents=True, exist_ok=True)
    dated = data_dir / f"{payload['date']}.json"
    latest = data_dir / "latest.json"
    text = json.dumps(payload, ensure_ascii=False, indent=2)
    dated.write_text(text, encoding="utf-8")
    latest.write_text(text, encoding="utf-8")
    return dated, latest


def existing_date(data_dir: Path) -> str | None:
    """目前 latest.json 的資料日期，用來判斷盤後資料是否已更新。"""
    latest = Path(data_dir) / "latest.json"
    if not latest.exists():
        return None
    try:
        return json.loads(latest.read_text(encoding="utf-8")).get("date")
    except (OSError, json.JSONDecodeError):
        return None
