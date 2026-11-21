/* Arbaeen UK staff scanner: reads volunteer, stall and tabarruk QR codes.
   Code format: ARBUK:V:V0001 (volunteer) · ARBUK:S:A6 (stall) · ARBUK:T:T0001 (tabarruk).
   A plain V0001 / S-A6 / T0001 typed by hand also works. */
(function () {
  'use strict';
  var $ = function (s) { return document.querySelector(s); };

  var KINDS = {
    V: { name: 'Volunteer', bg: '#F6EBD3', fg: '#8A6420',
         acts: [['checkin', 'Check in', 'red'], ['checkout', 'Check out', 'dark'], ['badge', 'Badge given', 'gold']] },
    S: { name: 'Stall', bg: '#E3EDF8', fg: '#1F5FA8',
         acts: [['arrived', 'Arrived', 'red'], ['vehicle', 'Vehicle let in', 'dark'], ['cleared', 'Cleaned up & left', 'gold']] },
    T: { name: 'Tabarruk drop-off', bg: '#E5F1EA', fg: '#1E5A40',
         acts: [['received', 'Received', 'red'], ['refused', 'Not accepted', 'dark']] }
  };

  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') el.textContent = attrs[k];
      else if (k === 'class') el.className = attrs[k];
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), attrs[k]);
      else el.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return el;
  }
  function toast(m) { var t = $('#toast'); t.textContent = m; t.hidden = false; clearTimeout(toast.x); toast.x = setTimeout(function () { t.hidden = true; }, 3500); }

  function parse(raw) {
    var s = String(raw || '').trim().toUpperCase();
    var m = s.match(/^ARBUK:([VST]):([A-Z0-9-]{1,12})$/);
    if (m) return { kind: m[1], id: m[2] };
    if (/^V\d{4,6}$/.test(s)) return { kind: 'V', id: s };
    if (/^T\d{4,6}$/.test(s)) return { kind: 'T', id: s };
    m = s.match(/^S-?([A-Z]\d{1,2})$/); if (m) return { kind: 'S', id: m[1] };
    return null;
  }

  /* ---------- Result card ---------- */
  function show(code) {
    var r = $('#result'); r.hidden = false; r.textContent = '';
    if (!code) {
      r.appendChild(h('p', { class: 'note red', text: 'Not an Arbaeen UK code. Ask them to open their QR in the app or email.' }));
      return;
    }
    var k = KINDS[code.kind];
    var tag = h('span', { class: 'kind', text: k.name.toUpperCase() }); tag.style.background = k.bg; tag.style.color = k.fg;
    r.appendChild(tag);
    r.appendChild(h('p', { class: 'id', text: code.id }));
    var info = h('p', { class: 'muted small', text: 'Looking up details…' });
    r.appendChild(info);
    var acts = h('div', { class: 'acts' });
    k.acts.forEach(function (a) {
      acts.appendChild(h('button', { type: 'button', class: 'btn ' + a[2], text: a[1], onclick: function () { record(code, a[0], a[1]); } }));
    });
    r.appendChild(acts);
    fetch('api/scan?code=' + encodeURIComponent('ARBUK:' + code.kind + ':' + code.id))
      .then(function (res) { if (!res.ok) throw new Error(res.status); return res.json(); })
      .then(function (d) { info.textContent = d.summary || ''; })
      .catch(function () { info.textContent = 'Details lookup is not connected yet (preview). Names, times and approvals show here once the database is live.'; });
    r.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  /* ---------- Record an action (queued if offline) ---------- */
  var log = [];
  function record(code, action, label) {
    var entry = { code: 'ARBUK:' + code.kind + ':' + code.id, action: action, at: new Date().toISOString(), label: code.id + ' · ' + label, status: 'Sending…' };
    log.unshift(entry); renderLog();
    send(entry);
  }
  function send(entry) {
    fetch('api/scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: entry.code, action: entry.action, at: entry.at }) })
      .then(function (res) {
        if (res.ok) { entry.status = 'Saved ✓'; toast(entry.label + ' saved'); }
        else { entry.status = 'Not connected (preview)'; toast('Recorded on this phone only: the database is not connected yet.'); }
      })
      .catch(function () { entry.status = 'No signal: will send later'; queue(entry); toast('No signal. Saved on this phone and will send when back online.'); })
      .then(renderLog);
  }
  function queue(entry) {
    try { var q = JSON.parse(localStorage.getItem('scanQueue') || '[]'); q.push(entry); localStorage.setItem('scanQueue', JSON.stringify(q)); } catch (e) {}
  }
  window.addEventListener('online', function () {
    try {
      var q = JSON.parse(localStorage.getItem('scanQueue') || '[]'); localStorage.setItem('scanQueue', '[]');
      q.forEach(send);
    } catch (e) {}
  });
  function renderLog() {
    var ul = $('#log'); ul.textContent = '';
    if (!log.length) { ul.appendChild(h('li', { text: 'Nothing scanned yet' })); return; }
    log.slice(0, 30).forEach(function (e) {
      ul.appendChild(h('li', null, [h('b', { text: e.label }), h('span', { text: new Date(e.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) + ' · ' + e.status })]));
    });
  }

  /* ---------- Camera ---------- */
  var video = $('#video'), stream = null, detector = null, canvas = document.createElement('canvas'), ctx = canvas.getContext('2d', { willReadFrequently: true });
  var paused = false, last = '', lastAt = 0;

  function startCam() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { $('#cam-msg').textContent = 'This browser cannot use the camera. Type the code below instead.'; return; }
    $('#cam-msg').textContent = 'Allow camera access when asked.';
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then(function (s) {
        stream = s; video.srcObject = s; video.hidden = false; $('#frame').hidden = false; $('#idle').hidden = true;
        return video.play();
      })
      .then(function () {
        if ('BarcodeDetector' in window) { try { detector = new window.BarcodeDetector({ formats: ['qr_code'] }); } catch (e) { detector = null; } }
        requestAnimationFrame(tick);
      })
      .catch(function () { $('#cam-msg').textContent = 'Camera blocked. Allow it in your browser settings, or type the code below.'; });
  }

  function found(text) {
    var now = Date.now();
    if (text === last && now - lastAt < 4000) return;
    last = text; lastAt = now;
    if (navigator.vibrate) navigator.vibrate(80);
    show(parse(text));
  }

  function tick() {
    if (!stream) return;
    if (!paused && video.readyState >= 2) {
      if (detector) {
        detector.detect(video).then(function (codes) { if (codes[0]) found(codes[0].rawValue); }).catch(function () { detector = null; });
      } else if (window.jsQR) {
        var w = video.videoWidth, hh = video.videoHeight, sz = Math.min(w, hh, 720);
        canvas.width = sz; canvas.height = sz;
        ctx.drawImage(video, (w - Math.min(w, hh)) / 2, (hh - Math.min(w, hh)) / 2, Math.min(w, hh), Math.min(w, hh), 0, 0, sz, sz);
        var img = ctx.getImageData(0, 0, sz, sz);
        var res = window.jsQR(img.data, sz, sz, { inversionAttempts: 'dontInvert' });
        if (res && res.data) found(res.data);
      }
    }
    setTimeout(function () { requestAnimationFrame(tick); }, 180);
  }

  $('#start').addEventListener('click', startCam);
  $('#manual').addEventListener('submit', function (e) { e.preventDefault(); show(parse($('#code').value)); });

  /* ---------- Sample codes ---------- */
  [['ARBUK:V:V0001', 'Volunteer V0001'], ['ARBUK:S:A6', 'Stall A6'], ['ARBUK:T:T0001', 'Tabarruk T0001']].forEach(function (s) {
    var qr = window.qrcode(0, 'M'); qr.addData(s[0]); qr.make();
    var b = h('button', { type: 'button', style: 'background:none;border:0;color:inherit;cursor:pointer;padding:0;font:inherit', onclick: function () { found(s[0] + ''); last = ''; } },
      [h('img', { src: qr.createDataURL(6, 2), alt: 'Sample QR ' + s[1] }), h('div', { text: s[1] })]);
    $('#samples').appendChild(b);
  });
})();
