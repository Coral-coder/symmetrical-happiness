// Turns webpages (or pasted text) into spell / item / monster entries.
// Runs entirely in the browser: it only needs a global DOMParser.
//
// Three strategies run over every page and their results are merged:
//   1. Embedded JSON  - e.g. Next.js __NEXT_DATA__, JSON-LD, raw JSON APIs.
//   2. HTML tables    - list pages like dnd5e.wikidot.com/spells:wizard.
//   3. Text stat blocks - "3rd-level evocation / Casting Time: ..." style
//      write-ups, "Wondrous item, rare" items and "Medium humanoid, ..."
//      monsters. Also used for pasted text and Homebrewery markdown.

function parseDoc(html) {
  return new DOMParser().parseFromString(String(html), 'text/html');
}
const text = (el) => (el ? el.textContent || '' : '');
const cellsOf = (row) => Array.from(row.children).filter((c) => /^(TD|TH)$/i.test(c.tagName));

export const SCHOOLS = [
  'Abjuration', 'Conjuration', 'Divination', 'Enchantment',
  'Evocation', 'Illusion', 'Necromancy', 'Transmutation',
];
const SCHOOL_CODES = { A: 'Abjuration', C: 'Conjuration', D: 'Divination', E: 'Enchantment', V: 'Evocation', I: 'Illusion', N: 'Necromancy', T: 'Transmutation' };
export const RARITIES = ['Common', 'Uncommon', 'Rare', 'Very Rare', 'Legendary', 'Artifact', 'Varies'];
const RARITY_RE = /\b(very rare|uncommon|common|rare|legendary|artifact|rarity varies|varies|unknown rarity)\b/i;
const SIZES = 'tiny|small|medium|large|huge|gargantuan';
const ITEM_TYPES = 'wondrous item|armor|armour|weapon|ring|rod|staff|wand|potion|scroll|ammunition|shield|instrument|tattoo|vehicle|trinket|spellcasting focus|gear|adventuring gear';

const MAX_LINES_PER_ENTRY = 80;

// ---------------------------------------------------------------- helpers

export function titleCase(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/(^|[\s(/-])([a-z])/g, (_, p, c) => p + c.toUpperCase())
    .replace(/\b(Of|The|And|In|On|A|An|To|Or)\b(?!$)/g, (w, _w, i) => (i === 0 ? w : w.toLowerCase()));
}

function normSchool(s) {
  if (!s) return '';
  const t = String(s).trim();
  if (SCHOOL_CODES[t]) return SCHOOL_CODES[t];
  const hit = SCHOOLS.find((x) => x.toLowerCase() === t.toLowerCase());
  return hit || titleCase(t);
}

function normRarity(s) {
  const m = RARITY_RE.exec(String(s || ''));
  if (!m) return '';
  const r = m[1].toLowerCase();
  if (r.includes('varies')) return 'Varies';
  if (r === 'unknown rarity') return '';
  return titleCase(r);
}

/** "cantrip" -> 0, "3rd-level" / "Level 3" / "3" -> 3, otherwise null. */
export function parseLevel(s) {
  if (s == null) return null;
  if (typeof s === 'number') return Number.isInteger(s) && s >= 0 && s <= 9 ? s : null;
  const t = String(s).trim().toLowerCase();
  if (!t) return null;
  if (/cantrip/.test(t) || t === '0') return 0;
  const m = /^(?:level\s*)?(\d)(?:st|nd|rd|th)?(?:[\s-]*level)?\b/.exec(t);
  return m ? Number(m[1]) : null;
}

function clean(s) {
  return String(s ?? '').replace(/ /g, ' ').replace(/[ \t]+/g, ' ').trim();
}

function htmlFragmentToText(s) {
  if (s == null) return '';
  const str = String(s);
  if (!/[<&]/.test(str)) return str.trim();
  const doc = parseDoc(`<div id="x">${str.replace(/<br\s*\/?>/gi, '\n')}</div>`);
  const root = doc.getElementById('x');
  root.querySelectorAll('p,div,li').forEach((el) => el.append('\n'));
  return text(root).replace(/\n{3,}/g, '\n\n').trim();
}

/** Strip Homebrewery / markdown decoration from a line of text. */
export function cleanMarkdownLine(line) {
  let l = line;
  if (/^\s*(\\page|\\column|_{3,}|-{3,}|\*{3,}|:{1,}|\}\}|\{\{[^}]*$)\s*$/.test(l)) return '';
  if (/^\s*<!--/.test(l) || /^\s*!\[/.test(l)) return '';
  l = l.replace(/\{\{[^\s}]*\s?/g, '').replace(/\}\}/g, '');
  l = l.replace(/^\s*#{1,6}\s*/, '');
  l = l.replace(/^\s*>+\s*/, '');
  l = l.replace(/^\s*[-*+]\s+/, '');
  l = l.replace(/\*\*|__/g, '');
  l = l.replace(/(^|\s)[*_]([^*_]+)[*_](?=\s|$|[.,:;])/g, '$1$2');
  l = l.replace(/^[*_]+|[*_]+$/g, '');
  l = l.replace(/\s*::\s*/g, ' ');
  l = l.replace(/\{[^}]*:[^}]*\}/g, '');
  l = l.replace(/\|/g, ' ');
  if (/^[\s:-]+$/.test(l)) return ''; // markdown table divider
  return clean(l);
}

