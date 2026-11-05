import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from 'linkedom';
import {
  parseHtml, parseText, parseLevel, entriesFromJson, importFromUrl, makeFetcher, parseHomebrewerySource,
} from '../public/js/importer.js';

// The importer runs in the browser; linkedom stands in for the DOM here.
globalThis.DOMParser = DOMParser;

test('parseLevel understands common spellings', () => {
  assert.equal(parseLevel('Cantrip'), 0);
  assert.equal(parseLevel('3rd-level'), 3);
  assert.equal(parseLevel('3rd Level'), 3);
  assert.equal(parseLevel('Level 7'), 7);
  assert.equal(parseLevel('9'), 9);
  assert.equal(parseLevel('Rare'), null);
});

test('single spell page where the name is the page title (wikidot style)', () => {
  const html = `<html><head><title>Ember Lance - Some Wiki</title></head><body>
    <div id="page-content">
      <p>Source: Grimoire of Cinders</p>
      <p><em>2nd-level evocation (ritual)</em></p>
      <p><strong>Casting Time:</strong> 1 action<br><strong>Range:</strong> 90 feet<br>
      <strong>Components:</strong> V, S, M (a coal)<br><strong>Duration:</strong> Concentration, up to 1 minute</p>
      <p>A lance of white-hot embers streaks out.</p>
      <p><strong><em>At Higher Levels.</em></strong> +1d6 per slot level above 2nd.</p>
      <p><strong><em>Spell Lists.</em></strong> Sorcerer, Wizard</p>
    </div></body></html>`;
  const { entries } = parseHtml(html, { url: 'https://example.com/spell:ember-lance' });
  assert.equal(entries.length, 1);
  const [s] = entries;
  assert.equal(s.kind, 'spell');
  assert.equal(s.name, 'Ember Lance');
  assert.equal(s.level, 2);
  assert.equal(s.school, 'Evocation');
  assert.equal(s.ritual, true);
  assert.equal(s.concentration, true);
  assert.equal(s.range, '90 feet');
  assert.equal(s.components, 'V, S, M (a coal)');
  assert.equal(s.source, 'Grimoire of Cinders');
  assert.equal(s.classes, 'Sorcerer, Wizard');
  assert.match(s.higher_levels, /1d6/);
  assert.match(s.description, /white-hot embers/);
});

test('list table with level tabs (wikidot spells:class style)', () => {
  const html = `<div id="page-content"><div class="yui-navset">
    <ul class="yui-nav"><li><a><em>Cantrip</em></a></li><li><a><em>1st Level</em></a></li></ul>
    <div class="yui-content">
      <div id="wiki-tab-0-0"><table>
        <tr><th>Spell Name</th><th>School</th><th>Casting Time</th><th>Range</th><th>Duration</th><th>Components</th></tr>
        <tr><td><a href="/spell:spark">Spark</a></td><td>Evocation</td><td>1 Action</td><td>60 feet</td><td>Instantaneous</td><td>V, S</td></tr>
      </table></div>
      <div id="wiki-tab-0-1"><table>
        <tr><th>Spell Name</th><th>School</th><th>Casting Time</th><th>Range</th><th>Duration</th><th>Components</th></tr>
        <tr><td><a href="/spell:quiet-ward">Quiet Ward</a></td><td>Abjuration</td><td>1 Minute R</td><td>Touch</td><td>Concentration, up to 1 hour</td><td>V, S, M</td></tr>
      </table></div>
    </div></div></div>`;
  const { entries } = parseHtml(html, { url: 'https://wiki.example.com/spells:wizard' });
  assert.equal(entries.length, 2);
  const spark = entries.find((e) => e.name === 'Spark');
  const ward = entries.find((e) => e.name === 'Quiet Ward');
  assert.equal(spark.level, 0);
  assert.equal(spark.source_url, 'https://wiki.example.com/spell:spark');
  assert.equal(ward.level, 1);
  assert.equal(ward.ritual, true);
  assert.equal(ward.casting_time, '1 Minute');
  assert.equal(ward.concentration, true);
});

test('item list table uses rarity tabs', () => {
  const html = `<div class="yui-navset"><ul class="yui-nav"><li><em>Common</em></li><li><em>Very Rare</em></li></ul>
    <div id="wiki-tab-0-1"><table>
      <tr><th>Item Name</th><th>Type</th><th>Attuned</th><th>Source</th></tr>
      <tr><td>Cloak of Stars</td><td>Wondrous Item</td><td>Attuned</td><td>HB</td></tr>
    </table></div></div>`;
  const [it] = parseHtml(html).entries;
  assert.equal(it.kind, 'item');
  assert.equal(it.rarity, 'Very Rare');
  assert.equal(it.item_type, 'Wondrous Item');
  assert.equal(it.attunement, 'Requires attunement');
});

