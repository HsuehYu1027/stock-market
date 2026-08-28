#!/usr/bin/env python3
"""主流程：抓當日行情 → 套族群 → 算指標 → 輸出 data/YYYY-MM-DD.json。

用法:
    python3 scripts/fetch_daily.py            # 正常抓取
    python3 scripts/fetch_daily.py --force    # 資料日期未更新時仍覆寫
    python3 scripts/fetch_daily.py --dry-run  # 只印摘要，不寫檔

結束代碼:
    0  成功產出當日資料
    1  兩個來源都抓不到（保留前一日資料不動）
    2  盤後資料尚未更新／非交易日，沒有新資料可寫（保留前一日資料不動）
"""

from __future__ import annotations

import argparse
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from src import metrics  # noqa: E402
from src.groups import load_groups, resolve  # noqa: E402
from src.history import apply_history  # noqa: E402
from src.http import get  # noqa: E402
from src.output import existing_date, write_daily  # noqa: E402
from src.sources import tpex, twse  # noqa: E402

DATA_DIR = ROOT / "data"


def fetch_sources() -> tuple[list, list[dict], list[str]]:
    """抓兩個來源。任一失敗不中斷另一個，狀態記錄在 sources[] 中。"""
    quotes, status, dates = [], [], []

    for module, loader in ((twse, lambda r: r.text), (tpex, lambda r: r.json())):
        entry = {"name": module.NAME, "url": module.URL}
        try:
            resp = get(module.URL)
            date, parsed = module.parse(loader(resp))
            quotes.extend(parsed)
            dates.append(date)
            entry.update(status="ok", date=date, stock_count=len(parsed))
        except Exception as exc:  # noqa: BLE001 — 單一來源失敗不該讓整批掛掉
            entry.update(status="failed", error=str(exc), stock_count=0)
        status.append(entry)

    return quotes, status, dates


def main() -> int:
    parser = argparse.ArgumentParser(description="抓取台股當日行情並產生族群分析 JSON")
    parser.add_argument("--force", action="store_true", help="資料日期未更新時仍覆寫")
    parser.add_argument("--dry-run", action="store_true", help="只印摘要，不寫檔")
    args = parser.parse_args()

    quotes, sources, dates = fetch_sources()
    warnings: list[str] = []

    for source in sources:
        if source["status"] == "ok":
            print(f"[OK  ] {source['name']}: {source['stock_count']} 檔 @ {source['date']}")
        else:
            print(f"[FAIL] {source['name']}: {source['error']}")
            warnings.append(f"{source['name']}來源抓取失敗，本日資料不含該市場")

    if not quotes:
        print("\n兩個來源都抓不到資料，保留前一日 data/latest.json 不動。")
        return 1

    # 交易日一律以回傳內容的日期欄位為準，不用系統時鐘 ——
    # 這兩個端點都沒有日期參數，永遠只回「最近一個交易日」的快照。
    if len(set(dates)) > 1:
        warnings.append(f"兩市場資料日期不一致 {sorted(set(dates))}，以較舊者為準")
        print(f"\n！{warnings[-1]}")
    date = min(dates)

    previous = existing_date(DATA_DIR)
    if previous == date and not args.force:
        print(f"\n資料日期仍為 {date}（與現有 latest.json 相同）。")
        print("盤後資料尚未更新或今日非交易日，不覆寫既有資料。（--force 可強制覆寫）")
        return 2

    group_config = load_groups()
    resolved, missing = resolve(group_config, quotes)
    summary = metrics.market_summary(quotes)
    groups = metrics.build_group_table(resolved, summary["total_turnover"])
    apply_history(groups, DATA_DIR, date)

    payload = {
        "date": date,
        "generated_at": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
        "sources": sources,
        "warnings": warnings,
        "market": summary,
        "groups": groups,
        # 全量個股 —— 前端的搜尋與成交值排名都由這份算出來。
        # 用陣列式（無鍵名）存，因為 1963 檔若用完整 dict 會讓檔案暴增到
        # 419KB；陣列式只有約 120KB。沒有鍵名就沒人看得懂欄位順序，
        # 所以 schema 一起寫進資料裡。
        "stocks_schema": [
            "code", "name", "market", "close",
            "change", "pct", "volume_shares", "turnover",
        ],
        "stocks": metrics.compact_stocks(quotes),
        # 清單裡打錯的代號、已下市或當日完全無成交的個股都會出現在這裡，
        # 不會被靜靜忽略掉。
        "missing": missing,
    }

    print(f"\n資料日期 {date} — 個股 {summary['stock_count']} 檔，"
          f"總成交值 {summary['total_turnover'] / 1e8:,.0f} 億元")
    print(f"族群 {len(groups)} 個，領漲: "
          + ", ".join(f"{g['name']} {g['equal_weight_pct']:+.2f}%"
                      for g in groups[:3] if g["equal_weight_pct"] is not None))
    if missing:
        print(f"！成分股當日查無資料: {missing}")

    if args.dry_run:
        print("\n--dry-run：未寫入檔案。")
        return 0

    dated, latest = write_daily(payload, DATA_DIR)
    print(f"\n已寫入 {dated.relative_to(ROOT)} 與 {latest.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