function cleanPageTitle(t) {
  return clean(String(t || '').split(/\s+[-|–—]\s+/)[0]);
}

function looksLikeName(line) {
  return !!line && line.length <= 70 && !/[.!?:]$/.test(line) && !/^source\s*:/i.test(line);
}

// ------------------------------------------------- 1. embedded JSON data

const lc = (k) => k.toLowerCase().replace(/[_\s-]/g, '');

function pick(obj, ...keys) {
  const map = {};
  for (const k of Object.keys(obj)) map[lc(k)] = obj[k];
  for (const k of keys) {
    const v = map[lc(k)];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

function str(v) {
  if (v == null) return '';
  if (Array.isArray(v)) return v.map(str).filter(Boolean).join(', ');
  if (typeof v === 'object') {
    const raw = pick(v, 'raw', 'text', 'value', 'name', 'display');
    if (raw !== undefined) return str(raw);
    // 5etools-style {v:true,s:true,m:"..."}
    const parts = [];
    if (v.v) parts.push('V');
    if (v.s) parts.push('S');
    if (v.m) parts.push(typeof v.m === 'string' ? `M (${v.m})` : 'M');
    if (parts.length) return parts.join(', ');
    // 5etools-style time / duration arrays
    if (v.number && v.unit) return `${v.number} ${v.unit}`;
    if (v.type && v.amount) return `${v.amount.amount ?? v.amount} ${v.amount.type ?? v.type}`;
    return '';
  }
  return htmlFragmentToText(String(v));
}

function entriesText(v) {
  if (v == null) return '';
  if (typeof v === 'string') return htmlFragmentToText(v);
  if (Array.isArray(v)) return v.map(entriesText).filter(Boolean).join('\n\n');
  if (typeof v === 'object') {
    const head = v.name ? `${v.name}. ` : '';
    return head + entriesText(v.entries ?? v.items ?? v.text ?? v.desc ?? v.description ?? '');
  }
  return String(v);
}

function classifyJson(o) {
  const keys = new Set(Object.keys(o).map(lc));
  const has = (...k) => k.some((x) => keys.has(lc(x)));
  if (has('castingtime', 'casting_time', 'school') || (has('level') && has('components'))) return 'spell';
  if (has('challengerating', 'cr') || (has('hitpoints', 'hp') && has('armorclass', 'ac'))) return 'monster';
  if (has('rarity', 'requiresattunement', 'attunement', 'reqattune')) return 'item';
  return null;
}

function fromJsonObject(o, kind) {
  const name = str(pick(o, 'name', 'title'));
  if (!name) return null;
  const desc = entriesText(pick(o, 'description', 'desc', 'entries', 'text', 'body'));
  const e = { kind, name, description: desc, source: str(pick(o, 'source', 'book', 'publisher')) };
  if (kind === 'spell') {
    const lvl = pick(o, 'level', 'spellLevel', 'lvl');
    e.level = parseLevel(lvl);
    e.school = normSchool(str(pick(o, 'school', 'spellSchool')));
    e.casting_time = str(pick(o, 'casting_time', 'castingTime', 'time'));
    e.range = str(pick(o, 'range'));
    e.components = str(pick(o, 'components'));
    e.duration = str(pick(o, 'duration'));
    const cls = pick(o, 'classes', 'class', 'dnd_class', 'spellLists');
    e.classes = Array.isArray(cls) ? cls.map((c) => titleCase(str(c))).join(', ') : titleCase(str(cls));
    const rit = pick(o, 'ritual', 'can_be_cast_as_ritual');
    e.ritual = rit === true || /^(yes|true)$/i.test(String(rit ?? ''));
    const conc = pick(o, 'concentration', 'requires_concentration');
    e.concentration = conc === true || /^(yes|true)$/i.test(String(conc ?? '')) || /concentration/i.test(e.duration);
    e.higher_levels = entriesText(pick(o, 'higher_levels', 'higherLevels', 'higher_level', 'entriesHigherLevel', 'atHigherLevels'));
  } else if (kind === 'item') {
    e.item_type = titleCase(str(pick(o, 'type', 'item_type', 'itemType', 'category')));
    e.rarity = normRarity(str(pick(o, 'rarity')));
    const att = pick(o, 'attunement', 'requires_attunement', 'requiresAttunement', 'reqAttune');
    e.attunement = att === true ? 'Requires attunement' : str(att);
  } else if (kind === 'monster') {
    e.size = titleCase(str(pick(o, 'size')));
    e.creature_type = titleCase(str(pick(o, 'type', 'creature_type', 'creatureType')));
    e.alignment = str(pick(o, 'alignment'));
    e.cr = str(pick(o, 'challenge_rating', 'challengeRating', 'cr'));
    e.armor_class = str(pick(o, 'armor_class', 'armorClass', 'ac'));
    e.hit_points = str(pick(o, 'hit_points', 'hitPoints', 'hp'));
    e.speed = str(pick(o, 'speed'));
    const scores = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma']
      .map((k) => [k.slice(0, 3).toUpperCase(), pick(o, k, k.slice(0, 3))])
      .filter(([, v]) => v != null);
    if (scores.length) e.stats = scores.map(([k, v]) => `${k} ${v}`).join(', ');
    if (!desc) {
      e.description = ['special_abilities', 'traits', 'trait', 'actions', 'action', 'legendary_actions', 'legendary']
        .map((k) => entriesText(pick(o, k)))
        .filter(Boolean)
        .join('\n\n');
    }
  }
  return e;
}

export function entriesFromJson(data) {
  const out = [];
  const seen = new Set();
  const walk = (v, depth) => {
    if (!v || typeof v !== 'object' || depth > 12 || seen.has(v)) return;
    seen.add(v);
    if (Array.isArray(v)) {
      for (const x of v) {
        if (x && typeof x === 'object' && !Array.isArray(x)) {
          const kind = classifyJson(x);
          const e = kind && fromJsonObject(x, kind);
          if (e) { out.push(e); continue; }
        }
        walk(x, depth + 1);
      }
    } else {
      for (const x of Object.values(v)) walk(x, depth + 1);
    }
  };
  // A single top-level object can also be an entry.
  if (data && !Array.isArray(data) && typeof data === 'object') {
    const kind = classifyJson(data);
    const e = kind && fromJsonObject(data, kind);
    if (e) return [e];
  }
  walk(data, 0);
  return out;
}

function jsonFromHtml(doc) {
  const out = [];
  doc.querySelectorAll('script[type="application/json"], script[type="application/ld+json"], script#__NEXT_DATA__, script#__NUXT_DATA__').forEach((el) => {
    try {
      out.push(...entriesFromJson(JSON.parse(text(el))));
    } catch { /* not JSON */ }
  });
  return out;
}

// ------------------------------------------------------- 2. HTML tables

const HEADER_FIELDS = [
  [/^(spell|item|monster|creature|magic item)?\s*name$|^(spell|item|monster|creature)$/, 'name'],
  [/^school$/, 'school'],
  [/^(spell\s*)?level$|^lvl$/, 'level'],
  [/^casting\s*time$|^time$/, 'casting_time'],
  [/^range$/, 'range'],
  [/^duration$/, 'duration'],
  [/^components?$|^comp\.?$/, 'components'],
  [/^class(es)?$|^spell lists?$/, 'classes'],
  [/^ritual$/, 'ritual'],
  [/^conc(entration)?\.?$/, 'concentration'],
  [/^rarity$/, 'rarity'],
  [/^attun(ed|ement)?|^requires attunement$/, 'attunement'],
  [/^(item\s*)?type$|^category$/, 'type'],
  [/^cr$|^challenge( rating)?$/, 'cr'],
  [/^size$/, 'size'],
  [/^alignment$/, 'alignment'],
  [/^ac$|^armou?r class$/, 'armor_class'],
  [/^hp$|^hit points$/, 'hit_points'],
  [/^speed$/, 'speed'],
  [/^source|^book$/, 'source'],
  [/^desc(ription)?$|^effect$/, 'description'],
];

function headerField(h) {
  const t = clean(h).toLowerCase().replace(/[^a-z ]/g, '').trim();
  for (const [re, f] of HEADER_FIELDS) if (re.test(t)) return f;
  return null;
}

/** Label a table with nearby context, e.g. the wikidot tab name ("3rd Level", "Rare"). */
function tableContext(table) {
  let node = table;
  for (let depth = 0; depth < 8 && node && node.nodeType === 1; depth++) {
    const tab = /^wiki-tab-\d+-(\d+)$/.exec(node.id || '');
    if (tab) {
      const nav = node.closest('.yui-navset');
      const label = nav ? text(nav.querySelectorAll('.yui-nav li')[Number(tab[1])]) : '';
      if (label) return clean(label);
    }
    for (let sib = node.previousElementSibling; sib; sib = sib.previousElementSibling) {
      if (/^H[1-6]$/i.test(sib.tagName)) return clean(text(sib));
    }
    node = node.parentElement;
  }
  return '';
}

function entriesFromTables(doc, baseUrl) {
  const out = [];
  doc.querySelectorAll('table').forEach((table) => {
    const rows = Array.from(table.querySelectorAll('tr')).filter((r) => r.closest('table') === table);
    if (rows.length < 2) return;
    const headerIdx = rows.findIndex((r) => cellsOf(r).filter((c) => /^TH$/i.test(c.tagName)).length >= 2);
    const hIdx = headerIdx === -1 ? 0 : headerIdx;
    const headers = cellsOf(rows[hIdx]).map((c) => headerField(text(c)));
    const nameCol = headers.indexOf('name');
    if (nameCol === -1) return;
    const hs = new Set(headers);
    const rawHeader = clean(text(rows[hIdx])).toLowerCase();
    let kind = null;
    if (hs.has('school') || hs.has('casting_time') || hs.has('components') || /spell/.test(rawHeader)) kind = 'spell';
    else if (hs.has('cr') || hs.has('hit_points') || hs.has('armor_class') || /monster|creature/.test(rawHeader)) kind = 'monster';
    else if (hs.has('rarity') || hs.has('attunement') || /item/.test(rawHeader)) kind = 'item';
    if (!kind) return;

    let used = false;
    const context = tableContext(table);
    const ctxLevel = parseLevel(context);
    const ctxRarity = normRarity(context);

    for (const row of rows.slice(hIdx + 1)) {
      const cells = cellsOf(row);
      if (cells.length < 2 || !cells[nameCol]) continue;
      const nameCell = cells[nameCol];
      const name = clean(text(nameCell));
      if (!name) continue;
      const e = { kind, name };
      const href = nameCell.querySelector('a[href]')?.getAttribute('href');
      if (href && !href.startsWith('javascript:') && !href.startsWith('#')) {
        try { e.source_url = new URL(href, baseUrl).href; } catch { /* ignore */ }
      }
      headers.forEach((f, i) => {
        if (!f || f === 'name' || !cells[i]) return;
        const v = clean(text(cells[i]));
        if (!v || v === '-' || v === '—') return;
        if (f === 'type') {
          if (kind === 'item') e.item_type = titleCase(v);
          else if (kind === 'monster') e.creature_type = titleCase(v);
        } else if (f === 'level') e.level = parseLevel(v);
        else if (f === 'school') e.school = normSchool(v);
        else if (f === 'rarity') e.rarity = normRarity(v);
        else if (f === 'ritual' || f === 'concentration') e[f] = /^(yes|y|true|x|✓|✔)$/i.test(v);
        else if (f === 'attunement') e.attunement = /^(no|n)$/i.test(v) ? '' : (/^(yes|y|attuned)$/i.test(v) ? 'Requires attunement' : v);
        else e[f] = v;
      });
      if (kind === 'spell') {
        if (e.level == null && ctxLevel != null) e.level = ctxLevel;
        if (e.duration && /concentration/i.test(e.duration)) e.concentration = true;
        // wikidot marks ritual spells with a trailing " R" ("1 Minute R").
        if (e.casting_time && /\s(R|\(ritual\))$/i.test(e.casting_time)) {
          e.casting_time = e.casting_time.replace(/\s(R|\(ritual\))$/i, '');
          e.ritual = true;
        }
      }
      if (kind === 'item' && !e.rarity && ctxRarity) e.rarity = ctxRarity;
      out.push(e);
      used = true;
    }
    // Tables we understood are skipped by the text parser.
    if (used) table.setAttribute('data-hv-parsed', '1');
  });
  return out;
}

// --------------------------------------------------- 3. text stat blocks

/** Flatten an HTML element into trimmed, non-empty lines. */
export function htmlToLines(root) {
  const r = root.cloneNode(true);
  r.querySelectorAll('script,style,noscript,nav,header,footer,iframe,svg,form,button,select,.yui-nav,table[data-hv-parsed]').forEach((el) => el.remove());
  r.querySelectorAll('br').forEach((el) => el.replaceWith('\n'));
  r.querySelectorAll('p,div,li,tr,h1,h2,h3,h4,h5,h6,dt,dd,section,article,blockquote,pre,ul,ol,table').forEach((el) => {
    el.prepend('\n');
    el.append('\n');
  });
  r.querySelectorAll('td,th').forEach((el) => el.append(' '));
  return textToLines(text(r));
}

export function textToLines(text) {
  return String(text)
    .split(/\r?\n/)
    .map(cleanMarkdownLine)
    .filter(Boolean);
}

function spellHeader(line) {
  let m = /^(\d)(?:st|nd|rd|th)[\s-]+level\s+([a-z]+)\b(.*)$/i.exec(line);
  if (m) return { level: Number(m[1]), school: m[2], rest: m[3] };
  m = /^level\s+(\d)\s+([a-z]+)\b(.*)$/i.exec(line);
  if (m) return { level: Number(m[1]), school: m[2], rest: m[3] };
  m = /^([a-z]+)\s+cantrip\b(.*)$/i.exec(line);
  if (m) return { level: 0, school: m[1], rest: m[2] };
  return null;
}

function itemHeader(line) {
  if (line.length > 160) return null;
  const m = new RegExp(`^(${ITEM_TYPES})\\b([^,]*),\\s*(.+)$`, 'i').exec(line);
  if (!m || !RARITY_RE.test(m[3])) return null;
  const att = /\(?(requires attunement[^)]*)\)?/i.exec(m[3]);
  return {
    item_type: titleCase(m[1]) + (m[2].trim() ? ` ${m[2].trim()}` : ''),
    rarity: normRarity(m[3]),
    attunement: att ? att[1].replace(/^./, (c) => c.toUpperCase()) : '',
  };
}

function monsterHeader(line) {
  if (line.length > 120) return null;
  const m = new RegExp(`^((?:${SIZES})(?:\\s*(?:or|/)\\s*(?:${SIZES}))?)\\s+([a-z][a-z ]*?)(\\s*\\([^)]*\\))?\\s*,\\s*(.+)$`, 'i').exec(line);
  if (!m) return null;
  return {
    size: titleCase(m[1]),
    creature_type: titleCase(m[2] + (m[3] || '')),
    alignment: clean(m[4]),
  };
}

const lookAhead = (lines, i, n, re) => lines.slice(i + 1, i + 1 + n).some((l) => re.test(l));

function findHeaders(lines) {
  const found = [];
  const claimedCasting = new Set();
  lines.forEach((line, i) => {
    const sp = spellHeader(line);
    if (sp && lookAhead(lines, i, 6, /^casting time\b/i)) {
      for (let j = i + 1; j < i + 7 && j < lines.length; j++) if (/^casting time\b/i.test(lines[j])) { claimedCasting.add(j); break; }
      found.push({ kind: 'spell', at: i, data: sp });
      return;
    }
    const it = itemHeader(line);
    if (it) { found.push({ kind: 'item', at: i, data: it }); return; }
    const mo = monsterHeader(line);
    if (mo && lookAhead(lines, i, 6, /^(armou?r class|ac)\b/i)) { found.push({ kind: 'monster', at: i, data: mo }); }
  });
  // Spells with no "3rd-level evocation" line, e.g. "Level: 3 / School: Evocation".
  lines.forEach((line, i) => {
    if (/^casting time\b/i.test(line) && !claimedCasting.has(i)) {
      let at = i;
      while (at > 0 && /^(level|school|source|classes?)\s*[:.]/i.test(lines[at - 1])) at--;
      found.push({ kind: 'spell', at, nameAt: at - 1, data: null, labelOnly: true });
    }
  });
  return found.sort((a, b) => a.at - b.at);
}

const SPELL_LABELS = [
  [/^casting time\s*[:.]?\s*(.*)$/i, 'casting_time'],
  [/^range(?:\/area)?\s*[:.]\s*(.*)$|^range$/i, 'range'],
  [/^components?\s*[:.]\s*(.*)$|^components$/i, 'components'],
  [/^duration\s*[:.]\s*(.*)$|^duration$/i, 'duration'],
  [/^(?:classes?|spell lists?|available for)\s*[:.]\s*(.*)$/i, 'classes'],
  [/^school\s*[:.]\s*(.*)$/i, 'school'],
  [/^level\s*[:.]\s*(.*)$/i, 'level'],
  [/^source\s*[:.]\s*(.*)$/i, 'source'],
  [/^(?:at higher levels|using a higher-level spell_?|cantrip upgrade)\s*[:.]\s*(.*)$/i, 'higher_levels'],
];
const ITEM_LABELS = [[/^source\s*[:.]\s*(.*)$/i, 'source']];
const MONSTER_LABELS = [
  [/^(?:armou?r class|ac)\b\s*:?\s*(.*?)(?:\s+initiative\b.*)?$/i, 'armor_class'],
  [/^(?:hit points|hp)\b\s*:?\s*(.*)$/i, 'hit_points'],
  [/^speed\b\s*:?\s*(.*)$/i, 'speed'],
  [/^(?:challenge|cr)\b\s*:?\s*(.*)$/i, 'cr'],
  [/^source\s*[:.]\s*(.*)$/i, 'source'],
];

function parseBlock(kind, lines) {
  const labels = kind === 'spell' ? SPELL_LABELS : kind === 'item' ? ITEM_LABELS : MONSTER_LABELS;
  const e = {};
  const desc = [];
  const stats = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let matched = false;
    for (const [re, field] of labels) {
      const m = re.exec(line);
      if (!m) continue;
      if (e[field]) break; // already have it - keep as description text
      let v = clean(m[1] ?? '');
      if (!v && i + 1 < lines.length && field !== 'higher_levels') v = lines[++i];
      e[field] = v;
      matched = true;
      break;
    }
    if (matched) continue;
    if (kind === 'monster' && stats.length < 6) {
      const scores = [...line.matchAll(/\b(\d{1,2})\s*\(\s*([+\-−–]\s*\d+)\s*\)/g)];
      const v24 = [...line.matchAll(/\b(?:str|dex|con|int|wis|cha)\s+(\d{1,2})\s+([+\-−–]+\s*\d+)/gi)];
      if (v24.length) { stats.push(...v24.map((s) => `${s[1]} (${s[2].replace(/[\s]/g, '').replace(/^[-−–]+/, '-').replace(/^\+[-−–]/, '-')})`)); continue; }
      if (scores.length) { stats.push(...scores.map((s) => `${s[1]} (${s[2].replace(/\s/g, '')})`)); continue; }
      if (/^(str|dex|con|int|wis|cha|mod|save)(\s+(str|dex|con|int|wis|cha|mod|save))*$/i.test(line)) continue;
    }
    desc.push(line);
  }
  if (kind === 'monster') {
    if (stats.length >= 6) {
      e.stats = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'].map((k, i) => `${k} ${stats[i]}`).join(', ');
    }
    if (e.cr) e.cr = e.cr.split(/[\s(]/)[0];
  }
  if (kind === 'spell') {
    if (e.level != null) e.level = parseLevel(e.level);
    if (e.school) e.school = normSchool(e.school);
    if (/concentration/i.test(e.duration || '')) e.concentration = true;
    if (/ritual/i.test(e.casting_time || '')) e.ritual = true;
    // A trailing "Spell Lists. Wizard" style line at the end of the description.
    const hl = desc.findIndex((l) => /^(at higher levels|using a higher-level spell)\b[.:]?/i.test(l));
    if (hl !== -1 && !e.higher_levels) {
      e.higher_levels = desc[hl].replace(/^(at higher levels|using a higher-level spell)\b[.:]?\s*/i, '');
      desc.splice(hl, 1);
    }
  }
  e.description = desc.slice(0, MAX_LINES_PER_ENTRY).join('\n');
  return e;
}

/**
 * Find stat blocks in a list of text lines.
 * @param {string[]} lines
 * @param {{fallbackName?: string}} opts  name to use when the block has no
 *   name line (e.g. wikidot pages where the name is the page title).
 */
export function entriesFromLines(lines, { fallbackName = '' } = {}) {
  const headers = findHeaders(lines);
  const blocks = headers.map((h) => {
    let nameAt = h.labelOnly ? h.nameAt : h.at - 1;
    let source = '';
    // "Source: Player's Handbook" sitting between the name and the type line.
    if (nameAt >= 0 && /^source\s*:/i.test(lines[nameAt])) {
      source = clean(lines[nameAt].replace(/^source\s*:/i, ''));
      nameAt--;
    }
    let name = nameAt >= 0 ? lines[nameAt] : '';
    if (!looksLikeName(name)) { name = ''; nameAt = h.at; }
    return { ...h, nameAt, name, source };
  });
  const out = [];
  blocks.forEach((b, idx) => {
    if (idx > 0 && b.nameAt < blocks[idx - 1].at) return; // overlapping / bogus
    const start = b.labelOnly ? b.at : b.at + 1;
    const end = idx + 1 < blocks.length ? Math.max(start, blocks[idx + 1].nameAt) : lines.length;
    const body = parseBlock(b.kind, lines.slice(start, end));
    const name = b.name || (blocks.length === 1 ? fallbackName : '') || '';
    if (!name) return;
    const e = { kind: b.kind, name, ...b.data, ...body };
    if (b.kind === 'spell' && b.data) {
      e.level = b.data.level;
      e.school = normSchool(b.data.school);
      if (/ritual/i.test(b.data.rest || '')) e.ritual = true;
      const cls = /\(([^)]+)\)/.exec(b.data.rest || '');
      if (cls && !/ritual/i.test(cls[1]) && !e.classes) e.classes = cls[1];
      delete e.rest;
    }
    if (!e.source && b.source) e.source = b.source;
    out.push(e);
  });
  return out;
}

