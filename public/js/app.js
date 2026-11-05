// Homebrew Vault front end. Plain JS, no build step, no server: data lives
// in this browser's IndexedDB (see store.js) and imports are parsed locally.
import { openStore, entriesFromBackup } from './store.js';
import { importFromUrl, parseText, parseHtml, makeFetcher, DEFAULT_PROXIES } from './importer.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const SCHOOLS = ['Abjuration', 'Conjuration', 'Divination', 'Enchantment', 'Evocation', 'Illusion', 'Necromancy', 'Transmutation'];
const RARITIES = ['Common', 'Uncommon', 'Rare', 'Very Rare', 'Legendary', 'Artifact', 'Varies'];
const SIZES = ['Tiny', 'Small', 'Medium', 'Large', 'Huge', 'Gargantuan'];
const LEVEL_LABEL = (l) => (l === 0 ? 'Cantrip' : l == null ? '—' : ordinal(l));
const KIND_LABEL = { spell: 'Spell', item: 'Item', monster: 'Monster' };

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
function crValue(cr) {
  if (!cr) return null;
  const t = String(cr).trim();
  if (/^\d+\/\d+$/.test(t)) { const [a, b] = t.split('/').map(Number); return a / b; }
  const n = parseFloat(t);
  return Number.isNaN(n) ? null : n;
}
const rarityClass = (r) => `rarity-${String(r || '').toLowerCase().replace(/\s+/g, '-')}`;
const uniq = (arr) => [...new Set(arr.filter((x) => x !== '' && x != null))].sort((a, b) => String(a).localeCompare(String(b)));
const splitList = (s) => String(s || '').split(/[,;/]/).map((x) => x.trim()).filter(Boolean);
const titleCase = (s) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase());

// ------------------------------------------------------------ state

const state = {
  view: 'spell',
  entries: { spell: [], item: [], monster: [] },
  filters: { spell: {}, item: {}, monster: {} },
  sort: { spell: 'name', item: 'name', monster: 'name' },
  selected: new Set(),
  preview: [],
};
try {
  const saved = JSON.parse(localStorage.getItem('hv-filters') || 'null');
  if (saved) { Object.assign(state.filters, saved.filters); Object.assign(state.sort, saved.sort); }
} catch { /* storage unavailable */ }
function persist() {
  try { localStorage.setItem('hv-filters', JSON.stringify({ filters: state.filters, sort: state.sort })); } catch { /* ignore */ }
}

// ------------------------------------------------------------ storage

let store = null;

async function loadEntries() {
  const all = await store.list();
  state.entries = { spell: [], item: [], monster: [] };
  for (const e of all) state.entries[e.kind]?.push(e);
  for (const k of Object.keys(state.entries)) $(`[data-count="${k}"]`).textContent = state.entries[k].length;
}

const settings = {
  get proxies() {
    try {
      const v = JSON.parse(localStorage.getItem('hv-proxies') || 'null');
      // Lists saved before corsproxy.io started requiring a key are upgraded.
      if (!Array.isArray(v) || v.some((x) => x.includes('corsproxy.io/?url='))) return DEFAULT_PROXIES;
      return v;
    } catch { return DEFAULT_PROXIES; }
  },
  set proxies(v) {
    try { localStorage.setItem('hv-proxies', JSON.stringify(v)); } catch { /* ignore */ }
  },
};

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 3500);
}

// ------------------------------------------------------------ kind configs

