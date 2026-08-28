#!/usr/bin/env python3
"""端點探測 —— 實際打一次每個端點，印出狀態、筆數、欄位名與前幾筆。

任何端點的回傳格式若被官方改動，這支腳本會第一個發現。
可獨立重跑，不會寫入任何檔案。

用法: python3 scripts/probe_endpoints.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.http import get  # noqa: E402
from src.sources import tpex, twse  # noqa: E402

SAMPLE_ROWS = 3

# Phase 2 需要、但尚未確認可用的端點。
# 這裡只做連通性探測，不解析內容 —— 確認過再實作，不要憑印象拼網址。
PHASE2_CANDIDATES = [
    ("三大法人買賣超（上市）", "https://openapi.twse.com.tw/v1/fund/T86"),
    ("三大法人買賣超（上櫃）", "https://www.tpex.org.tw/openapi/v1/tpex_3insti_daily_trading"),
    ("集中市場漲跌證券數", "https://openapi.twse.com.tw/v1/opendata/twtazu_od"),
    ("當日注意股（上市）", "https://openapi.twse.com.tw/v1/announcement/notice"),
    ("處置股（上市）", "https://openapi.twse.com.tw/v1/announcement/punish"),
]


def _show(label: str, url: str, rows: list[dict]) -> None:
    print(f"\n--- {label} ---")
    print(f"URL   : {url}")
    print(f"筆數  : {len(rows)}")
    if not rows:
        print("！回傳空資料")
        return
    print(f"欄位  : {list(rows[0].keys())}")
    for row in rows[:SAMPLE_ROWS]:
        print("       ", json.dumps(row, ensure_ascii=False)[:180])


def probe_phase1() -> int:
    failures = 0

    print("=" * 72)
    print("Phase 1 端點（本專案實際使用）")
    print("=" * 72)

    try:
        text = get(twse.URL).text
        import csv
        import io

        _show("上市 個股日成交資訊 (CSV)", twse.URL, list(csv.DictReader(io.StringIO(text))))
        date, quotes = twse.parse(text)
        print(f"解析後: 資料日期 {date}，普通股 {len(quotes)} 檔")
        print(f"        範例 {quotes[0].code} {quotes[0].name} 收 {quotes[0].close} "
              f"漲跌幅 {quotes[0].pct:.2f}%")
    except Exception as exc:  # noqa: BLE001 — 探測腳本要看到所有失敗
        failures += 1
        print(f"\n！上市來源失敗: {exc}")

    try:
        payload = get(tpex.URL).json()
        _show("上櫃 股票收盤行情 (JSON)", tpex.URL, payload)
        date, quotes = tpex.parse(payload)
        print(f"解析後: 資料日期 {date}，普通股 {len(quotes)} 檔")
        print(f"        範例 {quotes[0].code} {quotes[0].name} 收 {quotes[0].close} "
              f"漲跌幅 {quotes[0].pct:.2f}%")
    except Exception as exc:  # noqa: BLE001
        failures += 1
        print(f"\n！上櫃來源失敗: {exc}")

    return failures


def probe_phase2() -> None:
    print("\n" + "=" * 72)
    print("Phase 2 候選端點（僅連通性探測，尚未實作）")
    print("=" * 72)
    for label, url in PHASE2_CANDIDATES:
        try:
            resp = get(url, retries=1)
            body = resp.json()
            count = len(body) if isinstance(body, list) else "—"
            keys = list(body[0].keys())[:8] if isinstance(body, list) and body else "—"
            print(f"  [OK  ] {label}\n         {url}\n         筆數 {count} 欄位 {keys}")
        except Exception as exc:  # noqa: BLE001
            print(f"  [FAIL] {label}\n         {url}\n         {exc}")


def main() -> int:
    failures = probe_phase1()
    probe_phase2()
    print("\n完成。" + ("" if not failures else f" Phase 1 有 {failures} 個來源失敗。"))
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
