/* SIGNAL is an offline research workbench, not a wallet and not a prediction feed. */
(function () {
  'use strict';
  var D = window.RADAR;
  var app = document.getElementById('board');
  if (!D) { app.textContent = 'No snapshot data. Run main.ts, then open out/dashboard/index.html.'; return; }
  var state = { q: '', category: 'all', chain: 'all', route: 'all', view: 'all', sort: 'implied_value_usd', desc: true, page: 0, selected: null };
  var PAGE = 12;

  function money(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'unknown';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + n.toFixed(2);
  }
  function pct(n) { return n === null || n === undefined ? 'unknown' : (n > 0 ? '+' : '') + n.toFixed(1) + '%'; }
  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (k === 'text') n.textContent = v;
      else if (k === 'html') n.innerHTML = v;
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v);
      else if (v !== null && v !== undefined && v !== false) n.setAttribute(k, v);
    });
    if (children) children.forEach(function (c) { if (c) n.append(c); });
    return n;
  }
  function chip(text, cls) { return '<span class="chip ' + (cls || '') + '">' + esc(text) + '</span>'; }
  document.getElementById('topmeta').innerHTML = '<span>DATA CUT <b>' + esc(D.as_of) + '</b></span><span>SEALED SNAPSHOT / <b>OFFLINE</b></span>';
  document.getElementById('footstamp').textContent = 'SIGNAL / ' + D.as_of;

  function syncHash() {
    var p = new URLSearchParams();
    if (state.selected) p.set('p', state.selected);
    if (state.q) p.set('q', state.q);
    ['view', 'category', 'chain', 'route'].forEach(function (k) { if (state[k] !== 'all') p.set(k, state[k]); });
    history.replaceState(null, '', '#' + p.toString());
  }
  function readHash() {
    var p = new URLSearchParams(location.hash.slice(1));
    state.selected = p.get('p');
    ['q', 'category', 'chain', 'route', 'view'].forEach(function (k) { state[k] = p.get(k) || (k === 'q' ? '' : 'all'); });
  }

  function hero() {
    return el('section', { class: 'hero' }, [
      el('div', { html:
        '<div class="eyebrow">DISCOVERY, NOT SPECULATION</div>' +
        '<h1>Before the token.<br><em>Beyond the TVL.</em></h1>' +
        '<p>Find protocols that still record no token, rank what their launch would be worth against real token-bearing peers, and see exactly what is evidence, what is an assumption, and what a reader must verify next.</p>' +
        '<p class="lede-note">No launch dates. No invented points. No promised eligibility.</p>' }),
      el('dl', { class: 'stats', html:
        '<div class="stat"><dt>Protocols screened</dt><dd>' + D.universe + '<small>sealed universe</small></dd></div>' +
        '<div class="stat"><dt>Launch candidates</dt><dd>' + D.rows.length + '<small>ranked, not endorsed</small></dd></div>' +
        '<div class="stat"><dt>Watchlist covered</dt><dd>' + D.watchlist_size + ' / ' + D.watchlist_size + '<small>all retained</small></dd></div>' +
        '<div class="stat"><dt>Early discoveries</dt><dd>' + D.rows.filter(function (r) { return !r.watchlist; }).length + '<small>below the $50M floor</small></dd></div>' }),
    ]);
  }

  function selectField(label, key, options) {
    var id = 'filter-' + key;
    var input = el('select', { id: id, 'aria-label': label, onchange: function (e) { state[key] = e.target.value; state.page = 0; syncHash(); renderResults(); } });
    options.forEach(function (o) { input.append(el('option', { value: o[0], text: o[1] })); });
    input.value = state[key];
    return el('div', { class: 'field' }, [el('label', { for: id, text: label }), input]);
  }

  function controls() {
    var search = el('input', { id: 'search', type: 'search', placeholder: 'Search protocol or chain', value: state.q, 'aria-label': 'Search protocols', oninput: function (e) { state.q = e.target.value; state.page = 0; syncHash(); renderResults(); } });
    var categories = []; var chains = [];
    D.rows.forEach(function (r) {
      var c = r.category || 'Unclassified';
      if (categories.indexOf(c) < 0) categories.push(c);
      r.chains.forEach(function (x) { if (chains.indexOf(x) < 0) chains.push(x); });
    });
    categories.sort(); chains.sort();
    var seg = el('div', { class: 'seg', role: 'group', 'aria-label': 'Candidate scope' });
    [['all', 'All candidates'], ['watchlist', 'Watchlist'], ['early', 'Early radar']].forEach(function (v) {
      seg.append(el('button', { type: 'button', text: v[1], 'data-view': v[0], 'aria-pressed': String(state.view === v[0]), onclick: function () { state.view = v[0]; state.page = 0; syncHash(); renderResults(); } }));
    });
    return el('section', { class: 'controls' }, [
      el('div', { class: 'field' }, [el('label', { for: 'search', text: 'Protocol search' }), search]),
      selectField('Category', 'category', [['all', 'All categories']].concat(categories.map(function (c) { return [c, c]; }))),
      selectField('Chain', 'chain', [['all', 'All chains']].concat(chains.map(function (c) { return [c, c]; }))),
      selectField('Route', 'route', [['all', 'All routes'], ['Direct protocol', 'Direct protocol'], ['Curated vault', 'Curated vault'], ['Check terms', 'Check terms']]),
      seg,
      el('button', { class: 'back', type: 'button', text: 'Reset', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.route = 'all'; state.view = 'all'; state.page = 0; syncHash(); render(); } }),
    ]);
  }

  function filtered() {
    var q = state.q.trim().toLowerCase();
    return D.rows.filter(function (r) {
      if (q && [r.name, r.slug, r.category || '', r.chains.join(' ')].join(' ').toLowerCase().indexOf(q) < 0) return false;
      if (state.category !== 'all' && (r.category || 'Unclassified') !== state.category) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) < 0) return false;
      if (state.route !== 'all' && r.route !== state.route) return false;
      if (state.view === 'watchlist' && !r.watchlist) return false;
      if (state.view === 'early' && r.watchlist) return false;
      return true;
    }).sort(function (a, b) {
      var x = a[state.sort] === null || a[state.sort] === undefined ? -Infinity : a[state.sort];
      var y = b[state.sort] === null || b[state.sort] === undefined ? -Infinity : b[state.sort];
      return (x - y) * (state.desc ? -1 : 1) || a.rank - b.rank;
    });
  }

  function discoveryMap(rows) {
    var plotted = rows.slice(0, 40);
    if (!plotted.length) return null;
    var maxV = 1; var maxT = 1;
    plotted.forEach(function (r) { maxV = Math.max(maxV, r.implied_value_usd); maxT = Math.max(maxT, r.tvl_usd); });
    var dots = plotted.map(function (r) {
      var x = 34 + Math.log1p(r.tvl_usd) / Math.log1p(maxT) * 486;
      var y = 112 - Math.log1p(r.implied_value_usd) / Math.log1p(maxV) * 88;
      return '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + (r.watchlist ? 4 : 3) + '" fill="' + (r.watchlist ? '#35e0b0' : '#7cc7ff') + '" opacity="0.72"><title>' + esc(r.name) + ' · ' + money(r.implied_value_usd) + '</title></circle>';
    }).join('');
    return el('section', { class: 'signalstrip', html:
      '<div><div class="eyebrow">DISCOVERY MAP</div><h2>Value is not the same as size.</h2>' +
      '<p>First ' + plotted.length + ' filtered candidates, log-scale TVL against conditional market cap. Bubble colour: watchlist or early. No price history is implied.</p>' +
      '<div class="legend"><span class="up">Watchlist</span><span style="color:var(--sky)">Early radar</span></div></div>' +
      '<svg viewBox="0 0 560 130" role="img" aria-label="Conditional market cap against TVL for the first forty filtered candidates">' +
      '<path d="M34 12V112H540" stroke="#29404e" fill="none"/><path d="M34 34H540M34 68H540M34 96H540" stroke="#172a36" fill="none"/>' + dots +
      '<text x="36" y="10" fill="#8fa6b6" font-size="9.5">CONDITIONAL MARKET CAP</text><text x="504" y="126" fill="#8fa6b6" font-size="9.5">TVL</text></svg>' });
  }

  function renderResults() {
    var rows = filtered();
    var pages = Math.max(1, Math.ceil(rows.length / PAGE));
    if (state.page > pages - 1) state.page = pages - 1;
    var visible = rows.slice(state.page * PAGE, (state.page + 1) * PAGE);
    var results = document.getElementById('results');
    if (!results) return;
    Array.prototype.forEach.call(document.querySelectorAll('[data-view]'), function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-view') === state.view));
    });
    results.replaceChildren();
    results.append(el('div', { class: 'resulthead' }, [
      el('div', { html: '<h2>' + (state.view === 'early' ? 'Early radar' : state.view === 'watchlist' ? 'Watchlist' : 'Opportunity board') + '</h2><p class="hint">Ranked by conditional circulating market capitalisation. Range = peer dispersion, not a promise.</p>' }),
      el('span', { class: 'count', 'aria-live': 'polite', html: '<b>' + rows.length + '</b> candidates · ' + (rows.length ? state.page * PAGE + 1 : 0) + '–' + Math.min((state.page + 1) * PAGE, rows.length) }),
    ]));

    var cols = [['rank', '#'], ['name', 'Protocol / route'], ['implied_value_usd', 'Conditional cap'], ['tvl_usd', 'TVL'], ['change_7d', '7d TVL'], ['peer_count', 'Evidence'], ['cost', 'Research budget']];
    var head = el('tr');
    cols.forEach(function (c) {
      var th = el('th', { scope: 'col' });
      if (['implied_value_usd', 'tvl_usd', 'change_7d', 'peer_count'].indexOf(c[0]) >= 0) {
        if (state.sort === c[0]) th.setAttribute('aria-sort', state.desc ? 'descending' : 'ascending');
        th.append(el('button', { type: 'button', text: c[1] + (state.sort === c[0] ? (state.desc ? ' ↓' : ' ↑') : ''), onclick: function () { state.desc = state.sort === c[0] ? !state.desc : true; state.sort = c[0]; renderResults(); } }));
      } else th.textContent = c[1];
      head.append(th);
    });

    var body = el('tbody');
    visible.forEach(function (r) {
      var tr = el('tr', { class: 'row', 'data-slug': r.slug, html:
        '<td class="rank">' + String(r.rank).padStart(2, '0') + '</td>' +
        '<td class="who"><button class="protocol" data-open="' + esc(r.slug) + '">' + esc(r.name) + ' <span aria-hidden="true">↗</span></button>' +
        '<div class="sub">' + esc(r.category || 'Unclassified') + ' · ' + esc(r.chains.slice(0, 2).join(' + ') || 'chain unknown') + '</div>' +
        '<div class="sub">' + chip(r.watchlist ? 'WATCHLIST' : 'EARLY', r.watchlist ? 'watch' : 'early') + chip(r.route, r.route === 'Curated vault' ? 'vault' : r.route === 'Check terms' ? 'terms' : '') + '</div></td>' +
        '<td class="val"><div class="big">' + money(r.implied_value_usd) + '</div><div class="band">' + money(r.low_usd) + ' – ' + money(r.high_usd) + '</div></td>' +
        '<td class="num val">' + money(r.tvl_usd) + '</td>' +
        '<td class="num ' + (r.change_7d === null ? 'flat' : r.change_7d >= 0 ? 'up' : 'down') + '">' + pct(r.change_7d) + '</td>' +
        '<td class="conf"><b>' + r.peer_count + ' peers</b><br>' + esc(r.peer_basis) + ' · ' + esc(r.confidence) + ' confidence</td>' +
        '<td class="val"><span class="num">' + money(r.farm.total_cost) + '</span><div class="band">' + money(r.farm.capital) + ' capital · ' + r.farm.days + 'd scenario</div></td>' });
      tr.querySelector('[data-open]').addEventListener('click', function () { openDetail(r.slug); });
      body.append(tr);
    });

    var panel = el('div', { class: 'panel' }, [el('div', { class: 'tablewrap', tabindex: '0', 'aria-label': 'Scrollable opportunity table' }, [el('table', {}, [el('caption', { class: 'sr-only', text: 'Candidates ranked by conditional implied token value' }), el('thead', {}, [head]), body])])]);
    if (!rows.length) panel.append(el('div', { class: 'empty', text: 'No candidates match. Clear a filter or reset the board.' }));
    results.append(panel);

    var prev = el('button', { type: 'button', class: 'back', text: 'Previous', onclick: function () { if (state.page > 0) { state.page--; renderResults(); } } });
    var next = el('button', { type: 'button', class: 'back', text: 'Next', onclick: function () { if (state.page < pages - 1) { state.page++; renderResults(); } } });
    prev.disabled = state.page === 0; next.disabled = state.page === pages - 1;
    results.append(el('div', { class: 'pager' }, [prev, el('span', { class: 'hint', text: 'Page ' + (state.page + 1) + ' of ' + pages }), next]));
    var map = discoveryMap(rows);
    if (map) results.append(map);
    results.append(method());
  }

  function method() {
    var c = D.calibration;
    var cards = [
      ['01 / Universe', D.universe + ' screened', D.excluded.token + ' protocols already record a token and ' + (D.excluded.token ? '' : '') + 'are separated as peers; ' + (D.excluded.product + D.excluded.release) + ' are asset products or versioned releases and never counted as launches. Parent-protocol data is absent from the snapshot, so below-floor inclusion is provisional.'],
      ['02 / Peer engine', c.peer_count + ' token peers', 'Log(TVL) slope ' + Number(c.tvl_slope).toFixed(3) + ', category effects shrunk by ' + c.shrink + ' pseudo-observations. Full model is re-fitted in every test fold. Growth is shown, not used to inflate value.'],
      ['03 / Held-out check', Number(c.log_mae).toFixed(2) + ' log MAE', 'Global baseline ' + Number(c.baseline_log_mae).toFixed(2) + ' over ' + c.folds + ' disjoint folds. The fitted residual band covers ' + (c.interval_coverage * 100).toFixed(0) + '% of held-out token peers. That measures the model, not a future launch.'],
      ['04 / Reality check', 'Not a launch forecast', 'Market cap is not FDV and not your allocation. Ten snapshot fields cannot establish a token, a date, eligibility, fees or incentives. Revalidate every row before acting.'],
    ];
    return el('section', { class: 'method', 'aria-label': 'Method and limitations' }, cards.map(function (k) {
      return el('div', { class: 'card', html: '<h4>' + k[0] + '</h4><div class="val2">' + k[1] + '</div><p>' + k[2] + '</p>' });
    }));
  }

  function openDetail(slug) { state.selected = slug; syncHash(); render(); window.scrollTo(0, 0); var t = document.getElementById('detail-title'); if (t) t.focus(); }
  function closeDetail() { state.selected = null; syncHash(); render(); }

  function detail(r) {
    var wrap = el('div', { class: 'shell' });
    wrap.append(el('div', { class: 'backrow' }, [
      el('button', { class: 'back', type: 'button', text: '← Opportunity board', onclick: closeDetail }),
      el('span', { class: 'crumb', text: 'RESEARCH DOSSIER / ' + r.slug }),
    ]));
    var left = el('div', { class: 'detail-left' });
    left.append(el('section', { class: 'card', html:
      '<div class="eyebrow">RANK ' + r.rank + ' / ' + (r.watchlist ? 'WATCHLIST' : 'EARLY DISCOVERY') + '</div>' +
      '<h1 id="detail-title" tabindex="-1">' + esc(r.name) + '</h1>' +
      '<p class="muted">' + esc(r.category || 'Unclassified') + ' · ' + esc(r.chains.join(' · ') || 'chain unrecorded') + '</p>' +
      '<div class="detail-value"><span>' + money(r.implied_value_usd) + '</span><small>conditional launch value, not a market cap on record</small></div>' +
      '<div class="range-label"><span>' + money(r.low_usd) + '</span><span>peer band, log scale</span><span>' + money(r.high_usd) + '</span></div>' +
      '<div class="static-range" role="img" aria-label="Conditional value inside its peer band"><i></i><b style="left:' + Math.max(0, Math.min(100, (Math.log(r.implied_value_usd) - Math.log(r.low_usd)) / Math.max(1e-9, Math.log(r.high_usd) - Math.log(r.low_usd)) * 100)).toFixed(1) + '%"></b></div>' +
      '<div class="kv">' +
        '<div><dt>TVL at data cut</dt><dd>' + money(r.tvl_usd) + '</dd></div>' +
        '<div><dt>Peer-adjusted multiple</dt><dd>' + r.multiple.toFixed(3) + '×</dd></div>' +
        '<div><dt>7-day TVL change</dt><dd>' + pct(r.change_7d) + '</dd></div>' +
        '<div><dt>Tracked since</dt><dd>' + (r.listed_at === null ? 'unrecorded' : esc(r.listed_at) + ' · ' + r.age_days + 'd') + '</dd></div>' +
      '</div>' +
      '<div class="formula"><div class="eq">' + money(r.tvl_usd) + ' TVL × ' + r.multiple.toFixed(3) + ' peer-adjusted multiple = ' + money(r.implied_value_usd) + ' conditional value</div>' +
      '<p class="cap">' + r.peer_count + (r.peer_basis === 'all token peers' ? ' token peers, global pool' : ' peers in ' + esc(r.peer_basis)) + ' · ' + esc(r.confidence) + ' confidence. TVL is not revenue; market cap is not FDV.</p></div>' }));

    left.append(el('section', { class: 'card', html:
      '<h3>Valuation comparables</h3><p class="hint">' + esc(r.peer_basis) + ' · nearest by TVL first: observed market caps, nothing modelled</p>' +
      '<div class="tablewrap"><table class="peers"><thead><tr><th scope="col">Token-bearing protocol</th><th scope="col" class="r">Mcap</th><th scope="col" class="r">TVL</th><th scope="col" class="r">Mcap / TVL</th></tr></thead><tbody>' +
      (r.peers.map(function (p) { return '<tr><td>' + esc(p.name) + '</td><td class="r num">' + money(p.mcap_usd) + '</td><td class="r num">' + money(p.tvl_usd) + '</td><td class="r num">' + p.multiple.toFixed(2) + '×</td></tr>'; }).join('') ||
        '<tr><td colspan="4">No same-category peers. A global fallback is used and confidence is low.</td></tr>') +
      '</tbody></table></div>' +
      '<p class="hint" style="margin-top:10px"><b>Route: ' + esc(r.route) + '</b>. ' + esc(r.access) + '</p>' +
      '<ul class="evidence">' + r.evidence.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>' }));

    var right = el('div', { class: 'detail-right' });
    right.append(el('section', { class: 'card', html:
      '<h3>Research-first farm plan</h3>' +
      '<div class="budget">' +
        '<div><b>' + money(r.farm.capital) + '</b><span>capital at risk</span></div>' +
        '<div><b>' + money(r.farm.total_cost) + '</b><span>assumed cost</span></div>' +
        '<div><b>' + r.farm.days + 'd</b><span>scenario hold</span></div>' +
      '</div><p class="hint">Planning assumptions, not protocol requirements. Eligibility is unconfirmed.</p>' +
      '<ol class="steps">' + r.farm_steps.map(function (s) {
        var i = s.indexOf(' Cost:');
        var text = i < 0 ? s : s.slice(0, i);
        var cost = i < 0 ? '' : s.slice(i + 1);
        return '<li><div><div class="step">' + esc(text) + '</div><div class="cost">' + esc(cost) + '</div></div></li>';
      }).join('') + '</ol>' +
      '<p class="caution">' + esc(r.farm.caution) + ' Never share a seed phrase. Verify the official contract; skip the farm when access or eligibility cannot be confirmed.</p>' }));

    var scenario = el('section', { class: 'card scenario' }, [
      el('h3', { text: 'Your scenario, not a forecast' }),
      el('p', { class: 'hint', text: 'Your inputs. No model-estimated launch odds.' }),
    ]);
    var calc = el('div', { class: 'calc' });
    var refs = {};
    var fields = [['odds', 'Your launch probability (%)', 10], ['allocation', 'Your community allocation (%)', 5], ['farmers', 'Your assumed equal recipients', 100000], ['cost', 'Your total cost ($)', r.farm.total_cost]];
    fields.forEach(function (f) {
      var input = el('input', { id: 'calc-' + f[0], type: 'number', min: '0', step: 'any' });
      input.value = String(f[2]);
      input.addEventListener('input', update);
      refs[f[0]] = input;
      calc.append(el('div', { class: 'row' }, [el('label', { for: 'calc-' + f[0], text: f[1] }), input]));
    });
    var out = el('div', { class: 'out', 'aria-live': 'polite' });
    calc.append(out); scenario.append(calc);
    function update() {
      var odds = Number(refs.odds.value);
      var allocation = Number(refs.allocation.value);
      var farmers = Number(refs.farmers.value);
      var cost = Number(refs.cost.value);
      if (![odds, allocation, farmers, cost].every(function (n) { return isFinite(n) && n >= 0; }) || odds > 100 || allocation > 100 || farmers < 1) {
        out.textContent = 'Enter valid, bounded assumptions.'; return;
      }
      var conditional = r.implied_value_usd * (allocation / 100) / farmers;
      var net = conditional * (odds / 100) - cost;
      var breakeven = conditional > 0 ? cost / conditional * 100 : Infinity;
      out.innerHTML = '<div class="big ' + (net < 0 ? 'down' : '') + '">' + (net < 0 ? '−' : '') + money(Math.abs(net)) + '</div>' +
        '<div class="note">Your scenario, before tax, slippage, time and capital losses.</div>' +
        '<div class="hint">Conditional equal share ' + money(conditional) + ' · break-even probability ' + (breakeven <= 100 ? breakeven.toFixed(1) + '%' : 'over 100% / infeasible') + '</div>';
    }
    update();
    left.append(scenario);
    wrap.append(el('div', { class: 'detail' }, [left, right]), method());
    return wrap;
  }

  function render() {
    app.replaceChildren();
    if (state.selected) {
      var found = D.rows.filter(function (r) { return r.slug === state.selected; })[0];
      if (found) { app.append(detail(found)); return; }
      state.selected = null;
    }
    app.append(el('div', { class: 'shell' }, [
      hero(),
      el('div', { class: 'integrity', text: 'RECORD ≠ REALITY · Data cut ' + D.as_of + '. "No token recorded" is not proof that none exists. Parent-protocol data and reward eligibility are not in this snapshot.' }),
      controls(),
      el('section', { id: 'results', 'aria-label': 'Filtered candidate results' }),
    ]));
    renderResults();
  }

  readHash(); render();
  addEventListener('hashchange', function () { readHash(); state.page = 0; render(); });
})();