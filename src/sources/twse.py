"""上市（臺灣證券交易所）個股日成交資訊。

來源: https://www.twse.com.tw/exchangeReport/STOCK_DAY_ALL?response=open_data
格式: CSV (utf-8-sig)，欄位:
    日期,證券代號,證券名稱,成交股數,成交金額,開盤價,最高價,最低價,收盤價,漲跌價差,成交筆數
於 2026-08-28 實測: HTTP 200，1377 列，其中四位數普通股 1093 檔。
注意: 此端點不接受日期參數，永遠只回「最近一個交易日」的快照，
      交易日必須以回傳內容的「日期」欄位為準，不可用系統時鐘推算。
"""

from __future__ import annotations

import csv
import io

from ..normalize import Quote, compute_pct, is_common_stock, parse_number, roc_to_iso

REQUIRED_COLUMNS = {"日期", "證券代號", "證券名稱", "成交股數", "成交金額", "收盤價", "漲跌價差"}

NAME = "上市"
URL = "https://www.twse.com.tw/exchangeReport/STOCK_DAY_ALL?response=open_data"


def parse(text: str) -> tuple[str, list[Quote]]:
    """回傳 (資料日期 ISO, 個股報價清單)。"""
    rows = list(csv.DictReader(io.StringIO(text)))
    if not rows:
        raise ValueError("上市來源回傳空資料")

    # 證交所對未知路徑會回 HTTP 200 加一頁 HTML，CSV 解析不會報錯只會得到垃圾，
    # 所以這裡明確檢查欄位，讓失敗訊息看得懂。
    missing = REQUIRED_COLUMNS - set(rows[0])
    if missing:
        raise ValueError(f"上市來源欄位與預期不符，缺少 {sorted(missing)}（端點格式可能已變更）")

    date = roc_to_iso(rows[0]["日期"])
    quotes: list[Quote] = []
    for row in rows:
        code = (row.get("證券代號") or "").strip()
        if not is_common_stock(code):
            continue
        volume = parse_number(row.get("成交股數"), cast=int)
        if not volume:  # 當日無成交（停牌）→ 不列入計算
            continue
        close = parse_number(row.get("收盤價"))
        change = parse_number(row.get("漲跌價差"))
        if close is None:
            continue
        quotes.append(
            Quote(
                code=code,
                name=(row.get("證券名稱") or "").strip(),
                market=NAME,
                close=close,
                change=change if change is not None else 0.0,
                pct=compute_pct(close, change),
                open=parse_number(row.get("開盤價")),
                high=parse_number(row.get("最高價")),
                low=parse_number(row.get("最低價")),
                volume_shares=volume,
                turnover=parse_number(row.get("成交金額"), cast=int) or 0,
                trades=parse_number(row.get("成交筆數"), cast=int),
            )
        )
    return date, quotes
