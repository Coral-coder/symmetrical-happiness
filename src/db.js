// SQLite storage using Node's built-in `node:sqlite` module (Node >= 22.5).
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export const KINDS = ['spell', 'item', 'monster'];

// Every column a stored entry can have. Most are only used by one kind.
export const FIELDS = [
  'kind', 'name', 'source', 'source_url', 'description',
  // spells
  'level', 'school', 'casting_time', 'range', 'components', 'duration',
  'classes', 'ritual', 'concentration', 'higher_levels',
  // items
  'item_type', 'rarity', 'attunement',
  // monsters
  'size', 'creature_type', 'alignment', 'cr', 'armor_class', 'hit_points',
  'speed', 'stats',
];

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE IF NOT EXISTS entries (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      kind          TEXT NOT NULL CHECK (kind IN ('spell','item','monster')),
      name          TEXT NOT NULL,
      source        TEXT NOT NULL DEFAULT '',
      source_url    TEXT NOT NULL DEFAULT '',
      description   TEXT NOT NULL DEFAULT '',
      level         INTEGER,
      school        TEXT NOT NULL DEFAULT '',
      casting_time  TEXT NOT NULL DEFAULT '',
      range         TEXT NOT NULL DEFAULT '',
      components    TEXT NOT NULL DEFAULT '',
      duration      TEXT NOT NULL DEFAULT '',
      classes       TEXT NOT NULL DEFAULT '',
      ritual        INTEGER NOT NULL DEFAULT 0,
      concentration INTEGER NOT NULL DEFAULT 0,
      higher_levels TEXT NOT NULL DEFAULT '',
      item_type     TEXT NOT NULL DEFAULT '',
      rarity        TEXT NOT NULL DEFAULT '',
      attunement    TEXT NOT NULL DEFAULT '',
      size          TEXT NOT NULL DEFAULT '',
      creature_type TEXT NOT NULL DEFAULT '',
      alignment     TEXT NOT NULL DEFAULT '',
      cr            TEXT NOT NULL DEFAULT '',
      armor_class   TEXT NOT NULL DEFAULT '',
      hit_points    TEXT NOT NULL DEFAULT '',
      speed         TEXT NOT NULL DEFAULT '',
      stats         TEXT NOT NULL DEFAULT '',
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS entries_unique
      ON entries (kind, name COLLATE NOCASE, source COLLATE NOCASE);
  `);
  return db;
}

// Coerce an incoming (possibly user-edited) entry into column values.
export function normalizeEntry(e) {
  const out = {};
  for (const f of FIELDS) {
    let v = e?.[f];
    if (f === 'level') {
      const n = v === '' || v == null ? null : Number(v);
      out.level = Number.isInteger(n) && n >= 0 && n <= 9 ? n : null;
    } else if (f === 'ritual' || f === 'concentration') {
      out[f] = v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0;
    } else {
      out[f] = v == null ? '' : String(v).trim();
    }
  }
  if (!KINDS.includes(out.kind)) throw new Error(`Invalid kind: ${out.kind}`);
  if (!out.name) throw new Error('Entry is missing a name');
  return out;
}

export function listEntries(db, kind) {
  if (kind) {
    return db.prepare('SELECT * FROM entries WHERE kind = ? ORDER BY name COLLATE NOCASE').all(kind);
  }
  return db.prepare('SELECT * FROM entries ORDER BY kind, name COLLATE NOCASE').all();
}

export function getEntry(db, id) {
  return db.prepare('SELECT * FROM entries WHERE id = ?').get(id);
}

/**
 * Insert entries. Duplicates (same kind + name + source, case-insensitive)
 * are skipped unless `replace` is true, in which case they are overwritten.
 */
export function saveEntries(db, entries, { replace = false } = {}) {
  const cols = FIELDS.join(', ');
  const params = FIELDS.map(() => '?').join(', ');
  const verb = replace ? 'INSERT OR REPLACE' : 'INSERT OR IGNORE';
  const stmt = db.prepare(`${verb} INTO entries (${cols}) VALUES (${params})`);
  let saved = 0;
  let skipped = 0;
  const errors = [];
  db.exec('BEGIN');
  try {
    for (const raw of entries) {
      let e;
      try {
        e = normalizeEntry(raw);
      } catch (err) {
        errors.push(`${raw?.name || '(unnamed)'}: ${err.message}`);
        continue;
      }
      const r = stmt.run(...FIELDS.map((f) => e[f]));
      if (r.changes > 0) saved++;
      else skipped++;
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return { saved, skipped, errors };
}

export function updateEntry(db, id, entry) {
  const e = normalizeEntry(entry);
  const sets = FIELDS.map((f) => `${f} = ?`).join(', ');
  const r = db.prepare(`UPDATE entries SET ${sets} WHERE id = ?`).run(...FIELDS.map((f) => e[f]), id);
  return r.changes;
}

export function deleteEntries(db, ids) {
  const clean = ids.map(Number).filter(Number.isInteger);
  if (!clean.length) return 0;
  const r = db.prepare(`DELETE FROM entries WHERE id IN (${clean.map(() => '?').join(',')})`).run(...clean);
  return Number(r.changes);
}
