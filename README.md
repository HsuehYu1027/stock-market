# 台股每日族群分析

把當日台股行情按「概念族群」（被動元件、ABF 載板…）整理後呈現的單頁網站。
抓取與渲染完全分離：Python 抓資料產出 JSON，靜態頁只負責讀 JSON 渲染。
無登入、無後端、無 build step。

## 使用

```bash
pip install requests pyyaml

python3 scripts/fetch_daily.py      # 抓當日資料 → data/YYYY-MM-DD.json
python3 -m http.server 8000         # 於專案根目錄執行
# 瀏覽器開 http://localhost:8000/web/
```

`fetch_daily.py` 的結束代碼：

| 代碼 | 意義 |
|---|---|
| 0 | 成功產出當日資料 |
| 1 | 兩個來源都抓不到（保留前一日資料不動） |
| 2 | 盤後資料尚未更新／非交易日，沒有新資料可寫 |

其他旗標：`--force`（日期未更新時仍覆寫）、`--dry-run`（只印摘要不寫檔）。

## 維護族群清單

族群定義只在 `config/groups.yaml`，程式碼不寫死任何族群或成分股。
新增族群或成分股只要改這個檔案，不用動程式。

- 代號一律加引號，避免 YAML 把 `0050` 解析成數字 `50`
- 一檔可同時屬於多個族群（例如群聯同屬 IC 設計與記憶體）
- 打錯的代號、已下市或當日無成交的個股不會讓程式失敗，會列在輸出 JSON 的
  `missing` 並顯示在頁面底部，不會被靜靜忽略

隨附的是一份起始清單，請自行增補。

## 資料來源

| 用途 | 端點 |
|---|---|
| 上市個股日成交 | `https://www.twse.com.tw/exchangeReport/STOCK_DAY_ALL?response=open_data` |
| 上櫃股票收盤行情 | `https://www.tpex.org.tw/openapi/v1/tpex_mainboard_quotes` |
| 證交所 API 規格 | `https://openapi.twse.com.tw/v1/swagger.json` |
| 櫃買 API 規格 | `https://www.tpex.org.tw/openapi/swagger.json` |

`python3 scripts/probe_endpoints.py` 會實際打一次每個端點並印出欄位與樣本，
端點格式若被官方改動，這支腳本會第一個發現。它同時探測 Phase 2 的候選端點。

### 資料上的注意事項

- **日期是民國年**（`"1150828"`），兩個來源皆是。
- **兩個來源都沒有漲跌幅％，只有漲跌價差。** 漲跌幅由 `漲跌價差 ÷ (收盤 − 漲跌價差)`
  推算。除權息當日交易所的漲跌價差是對除息參考價計算，因此此式得到的正是
  慣例上的當日漲跌幅。
- **兩個端點都沒有日期參數**，永遠只回「最近一個交易日」的快照。
  因此交易日一律以回傳內容的日期欄位為準，不用系統時鐘推算。
- 兩邊都混入 ETF 與主動式基金，以四位數代號過濾為普通股。

## 族群表現的四個指標

刻意同時給四個，因為任何單一指標都會誤導：

| 指標 | 說明 |
|---|---|
| 等權平均 | 族群內每檔等重。一檔漲停的小型股就能把整個族群拉歪 |
| 成交值加權 | 幾乎等於最大權值股一檔的表現 |
| 中位數 | 最抗噪的「這個族群整體到底有沒有在動」 |
| 上漲家數比 | 參與廣度。10 檔漲 9 檔，和 1 檔暴衝拉出來的 +1.5%，意義完全不同 |

**指標彼此背離本身就是訊號**：加權遠高於中位數 ＝ 只有龍頭在漲；
等權為正但上漲家數比偏低 ＝ 少數幾檔撐盤。

另外計算每個族群當日成交值佔全市場比重，以及該比重與近五日均值的差（資金流向）。
五日均由 `data/` 底下既有的每日 JSON 逐日累積，**不做歷史回補**（逐檔回補要兩千次
請求，對官方站台不友善）。歷史不足五個交易日時該欄位為 `null`，頁面顯示
「累積中 (n/5 日)」而不是 0 —— 「還沒有資料」和「沒有變化」是兩件事。

因此 `data/` 底下的每日 JSON 要保留（也一併進版控），它就是歷史來源。

## 專案結構

```
config/groups.yaml          族群 → 成分股（唯一的族群定義來源）
scripts/probe_endpoints.py  端點探測，可獨立重跑
scripts/fetch_daily.py      主流程進入點
src/sources/twse.py         上市 CSV adapter
src/sources/tpex.py         上櫃 JSON adapter
src/normalize.py            兩來源 → 統一 Quote schema
src/groups.py               載入 groups.yaml、比對成分股
src/metrics.py              族群指標與排名計算
src/history.py              讀 data/*.json 當歷史，算五日均
src/output.py               寫 data/YYYY-MM-DD.json + latest.json
data/                       每日 JSON（同時是歷史來源）
web/                        靜態頁
```

JSON 中所有金額與比率都是原始數值，格式化（千分位、％、億元）全在前端做。
顏色沿用台股慣例紅漲綠跌，定義集中在 `web/style.css` 的 CSS 變數。

## 目前範圍

Phase 1（已完成）：上市上櫃日成交資料、族群分類、四種族群指標、成交值排名、靜態頁。

Phase 2（未實作）：三大法人買賣超、市場寬度、注意處置股標記。
`probe_endpoints.py` 已先探測這些端點，實測結果：
集中市場漲跌證券數與當日注意股可用；三大法人與處置股的端點尚未找到可用的官方位址，
實作前要先確認，不要憑印象拼網址。
