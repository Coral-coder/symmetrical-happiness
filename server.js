import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  openDb, listEntries, getEntry, saveEntries, updateEntry, deleteEntries, KINDS,
} from './src/db.js';
import { importFromUrl, parseText } from './src/importer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp(db) {
  const app = express();
  app.use(express.json({ limit: '20mb' }));
  app.use(express.static(path.join(__dirname, 'public')));

  const wrap = (fn) => (req, res) => {
    Promise.resolve(fn(req, res)).catch((err) => {
      res.status(err.status || 400).json({ error: err.message || String(err) });
    });
  };

  // List everything (optionally ?kind=spell|item|monster). Filtering happens in the browser.
  app.get('/api/entries', wrap((req, res) => {
    const { kind } = req.query;
    if (kind && !KINDS.includes(kind)) throw new Error('Unknown kind');
    res.json(listEntries(db, kind));
  }));

  app.get('/api/entries/:id', wrap((req, res) => {
    const e = getEntry(db, Number(req.params.id));
    if (!e) return res.status(404).json({ error: 'Not found' });
    res.json(e);
  }));

  // Preview an import without saving anything.
  app.post('/api/import/preview', wrap(async (req, res) => {
    const { url, text, followLinks } = req.body || {};
    if (url) {
      res.json(await importFromUrl(String(url).trim(), { followLinks: !!followLinks }));
    } else if (text) {
      const entries = parseText(String(text));
      res.json({
        title: '', site: '', url: '', entries,
        warnings: entries.length ? [] : ['Nothing recognised in the pasted text. Make sure each entry includes its type line, e.g. "3rd-level evocation", "Wondrous item, rare" or "Medium humanoid, any alignment".'],
      });
    } else {
      throw new Error('Provide a url or some text to import.');
    }
  }));

  // Save one or many entries: { entries: [...], replace?: boolean }
  app.post('/api/entries', wrap((req, res) => {
    const entries = Array.isArray(req.body?.entries) ? req.body.entries : [req.body];
    res.json(saveEntries(db, entries, { replace: !!req.body?.replace }));
  }));

  app.put('/api/entries/:id', wrap((req, res) => {
    const n = updateEntry(db, Number(req.params.id), req.body);
    if (!n) return res.status(404).json({ error: 'Not found' });
    res.json(getEntry(db, Number(req.params.id)));
  }));

  app.delete('/api/entries/:id', wrap((req, res) => {
    res.json({ deleted: deleteEntries(db, [Number(req.params.id)]) });
  }));

  // Bulk delete: { ids: [1, 2, 3] }
  app.post('/api/entries/delete', wrap((req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    res.json({ deleted: deleteEntries(db, ids) });
  }));

  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dbFile = process.env.DB_FILE || path.join(__dirname, 'data', 'homebrew.db');
  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || '127.0.0.1';
  const app = createApp(openDb(dbFile));
  app.listen(port, host, () => {
    console.log(`Homebrew Vault running at http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
    console.log(`Database: ${dbFile}`);
  });
}