test('embedded Next.js JSON (mythical.ink style)', () => {
  const data = { props: { pageProps: { sourceTable: { spells: [
    { name: 'Frost Bloom', level: '4', school: 'conjuration', casting_time: '1 action', range: '60 feet',
      components: { raw: 'V, S' }, duration: 'Concentration, up to 1 minute', classes: ['druid', 'wizard'],
      ritual: false, description: 'Ice flowers bloom.<br /><br />They shatter.', source: 'Homebrew' },
  ] } } } };
  const html = `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script></body></html>`;
  const [s] = parseHtml(html).entries;
  assert.equal(s.name, 'Frost Bloom');
  assert.equal(s.level, 4);
  assert.equal(s.school, 'Conjuration');
  assert.equal(s.components, 'V, S');
  assert.equal(s.classes, 'Druid, Wizard');
  assert.equal(s.concentration, true);
  assert.match(s.description, /Ice flowers bloom\.\n+They shatter\./);
});

test('pasted Homebrewery markdown with spells, items and a monster', () => {
  const md = `
{{monster,frame
## Cinder Hound
*Medium fiend, chaotic evil*
___
**Armor Class** :: 14 (natural armor)
**Hit Points**  :: 45 (6d8 + 18)
**Speed**       :: 40 ft.
___
|  STR  |  DEX  |  CON  |  INT  |  WIS  |  CHA  |
|:-----:|:-----:|:-----:|:-----:|:-----:|:-----:|
|17 (+3)|14 (+2)|16 (+3)| 6 (-2)|12 (+1)| 6 (-2)|
___
**Challenge** :: 3 (700 XP)
***Fire Breath.*** The hound exhales fire.
}}

#### Ashen Step
*Conjuration cantrip*
___
- **Casting Time:** 1 bonus action
- **Range:** Self
- **Components:** S
- **Duration:** Instantaneous

You vanish in a puff of ash.

#### Lantern of Echoes
*Wondrous item, rare (requires attunement by a bard)*

This lantern repeats the last thing said near it.

#### Ring of Small Comforts
*Ring, uncommon*

Keeps you warm.
`;
  const entries = parseText(md);
  const byName = Object.fromEntries(entries.map((e) => [e.name, e]));
  assert.deepEqual(Object.keys(byName).sort(), ['Ashen Step', 'Cinder Hound', 'Lantern of Echoes', 'Ring of Small Comforts']);

  const m = byName['Cinder Hound'];
  assert.equal(m.kind, 'monster');
  assert.equal(m.size, 'Medium');
  assert.equal(m.creature_type, 'Fiend');
  assert.equal(m.cr, '3');
  assert.equal(m.armor_class, '14 (natural armor)');
  assert.equal(m.stats, 'STR 17 (+3), DEX 14 (+2), CON 16 (+3), INT 6 (-2), WIS 12 (+1), CHA 6 (-2)');
  assert.match(m.description, /Fire Breath/);

  const s = byName['Ashen Step'];
  assert.equal(s.level, 0);
  assert.equal(s.school, 'Conjuration');
  assert.equal(s.casting_time, '1 bonus action');
  assert.match(s.description, /puff of ash/);

  const l = byName['Lantern of Echoes'];
  assert.equal(l.kind, 'item');
  assert.equal(l.rarity, 'Rare');
  assert.equal(l.attunement, 'Requires attunement by a bard');
  assert.equal(byName['Ring of Small Comforts'].rarity, 'Uncommon');
  assert.equal(byName['Ring of Small Comforts'].item_type, 'Ring');
});

test('pasted 2024-style spell header', () => {
  const [s] = parseText(`Gloomstride\nLevel 2 Illusion (Bard, Warlock)\nCasting Time: Bonus Action\nRange: Self\nComponents: V\nDuration: 1 minute\nShadows cling to you.`);
  assert.equal(s.name, 'Gloomstride');
  assert.equal(s.level, 2);
  assert.equal(s.school, 'Illusion');
  assert.equal(s.classes, 'Bard, Warlock');
});

test('JSON arrays of monsters and items', () => {
  const entries = entriesFromJson([
    { name: 'Bog Witch', challenge_rating: '5', armor_class: 15, hit_points: 90, size: 'Medium', type: 'fey', strength: 10, dexterity: 14 },
    { name: 'Sun Blade', rarity: 'rare', type: 'Weapon (longsword)', requires_attunement: true },
  ]);
  assert.equal(entries[0].kind, 'monster');
  assert.equal(entries[0].cr, '5');
  assert.equal(entries[0].stats, 'STR 10, DEX 14');
  assert.equal(entries[1].kind, 'item');
  assert.equal(entries[1].rarity, 'Rare');
  assert.equal(entries[1].attunement, 'Requires attunement');
});

