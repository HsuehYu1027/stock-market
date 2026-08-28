/* 讀 data/<date>.json 渲染。所有格式化都在前端做，JSON 存的是原始數值。 */
'use strict';

var HISTORY_WINDOW = 5;
var MARKETS = ['上市', '上櫃'];          // stocks 陣列中的市場代碼 0/1
/* stocks 是無鍵名的陣列（見 JSON 的 stocks_schema），這裡給欄位取名字，
   免得整份檔案散落 s[5]、s[7] 這種看不懂的索引 */
var F = { CODE: 0, NAME: 1, MARKET: 2, CLOSE: 3, CHANGE: 4, PCT: 5, VOL: 6, TURNOVER: 7 };
var SVG_NS = 'http://www.w3.org/2000/svg';

/* 本機是從 repo 根目錄啟服務、走 /web/，資料在上一層；
   GitHub Pages 部署時 web/ 的內容已在站台根目錄，資料就在同層的 data/。 */
var DATA_DIR = location.pathname.indexOf('/web/') !== -1 ? '../data/' : 'data/';

var state = {
  data: null,
  groupSort: 'equal_weight_pct',
  rankingLimit: 50,
  market: 'all',      // 'all' | '0' | '1'
  query: '',
  groupOf: {},        // 代號 -> [族群名]，由 groups[].constituents 反查建立
  blockId: {},        // 族群名 -> 明細區塊的 DOM id（族群名含中文，用索引當 id 較安全）
  allExpanded: false
};

