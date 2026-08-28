/* 讀 data/latest.json 渲染。所有格式化都在前端做，JSON 存的是原始數值。 */
'use strict';

var HISTORY_WINDOW = 5;
var state = { data: null, groupSort: 'equal_weight_pct', rankingLimit: 50 };

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
function oku(v) { // 元 → 億元
  if (v === null || v === undefined) return '—';
  return (v / 1e8).toFixed(1);
}
/* 紅漲綠跌 */
function tone(v) {
  if (v === null || v === undefined || v === 0) return 'flat';
  return v > 0 ? 'up' : 'down';
}
function td(text, cls) {
  var el = document.createElement('td');
  el.textContent = text;
  if (cls) el.className = cls;
  return el;
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

    var nameCell = td('', 'col-name');
    nameCell.textContent = g.name;
    var sub = document.createElement('span');
    sub.className = 'sub';
    sub.textContent = g.rated_count + ' 檔 · 漲 ' + g.advancing + ' 跌 ' + g.declining;
    nameCell.appendChild(sub);
    tr.appendChild(nameCell);

    ['equal_weight_pct', 'value_weighted_pct', 'median_pct'].forEach(function (k) {
      tr.appendChild(td(pct(g[k]), 'num ' + tone(g[k])));
    });

    tr.appendChild(td(
      g.advance_ratio === null ? '—' : Math.round(g.advance_ratio * 100) + '%',
      'num'
    ));
    tr.appendChild(td(oku(g.turnover), 'num'));

    // 市場佔比 + 與五日均的差；歷史不足時明確標示「累積中」而不是顯示 0
    var shareCell = document.createElement('td');
    shareCell.className = 'num';
    shareCell.textContent = g.turnover_share === null
      ? '—' : (g.turnover_share * 100).toFixed(2) + '%';
    var delta = document.createElement('span');
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

/* ---------- 成交值排名 ---------- */
function renderRanking() {
  var tbody = document.querySelector('#ranking-table tbody');
  tbody.textContent = '';
  state.data.turnover_ranking.slice(0, state.rankingLimit).forEach(function (r) {
    var tr = document.createElement('tr');
    tr.appendChild(td(String(r.rank), 'col-rank'));
    tr.appendChild(td(r.code));
    tr.appendChild(td(r.name, 'col-name'));
    tr.appendChild(td(r.market));
    tr.appendChild(td(num(r.close, 2), 'num'));
    tr.appendChild(td((r.change >= 0 ? '+' : '') + r.change.toFixed(2), 'num ' + tone(r.change)));
    tr.appendChild(td(pct(r.pct), 'num ' + tone(r.pct)));
    tr.appendChild(td(oku(r.turnover), 'num'));
    tr.appendChild(td(num(Math.round(r.volume_shares / 1000)), 'num'));
    tbody.appendChild(tr);
  });

  var btn = document.getElementById('show-more');
  var total = state.data.turnover_ranking.length;
  if (state.rankingLimit >= total) {
    btn.classList.add('hidden');
  } else {
    btn.classList.remove('hidden');
    btn.textContent = '顯示前 ' + total + ' 名';
  }
}

/* ---------- 族群成分股明細 ---------- */
function moverLine(label, list) {
  var div = document.createElement('div');
  var tag = document.createElement('span');
  tag.textContent = label + '：';
  div.appendChild(tag);
  list.forEach(function (q, i) {
    var s = document.createElement('span');
    s.className = tone(q.pct);
    s.textContent = (i ? '  ' : '') + q.name + ' ' + pct(q.pct);
    div.appendChild(s);
  });
  return div;
}

function renderDetail() {
  var host = document.getElementById('detail');
  host.textContent = '';

  state.data.groups.forEach(function (g) {
    var block = document.createElement('div');
    block.className = 'group-block collapsed';

    var title = document.createElement('div');
    title.className = 'group-title';
    var caret = document.createElement('span');
    caret.className = 'caret';
    var nm = document.createElement('span');
    nm.className = 'nm';
    nm.textContent = g.name;
    var val = document.createElement('span');
    val.className = tone(g.equal_weight_pct);
    val.textContent = pct(g.equal_weight_pct);
    var cnt = document.createElement('span');
    cnt.className = 'cnt';
    cnt.textContent = g.constituent_count + ' 檔 · 成交值 ' + oku(g.turnover) + ' 億';
    title.append(caret, nm, val, cnt);
    title.addEventListener('click', function () { block.classList.toggle('collapsed'); });

    var detail = document.createElement('div');
    detail.className = 'group-detail';

    var movers = document.createElement('div');
    movers.className = 'movers';
    if (g.leaders.length) movers.appendChild(moverLine('領漲前三', g.leaders));
    if (g.laggards.length) movers.appendChild(moverLine('落後前三', g.laggards));
    detail.appendChild(movers);

    var scroll = document.createElement('div');
    scroll.className = 'table-scroll';
    var table = document.createElement('table');
    var thead = document.createElement('thead');
    var hr = document.createElement('tr');
    ['代號', '名稱', '市場', '收盤', '漲跌', '漲跌幅', '成交值(億)'].forEach(function (h, i) {
      var th = document.createElement('th');
      th.textContent = h;
      if (i >= 3) th.className = 'num';
      hr.appendChild(th);
    });
    thead.appendChild(hr);
    table.appendChild(thead);

    var tb = document.createElement('tbody');
    g.constituents.forEach(function (q) {
      var tr = document.createElement('tr');
      tr.appendChild(td(q.code));
      tr.appendChild(td(q.name, 'col-name'));
      tr.appendChild(td(q.market));
      tr.appendChild(td(num(q.close, 2), 'num'));
      tr.appendChild(td((q.change >= 0 ? '+' : '') + q.change.toFixed(2), 'num ' + tone(q.change)));
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
  var fetched = d.generated_at ? d.generated_at.replace('T', ' ').slice(0, 16) : '';
  document.getElementById('data-date').textContent =
    '資料日期 ' + d.date + '（抓取於 ' + fetched + '）';

  // 資料日期不是今天就明確標示，避免把舊資料當今日盤看
  var today = new Date();
  var iso = today.getFullYear() + '-' +
    String(today.getMonth() + 1).padStart(2, '0') + '-' +
    String(today.getDate()).padStart(2, '0');
  var flag = document.getElementById('stale-flag');
  if (d.date !== iso) {
    flag.textContent = '非今日資料';
    flag.classList.remove('hidden');
  }

  var m = d.market;
  document.getElementById('market-summary').innerHTML =
    '全市場 <b>' + num(m.stock_count) + '</b> 檔' +
    '　成交值 <b>' + num(Math.round(m.total_turnover / 1e8)) + '</b> 億' +
    '　<span class="up">漲 <b class="up">' + num(m.advancing) + '</b></span>' +
    '　<span class="down">跌 <b class="down">' + num(m.declining) + '</b></span>' +
    '　平 <b>' + num(m.unchanged) + '</b>';

  var warnBox = document.getElementById('warnings');
  var failed = d.sources.filter(function (s) { return s.status !== 'ok'; });
  var msgs = (d.warnings || []).slice();
  failed.forEach(function (s) { msgs.push(s.name + ' 來源抓取失敗：' + s.error); });
  if (msgs.length) {
    warnBox.textContent = '⚠ ' + msgs.join('　|　');
    warnBox.classList.remove('hidden');
  }

  var missing = d.missing || {};
  var names = Object.keys(missing);
  if (names.length) {
    var host = document.getElementById('missing');
    host.textContent = '';
    names.forEach(function (g) {
      var p = document.createElement('div');
      p.className = 'grp';
      var b = document.createElement('b');
      b.textContent = g + '：';
      p.appendChild(b);
      p.appendChild(document.createTextNode(missing[g].join('、')));
      host.appendChild(p);
    });
    document.getElementById('missing-panel').classList.remove('hidden');
  }
}

/* ---------- 互動 ---------- */
function wire() {
  document.querySelectorAll('.panel-head').forEach(function (head) {
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
    state.rankingLimit = state.data.turnover_ranking.length;
    renderRanking();
  });
}

/* ---------- 進入點 ---------- */
fetch('../data/latest.json', { cache: 'no-store' })
  .then(function (r) {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  })
  .then(function (data) {
    state.data = data;
    renderHeader();
    renderGroups();
    renderRanking();
    renderDetail();
    wire();
    document.getElementById('content').hidden = false;
  })
  .catch(function (err) {
    var box = document.getElementById('error');
    box.textContent = '讀取 data/latest.json 失敗：' + err.message +
      '。請先執行 python3 scripts/fetch_daily.py 產生資料，並以 HTTP server 開啟本頁（不要用 file://）。';
    box.classList.remove('hidden');
    document.getElementById('data-date').textContent = '無資料';
  });
