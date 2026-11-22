/* Arbaeen UK — public site. Content comes from data/event.json
   (later fed by the Google Sheet / admin dashboard); words from js/i18n.js. */
(function () {
  'use strict';

  /* ---------- Language ---------- */
  var LANGS = ['en', 'ur', 'ar', 'fa'];
  var lang = 'en';
  try { var saved = localStorage.getItem('lang'); if (LANGS.indexOf(saved) > -1) lang = saved; } catch (e) {}
  if (lang === 'en' && !(function () { try { return localStorage.getItem('lang'); } catch (e) { return null; } })()) {
    var nav = (navigator.language || 'en').slice(0, 2);
    if (LANGS.indexOf(nav) > -1) lang = nav;
  }

  function t(key, vars) {
    var row = window.I18N.t[key];
    var s = row ? (row[LANGS.indexOf(lang)] || row[0]) : key;
    if (vars) Object.keys(vars).forEach(function (k) { s = s.replace('{' + k + '}', vars[k]); });
    return s;
  }

  function applyLang() {
    var meta = window.I18N.langs[lang];
    document.documentElement.lang = lang;
    document.documentElement.dir = meta.dir;
    $$('[data-i18n]').forEach(function (el) { el.textContent = t(el.getAttribute('data-i18n')); });
    $$('[data-i18n-aria]').forEach(function (el) { el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria'))); });
    $('#lang-select').value = lang;
    if (DATA) renderAll(DATA);
  }

  var TYPES = {
    food:       { bg: '#E8C477', fg: '#1A1414', tagBg: '#F6EBD3', tagFg: '#8A6420', key: 'f.food' },
    drink:      { bg: '#F3E0B0', fg: '#1A1414', tagBg: '#F6EBD3', tagFg: '#8A6420', key: 'f.drink' },
    charity:    { bg: '#CFE0F3', fg: '#123A66', tagBg: '#E3EDF8', tagFg: '#1F5FA8', key: 'f.charity' },
    exhibition: { bg: '#E3D5EE', fg: '#3E2A55', tagBg: '#EFE7F5', tagFg: '#5A3F7A', key: 'f.exhibition' },
    medic:      { bg: '#CFE8DA', fg: '#1E5A40', tagBg: '#E5F1EA', tagFg: '#1E5A40', key: 'f.medic' }
  };

  var $ = function (s, el) { return (el || document).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };

  // Safe element builder: never injects HTML from data.
  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === undefined || v === null || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    });
    (kids || []).forEach(function (c) { if (c != null) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return el;
  }

  function toast(msg) {
    var el = $('#toast'); el.textContent = msg; el.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(function () { el.hidden = true; }, 4500);
  }

  var DATA = null;

  fetch('data/event.json', { cache: 'no-cache' })
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (d) { DATA = d; applyLang(); initMap(d); })
    .catch(function () { $('#live-text').textContent = t('live.error'); });

  function setLang(l) {
    if (LANGS.indexOf(l) < 0) return;
    lang = l;
    try { localStorage.setItem('lang', lang); } catch (err) {}
    applyLang();
    renderLayerChips();
    if (window.__guideRefresh) window.__guideRefresh();
  }
  $('#lang-select').addEventListener('change', function (e) { setLang(e.target.value); });
  applyLang();

  function renderAll(d) {
    renderLive(d); renderCountdown(d); renderProgramme(d); renderSalat(d);
    renderSpeakers(d); renderStalls(d); renderLost(d); renderLayerChips();
  }

  function renderLive(d) {
    var a = (d.announcements || [])[0];
    $('#live-text').textContent = a ? ((a.time ? a.time + ' · ' : '') + a.text) : t('live.none');
  }

  function renderCountdown(d) {
    var days = Math.ceil((new Date(d.event.date + 'T00:00:00') - new Date()) / 864e5);
    $('#countdown').textContent = days > 1 ? t('count.days', { n: days }) : days === 1 ? t('count.tomorrow') : days === 0 ? t('count.today') : '';
  }

  function renderProgramme(d) {
    var ol = $('#programme-list'); ol.textContent = '';
    d.programme.forEach(function (p) {
      ol.appendChild(h('li', { class: p.kind || '' }, [
        h('p', { class: 't', text: p.time || t('prog.tbc') }),
        h('p', { class: 'n', text: p.key ? t(p.key) : p.title })
      ]));
    });
  }

  function renderSalat(d) {
    $('#salat-method').textContent = t('hero.date').split('·')[0].trim() + ' · ' + t('salat.method');
    var box = $('#salat-list'); box.textContent = '';
    d.salat.times.forEach(function (s) {
      box.appendChild(h('div', { class: s.main ? 'main' : '' }, [h('span', { text: t('salat.' + s.name) }), h('b', { text: s.time, dir: 'ltr' })]));
    });
    $('#salat-jamaat').textContent = d.salat.jamaat || t('salat.jamaat');
  }

  function renderSpeakers(d) {
    var box = $('#speaker-list'); box.textContent = '';
    d.speakers.forEach(function (s) {
      var meta = [s.topic, s.time || t('prog.tbc')].filter(Boolean).join(' · ');
      box.appendChild(h('div', { class: 'card row' }, [
        h('div', { class: 'avatar', 'aria-hidden': 'true' }),
        h('div', null, [h('p', { class: 'nm', text: s.name || t('speakers.tba') }), h('p', { class: 'muted small', text: meta })])
      ]));
    });
  }

  /* ---------- Map with layers ---------- */
  var map = null, layers = {}, LAYERS = [
    { id: 'outward', key: 'layer.outward', dot: 'background:#7A1E24' },
    { id: 'return', key: 'layer.return', dot: '', dash: true },
    { id: 'live', key: 'layer.live', dot: 'background:#C0392B' },
    { id: 'medic', key: 'layer.medic', dot: 'background:#2E7D5B;border-radius:3px' },
    { id: 'reg', key: 'layer.reg', dot: 'background:#1F5FA8;border-radius:3px' },
    { id: 'toilets', key: 'layer.toilets', dot: 'background:#2B8FB3;border-radius:3px' },
    { id: 'prayer', key: 'layer.prayer', dot: 'background:#8A6420;border-radius:3px' },
    { id: 'access', key: 'layer.access', dot: 'background:#5A3F7A' }
  ];
  var layerOn = { outward: true, 'return': true, live: true, medic: true, reg: true, toilets: true, prayer: true, access: true };

  function pinIcon(color, size, label) {
    return L.divIcon({
      className: '', iconSize: [size, size], iconAnchor: [size / 2, size / 2],
      html: '<div class="pin" style="width:' + size + 'px;height:' + size + 'px;background:' + color + '">' + (label || '') + '</div>'
    });
  }

  function addPins(group, list, color, label, fallbackKey) {
    (list || []).forEach(function (m) {
      var name = m.name || t(fallbackKey);
      L.marker(m.at, { icon: pinIcon(color, 24, label), title: name, alt: name }).addTo(group).bindPopup(document.createTextNode(name));
    });
  }

  function initMap(d) {
    if (!window.L) return;
    var r = d.route;
    map = L.map('map', { scrollWheelZoom: false }).setView(r.center, r.zoom);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);
    LAYERS.forEach(function (l) { layers[l.id] = L.layerGroup().addTo(map); });

    L.polyline(r.outward, { color: '#7A1E24', weight: 7, opacity: .9, lineCap: 'round' }).addTo(layers.outward);
    L.polyline(r['return'], { color: '#7A1E24', weight: 5, opacity: .9, dashArray: '2 12', lineCap: 'round' }).addTo(layers['return']);
    var styles = { gate: ['#1C1012', 26, 'S'], landmark: ['#D9AE5B', 22, ''], turn: ['#D9AE5B', 26, 'T'] };
    r.points.forEach(function (p) {
      var s = styles[p.type] || ['#1C1012', 20, ''];
      var m = L.marker(p.at, { icon: pinIcon(s[0], s[1], s[2]) }).addTo(layers.outward);
      m.bindPopup(function () { return document.createTextNode(p.key ? t(p.key) : p.name); });
    });
    if (r.live && r.live.at) {
      L.marker(r.live.at, { icon: L.divIcon({ className: '', iconSize: [22, 22], iconAnchor: [11, 11], html: '<div class="livepin"></div>' }) })
        .addTo(layers.live).bindPopup(function () { return document.createTextNode(t('layer.live') + (r.live.updated ? ' · ' + r.live.updated : '')); });
    }
    addPins(layers.medic, r.medicTents, '#2E7D5B', '+', 'layer.medic');
    addPins(layers.reg, r.registration, '#1F5FA8', 'R', 'layer.reg');
    addPins(layers.toilets, (r.toilets || []).concat(r.water || []), '#2B8FB3', 'WC', 'layer.toilets');
    addPins(layers.prayer, r.prayer, '#8A6420', '', 'layer.prayer');
    (r.accessible || []).forEach(function (line) {
      L.polyline(line, { color: '#5A3F7A', weight: 5, opacity: .85, dashArray: '10 8' }).addTo(layers.access);
    });

    map.fitBounds(L.latLngBounds(r.outward.concat(r['return'])), { padding: [24, 24] });
    window.addEventListener('resize', function () { map.invalidateSize(); });
    renderLayerChips();
  }

  function layerEmpty(id) {
    var r = DATA && DATA.route; if (!r) return true;
    switch (id) {
      case 'live': return !(r.live && r.live.at);
      case 'medic': return !(r.medicTents || []).length;
      case 'reg': return !(r.registration || []).length;
      case 'toilets': return !((r.toilets || []).length + (r.water || []).length);
      case 'prayer': return !(r.prayer || []).length;
      case 'access': return !(r.accessible || []).length;
      default: return false;
    }
  }

  function renderLayerChips() {
    var box = $('#layer-chips'); if (!box || !DATA) return;
    box.textContent = '';
    var soon = [];
    LAYERS.forEach(function (l) {
      if (layerEmpty(l.id)) { if (l.id !== 'live') soon.push(t(l.key)); return; }
      box.appendChild(h('button', {
        type: 'button', 'aria-pressed': String(layerOn[l.id]),
        onclick: function (e) {
          layerOn[l.id] = !layerOn[l.id];
          e.currentTarget.setAttribute('aria-pressed', String(layerOn[l.id]));
          if (map) { if (layerOn[l.id]) layers[l.id].addTo(map); else map.removeLayer(layers[l.id]); }
        }
      }, [h('i', { class: l.dash ? 'dash' : '', style: l.dot || null }), t(l.key)]));
    });
    $('#route-draft').textContent = DATA.route.draft ? t('route.draft') : '';
    $('#layer-soon').textContent = soon.length ? t('layer.soon', { list: soon.join(', ') }) : '';
  }

  /* ---------- Stalls ---------- */
  var filter = 'all';

  function renderStalls(d) {
    var g = $('#stall-grid'), sm = d.stallMap; g.textContent = '';
    g.style.gridTemplateColumns = '28px repeat(' + sm.cols + ', minmax(0,1fr))';
    g.appendChild(h('div'));
    for (var c = 1; c <= sm.cols; c++) g.appendChild(h('div', { class: 'h', text: String(c) }));
    sm.rows.forEach(function (row) {
      g.appendChild(h('div', { class: 'rl', text: row }));
      var inRow = d.stalls.filter(function (s) { return s.row === row; }).sort(function (a, b) { return a.col - b.col; });
      var col = 1;
      inRow.forEach(function (s) {
        while (col < s.col) { g.appendChild(h('div', { class: 'free', 'aria-hidden': 'true' })); col++; }
        var ty = TYPES[s.type] || TYPES.food;
        var b = h('button', {
          type: 'button', 'data-type': s.type, 'aria-label': s.id + ', ' + s.name + ', ' + s.serves,
          text: s.type === 'exhibition' || s.type === 'medic' ? t(ty.key) : s.id,
          onclick: function () { toast(s.id + ' · ' + s.name + ' · ' + s.serves); }
        });
        b.style.gridColumn = 'span ' + s.span; b.style.background = ty.bg; b.style.color = ty.fg;
        g.appendChild(b);
        col += s.span;
      });
      while (col <= sm.cols) { g.appendChild(h('div', { class: 'free', 'aria-hidden': 'true' })); col++; }
    });
    var lg = $('#stall-legend'); lg.textContent = '';
    Object.keys(TYPES).forEach(function (k) {
      var i = h('i'); i.style.borderRadius = '3px'; i.style.background = TYPES[k].bg;
      lg.appendChild(h('span', null, [i, t(TYPES[k].key)]));
    });
    var fi = h('i'); fi.style.borderRadius = '3px'; fi.style.border = '1.5px dashed #C8B994';
    lg.appendChild(h('span', null, [fi, t('f.free')]));
    $('#stall-note').textContent = sm.note || t('stallmap.note');
    var cl = $('#charity-list'); cl.textContent = '';
    (d.officialCharities || []).forEach(function (c) { cl.appendChild(h('span', { text: c })); });
    renderStallList(d);
  }

  function renderStallList(d) {
    var box = $('#stall-list'); box.textContent = '';
    var list = d.stalls.filter(function (s) { return s.type !== 'medic' && (filter === 'all' || s.type === filter); });
    if (!list.length) box.appendChild(h('p', { class: 'muted', text: t('f.none') }));
    list.forEach(function (s) {
      var ty = TYPES[s.type] || TYPES.food;
      var tag = h('span', { class: 'tag', text: (s.type === 'food' || s.type === 'drink' ? 'Mokib · ' : '') + t(ty.key) });
      tag.style.background = ty.tagBg; tag.style.color = ty.tagFg;
      var kids = [tag, h('p', { class: 'nm', text: s.name }), h('p', { class: 'muted small', text: s.serves + ' · ' + s.id })];
      if (s.website && /^https?:\/\//.test(s.website)) kids.push(h('a', { href: s.website, rel: 'noopener', target: '_blank', class: 'small', text: 'Website' }));
      box.appendChild(h('div', { class: 'card' }, kids));
    });
    $$('#stall-grid button').forEach(function (b) {
      var ty = b.getAttribute('data-type');
      b.classList.toggle('dim', filter !== 'all' && ty !== filter && ty !== 'medic');
    });
  }

  $$('#stall-filters button').forEach(function (b) {
    b.addEventListener('click', function () {
      filter = b.getAttribute('data-f');
      $$('#stall-filters button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
      if (DATA) renderStallList(DATA);
    });
  });

  /* ---------- Lost & found ---------- */
  function renderLost(d) {
    var ul = $('#lost-list'); ul.textContent = '';
    if (!d.lostProperty.length) ul.appendChild(h('li', null, [t('lost.none')]));
    d.lostProperty.forEach(function (i) {
      ul.appendChild(h('li', null, [h('b', { text: i.item }), h('span', { text: (i.status || '') + (i.time ? ' · ' + i.time : '') })]));
    });
    var cb = $('#child-list'); cb.textContent = '';
    var active = d.childAlerts.filter(function (a) { return !a.found; });
    if (!active.length) cb.appendChild(h('div', { class: 'alert', text: t('child.none') }));
    active.forEach(function (a) { cb.appendChild(h('div', { class: 'alert', text: a.text })); });
  }

  /* ---------- Forms ---------- */
  var FORMS = {
    medic: { title: 'help.medic', send: 'm.send', api: 'api/report', fields: [
      { note: 'm.note', red: true },
      { id: 'where', label: 'm.where', type: 'textarea', req: true, ph: 'm.where.ph' },
      { geo: true },
      { id: 'what', label: 'm.what', type: 'textarea', req: true, ph: 'm.what.ph' },
      { id: 'people', label: 'm.people', type: 'number', val: '1' },
      { id: 'phone', label: 'fm.phone', type: 'tel', req: true }
    ] },
    child: { title: 'child.report', send: 'c.send', api: 'api/report', fields: [
      { note: 'c.note', red: true },
      { id: 'name', label: 'c.name', type: 'text', req: true },
      { id: 'age', label: 'c.age', type: 'number', req: true },
      { id: 'desc', label: 'c.desc', type: 'textarea', req: true },
      { id: 'clothes', label: 'c.clothes', type: 'textarea', req: true },
      { id: 'seen', label: 'c.seen', type: 'text', req: true },
      { id: 'phone', label: 'fm.phone', type: 'tel', req: true },
      { id: 'comments', label: 'c.comments', type: 'textarea' },
      { note: 'c.privacy' }
    ] },
    item: { title: 'help.item', send: 'fm.send', api: 'api/report', fields: [
      { radio: 'kind', opts: [['lost', 'i.lost'], ['found', 'i.found']] },
      { id: 'item', label: 'i.item', type: 'text', req: true, ph: 'i.item.ph' },
      { id: 'desc', label: 'i.desc', type: 'textarea' },
      { id: 'where', label: 'i.where', type: 'text' },
      { id: 'phone', label: 'fm.phone', type: 'tel', req: true }
    ] },
    tabarruk: { title: 't.title', send: 't.send', api: 'api/tabarruk', fields: [
      { id: 'name', label: 't.name', type: 'text', req: true, ac: 'name' },
      { id: 'group', label: 't.group', type: 'text' },
      { id: 'phone', label: 'fm.phone', type: 'tel', req: true },
      { id: 'email', label: 't.email', type: 'email', req: true, ac: 'email' },
      { id: 'what', label: 't.what', type: 'text', req: true, ph: 't.what.ph' },
      { id: 'portions', label: 't.portions', type: 'number', req: true },
      { id: 'slot', label: 't.time', select: [['before', 't.time.before'], ['during', 't.time.during'], ['after', 't.time.after']] },
      { checks: 'allergens', label: 't.allergens', opts: [['nuts', 'al.nuts'], ['milk', 'al.milk'], ['gluten', 'al.gluten'], ['egg', 'al.egg'], ['sesame', 'al.sesame']] },
      { tick: 'vehicle', label: 't.vehicle' },
      { tick: 'halal', label: 't.halal', req: true },
      { note: 't.note' }
    ] },
    myqr: { title: 'q.title', send: 'q.send', api: 'api/tabarruk/qr', fields: [
      { id: 'ref', label: 'q.ref', type: 'text', req: true, ph: 'T0001' },
      { id: 'phone', label: 'fm.phone', type: 'tel', req: true }
    ] }
  };

  var dlg = $('#dlg'), current = null, coords = null;

  function field(id, labelKey, input, req) {
    return h('div', { class: 'field' }, [h('label', { for: id, text: t(labelKey) + (req ? ' *' : '') }), input]);
  }

  function openForm(key) {
    var f = FORMS[key]; if (!f) return;
    current = key; coords = null;
    $('#dlg-title').textContent = t(f.title);
    $('#dlg-submit').textContent = t(f.send);
    $('#dlg-submit').hidden = false;
    $('#dlg-msg').textContent = '';
    $('#dlg-close').setAttribute('aria-label', t('dlg.close'));
    var body = $('#dlg-body'); body.textContent = '';
    f.fields.forEach(function (fd) {
      if (fd.note) { body.appendChild(h('p', { class: 'note' + (fd.red ? ' red' : ''), text: t(fd.note) })); return; }
      if (fd.geo) {
        body.appendChild(h('button', { type: 'button', class: 'btn ghostdark', text: t('m.geo'), onclick: function (e) {
          var btn = e.currentTarget;
          if (!navigator.geolocation) { btn.textContent = t('m.geo.no'); return; }
          btn.textContent = t('m.geo.finding');
          navigator.geolocation.getCurrentPosition(function (p) {
            coords = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy };
            btn.textContent = t('m.geo.ok');
          }, function () { btn.textContent = t('m.geo.no'); }, { enableHighAccuracy: true, timeout: 10000 });
        } }));
        return;
      }
      if (fd.radio) {
        var seg = h('div', { class: 'seg', role: 'radiogroup' });
        fd.opts.forEach(function (o, i) {
          var id = 'f-' + fd.radio + i;
          seg.appendChild(h('label', { for: id }, [h('input', { type: 'radio', name: fd.radio, id: id, value: o[0], checked: i === 0 }), t(o[1])]));
        });
        body.appendChild(seg); return;
      }
      if (fd.select) {
        var sel = h('select', { id: 'f-' + fd.id, name: fd.id });
        fd.select.forEach(function (o) { sel.appendChild(h('option', { value: o[0], text: t(o[1]) })); });
        body.appendChild(field('f-' + fd.id, fd.label, sel)); return;
      }
      if (fd.checks) {
        var box = h('div', { class: 'checks' });
        fd.opts.forEach(function (o) { box.appendChild(h('label', null, [h('input', { type: 'checkbox', name: fd.checks, value: o[0] }), t(o[1])])); });
        body.appendChild(h('fieldset', { class: 'field', style: 'border:0;padding:0;margin:0' }, [h('legend', { class: 'small', style: 'font-weight:600;margin-bottom:6px', text: t(fd.label) }), box]));
        return;
      }
      if (fd.tick) {
        body.appendChild(h('label', { class: 'tick' }, [h('input', { type: 'checkbox', name: fd.tick, value: 'yes', required: fd.req }), t(fd.label) + (fd.req ? ' *' : '')]));
        return;
      }
      var id = 'f-' + fd.id;
      var input = fd.type === 'textarea' ? h('textarea', { id: id, name: fd.id }) : h('input', { id: id, name: fd.id, type: fd.type });
      if (fd.ph) input.setAttribute('placeholder', fd.ph.indexOf('.') > -1 ? t(fd.ph) : fd.ph);
      if (fd.val) input.value = fd.val;
      if (fd.req) input.required = true;
      if (fd.ac) input.setAttribute('autocomplete', fd.ac);
      if (fd.type === 'tel') { input.setAttribute('autocomplete', 'tel'); input.setAttribute('dir', 'ltr'); }
      if (fd.type === 'email') input.setAttribute('dir', 'ltr');
      if (fd.type === 'number') { input.setAttribute('min', '0'); input.setAttribute('inputmode', 'numeric'); }
      body.appendChild(field(id, fd.label, input, fd.req));
    });
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
    var first = $('input:not([type=radio]),textarea', body); if (first) first.focus();
  }

  function closeForm() { if (dlg.open) dlg.close(); else dlg.removeAttribute('open'); }

  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-open]');
    if (b) openForm(b.getAttribute('data-open'));
  });
  $('#dlg-close').addEventListener('click', closeForm);
  $('#dlg-cancel').addEventListener('click', closeForm);

  function showQR(text, caption) {
    var body = $('#dlg-body'); body.textContent = '';
    var qr = window.qrcode(0, 'M'); qr.addData(text); qr.make();
    var img = h('img', { src: qr.createDataURL(8, 4), alt: 'QR code ' + caption });
    body.appendChild(h('div', { class: 'qrbox' }, [img, h('b', { text: caption })]));
    $('#dlg-submit').hidden = true;
  }

  $('#dlg-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var form = e.currentTarget, f = FORMS[current];
    var missing = $$('[required]', form).filter(function (i) { return i.type === 'checkbox' ? !i.checked : !i.value.trim(); });
    if (missing.length) { $('#dlg-msg').textContent = t('dlg.required'); missing[0].focus(); return; }
    var payload = { type: current, lang: lang, at: new Date().toISOString(), coords: coords, fields: {} };
    $$('input,textarea,select', form).forEach(function (i) {
      if (!i.name) return;
      if (i.type === 'radio') { if (i.checked) payload.fields[i.name] = i.value; }
      else if (i.type === 'checkbox') { if (i.checked) (payload.fields[i.name] = payload.fields[i.name] || []).push(i.value); }
      else payload.fields[i.name] = i.value.trim();
    });
    var btn = $('#dlg-submit'); btn.disabled = true; btn.textContent = t('dlg.sending');
    fetch(f.api, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (res) {
        if (current === 'myqr' && res && res.qr) { showQR(res.qr, res.ref + (res.slot ? ' · ' + res.slot : '')); return; }
        closeForm();
        toast(t('dlg.sent') + (res && res.ref ? ' (' + res.ref + ')' : '') + '.');
      })
      .catch(function () { $('#dlg-msg').textContent = t('dlg.notconnected'); })
      .then(function () { btn.disabled = false; btn.textContent = t(f.send); });
  });

  /* ---------- Invite, coming-soon links ---------- */
  $('#invite-btn').addEventListener('click', function () {
    var url = location.href.split('#')[0] + '#volunteer', text = t('invite.text');
    if (navigator.share) { navigator.share({ title: 'Arbaeen UK', text: text, url: url }).catch(function () {}); return; }
    if (navigator.clipboard) navigator.clipboard.writeText(text + ' ' + url).then(function () { toast(t('invite.copied')); }, function () { toast(url); });
    else toast(url);
  });
  $$('[data-soon]').forEach(function (a) { a.addEventListener('click', function (e) { e.preventDefault(); toast(t(a.getAttribute('data-soon'))); }); });
  $$('a[href="#stall-request"]').forEach(function (a) { a.addEventListener('click', function (e) { e.preventDefault(); toast(t('soon.stall')); }); });

  /* ---------- Install app ---------- */
  var isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var isStandalone = !!(window.navigator.standalone || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches));
  var deferredPrompt = null;

  function showInstallButtons(show) { $$('.install-btn').forEach(function (b) { b.hidden = !show; }); }
  showInstallButtons(!isStandalone);

  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); deferredPrompt = e; showInstallButtons(true); });
  window.addEventListener('appinstalled', function () { deferredPrompt = null; showInstallButtons(false); toast(t('inst.done')); });

  function openModal(d) { if (typeof d.showModal === 'function') { if (!d.open) d.showModal(); } else d.setAttribute('open', ''); }
  function closeModal(d) { if (d.open && d.close) d.close(); else d.removeAttribute('open'); }

  function install() {
    if (deferredPrompt) {
      var p = deferredPrompt; deferredPrompt = null;
      p.prompt();
      (p.userChoice || Promise.resolve({})).then(function (c) { if (c && c.outcome === 'accepted') showInstallButtons(false); });
      return;
    }
    $('#inst-ios').hidden = !isIOS; $('#inst-other').hidden = isIOS;
    $('#inst-close').setAttribute('aria-label', t('dlg.close'));
    if ($('#guide').open) closeModal($('#guide'));
    openModal($('#inst'));
  }
  document.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('.install-btn')) install(); });
  $('#inst-close').addEventListener('click', function () { closeModal($('#inst')); });
  $('#inst-done').addEventListener('click', function () { closeModal($('#inst')); });

  /* ---------- First-time guide ---------- */
  var gd = $('#guide'), slide = 0, SLIDES = 5;
  function guideRender() {
    $$('.g-slide', gd).forEach(function (el) { el.hidden = Number(el.getAttribute('data-slide')) !== slide; });
    $$('#g-dots i').forEach(function (d, i) { d.className = i === slide ? 'on' : ''; });
    $('#g-count').textContent = t('guide.count', { n: slide + 1 });
    $('#g-back').style.visibility = slide === 0 ? 'hidden' : 'visible';
    $('#g-next').textContent = t(slide === SLIDES - 1 ? 'guide.start' : 'guide.next');
    $$('.g-langs button', gd).forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-lang') === lang)); });
  }
  window.__guideRefresh = function () { if (gd.open) guideRender(); };
  function openGuide() { slide = 0; guideRender(); openModal(gd); $('#g-next').focus(); }
  function closeGuide() { closeModal(gd); try { localStorage.setItem('guideSeen', '1'); } catch (e) {} }
  $('#g-next').addEventListener('click', function () { if (slide < SLIDES - 1) { slide++; guideRender(); } else closeGuide(); });
  $('#g-back').addEventListener('click', function () { if (slide > 0) { slide--; guideRender(); } });
  $('#g-skip').addEventListener('click', closeGuide);
  gd.addEventListener('close', function () { try { localStorage.setItem('guideSeen', '1'); } catch (e) {} });
  $$('.g-langs button', gd).forEach(function (b) { b.addEventListener('click', function () { setLang(b.getAttribute('data-lang')); guideRender(); }); });
  $('#guide-open').addEventListener('click', openGuide);
  // let people swipe between steps on phones
  var sx = null;
  gd.addEventListener('touchstart', function (e) { sx = e.touches[0].clientX; }, { passive: true });
  gd.addEventListener('touchend', function (e) {
    if (sx === null) return; var dx = e.changedTouches[0].clientX - sx; sx = null;
    if (Math.abs(dx) < 50) return;
    var forward = (document.documentElement.dir === 'rtl') ? dx > 0 : dx < 0;
    if (forward && slide < SLIDES - 1) slide++; else if (!forward && slide > 0) slide--;
    guideRender();
  });

  var guideSeen = false;
  try { guideSeen = localStorage.getItem('guideSeen') === '1'; } catch (e) { guideSeen = true; }
  if (!guideSeen) setTimeout(openGuide, 600);

  /* ---------- iPhone add-to-home-screen tip ---------- */
  try {
    if (isIOS && !isStandalone && guideSeen && localStorage.getItem('iosTip') !== 'no') setTimeout(function () { $('#ios-tip').hidden = false; }, 4000);
    $('#ios-tip-close').addEventListener('click', function () { $('#ios-tip').hidden = true; try { localStorage.setItem('iosTip', 'no'); } catch (e) {} });
    $('#tip-how').addEventListener('click', function () { $('#ios-tip').hidden = true; install(); });
  } catch (e) {}

  /* ---------- Offline + notifications groundwork ---------- */
  try {
    if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(function () {});
  } catch (e) {}
})();
