/* Arbaeen UK – admin stall map. Tap a stall, then tap an empty block to move it.
   Saves to the Google Sheet through the Apps Script web app (data/event.json → stallsApi).
   With no stallsApi set it runs in demo mode on the built-in example stalls and saves nothing. */
(function () {
  'use strict';
  var $ = function (s) { return document.querySelector(s); };
  var api = '', key = '', demo = false, D = null, selected = null, busy = false;

  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k]; if (v == null || v === false) return;
      if (k === 'text') el.textContent = v;
      else if (k === 'class') el.className = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v);
    });
    (kids || []).forEach(function (c) { if (c != null) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return el;
  }
  function toast(m) { var t = $('#toast'); t.textContent = m; t.hidden = false; clearTimeout(toast.x); toast.x = setTimeout(function () { t.hidden = true; }, 4000); }

  function call(body) {
    body.key = key;
    return fetch(api, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  }

  /* ---------- start ---------- */
  fetch('data/event.json', { cache: 'no-cache' }).then(function (r) { return r.json(); }).then(function (ev) {
    api = ev.stallsApi || '';
    if (!api) {
      demo = true;
      $('#banner').textContent = 'Demo mode: the Google Sheet is not connected yet, so moves are not saved. Connect it by adding the Apps Script web app address to data/event.json.';
      D = { stallMap: ev.stallMap, types: ev.types, stalls: ev.stalls.map(function (s) { return Object.assign({ status: 'Approved', show: true }, s); }) };
      D.stalls.push({ id: 'S011', name: 'Example new request', type: 'food', serves: 'Sweets', row: '', col: 0, span: 1, status: 'Requested', show: false, gas: 'No', vehicleRequested: 'No' });
      $('#work').hidden = false; render();
      return;
    }
    $('#banner').className = 'banner live';
    $('#banner').textContent = 'Connected to the stalls Google Sheet. Moves save straight to the sheet and show on the website within a minute.';
    try { key = localStorage.getItem('stallAdminKey') || sessionStorage.getItem('stallAdminKey') || ''; } catch (e) {}
    if (key) load(); else $('#login').hidden = false;
  }).catch(function () { $('#banner').textContent = 'Could not load the site settings. Refresh to try again.'; });

  $('#login').addEventListener('submit', function (e) {
    e.preventDefault();
    key = $('#key').value.trim(); if (!key) return;
    try { (($('#remember').checked) ? localStorage : sessionStorage).setItem('stallAdminKey', key); } catch (err) {}
    load();
  });

  function load() {
    $('#login-msg').textContent = 'Checking…';
    call({ action: 'list' }).then(function (res) {
      if (!res.ok) throw new Error(res.error || 'Refused');
      D = res; $('#login').hidden = true; $('#work').hidden = false; render();
    }).catch(function (err) {
      try { localStorage.removeItem('stallAdminKey'); sessionStorage.removeItem('stallAdminKey'); } catch (e) {}
      $('#login').hidden = false; $('#work').hidden = true;
      $('#login-msg').textContent = String(err.message).indexOf('admin key') > -1 ? 'That admin key is not right.' : 'Could not reach the sheet. Check your signal and try again.';
    });
  }

  /* ---------- drawing ---------- */
  function typeOf(k) { return (D.types || []).filter(function (t) { return t.key === k; })[0] || { bg: '#E9DFCC', fg: '#1A1414', label: { en: k } }; }
  function onMap(s) { return s.row && s.col >= 1 && s.status !== 'Declined'; }
  function byId(id) { return D.stalls.filter(function (s) { return s.id === id; })[0]; }

  function fits(s, row, col) {
    var sm = D.stallMap;
    if (sm.rows.indexOf(row) < 0 || col < 1 || col + s.span - 1 > sm.cols) return { ok: false, why: s.id + ' is ' + s.span + ' blocks wide and does not fit there' };
    var clash = D.stalls.filter(function (o) {
      return o.id !== s.id && onMap(o) && o.row === row && col <= o.col + o.span - 1 && o.col <= col + s.span - 1;
    })[0];
    return clash ? { ok: false, why: 'That space overlaps ' + clash.id + ' (' + clash.name + ')' } : { ok: true };
  }

  function render() {
    var g = $('#grid'), sm = D.stallMap; g.textContent = '';
    g.style.gridTemplateColumns = '28px repeat(' + sm.cols + ', minmax(0,1fr))';
    g.appendChild(h('div'));
    for (var c = 1; c <= sm.cols; c++) g.appendChild(h('div', { class: 'h', text: String(c) }));
    var sel = selected && byId(selected);
    sm.rows.forEach(function (row) {
      g.appendChild(h('div', { class: 'rl', text: row }));
      var inRow = D.stalls.filter(function (s) { return onMap(s) && s.row === row; }).sort(function (a, b) { return a.col - b.col; });
      var col = 1;
      function free(r, cc) {
        var ok = sel && fits(sel, r, cc).ok;
        return h('button', { type: 'button', class: 'free' + (ok ? ' ok' : ''), 'aria-label': 'Empty block ' + r + cc, 'data-block': r + cc,
          onclick: function () { place(r, cc); } });
      }
      inRow.forEach(function (s) {
        if (s.col < col) return;
        while (col < s.col) { g.appendChild(free(row, col)); col++; }
        var ty = typeOf(s.type);
        var b = h('button', { type: 'button', 'data-id': s.id, class: (s.id === selected ? 'sel ' : '') + (s.status !== 'Approved' ? 'req' : ''),
          title: s.id + ' · ' + s.name + ' · ' + s.status, text: s.id,
          'aria-label': s.id + ' ' + s.name + ', ' + s.status + ', at ' + s.row + s.col,
          onclick: function () { select(s.id); } });
        b.style.gridColumn = 'span ' + s.span; b.style.background = ty.bg; b.style.color = ty.fg;
        g.appendChild(b);
        col += s.span;
      });
      while (col <= sm.cols) { g.appendChild(free(row, col)); col++; }
    });

    var lg = $('#legend'); lg.textContent = '';
    (D.types || []).forEach(function (t) {
      var i = h('i'); i.style.background = t.bg; i.style.borderRadius = '3px';
      lg.appendChild(h('span', null, [i, (t.label && t.label.en) || t.key]));
    });
    var ri = h('i'); ri.style.borderRadius = '3px'; ri.style.background = 'repeating-linear-gradient(45deg,#E8C477 0 4px,#fff 4px 8px)';
    lg.appendChild(h('span', null, [ri, 'Not approved yet']));

    var ul = $('#unplaced'); ul.textContent = '';
    var waiting = D.stalls.filter(function (s) { return !onMap(s) && s.status !== 'Declined'; });
    if (!waiting.length) ul.appendChild(h('li', { class: 'hint', text: 'Every stall is on the map.' }));
    waiting.forEach(function (s) {
      ul.appendChild(h('li', null, [h('button', { type: 'button', class: s.id === selected ? 'sel' : '', onclick: function () { select(s.id); } }, [
        h('b', { text: s.id + ' · ' + s.name }),
        h('small', { text: ((typeOf(s.type).label || {}).en || s.type) + ' · ' + s.span + ' block' + (s.span > 1 ? 's' : '') + ' · ' + s.status })
      ])]));
    });
    renderInfo();
  }

  function renderInfo() {
    var s = selected && byId(selected);
    $('#info-empty').hidden = !!s; $('#info-body').hidden = !s;
    $('#howto').textContent = s ? 'Now tap a green block to put ' + s.id + ' there.' : 'Tap a stall, then tap an empty block to move it there.';
    if (!s) return;
    var dl = $('#info-dl'); dl.textContent = '';
    var rows = [['Stall', s.id + ' · ' + s.name], ['Type', (typeOf(s.type).label || {}).en || s.type], ['Serves', s.serves],
      ['Size', s.span + ' × 3m blocks'], ['Place', onMap(s) ? s.row + s.col : 'Not placed'], ['Status', s.status],
      ['Gas or fire', s.gas || '–'], ['Vehicle access', (s.vehicleRequested === 'Yes' ? 'Requested · ' : '') + (s.vehicle || '–')]];
    if (s.arrival || s.cleanup) rows.push(['Times', (s.arrival || '?') + ' arrive · ' + (s.cleanup || '?') + ' clean-up']);
    rows.forEach(function (r) { dl.appendChild(h('dt', { text: r[0] })); dl.appendChild(h('dd', { text: r[1] })); });
    if (s.status !== 'Approved') dl.appendChild(h('dd', { style: 'grid-column:1/-1' }, [h('span', { class: 'pill warn', text: 'Not shown on the website until Status is Approved' })]));
    if (String(s.gas).toLowerCase() === 'yes') dl.appendChild(h('dd', { style: 'grid-column:1/-1' }, [h('span', { class: 'pill', text: 'Uses gas or fire: keep clear of neighbours' })]));
    $('#unplace').hidden = !onMap(s);
  }

  function select(id) { selected = selected === id ? null : id; render(); }
  $('#deselect').addEventListener('click', function () { selected = null; render(); });

  function save(s, row, col, done) {
    var prev = { row: s.row, col: s.col };
    s.row = row; s.col = col; busy = true; render();
    if (demo) { busy = false; done(true); return; }
    call(row ? { action: 'move', id: s.id, row: row, col: col } : { action: 'unplace', id: s.id })
      .then(function (res) {
        busy = false;
        if (!res.ok) { s.row = prev.row; s.col = prev.col; render(); toast(res.error || 'Not saved'); return; }
        done(true);
      })
      .catch(function () { busy = false; s.row = prev.row; s.col = prev.col; render(); toast('Not saved: no connection to the sheet. Try again.'); });
  }

  function place(row, col) {
    if (busy) return;
    var s = selected && byId(selected);
    if (!s) { toast('Tap a stall first, then tap where it should go.'); return; }
    var f = fits(s, row, col);
    if (!f.ok) { toast(f.why); return; }
    save(s, row, col, function () { selected = null; render(); toast(s.id + ' moved to ' + row + col + (demo ? ' (demo: not saved)' : ' and saved')); });
  }

  $('#unplace').addEventListener('click', function () {
    var s = selected && byId(selected); if (!s || busy) return;
    save(s, '', 0, function () { render(); toast(s.id + ' taken off the map' + (demo ? ' (demo: not saved)' : '')); });
  });
})();