const CONFIG = {
  spell: {
    search: (e) => [e.name, e.description, e.source, e.classes, e.school].join(' '),
    columns: [
      { label: 'Name', cls: 'name', html: (e) => esc(e.name) },
      { label: 'Level', html: (e) => esc(LEVEL_LABEL(e.level)) },
      { label: 'School', html: (e) => esc(e.school) },
      { label: 'Casting Time', cls: 'hide-sm', html: (e) => esc(e.casting_time) },
      { label: 'Range', cls: 'hide-sm', html: (e) => esc(e.range) },
      { label: '', html: (e) => (e.concentration ? '<span class="tag" title="Concentration">C</span>' : '') + (e.ritual ? '<span class="tag gold" title="Ritual">R</span>' : '') },
      { label: 'Source', html: (e) => esc(e.source) },
    ],
    sorts: { name: 'Name', level: 'Level', school: 'School', source: 'Source', created_at: 'Newest' },
    filters(list) {
      return [
        { key: 'level', label: 'Level', type: 'chips', options: [...Array(10).keys()].map((l) => [String(l), l === 0 ? 'C' : String(l)]) },
        { key: 'school', label: 'School', type: 'select', options: uniq([...SCHOOLS.filter((s) => list.some((e) => e.school === s)), ...list.map((e) => e.school)]) },
        { key: 'source', label: 'Source', type: 'select', options: uniq(list.map((e) => e.source)) },
        { key: 'class', label: 'Class', type: 'select', options: uniq(list.flatMap((e) => splitList(e.classes).map(titleCase))) },
        { key: 'flags', label: 'Tags', type: 'chips', options: [['concentration', 'Concentration'], ['ritual', 'Ritual']] },
      ];
    },
    match(e, f) {
      if (f.level?.length && !f.level.includes(String(e.level))) return false;
      if (f.school && e.school !== f.school) return false;
      if (f.source && e.source !== f.source) return false;
      if (f.class && !splitList(e.classes).some((c) => c.toLowerCase() === f.class.toLowerCase())) return false;
      if (f.flags?.includes('concentration') && !e.concentration) return false;
      if (f.flags?.includes('ritual') && !e.ritual) return false;
      return true;
    },
  },
  item: {
    search: (e) => [e.name, e.description, e.source, e.item_type, e.rarity].join(' '),
    columns: [
      { label: 'Name', cls: 'name', html: (e) => esc(e.name) },
      { label: 'Type', html: (e) => esc(e.item_type) },
      { label: 'Rarity', html: (e) => `<span class="${rarityClass(e.rarity)}">${esc(e.rarity)}</span>` },
      { label: 'Attunement', cls: 'hide-sm', html: (e) => (e.attunement ? '<span class="tag gold">Attunement</span>' : '') },
      { label: 'Source', html: (e) => esc(e.source) },
    ],
    sorts: { name: 'Name', rarity: 'Rarity', item_type: 'Type', source: 'Source', created_at: 'Newest' },
    filters(list) {
      const present = uniq(list.map((e) => e.rarity));
      return [
        { key: 'rarity', label: 'Rarity', type: 'chips', options: uniq([...RARITIES.filter((r) => present.includes(r)), ...present]).sort((a, b) => rarityRank(a) - rarityRank(b)).map((r) => [r, r]) },
        { key: 'item_type', label: 'Type', type: 'select', options: uniq(list.map((e) => e.item_type)) },
        { key: 'source', label: 'Source', type: 'select', options: uniq(list.map((e) => e.source)) },
        { key: 'attune', label: 'Attunement', type: 'select', options: [['yes', 'Requires attunement'], ['no', 'No attunement']] },
      ];
    },
    match(e, f) {
      if (f.rarity?.length && !f.rarity.includes(e.rarity)) return false;
      if (f.item_type && e.item_type !== f.item_type) return false;
      if (f.source && e.source !== f.source) return false;
      if (f.attune === 'yes' && !e.attunement) return false;
      if (f.attune === 'no' && e.attunement) return false;
      return true;
    },
  },
  monster: {
    search: (e) => [e.name, e.description, e.source, e.creature_type, e.alignment].join(' '),
    columns: [
      { label: 'Name', cls: 'name', html: (e) => esc(e.name) },
      { label: 'CR', html: (e) => esc(e.cr) },
      { label: 'Size', cls: 'hide-sm', html: (e) => esc(e.size) },
      { label: 'Type', html: (e) => esc(e.creature_type) },
      { label: 'AC', cls: 'hide-sm', html: (e) => esc(String(e.armor_class).split(' ')[0]) },
      { label: 'HP', cls: 'hide-sm', html: (e) => esc(String(e.hit_points).split(' ')[0]) },
      { label: 'Source', html: (e) => esc(e.source) },
    ],
    sorts: { name: 'Name', cr: 'Challenge', creature_type: 'Type', source: 'Source', created_at: 'Newest' },
    filters(list) {
      return [
        { key: 'cr_min', label: 'CR from', type: 'number' },
        { key: 'cr_max', label: 'CR to', type: 'number' },
        { key: 'creature_type', label: 'Type', type: 'select', options: uniq(list.map((e) => baseType(e.creature_type))) },
        { key: 'size', label: 'Size', type: 'select', options: SIZES.filter((s) => list.some((e) => e.size.includes(s))) },
        { key: 'source', label: 'Source', type: 'select', options: uniq(list.map((e) => e.source)) },
      ];
    },
    match(e, f) {
      const cr = crValue(e.cr);
      if (f.cr_min !== undefined && f.cr_min !== '' && (cr == null || cr < Number(f.cr_min))) return false;
      if (f.cr_max !== undefined && f.cr_max !== '' && (cr == null || cr > Number(f.cr_max))) return false;
      if (f.creature_type && baseType(e.creature_type) !== f.creature_type) return false;
      if (f.size && !e.size.includes(f.size)) return false;
      if (f.source && e.source !== f.source) return false;
      return true;
    },
  },
};
const baseType = (t) => String(t || '').replace(/\s*\(.*\)$/, '').trim();
const rarityRank = (r) => { const i = RARITIES.indexOf(r); return i === -1 ? 99 : i; };

function sorter(kind) {
  const key = state.sort[kind];
  const val = {
    level: (e) => e.level ?? 99,
    rarity: (e) => rarityRank(e.rarity),
    cr: (e) => crValue(e.cr) ?? 999,
    created_at: (e) => -new Date(e.created_at + 'Z').getTime(),
  }[key] || ((e) => String(e[key] || '').toLowerCase());
  return (a, b) => {
    const x = val(a); const y = val(b);
    if (x < y) return -1;
    if (x > y) return 1;
    return a.name.localeCompare(b.name);
  };
}

// ------------------------------------------------------------ library view

function visibleEntries(kind) {
  const f = state.filters[kind];
  const cfg = CONFIG[kind];
  const q = (f.q || '').toLowerCase().trim();
  return state.entries[kind]
    .filter((e) => (!q || cfg.search(e).toLowerCase().includes(q)) && cfg.match(e, f))
    .sort(sorter(kind));
}

