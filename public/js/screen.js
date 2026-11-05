// DM Screen tab: the built-in Fitz screen plus any images/PDFs the user adds.
// Uploaded pages live in IndexedDB (store.addImages); PDFs are turned into
// one image per page in the browser with pdf.js, loaded only when needed.

const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs';
const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';

const BUILT_IN = Array.from({ length: 6 }, (_, i) => ({
  key: `fitz-${i + 1}`,
  name: `Fitz ${i + 1}`,
  src: `img/screens/fitz-${i + 1}.webp`,
  thumb: `img/screens/fitz-${i + 1}-thumb.webp`,
  builtIn: true,
}));
const BUILT_IN_ALT = [
  'Character advancement, ability scores, skills, passive perception, actions in combat, conditions',
  'Armor, weapons, donning and doffing, container capacity, lifestyle expenses, food, drink and lodging, services',
  'Light sources, vision, jumping, suffocation, size categories, concentration, damage types, challenge rating and XP',
  'Speed factor initiative, exhaustion, cover, DCs, object AC and HP, area of effect targets, mob attacks, travel pace, tracking, weather, improvised damage, lingering injuries',
  'Chases, chase complications, escape factors',
  'Trap save DCs, sellable magic items, crafting, madness, treasure',
];

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pref = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};

export function initScreen({ store, toast }) {
  const wrap = $('#screen-wrap');
  const img = $('#screen-img');
  const strip = $('#screen-pages');
  let pages = [];
  let urls = [];
  let current = pref.get('hv-screen-page', 'fitz-1');
  let zoom = 1;

  function revoke() { urls.forEach((u) => URL.revokeObjectURL(u)); urls = []; }

  async function load() {
    revoke();
    const uploaded = await store.listImages();
    const own = uploaded.map((r) => {
      const url = URL.createObjectURL(new Blob([r.data], { type: r.type }));
      urls.push(url);
      return { key: `img-${r.id}`, id: r.id, name: r.name, src: url, thumb: url, builtIn: false };
    });
    const showBuiltIn = pref.get('hv-screen-builtin', '1') === '1';
    pages = [...own, ...(showBuiltIn ? BUILT_IN : [])];
    $('#screen-builtin').checked = showBuiltIn;
    if (!pages.some((p) => p.key === current)) current = pages[0]?.key || '';
    render();
  }

  function render() {
    strip.innerHTML = pages.map((p) => `
      <button class="page-thumb ${p.key === current ? 'on' : ''}" data-key="${esc(p.key)}" title="${esc(p.name)}">
        <img src="${esc(p.thumb)}" alt="" loading="lazy" draggable="false"><span>${esc(p.name)}</span>
      </button>`).join('');
    const page = pages.find((p) => p.key === current);
    $('#screen-empty').hidden = !!page;
    $('#screen-viewer').hidden = !page;
    if (!page) return;
    if (img.getAttribute('src') !== page.src) {
      img.src = page.src;
      setZoom(1);
    }
    const i = BUILT_IN.findIndex((b) => b.key === page.key);
    img.alt = page.builtIn ? `Fitz's 5e DM Screen, page ${i + 1}: ${BUILT_IN_ALT[i]}` : page.name;
    $('#screen-open').href = page.src;
    $('#screen-own-actions').hidden = page.builtIn;
    $('#screen-credit').hidden = !page.builtIn;
    const own = pages.filter((p) => !p.builtIn);
    const idx = own.findIndex((p) => p.key === page.key);
    $('#screen-left').disabled = idx <= 0;
    $('#screen-right').disabled = idx === -1 || idx >= own.length - 1;
    $('#screen-prev').disabled = pages.indexOf(page) <= 0;
    $('#screen-next').disabled = pages.indexOf(page) >= pages.length - 1;
  }

  function select(key) {
    current = key;
    pref.set('hv-screen-page', key);
    render();
    strip.querySelector('.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  // Zoom keeps the point under (cx, cy) in place; defaults to the centre.
  function setZoom(z, cx, cy) {
    const rect = wrap.getBoundingClientRect();
    const px = cx ?? rect.left + rect.width / 2;
    const py = cy ?? rect.top + rect.height / 2;
    const fx = (wrap.scrollLeft + px - rect.left) / (img.offsetWidth || 1);
    const fy = (wrap.scrollTop + py - rect.top) / (img.offsetHeight || 1);
    zoom = Math.min(5, Math.max(1, z));
    img.style.width = `${zoom * 100}%`;
    wrap.scrollLeft = fx * img.offsetWidth - (px - rect.left);
    wrap.scrollTop = fy * img.offsetHeight - (py - rect.top);
    document.querySelectorAll('[data-zoom]').forEach((b) => b.classList.toggle('on', Number(b.dataset.zoom) === zoom));
  }

  strip.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-key]');
    if (b) select(b.dataset.key);
  });
  const step = (d) => {
    const i = pages.findIndex((p) => p.key === current);
    if (pages[i + d]) select(pages[i + d].key);
  };
  $('#screen-prev').addEventListener('click', () => step(-1));
  $('#screen-next').addEventListener('click', () => step(1));
  document.querySelectorAll('[data-zoom]').forEach((b) => b.addEventListener('click', () => setZoom(Number(b.dataset.zoom))));

  // Double-click / double-tap toggles zoom at that spot.
  let lastTap = 0;
  const toggleAt = (x, y) => setZoom(zoom > 1 ? 1 : 2.5, x, y);
  wrap.addEventListener('dblclick', (ev) => toggleAt(ev.clientX, ev.clientY));
  wrap.addEventListener('touchend', (ev) => {
    if (ev.touches.length || ev.changedTouches.length !== 1) return;
    const now = Date.now();
    if (now - lastTap < 300) {
      ev.preventDefault();
      const t = ev.changedTouches[0];
      toggleAt(t.clientX, t.clientY);
      lastTap = 0;
    } else lastTap = now;
  }, { passive: false });

  // Ctrl/⌘ + wheel (and trackpad pinch) zooms on desktop.
  wrap.addEventListener('wheel', (ev) => {
    if (!ev.ctrlKey && !ev.metaKey) return;
    ev.preventDefault();
    setZoom(zoom * (ev.deltaY < 0 ? 1.15 : 1 / 1.15), ev.clientX, ev.clientY);
  }, { passive: false });

  // Mouse drag to pan (touch uses native scrolling).
  let drag = null;
  wrap.addEventListener('pointerdown', (ev) => {
    if (ev.pointerType !== 'mouse' || ev.button !== 0) return;
    drag = { x: ev.clientX, y: ev.clientY, sl: wrap.scrollLeft, st: wrap.scrollTop };
    wrap.classList.add('dragging');
    wrap.setPointerCapture(ev.pointerId);
  });
  wrap.addEventListener('pointermove', (ev) => {
    if (!drag) return;
    wrap.scrollLeft = drag.sl - (ev.clientX - drag.x);
    wrap.scrollTop = drag.st - (ev.clientY - drag.y);
  });
  const endDrag = () => { drag = null; wrap.classList.remove('dragging'); };
  wrap.addEventListener('pointerup', endDrag);
  wrap.addEventListener('pointercancel', endDrag);

  // Keyboard: arrows change page while the tab is open.
  document.addEventListener('keydown', (ev) => {
    if ($('#screen').hidden || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) return;
    if (ev.key === 'ArrowRight' && !ev.altKey) step(1);
    if (ev.key === 'ArrowLeft' && !ev.altKey) step(-1);
  });

  // Full screen (and landscape on phones that allow it).
  const viewer = $('#screen-viewer');
  if (!viewer.requestFullscreen) $('#screen-full').hidden = true;
  $('#screen-full').addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) { await document.exitFullscreen(); return; }
      await viewer.requestFullscreen();
      await screen.orientation?.lock?.('landscape').catch(() => {});
    } catch { toast('Full screen is not available here'); }
  });
  document.addEventListener('fullscreenchange', () => {
    $('#screen-full').textContent = document.fullscreenElement ? '✕ Exit full screen' : '⛶ Full screen';
    setZoom(1);
  });

  $('#screen-builtin').addEventListener('change', (ev) => {
    pref.set('hv-screen-builtin', ev.target.checked ? '1' : '0');
    load();
  });

  // ---- managing uploaded pages
  const ownId = () => pages.find((p) => p.key === current)?.id;
  $('#screen-rename').addEventListener('click', async () => {
    const page = pages.find((p) => p.key === current);
    const name = prompt('Name for this page', page?.name || '');
    if (name == null || !page) return;
    await store.renameImage(page.id, name);
    await load();
  });
  $('#screen-delete').addEventListener('click', async () => {
    const page = pages.find((p) => p.key === current);
    if (!page || !confirm(`Delete "${page.name}" from your DM screen?`)) return;
    const i = pages.indexOf(page);
    await store.removeImage(page.id);
    current = (pages[i + 1] || pages[i - 1])?.key || '';
    await load();
    toast('Page deleted');
  });
  $('#screen-left').addEventListener('click', async () => { await store.moveImage(ownId(), -1); await load(); });
  $('#screen-right').addEventListener('click', async () => { await store.moveImage(ownId(), 1); await load(); });

  $('#screen-upload').addEventListener('change', async (ev) => {
    const files = [...ev.target.files];
    ev.target.value = '';
    if (!files.length) return;
    const label = $('#screen-upload-label');
    const original = label.firstChild.textContent;
    try {
      const added = [];
      for (const file of files) {
        const base = file.name.replace(/\.[^.]+$/, '');
        if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
          label.firstChild.textContent = `Reading ${file.name}… `;
          added.push(...await pdfToImages(file, base, (n, total) => { label.firstChild.textContent = `Page ${n}/${total}… `; }));
        } else if (file.type.startsWith('image/')) {
          added.push({ name: base, type: file.type, data: await file.arrayBuffer() });
        } else {
          toast(`${file.name} is not an image or PDF`);
        }
      }
      if (!added.length) return;
      const ids = await store.addImages(added);
      current = `img-${ids[0]}`;
      await load();
      toast(`Added ${added.length} page${added.length === 1 ? '' : 's'} to your DM screen`);
    } catch (err) {
      toast(err.message.includes('storage') || err.name === 'QuotaExceededError'
        ? 'Not enough storage space on this device for that file'
        : `Couldn't add that file: ${err.message}`);
    } finally {
      label.firstChild.textContent = original;
    }
  });

  return { load, refresh: load };
}