// ------------------------------------------------------------- merging

function mergeInto(target, src) {
  for (const [k, v] of Object.entries(src)) {
    if (v === undefined || v === null || v === '') continue;
    const cur = target[k];
    if (cur === undefined || cur === null || cur === '' || cur === false) target[k] = v;
    else if (k === 'description' && String(v).length > String(cur).length) target[k] = v;
    // "V, S, M" from a list page -> "V, S, M (a pinch of soot)" from the detail page.
    else if (typeof v === 'string' && typeof cur === 'string' && v.length > cur.length
      && v.toLowerCase().startsWith(cur.toLowerCase())) target[k] = v;
  }
  return target;
}

export function dedupe(entries) {
  const map = new Map();
  for (const e of entries) {
    const key = `${e.kind}|${e.name.toLowerCase()}`;
    if (map.has(key)) mergeInto(map.get(key), e);
    else map.set(key, { ...e });
  }
  return [...map.values()];
}

// ---------------------------------------------------------- public API

/** Parse a full HTML document (fetched, pasted from the clipboard, or sent by the bookmarklet). */
export function parseHtml(html, { url = '' } = {}) {
  const doc = parseDoc(html);
  const meta = (sel) => doc.querySelector(sel)?.getAttribute('content') || '';
  const title = cleanPageTitle(text(doc.getElementById('page-title')) || meta('meta[property="og:title"]') || text(doc.querySelector('title')) || text(doc.querySelector('h1')));
  let host = '';
  try { host = url ? new URL(url).hostname.replace(/^www\./, '') : ''; } catch { /* ignore */ }
  const site = meta('meta[property="og:site_name"]') || host;
  const root = ['#page-content', '.brewRenderer', 'main', 'article', '[role=main]', '#content', 'body']
    .map((sel) => doc.querySelector(sel))
    .find(Boolean) || doc.documentElement;

  const fromJson = jsonFromHtml(doc);
  const fromTables = entriesFromTables(doc, url || undefined); // must run before htmlToLines
  const fromText = entriesFromLines(htmlToLines(root), { fallbackName: title });

  return { title, site: clean(site), entries: dedupe([...fromJson, ...fromText, ...fromTables]) };
}