function renderFilters(kind) {
  const cfg = CONFIG[kind];
  const f = state.filters[kind];
  const groups = cfg.filters(state.entries[kind]);
  const parts = [`<label class="fgroup search"><span>Search</span><input type="search" data-f="q" value="${esc(f.q || '')}" placeholder="Name, text, class…"></label>`];
  for (const g of groups) {
    if (g.type === 'chips') {
      const on = f[g.key] || [];
      parts.push(`<div class="fgroup"><span>${esc(g.label)}</span><div class="chips">${g.options.map(([v, l]) => `<button class="chip ${on.includes(v) ? 'on' : ''}" data-chip="${esc(g.key)}" data-v="${esc(v)}">${esc(l)}</button>`).join('')}</div></div>`);
    } else if (g.type === 'select') {
      const opts = g.options.map((o) => (Array.isArray(o) ? o : [o, o]));
      parts.push(`<label class="fgroup"><span>${esc(g.label)}</span><select data-f="${esc(g.key)}"><option value="">All</option>${opts.map(([v, l]) => `<option value="${esc(v)}" ${f[g.key] === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`);
    } else if (g.type === 'number') {
      parts.push(`<label class="fgroup"><span>${esc(g.label)}</span><input type="number" min="0" max="30" step="0.125" style="width:80px" data-f="${esc(g.key)}" value="${esc(f[g.key] ?? '')}"></label>`);
    }
  }
  parts.push('<button class="btn clear-filters" id="clear-filters">Clear filters</button>');
  $('#filters').innerHTML = parts.join('');

  $('#sort').innerHTML = Object.entries(cfg.sorts).map(([v, l]) => `<option value="${v}" ${state.sort[kind] === v ? 'selected' : ''}>Sort: ${l}</option>`).join('');
}

function renderTable(kind) {
  const cfg = CONFIG[kind];
  const list = visibleEntries(kind);
  $('#entries-head').innerHTML = `<tr><th class="cb"></th>${cfg.columns.map((c) => `<th class="${c.cls || ''}">${esc(c.label)}</th>`).join('')}<th></th></tr>`;
  $('#entries-body').innerHTML = list.map((e) => `
    <tr class="clickable" data-id="${e.id}">
      <td class="cb"><input type="checkbox" data-select="${e.id}" ${state.selected.has(e.id) ? 'checked' : ''} aria-label="Select ${esc(e.name)}"></td>
      ${cfg.columns.map((c) => `<td class="${c.cls || ''}">${c.html(e)}</td>`).join('')}
      <td class="actions"><button class="icon-btn" data-delete="${e.id}" title="Delete ${esc(e.name)}" aria-label="Delete">🗑</button></td>
    </tr>`).join('');
  const total = state.entries[kind].length;
  $('#result-count').textContent = list.length === total ? `${total} ${total === 1 ? 'entry' : 'entries'}` : `${list.length} of ${total} shown`;
  $('#empty').hidden = total > 0;
  $('.table-wrap', $('#library')).hidden = total === 0;
  const shownSelected = list.filter((e) => state.selected.has(e.id)).length;
  $('#select-all').checked = list.length > 0 && shownSelected === list.length;
  $('#select-all').indeterminate = shownSelected > 0 && shownSelected < list.length;
  $('#delete-selected').disabled = state.selected.size === 0;
  $('#delete-selected').textContent = state.selected.size ? `Delete selected (${state.selected.size})` : 'Delete selected';
}

function renderLibrary() {
  renderFilters(state.view);
  renderTable(state.view);
}

$('#filters').addEventListener('input', (ev) => {
  const key = ev.target.dataset.f;
  if (!key) return;
  state.filters[state.view][key] = ev.target.value;
  persist();
  renderTable(state.view);
});
$('#filters').addEventListener('click', (ev) => {
  const chip = ev.target.closest('[data-chip]');
  if (chip) {
    const f = state.filters[state.view];
    const key = chip.dataset.chip;
    const v = chip.dataset.v;
    f[key] = f[key] || [];
    f[key] = f[key].includes(v) ? f[key].filter((x) => x !== v) : [...f[key], v];
    chip.classList.toggle('on');
    persist();
    renderTable(state.view);
  }
  if (ev.target.id === 'clear-filters') {
    state.filters[state.view] = {};
    persist();
    renderLibrary();
  }
});
$('#sort').addEventListener('change', (ev) => {
  state.sort[state.view] = ev.target.value;
  persist();
  renderTable(state.view);
});

$('#entries-body').addEventListener('click', async (ev) => {
  const del = ev.target.closest('[data-delete]');
  if (del) {
    ev.stopPropagation();
    const e = findEntry(Number(del.dataset.delete));
    if (e && confirm(`Delete "${e.name}" from your vault?`)) await removeEntries([e.id]);
    return;
  }
  const sel = ev.target.closest('[data-select]');
  if (sel) {
    const id = Number(sel.dataset.select);
    if (sel.checked) state.selected.add(id); else state.selected.delete(id);
    renderTable(state.view);
    return;
  }
  const row = ev.target.closest('tr[data-id]');
  if (row) showEntry(findEntry(Number(row.dataset.id)));
});
$('#select-all').addEventListener('change', (ev) => {
  for (const e of visibleEntries(state.view)) {
    if (ev.target.checked) state.selected.add(e.id); else state.selected.delete(e.id);
  }
  renderTable(state.view);
});
$('#delete-selected').addEventListener('click', async () => {
  const ids = [...state.selected];
  if (!ids.length) return;
  if (!confirm(`Delete ${ids.length} selected ${ids.length === 1 ? 'entry' : 'entries'}? This can't be undone.`)) return;
  await removeEntries(ids);
});
$('#add-new').addEventListener('click', () => editEntry({ kind: state.view }));

function findEntry(id) {
  for (const list of Object.values(state.entries)) {
    const e = list.find((x) => x.id === id);
    if (e) return e;
  }
  return null;
}

async function removeEntries(ids) {
  try {
    const deleted = await store.remove(ids);
    ids.forEach((id) => state.selected.delete(id));
    await loadEntries();
    renderLibrary();
    toast(`Deleted ${deleted} ${deleted === 1 ? 'entry' : 'entries'}`);
  } catch (err) { toast(err.message); }
}

// ------------------------------------------------------------ detail + edit dialog

const dialog = $('#dialog');
dialog.addEventListener('click', (ev) => { if (ev.target === dialog) dialog.close(); });

function subtitle(e) {
  if (e.kind === 'spell') {
    const base = e.level === 0 ? `${e.school || 'Unknown'} cantrip` : `${LEVEL_LABEL(e.level)}-level ${(e.school || 'spell').toLowerCase()}`;
    return base + (e.ritual ? ' (ritual)' : '');
  }
  if (e.kind === 'item') return [e.item_type || 'Item', e.rarity && e.rarity.toLowerCase()].filter(Boolean).join(', ') + (e.attunement ? ` (${e.attunement.toLowerCase()})` : '');
  return [[e.size, e.creature_type].filter(Boolean).join(' '), e.alignment].filter(Boolean).join(', ');
}

function dl(pairs) {
  const rows = pairs.filter(([, v]) => v);
  return rows.length ? `<dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : '';
}

function showEntry(e) {
  if (!e) return;
  let body = '';
  if (e.kind === 'spell') {
    body = dl([['Casting Time', e.casting_time], ['Range', e.range], ['Components', e.components], ['Duration', e.duration], ['Classes', e.classes]]);
  } else if (e.kind === 'monster') {
    body = dl([['Armor Class', e.armor_class], ['Hit Points', e.hit_points], ['Speed', e.speed]]);
    if (e.stats) {
      const scores = e.stats.split(/,\s*/).map((s) => s.split(' '));
      body += `<hr><div class="scores">${scores.map(([k, ...v]) => `<div><b>${esc(k)}</b>${esc(v.join(' '))}</div>`).join('')}</div>`;
    }
    body += dl([['Challenge', e.cr]]);
  }
  const higher = e.higher_levels ? `<p><b><i>At Higher Levels.</i></b> ${esc(e.higher_levels)}</p>` : '';
  $('#dialog-content').innerHTML = `
    <article class="statblock">
      <h2>${esc(e.name)}</h2>
      <p class="subtitle">${esc(subtitle(e))}</p>
      <hr>
      ${body}
      ${body ? '<hr>' : ''}
      <div class="desc">${esc(e.description) || '<span class="muted">No description.</span>'}</div>
      ${higher}
      <p class="muted" style="margin-top:14px">Source: ${esc(e.source || 'Unknown')}${e.source_url ? ` · <a href="${esc(e.source_url)}" target="_blank" rel="noopener">original page</a>` : ''}</p>
    </article>
    <div class="dialog-actions">
      <button class="btn danger" data-act="delete">🗑 Delete</button>
      <div class="toolbar-right">
        <button class="btn" data-act="edit">Edit</button>
        <button class="btn primary" data-act="close">Close</button>
      </div>
    </div>`;
  $('#dialog-content').onclick = async (ev) => {
    const act = ev.target.closest('[data-act]')?.dataset.act;
    if (act === 'close') dialog.close();
    if (act === 'edit') editEntry(e);
    if (act === 'delete' && confirm(`Delete "${e.name}" from your vault?`)) {
      dialog.close();
      await removeEntries([e.id]);
    }
  };
  if (!dialog.open) dialog.showModal();
}

const EDIT_FIELDS = {
  common: [['name', 'Name'], ['source', 'Source']],
  spell: [['level', 'Level (0 = cantrip)', 'number'], ['school', 'School', 'list:schools'], ['casting_time', 'Casting Time'], ['range', 'Range'], ['components', 'Components'], ['duration', 'Duration'], ['classes', 'Classes'], ['concentration', 'Concentration', 'checkbox'], ['ritual', 'Ritual', 'checkbox'], ['higher_levels', 'At Higher Levels', 'textarea']],
  item: [['item_type', 'Type'], ['rarity', 'Rarity', 'list:rarities'], ['attunement', 'Attunement (blank if none)']],
  monster: [['size', 'Size'], ['creature_type', 'Type'], ['alignment', 'Alignment'], ['cr', 'Challenge Rating'], ['armor_class', 'Armor Class'], ['hit_points', 'Hit Points'], ['speed', 'Speed'], ['stats', 'Ability Scores (STR 10 (+0), DEX …)']],
};

function editEntry(e) {
  const isNew = !e.id;
  const kindSel = isNew
    ? `<label class="field"><span>Kind</span><select name="kind">${Object.entries(KIND_LABEL).map(([k, l]) => `<option value="${k}" ${e.kind === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`
    : `<input type="hidden" name="kind" value="${esc(e.kind)}">`;
  const fieldHtml = ([key, label, type]) => {
    const v = e[key] ?? '';
    if (type === 'checkbox') return `<label class="check field"><input type="checkbox" name="${key}" ${v ? 'checked' : ''}> ${esc(label)}</label>`;
    if (type === 'textarea') return `<label class="field wide"><span>${esc(label)}</span><textarea name="${key}" rows="3">${esc(v)}</textarea></label>`;
    const list = type?.startsWith('list:') ? ` list="${type.slice(5)}"` : '';
    const t = type === 'number' ? 'number" min="0" max="9' : 'text';
    return `<label class="field"><span>${esc(label)}</span><input type="${t}" name="${key}" value="${esc(v)}"${list}></label>`;
  };
  const render = (kind) => [...EDIT_FIELDS.common, ...EDIT_FIELDS[kind]].map(fieldHtml).join('');
  $('#dialog-content').innerHTML = `
    <form id="edit-form">
      <h2 class="serif" style="margin-top:0">${isNew ? 'New entry' : `Edit ${esc(e.name)}`}</h2>
      ${kindSel}
      <div class="edit-grid" id="edit-fields">${render(e.kind)}</div>
      <label class="field"><span>Description</span><textarea name="description" rows="8">${esc(e.description || '')}</textarea></label>
      <datalist id="schools">${SCHOOLS.map((s) => `<option value="${s}">`).join('')}</datalist>
      <datalist id="rarities">${RARITIES.map((s) => `<option value="${s}">`).join('')}</datalist>
      <div class="dialog-actions">
        <button class="btn" type="button" data-act="cancel">Cancel</button>
        <button class="btn primary" type="submit">Save</button>
      </div>
    </form>`;
  const form = $('#edit-form');
  form.kind.addEventListener?.('change', () => { $('#edit-fields').innerHTML = render(form.kind.value); });
  $('#dialog-content').onclick = (ev) => {
    if (ev.target.closest('[data-act="cancel"]')) { if (isNew) dialog.close(); else showEntry(e); }
  };
  form.onsubmit = async (ev) => {
    ev.preventDefault();
    const data = { ...e, kind: form.kind.value };
    for (const el of form.elements) {
      if (!el.name || el.name === 'kind') continue;
      data[el.name] = el.type === 'checkbox' ? el.checked : el.value;
    }
    data.source_url = e.source_url || '';
    try {
      if (isNew) {
        const r = await store.save([data]);
        if (r.errors?.length) throw new Error(r.errors[0]);
        if (!r.saved) throw new Error('An entry with that name and source already exists.');
      } else {
        await store.update(e.id, data);
      }
      await loadEntries();
      dialog.close();
      if (state.view !== data.kind) location.hash = data.kind; else renderLibrary();
      toast(isNew ? `Added ${data.name}` : `Saved ${data.name}`);
    } catch (err) { toast(err.message); }
  };
  if (!dialog.open) dialog.showModal();
}

// ------------------------------------------------------------ import view

let importMode = 'url';
function setImportMode(mode) {
  importMode = mode;
  $$('.seg-btn').forEach((x) => x.classList.toggle('active', x.dataset.mode === mode));
  $$('[data-mode-panel]').forEach((p) => { p.hidden = p.dataset.modePanel !== mode; });
}
$$('.seg-btn').forEach((b) => b.addEventListener('click', () => setImportMode(b.dataset.mode)));

const isTouch = matchMedia('(pointer: coarse)').matches;

function blockedHelp(url) {
  const steps = isTouch
    ? `<ol>
        <li><a href="${esc(url)}" target="_blank" rel="noopener">Open the page</a> in your browser.</li>
        <li>Long-press any text → <b>Select all</b> → <b>Copy</b>.</li>
        <li>Come back here and tap <b>📋 Paste from clipboard</b>.</li>
      </ol>
      <p class="hint">Copying only grabs what's visible. On pages with tabs (like wikidot class spell lists), it copies just the open tab.
        To grab every tab at once, use the bookmarklet from <a href="#more">⚙ More</a>.</p>`
    : `<ol>
        <li><a href="${esc(url)}" target="_blank" rel="noopener">Open the page</a> and click your <b>Send to Homebrew Vault</b> bookmark (set it up under <a href="#more">⚙ More</a>), <i>or</i></li>
        <li>press <b>Ctrl+A</b>, <b>Ctrl+C</b> on the page, come back here and click <b>📋 Paste from clipboard</b>.
          Copying only grabs what's visible, so on pages with tabs use the bookmarklet.</li>
      </ol>`;
  return `<div class="help-card"><b>Import it by copying the page instead</b>${steps}
    <button class="btn primary" type="button" id="go-paste">📋 Paste from clipboard</button></div>`;
}
$('#warnings').addEventListener('click', (ev) => {
  if (ev.target.id === 'go-paste') pasteFromClipboard();
});

async function pasteFromClipboard() {
  setImportMode('text');
  try {
    let html = '';
    let plain = '';
    if (navigator.clipboard?.read) {
      for (const item of await navigator.clipboard.read()) {
        if (!html && item.types.includes('text/html')) html = await (await item.getType('text/html')).text();
        if (!plain && item.types.includes('text/plain')) plain = await (await item.getType('text/plain')).text();
      }
    } else if (navigator.clipboard?.readText) {
      plain = await navigator.clipboard.readText();
    } else {
      throw new Error('no clipboard access');
    }
    if (!html && !plain) { toast('Your clipboard is empty. Copy the page first.'); return; }
    pastedHtml = html && /<(table|p|div|li|h\d)\b/i.test(html) ? html : null;
    $('#import-text').value = plain || html.replace(/<[^>]+>/g, ' ');
    $('#paste-note').hidden = !pastedHtml;
    $('#import-go').click();
  } catch {
    $('#import-text').focus();
    toast('Long-press the box below and choose Paste');
  }
}
$('#paste-clipboard').addEventListener('click', pasteFromClipboard);
$$('.example').forEach((a) => a.addEventListener('click', (ev) => {
  ev.preventDefault();
  $('#import-url').value = a.textContent;
}));

// Pasting from a webpage keeps its HTML, so tables survive the trip.
let pastedHtml = null;
$('#import-text').addEventListener('paste', (ev) => {
  const html = ev.clipboardData?.getData('text/html');
  pastedHtml = html && /<(table|p|div|li|h\d)\b/i.test(html) ? html : null;
  $('#paste-note').hidden = !pastedHtml;
});
$('#import-text').addEventListener('input', (ev) => {
  if (ev.inputType !== 'insertFromPaste') { pastedHtml = null; $('#paste-note').hidden = true; }
});

function showPreview(res) {
  const override = $('#import-source').value.trim();
  const kind = $('#import-kind').value;
  const fallbackSource = res.site || res.title || '';
  state.preview = res.entries
    .filter((e) => !kind || e.kind === kind)
    .map((e) => ({
      ...e,
      source: override || e.source || fallbackSource,
      source_url: e.source_url || res.url || '',
      _include: true,
    }));
  renderPreview(res);
}

$('#import-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const btn = $('#import-go');
  const url = $('#import-url').value.trim();
  const textIn = $('#import-text').value;
  const followLinks = $('#follow-links').checked;
  if (importMode === 'url' && !url) return toast('Enter a URL first');
  if (importMode === 'text' && !textIn.trim()) return toast('Paste something first');
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span> ${followLinks && importMode === 'url' ? 'Reading page…' : 'Reading…'}`;
  try {
    let res;
    if (importMode === 'url') {
      res = await importFromUrl(url, {
        followLinks,
        fetchText: makeFetcher({ proxies: settings.proxies }),
        onProgress: (n, total) => { btn.innerHTML = `<span class="spinner"></span> Reading linked pages ${n}/${total}…`; },
      });
      if (!res.entries.length) {
        // Usually a bot check or a page built by JavaScript: offer the copy route.
        res.warnings = ['Nothing was recognised on that page. The site may build its content with JavaScript, or show apps a bot check instead of the real page.'];
        res.blocked = true;
      }
    } else if (pastedHtml) {
      res = { ...parseHtml(pastedHtml), url: '', warnings: [] };
      if (!res.entries.length) res = { title: '', site: '', url: '', entries: parseText(textIn), warnings: [] };
    } else {
      res = { title: '', site: '', url: '', entries: parseText(textIn), warnings: [] };
    }
    if (!res.entries.length && importMode === 'text') {
      res.warnings.push('Nothing recognised. Make sure each entry includes its type line, e.g. "3rd-level evocation", "Wondrous item, rare" or "Medium humanoid, any alignment".');
    }
    showPreview(res);
  } catch (err) {
    if (err.blocked) {
      showPreview({ title: '', site: '', url, entries: [], blocked: true, warnings: [err.message] });
    } else {
      toast(err.message);
    }
  } finally {
    btn.disabled = false;
    btn.textContent = 'Find content';
  }
});

// The bookmarklet opens this app and posts the page it was clicked on.
window.addEventListener('message', (ev) => {
  const d = ev.data;
  if (!d || d.type !== 'hv-import' || typeof d.html !== 'string') return;
  try { ev.source?.postMessage('hv-ok', '*'); } catch { /* ignore */ }
  if (d.nonce) {
    if (handledMessages.has(d.nonce)) return;
    handledMessages.add(d.nonce);
  }
  location.hash = 'import';
  const res = parseHtml(d.html, { url: d.url || '' });
  showPreview({ ...res, url: d.url || '', warnings: res.entries.length ? [] : ['No spells, items or monsters were recognised on that page.'] });
  toast(`Received ${res.title || 'page'} from the bookmarklet`);
});
const handledMessages = new Set();

function renderPreview(res) {
  $('#preview').hidden = false;
  const counts = ['spell', 'item', 'monster'].map((k) => [k, state.preview.filter((e) => e.kind === k).length]).filter(([, n]) => n);
  $('#preview-title').textContent = state.preview.length ? `Found ${state.preview.length} ${state.preview.length === 1 ? 'entry' : 'entries'}` : 'Nothing found';
  $('#preview-sub').textContent = state.preview.length === 0 ? '' : [res.title, counts.map(([k, n]) => `${n} ${KIND_LABEL[k].toLowerCase()}${n === 1 ? '' : 's'}`).join(', ')].filter(Boolean).join(' · ');
  $('#warnings').innerHTML = (res.warnings || []).map((w) => `<div class="warning">${esc(w)}</div>`).join('')
    + (res.blocked ? blockedHelp(res.url) : '');
  const none = state.preview.length === 0;
  $('#preview-table-wrap').hidden = none;
  $('#preview-actions').hidden = none;
  $('#preview-all').checked = true;
  $('#preview-body').innerHTML = state.preview.map((e, i) => {
    let a = '';
    let b = '';
    if (e.kind === 'spell') {
      a = `<select data-i="${i}" data-k="level"><option value="">?</option>${[...Array(10).keys()].map((l) => `<option value="${l}" ${e.level === l ? 'selected' : ''}>${LEVEL_LABEL(l)}</option>`).join('')}</select>`;
      b = `<input data-i="${i}" data-k="school" value="${esc(e.school)}" list="pv-schools">`;
    } else if (e.kind === 'item') {
      a = `<input data-i="${i}" data-k="item_type" value="${esc(e.item_type)}">`;
      b = `<input data-i="${i}" data-k="rarity" value="${esc(e.rarity)}" list="pv-rarities">`;
    } else {
      a = `<input data-i="${i}" data-k="creature_type" value="${esc(e.creature_type)}">`;
      b = `<input data-i="${i}" data-k="cr" value="${esc(e.cr)}" placeholder="CR">`;
    }
    return `<tr>
      <td class="cb"><input type="checkbox" data-include="${i}" ${e._include ? 'checked' : ''}></td>
      <td><input data-i="${i}" data-k="name" value="${esc(e.name)}"></td>
      <td><span class="tag">${KIND_LABEL[e.kind]}</span></td>
      <td>${a}</td><td>${b}</td>
      <td><input data-i="${i}" data-k="source" value="${esc(e.source)}"></td>
      <td><button class="icon-btn" type="button" data-peek="${i}" title="Preview">👁</button></td>
    </tr>`;
  }).join('') + `<datalist id="pv-schools">${SCHOOLS.map((s) => `<option value="${s}">`).join('')}</datalist><datalist id="pv-rarities">${RARITIES.map((s) => `<option value="${s}">`).join('')}</datalist>`;
  updateSaveBtn();
  $('#preview').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function updateSaveBtn() {
  const n = state.preview.filter((e) => e._include).length;
  $('#save-selected').textContent = `Save ${n} to vault`;
  $('#save-selected').disabled = n === 0;
}

$('#preview-body').addEventListener('input', (ev) => {
  const i = ev.target.dataset.i;
  if (i !== undefined) {
    const k = ev.target.dataset.k;
    state.preview[i][k] = k === 'level' ? (ev.target.value === '' ? null : Number(ev.target.value)) : ev.target.value;
  }
});
$('#preview-body').addEventListener('change', (ev) => {
  const inc = ev.target.dataset.include;
  if (inc !== undefined) { state.preview[inc]._include = ev.target.checked; updateSaveBtn(); }
});
$('#preview-body').addEventListener('click', (ev) => {
  const peek = ev.target.closest('[data-peek]');
  if (peek) showPreviewEntry(state.preview[peek.dataset.peek]);
});
$('#preview-all').addEventListener('change', (ev) => {
  state.preview.forEach((e) => { e._include = ev.target.checked; });
  $$('[data-include]').forEach((c) => { c.checked = ev.target.checked; });
  updateSaveBtn();
});

function showPreviewEntry(e) {
  showEntry({ ...e, id: null });
  // Preview-only: hide edit/delete actions.
  $$('[data-act="delete"], [data-act="edit"]', $('#dialog-content')).forEach((b) => b.remove());
}

$('#save-selected').addEventListener('click', async () => {
  const entries = state.preview.filter((e) => e._include).map(({ _include, ...e }) => e);
  if (!entries.length) return;
  try {
    const r = await store.save(entries, { replace: $('#overwrite').checked });
    await loadEntries();
    const msg = [`Saved ${r.saved}`];
    if (r.skipped) msg.push(`${r.skipped} already in your vault (skipped)`);
    if (r.errors?.length) msg.push(`${r.errors.length} invalid`);
    toast(msg.join(' · '));
    state.preview = [];
    $('#preview').hidden = true;
    const kinds = uniq(entries.map((e) => e.kind));
    if (kinds.length === 1) location.hash = kinds[0];
  } catch (err) { toast(err.message); }
});

// ------------------------------------------------------------ DM screen

(function dmScreen() {
  const wrap = $('#screen-wrap');
  const img = $('#screen-img');
  $$('[data-zoom]').forEach((b) => b.addEventListener('click', () => {
    img.style.width = `${Number(b.dataset.zoom) * 100}%`;
  }));
  let drag = null;
  wrap.addEventListener('pointerdown', (ev) => {
    drag = { x: ev.clientX, y: ev.clientY, sl: wrap.scrollLeft, st: wrap.scrollTop };
    wrap.classList.add('dragging');
    wrap.setPointerCapture(ev.pointerId);
  });
  wrap.addEventListener('pointermove', (ev) => {
    if (!drag) return;
    wrap.scrollLeft = drag.sl - (ev.clientX - drag.x);
    wrap.scrollTop = drag.st - (ev.clientY - drag.y);
  });
  const end = () => { drag = null; wrap.classList.remove('dragging'); };
  wrap.addEventListener('pointerup', end);
  wrap.addEventListener('pointercancel', end);
}());

// ------------------------------------------------------------ routing

function route() {
  const view = (location.hash || '#spell').slice(1);
  state.view = ['spell', 'item', 'monster', 'import', 'screen', 'more'].includes(view) ? view : 'spell';
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === state.view));
  const isLib = ['spell', 'item', 'monster'].includes(state.view);
  $('#library').hidden = !isLib;
  $('#import').hidden = state.view !== 'import';
  $('#screen').hidden = state.view !== 'screen';
  $('#more').hidden = state.view !== 'more';
  if (state.view === 'more') renderMore();
  if (isLib) {
    state.selected.clear();
    renderLibrary();
  }
}
$$('.tab').forEach((t) => t.addEventListener('click', () => { location.hash = t.dataset.view; }));
window.addEventListener('hashchange', route);

// ------------------------------------------------------------ "More": backup, install, bookmarklet, proxies

function appUrl() {
  return location.href.replace(/[?#].*$/, '');
}

function bookmarkletCode() {
  const app = appUrl();
  const origin = new URL(app).origin;
  return `javascript:(()=>{const A=${JSON.stringify(app)};const w=window.open(A+'#import','homebrew-vault');`
    + `if(!w){alert('Allow pop-ups to send this page to Homebrew Vault');return}`
    + `const d={type:'hv-import',nonce:Math.random().toString(36).slice(2),html:document.documentElement.outerHTML,url:location.href};`
    + `let n=0;const t=setInterval(()=>{if(++n>60)return clearInterval(t);try{w.postMessage(d,${JSON.stringify(origin)})}catch(e){}},500);`
    + `addEventListener('message',e=>{if(e.data==='hv-ok')clearInterval(t)})})();`;
}

function renderMore() {
  $('#bookmarklet').href = bookmarkletCode();
  $('#bookmarklet-code').value = bookmarkletCode();
  $('#proxies').value = settings.proxies.join('\n');
  const total = Object.values(state.entries).reduce((n, l) => n + l.length, 0);
  $('#vault-size').textContent = `${total} ${total === 1 ? 'entry' : 'entries'} stored in this browser.`;
}

$('#bookmarklet').addEventListener('click', (ev) => {
  ev.preventDefault();
  toast('Drag this button to your bookmarks bar (or copy the code below)');
});
$('#copy-bookmarklet').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(bookmarkletCode()); toast('Bookmarklet copied'); } catch { $('#bookmarklet-code').select(); }
});
$('#save-proxies').addEventListener('click', () => {
  settings.proxies = $('#proxies').value.split('\n').map((l) => l.trim()).filter(Boolean);
  toast('Proxy list saved');
});
$('#reset-proxies').addEventListener('click', () => {
  settings.proxies = DEFAULT_PROXIES;
  renderMore();
  toast('Proxy list reset');
});

$('#export').addEventListener('click', async () => {
  const data = await store.exportAll();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `homebrew-vault-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
$('#import-backup').addEventListener('change', async (ev) => {
  const file = ev.target.files[0];
  ev.target.value = '';
  if (!file) return;
  try {
    const entries = entriesFromBackup(JSON.parse(await file.text()));
    const r = await store.save(entries, { replace: $('#backup-replace').checked });
    await loadEntries();
    renderMore();
    toast(`Restored ${r.saved}${r.skipped ? ` · ${r.skipped} duplicates skipped` : ''}`);
  } catch (err) { toast(err.message); }
});
$('#wipe').addEventListener('click', async () => {
  if (!confirm('Delete EVERYTHING in your vault on this device? Export a backup first if you might want it back.')) return;
  await store.clear();
  await loadEntries();
  renderMore();
  toast('Vault emptied');
});

// Install as an app (Windows / Android / ChromeOS / macOS via Chrome or Edge).
let installPrompt = null;
window.addEventListener('beforeinstallprompt', (ev) => {
  ev.preventDefault();
  installPrompt = ev;
  $('#install').hidden = false;
});
$('#install').addEventListener('click', async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  $('#install').hidden = true;
});
window.addEventListener('appinstalled', () => toast('Homebrew Vault installed'));

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => { /* offline support is optional */ });
}

// Android "Share → Homebrew Vault" lands here as ?url=…&text=…
function handleShareTarget() {
  const params = new URLSearchParams(location.search);
  const text = (params.get('text') || '').trim();
  const link = params.get('url') || text.match(/https?:\/\/\S+/)?.[0];
  if (!text && !link) return false;
  history.replaceState(null, '', appUrl() + '#import');
  // Sharing selected text (not just a link) imports that text directly.
  if (text && text.replace(link || '', '').trim().length > 40) {
    setImportMode('text');
    $('#import-text').value = text;
  } else {
    setImportMode('url');
    $('#import-url').value = link;
  }
  setTimeout(() => $('#import-go').click(), 0);
  return true;
}

(async () => {
  try {
    store = await openStore();
    await loadEntries();
  } catch (err) {
    toast(`Could not open your vault: ${err.message}`);
  }
  handleShareTarget();
  route();
})();