let pdfjsPromise = null;
async function pdfToImages(file, base, onProgress) {
  pdfjsPromise ||= import(PDFJS).then((m) => { m.GlobalWorkerOptions.workerSrc = PDFJS_WORKER; return m; });
  let pdfjs;
  try { pdfjs = await pdfjsPromise; } catch {
    pdfjsPromise = null;
    throw new Error('the PDF reader could not be loaded (are you offline?)');
  }
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const out = [];
  for (let n = 1; n <= doc.numPages; n++) {
    onProgress(n, doc.numPages);
    const page = await doc.getPage(n);
    const base1 = page.getViewport({ scale: 1 });
    // About 2500px on the long side: sharp when zoomed, without huge files.
    const scale = Math.min(4, 2500 / Math.max(base1.width, base1.height));
    const vp = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(vp.width);
    canvas.height = Math.round(vp.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    // WebP where supported (Safari falls back to JPEG).
    let blob = await new Promise((r) => canvas.toBlob(r, 'image/webp', 0.9));
    if (!blob || blob.type !== 'image/webp') blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.92));
    out.push({ name: doc.numPages > 1 ? `${base} p${n}` : base, type: blob.type, data: await blob.arrayBuffer() });
    page.cleanup();
  }
  await doc.destroy();
  return out;
}
