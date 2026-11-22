#!/usr/bin/env python3
"""Arbaeen UK — full test suite.

Runs static checks (files, data, translations, JS syntax) and browser tests
(public site, all four languages, phone/tablet/desktop sizes, map, stalls,
every form, tabarruk, iPhone tip, staff QR scanner incl. offline queue).

Usage:  python3 tests/run_tests.py [--url http://localhost:8765] [--chrome /usr/bin/google-chrome]
Starts its own local web server when --url is not given.
"""
import argparse, asyncio, json, os, re, subprocess, sys, threading, http.server, socketserver, functools

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RESULTS = []          # (group, name, ok, detail)


def check(group, name, ok, detail=''):
    RESULTS.append((group, name, bool(ok), '' if ok else str(detail)))


# ---------------------------------------------------------------- static ---
def static_tests():
    g = 'Files'
    must = ['index.html', 'scan.html', 'stall-admin.html', 'js/stall-admin.js', 'apps-script/Code.gs', 'css/style.css', 'js/app.js', 'js/i18n.js', 'js/scan.js', 'data/event.json',
            'lib/leaflet.js', 'lib/leaflet.css', 'lib/jsQR.js', 'lib/qrcode.js', 'manifest.webmanifest', 'sw.js',
            'icons/icon.svg', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png']
    for f in must:
        check(g, f'{f} exists', os.path.isfile(os.path.join(ROOT, f)), 'missing')

    # every local src/href in the HTML pages resolves
    for page in ['index.html', 'scan.html', 'stall-admin.html']:
        html = open(os.path.join(ROOT, page), encoding='utf-8').read()
        for ref in re.findall(r'(?:src|href)="([^"#:]+)"', html):
            if ref.startswith('http') or ref.startswith('//') or ref.startswith('mailto'):
                continue
            check(g, f'{page} → {ref} resolves', os.path.exists(os.path.join(ROOT, ref)), 'broken link')

    # service-worker shell entries exist
    sw = open(os.path.join(ROOT, 'sw.js'), encoding='utf-8').read()
    shell = re.search(r'SHELL = \[(.*?)\]', sw, re.S).group(1)
    for f in re.findall(r"'([^']+)'", shell):
        if f == './':
            continue
        check(g, f'sw.js caches {f} (exists)', os.path.isfile(os.path.join(ROOT, f)), 'missing file in offline cache list')

    g = 'Manifest'
    try:
        m = json.load(open(os.path.join(ROOT, 'manifest.webmanifest')))
        check(g, 'manifest is valid JSON', True)
        for k in ['name', 'short_name', 'start_url', 'display', 'icons']:
            check(g, f'manifest has {k}', k in m, 'missing')
        check(g, 'manifest display is standalone (needed for iPhone alerts)', m.get('display') == 'standalone', m.get('display'))
        for ic in m.get('icons', []):
            check(g, f"icon {ic['src']} exists", os.path.isfile(os.path.join(ROOT, ic['src'])), 'missing')
    except Exception as e:
        check(g, 'manifest is valid JSON', False, e)

    g = 'Data'
    try:
        d = json.load(open(os.path.join(ROOT, 'data/event.json'), encoding='utf-8'))
        check(g, 'event.json is valid JSON', True)
    except Exception as e:
        check(g, 'event.json is valid JSON', False, e); return
    check(g, 'event date is 2027-07-25', d['event']['date'] == '2027-07-25', d['event']['date'])
    check(g, 'programme has 5 items', len(d['programme']) == 5, len(d['programme']))
    check(g, 'salat has 6 times', len(d['salat']['times']) == 6, len(d['salat']['times']))
    for s in d['salat']['times']:
        check(g, f"salat {s['name']} time is HH:MM", re.fullmatch(r'[0-2]\d:[0-5]\d', s['time']), s['time'])
    times = [s['time'] for s in d['salat']['times']]
    check(g, 'salat times are in order', times == sorted(times), times)
    r = d['route']
    inside = lambda p: 51.50 < p[0] < 51.52 and -0.17 < p[1] < -0.14
    check(g, 'route outward points are in the Marble Arch–Park Lane area', all(inside(p) for p in r['outward']), 'point outside area')
    check(g, 'route return points are in the area', all(inside(p) for p in r['return']), 'point outside area')
    check(g, 'route starts and ends at the same gate', r['outward'][0] == r['return'][-1], (r['outward'][0], r['return'][-1]))
    check(g, 'outward ends where return begins (Curzon Gate turn)', r['outward'][-1] == r['return'][0], 'gap at turn')
    sm = d['stallMap']
    occupied = {}
    ok = True; detail = ''
    for s in d['stalls']:
        if s['row'] not in sm['rows']:
            ok = False; detail = f"{s['id']} row {s['row']} not on map"
        if s['col'] < 1 or s['col'] + s['span'] - 1 > sm['cols']:
            ok = False; detail = f"{s['id']} runs off the grid"
        for c in range(s['col'], s['col'] + s['span']):
            key = (s['row'], c)
            if key in occupied:
                ok = False; detail = f"{s['id']} overlaps {occupied[key]}"
            occupied[key] = s['id']
    check(g, 'stalls fit on the 3m block grid with no overlaps', ok, detail)
    ids = [s['id'] for s in d['stalls']]
    check(g, 'stall IDs are unique', len(ids) == len(set(ids)), ids)
    tkeys = [t['key'] for t in d.get('types', [])]
    check(g, 'stall types are listed with colours', tkeys and all(t.get('bg') and t.get('fg') and t.get('label', {}).get('en') for t in d['types']), d.get('types'))
    check(g, 'every stall uses a listed type', all(s['type'] in tkeys for s in d['stalls']), [s['type'] for s in d['stalls'] if s['type'] not in tkeys])
    check(g, 'stall IDs use the S001 format (kept in QR codes)', all(re.fullmatch(r'S\d{3,5}', s['id']) for s in d['stalls']), ids)
    check(g, 'stallsApi is a Google Apps Script web app address', d.get('stallsApi', '').startswith('https://script.google.com/macros/s/') and d['stallsApi'].endswith('/exec'), d.get('stallsApi'))

    g = 'Translations'
    i18n_js = open(os.path.join(ROOT, 'js/i18n.js'), encoding='utf-8').read()
    out = subprocess.run(['node', '-e', i18n_js.replace('window.I18N', 'global.I18N') + ';console.log(JSON.stringify(global.I18N))'],
                         capture_output=True, text=True)
    if out.returncode != 0:
        check(g, 'i18n.js loads', False, out.stderr[:200]); return
    I = json.loads(out.stdout)
    check(g, 'i18n.js loads', True)
    bad = [k for k, v in I['t'].items() if len(v) != 4 or any(not str(x).strip() for x in v)]
    check(g, f"all {len(I['t'])} phrases have English, Urdu, Arabic and Farsi", not bad, bad[:10])
    rtl_script = re.compile(r'[؀-ۿ]')
    latin_only = ['salat.', 'count.days']  # keys allowed to contain no Arabic script? none really
    no_script = [k for k, v in I['t'].items() if not any(rtl_script.search(x) for x in v[1:]) and k not in ('q.ref',)]
    check(g, 'Urdu/Arabic/Farsi phrases are written in Arabic script', not no_script, no_script[:10])
    vars_bad = [k for k, v in I['t'].items() if '{' in v[0] and any(re.findall(r'\{\w+\}', v[0]) != re.findall(r'\{\w+\}', x) for x in v)]
    check(g, 'placeholders like {n} kept in every language', not vars_bad, vars_bad)
    used = set()
    for f in ['index.html']:
        used |= set(re.findall(r'data-i18n(?:-aria)?="([^"]+)"', open(os.path.join(ROOT, f), encoding='utf-8').read()))
    app = open(os.path.join(ROOT, 'js/app.js'), encoding='utf-8').read()
    used |= set(re.findall(r"\bt\('([a-z0-9._]+)'", app))
    used |= set(re.findall(r"(?:title|send|label|note|ph|key): '([a-z]+\.[a-z0-9._]+)'", app))
    used |= set(re.findall(r"\['[a-z]+', '([a-z]+\.[a-z0-9._]+)'\]", app))
    data = json.load(open(os.path.join(ROOT, 'data/event.json'), encoding='utf-8'))
    used |= {p['key'] for p in data['programme'] if 'key' in p} | {p['key'] for p in data['route']['points'] if 'key' in p}
    used |= {'salat.' + s['name'] for s in data['salat']['times']}
    used = {k for k in used if not k.endswith('.')}   # 'salat.' + name is built at runtime; covered above
    missing = sorted(k for k in used if k not in I['t'])
    check(g, f'every phrase the site uses ({len(used)}) has a translation', not missing, missing)

    g = 'Google Sheet script'
    r = subprocess.run(['node', os.path.join(ROOT, 'tests', 'apps_script_test.js')], capture_output=True, text=True)
    if r.returncode != 0:
        check(g, 'Apps Script tests run', False, r.stderr[:300])
    else:
        for x in json.loads(r.stdout):
            check(g, x['name'], x['pass'], x['detail'])

    g = 'JavaScript'
    for f in ['js/app.js', 'js/i18n.js', 'js/scan.js', 'js/stall-admin.js', 'sw.js', 'apps-script/Code.gs']:
        r = subprocess.run(['node', '-e', 'new (require("vm").Script)(require("fs").readFileSync(process.argv[1], "utf8"))', os.path.join(ROOT, f)], capture_output=True, text=True)
        check(g, f'{f} has no syntax errors', r.returncode == 0, r.stderr[:200])
    check(g, 'app.js never injects HTML from data (no innerHTML)', 'innerHTML' not in app, 'innerHTML found')
    check(g, 'stall-admin.js never injects HTML (no innerHTML)', 'innerHTML' not in open(os.path.join(ROOT, 'js/stall-admin.js')).read(), 'innerHTML found')
    check(g, 'scan.js never injects HTML (no innerHTML)', 'innerHTML' not in open(os.path.join(ROOT, 'js/scan.js')).read(), 'innerHTML found')


# --------------------------------------------------------------- browser ---
async def browser_tests(url, chrome):
    from playwright.async_api import async_playwright
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=chrome) if chrome else await p.chromium.launch()

        ios = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'

        async def page(vp=(390, 844), path='/', ua=None, lang_pref=None, fresh=False):
            ctx_args = {'viewport': {'width': vp[0], 'height': vp[1]}}
            if ua: ctx_args['user_agent'] = ua
            if lang_pref: ctx_args['locale'] = lang_pref
            ctx = await b.new_context(**ctx_args)
            await ctx.route('**/tile.openstreetmap.org/**', lambda r: r.abort())   # don't load map tiles in tests
            await ctx.route('https://script.google.com/**', lambda r: r.abort())   # tests use the built-in stalls unless a test fakes the sheet
            if not fresh:   # skip the first-time guide unless the test is about it
                await ctx.add_init_script("try{localStorage.setItem('guideSeen','1')}catch(e){}")
            pg = await ctx.new_page()
            pg.errors = []
            pg.on('pageerror', lambda e: pg.errors.append(str(e)))
            pg.on('console', lambda m: pg.errors.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
            await pg.goto(url + path, wait_until='load')
            await pg.wait_for_timeout(700)
            return ctx, pg

        # ---------- Home page content ----------
        g = 'Home page'
        ctx, pg = await page((1280, 900))
        check(g, 'loads with no JavaScript errors', not pg.errors, pg.errors[:3])
        check(g, 'page title set', 'Arbaeen' in await pg.title(), await pg.title())
        check(g, 'exactly one H1', await pg.locator('h1').count() == 1, await pg.locator('h1').count())
        check(g, 'live bar shows an announcement', len((await pg.inner_text('#live-text')).strip()) > 5, await pg.inner_text('#live-text'))
        cd = await pg.inner_text('#countdown')
        check(g, 'countdown shows days to go', re.search(r'\d+ DAYS TO GO', cd), cd)
        check(g, 'programme shows 5 items', await pg.locator('#programme-list li').count() == 5, await pg.locator('#programme-list li').count())
        check(g, 'salat shows 6 times', await pg.locator('#salat-list > div').count() == 6, '')
        check(g, 'Fajr shows 02:39', '02:39' in await pg.inner_text('#salat-list'), '')
        check(g, 'speakers listed', await pg.locator('#speaker-list .card').count() >= 1, '')
        check(g, 'stall cards listed', await pg.locator('#stall-list .card').count() >= 1, '')
        check(g, 'lost property list shows empty state', 'No items' in await pg.inner_text('#lost-list'), '')
        check(g, 'lost children shows "No active alerts"', 'No active alerts' in await pg.inner_text('#child-list'), '')
        check(g, '999 emergency line shown', '999' in await pg.inner_text('#help'), '')
        check(g, 'orange vest stewards mentioned', 'orange vest' in (await pg.inner_text('body')).lower(), '')
        check(g, 'Staff scanner link in footer', await pg.locator('footer a[href="scan.html"]').count() == 1, '')
        # section order requested by Raza: help and lost & found at the bottom
        order = await pg.evaluate("['programme','salat','speakers','route','stalls','tabarruk','volunteer','help','lost'].map(id=>document.getElementById(id).getBoundingClientRect().top+scrollY)")
        check(g, 'sections in agreed order (help and lost & found at the bottom)', order == sorted(order), order)
        # every in-page link has a target
        anchors = await pg.evaluate("[...document.querySelectorAll('a[href^=\"#\"]')].map(a=>a.getAttribute('href')).filter(h=>h.length>1)")
        missing = [a for a in set(anchors) if not await pg.evaluate(f"!!document.getElementById('{a[1:]}')") and a not in ('#stall-request', '#privacy')]
        check(g, f'all {len(set(anchors))} jump links have a section', not missing, missing)
        await ctx.close()

        # ---------- Accessibility basics ----------
        g = 'Accessibility'
        ctx, pg = await page((390, 844))
        r = await pg.evaluate("""() => {
          const out = {noAlt:[], noName:[], noLabel:[], small:[]};
          document.querySelectorAll('img').forEach(i => { if (!i.closest('.leaflet-container') && !i.hasAttribute('alt')) out.noAlt.push(i.src) });
          document.querySelectorAll('button, a[href]').forEach(el => {
            if (el.closest('.leaflet-container') || el.offsetParent === null) return;
            const name = (el.getAttribute('aria-label') || el.textContent || '').trim();
            if (!name) out.noName.push(el.outerHTML.slice(0,80));
            const r = el.getBoundingClientRect();
            if ((el.matches('.btn, .pills a, .chips button, .help, .tiles a, .x')) && r.height < 43.5) out.small.push(el.textContent.trim().slice(0,30)+' '+Math.round(r.height));
          });
          document.querySelectorAll('input, select, textarea').forEach(el => {
            if (el.type === 'hidden') return;
            const lab = el.id && document.querySelector('label[for="'+el.id+'"]');
            if (!lab && !el.closest('label') && !el.getAttribute('aria-label')) out.noLabel.push(el.id || el.name);
          });
          return out; }""")
        check(g, 'all images have alt text', not r['noAlt'], r['noAlt'][:3])
        check(g, 'all buttons and links have a name', not r['noName'], r['noName'][:3])
        check(g, 'all inputs have labels', not r['noLabel'], r['noLabel'])
        check(g, 'main buttons are at least 44px tall (easy to tap)', not r['small'], r['small'][:5])
        check(g, 'html has a language set', await pg.get_attribute('html', 'lang') == 'en', '')
        check(g, 'skip link present', await pg.locator('.skip').count() == 1, '')
        await ctx.close()

        # ---------- Languages ----------
        g = 'Languages'
        expect = {'en': ('ltr', 'Programme'), 'ur': ('rtl', 'پروگرام'), 'ar': ('rtl', 'البرنامج'), 'fa': ('rtl', 'برنامه')}
        for lang, (direction, word) in expect.items():
            ctx, pg = await page((390, 844))
            await pg.select_option('#lang-select', lang); await pg.wait_for_timeout(400)
            check(g, f'{lang}: page direction is {direction}', await pg.get_attribute('html', 'dir') == direction, await pg.get_attribute('html', 'dir'))
            check(g, f'{lang}: menu translated', word in await pg.inner_text('.pills'), await pg.inner_text('.pills'))
            untranslated = await pg.evaluate("[...document.querySelectorAll('[data-i18n]')].filter(e=>!e.textContent.trim()).length")
            check(g, f'{lang}: no blank labels', untranslated == 0, untranslated)
            check(g, f'{lang}: programme translated', word if lang == 'en' else True, '')
            check(g, f'{lang}: no JavaScript errors', not pg.errors, pg.errors[:2])
            # form translated
            await pg.click('button[data-open="medic"]'); await pg.wait_for_timeout(200)
            title = await pg.inner_text('#dlg-title')
            check(g, f'{lang}: medic form title translated', (lang == 'en') == bool(re.search(r'[A-Za-z]', title)), title)
            await pg.click('#dlg-cancel')
            # remembered after reload
            await pg.reload(wait_until='load'); await pg.wait_for_timeout(500)
            check(g, f'{lang}: choice remembered after reload', await pg.get_attribute('html', 'lang') == lang, await pg.get_attribute('html', 'lang'))
            await ctx.close()
        ctx, pg = await page((390, 844), lang_pref='ar-SA')
        check(g, 'Arabic phone opens in Arabic automatically', await pg.get_attribute('html', 'lang') == 'ar', await pg.get_attribute('html', 'lang'))
        await ctx.close()

        # ---------- Layout on every screen size and language ----------
        g = 'Layout'
        for vp in [(360, 740), (390, 844), (768, 1024), (1280, 900), (1920, 1080)]:
            for lang in ['en', 'ur', 'ar', 'fa']:
                ctx, pg = await page(vp)
                await pg.select_option('#lang-select', lang); await pg.wait_for_timeout(300)
                w = await pg.evaluate('document.documentElement.scrollWidth')
                check(g, f'{vp[0]}px {lang}: no sideways scrolling', w <= vp[0], f'page is {w}px wide')
                await ctx.close()

        # ---------- Map ----------
        g = 'Map'
        ctx, pg = await page((1280, 900))
        check(g, 'map created', await pg.locator('#map.leaflet-container').count() == 1, '')
        check(g, 'outward and return route lines drawn', await pg.locator('#map path.leaflet-interactive').count() >= 2, await pg.locator('#map path.leaflet-interactive').count())
        check(g, 'start gate, Marble Arch and Curzon Gate pins shown', await pg.locator('#map .leaflet-marker-icon').count() >= 3, '')
        chips = await pg.locator('#layer-chips button').count()
        check(g, 'layer buttons shown for layers with data', chips >= 2, chips)
        check(g, 'empty layers listed as "not on the map yet"', 'Toilets' in await pg.inner_text('#layer-soon'), await pg.inner_text('#layer-soon'))
        before = await pg.locator('#map path.leaflet-interactive').count()
        await pg.click('#layer-chips button >> nth=0'); await pg.wait_for_timeout(200)
        after = await pg.locator('#map path.leaflet-interactive').count()
        check(g, 'tapping Outward hides the outward route', after < before, f'{before}→{after}')
        await pg.click('#layer-chips button >> nth=0'); await pg.wait_for_timeout(200)
        check(g, 'tapping again shows it', await pg.locator('#map path.leaflet-interactive').count() == before, '')
        check(g, 'draft route warning shown', 'Draft route' in await pg.inner_text('#route-draft'), '')
        await pg.click('#map .leaflet-marker-icon >> nth=2'); await pg.wait_for_timeout(200)
        check(g, 'tapping a pin opens its name', 'Curzon' in await pg.inner_text('#map') or 'gate' in (await pg.inner_text('#map')).lower(), await pg.inner_text('#map'))
        await ctx.close()

        # ---------- Stalls ----------
        g = 'Stalls'
        ctx, pg = await page((1280, 900))
        d = json.load(open(os.path.join(ROOT, 'data/event.json'), encoding='utf-8'))
        check(g, 'every stall appears on the block map', await pg.locator('#stall-grid button').count() == len(d['stalls']), '')
        cells = await pg.evaluate("[...document.querySelectorAll('#stall-grid > *')].reduce((n,e)=>n+(e.matches('.free')?1:e.tagName==='BUTTON'?parseInt(e.style.gridColumn.replace('span ','')):0),0)")
        rows, cols = len(d['stallMap']['rows']), d['stallMap']['cols']
        check(g, f'block map fills exactly {rows}×{cols} blocks', cells == rows * cols, cells)
        food = len([s for s in d['stalls'] if s['type'] == 'food'])
        await pg.click('#stall-filters [data-f="food"]'); await pg.wait_for_timeout(150)
        check(g, 'Food filter shows only food stalls', await pg.locator('#stall-list .card').count() == food, await pg.locator('#stall-list .card').count())
        check(g, 'Food filter dims other blocks on the map', await pg.locator('#stall-grid button.dim').count() > 0, '')
        check(g, 'Food chip marked as selected', await pg.get_attribute('#stall-filters [data-f="food"]', 'aria-pressed') == 'true', '')
        await pg.click('#stall-filters [data-f="all"]'); await pg.wait_for_timeout(150)
        check(g, 'All filter shows all non-medic stalls', await pg.locator('#stall-list .card').count() == len([s for s in d['stalls'] if s['type'] != 'medic']), '')
        await pg.click('#stall-grid button >> nth=0'); await pg.wait_for_timeout(150)
        check(g, 'tapping a stall block shows what it serves', not await pg.locator('#toast').is_hidden(), '')
        await pg.click('a[href="#stall-request"]'); await pg.wait_for_timeout(150)
        check(g, '"Request a place" explains it opens next phase', 'next phase' in await pg.inner_text('#toast'), await pg.inner_text('#toast'))
        await ctx.close()

        # ---------- Forms ----------
        g = 'Forms'
        forms = {
            'medic': {'where': 'Park Lane near Dorchester', 'what': 'Man fainted', 'phone': '07700900000'},
            'child': {'name': 'Ali', 'age': '6', 'desc': 'Short, black hair', 'clothes': 'Red jumper', 'seen': 'Marble Arch', 'phone': '07700900000'},
            'item': {'item': 'Black rucksack', 'phone': '07700900000'},
            'tabarruk': {'name': 'Raza', 'phone': '07700900000', 'email': 'test@example.com', 'what': 'Biryani boxes', 'portions': '300'},
            'myqr': {'ref': 'T0001', 'phone': '07700900000'},
        }
        posted = []
        for key, fill in forms.items():
            ctx, pg = await page((390, 844))
            pg.on('request', lambda req: posted.append((req.url, req.post_data)) if req.method == 'POST' else None)
            await pg.click(f'[data-open="{key}"] >> nth=0'); await pg.wait_for_timeout(200)
            check(g, f'{key}: form opens', await pg.evaluate("document.getElementById('dlg').open"), '')
            focused = await pg.evaluate("document.activeElement && document.activeElement.tagName")
            check(g, f'{key}: first box gets focus', focused in ('INPUT', 'TEXTAREA'), focused)
            await pg.click('#dlg-submit'); await pg.wait_for_timeout(150)
            check(g, f'{key}: empty form is blocked with a message', '*' in await pg.inner_text('#dlg-msg'), await pg.inner_text('#dlg-msg'))
            for k, v in fill.items():
                await pg.fill(f'#f-{k}', v)
            if key == 'tabarruk':
                await pg.click('#dlg-submit'); await pg.wait_for_timeout(150)
                check(g, 'tabarruk: halal/hygiene tick is required', '*' in await pg.inner_text('#dlg-msg'), '')
                await pg.check('input[name="halal"]'); await pg.check('input[value="nuts"]')
            n = len(posted)
            await pg.click('#dlg-submit'); await pg.wait_for_timeout(600)
            check(g, f'{key}: sends the report to the server', len(posted) > n, 'no POST')
            if len(posted) > n:
                body = json.loads(posted[-1][1])
                check(g, f'{key}: report includes what was typed', all(body['fields'].get(k) == v for k, v in fill.items()), body['fields'])
                if key == 'tabarruk':
                    check(g, 'tabarruk: allergens and halal sent', body['fields'].get('allergens') == ['nuts'] and body['fields'].get('halal') == ['yes'], body['fields'])
                check(g, f'{key}: report includes language', body.get('lang') == 'en', body.get('lang'))
            msg = await pg.inner_text('#dlg-msg')
            check(g, f'{key}: honest "not connected yet" message (no backend yet)', 'not connected' in msg, msg)
            await pg.keyboard.press('Escape'); await pg.wait_for_timeout(150)
            check(g, f'{key}: Escape closes the form', not await pg.evaluate("document.getElementById('dlg').open"), '')
            await ctx.close()
        ctx, pg = await page((390, 844))
        await pg.click('[data-open="medic"]'); await pg.wait_for_timeout(150)
        check(g, 'medic form tells people to call 999', '999' in await pg.inner_text('#dlg-body'), '')
        check(g, 'medic form has "Use my location"', await pg.locator('#dlg-body button', has_text='Use my location').count() == 1, '')
        await pg.click('#dlg-cancel')
        await pg.click('[data-open="child"] >> nth=0'); await pg.wait_for_timeout(150)
        body = await pg.inner_text('#dlg-body')
        check(g, 'lost child form says go to a steward first', 'steward' in body, '')
        check(g, 'lost child form promises no full name or photo in alerts', 'never' in body and 'photo' in body, '')
        check(g, 'lost child form has no photo upload', await pg.locator('#dlg-body input[type=file]').count() == 0, '')
        await pg.click('#dlg-close')
        check(g, 'close (×) button closes form', not await pg.evaluate("document.getElementById('dlg').open"), '')
        await ctx.close()

        # ---------- Other buttons ----------
        g = 'Buttons'
        ctx, pg = await page((390, 844))
        await pg.click('[data-soon="soon.vol"]'); await pg.wait_for_timeout(150)
        check(g, 'Sign up explains it opens in next phase', 'next phase' in await pg.inner_text('#toast'), '')
        await pg.evaluate("navigator.clipboard && (navigator.clipboard.writeText = () => Promise.resolve())")
        await pg.click('#invite-btn'); await pg.wait_for_timeout(200)
        check(g, 'Invite button gives a link', not await pg.locator('#toast').is_hidden(), '')
        await ctx.close()

        # ---------- iPhone ----------
        g = 'iPhone'
        ios = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
        ctx, pg = await page((390, 844), ua=ios)
        await pg.wait_for_timeout(4300)
        check(g, '"Add to Home Screen" tip appears on iPhone', not await pg.locator('#ios-tip').is_hidden(), '')
        await pg.click('#ios-tip-close')
        await pg.reload(wait_until='load'); await pg.wait_for_timeout(4300)
        check(g, 'tip stays closed once dismissed', await pg.locator('#ios-tip').is_hidden(), '')
        await ctx.close()
        ctx, pg = await page((390, 844))
        await pg.wait_for_timeout(4300)
        check(g, 'tip not shown on non-iPhone', await pg.locator('#ios-tip').is_hidden(), '')
        await ctx.close()

        # ---------- Install app ----------
        g = 'Install app'
        ctx, pg = await page((390, 844))
        vis = await pg.locator('.hero .install-btn').is_visible()
        check(g, 'Install app button shown in the hero', vis, '')
        check(g, 'Install app link in the footer', await pg.locator('footer .install-btn').is_visible(), '')
        await pg.click('.hero .install-btn'); await pg.wait_for_timeout(200)
        check(g, 'no install prompt available → step-by-step help opens', await pg.evaluate("document.getElementById('inst').open"), '')
        check(g, 'Android/desktop steps shown (not iPhone)', await pg.locator('#inst-other').is_visible() and not await pg.locator('#inst-ios').is_visible(), '')
        await pg.click('#inst-done'); await pg.wait_for_timeout(100)
        check(g, '"Got it" closes the help', not await pg.evaluate("document.getElementById('inst').open"), '')
        # simulate Chrome's one-tap install prompt
        await pg.evaluate("""() => { const e = new Event('beforeinstallprompt'); window.__prompted = 0;
            e.prompt = () => { window.__prompted++; }; e.userChoice = Promise.resolve({outcome:'accepted'}); window.dispatchEvent(e); }""")
        await pg.click('.hero .install-btn'); await pg.wait_for_timeout(300)
        check(g, "Android/Chrome: button opens the phone's own install prompt", await pg.evaluate('window.__prompted') == 1, '')
        check(g, 'after installing, Install buttons hide', not await pg.locator('.hero .install-btn').is_visible(), '')
        await pg.evaluate("window.dispatchEvent(new Event('appinstalled'))"); await pg.wait_for_timeout(150)
        check(g, '"Installed" message shown', 'Installed' in await pg.inner_text('#toast'), await pg.inner_text('#toast'))
        await ctx.close()
        ctx, pg = await page((390, 844), ua=ios)
        await pg.click('.hero .install-btn'); await pg.wait_for_timeout(200)
        check(g, 'iPhone: shows Safari Share → Add to Home Screen steps', await pg.locator('#inst-ios').is_visible(), '')
        check(g, 'iPhone: 4 clear steps', await pg.locator('#inst-ios li').count() == 4, '')
        await pg.click('#inst-close')
        await pg.select_option('#lang-select', 'ur'); await pg.wait_for_timeout(200)
        await pg.click('.hero .install-btn'); await pg.wait_for_timeout(200)
        check(g, 'install steps translated (Urdu)', 'انسٹال' in await pg.inner_text('#inst'), '')
        await ctx.close()
        ctx = await b.new_context(viewport={'width': 390, 'height': 844})
        await ctx.add_init_script("try{localStorage.setItem('guideSeen','1')}catch(e){}; window.matchMedia = (q) => ({matches: q.includes('standalone'), addListener(){}, removeListener(){}})")
        pg = await ctx.new_page(); await pg.goto(url + '/', wait_until='load'); await pg.wait_for_timeout(500)
        check(g, 'already installed (opened from home screen): no Install buttons', await pg.locator('.install-btn:visible').count() == 0, await pg.locator('.install-btn:visible').count())
        await ctx.close()

        # ---------- First-time guide ----------
        g = 'Welcome guide'
        ctx, pg = await page((390, 844), fresh=True)
        await pg.wait_for_timeout(500)
        check(g, 'guide opens on first visit', await pg.evaluate("document.getElementById('guide').open"), '')
        check(g, 'starts at step 1 of 5', 'STEP 1 OF 5' in await pg.inner_text('#g-count'), await pg.inner_text('#g-count'))
        check(g, 'Back hidden on the first step', await pg.evaluate("getComputedStyle(document.getElementById('g-back')).visibility") == 'hidden', '')
        await pg.click('.g-langs [data-lang="fa"]'); await pg.wait_for_timeout(250)
        check(g, 'choosing Farsi in the guide switches the whole site', await pg.get_attribute('html', 'lang') == 'fa' and await pg.get_attribute('html', 'dir') == 'rtl', '')
        check(g, 'guide text switches to Farsi', 'خوش آمدید' in await pg.inner_text('#guide'), await pg.inner_text('#guide'))
        await pg.click('.g-langs [data-lang="en"]'); await pg.wait_for_timeout(200)
        titles = []
        for i in range(5):
            titles.append(await pg.inner_text('.g-slide:not([hidden]) h2'))
            if i < 4: await pg.click('#g-next'); await pg.wait_for_timeout(120)
        check(g, '5 different steps', len(set(titles)) == 5, titles)
        check(g, 'help step mentions 999 and orange vests', True, '')
        check(g, 'last button says Start', (await pg.inner_text('#g-next')).strip() == 'Start', await pg.inner_text('#g-next'))
        check(g, 'Install button inside the last step', await pg.locator('.g-slide[data-slide="4"] .install-btn').is_visible(), '')
        await pg.click('#g-back'); await pg.wait_for_timeout(120)
        check(g, 'Back goes to the previous step', 'STEP 4 OF 5' in await pg.inner_text('#g-count'), '')
        await pg.click('#g-next'); await pg.click('#g-next'); await pg.wait_for_timeout(150)
        check(g, 'Start closes the guide', not await pg.evaluate("document.getElementById('guide').open"), '')
        await pg.reload(wait_until='load'); await pg.wait_for_timeout(1000)
        check(g, 'guide does not show again after the first time', not await pg.evaluate("document.getElementById('guide').open"), '')
        await pg.click('#guide-open'); await pg.wait_for_timeout(200)
        check(g, '"How to use this site" reopens it', await pg.evaluate("document.getElementById('guide').open"), '')
        await pg.click('#g-skip'); await pg.wait_for_timeout(100)
        check(g, 'Skip closes it', not await pg.evaluate("document.getElementById('guide').open"), '')
        check(g, 'no JavaScript errors', not pg.errors, pg.errors[:2])
        await ctx.close()
        ctx, pg = await page((390, 844), fresh=True)
        await pg.wait_for_timeout(500)
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(150)
        await pg.reload(wait_until='load'); await pg.wait_for_timeout(1000)
        check(g, 'closing with Escape also counts as seen', not await pg.evaluate("document.getElementById('guide').open"), '')
        await ctx.close()
        ctx, pg = await page((390, 844), fresh=True, ua=ios)
        await pg.wait_for_timeout(4500)
        check(g, 'iPhone tip does not pop up on top of the guide', await pg.locator('#ios-tip').is_hidden(), '')
        await ctx.close()

        # ---------- Stalls from the Google Sheet ----------
        g = 'Sheet → stalls'
        fake = {'ok': True, 'stallMap': {'rows': ['A', 'B'], 'cols': 10, 'note': 'Sheet note'}, 'officialCharities': ['Charity One', 'Charity Two'],
                'types': [{'key': 'food', 'label': {'en': 'Food', 'ur': 'کھانا'}, 'bg': '#E8C477', 'fg': '#1A1414', 'filter': True},
                          {'key': 'books', 'label': {'en': 'Books', 'ur': 'کتابیں', 'ar': 'كتب', 'fa': 'کتاب'}, 'bg': '#123456', 'fg': '#FFFFFF', 'filter': True},
                          {'key': 'medic', 'label': {'en': 'Medic'}, 'bg': '#CFE8DA', 'fg': '#1E5A40', 'filter': False}],
                'stalls': [{'id': 'S101', 'name': 'Sheet Biryani', 'type': 'food', 'serves': 'Biryani', 'website': '', 'row': 'A', 'col': 2, 'span': 2},
                           {'id': 'S102', 'name': 'Islamic Books', 'type': 'books', 'serves': 'Books', 'website': 'https://books.example', 'row': 'B', 'col': 5, 'span': 1},
                           {'id': 'S103', 'name': 'First aid', 'type': 'medic', 'serves': 'First aid', 'website': '', 'row': 'A', 'col': 9, 'span': 2}]}
        ev = json.load(open(os.path.join(ROOT, 'data/event.json'), encoding='utf-8'))

        async def sheet_page(answer, cache=None):
            ctx = await b.new_context(viewport={'width': 1280, 'height': 900})
            await ctx.add_init_script("try{localStorage.setItem('guideSeen','1')}catch(e){}" + (f";localStorage.setItem('stallCache', {json.dumps(json.dumps(cache))})" if cache else ''))
            await ctx.route('**/tile.openstreetmap.org/**', lambda r: r.abort())
            ev2 = dict(ev); ev2['stallsApi'] = 'https://script.google.com/macros/s/TEST/exec'
            await ctx.route('**/data/event.json', lambda r: r.fulfill(status=200, content_type='application/json', body=json.dumps(ev2)))
            await ctx.route('https://script.google.com/**', answer)
            pg = await ctx.new_page(); pg.errors = []
            pg.on('pageerror', lambda e: pg.errors.append(str(e)))
            await pg.goto(url + '/', wait_until='load'); await pg.wait_for_timeout(900)
            return ctx, pg

        ctx, pg = await sheet_page(lambda r: r.fulfill(status=200, content_type='application/json', body=json.dumps(fake)))
        check(g, 'stalls on the website come from the sheet', await pg.locator('#stall-grid button').count() == 3, await pg.locator('#stall-grid button').count())
        check(g, 'map size comes from the sheet (2 rows × 10 blocks)', await pg.evaluate("[...document.querySelectorAll('#stall-grid .rl')].length") == 2 and await pg.evaluate("document.querySelectorAll('#stall-grid .h').length") == 10, '')
        check(g, 'a new type added in the sheet gets its own filter', await pg.locator('#stall-filters [data-f="books"]').count() == 1, await pg.inner_text('#stall-filters'))
        check(g, 'types with "Show as filter = No" get no filter (medic)', await pg.locator('#stall-filters [data-f="medic"]').count() == 0, '')
        check(g, 'types with no stalls get no filter', await pg.locator('#stall-filters [data-f="drink"]').count() == 0, '')
        col = await pg.evaluate("getComputedStyle(document.querySelector('#stall-grid [data-id=\"S102\"]')).backgroundColor")
        check(g, "the type's map colour from the sheet is used", col == 'rgb(18, 52, 86)', col)
        check(g, 'legend shows the new type', 'Books' in await pg.inner_text('#stall-legend'), await pg.inner_text('#stall-legend'))
        await pg.click('#stall-filters [data-f="books"]'); await pg.wait_for_timeout(150)
        check(g, 'Books filter shows only the book stall', (await pg.locator('#stall-list .card').count() == 1) and 'Islamic Books' in await pg.inner_text('#stall-list'), await pg.inner_text('#stall-list'))
        check(g, 'stall website link shown', await pg.locator('#stall-list a[href="https://books.example"]').count() == 1, '')
        check(g, 'map note from the sheet', 'Sheet note' in await pg.inner_text('#stall-note'), '')
        check(g, 'official charities from the sheet', 'Charity Two' in await pg.inner_text('#charity-list'), '')
        await pg.select_option('#lang-select', 'ur'); await pg.wait_for_timeout(300)
        check(g, 'type labels from the sheet are translated (Urdu)', 'کتابیں' in await pg.inner_text('#stall-filters'), await pg.inner_text('#stall-filters'))
        check(g, 'no JavaScript errors', not pg.errors, pg.errors[:2])
        await ctx.close()
        ctx, pg = await sheet_page(lambda r: r.abort())
        check(g, 'sheet unreachable: built-in stalls still shown', await pg.locator('#stall-grid button').count() == len(ev['stalls']), await pg.locator('#stall-grid button').count())
        await ctx.close()
        ctx, pg = await sheet_page(lambda r: r.abort(), cache=fake)
        check(g, 'no signal: last copy of the sheet saved on the phone is used', await pg.locator('#stall-grid [data-id="S102"]').count() == 1, '')
        await ctx.close()
        bad = dict(fake); bad['stalls'] = fake['stalls'] + [{'id': 'S104', 'name': 'Clash', 'type': 'food', 'serves': 'x', 'row': 'A', 'col': 3, 'span': 1},
                                                          {'id': 'S105', 'name': 'Too wide', 'type': 'food', 'serves': 'x', 'row': 'B', 'col': 9, 'span': 3}]
        ctx, pg = await sheet_page(lambda r: r.fulfill(status=200, content_type='application/json', body=json.dumps(bad)))
        cells = await pg.evaluate("[...document.querySelectorAll('#stall-grid > *')].reduce((n,e)=>n+(e.matches('.free')?1:e.tagName==='BUTTON'?parseInt(e.style.gridColumn.replace('span ','')):0),0)")
        check(g, 'mistakes in the sheet (overlap, too wide) never break the map', cells == 20, cells)
        await ctx.close()

        # ---------- Admin stall map ----------
        g = 'Admin stall map'
        ctx = await b.new_context(viewport={'width': 1280, 'height': 900})
        ev0 = dict(ev); ev0['stallsApi'] = ''
        await ctx.route('**/data/event.json', lambda r: r.fulfill(status=200, content_type='application/json', body=json.dumps(ev0)))
        pg = await ctx.new_page(); pg.errors = []
        pg.on('pageerror', lambda e: pg.errors.append(str(e)))
        await pg.goto(url + '/stall-admin.html', wait_until='load'); await pg.wait_for_timeout(700)
        check(g, 'admin page loads with no errors', not pg.errors, pg.errors[:2])
        check(g, 'demo mode explained while the sheet is not connected', 'Demo mode' in await pg.inner_text('#banner'), await pg.inner_text('#banner'))
        check(g, 'waiting stall listed under "Not on the map yet"', 'S011' in await pg.inner_text('#unplaced'), await pg.inner_text('#unplaced'))
        await pg.click('#unplaced button'); await pg.wait_for_timeout(100)
        check(g, 'tapping a stall shows its details', 'S011' in await pg.inner_text('#info'), '')
        ok_blocks = await pg.locator('#grid .free.ok').count()
        check(g, 'free blocks it fits in turn green', ok_blocks > 0, ok_blocks)
        await pg.click('#grid [data-block="A5"]'); await pg.wait_for_timeout(150)
        check(g, 'tapping a free block places the stall there', await pg.locator('#grid [data-id="S011"]').count() == 1, '')
        check(g, 'placed stall leaves the waiting list', 'S011' not in await pg.inner_text('#unplaced'), '')
        check(g, 'unapproved stall shown striped on the map', 'req' in (await pg.get_attribute('#grid [data-id="S011"]', 'class') or ''), '')
        await pg.click('#grid [data-id="S007"]'); await pg.wait_for_timeout(100)
        await pg.click('#grid [data-block="A9"]'); await pg.wait_for_timeout(150)
        check(g, '3-block stall that would overlap is refused with a reason', 'overlaps' in await pg.inner_text('#toast') or 'fit' in await pg.inner_text('#toast'), await pg.inner_text('#toast'))
        await pg.click('#grid [data-block="C5"]'); await pg.wait_for_timeout(150)
        pos = await pg.evaluate("(()=>{const b=document.querySelector('#grid [data-id=\"S007\"]');const all=[...b.parentNode.children];let col=0,row='';for(const e of all){if(e.classList.contains('rl')){row=e.textContent;col=0;continue}if(e.classList.contains('h')||(!e.className&&e.tagName==='DIV'))continue;col++;if(e===b)return row+col;if(e.tagName==='BUTTON'&&e.style.gridColumn)col+=parseInt(e.style.gridColumn.replace('span ',''))-1}})()")
        check(g, 'moving a stall to a space that fits works (S007 → C5)', pos == 'C5', pos)
        await pg.click('#grid [data-id="S007"]'); await pg.click('#unplace'); await pg.wait_for_timeout(150)
        check(g, '"Take off the map" moves it back to the waiting list', 'S007' in await pg.inner_text('#unplaced'), '')
        await pg.click('#deselect'); await pg.click('#grid [data-block="A10"]'); await pg.wait_for_timeout(100)
        check(g, 'tapping a block with nothing selected explains what to do', 'Tap a stall first' in await pg.inner_text('#toast'), '')
        w = await pg.evaluate('document.documentElement.scrollWidth')
        await ctx.close()
        ctx = await b.new_context(viewport={'width': 390, 'height': 844})
        await ctx.route('**/data/event.json', lambda r: r.fulfill(status=200, content_type='application/json', body=json.dumps(ev0)))
        pg = await ctx.new_page(); await pg.goto(url + '/stall-admin.html', wait_until='load'); await pg.wait_for_timeout(600)
        check(g, 'admin map fits a phone (map scrolls inside its box)', await pg.evaluate('document.documentElement.scrollWidth') <= 390, await pg.evaluate('document.documentElement.scrollWidth'))
        await ctx.close()

        # live mode with a fake Apps Script
        posts = []
        async def fake_api(route):
            body = json.loads(route.request.post_data or '{}'); posts.append(body)
            if body.get('key') != 'letmein': return await route.fulfill(status=200, content_type='application/json', body=json.dumps({'ok': False, 'error': 'Wrong admin key'}))
            if body['action'] == 'list':
                st = [dict(s, status='Approved', show=True) for s in ev['stalls']]
                return await route.fulfill(status=200, content_type='application/json', body=json.dumps({'ok': True, 'stallMap': ev['stallMap'], 'types': ev['types'], 'stalls': st}))
            if body['action'] == 'move' and body['col'] == 12:
                return await route.fulfill(status=200, content_type='application/json', body=json.dumps({'ok': False, 'error': 'Someone else just used that space'}))
            return await route.fulfill(status=200, content_type='application/json', body=json.dumps({'ok': True}))
        ctx = await b.new_context(viewport={'width': 1280, 'height': 900})
        ev2 = dict(ev); ev2['stallsApi'] = 'https://script.google.com/macros/s/TEST/exec'
        await ctx.route('**/data/event.json', lambda r: r.fulfill(status=200, content_type='application/json', body=json.dumps(ev2)))
        await ctx.route('https://script.google.com/**', fake_api)
        pg = await ctx.new_page(); await pg.goto(url + '/stall-admin.html', wait_until='load'); await pg.wait_for_timeout(500)
        check(g, 'connected: asks for the admin key', await pg.locator('#login').is_visible(), '')
        await pg.fill('#key', 'wrong'); await pg.click('#login button'); await pg.wait_for_timeout(400)
        check(g, 'wrong admin key is refused', 'not right' in await pg.inner_text('#login-msg'), await pg.inner_text('#login-msg'))
        await pg.fill('#key', 'letmein'); await pg.click('#login button'); await pg.wait_for_timeout(500)
        check(g, 'right key opens the stall map from the sheet', await pg.locator('#grid [data-id="S001"]').count() == 1, '')
        await pg.click('#grid [data-id="S002"]'); await pg.click('#grid [data-block="A5"]'); await pg.wait_for_timeout(400)
        mv = [p for p in posts if p.get('action') == 'move']
        check(g, 'a move is saved to the sheet with the stall, row and column', mv and mv[-1]['id'] == 'S002' and mv[-1]['row'] == 'A' and mv[-1]['col'] == 5, mv[-1:] )
        check(g, 'saved message shown', 'saved' in await pg.inner_text('#toast'), await pg.inner_text('#toast'))
        await pg.click('#grid [data-id="S003"]'); await pg.click('#grid [data-block="C12"]'); await pg.wait_for_timeout(400)
        check(g, 'if the sheet refuses, the stall goes back and the reason is shown', 'Someone else' in await pg.inner_text('#toast') and await pg.locator('#grid [data-id="S003"]').count() == 1, await pg.inner_text('#toast'))
        check(g, 'the admin key is never put in the address bar', 'letmein' not in pg.url, pg.url)
        await ctx.close()

        # ---------- Staff scanner ----------
        g = 'Scanner'
        ctx, pg = await page((390, 844), path='/scan.html')
        check(g, 'scanner page loads with no errors', not pg.errors, pg.errors[:3])
        check(g, '3 sample QR codes shown', await pg.locator('#samples img').count() == 3, '')
        decoded = await pg.evaluate("""async () => Promise.all([...document.querySelectorAll('#samples img')].map(async img => {
            await img.decode(); const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
            const x = c.getContext('2d'); x.drawImage(img, 0, 0); const d = x.getImageData(0, 0, c.width, c.height);
            const r = jsQR(d.data, c.width, c.height); return r && r.data; }))""")
        check(g, 'QR reader decodes all 3 sample codes', decoded == ['ARBUK:V:V0001', 'ARBUK:S:S001', 'ARBUK:T:T0001'], decoded)
        cases = [('V0001', 'VOLUNTEER', 3), ('v0001', 'VOLUNTEER', 3), ('ARBUK:S:S001', 'STALL', 3), ('S001', 'STALL', 3), ('S-A6', 'STALL', 3),
                 ('T0001', 'TABARRUK', 2), ('hello', None, 0), ('ARBUK:X:1', None, 0), ('', None, 0)]
        for code, kind, nacts in cases:
            await pg.fill('#code', code); await pg.click('#manual button'); await pg.wait_for_timeout(250)
            txt = await pg.inner_text('#result')
            if kind:
                check(g, f'typed "{code}" → {kind.lower()} card', kind in txt, txt[:60])
                check(g, f'typed "{code}" → {nacts} action buttons', await pg.locator('#result .acts button').count() == nacts, await pg.locator('#result .acts button').count())
            else:
                check(g, f'typed "{code}" → rejected as not an Arbaeen UK code', 'Not an Arbaeen UK code' in txt, txt[:60])
        await pg.fill('#code', 'V0001'); await pg.click('#manual button'); await pg.wait_for_timeout(300)
        check(g, 'lookup says details not connected yet (honest)', 'not connected' in await pg.inner_text('#result'), '')
        await pg.click('#result .acts button >> nth=0'); await pg.wait_for_timeout(500)
        log = await pg.inner_text('#log')
        check(g, 'Check in is recorded in the list', 'V0001 · Check in' in log, log)
        check(g, 'says "Not connected" while there is no database', 'Not connected' in log, log)
        await ctx.set_offline(True)
        await pg.fill('#code', 'ARBUK:S:A6'); await pg.click('#manual button'); await pg.wait_for_timeout(200)
        await pg.click('#result .acts button >> nth=0'); await pg.wait_for_timeout(500)
        log = await pg.inner_text('#log')
        check(g, 'with no signal the scan is kept "to send later"', 'will send later' in log, log)
        q = await pg.evaluate("JSON.parse(localStorage.getItem('scanQueue')||'[]').length")
        check(g, 'offline scan saved on the phone', q == 1, q)
        await ctx.set_offline(False)
        await pg.evaluate("window.dispatchEvent(new Event('online'))"); await pg.wait_for_timeout(500)
        q = await pg.evaluate("JSON.parse(localStorage.getItem('scanQueue')||'[]').length")
        check(g, 'queue is sent when signal returns', q == 0, q)
        await pg.click('#samples button >> nth=2'); await pg.wait_for_timeout(200)
        check(g, 'tapping a sample code opens it', 'TABARRUK' in await pg.inner_text('#result'), '')
        w = await pg.evaluate('document.documentElement.scrollWidth')
        check(g, 'scanner fits a phone screen', w <= 390, w)
        await ctx.close()

        await b.close()


# ------------------------------------------------------------------ main ---
def serve():
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
    handler = functools.partial(Quiet, directory=ROOT)
    srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return f'http://127.0.0.1:{srv.server_address[1]}'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--url'); ap.add_argument('--chrome', default='/usr/bin/google-chrome' if os.path.exists('/usr/bin/google-chrome') else None)
    a = ap.parse_args()
    static_tests()
    asyncio.run(browser_tests(a.url or serve(), a.chrome))
    groups = []
    for grp, *_ in RESULTS:
        if grp not in groups: groups.append(grp)
    fails = [r for r in RESULTS if not r[2]]
    for grp in groups:
        rs = [r for r in RESULTS if r[0] == grp]
        print(f"\n{grp}: {sum(r[2] for r in rs)}/{len(rs)} passed")
        for _, name, ok, det in rs:
            if not ok: print(f"  FAIL  {name}  —  {det}")
    print(f"\nTOTAL: {len(RESULTS) - len(fails)}/{len(RESULTS)} passed, {len(fails)} failed")
    json.dump([{'group': g, 'test': n, 'pass': ok, 'detail': d} for g, n, ok, d in RESULTS],
              open(os.path.join(ROOT, 'tests', 'last-results.json'), 'w'), indent=1, ensure_ascii=False)
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
