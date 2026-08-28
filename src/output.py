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
    # 用 compact 而非 indent —— 這是機器讀的產生檔，縮排會讓體積翻倍
    # （實測 253KB → 124KB），每天一份累積下來差很多。
    text = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    dated.write_text(text, encoding="utf-8")
    latest.write_text(text, encoding="utf-8")
    write_index(data_dir)
    return dated, latest


def write_index(data_dir: Path) -> list[str]:
    """重建 data/index.json —— 可用日期清單，給前端的日期切換用。

    直接掃目錄而不是累加，這樣手動刪掉某天的檔案後索引會自動跟上。
    """
    data_dir = Path(data_dir)
    dates = sorted(
        (p.stem for p in data_dir.glob("[0-9]*-[0-9]*-[0-9]*.json")), reverse=True
    )
    (data_dir / "index.json").write_text(
        json.dumps({"dates": dates}, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return dates


def existing_date(data_dir: Path) -> str | None:
    """目前 latest.json 的資料日期，用來判斷盤後資料是否已更新。"""
    latest = Path(data_dir) / "latest.json"
    if not latest.exists():
        return None
    try:
        return json.loads(latest.read_text(encoding="utf-8")).get("date")
    except (OSError, json.JSONDecodeError):
        return None