/* ---------- 格式化 ---------- */
function pct(v, digits) {
  if (v === null || v === undefined) return '—';
  return (v >= 0 ? '+' : '') + v.toFixed(digits === undefined ? 2 : digits) + '%';
}
function num(v, digits) {
  if (v === null || v === undefined) return '—';
  return v.toLocaleString('zh-TW', {
    minimumFractionDigits: digits || 0, maximumFractionDigits: digits || 0
  });
}
function oku(v) {                     // 元 → 億元
  if (v === null || v === undefined) return '—';
  return (v / 1e8).toFixed(1);
}
function tone(v) {                    // 紅漲綠跌
  if (v === null || v === undefined || v === 0) return 'flat';
  return v > 0 ? 'up' : 'down';
}
function td(text, cls) {
  var el = document.createElement('td');
  el.textContent = text;
  if (cls) el.className = cls;
  return el;
}
function el(tag, cls, text) {
  var n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

/* ---------- SVG 小工具 ---------- */
function svgEl(tag, attrs) {
  var n = document.createElementNS(SVG_NS, tag);
  for (var k in attrs) if (attrs[k] !== null) n.setAttribute(k, attrs[k]);
  return n;
}
function cssVar(name) {
  return getComputedStyle(document.body).getPropertyValue(name).trim();
}

var tip = null;
function showTip(html, ev) {
  if (!tip) tip = document.getElementById('tooltip');
  tip.innerHTML = html;
  tip.classList.add('on');
  var pad = 14;
  var x = ev.clientX + pad, y = ev.clientY + pad;
  var r = tip.getBoundingClientRect();
  if (x + r.width > window.innerWidth - 8) x = ev.clientX - r.width - pad;
  if (y + r.height > window.innerHeight - 8) y = ev.clientY - r.height - pad;
  tip.style.left = x + 'px';
  tip.style.top = y + 'px';
}
function hideTip() { if (tip) tip.classList.remove('on'); }

/* 讓一列同時吃 hover 與觸控，tooltip 內容由 builder 產生 */
function bindTip(node, builder) {
  node.addEventListener('mousemove', function (ev) { showTip(builder(), ev); });
  node.addEventListener('mouseleave', hideTip);
}

/* ============================================================================
   圖一 · 族群漲跌幅 —— 資料的工作是「極性」(在基準線上或下)，
   所以用零軸置中的分歧長條圖。長條是等權平均，細刻度是中位數，
   兩者的差距就是「族群內部分歧」的視覺化。
   ========================================================================= */
function renderPerfChart() {
  var host = document.getElementById('chart-perf');
  host.textContent = '';
  var rows = state.data.groups.filter(function (g) { return g.equal_weight_pct !== null; })
                             .slice()
                             .sort(function (a, b) { return b.equal_weight_pct - a.equal_weight_pct; });
  if (!rows.length) return;

  var W = 900, rowH = 30, padT = 22, padB = 8, labelW = 92, valueW = 58;
  var H = padT + rows.length * rowH + padB;
  var plotL = labelW, plotR = W - valueW;
  var plotW = plotR - plotL;

  // 對稱刻度，讓零軸真的在中間，正負長度才可以直接比較
  var maxAbs = 0;
  rows.forEach(function (g) {
    maxAbs = Math.max(maxAbs, Math.abs(g.equal_weight_pct), Math.abs(g.median_pct || 0));
  });
  maxAbs = Math.max(Math.ceil(maxAbs), 1);
  var x = function (v) { return plotL + plotW / 2 + (v / maxAbs) * (plotW / 2); };

  var svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img',
                           'aria-label': '各族群等權平均漲跌幅分歧長條圖' });

  // 細格線與刻度標籤（recessive）
  [-maxAbs, -maxAbs / 2, maxAbs / 2, maxAbs].forEach(function (v) {
    svg.appendChild(svgEl('line', { class: 'grid-line',
      x1: x(v), x2: x(v), y1: padT - 6, y2: H - padB }));
    var t = svgEl('text', { class: 'axis-label', x: x(v), y: padT - 10, 'text-anchor': 'middle' });
    t.textContent = (v > 0 ? '+' : '') + v.toFixed(0) + '%';
    svg.appendChild(t);
  });
  svg.appendChild(svgEl('line', { class: 'zero-line',
    x1: x(0), x2: x(0), y1: padT - 6, y2: H - padB }));

  var upC = cssVar('--up'), downC = cssVar('--down');

  rows.forEach(function (g, i) {
    var y = padT + i * rowH;
    var cy = y + rowH / 2;
    var grp = svgEl('g', { class: 'row' });

    grp.appendChild(svgEl('rect', { class: 'hit', x: 0, y: y, width: W, height: rowH }));

    var lbl = svgEl('text', { class: 'cat-label', x: labelW - 10, y: cy + 4, 'text-anchor': 'end' });
    lbl.textContent = g.name;
    grp.appendChild(lbl);

    // 4px 圓角資料端、錨定在零軸；細長條而非厚重色塊
    var v = g.equal_weight_pct;
    var x0 = Math.min(x(0), x(v)), w = Math.abs(x(v) - x(0));
    grp.appendChild(svgEl('rect', {
      x: x0, y: cy - 7, width: Math.max(w, 1.5), height: 14,
      rx: 4, fill: v >= 0 ? upC : downC
    }));

    // 中位數刻度：同一條軸上的第二個量，不另開座標軸
    if (g.median_pct !== null) {
      grp.appendChild(svgEl('line', { class: 'median-tick',
        x1: x(g.median_pct), x2: x(g.median_pct), y1: cy - 11, y2: cy + 11 }));
    }

    var val = svgEl('text', { class: 'bar-label', x: W - 6, y: cy + 4, 'text-anchor': 'end' });
    val.textContent = pct(v);
    grp.appendChild(val);

    grp.classList.add('jump');
    grp.addEventListener('click', function () { focusGroup(g.name); });
    bindTip(grp, function () {
      return '<b>' + g.name + '</b><br>等權平均 <b>' + pct(g.equal_weight_pct) + '</b>' +
             '<br><span style="opacity:.7">點一下看成分股</span>' +
             '<br>中位數 <b>' + pct(g.median_pct) + '</b>' +
             '<br>成交值加權 <b>' + pct(g.value_weighted_pct) + '</b>' +
             '<br>上漲 <b>' + g.advancing + '</b> / 下跌 <b>' + g.declining + '</b>';
    });
    svg.appendChild(grp);
  });
  host.appendChild(svg);
}

/* ============================================================================
   圖二 · 族群成交值佔比 —— 資料的工作是「量值比較」，用單一色相長條圖。
   所有長條同一個顏色：族群之間沒有順序關係，「越大越深」會把長度已經
   表達的資訊重複編碼在色相上（規範明列的反樣式）。
   ========================================================================= */
