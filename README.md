# Arbaeen UK — Procession London

Website and app for the Arbaeen Procession London, Sunday 25 July 2027, Marble Arch.

- Static site: `index.html`, `css/`, `js/`, `data/event.json` (all content), `lib/` (Leaflet, QR libraries)
- Staff QR scanner: `scan.html`
- Translations: `js/i18n.js` (English, Urdu, Arabic, Farsi — non-English drafts need checking)
- Hosting: Cloudflare Pages, no build step (output directory `/`)

Forms and scans post to `api/...` endpoints, added in the next phase (Cloudflare database).

## Tests

`python3 tests/run_tests.py` runs 359 checks (files, data, translations, every language and screen size, map, stalls, all forms, iPhone tip, QR scanner incl. offline). Needs Python Playwright and Chrome.

## Stalls from Google Sheets

Stalls, stall types (labels and colours) and map settings live in the **Arbaeen UK – Stalls** Google Sheet.
`apps-script/Code.gs` is pasted into that sheet (Extensions → Apps Script) and deployed as a web app; its URL goes in `data/event.json` → `stallsApi`.
The website only ever receives public columns. Admins move stalls on `stall-admin.html` (admin key set as the script property `ADMIN_KEY`).
