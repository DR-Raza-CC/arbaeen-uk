/**
 * Arbaeen UK – Stalls sheet → website.
 *
 * Paste this into the stalls Google Sheet: Extensions → Apps Script.
 * Then Project Settings → Script properties → add ADMIN_KEY (a long password for admins).
 * Deploy → New deployment → Web app → Execute as: Me, Who has access: Anyone.
 * Copy the web app URL into data/event.json → "stallsApi".
 *
 * Public GET  …/exec                → approved stalls shown on site (no private columns)
 * Admin  POST {action:'list', key}   → every stall incl. requested/unplaced, gas, vehicle access
 * Admin  POST {action:'move', key, id, row, col}  → moves a stall (checks it fits and doesn't overlap)
 * Admin  POST {action:'unplace', key, id}         → takes a stall off the map
 */

var STALLS = 'Stalls', TYPES = 'Stall types', SETTINGS = 'Map settings';
var PUBLIC_CACHE = 'public-v1';

function doGet() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get(PUBLIC_CACHE);
  if (hit) return json_(JSON.parse(hit));
  var data = publicData_();
  cache.put(PUBLIC_CACHE, JSON.stringify(data), 60);
  return json_(data);
}

function doPost(e) {
  var body = {};
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'Bad request' }); }
  var key = PropertiesService.getScriptProperties().getProperty('ADMIN_KEY');
  if (!key || body.key !== key) return json_({ ok: false, error: 'Wrong admin key' });

  if (body.action === 'list') return json_(adminData_());

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    if (body.action === 'move') return json_(move_(String(body.id), String(body.row || '').toUpperCase(), Number(body.col)));
    if (body.action === 'unplace') return json_(move_(String(body.id), '', 0));
    return json_({ ok: false, error: 'Unknown action' });
  } finally {
    lock.releaseLock();
    CacheService.getScriptCache().remove(PUBLIC_CACHE);
  }
}

/* ---------- reading ---------- */

function settings_() {
  var rows = SpreadsheetApp.getActive().getSheetByName(SETTINGS).getDataRange().getValues();
  var s = {};
  rows.slice(1).forEach(function (r) { s[String(r[0]).trim()] = r[1]; });
  return {
    rows: String(s['Rows'] || 'A').split(',').map(function (x) { return x.trim().toUpperCase(); }).filter(String),
    cols: Number(s['Columns']) || 12,
    note: String(s['Map note'] || ''),
    officialCharities: String(s['Official charities'] || '').split(',').map(function (x) { return x.trim(); }).filter(String)
  };
}

function types_() {
  var rows = SpreadsheetApp.getActive().getSheetByName(TYPES).getDataRange().getValues();
  return rows.slice(1).filter(function (r) { return r[0]; }).map(function (r) {
    return {
      key: String(r[0]).trim(),
      label: { en: r[1] || r[0], ur: r[2] || r[1], ar: r[3] || r[1], fa: r[4] || r[1] },
      bg: r[5] || '#E8C477', fg: r[6] || '#1A1414',
      filter: String(r[7]).toLowerCase() !== 'no'
    };
  });
}

function rows_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(STALLS);
  var v = sh.getDataRange().getValues();
  return v.slice(1).map(function (r, i) {
    return {
      sheetRow: i + 2,
      id: String(r[0]).trim(), name: String(r[1]), type: String(r[2]).trim(), serves: String(r[3]),
      website: String(r[4]), row: String(r[5]).trim().toUpperCase(), col: Number(r[6]) || 0,
      span: Math.max(1, Number(r[7]) || 1), status: String(r[8]).trim(), show: String(r[9]).trim().toLowerCase() === 'yes',
      gas: String(r[10]), vehicleRequested: String(r[11]), vehicle: String(r[12]),
      arrival: fmtTime_(r[13]), cleanup: fmtTime_(r[14])
    };
  }).filter(function (s) { return s.id; });
}

function fmtTime_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, 'Europe/London', 'HH:mm');
  return String(v || '');
}

function publicData_() {
  var st = settings_();
  var stalls = rows_().filter(function (s) { return s.status === 'Approved' && s.show && s.row && s.col; })
    .map(function (s) {
      return { id: s.id, name: s.name, type: s.type, serves: s.serves,
               website: /^https?:\/\//.test(s.website) ? s.website : '', row: s.row, col: s.col, span: s.span };
    });
  return { ok: true, updated: new Date().toISOString(), stallMap: { rows: st.rows, cols: st.cols, note: st.note },
           officialCharities: st.officialCharities, types: types_(), stalls: stalls };
}

function adminData_() {
  var st = settings_();
  // Admin view: everything needed to place stalls. Contact details stay in the sheet.
  var stalls = rows_().map(function (s) {
    return { id: s.id, name: s.name, type: s.type, serves: s.serves, row: s.row, col: s.col, span: s.span,
             status: s.status, show: s.show, gas: s.gas, vehicleRequested: s.vehicleRequested, vehicle: s.vehicle,
             arrival: s.arrival, cleanup: s.cleanup };
  });
  return { ok: true, stallMap: { rows: st.rows, cols: st.cols, note: st.note }, types: types_(), stalls: stalls };
}

/* ---------- moving ---------- */

function move_(id, row, col) {
  var st = settings_(), all = rows_();
  var me = all.filter(function (s) { return s.id === id; })[0];
  if (!me) return { ok: false, error: 'No stall with ID ' + id };
  if (row) {
    if (st.rows.indexOf(row) < 0) return { ok: false, error: 'Row ' + row + ' is not on the map' };
    if (!(col >= 1 && col + me.span - 1 <= st.cols)) return { ok: false, error: id + ' is ' + me.span + ' blocks wide and does not fit there' };
    var clash = all.filter(function (s) {
      return s.id !== id && s.row === row && s.col && s.status !== 'Declined' &&
             col <= s.col + s.span - 1 && s.col <= col + me.span - 1;
    })[0];
    if (clash) return { ok: false, error: 'That space overlaps ' + clash.id + ' (' + clash.name + ')' };
  }
  var sh = SpreadsheetApp.getActive().getSheetByName(STALLS);
  sh.getRange(me.sheetRow, 6, 1, 2).setValues([[row, row ? col : '']]);
  return { ok: true, id: id, row: row, col: row ? col : 0 };
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