function renderShareChart() {
  var host = document.getElementById('chart-share');
  host.textContent = '';
  var rows = state.data.groups.filter(function (g) { return g.turnover_share !== null; })
                             .slice()
                             .sort(function (a, b) { return b.turnover_share - a.turnover_share; });
  if (!rows.length) return;

  var W = 900, rowH = 26, padT = 6, padB = 6, labelW = 92, valueW = 92;
  var H = padT + rows.length * rowH + padB;
  var plotL = labelW, plotW = W - valueW - labelW;
  var max = Math.max.apply(null, rows.map(function (g) { return g.turnover_share; }));

  var svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img',
                           'aria-label': '各族群成交值佔全市場比重長條圖' });
  var barC = cssVar('--neutral-bar');

  rows.forEach(function (g, i) {
    var y = padT + i * rowH, cy = y + rowH / 2;
    var grp = svgEl('g', { class: 'row' });
    grp.appendChild(svgEl('rect', { class: 'hit', x: 0, y: y, width: W, height: rowH }));

    var lbl = svgEl('text', { class: 'cat-label', x: labelW - 10, y: cy + 4, 'text-anchor': 'end' });
    lbl.textContent = g.name;
    grp.appendChild(lbl);

    grp.appendChild(svgEl('rect', {
      x: plotL, y: cy - 6, width: Math.max((g.turnover_share / max) * plotW, 1.5),
      height: 12, rx: 4, fill: barC
    }));

    var val = svgEl('text', { class: 'bar-label', x: W - 6, y: cy + 4, 'text-anchor': 'end' });
    val.textContent = (g.turnover_share * 100).toFixed(2) + '%';
    grp.appendChild(val);

    bindTip(grp, function () {
      var d = g.turnover_share_delta;
      return '<b>' + g.name + '</b><br>成交值 <b>' + oku(g.turnover) + '</b> 億' +
             '<br>市場佔比 <b>' + (g.turnover_share * 100).toFixed(2) + '%</b>' +
             '<br>vs 5日均 ' + (d === null || d === undefined
               ? '<b>累積中 (' + g.history_days + '/' + HISTORY_WINDOW + ' 日)</b>'
               : '<b>' + pct(d * 100) + '</b>');
    });
    svg.appendChild(grp);
  });
  host.appendChild(svg);
}

/* ---------- 族群表現排名 ---------- */
function renderGroups() {
  var tbody = document.querySelector('#group-table tbody');
  tbody.textContent = '';
  var key = state.groupSort;
  var rows = state.data.groups.slice().sort(function (a, b) {
    var x = a[key], y = b[key];
    if (x === null || x === undefined) return 1;
    if (y === null || y === undefined) return -1;
    return y - x;
  });

  rows.forEach(function (g, i) {
    var tr = document.createElement('tr');
    tr.appendChild(td(String(i + 1), 'col-rank'));

    var nameCell = td(g.name, 'col-name jump');
    nameCell.title = '跳到「' + g.name + '」成分股明細';
    nameCell.addEventListener('click', function () { focusGroup(g.name); });
    var sub = el('span', 'sub', g.rated_count + ' 檔 · 漲 ' + g.advancing + ' 跌 ' + g.declining);
    nameCell.appendChild(sub);
    tr.appendChild(nameCell);

    ['equal_weight_pct', 'value_weighted_pct', 'median_pct'].forEach(function (k) {
      tr.appendChild(td(pct(g[k]), 'num ' + tone(g[k])));
    });
    tr.appendChild(td(
      g.advance_ratio === null ? '—' : Math.round(g.advance_ratio * 100) + '%', 'num'));
    tr.appendChild(td(oku(g.turnover), 'num opt'));

    var shareCell = el('td', 'num',
      g.turnover_share === null ? '—' : (g.turnover_share * 100).toFixed(2) + '%');
    var delta = el('span');
    if (g.turnover_share_delta === null || g.turnover_share_delta === undefined) {
      delta.className = 'sub pending';
      delta.textContent = '累積中 (' + g.history_days + '/' + HISTORY_WINDOW + ' 日)';
    } else {
      delta.className = 'sub ' + tone(g.turnover_share_delta);
      delta.textContent = pct(g.turnover_share_delta * 100);
    }
    shareCell.appendChild(delta);
    tr.appendChild(shareCell);
    tbody.appendChild(tr);
  });

  document.querySelectorAll('#group-table .sortable').forEach(function (th) {
    th.classList.toggle('active', th.dataset.sort === key);
  });
}

/* ---------- 成交值排名（含市場篩選） ----------
   由全量 stocks 算，而不是預先算好的前 100 名 —— 否則切到「只看上櫃」時
   得到的會是「全市場前 100 名之中的上櫃股」，而不是「上櫃前 100 名」。 */
function filteredStocks() {
  var wanted = state.market === 'all' ? null : Number(state.market);
  return state.data.stocks.filter(function (s) {
    return wanted === null || s[F.MARKET] === wanted;
  });
}

