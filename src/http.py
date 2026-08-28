"""共用的 HTTP 抓取，含重試。所有對外請求都走這裡。"""

from __future__ import annotations

import time

import requests

USER_AGENT = "tw-stock-group-dashboard/1.0 (personal use)"
TIMEOUT = 60


def get(url: str, *, retries: int = 3, backoff: float = 2.0) -> requests.Response:
    """GET 並在網路錯誤時退避重試。最後一次仍失敗就往外拋。"""
    last: Exception | None = None
    for attempt in range(retries):
        try:
            resp = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=TIMEOUT)
            resp.raise_for_status()
            return resp
        except requests.RequestException as exc:
            last = exc
            if attempt < retries - 1:
                time.sleep(backoff * (2**attempt))
    raise RuntimeError(f"抓取失敗 {url}: {last}") from last
