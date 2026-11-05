import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createApp } from '../server.js';

async function withServer(fn) {
  const app = createApp(openDb(':memory:'));
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body) => {
    const res = await fetch(base + path, {
      method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json() };
  };
  try { await fn(call); } finally { server.close(); }
}

test('save, list, dedupe, update and delete entries', () => withServer(async (call) => {
  const spells = [
    { kind: 'spell', name: 'Ember Lance', level: 2, school: 'Evocation', source: 'Grimoire' },
    { kind: 'spell', name: 'Frost Bloom', level: 4, school: 'Conjuration', source: 'Grimoire' },
    { kind: 'item', name: 'Cloak of Stars', rarity: 'Rare', source: 'Grimoire' },
  ];
  let r = await call('POST', '/api/entries', { entries: spells });
  assert.deepEqual(r.body, { saved: 3, skipped: 0, errors: [] });

  // Same name + source is a duplicate, case-insensitively.
  r = await call('POST', '/api/entries', { entries: [{ kind: 'spell', name: 'ember lance', source: 'grimoire' }] });
  assert.equal(r.body.skipped, 1);

  r = await call('GET', '/api/entries?kind=spell');
  assert.equal(r.body.length, 2);
  const ember = r.body.find((e) => e.name === 'Ember Lance');

  r = await call('PUT', `/api/entries/${ember.id}`, { ...ember, level: 3 });
  assert.equal(r.body.level, 3);

  r = await call('DELETE', `/api/entries/${ember.id}`);
  assert.equal(r.body.deleted, 1);

  const all = (await call('GET', '/api/entries')).body;
  r = await call('POST', '/api/entries/delete', { ids: all.map((e) => e.id) });
  assert.equal(r.body.deleted, 2);
  assert.equal((await call('GET', '/api/entries')).body.length, 0);
}));

test('invalid entries are reported, not saved', () => withServer(async (call) => {
  const r = await call('POST', '/api/entries', { entries: [{ kind: 'spell' }, { kind: 'potion', name: 'x' }] });
  assert.equal(r.body.saved, 0);
  assert.equal(r.body.errors.length, 2);
}));

test('preview from pasted text', () => withServer(async (call) => {
  const r = await call('POST', '/api/import/preview', { text: 'Spark\nEvocation cantrip\nCasting Time: 1 action\nRange: 60 feet\nComponents: V\nDuration: Instantaneous\nZap.' });
  assert.equal(r.body.entries.length, 1);
  assert.equal(r.body.entries[0].level, 0);
}));

test('rejects non-http urls', () => withServer(async (call) => {
  const r = await call('POST', '/api/import/preview', { url: 'file:///etc/passwd' });
  assert.equal(r.status, 400);
}));
