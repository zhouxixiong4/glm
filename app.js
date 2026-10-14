/* app.js — GLM-5.3-Flash chat, a PWA for iPhone.
 *
 * The phone talks to Zhipu's API directly (no server of ours in between). Chats and attachments live in
 * IndexedDB on the device, settings and the API key in localStorage. Tools the model can call:
 *   run_python / run_javascript — code in a locked-down Web Worker (sandbox.js), for exact math;
 *   web_search                  — Zhipu's web search API.
 */
(() => {
  'use strict';

  const VERSION = '1.0.0';
  const CFG = Object.assign({ apiKey: '', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-5.3-flash' }, window.GLM_CONFIG || {});
  const MAX_STEPS = 16; // model calls per answer (each tool round is one)
  const PRICE = { in: 0.8, out: 2.8, cached: 0.23 }; // 元 / 百万 tokens, GLM-5.3-Flash list price
  const KATEX = {
    js: 'sha384-7zkQWkzuo3B5mTepMUcHkMB5jZaolc2xDwL6VFqjFALcbeS9Ggm/Yr2r3Dy4lfFg',
    css: 'sha384-nB0miv6/jRmo5UMMR1wu3Gz6NLsoTkbqJghGIsx//Rlm+ZU03BU6SQNC66uf4l5+',
    bases: [
      'https://registry.npmmirror.com/katex/0.16.11/files/dist/',
      'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/',
      'https://unpkg.com/katex@0.16.11/dist/',
    ],
  };
  const EFFORT = { low: '低', high: '高', max: '最大' };

  // ───────────────────────── helpers ─────────────────────────
  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = MD.escape;
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
  const isTouch = matchMedia('(pointer: coarse)').matches;
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isStandalone = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
  const inWeChat = /MicroMessenger/i.test(navigator.userAgent);
  const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
  const fmtNum = (n) => Math.round(n || 0).toLocaleString('en-US');
  const fmtSize = (n) => (n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(0) + ' KB' : (n / 1048576).toFixed(1) + ' MB');
  const secs = (ms) => (ms < 1000 ? '不到 1 秒' : ms < 60000 ? Math.round(ms / 1000) + ' 秒' : Math.floor(ms / 60000) + ' 分 ' + Math.round((ms % 60000) / 1000) + ' 秒');
  const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } };
  const dayKey = (d = new Date()) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const clip = (s, n) => {
    s = String(s);
    if (s.length <= n) return s;
    const head = Math.floor(n * 0.7), tail = n - head;
    return s.slice(0, head) + '\n…（中间省略 ' + (s.length - n) + ' 字）…\n' + s.slice(-tail);
  };
  const load = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
  const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* full or blocked */ } };

  // ───────────────────────── icons ─────────────────────────
  const svg = (body, extra = '') => '<svg viewBox="0 0 24 24" aria-hidden="true"' + extra + '>' + body + '</svg>';
  const SPARK_D = 'M46 24C49 51 49 51 76 54C49 57 49 57 46 84C43 57 43 57 16 54C43 51 43 51 46 24Z M77 12C78.1 21.9 78.1 21.9 88 23C78.1 24.1 78.1 24.1 77 34C75.9 24.1 75.9 24.1 66 23C75.9 21.9 75.9 21.9 77 12Z';
  const I = {
    spark: '<svg viewBox="10 6 84 84" aria-hidden="true"><path d="' + SPARK_D + '"/></svg>',
    menu: svg('<path d="M4 8h16M4 16h10"/>'),
    newChat: svg('<path d="M11 4H6.5A2.5 2.5 0 0 0 4 6.5v11A2.5 2.5 0 0 0 6.5 20h11a2.5 2.5 0 0 0 2.5-2.5V13"/><path d="M17.8 3.7a2 2 0 0 1 2.8 2.8L12.5 14.6 9 15.4l.8-3.5Z"/>'),
    plus: svg('<path d="M12 5v14M5 12h14"/>'),
    send: svg('<path d="M12 19V5M5.5 11.5 12 5l6.5 6.5"/>'),
    stop: svg('<rect x="5" y="5" width="14" height="14" rx="2.5"/>'),
    globe: svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 2.6 3.9 5.6 3.9 9s-1.3 6.4-3.9 9c-2.6-2.6-3.9-5.6-3.9-9S9.4 5.6 12 3Z"/>'),
    sigma: svg('<path d="M17.5 6.5V4.5h-11l6.3 7.5-6.3 7.5h11v-2"/>'),
    bulb: svg('<path d="M9.5 18h5M10.5 21h3"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.7.5 1.1 1.3 1.1 2.1V16h5v-.1c0-.8.4-1.6 1.1-2.1A6 6 0 0 0 12 3Z"/>'),
    chevR: svg('<path d="m9 6 6 6-6 6"/>'),
    chevL: svg('<path d="m15 6-6 6 6 6"/>'),
    chevD: svg('<path d="m6 9 6 6 6-6"/>'),
    copy: svg('<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8"/>'),
    check: svg('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
    pencil: svg('<path d="M4 20h4L18.6 9.4a2.8 2.8 0 0 0-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>'),
    retry: svg('<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8"/><path d="M4 3.5V8h4.5"/><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16"/><path d="M20 20.5V16h-4.5"/>'),
    speaker: svg('<path d="M11 5 6.5 9H4v6h2.5l4.5 4Z"/><path d="M15.5 9a4.5 4.5 0 0 1 0 6M18.5 6a8.5 8.5 0 0 1 0 12"/>'),
    mute: svg('<path d="M11 5 6.5 9H4v6h2.5l4.5 4Z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/>'),
    more: svg('<circle cx="6" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="18" cy="12" r="1.3" fill="currentColor"/>'),
    trash: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>'),
    star: svg('<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.9Z"/>'),
    gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>'),
    search: svg('<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>'),
    close: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
    file: svg('<path d="M14 3H7.5A2.5 2.5 0 0 0 5 5.5v13A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V8Z"/><path d="M14 3v5h5"/>'),
    image: svg('<rect x="3.5" y="3.5" width="17" height="17" rx="3"/><circle cx="9" cy="9" r="1.8"/><path d="m20.5 15-5-5-11 10.5"/>'),
    video: svg('<rect x="3" y="6" width="13" height="12" rx="2.5"/><path d="m16 10.5 5-3v9l-5-3"/>'),
    down: svg('<path d="M12 5v14M5.5 12.5 12 19l6.5-6.5"/>'),
    share: svg('<path d="M12 3v12M7.5 7.5 12 3l4.5 4.5"/><path d="M5 12v6.5A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V12"/>'),
    upload: svg('<path d="M12 20V8M7 12l5-5 5 5M5 4h14"/>'),
    code: svg('<path d="m8 7-5 5 5 5M16 7l5 5-5 5"/>'),
    pen: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>'),
    book: svg('<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5Z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/>'),
    clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
    alert: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5v.01"/>'),
    key: svg('<circle cx="8" cy="15" r="4"/><path d="m10.8 12.2 8.7-8.7M17 6l2.5 2.5M14.5 8.5 16.5 10.5"/>'),
    eye: svg('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>'),
    back: svg('<path d="m15 5-7 7 7 7"/>'),
    layout: svg('<rect x="3.5" y="4" width="17" height="16" rx="3"/><path d="M3.5 9h17M9 9v11"/>'),
    expand: svg('<path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/>'),
    brain: svg('<path d="M12 5a3 3 0 0 0-5.6-1.5A3 3 0 0 0 4 8.5a3.5 3.5 0 0 0 .6 6.3A3 3 0 0 0 9 19a3 3 0 0 0 3-1M12 5a3 3 0 0 1 5.6-1.5A3 3 0 0 1 20 8.5a3.5 3.5 0 0 1-.6 6.3A3 3 0 0 1 15 19a3 3 0 0 1-3-1M12 5v13"/>'),
    history: svg('<path d="M3 12a9 9 0 1 0 2.6-6.4L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>'),
    doc: svg('<path d="M14 3H7.5A2.5 2.5 0 0 0 5 5.5v13A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V8Z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>'),
    palette: svg('<path d="M12 3a9 9 0 0 0 0 18c1 0 1.6-.8 1.6-1.6 0-.5-.2-.8-.5-1.2-.3-.4-.5-.7-.5-1.2 0-.9.7-1.6 1.6-1.6H16a5 5 0 0 0 5-5C21 6.6 17 3 12 3Z"/><circle cx="7.5" cy="11" r="1.2" fill="currentColor"/><circle cx="10.5" cy="7" r="1.2" fill="currentColor"/><circle cx="15" cy="7.5" r="1.2" fill="currentColor"/>'),
  };

  // ───────────────────────── settings ─────────────────────────
  const DEFAULTS = {
    apiKey: '', baseUrl: CFG.baseUrl, model: CFG.model,
    effort: 'max', toolCode: true, toolSearch: true, searchEngine: 'search_std', searchCount: 5,
    toolImage: true, imageModel: 'cogview-3-flash', toolMemory: true, toolChats: true, toolUI: true,
    temperature: '', maxTokens: '',
    nickname: '', systemPrompt: '',
    theme: 'auto', font: 'serif', fontSize: 'm', showMeta: true, autoTitle: true,
    tipClosed: false,
  };
  const S = Object.assign({}, DEFAULTS, load('glm.settings', {}));
  const saveS = () => { store('glm.settings', S); applyAppearance(); };
  const apiKey = () => String(S.apiKey || CFG.apiKey || '').trim();
  const baseUrl = () => String(S.baseUrl || CFG.baseUrl).trim().replace(/\/+$/, '');
  const model = () => String(S.model || CFG.model).trim();

  function applyAppearance() {
    const d = document.documentElement;
    if (S.theme === 'light' || S.theme === 'dark') d.setAttribute('data-theme', S.theme);
    else d.removeAttribute('data-theme');
    d.setAttribute('data-font', S.font);
    d.setAttribute('data-size', S.fontSize);
    const dark = S.theme === 'dark' || (S.theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', dark ? '#262624' : '#FAF9F5'));
    if (typeof UI !== 'undefined') UI.broadcastTheme();
  }

  // ───────────────────────── usage (this device) ─────────────────────────
  function track(u, searches) {
    const all = load('glm.usage', {});
    const k = dayKey();
    const d = all[k] || (all[k] = { in: 0, out: 0, cached: 0, calls: 0, searches: 0 });
    if (u) { d.in += u.in || 0; d.out += u.out || 0; d.cached += u.cached || 0; d.calls += u.calls || 1; }
    d.searches += searches || 0;
    store('glm.usage', all);
  }
  const cost = (d) => (((d.in - d.cached) * PRICE.in + d.cached * PRICE.cached + d.out * PRICE.out) / 1e6);
  function usageSummary() {
    const all = load('glm.usage', {});
    const today = dayKey(), month = today.slice(0, 7);
    const sum = (pred) => Object.entries(all).filter(([k]) => pred(k)).reduce((a, [, d]) => {
      for (const f of ['in', 'out', 'cached', 'calls', 'searches']) a[f] += d[f] || 0;
      return a;
    }, { in: 0, out: 0, cached: 0, calls: 0, searches: 0 });
    return { today: sum((k) => k === today), month: sum((k) => k.startsWith(month)), total: sum(() => true) };
  }

  // ───────────────────────── long-term memory (this device) ─────────────────────────
  const Memory = {
    list: () => load('glm.memory', []),
    save: (list) => store('glm.memory', list),
    add(text) {
      const list = this.list();
      const n = list.reduce((a, m) => Math.max(a, Number(String(m.id).slice(1)) || 0), 0) + 1;
      const item = { id: 'm' + n, text: String(text).trim().slice(0, 500), at: Date.now() };
      list.push(item);
      this.save(list.slice(-200));
      return item;
    },
    remove(id) {
      const list = this.list();
      const i = list.findIndex((m) => m.id === String(id).trim());
      if (i < 0) return null;
      const [gone] = list.splice(i, 1);
      this.save(list);
      return gone;
    },
  };

  // ───────────────────────── storage (IndexedDB) ─────────────────────────
  const DB = {
    db: null,
    mem: { convs: new Map(), blobs: new Map() },
    open() {
      return new Promise((resolve) => {
        let req;
        try { req = indexedDB.open('glm-chat', 1); } catch (e) { resolve(null); return; }
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('convs')) db.createObjectStore('convs', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs', { keyPath: 'id' });
        };
        req.onsuccess = () => { this.db = req.result; resolve(this.db); };
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      });
    },
    run(storeName, mode, fn) {
      if (!this.db) {
        const m = this.mem[storeName];
        return Promise.resolve(fn({
          getAll: () => ({ result: [...m.values()] }), get: (id) => ({ result: m.get(id) }),
          put: (o) => m.set(o.id, o), delete: (id) => m.delete(id), clear: () => m.clear(),
        }) || {}).then((r) => r && r.result);
      }
      return new Promise((resolve, reject) => {
        const tx = this.db.transaction(storeName, mode);
        const req = fn(tx.objectStore(storeName));
        tx.oncomplete = () => resolve(req && req.result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    },
    all: (s) => DB.run(s, 'readonly', (st) => st.getAll()),
    get: (s, id) => DB.run(s, 'readonly', (st) => st.get(id)),
    put: (s, o) => DB.run(s, 'readwrite', (st) => st.put(o)),
    del: (s, id) => DB.run(s, 'readwrite', (st) => st.delete(id)),
    clear: (s) => DB.run(s, 'readwrite', (st) => st.clear()),
  };
  const blobCache = new Map();
  const Blobs = {
    async get(id) {
      if (blobCache.has(id)) return blobCache.get(id);
      const r = await DB.get('blobs', id);
      const v = r ? r.data : null;
      if (v && blobCache.size < 40) blobCache.set(id, v);
      return v;
    },
    put: (id, data) => { blobCache.set(id, data); return DB.put('blobs', { id, data }); },
    del: (id) => { blobCache.delete(id); return DB.del('blobs', id); },
  };

  // Strip view-only fields before saving.
  const plainConv = (c) => JSON.parse(JSON.stringify(c, (k, v) => (k === 'live' || k === 't0' ? undefined : v)));
  async function saveConv(c) {
    if (c.deleted) return;
    try { await DB.put('convs', plainConv(c)); } catch (e) { toast('保存失败：存储空间可能已满'); }
  }
  const saveTimers = new Map();
  function saveSoon(c) {
    clearTimeout(saveTimers.get(c.id));
    saveTimers.set(c.id, setTimeout(() => { saveTimers.delete(c.id); saveConv(c); }, 1200));
  }

  // ───────────────────────── state ─────────────────────────
  const state = { convs: [], cur: null, atts: [], job: null, query: '', speaking: null, editing: null };
  const cur = (m) => m.vs[m.vi];
  const allText = (v) => v.blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n\n').trim();
  const newVersion = () => ({ blocks: [], trace: [], content: '', status: 'streaming', error: '', usage: null, model: model(), ms: 0, at: Date.now() });
  const findMsg = (id) => state.cur && state.cur.messages.find((m) => m.id === id);
  const sortConvs = () => state.convs.sort((a, b) => b.updatedAt - a.updatedAt);

  const D = {
    app: $('#app'), list: $('#conv-list'), q: $('#side-q'), scroller: $('#scroller'), thread: $('#thread'),
    banner: $('#banner'), input: $('#input'), send: $('#btn-send'), atts: $('#atts'), fileIn: $('#file-in'),
    title: $('#title-text'), titleBtn: $('#title-btn'), jump: $('#jump'), layer: $('#layer'), toastEl: $('#toast'),
    composer: $('#composer'), chipCode: $('#chip-code'), chipSearch: $('#chip-search'), chipEffort: $('#chip-effort'),
  };

  // ───────────────────────── small UI pieces ─────────────────────────
  let toastTimer = 0;
  function toast(text, ms = 2200, onTap) {
    D.toastEl.textContent = text;
    D.toastEl.classList.add('show');
    D.toastEl.onclick = onTap || null;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => D.toastEl.classList.remove('show'), ms);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, text.length);
      try { document.execCommand('copy'); } catch (e2) { /* ignore */ }
      ta.remove();
    }
  }

  function layer(node, onClose) {
    D.layer.appendChild(node);
    const close = () => { node.remove(); if (onClose) onClose(); };
    node.addEventListener('click', (e) => { if (e.target === node) close(); });
    return close;
  }

  /** Bottom sheet; resolves with the chosen item's key, or null. */
  function sheet({ title, items }) {
    return new Promise((resolve) => {
      const node = el('<div class="sheet-wrap"><div class="sheet" role="menu"></div></div>');
      const box = node.firstChild;
      if (title) box.appendChild(el('<div class="sheet-title">' + esc(title) + '</div>'));
      let done = false;
      const finish = (v) => { if (done) return; done = true; close(); resolve(v); };
      for (const it of items) {
        if (it.sep) { box.appendChild(el('<div class="sheet-sep"></div>')); continue; }
        const b = el('<button class="sheet-item' + (it.danger ? ' danger' : '') + (it.selected ? ' sel' : '') + '" role="menuitem">' +
          (it.icon || '') + '<span>' + esc(it.label) + (it.desc ? '<span class="desc">' + esc(it.desc) + '</span>' : '') + '</span>' +
          (it.selected ? '<span class="chk">' + I.check + '</span>' : '') + '</button>');
        b.addEventListener('click', () => finish(it.key));
        box.appendChild(b);
      }
      const close = layer(node, () => finish(null));
    });
  }

  function dialog({ title, message, input, value = '', placeholder = '', ok = '确定', cancel = '取消', danger = false, multiline = false }) {
    return new Promise((resolve) => {
      const node = el('<div class="dialog-wrap"><div class="dialog" role="dialog" aria-modal="true">' +
        '<h3>' + esc(title) + '</h3>' + (message ? '<p>' + esc(message) + '</p>' : '') +
        (input ? (multiline ? '<textarea class="field" rows="4"></textarea>' : '<input class="field" autocomplete="off">') : '') +
        '<div class="dialog-bar">' + (cancel ? '<button class="btn" data-r="0">' + esc(cancel) + '</button>' : '') +
        '<button class="btn ' + (danger ? 'danger' : 'primary') + '" data-r="1">' + esc(ok) + '</button></div></div></div>');
      const field = node.querySelector('.field');
      if (field) { field.value = value; field.placeholder = placeholder; }
      let done = false;
      const finish = (yes) => {
        if (done) return;
        done = true;
        close();
        resolve(input ? (yes ? field.value : null) : yes);
      };
      node.querySelectorAll('[data-r]').forEach((b) => b.addEventListener('click', () => finish(b.dataset.r === '1')));
      if (field && !multiline) field.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) finish(true); });
      const close = layer(node, () => finish(false));
      if (field) setTimeout(() => { field.focus(); field.select(); }, 60);
    });
  }

  function viewImage(src) {
    const node = el('<div class="viewer"><img alt=""><button class="icon-btn" aria-label="关闭">' + I.close + '</button></div>');
    node.querySelector('img').src = src;
    const close = layer(node);
    node.addEventListener('click', close);
  }

  async function shareFile(name, text, mime) {
    const file = new File([text], name, { type: mime });
    if (navigator.canShare && navigator.share) {
      try {
        if (navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); return; }
      } catch (e) {
        if (e && e.name === 'AbortError') return;
        if (e && e.name === 'NotAllowedError') { offerFile(name, text, mime); return; }
      }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  }

  /** iOS only lets a page share right after a tap: when preparing took a while, ask for one more tap. */
  async function offerFile(name, data, mime) {
    const size = typeof data === 'string' ? new Blob([data]).size : data.byteLength || data.length || 0;
    if (await dialog({ title: '文件已准备好', message: name + '（' + fmtSize(size) + '）', ok: '保存 / 分享' })) shareFile(name, data, mime);
  }

  // ───────────────────────── API ─────────────────────────
  const headers = () => ({ 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey() });

  function friendlyError(status, code, msg) {
    code = String(code || '');
    msg = String(msg || '').trim();
    if (status === 401 || /^100[0-4]$/.test(code)) return 'API Key 无效或已过期，请到「设置」里检查。' + (msg ? '（' + msg + '）' : '');
    if (code === '1113') return '智谱账户余额不足，请充值后再试。' + (msg ? '（' + msg + '）' : '');
    if (code === '1301') return '内容被智谱的安全审核拦截了，换个说法试试。';
    if (status === 429 || /^130[2-5]$/.test(code)) return '请求太频繁，请稍等几秒再试。' + (msg ? '（' + msg + '）' : '');
    if (status >= 500) return '智谱服务暂时不可用（' + status + '），请稍后重试。' + (msg ? '（' + msg + '）' : '');
    return msg || '请求失败（' + status + '）';
  }
  async function apiError(res) {
    let code = '', msg = '';
    try {
      const text = await res.text();
      try { const d = JSON.parse(text); const e = d.error || d; code = e.code; msg = e.message || text; } catch (e) { msg = text.slice(0, 300); }
    } catch (e) { /* ignore */ }
    const err = new Error(friendlyError(res.status, code, msg));
    err.status = res.status;
    return err;
  }
  const netError = (e) => (e && e.name === 'AbortError' ? e : new Error('网络连接失败，请检查网络后重试。' + (e && e.message ? '（' + e.message + '）' : '')));

  async function* sse(res) {
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).replace(/\r$/, '');
        buf = buf.slice(i + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') return;
        let obj;
        try { obj = JSON.parse(data); } catch (e) { continue; }
        yield obj;
      }
    }
  }

  async function chatOnce(body, signal) {
    let res;
    try {
      res = await fetch(baseUrl() + '/chat/completions', { method: 'POST', headers: headers(), body: JSON.stringify(body), signal });
    } catch (e) { throw netError(e); }
    if (!res.ok) throw await apiError(res);
    return res;
  }

  async function webSearch(query, signal) {
    let res;
    try {
      res = await fetch(baseUrl() + '/web_search', {
        method: 'POST', headers: headers(), signal,
        body: JSON.stringify({ search_query: query.slice(0, 70), search_engine: S.searchEngine, search_intent: false, count: Number(S.searchCount) || 5 }),
      });
    } catch (e) { throw netError(e); }
    if (!res.ok) throw await apiError(res);
    const d = await res.json();
    if (d.error) throw new Error(friendlyError(400, d.error.code, d.error.message));
    return (d.search_result || []).slice(0, Number(S.searchCount) || 5);
  }

  // ───────────────────────── code sandbox ─────────────────────────
  const Sandbox = {
    w: null, seq: 0, jobs: new Map(), sent: new Set(),
    async worker() {
      if (this.w) return this.w;
      const res = await fetch('sandbox.js');
      if (!res.ok) throw new Error('计算沙箱文件缺失');
      const url = URL.createObjectURL(new Blob([await res.text()], { type: 'text/javascript' }));
      const w = new Worker(url);
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      w.onmessage = (e) => this.onMessage(e.data || {});
      w.onerror = (e) => { if (e.preventDefault) e.preventDefault(); this.reset('计算沙箱出错：' + (e.message || '未知错误')); };
      w.postMessage({ type: 'config', appBase: new URL('./', location.href).href });
      this.w = w;
      return w;
    },
    onMessage(m) {
      const job = this.jobs.get(m.id);
      if (!job) return;
      if (m.type === 'progress') {
        if (m.phase === 'exec') job.exec();
        if (m.text) job.progress(m.text);
      } else if (m.type === 'result') {
        this.jobs.delete(m.id);
        job.done(m);
      }
    },
    reset(reason) {
      if (this.w) this.w.terminate();
      this.w = null;
      this.sent.clear();
      const jobs = [...this.jobs.values()];
      this.jobs.clear();
      for (const j of jobs) j.fail(new Error(reason));
    },
    run(lang, code, opts) { return this.job({ type: 'run', lang, code, ns: opts.ns, files: opts.files }, opts); },
    prepare(onProgress) { return this.job({ type: 'prepare' }, { onProgress, timeout: 0 }); },
    job(msg, { signal, onProgress = () => {}, timeout = 60000 } = {}) {
      return new Promise((resolve, reject) => {
        const id = ++this.seq;
        let execTimer = 0;
        const prepTimer = setTimeout(() => this.reset('准备 Python 环境超时（网络太慢或无法访问下载源）'), 360000);
        const cleanup = () => { clearTimeout(execTimer); clearTimeout(prepTimer); if (signal) signal.removeEventListener('abort', onAbort); };
        const onAbort = () => this.reset('已停止');
        this.jobs.set(id, {
          exec: () => {
            clearTimeout(prepTimer);
            if (timeout) execTimer = setTimeout(() => this.reset('代码运行超过 ' + timeout / 1000 + ' 秒，已强制终止（可能有死循环或计算量过大）'), timeout);
          },
          progress: onProgress,
          done: (m) => { cleanup(); resolve(m); },
          fail: (e) => { cleanup(); reject(e); },
        });
        if (signal) signal.addEventListener('abort', onAbort);
        this.worker().then((w) => {
          const transfer = (msg.files || []).map((f) => f.data).filter((d) => d instanceof ArrayBuffer);
          w.postMessage(Object.assign({}, msg, { id }), transfer);
        }, (e) => { this.jobs.delete(id); cleanup(); reject(e); });
      });
    },
  };

  // ───────────────────────── tools ─────────────────────────
  const fn = (name, description, properties, required) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, required } } });
  const IMAGE_SIZES = ['1024x1024', '768x1344', '864x1152', '1344x768', '1152x864', '1440x720', '720x1440'];
  const TOOL_DEFS = {
    run_python: fn('run_python',
      '在用户手机上的 Python 3.13 沙箱（Pyodide）里运行代码，用于精确计算、数学推导、数据分析、画图和生成文件。' +
      '可用库：sympy、mpmath、numpy、scipy、pandas、statsmodels、scikit-learn、networkx、matplotlib、pillow、opencv、highspy（线性/整数规划）、gmpy2、python-flint 和标准库；openpyxl、xlsxwriter（Excel）与 python-docx（Word）会在代码用到时自动安装。' +
      '同一对话里的多次运行共享变量和已导入的模块（类似 Jupyter），如果结果里提示环境已重启，需要重新定义变量。' +
      '用户上传的文件在 files/ 目录（例如 pd.read_excel("files/成绩.xlsx")）。要交给用户的文件保存到 outputs/ 目录（例如 df.to_excel("outputs/结果.xlsx")、doc.save("outputs/报告.docx")），运行后会出现下载按钮。' +
      'matplotlib 画的图会直接显示给用户，图里可以直接写中文（已配置好，不要改字体设置）。' +
      '用 print() 输出结果；最后一行如果是表达式会返回它的 repr。不能联网。单次运行超过 60 秒会被终止。',
      { code: { type: 'string', description: '要运行的 Python 代码' } }, ['code']),
    run_javascript: fn('run_javascript',
      '在用户手机上的 JavaScript 沙箱中运行代码，无需下载、即时可用。适合简单数值计算、BigInt 大整数精确运算（如 2n ** 521n - 1n）、枚举和模拟。用 console.log() 输出；最后一个表达式的值也会返回。run_python 不可用或计算很简单时使用。',
      { code: { type: 'string', description: '要运行的 JavaScript 代码' } }, ['code']),
    web_search: fn('web_search',
      '用搜索引擎联网搜索，返回带编号的结果摘要。问题涉及新闻、实时数据（天气、价格、比分、汇率等）、最近发生的事，或你不确定、可能过时的事实时使用。可以分别搜索不同角度。',
      { query: { type: 'string', description: '搜索关键词，简洁明确' } }, ['query']),
    read_webpage: fn('read_webpage',
      '读取一个网页的正文（转为 Markdown）。用户发来链接，或者搜索结果的摘要不够、需要看原文细节时使用。',
      { url: { type: 'string', description: '完整的网页地址，以 http:// 或 https:// 开头' } }, ['url']),
    generate_image: fn('generate_image',
      '根据文字描述生成一张图片并直接展示给用户。用户要求画图、生成图片、设计头像/海报/插画/示意图时使用。提示词要具体：主体、场景、风格、构图、色彩、光线；需要图中出现文字时把文字内容写清楚。',
      {
        prompt: { type: 'string', description: '详细的画面描述（中文或英文均可）' },
        size: { type: 'string', enum: IMAGE_SIZES, description: '图片尺寸（宽x高），默认 1024x1024' },
      }, ['prompt']),
    update_memory: fn('update_memory',
      '管理关于用户的长期记忆，记忆会出现在之后所有对话里。用户要求你记住或忘记某事，或者透露了以后会长期有用的信息（称呼、身份、职业、所在地、偏好、长期目标、重要的人和事）时使用。不要保存密码、证件号等敏感信息，也不要保存一次性的琐事。',
      {
        action: { type: 'string', enum: ['add', 'remove'], description: 'add 新增一条记忆；remove 删除一条记忆' },
        content: { type: 'string', description: 'add 时：要记住的内容，一句话、写清主语' },
        id: { type: 'string', description: 'remove 时：要删除的记忆编号，例如 m3' },
      }, ['action']),
    show_ui: fn('show_ui',
      '在对话里直接生成一块可交互的界面（Generative UI），用户可以点击、输入、拖动。当交互或可视化比纯文字明显更好时使用：练习题/测验/抽认卡、带滑块的交互式讲解（函数图像、物理或概率模拟）、图表和数据可视化、计算器/换算器/规划工具、对比表、时间线、让用户做选择的表单、小游戏等。简单问答不要用。\n' +
      '写法：只写界面片段（HTML + <style> + <script>），不要写 <html>/<head>/<body>。宽度约 340～720px，手机优先，触控友好（按钮高 ≥40px，字号 ≥15px），简洁美观、留白充足。\n' +
      '内置设计系统，自动适配浅色/深色，请优先使用：CSS 变量 --bg --surface --surface-2 --text --text-2 --text-3 --border --accent --accent-soft --blue --green --red --yellow --purple --ok --danger --radius；样式类 .card .btn .btn.primary .btn.ghost .btn.sm .input .select .chip .chip.on .badge .row .col .grid .muted .table .tabs .progress .stat .option(.selected/.correct/.wrong) .fade-in。界面背景保持透明。\n' +
      '接口：glm.send(文本) 把用户在界面里的选择或结果作为用户消息发回对话（例如测验交卷后发送「我的答案：…，得分：…」，你再继续讲解），用在明确的提交按钮上；await glm.ask(提示词, {system, json:true}) 在界面里调用 AI 并返回文字（需要动态生成内容时用，例如出新题、批改、对话角色）；await glm.chat(消息数组)；localStorage 可用，会保存在手机上；glm.copy(文本)、glm.download(文件名, 内容)、glm.openLink(网址)；glm.color("--accent") 取主题色给图表用；glm.onTheme(fn) 监听深浅色切换。\n' +
      '不能联网（fetch 不可用），数据写在代码里或用 glm.ask 生成。可以加载这些库（国内可访问）：Chart.js https://registry.npmmirror.com/chart.js/4.4.4/files/dist/chart.umd.js ，ECharts https://registry.npmmirror.com/echarts/5.5.1/files/dist/echarts.min.js ，D3 https://registry.npmmirror.com/d3/7.9.0/files/dist/d3.min.js ，Three.js（ES module）https://registry.npmmirror.com/three/0.169.0/files/build/three.module.min.js ，Mermaid https://registry.npmmirror.com/mermaid/11.4.0/files/dist/mermaid.min.js ，KaTeX https://registry.npmmirror.com/katex/0.16.11/files/dist/katex.min.js （样式 katex.min.css 同目录），Matter.js https://registry.npmmirror.com/matter-js/0.20.0/files/build/matter.min.js ，canvas-confetti https://registry.npmmirror.com/canvas-confetti/1.9.3/files/dist/confetti.browser.js 。\n' +
      '数学公式直接写 LaTeX（行内 $…$，独立 $$…$$），界面会自动渲染，包括之后用 JS 插入的内容；不要用 $ 表示货币。修改界面时，用修改后的完整代码再调用一次 show_ui（title 保持一致，保存的数据会延续）。',
      {
        title: { type: 'string', description: '界面标题，简短，例如「二次函数探索器」' },
        html: { type: 'string', description: '界面代码片段：HTML + <style> + <script>' },
      }, ['title', 'html']),
    search_chats: fn('search_chats',
      '搜索用户以前的对话记录（当前对话之外）。用户提到「之前/上次/以前聊过」的内容，或需要参考过去的讨论时使用。',
      { query: { type: 'string', description: '要找的内容的关键词' } }, ['query']),
  };
  const activeTools = () => [
    ...(S.toolCode ? [TOOL_DEFS.run_python, TOOL_DEFS.run_javascript] : []),
    ...(S.toolSearch ? [TOOL_DEFS.web_search, TOOL_DEFS.read_webpage] : []),
    ...(S.toolImage ? [TOOL_DEFS.generate_image] : []),
    ...(S.toolMemory ? [TOOL_DEFS.update_memory] : []),
    ...(S.toolChats ? [TOOL_DEFS.search_chats] : []),
    ...(S.toolUI ? [TOOL_DEFS.show_ui] : []),
  ];

  function systemPrompt() {
    const now = new Date();
    const when = now.toLocaleString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long', hour: '2-digit', minute: '2-digit', hour12: false });
    let tz = '';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { /* ignore */ }
    let s = '你是 GLM（智谱 AI 的 ' + model() + ' 模型），一个知识广博、乐于助人的通用 AI 助手，运行在用户手机上的聊天 App 里。\n' +
      '当前时间：' + when + (tz ? '（' + tz + '）' : '') + '。回答默认使用简体中文，排版用 Markdown，数学公式用 LaTeX（行内 $…$，独立公式 $$…$$）。';
    if (S.nickname.trim()) s += '用户希望你称呼他/她为「' + S.nickname.trim() + '」。';
    const tools = [];
    if (S.toolCode) {
      tools.push('run_python / run_javascript：在用户手机上运行代码。凡是涉及数值计算、代数化简、解方程、微积分、概率统计、数论、矩阵、数据分析或任何需要验算的数学问题，都要先用 run_python 实际计算或验证（优先用 sympy 求精确解，需要时用 mpmath 算高精度数值），再依据运行结果作答，不要心算复杂数值。代码报错就修改后重试。最后用清楚的步骤向用户解释，不需要把代码原样再贴一遍。用户要表格文件、Word 文档或图表时，用代码生成到 outputs/ 目录。');
    }
    if (S.toolSearch) {
      tools.push('web_search / read_webpage：联网搜索和阅读网页。涉及最新信息、实时数据或你不确定的事实时使用；摘要不够就用 read_webpage 读原文。通常搜索 1～3 次就够了，信息足够时直接作答，不要反复搜索。引用搜索结果时，在相应句子末尾用 [1]、[2] 这样的编号标注，编号与搜索结果的编号一致。');
    }
    if (S.toolImage) tools.push('generate_image：用户想要图片时直接生成，不要只给文字描述；生成后简要说明画了什么。');
    if (S.toolMemory) tools.push('update_memory：记住对用户长期有用的信息，或按用户要求删除记忆。记下之后不必反复提及。');
    if (S.toolChats) tools.push('search_chats：查找以前的对话内容。');
    if (S.toolUI) tools.push('show_ui：当可交互的界面能明显提升理解或体验时（测验练习、交互式讲解、可视化、计算/规划工具、对比、小游戏等），主动生成界面，不要只用文字描述；生成后在文字里简短说明怎么用。用户通过界面发回的消息会以「〔界面〕」开头。');
    if (tools.length) s += '\n\n你还可以使用这些工具（只在确实需要时使用，普通聊天和问答直接回答即可）：\n- ' + tools.join('\n- ');
    if (S.toolMemory) {
      const mem = Memory.list();
      s += '\n\n关于用户的长期记忆（编号可用于 update_memory 删除）：\n' + (mem.length ? mem.map((m) => '[' + m.id + '] ' + m.text).join('\n') : '（暂无）');
    }
    if (S.systemPrompt.trim()) s += '\n\n用户的个人偏好与要求：\n' + S.systemPrompt.trim();
    return s;
  }

  async function userContent(m) {
    if (!m.atts || !m.atts.length) return m.text;
    const parts = [];
    let pre = '';
    for (const a of m.atts) {
      const data = await Blobs.get(a.id);
      if (!data) { pre += '[附件「' + a.name + '」已丢失]\n'; continue; }
      if (a.kind === 'image') parts.push({ type: 'image_url', image_url: { url: data } });
      else if (a.kind === 'video') parts.push({ type: 'video_url', video_url: { url: data } });
      else if (a.kind === 'text') pre += '<file name="' + a.name + '">\n' + data + '\n</file>\n\n';
      else parts.push({ type: 'file_url', file_url: { url: data } });
    }
    const text = pre + (m.text || (parts.length ? '请看附件。' : ''));
    if (!parts.length) return text;
    parts.push({ type: 'text', text });
    return parts;
  }

  async function buildHistory(conv, end) {
    const out = [];
    const uiCalls = [];
    for (const m of conv.messages.slice(0, end)) {
      if (m.role !== 'assistant' || !cur(m)) continue;
      for (const t of cur(m).trace || []) for (const tc of t.tool_calls || []) if (tc.function && tc.function.name === 'show_ui') uiCalls.push(tc.id);
    }
    const keepUI = new Set(uiCalls.slice(-2));
    const slim = (tc) => {
      if (!tc.function || tc.function.name !== 'show_ui' || keepUI.has(tc.id)) return tc;
      let title = '';
      try { title = JSON.parse(tc.function.arguments).title || ''; } catch (e) { /* ignore */ }
      return { id: tc.id, type: 'function', function: { name: 'show_ui', arguments: JSON.stringify({ title, html: '（较早版本的界面代码已省略；要修改的话请重新完整生成）' }) } };
    };
    for (const m of conv.messages.slice(0, end)) {
      if (m.role === 'user') { out.push({ role: 'user', content: await userContent(m) }); continue; }
      const v = cur(m);
      if (!v) continue;
      for (const t of v.trace || []) out.push(t.role === 'assistant' ? { role: 'assistant', content: t.content || '', tool_calls: (t.tool_calls || []).map(slim) } : t);
      if (v.content) out.push({ role: 'assistant', content: v.content });
      else if (v.trace && v.trace.length) out.push({ role: 'assistant', content: '（这次回答被中断了）' });
    }
    return out;
  }

  function addUsage(v, u) {
    if (!u) return;
    v.usage = v.usage || { in: 0, out: 0, cached: 0, reason: 0, calls: 0 };
    v.usage.in += u.prompt_tokens || 0;
    v.usage.out += u.completion_tokens || 0;
    v.usage.cached += (u.prompt_tokens_details && u.prompt_tokens_details.cached_tokens) || 0;
    v.usage.reason += (u.completion_tokens_details && u.completion_tokens_details.reasoning_tokens) || 0;
    v.usage.calls += 1;
  }

  function formatCodeResult(b, setupFailed, restarted) {
    if (setupFailed) return 'Python 环境没能准备好：' + b.error + '\n可以改用 run_javascript 计算，或直接推理。';
    let s = restarted ? '（注意：Python 环境刚刚重新启动，之前运行中定义的变量和导入都已不存在。）\n' : '';
    if (b.stdout) s += '输出：\n' + clip(b.stdout, 8000) + '\n';
    if (b.result != null) s += '最后一个表达式的值：\n' + clip(b.result, 4000) + '\n';
    if (b.error) s += '错误：\n' + clip(b.error, 4000) + '\n';
    if (b.images && b.images.length) s += '已生成 ' + b.images.length + ' 张图表，已经显示给用户。\n';
    if (b.files && b.files.length) s += '已生成文件：' + b.files.map((f) => f.name + '（' + fmtSize(f.size) + '）').join('、') + '，用户可以点按钮下载。\n';
    if (b.skipped && b.skipped.length) s += '这些文件太大，没有交给用户：' + b.skipped.join('、') + '\n';
    return s.trim() || '代码已运行，没有任何输出（需要用 print() 输出结果）。';
  }

  const MIME = {
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', csv: 'text/csv', txt: 'text/plain', md: 'text/markdown', json: 'application/json',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', pdf: 'application/pdf', html: 'text/html', zip: 'application/zip', py: 'text/x-python',
  };
  const mimeOf = (name) => MIME[String(name).split('.').pop().toLowerCase()] || 'application/octet-stream';
  function dataUrlBytes(url) {
    const i = url.indexOf(',');
    const bin = atob(url.slice(i + 1));
    const out = new Uint8Array(bin.length);
    for (let k = 0; k < bin.length; k++) out[k] = bin.charCodeAt(k);
    return out;
  }

  /** The conversation's attachments the Python worker does not have yet (it keeps them in files/). */
  async function filesForPython(conv) {
    const out = [];
    for (const m of conv.messages) {
      if (m.role !== 'user') continue;
      for (const a of m.atts || []) {
        const key = conv.id + ':' + a.id;
        if (a.kind === 'video' || Sandbox.sent.has(key)) continue;
        const data = (await Blobs.get(a.id + ':raw')) || (await Blobs.get(a.id));
        if (!data) continue;
        let name = a.name;
        if (a.kind === 'image' && !/\.jpe?g$/i.test(name)) name = name.replace(/\.[^.]*$/, '') + '.jpg';
        out.push({ id: a.id, name, data: typeof data === 'string' && data.startsWith('data:') ? dataUrlBytes(data).buffer : data });
        Sandbox.sent.add(key);
      }
    }
    return out;
  }

  /** matplotlib's SVG keeps text as text; drawing it here uses the phone's own Chinese font. */
  async function svgToPng(svgText) {
    const src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgText);
    try {
      const img = new Image();
      img.src = src;
      await img.decode();
      const scale = 2;
      const w = img.naturalWidth || 640, h = img.naturalHeight || 480;
      const c = document.createElement('canvas');
      c.width = Math.round(w * scale);
      c.height = Math.round(h * scale);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      return c.toDataURL('image/png');
    } catch (e) {
      return src;
    }
  }

  async function readWebpage(url, signal) {
    let res;
    try {
      res = await fetch(baseUrl() + '/reader', { method: 'POST', headers: headers(), signal, body: JSON.stringify({ url }) });
    } catch (e) { throw netError(e); }
    if (!res.ok) throw await apiError(res);
    const d = await res.json();
    if (d.error) throw new Error(friendlyError(400, d.error.code, d.error.message));
    return d.reader_result || {};
  }

  async function generateImage(prompt, size, signal) {
    let res;
    try {
      res = await fetch(baseUrl() + '/images/generations', {
        method: 'POST', headers: headers(), signal,
        body: JSON.stringify({ model: S.imageModel || 'cogview-3-flash', prompt, size: IMAGE_SIZES.includes(size) ? size : '1024x1024' }),
      });
    } catch (e) { throw netError(e); }
    if (!res.ok) throw await apiError(res);
    const d = await res.json();
    const url = d.data && d.data[0] && d.data[0].url;
    if (!url) throw new Error(d.error ? friendlyError(400, d.error.code, d.error.message) : '没有返回图片');
    return url;
  }

  /** Local search over past conversations; CJK text is matched by two-character pieces. */
  function searchChats(query, exceptId) {
    const terms = new Set();
    for (const w of String(query).toLowerCase().split(/[\s,，。、；;：:！!？?"'“”‘’()（）]+/).filter(Boolean)) {
      if (/[㐀-鿿]/.test(w) && w.length > 2) { for (let i = 0; i < w.length - 1; i++) terms.add(w.slice(i, i + 2)); }
      else terms.add(w);
    }
    if (!terms.size) return [];
    const hits = [];
    for (const c of state.convs) {
      if (c.id === exceptId) continue;
      let score = 0, snippet = '', best = 0;
      const texts = [c.title].concat(c.messages.map((m) => (m.role === 'user' ? m.text : allText(cur(m)))));
      for (const t of texts) {
        const low = String(t || '').toLowerCase();
        let local = 0, first = -1;
        for (const term of terms) {
          const i = low.indexOf(term);
          if (i >= 0) { local++; if (first < 0 || i < first) first = i; }
        }
        score += local;
        if (local > best) { best = local; snippet = String(t).slice(Math.max(0, first - 60), first + 160).replace(/\s+/g, ' '); }
      }
      if (score) hits.push({ c, score: score / terms.size, snippet });
    }
    return hits.sort((x, y) => y.score - x.score || y.c.updatedAt - x.c.updatedAt).slice(0, 5).map((h) => {
      const q = h.c.messages.find((m) => m.role === 'user');
      const ans = [...h.c.messages].reverse().find((m) => m.role === 'assistant');
      return {
        id: h.c.id, title: h.c.title, date: dayKey(new Date(h.c.updatedAt)), snippet: h.snippet,
        gist: '用户问：' + clip((q && q.text) || '（附件）', 300) + '\n回答要点：' + clip(MD.toPlain(ans ? allText(cur(ans)) : ''), 700),
      };
    });
  }

  /** The value of a JSON string field from arguments that are still streaming in. */
  function partialField(args, field) {
    const m = new RegExp('"' + field + '"\\s*:\\s*"').exec(args);
    if (!m) return '';
    let out = '';
    for (let i = m.index + m[0].length; i < args.length; i++) {
      const ch = args[i];
      if (ch === '"') break;
      if (ch !== '\\') { out += ch; continue; }
      const nx = args[i + 1];
      if (nx === undefined) break;
      if (nx === 'u') {
        const hex = args.slice(i + 2, i + 6);
        if (hex.length < 4) break;
        out += String.fromCharCode(parseInt(hex, 16));
        i += 5;
      } else {
        out += nx === 'n' ? '\n' : nx === 't' ? '\t' : nx === 'r' ? '' : nx === 'b' ? '\b' : nx === 'f' ? '\f' : nx;
        i++;
      }
    }
    return out;
  }

  async function runTool(call, v, job) {
    let args;
    try { args = JSON.parse(call.function.arguments || '{}'); } catch (e) { return '工具参数不是合法的 JSON：' + call.function.arguments; }
    const name = call.function.name;
    const signal = job.ctrl.signal;
    const fail = (b, e) => {
      if (signal.aborted) throw e;
      b.status = 'error';
      b.error = e.message;
      b.note = '';
    };

    if (name === 'web_search') {
      const b = { type: 'search', query: String(args.query || ''), status: 'running', results: [], open: false };
      v.blocks.push(b);
      paintSoon();
      try {
        const rs = await webSearch(b.query, signal);
        job.searches++;
        b.results = rs.map((r) => ({ n: ++job.cite, title: r.title || hostOf(r.link), link: r.link, media: r.media || '', date: r.publish_date || '', content: r.content || '' }));
        b.status = 'done';
        if (!b.results.length) return '没有搜索到相关结果。';
        return b.results.map((r) => '[' + r.n + '] ' + r.title + '\n来源：' + (r.media || hostOf(r.link)) + (r.date ? ' · ' + r.date : '') + '\n链接：' + r.link + '\n' + clip(r.content, 600)).join('\n\n');
      } catch (e) { fail(b, e); return '搜索失败：' + e.message; }
    }

    if (name === 'read_webpage') {
      const url = String(args.url || '').trim();
      const b = { type: 'read', url, status: 'running', title: '' };
      v.blocks.push(b);
      paintSoon();
      if (!/^https?:\/\/\S+$/i.test(url)) { b.status = 'error'; b.error = '网址无效'; return '网址无效：' + url; }
      try {
        const r = await readWebpage(url, signal);
        const text = String(r.content || '').trim();
        b.title = String(r.title || '').trim() || (text.match(/^(.{1,80})\n=+/) || [0, ''])[1];
        b.chars = text.length;
        b.status = 'done';
        if (!text) return '这个网页没有读到正文（可能需要登录，或内容由脚本动态加载）。';
        return '标题：' + (b.title || '（无）') + '\n链接：' + url + '\n\n' + clip(text, 15000);
      } catch (e) { fail(b, e); return '读取失败：' + e.message; }
    }

    if (name === 'generate_image') {
      const b = { type: 'image', prompt: String(args.prompt || ''), size: String(args.size || '1024x1024'), status: 'running', model: S.imageModel };
      v.blocks.push(b);
      paintSoon();
      try {
        b.url = await generateImage(b.prompt, b.size, signal);
        b.status = 'done';
        job.images++;
        return '图片已生成并展示给用户（' + b.model + '，' + b.size + '）。';
      } catch (e) { fail(b, e); return '画图失败：' + e.message; }
    }

    if (name === 'update_memory') {
      const action = args.action === 'remove' ? 'remove' : 'add';
      const b = { type: 'memory', action, text: '', status: 'done' };
      v.blocks.push(b);
      if (action === 'add') {
        const text = String(args.content || '').trim();
        if (!text) { b.status = 'error'; b.error = '内容为空'; return '没有要记住的内容。'; }
        const m = Memory.add(text);
        b.text = m.text;
        b.id = m.id;
        paintSoon();
        return '已记住（' + m.id + '）：' + m.text;
      }
      const gone = Memory.remove(args.id || '');
      if (!gone) { b.status = 'error'; b.error = '没有编号为 ' + args.id + ' 的记忆'; paintSoon(); return '没有编号为 ' + args.id + ' 的记忆。'; }
      b.text = gone.text;
      paintSoon();
      return '已删除记忆（' + gone.id + '）：' + gone.text;
    }

    if (name === 'search_chats') {
      const b = { type: 'chats', query: String(args.query || ''), status: 'done', results: searchChats(args.query || '', job.conv.id), open: false };
      v.blocks.push(b);
      paintSoon();
      if (!b.results.length) return '以前的对话里没有找到相关内容。';
      return b.results.map((r, i) => '[' + (i + 1) + '] 《' + r.title + '》（' + r.date + '）\n匹配片段：…' + r.snippet + '…\n' + r.gist).join('\n\n');
    }

    if (name === 'show_ui') {
      let b = job.uiBlocks.get(call.id);
      if (!b) { b = { type: 'ui', id: 'ui_' + uid(), title: '', html: '', status: 'streaming', chars: 0 }; v.blocks.push(b); }
      b.title = String(args.title || b.title || '界面').slice(0, 60);
      b.html = String(args.html || '');
      b.chars = b.html.length;
      if (!b.html.trim()) { b.status = 'error'; b.error = '界面代码为空'; paintSoon(); return '界面代码为空，没有显示。'; }
      b.status = 'ready';
      b.store = job.conv.id + ':' + b.title;
      paintSoon();
      return '界面「' + b.title + '」已经显示给用户。用户在界面里通过 glm.send 发回的内容会作为新的用户消息出现（以「〔界面〕」开头）。如果界面运行出错，用户会把错误发给你。';
    }

    if (name === 'run_python' || name === 'run_javascript') {
      const lang = name === 'run_python' ? 'python' : 'javascript';
      const b = { type: 'code', lang, code: String(args.code || ''), status: 'running', note: '', open: false };
      v.blocks.push(b);
      paintSoon();
      const hadPython = lang === 'python' && job.conv.messages.some((m) => m.role === 'assistant' && m.vs.some((x) => x.blocks.some((y) => y !== b && y.type === 'code' && y.lang === 'python' && y.status !== 'running')));
      try {
        const files = lang === 'python' ? await filesForPython(job.conv) : [];
        const r = await Sandbox.run(lang, b.code, { ns: job.conv.id, files, signal, onProgress: (t) => { b.note = t; paintSoon(); } });
        Object.assign(b, { status: r.error ? 'error' : 'done', stdout: r.stdout || '', result: r.result == null ? null : r.result, error: r.error || '', ms: r.ms || 0, note: '' });
        if (r.setup) b.setup = true;
        b.images = [];
        for (const svgText of r.svgs || []) b.images.push(await svgToPng(svgText));
        b.files = [];
        b.skipped = [];
        for (const f of r.outputs || []) {
          if (!f.data) { b.skipped.push(f.name); continue; }
          const id = uid();
          const blob = new Blob([f.data], { type: mimeOf(f.name) });
          await Blobs.put(id, await readDataURL(blob));
          b.files.push({ id, name: f.name.split('/').pop(), size: blob.size, mime: blob.type });
        }
        return formatCodeResult(b, r.setup, r.fresh && hadPython);
      } catch (e) { fail(b, e); return '运行失败：' + e.message; }
    }
    return '没有名为 ' + name + ' 的工具。';
  }

  /** One answer: stream the model, run the tools it asks for, repeat until it answers in text. */
  async function runTurn(conv, msg, v) {
    const job = { conv, msg, v, ctrl: new AbortController(), cite: 0, searches: 0, images: 0, uiBlocks: new Map() };
    state.job = job;
    updateComposer();
    renderSidebar();
    if (state.cur === conv) { paintAI(msg); scrollToBottom(); }
    const t0 = Date.now();
    try {
      const history = await buildHistory(conv, conv.messages.indexOf(msg));
      const messages = [{ role: 'system', content: systemPrompt() }, ...history];
      const tools = activeTools();
      for (let step = 0; step < MAX_STEPS; step++) {
        const body = { model: model(), messages, stream: true, reasoning_effort: S.effort };
        if (tools.length) { body.tools = tools; body.tool_stream = true; }
        if (String(S.temperature).trim() !== '') body.temperature = Number(S.temperature);
        if (String(S.maxTokens).trim() !== '') body.max_tokens = parseInt(S.maxTokens, 10);
        const res = await chatOnce(body, job.ctrl.signal);
        let think = null, text = null, stepText = '', stepReason = '';
        const calls = [];
        for await (const chunk of sse(res)) {
          if (chunk.error) throw new Error(friendlyError(400, chunk.error.code, chunk.error.message));
          const ch = chunk.choices && chunk.choices[0];
          const d = (ch && ch.delta) || {};
          if (d.reasoning_content) {
            if (!think) { think = { type: 'thinking', text: '', ms: 0, live: true, t0: Date.now(), open: false }; v.blocks.push(think); }
            think.text += d.reasoning_content;
            stepReason += d.reasoning_content;
          }
          if (d.content || d.tool_calls) {
            if (think && think.live) { think.live = false; think.ms = Date.now() - think.t0; }
          }
          if (d.content) {
            if (!text) { text = { type: 'text', text: '' }; v.blocks.push(text); }
            text.text += d.content;
            stepText += d.content;
          }
          if (d.tool_calls) {
            for (const tc of d.tool_calls) {
              const i = typeof tc.index === 'number' ? tc.index : calls.length;
              const c = calls[i] || (calls[i] = { id: '', name: '', args: '' });
              if (tc.id) c.id = tc.id;
              if (tc.function && tc.function.name && !c.name) c.name = tc.function.name;
              if (tc.function && tc.function.arguments) c.args += tc.function.arguments;
              if (c.name === 'show_ui') {
                if (!c.block) { c.block = { type: 'ui', id: 'ui_' + uid(), title: '', html: '', status: 'streaming', chars: 0 }; v.blocks.push(c.block); }
                c.block.chars = c.args.length;
                c.block.preview = partialField(c.args, 'html').slice(-1200);
                if (!c.block.title) { const tm = /"title"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(c.args); if (tm) { try { c.block.title = JSON.parse('"' + tm[1] + '"'); } catch (e) { /* partial */ } } }
              }
            }
          }
          if (chunk.usage) addUsage(v, chunk.usage);
          paintSoon();
        }
        if (think && think.live) { think.live = false; think.ms = Date.now() - think.t0; }
        const real = calls.filter(Boolean).filter((c) => c.name);
        if (!real.length) { v.content = stepText; break; }
        const asst = {
          role: 'assistant', content: stepText,
          tool_calls: real.map((c) => ({ id: c.id || 'call_' + uid(), type: 'function', function: { name: c.name, arguments: c.args || '{}' } })),
        };
        real.forEach((c, k) => { if (c.block) job.uiBlocks.set(asst.tool_calls[k].id, c.block); });
        v.trace.push(asst);
        messages.push(stepReason ? Object.assign({ reasoning_content: stepReason }, asst) : asst);
        for (const call of asst.tool_calls) {
          const content = await runTool(call, v, job);
          const t = { role: 'tool', tool_call_id: call.id, content };
          v.trace.push(t);
          messages.push(t);
          paintSoon();
        }
        saveSoon(conv);
        if (step === MAX_STEPS - 1) v.content = stepText || '（工具调用轮数已达上限，回答没有完成）';
      }
      v.status = 'done';
    } catch (e) {
      if (job.ctrl.signal.aborted) {
        v.status = 'stopped';
      } else {
        v.status = 'error';
        v.error = e.message || String(e);
      }
      if (!v.content) {
        const texts = v.blocks.filter((b) => b.type === 'text');
        const lastTrace = v.trace.length;
        if (texts.length && !lastTrace) v.content = texts[texts.length - 1].text;
      }
      for (const b of v.blocks) {
        if (b.live) { b.live = false; b.ms = Date.now() - (b.t0 || Date.now()); }
        if (b.status === 'running') { b.status = 'error'; b.error = b.error || '已中断'; b.note = ''; }
      }
    } finally {
      v.ms = Date.now() - t0;
      v.model = model();
      state.job = null;
      track(v.usage, job.searches);
      if (conv.deleted) { updateComposer(); renderSidebar(); return; }
      conv.updatedAt = Date.now();
      sortConvs();
      await saveConv(conv);
      if (state.cur === conv) { paintAI(msg); scrollToBottom(); }
      updateComposer();
      renderSidebar();
      if (v.status === 'done' && conv.autoTitle && S.autoTitle) makeTitle(conv);
    }
  }

  async function makeTitle(conv) {
    conv.autoTitle = false;
    const u = conv.messages.find((m) => m.role === 'user');
    const a = conv.messages.find((m) => m.role === 'assistant');
    if (!u) return;
    const answer = a ? allText(cur(a)) : '';
    try {
      const res = await chatOnce({
        model: model(), reasoning_effort: 'low', stream: false,
        messages: [{ role: 'user', content: '给下面这段对话起一个简短的中文标题，不超过 14 个字，只输出标题本身，不要引号、书名号和句末标点。\n\n用户：' + (u.text || '（发送了附件）').slice(0, 600) + '\n\n助手：' + answer.slice(0, 600) }],
      });
      const d = await res.json();
      let t = (d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || '';
      t = t.split('\n').map((x) => x.trim()).filter(Boolean)[0] || '';
      t = t.replace(/^(标题[:：]\s*)/, '').replace(/^[\s"'“”「」『』《》【】#*]+|[\s"'“”「」『』《》【】。.!！?？*]+$/g, '').slice(0, 30);
      if (d.usage) track({ in: d.usage.prompt_tokens, out: d.usage.completion_tokens, cached: 0 }, 0);
      if (t) {
        conv.title = t;
        await saveConv(conv);
        renderSidebar();
        updateTitle();
      }
    } catch (e) { /* keep the first-line title */ }
  }

  // ───────────────────────── math rendering (KaTeX, loaded on demand) ─────────────────────────
  let katexJob = null, katexFailedAt = 0;
  function loadAsset(tag, url, integrity) {
    return new Promise((resolve, reject) => {
      const n = document.createElement(tag);
      if (tag === 'link') { n.rel = 'stylesheet'; n.href = url; } else { n.src = url; }
      n.integrity = integrity;
      n.crossOrigin = 'anonymous';
      const timer = setTimeout(() => { n.remove(); reject(new Error('timeout')); }, 15000);
      n.onload = () => { clearTimeout(timer); resolve(); };
      n.onerror = () => { clearTimeout(timer); n.remove(); reject(new Error('load')); };
      document.head.appendChild(n);
    });
  }
  function ensureKatex() {
    if (window.katex) return Promise.resolve();
    if (Date.now() - katexFailedAt < 60000) return Promise.reject(new Error('cooldown'));
    if (!katexJob) {
      katexJob = (async () => {
        for (const base of KATEX.bases) {
          try {
            await Promise.all([loadAsset('link', base + 'katex.min.css', KATEX.css), loadAsset('script', base + 'katex.min.js', KATEX.js)]);
            if (window.katex) return;
          } catch (e) { /* next mirror */ }
        }
        throw new Error('公式组件加载失败');
      })().catch((e) => { katexJob = null; katexFailedAt = Date.now(); throw e; });
    }
    return katexJob;
  }
  function mathCheck() {
    if (!MD.pendingMath || window.katex) return;
    ensureKatex().then(() => {
      MD.pendingMath = false;
      const top = D.scroller.scrollTop;
      renderThread();
      D.scroller.scrollTop = top;
    }, () => {});
  }

  // ───────────────────────── generative UI (sandboxed interfaces) ─────────────────────────
  const UI = {
    assets: null,
    frames: new Map(), // iframe contentWindow -> record
    store: load('glm.uistore', {}),
    saveTimer: 0,
    observer: null,
    load() {
      if (!this.assets) {
        this.assets = Promise.all([fetch('ui-runtime.js'), fetch('ui-base.css')])
          .then(([a, b]) => { if (!a.ok || !b.ok) throw new Error('界面组件缺失'); return Promise.all([a.text(), b.text()]); })
          .then(([runtime, css]) => ({ runtime, css }))
          .catch((e) => { this.assets = null; throw e; });
      }
      return this.assets;
    },
    theme() {
      return S.theme === 'dark' || (S.theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
    },
    srcdoc(a, b) {
      const data = JSON.stringify({ id: b.frameId, html: b.html, store: this.store[b.store] || {} })
        .replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
      return '<!doctype html><html lang="zh-CN" data-theme="' + this.theme() + '"><head><meta charset="utf-8">' +
        '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">' +
        '<meta http-equiv="Content-Security-Policy" content="connect-src \'none\'; img-src data: blob:; media-src data: blob:; frame-src \'none\'; form-action \'none\'; base-uri \'none\'">' +
        '<style>' + a.css + '</style><script type="application/json" id="glm-data">' + data + '</script><script>' + a.runtime + '</script></head><body></body></html>';
    },
    /** Find interface slots in a message and start them when they come near the screen. */
    scan(node, m) {
      node.querySelectorAll('.ui-host:not([data-mounted])').forEach((host) => {
        host.setAttribute('data-mounted', '1');
        const b = cur(m).blocks.find((x) => x.type === 'ui' && x.id === host.dataset.ui);
        if (!b) return;
        host._ui = { b, m };
        host.style.minHeight = '140px';
        if (!this.observer) {
          this.observer = new IntersectionObserver((entries) => {
            for (const e of entries) if (e.isIntersecting) { this.observer.unobserve(e.target); this.mount(e.target); }
          }, { root: D.scroller, rootMargin: '600px 0px' });
        }
        this.observer.observe(host);
      });
    },
    async mount(host, full) {
      const { b, m } = host._ui;
      let assets;
      try { assets = await this.load(); } catch (e) { host.innerHTML = '<div class="ui-fail">' + esc(e.message) + '</div>'; return; }
      const frame = document.createElement('iframe');
      frame.className = 'ui-frame';
      frame.setAttribute('sandbox', 'allow-scripts allow-modals');
      frame.setAttribute('title', b.title || '界面');
      frame.setAttribute('loading', 'eager');
      frame.style.height = (full ? '100%' : '160px');
      const rec = { b, m, frame, host, full: !!full, asks: 0, busy: 0, sends: 0, id: 'f' + uid() };
      b.frameId = rec.id;
      frame.srcdoc = this.srcdoc(assets, b);
      host.innerHTML = '';
      host.appendChild(frame);
      host.style.minHeight = '';
      // contentWindow exists once the frame is in the document
      this.frames.set(frame.contentWindow, rec);
      rec.win = frame.contentWindow;
    },
    status(rec, html) {
      const box = rec.full ? rec.host.parentNode.querySelector('.ui-status') : rec.host.parentNode.querySelector('.ui-status');
      if (box) box.innerHTML = html || '';
    },
    reply(rec, payload) { try { rec.win.postMessage(payload, '*'); } catch (e) { /* frame gone */ } },
    broadcastTheme() {
      const theme = this.theme();
      for (const rec of this.frames.values()) {
        if (!rec.frame.isConnected) { this.frames.delete(rec.win); continue; }
        this.reply(rec, { type: 'theme', theme });
      }
    },
    persist(key, k, v) {
      const obj = this.store[key] || (this.store[key] = {});
      if (k === null) this.store[key] = {};
      else if (v === null) delete obj[k];
      else obj[k] = v;
      if (JSON.stringify(this.store[key]).length > 300000) { toast('这个界面保存的数据太多了，部分内容不会被保存'); return; }
      clearTimeout(this.saveTimer);
      this.saveTimer = setTimeout(() => store('glm.uistore', this.store), 400);
    },
    forgetConv(convId) {
      for (const k of Object.keys(this.store)) if (k.startsWith(convId + ':')) delete this.store[k];
      store('glm.uistore', this.store);
    },
    async onMessage(e) {
      const rec = this.frames.get(e.source);
      if (!rec) return;
      const m = e.data || {};
      if (!m || m.__glm !== rec.id) return;
      switch (m.type) {
        case 'size': {
          if (rec.full) break;
          const h = Math.max(48, Math.min(Number(m.h) || 0, 2400));
          rec.frame.style.height = h + 'px';
          break;
        }
        case 'store': this.persist(rec.b.store, String(m.key), m.value == null ? null : String(m.value)); break;
        case 'store-clear': this.persist(rec.b.store, null); break;
        case 'copy': copyText(String(m.text || '')).then(() => toast('已复制')); break;
        case 'download': offerFile(String(m.name || 'file.txt').replace(/[\\/:*?"<>|]/g, '_'), String(m.content || ''), m.mime || mimeOf(m.name || '')); break;
        case 'open': {
          const url = String(m.url || '');
          if (/^https?:\/\//i.test(url)) window.open(url, '_blank', 'noopener,noreferrer');
          break;
        }
        case 'send': this.send(rec, String(m.text || '').trim()); break;
        case 'ask': this.ask(rec, m); break;
        case 'error': this.error(rec, String(m.message || '')); break;
      }
    },
    send(rec, text) {
      if (!text) return;
      const now = Date.now();
      if (rec.lastSend && now - rec.lastSend < 1500) return;
      rec.lastSend = now;
      if (state.cur !== findConvOf(rec.m)) { toast('请回到这个界面所在的对话'); return; }
      if (state.job) { toast('请等当前回答完成后再提交'); return; }
      if (rec.full && rec.close) rec.close();
      send({ text: '〔界面〕' + text.slice(0, 4000), via: 'ui' });
    },
    async ask(rec, m) {
      const done = (payload) => this.reply(rec, Object.assign({ type: 'reply', rid: m.rid }, payload));
      if (!apiKey()) return done({ error: '还没有设置 API Key' });
      if (rec.asks >= 80) return done({ error: '这个界面调用 AI 的次数太多了，请重新打开' });
      if (rec.busy >= 2) return done({ error: '上一次 AI 调用还没完成' });
      rec.asks++;
      rec.busy++;
      this.status(rec, '<span class="spinner"></span><span>界面正在调用 GLM…</span>');
      try {
        const o = m.opts || {};
        const msgs = [{ role: 'system', content: o.system ? String(o.system).slice(0, 8000) : '你是嵌在一个小应用里的 AI。按要求直接给出结果，不要寒暄，不要解释你是谁。' }];
        const list = Array.isArray(m.messages) ? m.messages : [];
        for (const x of list.slice(-40)) if (x && (x.role === 'user' || x.role === 'assistant')) msgs.push({ role: x.role, content: String(x.content || '').slice(0, 20000) });
        if (m.prompt) msgs.push({ role: 'user', content: String(m.prompt).slice(0, 20000) });
        if (msgs.length < 2) throw new Error('没有提问内容');
        const body = { model: model(), stream: false, reasoning_effort: ['low', 'high', 'max'].includes(o.effort) ? o.effort : 'low', messages: msgs };
        if (o.json) body.response_format = { type: 'json_object' };
        const res = await chatOnce(body);
        const d = await res.json();
        if (d.usage) track({ in: d.usage.prompt_tokens, out: d.usage.completion_tokens, cached: (d.usage.prompt_tokens_details && d.usage.prompt_tokens_details.cached_tokens) || 0 }, 0);
        let text = (d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || '';
        if (o.json) text = text.replace(/^```(?:json)?\s*|\s*```$/g, '');
        done({ text });
      } catch (err) {
        done({ error: err.message || String(err) });
      } finally {
        rec.busy--;
        if (!rec.busy) this.status(rec, '');
      }
    },
    error(rec, message) {
      rec.lastError = message;
      this.status(rec, '<span class="ui-err">' + I.alert + '<span>界面出错：' + esc(message.slice(0, 160)) + '</span></span><button class="btn small" data-act="ui-fix">让 GLM 修复</button>');
    },
    fix(rec) {
      if (state.job) { toast('请等当前回答完成'); return; }
      send({ text: '〔界面〕「' + rec.b.title + '」运行时出错：' + (rec.lastError || '未知错误') + '。请找出原因，用修好的完整代码重新生成这个界面。', via: 'ui' });
    },
    recOf(el) {
      const host = el.closest('.ui-block') && el.closest('.ui-block').querySelector('.ui-host');
      const frame = host && host.querySelector('iframe');
      return frame ? this.frames.get(frame.contentWindow) : null;
    },
    openFull(b, m) {
      const page = el('<div class="page ui-page" role="dialog" aria-label="' + esc(b.title) + '"><div class="page-head"><button class="icon-btn" data-close aria-label="返回">' + I.back + '</button><h2>' + esc(b.title) +
        '</h2><button class="icon-btn" data-reload aria-label="重新加载">' + I.retry + '</button></div><div class="ui-full"><div class="ui-host" data-keep></div><div class="ui-status" data-keep></div></div></div>');
      const host = page.querySelector('.ui-host');
      host._ui = { b, m };
      let rec = null;
      const start = async () => {
        await this.mount(host, true);
        const frame = host.querySelector('iframe');
        rec = frame && this.frames.get(frame.contentWindow);
        if (rec) rec.close = close;
      };
      const close = layer(page, () => { if (rec) this.frames.delete(rec.win); refreshFramesOf(m); });
      page.querySelector('[data-close]').addEventListener('click', close);
      page.querySelector('[data-reload]').addEventListener('click', () => { if (rec) this.frames.delete(rec.win); start(); });
      start();
    },
    async menu(b, m, rec) {
      const k = await sheet({
        title: b.title,
        items: [
          { key: 'code', label: '查看代码', icon: I.code },
          { key: 'copy', label: '复制代码', icon: I.copy },
          { key: 'export', label: '导出为网页文件', icon: I.share },
          { key: 'reload', label: '重新加载', icon: I.retry },
          { key: 'reset', label: '清除这个界面保存的数据', icon: I.trash, danger: true },
        ],
      });
      if (k === 'code') {
        const page = el('<div class="page"><div class="page-head"><button class="icon-btn" data-close aria-label="返回">' + I.back + '</button><h2>' + esc(b.title) + ' · 代码</h2><span style="width:40px"></span></div>' +
          '<div class="page-body"><div class="code-block"><div class="code-head"><span class="code-lang">html</span><button class="code-copy" type="button">' + I.copy + '<span>复制</span></button></div><pre><code>' + MD.highlight(b.html, 'html') + '</code></pre></div></div></div>');
        const close = layer(page);
        page.querySelector('[data-close]').addEventListener('click', close);
        page.querySelector('.code-copy').addEventListener('click', () => { copyText(b.html); toast('已复制'); });
      } else if (k === 'copy') {
        copyText(b.html);
        toast('已复制');
      } else if (k === 'export') {
        const assets = await this.load();
        const html = '<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">\n<title>' + esc(b.title) +
          '</title>\n<style>' + assets.css + '\nbody{padding:16px;max-width:760px;margin:0 auto;background:var(--bg)}</style>\n<script>window.glm={send:function(t){alert(t)},ask:function(){return Promise.reject(new Error("导出的网页不能调用 AI"))},chat:function(){return Promise.reject(new Error("导出的网页不能调用 AI"))},copy:function(t){navigator.clipboard&&navigator.clipboard.writeText(t)},download:function(){},openLink:function(u){open(u)},color:function(n){return getComputedStyle(document.documentElement).getPropertyValue(n).trim()},onTheme:function(){},theme:"light"};window.sendPrompt=window.glm.send;<\/script>\n</head><body>\n' + b.html + '\n</body></html>\n';
        offerFile((b.title || '界面').replace(/[\\/:*?"<>|]/g, '_') + '.html', html, 'text/html');
      } else if (k === 'reload') {
        refreshFramesOf(m, b.id);
      } else if (k === 'reset') {
        if (await dialog({ title: '清除保存的数据？', message: '这个界面在手机上保存的内容（比如进度、记录）会被删除。', ok: '清除', danger: true })) {
          delete this.store[b.store];
          store('glm.uistore', this.store);
          refreshFramesOf(m, b.id);
        }
      }
    },
  };
  window.addEventListener('message', (e) => UI.onMessage(e));
  const findConvOf = (m) => state.convs.find((c) => c.messages.includes(m)) || null;
  /** Restart the interfaces of a message (all, or one block) so they pick up saved data / fresh code. */
  function refreshFramesOf(m, blockId) {
    const node = D.thread.querySelector('.msg-ai[data-id="' + m.id + '"]');
    if (!node) return;
    node.querySelectorAll('.ui-host[data-mounted]').forEach((host) => {
      if (blockId && host.dataset.ui !== blockId) return;
      const frame = host.querySelector('iframe');
      if (frame) UI.frames.delete(frame.contentWindow);
      host.removeAttribute('data-mounted');
      host.innerHTML = '';
    });
    UI.scan(node, m);
  }

  // ───────────────────────── rendering ─────────────────────────
  const blockEls = new WeakMap();
  let paintQueued = false, lastPaint = 0;
  function paintSoon() {
    if (paintQueued) return;
    paintQueued = true;
    const wait = Math.max(0, 70 - (performance.now() - lastPaint));
    setTimeout(() => requestAnimationFrame(() => {
      paintQueued = false;
      lastPaint = performance.now();
      const j = state.job;
      if (j && j.conv === state.cur) { paintAI(j.msg); scrollToBottom(); }
    }), wait);
  }

  function citeMap(v) {
    const map = new Map();
    for (const b of v.blocks) if (b.type === 'search') for (const r of b.results) map.set(r.n, r);
    return map;
  }

  function blockSig(b, cites) {
    switch (b.type) {
      case 'text': return 't' + b.text.length + ':' + cites.size + (window.katex ? 'k' : '');
      case 'thinking': return 'h' + b.text.length + (b.live ? 'L' : '') + (b.open ? 'O' : '') + b.ms;
      case 'search': return 's' + b.status + b.results.length + (b.open ? 'O' : '');
      case 'code': return 'c' + b.status + (b.open ? 'O' : '') + (b.note || '') + (b.ms || 0) + ((b.images || []).length) + ((b.files || []).length);
      case 'read': return 'r' + b.status + (b.title || '');
      case 'image': return 'i' + b.status + (b.url || '') + (b.open ? 'O' : '');
      case 'memory': return 'm' + b.status + b.text;
      case 'chats': return 'q' + b.status + b.results.length + (b.open ? 'O' : '');
      case 'ui': return 'u' + b.status + (b.status === 'streaming' ? b.chars : '') + b.title;
      default: return '?';
    }
  }

  function renderBlock(b, cites) {
    if (b.type === 'text') return el('<div class="md">' + MD.render(b.text, { cites }) + '</div>');
    if (b.type === 'thinking') {
      const head = b.live
        ? '<span class="shimmer">正在思考…</span>'
        : I.clock + '<span>已思考 ' + secs(b.ms) + '</span>';
      const body = b.live && !b.open ? b.text.slice(-700) : b.text;
      return el('<div class="think' + (b.open ? ' open' : '') + (b.live ? ' live' : '') + '"><button class="think-head" data-act="toggle">' + head +
        '<span class="chev">' + I.chevR + '</span></button><div class="think-body">' + esc(body.trim()) + '</div></div>');
    }
    if (b.type === 'search') {
      const running = b.status === 'running';
      const sub = running ? '' : b.status === 'error' ? '搜索失败：' + b.error : b.results.length + ' 个结果';
      const list = b.results.map((r) => '<a class="src" href="' + esc(/^https?:\/\//i.test(r.link || '') ? r.link : '#') + '" target="_blank" rel="noopener noreferrer"><span class="src-n">' + r.n +
        '</span><span><span class="src-t">' + esc(r.title) + '</span><span class="src-m">' + esc(r.media || hostOf(r.link)) + (r.date ? ' · ' + esc(r.date) : '') + '</span></span></a>').join('');
      return el('<div class="tool' + (b.open ? ' open' : '') + '"><button class="tool-head" data-act="toggle"><span class="tool-ic">' + I.globe + '</span>' +
        '<span class="tool-title">' + (running ? '正在搜索：' : '搜索：') + esc(b.query) + (sub ? '<span class="tool-sub">' + esc(sub) + '</span>' : '') + '</span>' +
        '<span class="tool-state' + (b.status === 'error' ? ' err' : '') + '">' + (running ? '<span class="spinner"></span>' : b.status === 'error' ? I.alert : '') + '</span>' +
        (b.results.length ? '<span class="chev">' + I.chevR + '</span>' : '') + '</button>' +
        (b.results.length ? '<div class="tool-body"><div class="src-list">' + list + '</div></div>' : '') + '</div>');
    }
    if (b.type === 'code') {
      const running = b.status === 'running';
      const label = b.lang === 'python' ? 'Python' : 'JavaScript';
      let sub = '';
      if (running) sub = b.note || '运行中…';
      else if (b.error) sub = b.error.trim().split('\n').pop();
      else sub = '→ ' + String(b.result != null ? b.result : b.stdout || '无输出').trim().split('\n')[0];
      let out = '';
      if (!running && (b.stdout || b.result != null || b.error)) {
        out = '<div class="tool-label">结果</div><div class="tool-out"><pre>' + esc(b.stdout || '') +
          (b.result != null ? (b.stdout ? '\n' : '') + '<span class="res">' + esc(b.result) + '</span>' : '') +
          (b.error ? (b.stdout || b.result != null ? '\n' : '') + '<span class="err">' + esc(b.error) + '</span>' : '') + '</pre></div>';
      }
      const imgs = (b.images || []).map((src) => '<img src="' + esc(src) + '" alt="图表" data-act="zoom">').join('');
      return el('<div class="code-wrap"><div class="tool' + (b.open ? ' open' : '') + '"><button class="tool-head" data-act="toggle"><span class="tool-ic">' + I.code + '</span>' +
        '<span class="tool-title">' + (running ? '正在运行 ' : '运行 ') + label + (b.ms && !running ? '<small>' + secs(b.ms) + '</small>' : '') +
        '<span class="tool-sub">' + esc(sub.slice(0, 120)) + '</span></span>' +
        '<span class="tool-state ' + (running ? '' : b.error ? 'err' : 'ok') + '">' + (running ? '<span class="spinner"></span>' : b.error ? I.alert : I.check) + '</span>' +
        '<span class="chev">' + I.chevR + '</span></button>' +
        '<div class="tool-body"><div class="tool-label">代码</div><div class="tool-code"><pre><code>' + MD.highlight(b.code, b.lang) + '</code></pre></div>' + out + '</div></div>' +
        (imgs ? '<div class="tool-imgs">' + imgs + '</div>' : '') +
        ((b.files || []).length ? '<div class="out-files">' + b.files.map((f) => '<button class="att-file out-file" data-act="file" data-file="' + esc(f.id) + '"><span class="ico">' + I.down +
          '</span><span style="min-width:0"><span class="nm" style="display:block">' + esc(f.name) + '</span><span class="sz">' + fmtSize(f.size) + ' · 点击保存</span></span></button>').join('') + '</div>' : '') + '</div>');
    }
    if (b.type === 'read') {
      const running = b.status === 'running';
      const sub = running ? hostOf(b.url) : b.status === 'error' ? '读取失败：' + b.error : hostOf(b.url) + (b.chars ? ' · ' + fmtNum(b.chars) + ' 字' : '');
      return el('<div class="tool"><a class="tool-head" href="' + esc(/^https?:/i.test(b.url) ? b.url : '#') + '" target="_blank" rel="noopener noreferrer" style="text-decoration:none;color:inherit">' +
        '<span class="tool-ic">' + I.doc + '</span><span class="tool-title">' + (running ? '正在阅读：' : '阅读：') + esc(b.title || b.url) +
        '<span class="tool-sub">' + esc(sub) + '</span></span><span class="tool-state' + (b.status === 'error' ? ' err' : '') + '">' +
        (running ? '<span class="spinner"></span>' : b.status === 'error' ? I.alert : I.chevR) + '</span></a></div>');
    }
    if (b.type === 'image') {
      if (b.status === 'running') return el('<div class="gen-img"><div class="gen-wait"><span class="spinner"></span><span>正在画图…</span></div></div>');
      if (b.status === 'error') return el('<div class="ai-error"><b>画图失败</b>' + esc(b.error || '') + '</div>');
      return el('<div class="gen-img"><img src="' + esc(b.url) + '" alt="' + esc(b.prompt) + '" data-act="zoom" referrerpolicy="no-referrer">' +
        '<button class="gen-cap" data-act="toggle">' + I.palette + '<span>' + esc(b.open ? b.prompt : (b.prompt.length > 40 ? b.prompt.slice(0, 40) + '…' : b.prompt)) + '</span></button>' +
        '<div class="gen-hint">' + esc(b.model || '') + ' · 长按图片可保存到相册</div></div>');
    }
    if (b.type === 'ui') {
      if (b.status === 'streaming') {
        const lines = (b.preview || '').split('\n').slice(-9).join('\n');
        return el('<div class="tool ui-gen"><div class="tool-head"><span class="tool-ic">' + I.layout + '</span><span class="tool-title">正在生成界面' + (b.title ? '：' + esc(b.title) : '…') +
          '<span class="tool-sub">已写 ' + fmtNum(b.chars) + ' 字符</span></span><span class="tool-state"><span class="spinner"></span></span></div>' +
          (lines ? '<div class="ui-preview"><pre><code>' + MD.highlight(lines, 'html') + '</code></pre></div>' : '') + '</div>');
      }
      if (b.status === 'error') return el('<div class="ai-error"><b>界面没有生成</b>' + esc(b.error || '') + '</div>');
      return el('<div class="ui-block" data-ui-block="' + esc(b.id) + '"><div class="ui-head"><span class="ui-ic">' + I.layout + '</span><span class="ui-title">' + esc(b.title) + '</span>' +
        '<button class="act" data-act="ui-full" aria-label="全屏打开">' + I.expand + '</button><button class="act" data-act="ui-more" aria-label="更多">' + I.more + '</button></div>' +
        '<div class="ui-host" data-keep data-ui="' + esc(b.id) + '"></div><div class="ui-status" data-keep></div></div>');
    }
    if (b.type === 'memory') {
      const label = b.status === 'error' ? '记忆没有更新：' + (b.error || '') : (b.action === 'remove' ? '已删除记忆：' : '已记住：') + b.text;
      return el('<div class="mem-note' + (b.status === 'error' ? ' err' : '') + '">' + I.brain + '<span>' + esc(label) + '</span></div>');
    }
    if (b.type === 'chats') {
      const list = b.results.map((r) => '<button class="src" data-act="open-conv" data-conv="' + esc(r.id) + '"><span class="src-n">' + I.chevR +
        '</span><span style="text-align:left"><span class="src-t">' + esc(r.title) + '</span><span class="src-m">' + esc(r.date) + ' · ' + esc(r.snippet.slice(0, 60)) + '</span></span></button>').join('');
      return el('<div class="tool' + (b.open ? ' open' : '') + '"><button class="tool-head" data-act="toggle"><span class="tool-ic">' + I.history + '</span>' +
        '<span class="tool-title">查找以前的对话：' + esc(b.query) + '<span class="tool-sub">' + (b.results.length ? b.results.length + ' 个相关对话' : '没有找到') + '</span></span>' +
        (b.results.length ? '<span class="chev">' + I.chevR + '</span>' : '') + '</button>' +
        (b.results.length ? '<div class="tool-body"><div class="src-list">' + list + '</div></div>' : '') + '</div>');
    }
    return el('<div></div>');
  }

  /** Make node `a` look like `b`, reusing a's DOM where it already matches. */
  function morph(a, b) {
    if (a.isEqualNode(b)) return a;
    if (a.nodeType !== b.nodeType || a.nodeName !== b.nodeName) { a.replaceWith(b); return b; }
    if (a.nodeType !== 1) { a.nodeValue = b.nodeValue; return a; }
    if (a.hasAttribute('data-keep') && b.hasAttribute('data-keep')) return a; // a live interface lives here
    for (const at of Array.from(a.attributes)) if (!b.hasAttribute(at.name)) a.removeAttribute(at.name);
    for (const at of Array.from(b.attributes)) if (a.getAttribute(at.name) !== at.value) a.setAttribute(at.name, at.value);
    const ak = Array.from(a.childNodes), bk = Array.from(b.childNodes);
    for (let i = 0; i < bk.length; i++) {
      if (i < ak.length) morph(ak[i], bk[i]);
      else a.appendChild(bk[i]);
    }
    for (let i = bk.length; i < ak.length; i++) ak[i].remove();
    return a;
  }

  function paintAI(m, node) {
    node = node || D.thread.querySelector('.msg-ai[data-id="' + m.id + '"]');
    if (!node) return;
    const v = cur(m);
    const live = !!(state.job && state.job.v === v);
    const wrap = node.querySelector('.ai-blocks');
    const cites = citeMap(v);
    let prev = null;
    v.blocks.forEach((b, i) => {
      if (b.type === 'text' && !b.text.trim()) return;
      let rec = blockEls.get(b);
      const sig = blockSig(b, cites);
      const fresh = !rec || rec.sig !== sig ? renderBlock(b, cites) : null;
      if (fresh) fresh.dataset.bi = i;
      if (!rec) {
        rec = { el: fresh, sig };
        blockEls.set(b, rec);
      } else if (fresh) {
        rec.el = morph(rec.el, fresh);
        rec.sig = sig;
      }
      if (b.type === 'thinking' && b.live) { const tb = rec.el.querySelector('.think-body'); if (tb) tb.scrollTop = tb.scrollHeight; }
      rec.el.dataset.bi = i;
      const want = prev ? prev.nextSibling : wrap.firstChild;
      if (want !== rec.el) wrap.insertBefore(rec.el, want);
      prev = rec.el;
    });
    while (prev ? prev.nextSibling : wrap.firstChild) (prev ? prev.nextSibling : wrap.firstChild).remove();
    const tail = node.querySelector('.ai-tail');
    const html = tailHtml(m, v, live);
    if (tail._html !== html) { tail.innerHTML = html; tail._html = html; }
    mathCheck();
    UI.scan(node, m);
  }

  const actBtn = (act, icon, label, on, disabled) => '<button class="act' + (on ? ' on' : '') + '" data-act="' + act + '" aria-label="' + label + '" title="' + label + '"' + (disabled ? ' disabled' : '') + '>' + icon + '</button>';

  function tailHtml(m, v, live) {
    if (live) return '<div class="ai-wait"><span class="spark spin">' + I.spark + '</span></div>';
    let s = '';
    if (v.status === 'error') s += '<div class="ai-error"><b>出错了</b>' + esc(v.error) + '<div><button class="btn small" data-act="retry">' + I.retry + '重试</button></div></div>';
    else if (v.status === 'stopped') s += '<div class="ai-note">已停止生成</div>';
    const conv = state.cur;
    const last = conv && conv.messages[conv.messages.length - 1] === m;
    const text = allText(v);
    s += '<div class="msg-actions">';
    if (text) s += actBtn('copy', I.copy, '复制');
    if (last && !state.job) s += actBtn('retry', I.retry, '重新生成');
    if (text) s += actBtn('speak', state.speaking === m.id ? I.mute : I.speaker, state.speaking === m.id ? '停止朗读' : '朗读', state.speaking === m.id);
    if (text && navigator.share) s += actBtn('share', I.share, '分享');
    if (m.vs.length > 1) {
      s += '<span class="vers">' + actBtn('prev', I.chevL, '上一个版本', false, m.vi === 0 || !!state.job) + (m.vi + 1) + ' / ' + m.vs.length +
        actBtn('next', I.chevR, '下一个版本', false, m.vi === m.vs.length - 1 || !!state.job) + '</span>';
    }
    if (S.showMeta && v.usage && v.status !== 'streaming') s += '<span class="meta">' + secs(v.ms) + ' · ' + fmtNum(v.usage.in + v.usage.out) + ' tokens</span>';
    return s + '</div>';
  }

  function attHtml(a, removable) {
    let inner;
    if ((a.kind === 'image' || a.kind === 'video') && a.thumb) {
      inner = '<img class="att-thumb" src="' + esc(a.thumb) + '" alt="' + esc(a.name) + '"' + (removable ? '' : ' data-act="view-att" data-att="' + a.id + '"') + '>';
    } else {
      inner = '<div class="att-file"><span class="ico">' + (a.kind === 'video' ? I.video : a.kind === 'image' ? I.image : I.file) + '</span><span style="min-width:0"><span class="nm" style="display:block">' +
        esc(a.name) + '</span><span class="sz">' + fmtSize(a.size) + '</span></span></div>';
    }
    if (!removable) return inner;
    return '<div class="att-chip">' + inner + (a.busy ? '<div class="busy"><span class="spinner"></span></div>' : '') +
      '<button class="att-x" data-rm="' + a.id + '" aria-label="移除">' + I.close + '</button></div>';
  }

  function renderUser(m) {
    const node = el('<div class="msg msg-user" data-id="' + m.id + '"></div>');
    if (state.editing === m.id) {
      node.innerHTML = '<div class="u-edit"><textarea></textarea><div class="u-edit-bar"><button class="btn small" data-act="edit-cancel">取消</button>' +
        '<button class="btn small primary" data-act="edit-save">发送</button></div></div>';
      node.querySelector('textarea').value = m.text;
      return node;
    }
    if (m.via === 'ui') {
      node.innerHTML = '<div class="u-bubble u-ui"><span class="u-ui-tag">' + I.layout + '来自界面</span><div class="u-text">' + esc(m.text.replace(/^〔界面〕/, '')) + '</div></div>';
      return node;
    }
    const lines = (m.text.match(/\n/g) || []).length;
    const long = m.text.length > 700 || lines > 12;
    node.innerHTML = (m.atts && m.atts.length ? '<div class="u-atts">' + m.atts.map((a) => attHtml(a, false)).join('') + '</div>' : '') +
      (m.text ? '<div class="u-bubble' + (long ? ' clamp' : '') + '" data-act="user-tap"><div class="u-text">' + esc(m.text) + '</div>' +
        (long ? '<button class="u-more" data-act="expand">展开全部</button>' : '') + '</div>' : '') +
      '<div class="msg-actions">' + actBtn('copy', I.copy, '复制') + (state.job ? '' : actBtn('edit', I.pencil, '编辑')) + '</div>';
    return node;
  }

  function renderMsg(m) {
    if (m.role === 'user') return renderUser(m);
    const node = el('<div class="msg msg-ai" data-id="' + m.id + '"><div class="ai-blocks"></div><div class="ai-tail"></div></div>');
    paintAI(m, node);
    return node;
  }

  function greeting() {
    const h = new Date().getHours();
    const g = h < 5 ? '夜深了' : h < 11 ? '早上好' : h < 13 ? '中午好' : h < 18 ? '下午好' : '晚上好';
    return g + (S.nickname.trim() ? '，' + S.nickname.trim() : '');
  }

  const SUGGEST = [
    { icon: I.layout, label: '互动讲解', text: '做一个可以拖动滑块调节 a、b、c 的二次函数图像，帮我理解它们分别怎样影响抛物线。' },
    { icon: I.check, label: '小测验', text: '给我出 5 道初中数学选择题，做成可以直接作答、交卷后显示得分的测验。' },
    { icon: I.sigma, label: '算一算', text: '求定积分 ∫₀^π x²·sin(x) dx 的精确值，并用代码验算。' },
    { icon: I.palette, label: '画一张', text: '画一张：清晨的江南水乡，薄雾、石桥和乌篷船，水彩风格。' },
    { icon: I.pen, label: '写作', text: '帮我写一段' },
    { icon: I.image, label: '识图', pick: true, text: '这张图片里有什么？' },
  ];

  function renderWelcome() {
    const node = el('<div class="welcome"><span class="spark">' + I.spark + '</span><h1>' + esc(greeting()) + '</h1>' +
      '<p>' + esc(model()) + ' · 思考强度' + EFFORT[S.effort] + (S.toolCode ? ' · 代码计算' : '') + (S.toolSearch ? ' · 联网搜索' : '') + '</p>' +
      '<div class="suggest">' + SUGGEST.map((s, i) => '<button class="sug" data-act="sug" data-i="' + i + '">' + s.icon + esc(s.label) + '</button>').join('') + '</div></div>');
    if (!apiKey()) {
      const card = el('<div class="card"><h2>欢迎使用</h2><p>这个 App 直接连接智谱开放平台的 GLM 模型。首次使用请粘贴你的 API Key，它只保存在这台手机上。</p>' +
        '<div class="inline-field"><input class="field" id="ob-key" type="password" placeholder="粘贴 API Key" autocomplete="off" autocapitalize="off" spellcheck="false">' +
        '<button class="btn primary" id="ob-save">保存</button></div><p class="hint">API Key 在 open.bigmodel.cn 的「API Keys」页面获取。</p></div>');
      card.querySelector('#ob-save').addEventListener('click', async () => {
        const k = card.querySelector('#ob-key').value.trim();
        if (!k) return toast('请先粘贴 API Key');
        const btn = card.querySelector('#ob-save');
        btn.disabled = true;
        btn.textContent = '验证中…';
        try {
          await testKey(k);
          S.apiKey = k;
          saveS();
          toast('已保存，可以开始对话了');
          renderThread();
          updateComposer();
        } catch (e) {
          toast(e.message, 4000);
          btn.disabled = false;
          btn.textContent = '保存';
        }
      });
      const wrap = el('<div></div>');
      wrap.append(card, node);
      return wrap;
    }
    return node;
  }

  function updateTitle() {
    const c = state.cur;
    D.title.textContent = c && c.messages.length ? c.title : model().toUpperCase().replace('GLM-', 'GLM-').replace('-FLASH', '-Flash');
    D.titleBtn.classList.toggle('plain', !(c && c.messages.length));
    document.title = c && c.messages.length ? c.title + ' - GLM' : 'GLM';
  }

  function renderThread() {
    const c = state.cur;
    D.thread.innerHTML = '';
    if (!c || !c.messages.length) D.thread.appendChild(renderWelcome());
    else {
      const frag = document.createDocumentFragment();
      for (const m of c.messages) frag.appendChild(renderMsg(m));
      D.thread.appendChild(frag);
    }
    updateTitle();
  }

  function rerenderMsg(m) {
    const old = D.thread.querySelector('.msg[data-id="' + m.id + '"]');
    if (old) old.replaceWith(renderMsg(m));
  }

  // ───────────────────────── sidebar ─────────────────────────
  function renderSidebar() {
    const q = state.query.trim().toLowerCase();
    let list = state.convs;
    if (q) {
      list = list.filter((c) => c.title.toLowerCase().includes(q) || c.messages.some((m) => (m.role === 'user' ? m.text : allText(cur(m))).toLowerCase().includes(q)));
    }
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const groups = [['收藏', []], ['今天', []], ['昨天', []], ['7 天内', []], ['30 天内', []], ['更早', []]];
    for (const c of list) {
      const t = c.updatedAt;
      const g = c.starred ? 0 : t >= today ? 1 : t >= today - 864e5 ? 2 : t >= today - 7 * 864e5 ? 3 : t >= today - 30 * 864e5 ? 4 : 5;
      groups[g][1].push(c);
    }
    let html = '';
    for (const [name, cs] of groups) {
      if (!cs.length) continue;
      html += '<div class="conv-group">' + name + '</div>';
      for (const c of cs) {
        const streaming = state.job && state.job.conv === c;
        html += '<div class="conv-item' + (state.cur === c ? ' active' : '') + (streaming ? ' streaming' : '') + '" data-id="' + c.id + '">' +
          (c.starred ? '<span class="star">' + I.star + '</span>' : '') + '<span class="t">' + esc(c.title || '新对话') + '</span>' +
          '<button class="more" data-more="' + c.id + '" aria-label="更多操作">' + I.more + '</button></div>';
      }
    }
    D.list.innerHTML = html || '<div class="conv-empty">' + (q ? '没有找到相关对话' : '还没有对话') + '</div>';
    const name = S.nickname.trim();
    $('#side-user').textContent = name || '设置';
    $('#side-avatar').textContent = name ? name.slice(0, 1).toUpperCase() : 'G';
  }

  const openSide = () => D.app.classList.add('side-open');
  const closeSide = () => D.app.classList.remove('side-open');
  const wide = () => matchMedia('(min-width: 900px)').matches;

  function openConv(c) {
    if (state.editing) state.editing = null;
    state.cur = c;
    store('glm.last', { id: c ? c.id : null, at: Date.now() });
    renderThread();
    renderSidebar();
    updateComposer();
    restoreDraft();
    if (!wide()) closeSide();
    requestAnimationFrame(() => scrollToBottom(true));
  }

  function newChat() {
    openConv(null);
    if (!isTouch) D.input.focus();
  }

  async function convMenu(c) {
    const key = await sheet({
      title: c.title,
      items: [
        { key: 'rename', label: '重命名', icon: I.pencil },
        { key: 'star', label: c.starred ? '取消收藏' : '收藏', icon: I.star },
        { key: 'export', label: '导出为 Markdown', icon: I.share },
        { sep: true },
        { key: 'delete', label: '删除对话', icon: I.trash, danger: true },
      ],
    });
    if (key === 'rename') {
      const t = await dialog({ title: '重命名对话', input: true, value: c.title, ok: '保存' });
      if (t && t.trim()) { c.title = t.trim().slice(0, 60); c.autoTitle = false; await saveConv(c); renderSidebar(); updateTitle(); }
    } else if (key === 'star') {
      c.starred = !c.starred;
      await saveConv(c);
      renderSidebar();
    } else if (key === 'export') {
      shareFile((c.title || '对话').replace(/[\\/:*?"<>|]/g, '_') + '.md', convMarkdown(c), 'text/markdown');
    } else if (key === 'delete') {
      if (!(await dialog({ title: '删除这个对话？', message: '「' + c.title + '」将被永久删除，无法恢复。', ok: '删除', danger: true }))) return;
      c.deleted = true;
      UI.forgetConv(c.id);
      if (state.job && state.job.conv === c) state.job.ctrl.abort();
      state.convs = state.convs.filter((x) => x !== c);
      await DB.del('convs', c.id);
      for (const m of c.messages) {
        for (const a of m.atts || []) { Blobs.del(a.id); Blobs.del(a.id + ':raw'); }
        if (m.role === 'assistant') for (const x of m.vs) for (const y of x.blocks) for (const f of y.files || []) Blobs.del(f.id);
      }
      if (state.cur === c) openConv(null);
      renderSidebar();
      toast('已删除');
    }
  }

  function convMarkdown(c) {
    let s = '# ' + c.title + '\n\n';
    for (const m of c.messages) {
      if (m.role === 'user') {
        s += '**我：**\n\n' + m.text + '\n' + (m.atts && m.atts.length ? '\n（附件：' + m.atts.map((a) => a.name).join('、') + '）\n' : '') + '\n';
      } else {
        const v = cur(m);
        let body = '';
        for (const b of v.blocks) {
          if (b.type === 'text') body += b.text + '\n\n';
          else if (b.type === 'code') body += '```' + b.lang + '\n' + b.code + '\n```\n\n' + (b.stdout || b.result || b.error ? '```text\n' + [b.stdout, b.result, b.error].filter((x) => x != null && x !== '').join('\n') + '\n```\n\n' : '');
          else if (b.type === 'search') body += '> 搜索：' + b.query + '\n' + b.results.map((r) => '> [' + r.n + '] [' + r.title + '](' + r.link + ')').join('\n') + '\n\n';
        }
        s += '**GLM：**\n\n' + body.trim() + '\n\n';
      }
      s += '---\n\n';
    }
    return s;
  }

  // ───────────────────────── composer ─────────────────────────
  function autosize() {
    D.input.style.height = 'auto';
    D.input.style.height = Math.min(D.input.scrollHeight, window.innerHeight * 0.38) + 'px';
  }

  function updateComposer() {
    const busy = !!state.job;
    const here = busy && state.job.conv === state.cur;
    D.send.classList.toggle('stop', here);
    D.send.innerHTML = here ? I.stop : I.send;
    D.send.setAttribute('aria-label', here ? '停止' : '发送');
    const empty = !D.input.value.trim() && !state.atts.length;
    D.send.disabled = here ? false : busy || empty || state.atts.some((a) => a.busy);
    D.chipCode.setAttribute('aria-pressed', String(!!S.toolCode));
    D.chipSearch.setAttribute('aria-pressed', String(!!S.toolSearch));
    D.chipEffort.innerHTML = I.bulb + '<span class="lbl">思考·' + EFFORT[S.effort] + '</span>';
    D.chipEffort.setAttribute('aria-label', '思考强度：' + EFFORT[S.effort]);
  }

  const DRAFT_KEY = 'glm.drafts';
  function saveDraft() {
    const all = load(DRAFT_KEY, {});
    const k = state.cur ? state.cur.id : '_new';
    if (D.input.value) all[k] = D.input.value; else delete all[k];
    store(DRAFT_KEY, all);
  }
  function restoreDraft() {
    const all = load(DRAFT_KEY, {});
    D.input.value = all[state.cur ? state.cur.id : '_new'] || '';
    autosize();
    updateComposer();
  }

  function renderAtts() {
    D.atts.innerHTML = state.atts.map((a) => attHtml(a, true)).join('');
    updateComposer();
  }

  const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|jsonl|xml|ya?ml|toml|ini|cfg|conf|log|py|js|mjs|cjs|ts|tsx|jsx|java|kt|kts|c|h|cpp|hpp|cc|cs|go|rs|rb|php|swift|m|sh|bash|zsh|bat|ps1|sql|html?|css|scss|less|vue|tex|r|lua|dart|scala|pl|env|gitignore|srt|vtt)$/i;
  function classify(f) {
    const t = f.type || '';
    if (/\.(docx|xlsx|pptx)$/i.test(f.name)) return 'office';
    if (/\.(doc|xls|ppt|pages|numbers|key)$/i.test(f.name)) return 'legacy';
    if (t.startsWith('image/')) return 'image';
    if (t.startsWith('video/')) return 'video';
    if (t === 'application/pdf' || /\.pdf$/i.test(f.name)) return 'pdf';
    if (t.startsWith('text/') || TEXT_EXT.test(f.name) || /json|xml|javascript|x-sh|x-python/.test(t)) return 'text';
    return 'other';
  }

  // ── Word / Excel / PowerPoint (.docx .xlsx .pptx): unzip on the phone and keep the text ──
  const inflateRaw = async (u8) => new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
  async function unzip(buf, want) {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    let eocd = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('文件已损坏或不是 Office 文档');
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const dec = new TextDecoder();
    const out = new Map();
    for (let n = 0; n < count && dv.getUint32(p, true) === 0x02014b50; n++) {
      const method = dv.getUint16(p + 10, true), size = dv.getUint32(p + 20, true);
      const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
      const off = dv.getUint32(p + 42, true);
      const name = dec.decode(buf.subarray(p + 46, p + 46 + nlen));
      p += 46 + nlen + xlen + clen;
      if (!want(name)) continue;
      const start = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true);
      const data = buf.subarray(start, start + size);
      out.set(name, dec.decode(method === 0 ? data : await inflateRaw(data)));
    }
    return out;
  }
  const xmlDoc = (text) => new DOMParser().parseFromString(text, 'application/xml');
  const byTag = (node, tag) => Array.from(node.getElementsByTagName(tag));
  const numOf = (name) => Number((name.match(/(\d+)\.xml$/) || [0, 0])[1]);
  async function officeText(file) {
    const buf = new Uint8Array(await file.arrayBuffer());
    const ext = file.name.split('.').pop().toLowerCase();
    if (ext === 'docx') {
      const parts = await unzip(buf, (n) => n === 'word/document.xml');
      const body = byTag(xmlDoc(parts.get('word/document.xml') || ''), 'w:body')[0];
      if (!body) throw new Error('读不出文档内容');
      const para = (p) => byTag(p, '*').map((e) => (e.tagName === 'w:t' ? e.textContent : e.tagName === 'w:tab' ? '\t' : e.tagName === 'w:br' ? '\n' : '')).join('');
      const lines = [];
      for (const node of Array.from(body.children)) {
        if (node.tagName === 'w:p') lines.push(para(node));
        else if (node.tagName === 'w:tbl') {
          for (const tr of byTag(node, 'w:tr')) lines.push('| ' + byTag(tr, 'w:tc').map((tc) => byTag(tc, 'w:p').map(para).join(' ').trim()).join(' | ') + ' |');
        }
      }
      return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    }
    if (ext === 'xlsx') {
      const parts = await unzip(buf, (n) => n === 'xl/sharedStrings.xml' || n === 'xl/workbook.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
      const shared = parts.has('xl/sharedStrings.xml') ? byTag(xmlDoc(parts.get('xl/sharedStrings.xml')), 'si').map((si) => byTag(si, 't').map((t) => t.textContent).join('')) : [];
      const names = parts.has('xl/workbook.xml') ? byTag(xmlDoc(parts.get('xl/workbook.xml')), 'sheet').map((x) => x.getAttribute('name')) : [];
      const sheets = [...parts.keys()].filter((n) => n.startsWith('xl/worksheets/')).sort((a, b) => numOf(a) - numOf(b));
      const out = [];
      sheets.forEach((n, i) => {
        const rows = byTag(xmlDoc(parts.get(n)), 'row').map((row) => byTag(row, 'c').map((c) => {
          const t = c.getAttribute('t');
          const v = byTag(c, 'v')[0];
          if (t === 's') return shared[Number(v && v.textContent)] || '';
          if (t === 'inlineStr') return byTag(c, 't').map((x) => x.textContent).join('');
          return v ? v.textContent : '';
        }).join('\t'));
        out.push('## ' + (names[i] || '工作表' + (i + 1)) + '\n' + rows.join('\n'));
      });
      return out.join('\n\n').trim();
    }
    if (ext === 'pptx') {
      const parts = await unzip(buf, (n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
      return [...parts.keys()].sort((a, b) => numOf(a) - numOf(b)).map((n, i) => '## 第 ' + (i + 1) + ' 页\n' +
        byTag(xmlDoc(parts.get(n)), 'a:p').map((p) => byTag(p, 'a:t').map((t) => t.textContent).join('')).filter(Boolean).join('\n')).join('\n\n').trim();
    }
    throw new Error('不支持的格式');
  }
  const readDataURL = (blob) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
  async function decodeImage(file) {
    if (window.createImageBitmap) {
      try { return await createImageBitmap(file); } catch (e) { /* fall back */ }
    }
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('无法解码图片')); };
      img.src = url;
    });
  }
  function drawTo(img, max, quality) {
    const w = img.width || img.naturalWidth, h = img.height || img.naturalHeight;
    const k = Math.min(1, max / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * k));
    c.height = Math.max(1, Math.round(h * k));
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', quality);
  }
  function videoThumb(file) {
    return new Promise((resolve) => {
      const v = document.createElement('video');
      const url = URL.createObjectURL(file);
      let done = false;
      const finish = (t) => { if (done) return; done = true; URL.revokeObjectURL(url); resolve(t); };
      v.muted = true; v.playsInline = true; v.preload = 'metadata'; v.src = url;
      v.onloadeddata = () => { try { v.currentTime = Math.min(0.5, (v.duration || 1) / 2); } catch (e) { finish(null); } };
      v.onseeked = () => { try { finish(drawTo(v, 240, 0.7)); } catch (e) { finish(null); } };
      v.onerror = () => finish(null);
      setTimeout(() => finish(null), 5000);
    });
  }

  async function addFiles(files) {
    for (const f of files) {
      let kind = classify(f);
      if (kind === 'legacy') { toast('「' + f.name + '」是旧格式，请另存为 docx / xlsx / pptx 或 PDF 后再发', 4000); continue; }
      if (kind === 'other') { toast('暂不支持「' + f.name + '」这种文件，可以转成 PDF 再发', 4000); continue; }
      const limit = kind === 'text' ? 1 : 20;
      if (f.size > limit * 1048576) { toast('「' + f.name + '」太大了（上限 ' + limit + ' MB）', 3000); continue; }
      const office = kind === 'office';
      if (office) kind = 'text';
      const a = { id: uid(), kind, name: f.name || (kind === 'image' ? '图片.jpg' : '文件'), mime: f.type, size: f.size, busy: true };
      state.atts.push(a);
      renderAtts();
      try {
        if (kind === 'image') {
          const img = await decodeImage(f);
          a.data = drawTo(img, 2048, 0.88);
          a.thumb = drawTo(img, 240, 0.72);
          a.size = Math.round(a.data.length * 0.75);
          a.mime = 'image/jpeg';
          if (img.close) img.close();
        } else if (kind === 'video') {
          a.data = await readDataURL(f);
          a.thumb = await videoThumb(f);
        } else if (office) {
          a.raw = await readDataURL(f);
          a.data = await officeText(f);
          if (!a.data) throw new Error('文档里没有文字');
          if (a.data.length > 400000) { a.data = a.data.slice(0, 400000); toast('文档很长，只保留了前 40 万字', 3500); }
        } else if (kind === 'text') {
          a.data = await f.text();
        } else {
          a.data = await readDataURL(f);
        }
        a.busy = false;
      } catch (e) {
        state.atts = state.atts.filter((x) => x !== a);
        toast('无法读取「' + f.name + '」' + (e && e.message ? '：' + e.message : ''), 3500);
      }
      renderAtts();
    }
  }

  async function send(opts) {
    if (state.job) { toast('请等当前回答完成'); return; }
    const fromUI = !!(opts && opts.via === 'ui');
    const text = fromUI ? opts.text : D.input.value.trim();
    if (!text && (fromUI || !state.atts.length)) return;
    if (state.atts.some((a) => a.busy)) { toast('附件还在处理中'); return; }
    if (!apiKey()) { toast('请先填写 API Key'); openSettings(); return; }
    let c = state.cur;
    if (!c) {
      c = { id: uid(), title: '新对话', createdAt: Date.now(), updatedAt: Date.now(), starred: false, autoTitle: true, messages: [] };
      state.convs.unshift(c);
      state.cur = c;
      const drafts = load(DRAFT_KEY, {});
      delete drafts._new;
      store(DRAFT_KEY, drafts);
    }
    const atts = fromUI ? [] : state.atts.splice(0);
    for (const a of atts) {
      await Blobs.put(a.id, a.data);
      if (a.raw) await Blobs.put(a.id + ':raw', a.raw);
      delete a.data;
      delete a.raw;
      delete a.busy;
    }
    const um = { id: uid(), role: 'user', text, atts, at: Date.now() };
    if (fromUI) um.via = 'ui';
    const am = { id: uid(), role: 'assistant', vs: [newVersion()], vi: 0, at: Date.now() };
    if (!c.messages.length) c.title = (text || atts[0].name).replace(/\s+/g, ' ').slice(0, 28);
    c.messages.push(um, am);
    c.updatedAt = Date.now();
    if (!fromUI) {
      D.input.value = '';
      autosize();
      saveDraft();
      renderAtts();
    }
    renderThread();
    renderSidebar();
    store('glm.last', { id: c.id, at: Date.now() });
    scrollToBottom(true);
    saveConv(c);
    if (isTouch) D.input.blur();
    runTurn(c, am, am.vs[0]);
  }

  function regenerate(m) {
    if (state.job) return;
    const c = state.cur;
    if (c.messages[c.messages.length - 1] !== m) return;
    if (state.speaking === m.id) stopSpeaking();
    const v = newVersion();
    m.vs.push(v);
    m.vi = m.vs.length - 1;
    rerenderMsg(m);
    scrollToBottom(true);
    runTurn(c, m, v);
  }

  async function submitEdit(m, text) {
    const c = state.cur;
    text = text.trim();
    if (!text && !(m.atts && m.atts.length)) return;
    const i = c.messages.indexOf(m);
    const dropped = c.messages.splice(i + 1);
    for (const x of dropped) {
      for (const a of x.atts || []) { Blobs.del(a.id); Blobs.del(a.id + ':raw'); }
      if (x.role === 'assistant') for (const y of x.vs) for (const z of y.blocks) for (const f of z.files || []) Blobs.del(f.id);
    }
    m.text = text;
    state.editing = null;
    const am = { id: uid(), role: 'assistant', vs: [newVersion()], vi: 0, at: Date.now() };
    c.messages.push(am);
    renderThread();
    scrollToBottom(true);
    runTurn(c, am, am.vs[0]);
  }

  // ───────────────────────── read aloud ─────────────────────────
  function stopSpeaking() {
    const id = state.speaking;
    state.speaking = null;
    try { speechSynthesis.cancel(); } catch (e) { /* ignore */ }
    const m = id && findMsg(id);
    if (m) paintAI(m);
  }
  function speak(m) {
    if (!('speechSynthesis' in window)) return toast('这台设备不支持朗读');
    if (state.speaking === m.id) return stopSpeaking();
    stopSpeaking();
    const u = new SpeechSynthesisUtterance(MD.toPlain(allText(cur(m))).slice(0, 12000));
    u.lang = 'zh-CN';
    const voice = speechSynthesis.getVoices().find((x) => /^zh[-_]CN/i.test(x.lang));
    if (voice) u.voice = voice;
    u.onend = u.onerror = () => { if (state.speaking === m.id) { state.speaking = null; paintAI(m); } };
    state.speaking = m.id;
    speechSynthesis.speak(u);
    paintAI(m);
  }

  // ───────────────────────── scrolling & viewport ─────────────────────────
  let stick = true;
  function scrollToBottom(force) {
    if (force) stick = true;
    if (stick) D.scroller.scrollTop = D.scroller.scrollHeight;
  }
  D.scroller.addEventListener('scroll', () => {
    const gap = D.scroller.scrollHeight - D.scroller.scrollTop - D.scroller.clientHeight;
    stick = gap < 90;
    D.jump.classList.toggle('show', gap > 400);
  }, { passive: true });

  function setupViewport() {
    const vv = window.visualViewport;
    const root = document.documentElement;
    const apply = () => {
      const h = vv ? vv.height : window.innerHeight;
      root.style.setProperty('--vvh', Math.round(h) + 'px');
      const top = vv ? Math.max(0, vv.offsetTop) : 0;
      D.app.style.transform = top ? 'translateY(' + top + 'px)' : '';
      document.body.classList.toggle('kb', !!vv && window.innerHeight - vv.height > 140);
      if (stick) D.scroller.scrollTop = D.scroller.scrollHeight;
    };
    if (vv) { vv.addEventListener('resize', apply); vv.addEventListener('scroll', apply); }
    window.addEventListener('resize', apply);
    window.addEventListener('scroll', () => { if (window.scrollY) window.scrollTo(0, 0); });
    apply();
    if (window.ResizeObserver) {
      new ResizeObserver(() => root.style.setProperty('--comp-h', D.composer.offsetHeight + 'px')).observe(D.composer);
    }
  }

  // ───────────────────────── settings page ─────────────────────────
  async function testKey(key) {
    const res = await fetch(baseUrl() + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({ model: model(), reasoning_effort: 'low', messages: [{ role: 'user', content: '只回复 OK' }] }),
    }).catch((e) => { throw netError(e); });
    if (!res.ok) throw await apiError(res);
    return true;
  }

  function seg(key, opts) {
    return '<div class="seg" data-seg="' + key + '">' + opts.map(([v, l]) => '<button data-v="' + v + '" class="' + (String(S[key]) === v ? 'on' : '') + '">' + l + '</button>').join('') + '</div>';
  }
  const sw = (key) => '<button class="switch' + (S[key] ? ' on' : '') + '" data-sw="' + key + '" role="switch" aria-checked="' + !!S[key] + '"></button>';
  const money = (d) => '¥' + cost(d).toFixed(cost(d) < 1 ? 3 : 2);

  function openSettings() {
    const u = usageSummary();
    const keyMasked = apiKey() ? apiKey().slice(0, 6) + '…' + apiKey().slice(-4) : '未设置';
    const page = el('<div class="page" role="dialog" aria-label="设置"><div class="page-head"><button class="icon-btn" data-close aria-label="返回">' + I.back + '</button><h2>设置</h2><span style="width:40px"></span></div>' +
      '<div class="page-body"><div class="page-inner">' +
      '<div class="sec-title">账户</div><div class="group">' +
        '<div class="row"><div class="row-line"><div class="row-label">API Key<small id="key-state">' + esc(keyMasked) + (S.apiKey ? '' : CFG.apiKey ? '（使用预置 Key）' : '') + '</small></div></div>' +
        '<div class="inline-field"><input class="field" id="set-key" type="password" placeholder="粘贴新的 API Key" autocomplete="off" autocapitalize="off" spellcheck="false"><button class="btn" id="set-key-save">验证并保存</button></div></div>' +
        '<div class="row"><div class="row-label">接口地址<small>默认是智谱开放平台（国内站）</small></div><input class="field" data-k="baseUrl" value="' + esc(S.baseUrl) + '" autocapitalize="off" spellcheck="false"></div>' +
      '</div>' +
      '<div class="sec-title">模型</div><div class="group">' +
        '<div class="row"><div class="row-label">模型 ID<small>默认 glm-5.3-flash</small></div><input class="field" data-k="model" value="' + esc(S.model) + '" autocapitalize="off" spellcheck="false"></div>' +
        '<div class="row"><div class="row-line"><div class="row-label">思考强度<small>GLM-5.3-Flash 始终会思考，强度越高越认真、越慢</small></div>' + seg('effort', [['low', '低'], ['high', '高'], ['max', '最大']]) + '</div></div>' +
        '<div class="row"><div class="row-label">温度 temperature<small>留空使用模型默认值</small></div><input class="field" data-k="temperature" inputmode="decimal" placeholder="默认" value="' + esc(S.temperature) + '"></div>' +
        '<div class="row"><div class="row-label">回复长度上限 max_tokens<small>留空使用模型默认值</small></div><input class="field" data-k="maxTokens" inputmode="numeric" placeholder="默认" value="' + esc(S.maxTokens) + '"></div>' +
      '</div>' +
      '<div class="sec-title">工具</div><div class="group">' +
        '<div class="row"><div class="row-line"><div class="row-label">代码计算<small>GLM 在手机上运行 Python（SymPy、pandas、NumPy、SciPy、matplotlib…）和 JavaScript：精确计算、验算数学题、分析你上传的表格、画图表、生成 Excel / Word 文件。免费，在本机运行。</small></div>' + sw('toolCode') + '</div>' +
        '<div class="inline-field" style="align-items:center"><button class="btn small" id="py-prep">' + I.down + '预先下载 Python 环境</button><span class="hint" id="py-state" style="margin:0">首次使用约需下载 20 MB</span></div></div>' +
        '<div class="row"><div class="row-line"><div class="row-label">联网搜索与网页阅读<small>使用智谱官方的网络搜索和网页阅读服务，和对话共用同一个 API Key，不需要另外注册；按次计费</small></div>' + sw('toolSearch') + '</div></div>' +
        '<div class="row"><div class="row-label">搜索档位<small>都由智谱提供；基础版最便宜，其他档位结果更全但更贵</small></div><select class="field" data-k="searchEngine">' +
          [['search_std', '基础版 search_std'], ['search_pro', '高阶版 search_pro'], ['search_pro_sogou', '搜狗 search_pro_sogou'], ['search_pro_quark', '夸克 search_pro_quark']]
            .map(([v, l]) => '<option value="' + v + '"' + (S.searchEngine === v ? ' selected' : '') + '>' + l + '</option>').join('') + '</select></div>' +
        '<div class="row"><div class="row-line"><div class="row-label">画图<small>用智谱的图像模型生成图片</small></div>' + sw('toolImage') + '</div></div>' +
        '<div class="row"><div class="row-label">画图模型</div><select class="field" data-k="imageModel">' +
          [['cogview-3-flash', 'CogView-3-Flash（免费）'], ['cogview-4', 'CogView-4（付费，效果更好）'], ['glm-image', 'GLM-Image（付费，中文文字渲染更好）']]
            .map(([v, l]) => '<option value="' + v + '"' + (S.imageModel === v ? ' selected' : '') + '>' + l + '</option>').join('') + '</select></div>' +
        '<div class="row"><div class="row-line"><div class="row-label">长期记忆<small>GLM 会记住你的称呼、偏好等长期有用的信息，所有对话都会用到</small></div>' + sw('toolMemory') + '</div>' +
        '<div id="mem-list"></div></div>' +
        '<div class="row"><div class="row-line"><div class="row-label">生成式界面<small>GLM 可以直接在对话里生成可交互的界面：测验、交互式讲解、图表、计算器、小游戏…界面在隔离沙箱里运行，拿不到你的 Key 和聊天记录</small></div>' + sw('toolUI') + '</div></div>' +
        '<div class="row"><div class="row-line"><div class="row-label">查找以前的对话<small>你提到「上次聊过的…」时，GLM 可以翻看以前的对话</small></div>' + sw('toolChats') + '</div></div>' +
      '</div>' +
      '<div class="sec-title">个性化</div><div class="group">' +
        '<div class="row"><div class="row-label">怎么称呼你</div><input class="field" data-k="nickname" placeholder="例如：小周" value="' + esc(S.nickname) + '"></div>' +
        '<div class="row"><div class="row-label">个人偏好<small>希望 GLM 在回答时考虑的事情，例如身份、语气、格式要求</small></div><textarea class="field" data-k="systemPrompt" rows="4" placeholder="例如：我是高中生，讲解时请循序渐进。">' + esc(S.systemPrompt) + '</textarea></div>' +
      '</div>' +
      '<div class="sec-title">外观</div><div class="group">' +
        '<div class="row"><div class="row-line"><div class="row-label">主题</div>' + seg('theme', [['auto', '跟随系统'], ['light', '浅色'], ['dark', '深色']]) + '</div></div>' +
        '<div class="row"><div class="row-line"><div class="row-label">回答字体</div>' + seg('font', [['serif', '衬线'], ['sans', '无衬线']]) + '</div></div>' +
        '<div class="row"><div class="row-line"><div class="row-label">字号</div>' + seg('fontSize', [['s', '小'], ['m', '标准'], ['l', '大']]) + '</div></div>' +
        '<div class="row"><div class="row-line"><div class="row-label">显示用时和 tokens</div>' + sw('showMeta') + '</div></div>' +
        '<div class="row"><div class="row-line"><div class="row-label">自动生成对话标题</div>' + sw('autoTitle') + '</div></div>' +
      '</div>' +
      '<div class="sec-title">用量（本机统计，按 GLM-5.3-Flash 标准价估算）</div><div class="group"><div class="row"><div class="stat">' +
        '<div><b>' + money(u.today) + '</b><span>今天 · ' + fmtNum(u.today.in + u.today.out) + ' tokens</span></div>' +
        '<div><b>' + money(u.month) + '</b><span>本月 · ' + fmtNum(u.month.in + u.month.out) + ' tokens</span></div>' +
        '<div><b>' + money(u.total) + '</b><span>累计 · ' + fmtNum(u.total.calls) + ' 次调用</span></div>' +
      '</div><p class="hint">输入 ' + PRICE.in + ' 元、输出 ' + PRICE.out + ' 元、缓存命中 ' + PRICE.cached + ' 元 / 百万 tokens。联网搜索累计 ' + u.total.searches + ' 次（另计费）。实际扣费以智谱控制台为准。</p></div></div>' +
      '<div class="sec-title">数据</div><div class="group">' +
        '<div class="row"><div class="row-line"><div class="row-label">导出全部对话<small>生成备份文件（含附件），可在新设备导入</small></div><button class="btn small" id="data-export">导出</button></div></div>' +
        '<div class="row"><div class="row-line"><div class="row-label">导入备份</div><button class="btn small" id="data-import">导入</button></div></div>' +
        '<div class="row"><div class="row-line"><div class="row-label">清空所有对话</div><button class="btn small danger" id="data-clear">清空</button></div></div>' +
      '</div>' +
      '<p class="hint" style="text-align:center;margin-top:24px">GLM 助手 ' + VERSION + ' · 数据只保存在这台设备上<br>AI 也可能出错，重要信息请核实</p>' +
      '</div></div></div>');
    const close = layer(page, () => { renderSidebar(); updateComposer(); if (!state.cur || !state.cur.messages.length) renderThread(); });
    page.querySelector('[data-close]').addEventListener('click', close);

    const memBox = page.querySelector('#mem-list');
    const drawMem = () => {
      const mem = Memory.list();
      memBox.innerHTML = mem.length
        ? '<div class="mem-list">' + mem.map((m) => '<div class="mem-item"><span>' + esc(m.text) + '</span><button class="act" data-mem-del="' + esc(m.id) + '" aria-label="删除这条记忆">' + I.trash + '</button></div>').join('') +
          '</div><div class="inline-field"><button class="btn small" id="mem-add">' + I.plus + '添加</button><button class="btn small danger" id="mem-clear">全部清空</button></div>'
        : '<p class="hint" style="margin:8px 0 0">还没有记忆。对 GLM 说「记住……」，或者 <a href="#" id="mem-add">手动添加</a>。</p>';
    };
    drawMem();
    memBox.addEventListener('click', async (e) => {
      const del = e.target.closest('[data-mem-del]');
      if (del) { Memory.remove(del.dataset.memDel); drawMem(); return; }
      if (e.target.closest('#mem-add')) {
        e.preventDefault();
        const t = await dialog({ title: '添加一条记忆', message: '例如：我在上海工作，是一名初中数学老师。', input: true, multiline: true, ok: '保存' });
        if (t && t.trim()) { Memory.add(t); drawMem(); }
        return;
      }
      if (e.target.closest('#mem-clear')) {
        if (await dialog({ title: '清空所有记忆？', message: 'GLM 会忘记之前记住的所有信息。', ok: '清空', danger: true })) { Memory.save([]); drawMem(); }
      }
    });

    page.addEventListener('input', (e) => {
      const k = e.target.dataset.k;
      if (!k) return;
      S[k] = e.target.value;
      saveS();
    });
    page.addEventListener('change', (e) => {
      const k = e.target.dataset.k;
      if (!k) return;
      if (k === 'baseUrl' && !S.baseUrl.trim()) { S.baseUrl = DEFAULTS.baseUrl; e.target.value = S.baseUrl; }
      if (k === 'model' && !S.model.trim()) { S.model = DEFAULTS.model; e.target.value = S.model; }
      saveS();
    });
    page.addEventListener('click', async (e) => {
      const segBtn = e.target.closest('[data-seg] button');
      if (segBtn) {
        const k = segBtn.parentNode.dataset.seg;
        S[k] = segBtn.dataset.v;
        saveS();
        segBtn.parentNode.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === segBtn));
        return;
      }
      const swBtn = e.target.closest('[data-sw]');
      if (swBtn) {
        const k = swBtn.dataset.sw;
        S[k] = !S[k];
        saveS();
        swBtn.classList.toggle('on', S[k]);
        swBtn.setAttribute('aria-checked', String(S[k]));
      }
    });

    page.querySelector('#set-key-save').addEventListener('click', async (e) => {
      const input = page.querySelector('#set-key');
      const k = input.value.trim();
      if (!k) return toast('请先粘贴 API Key');
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = '验证中…';
      try {
        await testKey(k);
        S.apiKey = k;
        saveS();
        input.value = '';
        page.querySelector('#key-state').textContent = k.slice(0, 6) + '…' + k.slice(-4);
        toast('API Key 可用，已保存');
      } catch (err) {
        toast(err.message, 4500);
      }
      btn.disabled = false;
      btn.textContent = '验证并保存';
    });

    page.querySelector('#py-prep').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const st = page.querySelector('#py-state');
      btn.disabled = true;
      st.className = 'hint';
      try {
        const r = await Sandbox.prepare((t) => { st.textContent = t; });
        if (r.error) throw new Error(r.error);
        st.textContent = '✓ ' + (r.stdout || 'Python 已就绪') + '，离线也能用';
        st.className = 'hint status-ok';
      } catch (err) {
        st.textContent = '下载失败：' + err.message;
        st.className = 'hint status-err';
      }
      btn.disabled = false;
    });

    page.querySelector('#data-export').addEventListener('click', exportAll);
    page.querySelector('#data-import').addEventListener('click', importAll);
    page.querySelector('#data-clear').addEventListener('click', async () => {
      if (!(await dialog({ title: '清空所有对话？', message: '所有对话和附件都会从这台设备上删除，无法恢复。建议先导出备份。', ok: '全部清空', danger: true }))) return;
      for (const c of state.convs) c.deleted = true;
      UI.store = {};
      store('glm.uistore', {});
      if (state.job) state.job.ctrl.abort();
      await DB.clear('convs');
      await DB.clear('blobs');
      blobCache.clear();
      state.convs = [];
      openConv(null);
      toast('已清空');
    });
  }

  async function exportAll() {
    toast('正在打包…', 1500);
    try {
      const convs = await DB.all('convs');
      const blobs = await DB.all('blobs');
      const data = { app: 'glm-chat', version: 1, exportedAt: new Date().toISOString(), convs, blobs, memory: Memory.list() };
      offerFile('GLM备份-' + dayKey() + '.json', JSON.stringify(data), 'application/json');
    } catch (e) {
      toast('导出失败：' + (e.message || e) + '。对话太多时可以先删除一些带大附件的对话。', 4500);
    }
  }

  function importAll() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async () => {
      const f = input.files[0];
      if (!f) return;
      try {
        const data = JSON.parse(await f.text());
        if (data.app !== 'glm-chat' || !Array.isArray(data.convs)) throw new Error('不是本应用导出的备份文件');
        let n = 0;
        for (const b of data.blobs || []) if (b && b.id) await DB.put('blobs', b);
        if (Array.isArray(data.memory) && data.memory.length) {
          const have = new Set(Memory.list().map((m) => m.text));
          for (const m of data.memory) if (m && m.text && !have.has(m.text)) Memory.add(m.text);
        }
        for (const c of data.convs) {
          if (!c || !c.id || !Array.isArray(c.messages)) continue;
          const mine = state.convs.find((x) => x.id === c.id);
          if (mine && mine.updatedAt >= c.updatedAt) continue;
          await DB.put('convs', c);
          if (mine) Object.assign(mine, c); else state.convs.push(c);
          n++;
        }
        sortConvs();
        renderSidebar();
        toast('已导入 ' + n + ' 个对话');
      } catch (e) {
        toast('导入失败：' + e.message, 3500);
      }
    };
    input.click();
  }

  // ───────────────────────── events ─────────────────────────
  function wire() {
    $('#btn-side').innerHTML = I.menu;
    $('#btn-new').innerHTML = I.newChat;
    $('#side-close').innerHTML = I.chevL;
    $('.brand-mark').innerHTML = I.spark;
    $('.ic-new').innerHTML = I.plus;
    $('.ic-search').innerHTML = I.search;
    $('.ic-gear').innerHTML = I.gear;
    $('.ic-chev').innerHTML = I.chevD;
    $('#btn-attach').innerHTML = I.plus;
    D.chipCode.innerHTML = I.sigma + '<span class="lbl">计算</span>';
    D.chipSearch.innerHTML = I.globe + '<span class="lbl">联网</span>';
    D.jump.innerHTML = I.down;

    $('#btn-side').addEventListener('click', () => { if (wide()) D.app.classList.remove('side-hidden'); else openSide(); });
    $('#side-close').addEventListener('click', () => { if (wide()) D.app.classList.add('side-hidden'); else closeSide(); });
    $('#scrim').addEventListener('click', closeSide);
    $('#btn-new').addEventListener('click', newChat);
    $('#side-new').addEventListener('click', newChat);
    $('#side-settings').addEventListener('click', () => { if (!wide()) closeSide(); openSettings(); });
    D.titleBtn.addEventListener('click', () => { if (state.cur && state.cur.messages.length) convMenu(state.cur); });
    D.jump.addEventListener('click', () => { D.scroller.scrollTo({ top: D.scroller.scrollHeight, behavior: 'smooth' }); stick = true; });
    D.q.addEventListener('input', () => { state.query = D.q.value; renderSidebar(); });

    D.list.addEventListener('click', (e) => {
      const more = e.target.closest('[data-more]');
      if (more) { const c = state.convs.find((x) => x.id === more.dataset.more); if (c) convMenu(c); return; }
      const item = e.target.closest('.conv-item');
      if (item) { const c = state.convs.find((x) => x.id === item.dataset.id); if (c) openConv(c); }
    });

    // composer
    D.input.addEventListener('input', () => { autosize(); updateComposer(); saveDraft(); });
    D.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229 && !isTouch) { e.preventDefault(); send(); }
    });
    D.input.addEventListener('paste', (e) => {
      const files = [...((e.clipboardData && e.clipboardData.files) || [])];
      if (files.length) { e.preventDefault(); addFiles(files); }
    });
    D.send.addEventListener('click', () => {
      if (state.job && state.job.conv === state.cur) state.job.ctrl.abort();
      else send();
    });
    $('#btn-attach').addEventListener('click', () => D.fileIn.click());
    D.fileIn.addEventListener('change', () => { const files = [...D.fileIn.files]; D.fileIn.value = ''; addFiles(files); });
    D.atts.addEventListener('click', (e) => {
      const rm = e.target.closest('[data-rm]');
      if (rm) { state.atts = state.atts.filter((a) => a.id !== rm.dataset.rm); renderAtts(); }
    });
    D.chipCode.addEventListener('click', () => {
      S.toolCode = !S.toolCode;
      saveS();
      updateComposer();
      toast(S.toolCode ? '已开启代码计算：GLM 会用 Python 精确计算' : '已关闭代码计算');
    });
    D.chipSearch.addEventListener('click', () => {
      S.toolSearch = !S.toolSearch;
      saveS();
      updateComposer();
      toast(S.toolSearch ? '已开启联网搜索' : '已关闭联网搜索');
    });
    D.chipEffort.addEventListener('click', async () => {
      const k = await sheet({
        title: '思考强度',
        items: [
          { key: 'low', label: '低', desc: '几乎不思考，回答最快', selected: S.effort === 'low' },
          { key: 'high', label: '高', desc: '适合大多数问题', selected: S.effort === 'high' },
          { key: 'max', label: '最大', desc: '最认真，适合数学、推理和编程（官方推荐）', selected: S.effort === 'max' },
        ],
      });
      if (k) { S.effort = k; saveS(); updateComposer(); }
    });

    // drag & drop (iPad / desktop)
    const main = $('#main');
    main.addEventListener('dragover', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
    main.addEventListener('drop', (e) => {
      const files = [...((e.dataTransfer && e.dataTransfer.files) || [])];
      if (files.length) { e.preventDefault(); addFiles(files); }
    });

    // thread actions
    D.thread.addEventListener('click', async (e) => {
      const codeCopy = e.target.closest('.code-copy');
      if (codeCopy) {
        copyText(codeCopy.closest('.code-block').querySelector('code').textContent);
        const span = codeCopy.querySelector('span');
        span.textContent = '已复制';
        setTimeout(() => { span.textContent = '复制'; }, 1500);
        return;
      }
      const t = e.target.closest('[data-act]');
      if (!t || t.disabled) return;
      const act = t.dataset.act;
      if (act === 'sug') {
        const s = SUGGEST[Number(t.dataset.i)];
        D.input.value = s.text;
        autosize();
        updateComposer();
        if (s.pick) D.fileIn.click(); else { D.input.focus(); D.input.setSelectionRange(s.text.length, s.text.length); }
        return;
      }
      if (act === 'zoom') { viewImage(t.src); return; }
      if (act === 'ui-full' || act === 'ui-more' || act === 'ui-fix') {
        const msgEl1 = t.closest('.msg');
        const m1 = msgEl1 && findMsg(msgEl1.dataset.id);
        const blockEl = t.closest('.ui-block');
        const b1 = m1 && blockEl && cur(m1).blocks.find((x) => x.type === 'ui' && x.id === blockEl.dataset.uiBlock);
        if (!b1) return;
        if (act === 'ui-full') UI.openFull(b1, m1);
        else if (act === 'ui-more') UI.menu(b1, m1, UI.recOf(t));
        else { const rec = UI.recOf(t); if (rec) UI.fix(rec); }
        return;
      }
      if (act === 'open-conv') { const c = state.convs.find((x) => x.id === t.dataset.conv); if (c) openConv(c); else toast('这个对话已经不存在了'); return; }
      if (act === 'file') {
        const msgEl0 = t.closest('.msg');
        const m0 = msgEl0 && findMsg(msgEl0.dataset.id);
        const f = m0 && cur(m0).blocks.flatMap((x) => x.files || []).find((x) => x.id === t.dataset.file);
        if (!f) { toast('文件已丢失'); return; }
        if (blobCache.has(f.id)) { shareFile(f.name, dataUrlBytes(blobCache.get(f.id)), f.mime); return; }
        const data = await Blobs.get(f.id);
        if (!data) { toast('文件已丢失'); return; }
        offerFile(f.name, dataUrlBytes(data), f.mime);
        return;
      }
      const msgEl = t.closest('.msg');
      const m = msgEl && findMsg(msgEl.dataset.id);
      if (!m) return;
      switch (act) {
        case 'toggle': {
          const blockEl = t.closest('[data-bi]');
          const b = blockEl && cur(m).blocks[Number(blockEl.dataset.bi)];
          if (b) { b.open = !b.open; paintAI(m); if (!state.job || state.job.msg !== m) saveSoon(state.cur); }
          break;
        }
        case 'copy': {
          copyText(m.role === 'user' ? m.text : allText(cur(m)));
          t.innerHTML = I.check;
          setTimeout(() => { t.innerHTML = I.copy; }, 1500);
          break;
        }
        case 'retry': regenerate(m); break;
        case 'speak': speak(m); break;
        case 'share': navigator.share({ text: allText(cur(m)) }).catch(() => {}); break;
        case 'prev': case 'next': {
          m.vi = Math.max(0, Math.min(m.vs.length - 1, m.vi + (act === 'next' ? 1 : -1)));
          paintAI(m);
          saveConv(state.cur);
          break;
        }
        case 'edit': {
          state.editing = m.id;
          rerenderMsg(m);
          const ta = D.thread.querySelector('.msg[data-id="' + m.id + '"] textarea');
          if (ta) { ta.style.height = Math.min(ta.scrollHeight + 4, window.innerHeight * 0.4) + 'px'; ta.focus(); }
          break;
        }
        case 'edit-cancel': state.editing = null; rerenderMsg(m); break;
        case 'edit-save': {
          if (state.job) { toast('请等当前回答完成'); break; }
          const ta = msgEl.querySelector('textarea');
          submitEdit(m, ta.value);
          break;
        }
        case 'user-tap': msgEl.classList.toggle('show-actions'); break;
        case 'expand': { e.stopPropagation(); const bub = t.closest('.u-bubble'); bub.classList.remove('clamp'); t.remove(); break; }
        case 'view-att': {
          const a = (m.atts || []).find((x) => x.id === t.dataset.att);
          if (!a) break;
          if (a.kind === 'image') { const data = await Blobs.get(a.id); viewImage(data || a.thumb); }
          break;
        }
      }
    });

    // swipe from the left edge opens the drawer; swipe left closes it
    let sx = null, sy = 0;
    D.app.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) { sx = null; return; }
      sx = e.touches[0].clientX;
      sy = e.touches[0].clientY;
    }, { passive: true });
    D.app.addEventListener('touchend', (e) => {
      if (sx == null || wide()) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - sx, dy = t.clientY - sy;
      const open = D.app.classList.contains('side-open');
      if (!open && sx < 30 && dx > 60 && Math.abs(dy) < 60) openSide();
      else if (open && dx < -60 && Math.abs(dy) < 60) closeSide();
      sx = null;
    }, { passive: true });

    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyAppearance);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && state.cur) saveConv(state.cur);
    });
  }

  function showBanner() {
    let html = '';
    if (inWeChat) {
      html = '<div class="banner"><span>' + I.alert + '</span><div>微信里无法安装和正常使用本应用。请点右上角 <b>···</b>，选择 <b>在默认浏览器中打开</b>（Safari）。</div></div>';
    } else if (isIOS && !isStandalone && !S.tipClosed) {
      html = '<div class="banner"><span>' + I.share + '</span><div>安装到主屏幕：点 Safari 底部的 <b>分享</b> 按钮，选择 <b>添加到主屏幕</b>。之后像普通 App 一样从桌面打开，体验更好。</div><button class="x" aria-label="关闭">' + I.close + '</button></div>';
    }
    D.banner.innerHTML = html;
    const x = D.banner.querySelector('.x');
    if (x) x.addEventListener('click', () => { S.tipClosed = true; saveS(); D.banner.innerHTML = ''; });
  }

  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return;
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js').catch(() => {});
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController) return;
      toast('新版本已就绪，点这里刷新', 8000, () => { if (!state.job) location.reload(); });
    });
  }

  // ───────────────────────── start ─────────────────────────
  async function start() {
    applyAppearance();
    wire();
    setupViewport();
    await DB.open();
    if (!DB.db) toast('无法使用本地存储，对话不会被保存', 4000);
    try {
      state.convs = (await DB.all('convs')) || [];
    } catch (e) {
      state.convs = [];
    }
    // answers that were interrupted when the app was closed
    for (const c of state.convs) for (const m of c.messages) if (m.role === 'assistant') for (const v of m.vs) if (v.status === 'streaming') v.status = 'stopped';
    sortConvs();
    const last = load('glm.last', null);
    const recent = last && last.id && Date.now() - last.at < 30 * 60000 ? state.convs.find((c) => c.id === last.id) : null;
    state.cur = recent || null;
    renderSidebar();
    renderThread();
    restoreDraft();
    showBanner();
    updateComposer();
    requestAnimationFrame(() => scrollToBottom(true));
    if (wide()) D.app.classList.remove('side-open');
    registerSW();
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  }

  start();
})();
