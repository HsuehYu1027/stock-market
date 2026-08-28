"""上櫃（證券櫃檯買賣中心）股票收盤行情。

來源: https://www.tpex.org.tw/openapi/v1/tpex_mainboard_quotes
規格: https://www.tpex.org.tw/openapi/swagger.json  (端點名稱「上櫃股票收盤行情」)
格式: JSON 陣列，欄位 Date / SecuritiesCompanyCode / CompanyName / Close /
      Change / Open / High / Low / TradingShares / TransactionAmount / ...
於 2026-08-28 實測: HTTP 200，1013 列，其中四位數普通股 887 檔。

為何不用 tpex_mainboard_daily_close_quotes: 該端點 10657 列、體積大 12 倍，
但四位數普通股同樣是 887 檔，多出來的都是權證，對本專案沒有用處。

注意: Change 欄位是帶正負號的字串（"+0.02"），且同樣沒有漲跌幅％。
"""

from __future__ import annotations

from ..normalize import Quote, compute_pct, is_common_stock, parse_number, roc_to_iso

REQUIRED_KEYS = {
    "Date", "SecuritiesCompanyCode", "CompanyName",
    "Close", "Change", "TradingShares", "TransactionAmount",
}

NAME = "上櫃"
URL = "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_quotes"


def parse(payload: list[dict]) -> tuple[str, list[Quote]]:
    """回傳 (資料日期 ISO, 個股報價清單)。"""
    if not payload:
        raise ValueError("上櫃來源回傳空資料")

    # 同上：格式若被官方改動，要在這裡就報出看得懂的訊息。
    missing = REQUIRED_KEYS - set(payload[0])
    if missing:
        raise ValueError(f"上櫃來源欄位與預期不符，缺少 {sorted(missing)}（端點格式可能已變更）")

    date = roc_to_iso(payload[0]["Date"])
    quotes: list[Quote] = []
    for row in payload:
        code = (row.get("SecuritiesCompanyCode") or "").strip()
        if not is_common_stock(code):
            continue
        volume = parse_number(row.get("TradingShares"), cast=int)
        if not volume:
            continue
        close = parse_number(row.get("Close"))
        change = parse_number(row.get("Change"))
        if close is None:
            continue
        quotes.append(
            Quote(
                code=code,
                name=(row.get("CompanyName") or "").strip(),
                market=NAME,
                close=close,
                change=change if change is not None else 0.0,
                pct=compute_pct(close, change),
                open=parse_number(row.get("Open")),
                high=parse_number(row.get("High")),
                low=parse_number(row.get("Low")),
                volume_shares=volume,
                turnover=parse_number(row.get("TransactionAmount"), cast=int) or 0,
                trades=parse_number(row.get("TransactionNumber"), cast=int),
            )
        )
    return date, quotes