var RANK_CAP = 100;

function renderRanking() {
  var tbody = document.querySelector('#ranking-table tbody');
  tbody.textContent = '';
  var rows = filteredStocks();               // stocks 已依成交值排序
  var shown = Math.min(state.rankingLimit, RANK_CAP, rows.length);

  rows.slice(0, shown).forEach(function (s, i) {
    var tr = document.createElement('tr');
    tr.appendChild(td(String(i + 1), 'col-rank'));
    tr.appendChild(td(s[F.CODE]));
    tr.appendChild(td(s[F.NAME], 'col-name'));
    tr.appendChild(td(MARKETS[s[F.MARKET]] || '—', 'opt'));
    tr.appendChild(td(num(s[F.CLOSE], 2), 'num'));
    tr.appendChild(td((s[F.CHANGE] >= 0 ? '+' : '') + s[F.CHANGE].toFixed(2),
                      'num opt ' + tone(s[F.CHANGE])));
    tr.appendChild(td(pct(s[F.PCT]), 'num ' + tone(s[F.PCT])));
    tr.appendChild(td(oku(s[F.TURNOVER]), 'num'));
    tr.appendChild(td(num(Math.round(s[F.VOL] / 1000)), 'num opt'));
    tbody.appendChild(tr);
  });

  var total = Math.min(RANK_CAP, rows.length);
  var btn = document.getElementById('show-more');
  if (shown >= total) btn.classList.add('hidden');
  else {
    btn.classList.remove('hidden');
    btn.textContent = '顯示前 ' + total + ' 名';
  }
}

/* ---------- 搜尋 ---------- */
function buildGroupIndex() {
  var map = {};
  state.data.groups.forEach(function (g) {
    g.constituents.forEach(function (q) {
      (map[q.code] = map[q.code] || []).push(g.name);
    });
  });
  state.groupOf = map;
}

function renderSearch() {
  var panel = document.getElementById('search-panel');
  var q = state.query.trim().toLowerCase();
  if (!q) { panel.classList.add('hidden'); return; }
  panel.classList.remove('hidden');

  var wanted = state.market === 'all' ? null : Number(state.market);
  // stocks 已依成交值排序，所以結果自然是大的在前
  var hits = state.data.stocks.filter(function (s) {
    if (wanted !== null && s[F.MARKET] !== wanted) return false;
    return s[F.CODE].indexOf(q) === 0 || s[F.NAME].toLowerCase().indexOf(q) !== -1;
  }).slice(0, 60);

  var tbody = document.querySelector('#search-table tbody');
  tbody.textContent = '';
  hits.forEach(function (s) {
    var tr = document.createElement('tr');
    tr.appendChild(td(s[F.CODE]));
    tr.appendChild(td(s[F.NAME], 'col-name'));
    tr.appendChild(td(MARKETS[s[F.MARKET]] || '—'));
    tr.appendChild(td(num(s[F.CLOSE], 2), 'num'));
    tr.appendChild(td(pct(s[F.PCT]), 'num ' + tone(s[F.PCT])));
    tr.appendChild(td(oku(s[F.TURNOVER]), 'num'));
    var groups = state.groupOf[s[F.CODE]];
    tr.appendChild(td(groups ? groups.join('、') : '—', groups ? 'tags' : 'flat'));
    tbody.appendChild(tr);
  });

  document.getElementById('search-count').textContent =
    hits.length ? '（' + hits.length + ' 檔' + (hits.length === 60 ? '，僅顯示前 60' : '') + '）' : '';
  document.getElementById('search-empty').classList.toggle('hidden', hits.length > 0);
  document.getElementById('search-clear').classList.toggle('hidden', !state.query);
}

/* ---------- 從別處跳到某個族群的明細 ---------- */
function focusGroup(name) {
  var block = document.getElementById(state.blockId[name]);
  if (!block) return;
  // 明細面板本身若是收合的，先展開，否則捲過去會什麼都看不到
  var panel = block.closest('.panel');
  if (panel) panel.classList.remove('collapsed');
  block.classList.remove('collapsed');
  // 表頭是 sticky 且高度隨寬度變化很大（桌機 54px、390px 時 138px，因為市場摘要
  // 會換行），固定的 scroll-margin 蓋不住，所以在捲動前讀當下的實際高度。
  var bar = document.querySelector('.topbar');
  document.documentElement.style.setProperty(
    '--topbar-h', (bar ? bar.offsetHeight : 56) + 'px');
  block.scrollIntoView({ behavior: 'smooth', block: 'start' });
  block.classList.remove('flash');
  void block.offsetWidth;                    // 重觸發動畫（連點同一個族群時）
  block.classList.add('flash');
  setTimeout(function () { block.classList.remove('flash'); }, 1500);
}

