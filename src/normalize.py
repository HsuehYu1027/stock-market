"""兩個交易所來源格式差異極大，統一收斂到同一組欄位再往下算。"""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass

# 普通股代號為四位數字。兩個來源的檔案都混入 ETF 與主動式基金
# (00400A、00878...)，以此過濾。
COMMON_STOCK_RE = re.compile(r"^\d{4}$")


@dataclass
class Quote:
    code: str
    name: str
    market: str  # "上市" | "上櫃"
    close: float
    change: float  # 漲跌價差（元）
    pct: float | None  # 漲跌幅（%），無法推算時為 None
    open: float | None
    high: float | None
    low: float | None
    volume_shares: int  # 成交股數
    turnover: int  # 成交金額（元）— 排名依據
    trades: int | None  # 成交筆數

    def to_dict(self) -> dict:
        return asdict(self)


def roc_to_iso(roc: str) -> str:
    """民國年日期字串轉西元 ISO。兩個來源都回 '1150828' 這種格式。"""
    roc = roc.strip().replace("/", "")
    if not re.fullmatch(r"\d{7}", roc):
        raise ValueError(f"無法解析的民國年日期: {roc!r}")
    return f"{int(roc[:3]) + 1911:04d}-{roc[3:5]}-{roc[5:7]}"


def parse_number(raw, *, cast=float):
    """行情數字可能是 '+0.02'、'1,234'、'--'、'' 或 None。無法解析時回 None。"""
    if raw is None:
        return None
    text = str(raw).strip().replace(",", "").replace("+", "")
    if text in ("", "--", "---", "X", "N/A"):
        return None
    try:
        return cast(float(text))
    except (TypeError, ValueError):
        return None


def compute_pct(close: float | None, change: float | None) -> float | None:
    """兩個來源都只給漲跌價差、沒有漲跌幅，必須自己還原。

    前一日收盤 = 收盤 - 漲跌價差。除權息當日交易所的漲跌價差是對「除息參考價」
    計算的，因此這個式子得到的正是市場慣例上的當日漲跌幅，不需另外調整。
    """
    if close is None or change is None:
        return None
    prev = close - change
    if prev <= 0:  # 防除以零／異常價格
        return None
    return change / prev * 100.0


def is_common_stock(code: str) -> bool:
    return bool(COMMON_STOCK_RE.match(code.strip()))
