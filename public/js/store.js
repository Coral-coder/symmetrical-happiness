// In-browser storage for the vault, using IndexedDB.
// Everything stays on this device; use Export / Import backup to move it.

export const KINDS = ['spell', 'item', 'monster'];

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

const DB_NAME = 'homebrew-vault';
const STORE = 'entries';

/** Coerce an incoming (possibly user-edited) entry into a clean record. */
export function normalizeEntry(e) {
  const out = {};
  for (const f of FIELDS) {
    const v = e?.[f];
    if (f === 'level') {
      const n = v === '' || v == null ? null : Number(v);
      out.level = Number.isInteger(n) && n >= 0 && n <= 9 ? n : null;
    } else if (f === 'ritual' || f === 'concentration') {
      out[f] = v === true || v === 1 || v === '1' || v === 'true';
    } else {
      out[f] = v == null ? '' : String(v).trim();
    }
  }
  if (!KINDS.includes(out.kind)) throw new Error(`Invalid kind: ${out.kind}`);
  if (!out.name) throw new Error('Entry is missing a name');
  return out;
}

const keyOf = (e) => `${e.kind}|${e.name.toLowerCase()}|${(e.source || '').toLowerCase()}`;

const promisify = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

const done = (tx) => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
});

export async function openStore({ name = DB_NAME, indexedDB = globalThis.indexedDB } = {}) {
  if (!indexedDB) throw new Error('This browser does not support IndexedDB, so the vault cannot be saved.');
  const req = indexedDB.open(name, 1);
  req.onupgradeneeded = () => {
    const db = req.result;
    if (!db.objectStoreNames.contains(STORE)) {
      const os = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      os.createIndex('kind', 'kind');
    }
  };
  const db = await promisify(req);

  const all = async () => promisify(db.transaction(STORE).objectStore(STORE).getAll());

  return {
    /** All entries, optionally of one kind, sorted by name. */
    async list(kind) {
      const rows = await all();
      return rows
        .filter((e) => !kind || e.kind === kind)
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    },

    async get(id) {
      return promisify(db.transaction(STORE).objectStore(STORE).get(id));
    },

    /**
     * Insert entries. Same kind + name + source (case-insensitive) counts as a
     * duplicate: skipped, or overwritten when `replace` is true.
     */
    async save(entries, { replace = false } = {}) {
      const existing = new Map((await all()).map((e) => [keyOf(e), e]));
      const tx = db.transaction(STORE, 'readwrite');
      const os = tx.objectStore(STORE);
      let saved = 0;
      let skipped = 0;
      const errors = [];
      const now = new Date().toISOString();
      for (const raw of entries) {
        let e;
        try { e = normalizeEntry(raw); } catch (err) {
          errors.push(`${raw?.name || '(unnamed)'}: ${err.message}`);
          continue;
        }
        const prev = existing.get(keyOf(e));
        if (prev && !replace) { skipped++; continue; }
        const record = prev ? { ...e, id: prev.id, created_at: prev.created_at } : { ...e, created_at: raw.created_at || now };
        os.put(record);
        existing.set(keyOf(e), record);
        saved++;
      }
      await done(tx);
      return { saved, skipped, errors };
    },

    async update(id, entry) {
      const prev = await this.get(id);
      if (!prev) return null;
      const e = { ...normalizeEntry(entry), id, created_at: prev.created_at };
      const clash = (await all()).find((x) => x.id !== id && keyOf(x) === keyOf(e));
      if (clash) throw new Error(`"${e.name}" from ${e.source || 'that source'} is already in your vault.`);
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(e);
      await done(tx);
      return e;
    },

    async remove(ids) {
      const tx = db.transaction(STORE, 'readwrite');
      const os = tx.objectStore(STORE);
      let n = 0;
      for (const id of ids) {
        if (Number.isInteger(id)) { os.delete(id); n++; }
      }
      await done(tx);
      return n;
    },

    async clear() {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      await done(tx);
    },

    /** A JSON-serialisable backup of everything. */
    async exportAll() {
      const entries = (await all()).map(({ id, ...e }) => e);
      return { app: 'homebrew-vault', version: 1, exported_at: new Date().toISOString(), entries };
    },

    close() { db.close(); },
  };
}

/** Accepts a backup file's parsed JSON (or a bare array of entries). */
export function entriesFromBackup(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.entries)) return data.entries;
  throw new Error('That file is not a Homebrew Vault backup.');
}