/* ---------- 族群成分股明細 ---------- */
function moverLine(label, list) {
  var div = el('div');
  div.appendChild(el('span', null, label + '：'));
  list.forEach(function (q, i) {
    div.appendChild(el('span', tone(q.pct), (i ? '  ' : '') + q.name + ' ' + pct(q.pct)));
  });
  return div;
}

function renderDetail() {
  var host = document.getElementById('detail');
  host.textContent = '';

  state.blockId = {};
  state.data.groups.forEach(function (g, i) {
    var block = el('div', 'group-block' + (state.allExpanded ? '' : ' collapsed'));
    block.id = 'g-' + i;
    state.blockId[g.name] = block.id;

    var title = el('div', 'group-title');
    title.appendChild(el('span', 'caret'));
    title.appendChild(el('span', 'nm', g.name));
    title.appendChild(el('span', tone(g.equal_weight_pct), pct(g.equal_weight_pct)));
    title.appendChild(el('span', 'cnt',
      g.constituent_count + ' 檔 · 成交值 ' + oku(g.turnover) + ' 億'));
    title.addEventListener('click', function () { block.classList.toggle('collapsed'); });

    var detail = el('div', 'group-detail');
    var movers = el('div', 'movers');
    if (g.leaders.length) movers.appendChild(moverLine('領漲前三', g.leaders));
    if (g.laggards.length) movers.appendChild(moverLine('落後前三', g.laggards));
    detail.appendChild(movers);

    var scroll = el('div', 'table-scroll');
    var table = document.createElement('table');
    var thead = document.createElement('thead');
    var hr = document.createElement('tr');
    ['代號', '名稱', '市場', '收盤', '漲跌', '漲跌幅', '成交值(億)'].forEach(function (h, i) {
      var th = document.createElement('th');
      th.textContent = h;
      th.className = (i >= 3 ? 'num' : '') + (h === '市場' || h === '漲跌' ? ' opt' : '');
      hr.appendChild(th);
    });
    thead.appendChild(hr);
    table.appendChild(thead);

    var tb = document.createElement('tbody');
    var wanted = state.market === 'all' ? null : MARKETS[Number(state.market)];
    g.constituents.filter(function (q) { return !wanted || q.market === wanted; })
      .forEach(function (q) {
        var tr = document.createElement('tr');
        tr.appendChild(td(q.code));
        tr.appendChild(td(q.name, 'col-name'));
        tr.appendChild(td(q.market, 'opt'));
        tr.appendChild(td(num(q.close, 2), 'num'));
        tr.appendChild(td((q.change >= 0 ? '+' : '') + q.change.toFixed(2), 'num opt ' + tone(q.change)));
        tr.appendChild(td(pct(q.pct), 'num ' + tone(q.pct)));
        tr.appendChild(td(oku(q.turnover), 'num'));
        tb.appendChild(tr);
      });
    table.appendChild(tb);
    scroll.appendChild(table);
    detail.appendChild(scroll);

    block.append(title, detail);
    host.appendChild(block);
  });
}

/* ---------- 表頭與警示 ---------- */
function renderHeader() {
  var d = state.data;
  document.getElementById('fetched-at').textContent =
    d.generated_at ? '抓取於 ' + d.generated_at.replace('T', ' ').slice(0, 16) : '';

  // 資料日期不是今天就明確標示，避免把舊資料當今日盤看
  var t = new Date();
  var iso = t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') +
            '-' + String(t.getDate()).padStart(2, '0');
  var flag = document.getElementById('stale-flag');
  flag.textContent = '非今日資料';
  flag.classList.toggle('hidden', d.date === iso);

  var m = d.market;
  var host = document.getElementById('market-summary');
  host.textContent = '';
  [['全市場 ', m.stock_count, ' 檔', ''],
   ['成交值 ', Math.round(m.total_turnover / 1e8), ' 億', ''],
   ['漲 ', m.advancing, '', 'up'],
   ['跌 ', m.declining, '', 'down'],
   ['平 ', m.unchanged, '', '']].forEach(function (p) {
    var s = el('span', p[3] || null);
    s.appendChild(document.createTextNode(p[0]));
    s.appendChild(el('b', p[3] || null, num(p[1])));
    if (p[2]) s.appendChild(document.createTextNode(p[2]));
    host.appendChild(s);
  });

  var msgs = (d.warnings || []).slice();
  (d.sources || []).forEach(function (s) {
    if (s.status !== 'ok') msgs.push(s.name + ' 來源抓取失敗：' + s.error);
  });
  var warnBox = document.getElementById('warnings');
  warnBox.textContent = msgs.length ? '⚠ ' + msgs.join('　|　') : '';
  warnBox.classList.toggle('hidden', !msgs.length);

  var missing = d.missing || {};
  var names = Object.keys(missing);
  var mHost = document.getElementById('missing');
  mHost.textContent = '';
  names.forEach(function (g) {
    var p = el('div', 'grp');
    p.appendChild(el('b', null, g + '：'));
    p.appendChild(document.createTextNode(missing[g].join('、')));
    mHost.appendChild(p);
  });
  document.getElementById('missing-panel').classList.toggle('hidden', !names.length);
}

