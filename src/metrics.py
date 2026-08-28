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


# 市場別在 compact_stocks 中以整數編碼，省掉 1963 次重複的字串
MARKET_CODES = {"上市": 0, "上櫃": 1}


def compact_stocks(quotes: list[Quote]) -> list[list]:
    """全量個股的精簡表示，欄位順序見輸出 JSON 的 stocks_schema。

    這是前端搜尋「與」成交值排名的唯一資料來源。之所以不另外輸出一份
    前 100 名清單：那樣在切到「只看上櫃」時，前端只能從全市場前 100 名裡
    篩，得到的是「前 100 名之中的上櫃股」而不是「上櫃前 100 名」。
    由全量資料在前端排序才會是正確的排名，也少存一份重複資料。

    不含開高低與成交筆數（頁面沒有用到）。已依成交值排序。
    """
    return [
        [
            q.code,
            q.name,
            MARKET_CODES.get(q.market, -1),
            round(q.close, 2),
            round(q.change, 2),
            round(q.pct, 2) if q.pct is not None else None,
            q.volume_shares,
            q.turnover,
        ]
        for q in sorted(quotes, key=lambda q: q.turnover, reverse=True)
    ]
