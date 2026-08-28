"""族群指標與市場排名計算。

族群表現刻意同時給四個指標，因為任何單一指標都會誤導：
  - 等權平均：族群內一檔漲停的小型股就能把整個族群拉歪
  - 成交值加權：幾乎等於最大權值股一檔的表現
  - 中位數：最抗噪的「這個族群整體到底有沒有在動」
  - 上漲家數比：10 檔中 9 檔上漲，和 1 檔暴衝拉出來的 +1.5%，意義完全不同
四個並列時，指標彼此背離本身就是有用的訊號（例如加權高但中位數為負
＝ 只有龍頭在漲）。
"""

from __future__ import annotations

from statistics import median

from .normalize import Quote

TOP_N_MOVERS = 3  # 族群內領漲／落後各取幾檔


def _rated(quotes: list[Quote]) -> list[Quote]:
    """只有算得出漲跌幅的個股能參與表現計算。"""
    return [q for q in quotes if q.pct is not None]


def group_metrics(name: str, quotes: list[Quote], market_turnover: int) -> dict:
    """單一族群的當日統計。成分股全部無資料時各指標為 None 而非 0。"""
    rated = _rated(quotes)
    turnover = sum(q.turnover for q in quotes)
    total_rated_turnover = sum(q.turnover for q in rated)

    equal_weight = sum(q.pct for q in rated) / len(rated) if rated else None

    # 加權時若成交值全為零則退化為等權，避免除以零
    if rated and total_rated_turnover > 0:
        value_weighted = (
            sum(q.pct * q.turnover for q in rated) / total_rated_turnover
        )
    else:
        value_weighted = equal_weight

    advancing = sum(1 for q in rated if q.pct > 0)
    declining = sum(1 for q in rated if q.pct < 0)
    unchanged = len(rated) - advancing - declining

    ranked = sorted(rated, key=lambda q: q.pct, reverse=True)
    return {
        "name": name,
        "constituent_count": len(quotes),
        "rated_count": len(rated),
        # —— 四個並列的表現指標 ——
        "equal_weight_pct": equal_weight,
        "value_weighted_pct": value_weighted,
        "median_pct": median(q.pct for q in rated) if rated else None,
        "advance_ratio": advancing / len(rated) if rated else None,
        # —— 市場寬度明細 ——
        "advancing": advancing,
        "declining": declining,
        "unchanged": unchanged,
        # —— 資金 ——
        "turnover": turnover,
        "turnover_share": turnover / market_turnover if market_turnover else None,
        # avg5 / delta 需要歷史，由 history.py 後續填入
        "turnover_share_avg5": None,
        "turnover_share_delta": None,
        "history_days": 0,
        # —— 明細 ——
        "leaders": [q.to_dict() for q in ranked[:TOP_N_MOVERS]],
        "laggards": [q.to_dict() for q in ranked[-TOP_N_MOVERS:][::-1]] if ranked else [],
        "constituents": [q.to_dict() for q in sorted(
            quotes, key=lambda q: q.turnover, reverse=True
        )],
    }


def build_group_table(
    resolved: dict[str, list[Quote]], market_turnover: int
) -> list[dict]:
    """所有族群的指標，預設以等權平均漲跌幅排序（前端可改排序依據）。"""
    table = [
        group_metrics(name, quotes, market_turnover)
        for name, quotes in resolved.items()
    ]
    table.sort(
        key=lambda g: (g["equal_weight_pct"] is None, -(g["equal_weight_pct"] or 0.0))
    )
    return table


def turnover_ranking(quotes: list[Quote], limit: int = 100) -> list[dict]:
    """成交值排名 — 依成交金額（非成交股數），上市上櫃合併，欄位標明市場別。"""
    ranked = sorted(quotes, key=lambda q: q.turnover, reverse=True)[:limit]
    rows = []
    for rank, quote in enumerate(ranked, start=1):
        row = quote.to_dict()
        row["rank"] = rank
        rows.append(row)
    return rows


def market_summary(quotes: list[Quote]) -> dict:
    rated = _rated(quotes)
    advancing = sum(1 for q in rated if q.pct > 0)
    declining = sum(1 for q in rated if q.pct < 0)
    return {
        "stock_count": len(quotes),
        "total_turnover": sum(q.turnover for q in quotes),
        "advancing": advancing,
        "declining": declining,
        "unchanged": len(rated) - advancing - declining,
    }