/* ---------- 整頁重繪 ---------- */
function renderAll() {
  renderHeader();
  buildGroupIndex();
  renderPerfChart();
  renderShareChart();
  renderGroups();
  renderRanking();
  renderDetail();
  renderSearch();
}

/* ---------- 載入 ---------- */
function loadDate(date) {
  return fetch(DATA_DIR + date + '.json', { cache: 'no-store' })
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function (data) {
      state.data = data;
      state.rankingLimit = 50;
      renderAll();
    });
}

function fillDateSelect(dates, current) {
  var sel = document.getElementById('date-select');
  sel.textContent = '';
  dates.forEach(function (d) {
    var o = document.createElement('option');
    o.value = d; o.textContent = d;
    if (d === current) o.selected = true;
    sel.appendChild(o);
  });
  // 只有一天資料時下拉沒有選擇的意義，但仍顯示日期
  sel.disabled = dates.length < 2;
}

/* ---------- 互動 ---------- */
function wire() {
  document.querySelectorAll('.panel-head[data-toggle]').forEach(function (head) {
    head.addEventListener('click', function () {
      head.closest('.panel').classList.toggle('collapsed');
    });
  });
  document.querySelectorAll('#group-table .sortable').forEach(function (th) {
    th.addEventListener('click', function () {
      state.groupSort = th.dataset.sort;
      renderGroups();
    });
  });
  document.getElementById('show-more').addEventListener('click', function () {
    state.rankingLimit = Infinity;
    renderRanking();
  });

  var search = document.getElementById('search');
  search.addEventListener('input', function () {
    state.query = search.value;
    renderSearch();
  });
  document.getElementById('search-clear').addEventListener('click', function () {
    search.value = ''; state.query = ''; renderSearch(); search.focus();
  });

  document.querySelectorAll('.seg-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.seg-btn').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      state.market = btn.dataset.market;
      state.rankingLimit = 50;
      renderRanking();
      renderDetail();
      renderSearch();
    });
  });

  document.getElementById('toggle-all').addEventListener('click', function () {
    state.allExpanded = !state.allExpanded;
    this.textContent = state.allExpanded ? '全部收合' : '全部展開';
    renderDetail();
  });

  document.getElementById('date-select').addEventListener('change', function () {
    loadDate(this.value).catch(function (err) { fail(err); });
  });

  // 深色/淺色切換時 SVG 用的顏色是 JS 讀進去的，要重畫
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
      if (state.data) { renderPerfChart(); renderShareChart(); }
    });
  }
}

function fail(err) {
  var box = document.getElementById('error');
  box.textContent = '讀取資料失敗：' + err.message +
    '。請先執行 python3 scripts/fetch_daily.py 產生資料，並以 HTTP server 開啟本頁（不要用 file://）。';
  box.classList.remove('hidden');
}

/* ---------- 進入點 ---------- */
fetch(DATA_DIR + 'index.json', { cache: 'no-store' })
  .then(function (r) { return r.ok ? r.json() : { dates: [] }; })
  .catch(function () { return { dates: [] }; })
  .then(function (idx) {
    var dates = (idx && idx.dates) || [];
    return loadDate(dates.length ? dates[0] : 'latest').then(function () {
      fillDateSelect(dates.length ? dates : [state.data.date], state.data.date);
      wire();
      document.getElementById('content').hidden = false;
    });
  })
  .catch(fail);
