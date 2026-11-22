// Runs apps-script/Code.gs against a fake spreadsheet. Prints JSON results for run_tests.py.
const fs = require('fs'), vm = require('vm'), path = require('path');
const code = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');

function makeEnv() {
  const sheets = {
    'Stalls': [
      ['Stall ID', 'Name', 'Type', 'Serves', 'Website', 'Row', 'Column', 'Blocks wide', 'Status', 'Show on site', 'Gas', 'Veh req', 'Vehicle', 'Arrive', 'Clean', 'Contact', 'Phone', 'Email', 'Notes'],
      ['S001', 'Food one', 'food', 'Rice', 'https://a.org', 'A', 1, 2, 'Approved', 'Yes', 'Yes', 'No', '', '', '', 'Ali', '07700900001', 'ali@x.com', 'secret'],
      ['S002', 'Hidden', 'food', 'Tea', '', 'A', 4, 1, 'Approved', 'No', 'No', 'No', '', '', '', 'B', '07700900002', '', ''],
      ['S003', 'Waiting', 'drink', 'Juice', 'javascript:alert(1)', '', '', 1, 'Requested', 'No', 'No', 'Yes', 'Pending', '', '', 'C', '07700900003', '', ''],
      ['S004', 'Charity', 'charity', 'Help', 'javascript:alert(1)', 'B', 2, 3, 'Approved', 'Yes', 'No', 'No', '', '', '', 'D', '', '', ''],
      ['S005', 'Declined one', 'food', 'X', '', 'A', 6, 1, 'Declined', 'No', 'No', 'No', '', '', '', '', '', '', '']
    ],
    'Stall types': [['Type', 'en', 'ur', 'ar', 'fa', 'bg', 'fg', 'filter'], ['food', 'Food', 'کھانا', 'طعام', 'غذا', '#E8C477', '#1A1414', 'Yes'], ['drink', 'Drinks', '', '', '', '#F3E0B0', '#1A1414', 'Yes'], ['charity', 'Charity', '', '', '', '#CFE0F3', '#123A66', 'Yes']],
    'Map settings': [['Setting', 'Value'], ['Rows', 'A, B'], ['Columns', 8], ['Map note', 'Note here'], ['Official charities', 'One, Two']]
  };
  const writes = [];
  const sheet = (name) => ({
    getDataRange: () => ({ getValues: () => sheets[name].map(r => r.slice()) }),
    getRange: (r, c, nr, nc) => ({ setValues: (v) => { writes.push({ name, r, c, v }); v.forEach((row, i) => row.forEach((val, j) => { sheets[name][r - 1 + i][c - 1 + j] = val; })); } })
  });
  const cache = {};
  const ctx = {
    SpreadsheetApp: { getActive: () => ({ getSheetByName: sheet }) },
    CacheService: { getScriptCache: () => ({ get: k => cache[k] || null, put: (k, v) => { cache[k] = v; }, remove: k => { delete cache[k]; } }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'letmein' }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ s, setMimeType() { return this; } }) },
    Utilities: { formatDate: () => '00:00' },
    JSON, Date, String, Number, Math
  };
  vm.createContext(ctx); vm.runInContext(code, ctx);
  return { ctx, sheets, writes, cache };
}
const out = [];
const ok = (name, pass, detail) => out.push({ name, pass: !!pass, detail: pass ? '' : JSON.stringify(detail) });
const post = (env, body) => JSON.parse(env.ctx.doPost({ postData: { contents: JSON.stringify(body) } }).s);

let env = makeEnv();
const pub = JSON.parse(env.ctx.doGet().s);
ok('public list shows only approved stalls marked "Show on site" and placed', pub.stalls.map(s => s.id).join() === 'S001,S004', pub.stalls.map(s => s.id));
const flat = JSON.stringify(pub);
ok('public data never contains contact names, phones, emails or notes', !/Ali|07700|ali@x|secret/.test(flat), flat.slice(0, 200));
ok('public data never contains gas or vehicle info', !/vehicle|gas/i.test(flat), '');
ok('map settings read (rows A,B; 8 columns; note)', pub.stallMap.rows.join() === 'A,B' && pub.stallMap.cols === 8 && pub.stallMap.note === 'Note here', pub.stallMap);
ok('official charities split into a list', pub.officialCharities.join('|') === 'One|Two', pub.officialCharities);
ok('stall types with colours and labels', pub.types.length === 3 && pub.types[0].bg === '#E8C477' && pub.types[0].label.ur === 'کھانا', pub.types[0]);
ok('missing translations fall back to English', pub.types[1].label.ur === 'Drinks', pub.types[1].label);
ok('unsafe website links are dropped', pub.stalls[1].website === '' && pub.stalls[0].website === 'https://a.org', pub.stalls);
ok('public answer is cached for a minute', !!env.cache['public-v1'], '');

ok('wrong admin key is refused', post(env, { action: 'list', key: 'nope' }).error === 'Wrong admin key', '');
const adm = post(env, { action: 'list', key: 'letmein' });
ok('admin list includes requested and hidden stalls', adm.stalls.length === 5, adm.stalls.length);
ok('admin list has gas and vehicle info', adm.stalls[2].vehicleRequested === 'Yes' && adm.stalls[0].gas === 'Yes', adm.stalls[2]);
ok('admin list still has no contact details', !/Ali|07700|ali@x|secret/.test(JSON.stringify(adm)), '');

let r = post(env, { action: 'move', key: 'letmein', id: 'S003', row: 'b', col: 6 });
ok('move a waiting stall onto a free block (lower-case row accepted)', r.ok && env.sheets.Stalls[3][5] === 'B' && env.sheets.Stalls[3][6] === 6, r);
ok('moving clears the public cache so the site updates', !env.cache['public-v1'], '');
r = post(env, { action: 'move', key: 'letmein', id: 'S001', row: 'B', col: 3 });
ok('overlapping another stall is refused', !r.ok && /overlaps S004/.test(r.error), r);
r = post(env, { action: 'move', key: 'letmein', id: 'S004', row: 'A', col: 7 });
ok('a 3-block stall that runs off the end is refused', !r.ok && /does not fit/.test(r.error), r);
r = post(env, { action: 'move', key: 'letmein', id: 'S001', row: 'Z', col: 1 });
ok('a row not on the map is refused', !r.ok && /not on the map/.test(r.error), r);
r = post(env, { action: 'move', key: 'letmein', id: 'S001', row: 'A', col: 6 });
ok('a declined stall does not block the space', r.ok, r);
r = post(env, { action: 'move', key: 'letmein', id: 'S001', row: 'A', col: 2 });
ok('a stall can move one block along, over its own old space', r.ok, r);
r = post(env, { action: 'move', key: 'letmein', id: 'S999', row: 'A', col: 1 });
ok('unknown stall ID is refused', !r.ok, r);
r = post(env, { action: 'unplace', key: 'letmein', id: 'S004' });
ok('take a stall off the map clears its row and column', r.ok && env.sheets.Stalls[4][5] === '' && env.sheets.Stalls[4][6] === '', env.sheets.Stalls[4]);
ok('bad request body is refused', JSON.parse(env.ctx.doPost({ postData: { contents: 'not json' } }).s).ok === false, '');
ok('only Row and Column cells are ever written', env.writes.every(w => w.c === 6 && w.v[0].length === 2), env.writes);
console.log(JSON.stringify(out));
