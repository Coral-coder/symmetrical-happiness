import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { openStore, entriesFromBackup } from '../public/js/store.js';

const fresh = () => openStore({ name: `t-${Math.random()}`, indexedDB: new IDBFactory() });

test('save, list, dedupe, update and delete entries', async () => {
  const store = await fresh();
  let r = await store.save([
    { kind: 'spell', name: 'Ember Lance', level: 2, school: 'Evocation', source: 'Grimoire' },
    { kind: 'spell', name: 'Frost Bloom', level: '4', school: 'Conjuration', source: 'Grimoire' },
    { kind: 'item', name: 'Cloak of Stars', rarity: 'Rare', source: 'Grimoire' },
  ]);
  assert.deepEqual(r, { saved: 3, skipped: 0, errors: [] });

  // Same kind + name + source is a duplicate, case-insensitively.
  r = await store.save([{ kind: 'spell', name: 'ember lance', source: 'grimoire' }]);
  assert.equal(r.skipped, 1);

  const spells = await store.list('spell');
  assert.deepEqual(spells.map((s) => s.name), ['Ember Lance', 'Frost Bloom']);
  assert.equal(spells[1].level, 4);

  const ember = spells[0];
  const updated = await store.update(ember.id, { ...ember, level: 3 });
  assert.equal(updated.level, 3);
  await assert.rejects(store.update(ember.id, { ...ember, name: 'Frost Bloom' }), /already in your vault/);

  assert.equal(await store.remove([ember.id]), 1);
  assert.equal((await store.list()).length, 2);
});

test('replace overwrites duplicates in place', async () => {
  const store = await fresh();
  await store.save([{ kind: 'item', name: 'Bag', rarity: 'Common', source: 'X' }]);
  const [before] = await store.list();
  const r = await store.save([{ kind: 'item', name: 'BAG', rarity: 'Rare', source: 'x' }], { replace: true });
  assert.equal(r.saved, 1);
  const all = await store.list();
  assert.equal(all.length, 1);
  assert.equal(all[0].id, before.id);
  assert.equal(all[0].rarity, 'Rare');
});

test('invalid entries are reported, not saved', async () => {
  const store = await fresh();
  const r = await store.save([{ kind: 'spell' }, { kind: 'potion', name: 'x' }]);
  assert.equal(r.saved, 0);
  assert.equal(r.errors.length, 2);
});

test('export / restore round trip', async () => {
  const a = await fresh();
  await a.save([{ kind: 'monster', name: 'Cinder Hound', cr: '3', source: 'HB' }]);
  const backup = JSON.parse(JSON.stringify(await a.exportAll()));
  const b = await fresh();
  const r = await b.save(entriesFromBackup(backup));
  assert.equal(r.saved, 1);
  assert.equal((await b.list('monster'))[0].cr, '3');
  assert.throws(() => entriesFromBackup({ nope: true }), /not a Homebrew Vault backup/);
});

test('clear empties the vault', async () => {
  const store = await fresh();
  await store.save([{ kind: 'spell', name: 'A' }]);
  await store.clear();
  assert.equal((await store.list()).length, 0);
});
