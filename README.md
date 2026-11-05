# 🐉 Homebrew Vault

A small self-hosted app for tracking homebrew D&D content: **spells, magic items and monsters**.
Pull content in from a webpage, browse it with filters, and delete what you don't need.

![DM screen](public/img/dm-screen.jpg)

## Features

- **Import from webpages.** Paste a URL, preview what was found, fix anything that looks off, then save. Supported:
  - **List pages with tables**, like [`dnd5e.wikidot.com/spells:wizard`](https://dnd5e.wikidot.com/spells:wizard) or `/wondrous-items`. Spell level and item rarity come from the page's tabs.
  - **Sites that embed their data as JSON**, like [mythical.ink's spell list](https://mythical.ink/en/rpg-tools/dnd-spell-list).
  - **Stat-block pages** for single spells, items or monsters (e.g. `dnd5e.wikidot.com/spell:fireball`).
  - **Homebrewery share links**. A whole brew is read in one go, including every spell, item and monster stat block in it.
  - Optional **"open each linked entry"** mode. On list pages it visits every linked spell or item page to fill in its full description.
- **Paste text.** For sites that block bots or build their pages with JavaScript (like D&D Beyond), copy the text and paste it in. Plain text, Homebrewery markdown and JSON all work.
- **Filters.**
  - **Spells:** level (cantrip–9), school, source, class, concentration, ritual, plus full-text search.
  - **Items:** rarity, type, source, attunement.
  - **Monsters:** CR range, creature type, size, source.
- **Delete** one entry with the 🗑 button, or tick several and use *Delete selected*. *Select all* only selects what your current filters show, so "delete everything from source X" is two clicks.
- **Edit or add** entries by hand. Click any row to see its stat block.
- **DM Screen tab** shows the quick-reference image. Drag to pan, and zoom with the buttons.
- Duplicate protection: the same name + source isn't stored twice, unless you tick *Overwrite duplicates*.

## Running it

Requires **Node.js 22.5 or newer**. It uses Node's built-in SQLite, so there's no database to install.

```bash
npm install
npm start
# open http://127.0.0.1:3000
```

Your data lives in `data/homebrew.db`. Back that file up to keep your vault.

| Env var   | Default             | Purpose                                  |
|-----------|---------------------|------------------------------------------|
| `PORT`    | `3000`              | Port to listen on                        |
| `HOST`    | `127.0.0.1`         | Use `0.0.0.0` to reach it from other devices on your network |
| `DB_FILE` | `data/homebrew.db`  | Where the SQLite database is stored      |

> The importer fetches any URL you give it, so only expose the app to people you trust.

To use a sharper DM screen, replace `public/img/dm-screen.jpg` with a higher-resolution image.

## Tests

```bash
npm test
```

## How importing works

`src/importer.js` runs three extractors over every page and merges what they find:

1. **Embedded JSON:** `__NEXT_DATA__`, JSON-LD and raw JSON responses are scanned for arrays of objects that look like spells (`school`, `casting_time`), monsters (`challenge_rating`, `hit_points`) or items (`rarity`, `attunement`).
2. **Tables:** any table with a *Name* column, plus spell, item or monster columns. Nearby tabs or headings supply the level or rarity.
3. **Stat blocks:** the page is flattened to text, then searched for type lines such as `3rd-level evocation`, `Evocation cantrip`, `Level 2 Illusion`, `Wondrous item, rare (requires attunement)` and `Large monstrosity, unaligned`. The fields around each type line become the entry.

## API

| Method | Path                    | Body / query                         |
|--------|-------------------------|--------------------------------------|
| GET    | `/api/entries`          | `?kind=spell\|item\|monster`         |
| POST   | `/api/import/preview`   | `{ url, followLinks }` or `{ text }`. Nothing is saved |
| POST   | `/api/entries`          | `{ entries: [...], replace? }`       |
| PUT    | `/api/entries/:id`      | entry                                |
| DELETE | `/api/entries/:id`      |                                      |
| POST   | `/api/entries/delete`   | `{ ids: [...] }`                     |
