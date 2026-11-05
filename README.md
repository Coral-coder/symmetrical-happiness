# Homebrew Vault

A web app for tracking homebrew D&D content: **spells, magic items and monsters**.
It runs entirely in your browser: no server, no account. GitHub Actions publishes it to GitHub Pages,
and you can **install it as an app on Windows, Android, ChromeOS, macOS and iOS**. It works offline.

![DM screen](public/img/dm-screen.jpg)

## Features

- **Import from webpages.** Paste a URL, preview what was found, fix anything that looks off, then save. Supported:
  - **List pages with tables**, like [`dnd5e.wikidot.com/spells:wizard`](https://dnd5e.wikidot.com/spells:wizard) or `/wondrous-items`. Spell level and item rarity come from the page's tabs.
  - **Sites that embed their data as JSON**, like [mythical.ink's spell list](https://mythical.ink/en/rpg-tools/dnd-spell-list).
  - **Stat-block pages** for single spells, items or monsters.
  - **Homebrewery share links**. Every spell, item and monster in the brew is imported.
  - Optional **"open each linked entry"** mode. On list pages it visits every linked page to fill in full descriptions.
- **Bookmarklet.** Click it on any page you have open (D&D Beyond, a blog, a wiki…) and that page is sent straight to the importer. No proxy needed.
- **Paste.** Select a page (Ctrl+A), copy, and paste. Formatting is kept, so tables still parse. Plain text, Homebrewery markdown and JSON work too.
- **Android share.** Once installed, *Share → Homebrew Vault* from any app imports that link.
- **Filters.**
  - **Spells:** level (cantrip–9), school, source, class, concentration, ritual, plus full-text search.
  - **Items:** rarity, type, source, attunement.
  - **Monsters:** CR range, creature type, size, source.
- **Delete** with the 🗑 button, or tick several and use *Delete selected*. *Select all* only picks what your filters show.
- **Edit or add** entries by hand. Click a row to see its stat block.
- **DM Screen tab** with the quick-reference image. Drag to pan, and zoom with the buttons.
- **Backup:** export everything to a JSON file and restore it on another device.

## Where is my data?

In your browser's IndexedDB on that device. Nothing is uploaded anywhere. Use **⚙ More → Export backup** to keep a copy or move it between devices.

## Importing from URLs and CORS

Browsers only let a web app read another website if that site allows it (CORS). Most D&D sites don't, so URL imports
go through a CORS proxy. A few public ones are preconfigured, but free proxies are often rate-limited or down.
For imports that just work, deploy your own free proxy on Cloudflare Workers with
[`proxy/cloudflare-worker.js`](proxy/cloudflare-worker.js). Setup instructions are at the top of the file. Then put its URL first under **⚙ More → Import proxies**.

The **bookmarklet** and **Paste** never need a proxy.

## Publishing on GitHub Pages

1. In the repo, go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
2. Push to `main`. The [workflow](.github/workflows/pages.yml) runs the tests and deploys the `public/` folder.
   Pull requests run the tests only.
3. The app is then at `https://<user>.github.io/<repo>/`. Open it and choose *Install app*.

## Local development

```bash
npm install     # dev dependencies are only needed for the tests
npm start       # serves public/ at http://127.0.0.1:8080
npm test
```

There's no build step. `public/` is the whole app:

| File | What it does |
|------|--------------|
| `public/js/importer.js` | Turns pages and text into entries (embedded JSON, tables, stat blocks), and handles fetching through proxies |
| `public/js/store.js` | IndexedDB storage, duplicate handling, backup |
| `public/js/app.js` | The UI |
| `public/sw.js`, `manifest.webmanifest` | Offline support and app install |

## How importing works

`importer.js` runs three extractors over every page and merges the results:

1. **Embedded JSON:** `__NEXT_DATA__`, JSON-LD and raw JSON are scanned for objects that look like spells (`school`, `casting_time`), monsters (`challenge_rating`, `hit_points`) or items (`rarity`, `attunement`).
2. **Tables:** any table with a *Name* column, plus spell, item or monster columns. Nearby tabs or headings supply the level or rarity.
3. **Stat blocks:** the page is flattened to text, then searched for type lines such as `3rd-level evocation`, `Evocation cantrip`, `Level 2 Illusion`, `Wondrous item, rare (requires attunement)` and `Large monstrosity, unaligned`. The fields around each type line become the entry.