/** Parse pasted text (plain text or Homebrewery/markdown), HTML or JSON. */
export function parseText(input) {
  const t = String(input || '').trim();
  if (/^[[{]/.test(t)) {
    try { return dedupe(entriesFromJson(JSON.parse(t))); } catch { /* fall through */ }
  }
  if (/<\/?(p|div|table|br|h\d)\b/i.test(t)) return parseHtml(t).entries;
  return dedupe(entriesFromLines(textToLines(t)));
}

/** Pull the markdown out of a Homebrewery /source/<id> page. */
export function parseHomebrewerySource(body) {
  const md = /<code[^>]*>/i.test(body) ? text(parseDoc(body).querySelector('code')) : body;
  const title = cleanPageTitle(/^#\s+(.+)$/m.exec(md)?.[1] || '');
  return { title, site: 'The Homebrewery', entries: dedupe(entriesFromLines(textToLines(md))) };
}

// --------------------------------------------------------- fetching
//
// A web page can only read another site if that site allows it (CORS), so
// fetches go direct first and then fall back to public CORS proxies. The
// proxy list is configurable in Settings.

// {url} = the page address URL-encoded, {rawurl} = as-is.
export const DEFAULT_PROXIES = [
  'https://r.jina.ai/{rawurl}',
  'https://api.allorigins.win/raw?url={url}',
  'https://api.codetabs.com/v1/proxy/?quest={url}',
];

// Sites known to refuse every proxy, so we can say so plainly.
const PROXY_BLOCKED = [/(^|\.)wikidot\.com$/i, /(^|\.)dndbeyond\.com$/i];

let preferredRoute = null; // the route that worked last time, tried first

function routeRequest(route, url) {
  if (!route) return { target: url, headers: {} };
  const target = route.replace('{rawurl}', url).replace('{url}', encodeURIComponent(url));
  // Jina Reader returns the rendered page when asked for HTML.
  const headers = /^https:\/\/r\.jina\.ai\//.test(target) ? { 'X-Respond-With': 'html' } : {};
  return { target, headers };
}

/**
 * Build a fetchText(url) function. It tries a direct request first (works when
 * the site allows cross-origin reads), then races all proxies at once and
 * uses whichever answers first with real content.
 */
export function makeFetcher({ proxies = DEFAULT_PROXIES, timeoutMs = 25000, retryDelayMs = 1500, fetchImpl = (...a) => fetch(...a) } = {}) {
  const list = proxies.filter(Boolean);

  const attempt = async (route, url) => {
    const { target, headers } = routeRequest(route, url);
    const label = route ? new URL(target).hostname : 'direct';
    try {
      const res = await fetchImpl(target, { headers, signal: AbortSignal.timeout(route ? timeoutMs : 10000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.text();
      if (!body.trim()) throw new Error('empty response');
      // Some proxies answer 200 with an error document.
      if (/^\s*\{\s*"(data"\s*:\s*null|error|status"\s*:\s*"fail)/.test(body.slice(0, 200))) throw new Error('proxy error');
      return { route, result: { body, type: res.headers.get('content-type') || '', finalUrl: url } };
    } catch (err) {
      const e = new Error(`${label}: ${err.name === 'TimeoutError' ? 'timed out' : err.message}`);
      throw e;
    }
  };

  return async function fetchText(url) {
    const errors = [];
    const tryList = async (routes) => {
      if (!routes.length) return null;
      try {
        return await Promise.any(routes.map((r) => attempt(r, url)));
      } catch (agg) {
        errors.push(...(agg.errors || [agg]).map((e) => e.message));
        return null;
      }
    };
    const first = preferredRoute && list.includes(preferredRoute) ? [preferredRoute] : [];
    let hit = (await tryList([null]))
      || (await tryList(first))
      || (await tryList(list.filter((r) => !first.includes(r))));
    if (!hit && list.length && retryDelayMs >= 0) {
      // Free proxies are flaky; one more round after a short pause often works.
      await new Promise((r) => setTimeout(r, retryDelayMs));
      hit = await tryList(list);
    }
    if (hit) {
      preferredRoute = hit.route;
      return hit.result;
    }
    let host = '';
    try { host = new URL(url).hostname; } catch { /* ignore */ }
    const e = new Error(PROXY_BLOCKED.some((re) => re.test(host))
      ? `${host} usually blocks apps from reading its pages, and this time none of the routes got through.`
      : `Couldn't read ${url} (${errors.join('; ')}).`);
    e.blocked = true;
    e.host = host;
    throw e;
  };
}

/** Rewrite share links to URLs that return the raw content. */
export function resolveSpecialUrl(url) {
  const u = new URL(url);
  // The Homebrewery renders client-side; /source/<id> returns the markdown.
  const hb = /^\/(?:share|edit|print)\/([^/?#]+)/.exec(u.pathname);
  if (/(^|\.)homebrewery\.naturalcrit\.com$/.test(u.hostname) && hb) {
    return { url: `${u.origin}/source/${hb[1]}`, mode: 'homebrewery' };
  }
  return { url, mode: 'html' };
}

async function mapLimit(items, limit, fn) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
    }
  });
  await Promise.all(workers);
}

/**
 * Fetch a URL and extract entries.
 * @param {string} url
 * @param {{followLinks?: boolean, maxLinks?: number, fetchText?: Function, onProgress?: Function}} opts
 *   followLinks visits each entry's own page (same site only) to pull in full descriptions.
 */
export async function importFromUrl(url, { followLinks = false, maxLinks = 500, fetchText = makeFetcher(), onProgress = () => {} } = {}) {
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error('That does not look like a valid URL.'); }
  if (!/^https?:$/.test(parsed.protocol)) throw new Error('Only http:// and https:// URLs can be imported.');

  const special = resolveSpecialUrl(parsed.href);
  const { body, type, finalUrl } = await fetchText(special.url);
  const warnings = [];
  let result;

  if (special.mode === 'homebrewery') {
    result = parseHomebrewerySource(body);
  } else if (/json/.test(type) || /^\s*[[{]/.test(body)) {
    let data = null;
    try { data = JSON.parse(body); } catch { /* not JSON after all */ }
    result = data ? { title: '', site: parsed.hostname, entries: dedupe(entriesFromJson(data)) } : parseHtml(body, { url: finalUrl });
  } else {
    result = parseHtml(body, { url: finalUrl });
  }
  for (const e of result.entries) if (!e.source_url) e.source_url = parsed.href;

  if (followLinks) {
    const host = new URL(finalUrl).hostname;
    const todo = result.entries.filter((e) => e.source_url && e.source_url !== parsed.href && !e.description && new URL(e.source_url).hostname === host);
    if (todo.length > maxLinks) warnings.push(`Only fetched details for the first ${maxLinks} of ${todo.length} linked pages.`);
    const batch = todo.slice(0, maxLinks);
    let failed = 0;
    let done = 0;
    await mapLimit(batch, 4, async (e) => {
      try {
        const page = await fetchText(e.source_url);
        const sub = parseHtml(page.body, { url: page.finalUrl });
        const match = sub.entries.find((x) => x.kind === e.kind && x.name.toLowerCase() === e.name.toLowerCase())
          || sub.entries.find((x) => x.kind === e.kind);
        if (match) {
          const { name, source_url: _u, ...rest } = match;
          mergeInto(e, rest);
        }
      } catch { failed++; }
      onProgress(++done, batch.length);
    });
    if (failed) warnings.push(`${failed} linked page(s) could not be fetched.`);
  }

  if (!result.entries.length) {
    warnings.push('No spells, items or monsters were recognised on that page. If the site builds its content with JavaScript, open it in your browser and use the bookmarklet, or copy the page and use "Paste".');
  }
  return { ...result, url: finalUrl, warnings };
}
