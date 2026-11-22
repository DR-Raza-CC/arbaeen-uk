# Arbaeen UK — Procession London

Website and app for the Arbaeen Procession London, Sunday 25 July 2027, Marble Arch.

- Static site: `index.html`, `css/`, `js/`, `data/event.json` (all content), `lib/` (Leaflet, QR libraries)
- Staff QR scanner: `scan.html`
- Translations: `js/i18n.js` (English, Urdu, Arabic, Farsi — non-English drafts need checking)
- Hosting: Cloudflare Pages, no build step (output directory `/`)

Forms and scans post to `api/...` endpoints, added in the next phase (Cloudflare database).

## Tests

`python3 tests/run_tests.py` runs 281 checks (files, data, translations, every language and screen size, map, stalls, all forms, iPhone tip, QR scanner incl. offline). Needs Python Playwright and Chrome.