test('Homebrewery /source page is unwrapped from its <code> block', () => {
  const body = '<code><pre>#### Mote of Dawn\n*1st-level evocation*\n**Casting Time:** 1 action\n**Range:** 30 feet\n**Components:** V\n**Duration:** 1 round\nA mote of light &amp; warmth.</pre></code>';
  const { entries } = parseHomebrewerySource(body);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].name, 'Mote of Dawn');
  assert.match(entries[0].description, /light & warmth/);
});

const fakeResponse = (body, { status = 200, type = 'text/html' } = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => type },
  text: async () => body,
});

test('fetcher falls back to the next proxy when direct fetch is blocked', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.startsWith('https://example.com')) throw new TypeError('Failed to fetch'); // CORS
    if (url.startsWith('https://p1.test')) return fakeResponse('nope', { status: 429 });
    return fakeResponse('<p>hello</p>');
  };
  const fetchText = makeFetcher({ proxies: ['https://p1.test/?u={url}', 'https://p2.test/{rawurl}'], fetchImpl });
  const r = await fetchText('https://example.com/a?b=1');
  assert.equal(r.body, '<p>hello</p>');
  assert.equal(r.finalUrl, 'https://example.com/a?b=1');
  assert.ok(calls.includes(`https://p1.test/?u=${encodeURIComponent('https://example.com/a?b=1')}`));
  assert.ok(calls.includes('https://p2.test/https://example.com/a?b=1'));
  // The proxy that worked is tried first next time.
  calls.length = 0;
  await fetchText('https://example.com/c');
  assert.deepEqual(calls, ['https://example.com/c', 'https://p2.test/https://example.com/c']);
});

test('fetcher reports every route when all fail', async () => {
  const fetchText = makeFetcher({ proxies: ['https://p1.test/{url}'], retryDelayMs: 1, fetchImpl: async () => { throw new TypeError('Failed to fetch'); } });
  await assert.rejects(fetchText('https://blocked.example/x'), (err) => err.blocked && /direct.*p1\.test/.test(err.message));
  await assert.rejects(fetchText('https://dnd5e.wikidot.com/spell:x'), (err) => err.blocked && /usually blocks/.test(err.message));
});

test('a proxy answering 200 with an error document is not treated as the page', async () => {
  const fetchImpl = async (url) => {
    if (url.startsWith('https://site.test')) throw new TypeError('Failed to fetch');
    if (url.startsWith('https://bad.test')) return fakeResponse('{"data":null,"code":422}', { type: 'application/json' });
    await new Promise((r) => setTimeout(r, 20));
    return fakeResponse('<p>real page</p>');
  };
  const fetchText = makeFetcher({ proxies: ['https://bad.test/{rawurl}', 'https://good.test/{rawurl}'], fetchImpl });
  assert.equal((await fetchText('https://site.test/x')).body, '<p>real page</p>');
});

test('importFromUrl follows links on list pages to fill in descriptions', async () => {
  const pages = {
    'https://wiki.test/spells': `<table><tr><th>Spell Name</th><th>School</th></tr>
      <tr><td><a href="/spell:glow">Glow</a></td><td>Evocation</td></tr></table>`,
    'https://wiki.test/spell:glow': `<html><head><title>Glow - Wiki</title></head><body><div id="page-content">
      <p>Evocation cantrip</p><p>Casting Time: 1 action<br>Range: Touch<br>Components: V, M (a firefly)<br>Duration: 1 hour</p>
      <p>An object glows softly.</p></div></body></html>`,
  };
  const fetchText = async (url) => ({ body: pages[url], type: 'text/html', finalUrl: url });
  const res = await importFromUrl('https://wiki.test/spells', { followLinks: true, fetchText });
  const [glow] = res.entries;
  assert.equal(glow.name, 'Glow');
  assert.equal(glow.level, 0);
  assert.equal(glow.components, 'V, M (a firefly)');
  assert.equal(glow.source_url, 'https://wiki.test/spell:glow');
  assert.match(glow.description, /glows softly/);
});

test('importFromUrl rejects non-http urls', async () => {
  await assert.rejects(importFromUrl('file:///etc/passwd'), /Only http/);
});

test('fetcher retries the proxies once after a failed round', async () => {
  let n = 0;
  const fetchImpl = async (url) => {
    if (url.startsWith('https://flaky.example')) throw new TypeError('Failed to fetch');
    n++;
    if (n === 1) return fakeResponse('busy', { status: 503 });
    return fakeResponse('<p>ok now</p>');
  };
  const fetchText = makeFetcher({ proxies: ['https://retry-proxy.test/{rawurl}'], retryDelayMs: 1, fetchImpl });
  assert.equal((await fetchText('https://flaky.example/x')).body, '<p>ok now</p>');
});
