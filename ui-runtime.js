/* ui-runtime.js — runs first inside every generated interface (a sandboxed iframe with an opaque origin).
 * It is inlined into the iframe's srcdoc and allowed by its hash in the app's Content-Security-Policy;
 * tools/csp_hash.py writes that hash into index.html, so run it after changing this file.
 * It mounts the model's HTML, runs its scripts (as blob: scripts, since inline ones are not allowed),
 * renders LaTeX, and gives the interface a small API (window.glm) that talks to the app through postMessage. */
(function () {
  'use strict';
  var data = JSON.parse(document.getElementById('glm-data').textContent);
  var seq = 0;
  var pending = {};
  function post(m) {
    m.__glm = data.id;
    parent.postMessage(m, '*');
  }
  function call(type, payload) {
    return new Promise(function (resolve, reject) {
      var rid = ++seq;
      pending[rid] = { resolve: resolve, reject: reject };
      payload.type = type;
      payload.rid = rid;
      post(payload);
    });
  }

  // No peer-to-peer connections: they could reach outside without passing the app.
  ['RTCPeerConnection', 'webkitRTCPeerConnection', 'RTCDataChannel'].forEach(function (name) {
    try { Object.defineProperty(window, name, { value: undefined, configurable: false, writable: false }); } catch (e) { /* ignore */ }
  });

  // localStorage works and is kept on the phone (the real one is unavailable in a sandboxed frame).
  function makeStorage(initial, persist) {
    var map = {};
    Object.keys(initial || {}).forEach(function (k) { map[k] = String(initial[k]); });
    var api = {
      getItem: function (k) { k = String(k); return Object.prototype.hasOwnProperty.call(map, k) ? map[k] : null; },
      setItem: function (k, v) { k = String(k); v = String(v); map[k] = v; if (persist) post({ type: 'store', key: k, value: v }); },
      removeItem: function (k) { k = String(k); delete map[k]; if (persist) post({ type: 'store', key: k, value: null }); },
      clear: function () { map = {}; if (persist) post({ type: 'store-clear' }); },
      key: function (i) { return Object.keys(map)[i] || null; },
    };
    Object.defineProperty(api, 'length', { get: function () { return Object.keys(map).length; } });
    return api;
  }
  var local = makeStorage(data.store, true);
  try { Object.defineProperty(window, 'localStorage', { value: local, configurable: true }); } catch (e) { /* ignore */ }
  try { Object.defineProperty(window, 'sessionStorage', { value: makeStorage({}, false), configurable: true }); } catch (e) { /* ignore */ }

  function toBase64(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }

  var themeListeners = [];
  var glm = {
    /** Send text to the conversation as the user's next message. */
    send: function (text) { post({ type: 'send', text: String(text == null ? '' : text).slice(0, 4000) }); },
    /** Ask the AI from inside the interface; resolves with its reply text. */
    ask: function (prompt, opts) { return call('ask', { prompt: String(prompt == null ? '' : prompt), opts: opts || {} }); },
    /** Multi-turn: messages = [{role: 'user'|'assistant', content}]. */
    chat: function (messages, opts) { return call('ask', { messages: messages || [], opts: opts || {} }); },
    copy: function (text) {
      text = String(text == null ? '' : text);
      var fallback = function () { post({ type: 'copy', text: text }); };
      try { navigator.clipboard.writeText(text).then(function () { post({ type: 'copied' }); }, fallback); } catch (e) { fallback(); }
    },
    /** Save a file: content may be text, an object (saved as JSON), a Blob, an ArrayBuffer / typed array, or a canvas. */
    download: function (name, content, mime) {
      name = String(name || 'file.txt');
      var send = function (payload) { payload.type = 'download'; payload.name = name; payload.mime = mime || ''; post(payload); };
      if (content && typeof content.toDataURL === 'function') { send({ data: content.toDataURL('image/png').split(',')[1], encoding: 'base64', mime: 'image/png' }); return; }
      if (typeof Blob !== 'undefined' && content instanceof Blob) {
        content.arrayBuffer().then(function (buf) { send({ data: toBase64(new Uint8Array(buf)), encoding: 'base64', mime: mime || content.type }); });
        return;
      }
      if (content instanceof ArrayBuffer || ArrayBuffer.isView(content)) {
        var u8 = content instanceof ArrayBuffer ? new Uint8Array(content) : new Uint8Array(content.buffer, content.byteOffset, content.byteLength);
        send({ data: toBase64(u8), encoding: 'base64' });
        return;
      }
      send({ data: typeof content === 'string' ? content : JSON.stringify(content, null, 2), encoding: 'text' });
    },
    openLink: function (url) { post({ type: 'open', url: String(url || '') }); },
    storage: local,
    get theme() { return document.documentElement.getAttribute('data-theme') || 'light'; },
    onTheme: function (fn) { if (typeof fn === 'function') themeListeners.push(fn); },
    /** Resolved value of a design-system color, e.g. glm.color('--accent'), for charts. */
    color: function (name) { return getComputedStyle(document.documentElement).getPropertyValue(name.indexOf('--') === 0 ? name : '--' + name).trim(); },
  };
  window.glm = glm;
  window.sendPrompt = glm.send;

  window.addEventListener('message', function (e) {
    if (e.source !== parent) return;
    var m = e.data || {};
    if (m.type === 'reply' && pending[m.rid]) {
      var p = pending[m.rid];
      delete pending[m.rid];
      if (m.error) p.reject(new Error(m.error)); else p.resolve(m.text);
    } else if (m.type === 'theme') {
      document.documentElement.setAttribute('data-theme', m.theme);
      themeListeners.forEach(function (fn) { try { fn(m.theme); } catch (err) { /* ignore */ } });
    }
  });

  var reported = 0;
  function report(msg) { if (reported++ < 3) post({ type: 'error', message: String(msg || '未知错误').slice(0, 300) }); }
  window.addEventListener('error', function (e) {
    if (e.message) report(e.message + (e.lineno ? '（第 ' + e.lineno + ' 行）' : ''));
  });
  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason;
    report((r && (r.message || r)) || 'Promise 被拒绝');
  });

  // Links go through the app (which asks before opening); forms never navigate.
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    var href = a.getAttribute('href') || '';
    if (href.charAt(0) === '#') return;
    e.preventDefault();
    if (/^https?:\/\//i.test(href)) glm.openLink(href);
  }, true);
  document.addEventListener('submit', function (e) { e.preventDefault(); }, true);

  // Inline handlers (onclick="…") are blocked by the CSP: turn them into listeners, now and later.
  var HANDLERS = ['onclick', 'ondblclick', 'oninput', 'onchange', 'onsubmit', 'onkeydown', 'onkeyup', 'onkeypress', 'onfocus', 'onblur',
    'onmousedown', 'onmouseup', 'onmouseover', 'onmouseout', 'onmousemove', 'onpointerdown', 'onpointerup', 'onpointermove',
    'ontouchstart', 'ontouchend', 'ontouchmove', 'onload', 'onerror', 'onwheel', 'oncontextmenu', 'ondragstart', 'ondragover', 'ondrop'];
  function convertHandlers(root) {
    var els = root.querySelectorAll ? root.querySelectorAll('*') : [];
    var list = root.attributes ? [root].concat(Array.prototype.slice.call(els)) : Array.prototype.slice.call(els);
    list.forEach(function (el) {
      Array.prototype.slice.call(el.attributes || []).forEach(function (at) {
        if (!/^on[a-z]+$/i.test(at.name)) return;
        var code = at.value;
        el.removeAttribute(at.name);
        var fn;
        try { fn = new Function('event', code); } catch (err) { report(err.message); return; }
        el.addEventListener(at.name.slice(2).toLowerCase(), function (event) {
          if (fn.call(el, event) === false) event.preventDefault();
        });
      });
    });
  }
  // Resource hints would reach outside the sandbox's network rules (DNS lookups, early connections).
  function dropHints(root) {
    var links = root.querySelectorAll ? root.querySelectorAll('link[rel]') : [];
    Array.prototype.forEach.call(links, function (l) { if (/(pre|dns-)/i.test(l.getAttribute('rel') || '')) l.remove(); });
    if (root.tagName === 'LINK' && /(pre|dns-)/i.test(root.getAttribute('rel') || '')) root.remove();
  }

  // LaTeX written in the interface's text ($…$, $$…$$, \(…\), \[…\]) is rendered with KaTeX, loaded on demand.
  var KATEX = [
    'https://registry.npmmirror.com/katex/0.16.11/files/dist/',
    'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/',
  ];
  var KATEX_SRI = {
    js: 'sha384-7zkQWkzuo3B5mTepMUcHkMB5jZaolc2xDwL6VFqjFALcbeS9Ggm/Yr2r3Dy4lfFg',
    css: 'sha384-nB0miv6/jRmo5UMMR1wu3Gz6NLsoTkbqJghGIsx//Rlm+ZU03BU6SQNC66uf4l5+',
  };
  var MATH = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|\$([^\s$](?:[^$\n]*?[^\s$\\])?)\$(?![\d$])/g;
  var katexState = 0; // 0 not loaded, 1 loading, 2 ready, 3 failed
  function loadKatex(i) {
    i = i || 0;
    if (i >= KATEX.length) { katexState = 3; return; }
    katexState = 1;
    var css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = KATEX[i] + 'katex.min.css'; css.integrity = KATEX_SRI.css; css.crossOrigin = 'anonymous';
    var js = document.createElement('script');
    js.src = KATEX[i] + 'katex.min.js'; js.integrity = KATEX_SRI.js; js.crossOrigin = 'anonymous';
    js.onload = function () { katexState = 2; renderMath(document.body); };
    js.onerror = function () { css.remove(); js.remove(); loadKatex(i + 1); };
    document.head.appendChild(css);
    document.head.appendChild(js);
  }
  function mathNodes(root) {
    var out = [];
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        var p = n.parentNode;
        if (!p || /^(SCRIPT|STYLE|TEXTAREA|CODE|PRE|OPTION|TITLE|SVG|CANVAS)$/i.test(p.nodeName)) return NodeFilter.FILTER_REJECT;
        if (p.closest && p.closest('.katex, [data-no-math], [contenteditable]')) return NodeFilter.FILTER_REJECT;
        MATH.lastIndex = 0;
        return MATH.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      },
    });
    while (walker.nextNode()) out.push(walker.currentNode);
    return out;
  }
  function renderMath(root) {
    if (!root || katexState === 3) return;
    var nodes = mathNodes(root);
    if (!nodes.length) return;
    if (katexState !== 2) { if (katexState === 0) loadKatex(0); return; }
    nodes.forEach(function (n) {
      var text = n.nodeValue, frag = document.createDocumentFragment(), last = 0, m;
      MATH.lastIndex = 0;
      while ((m = MATH.exec(text))) {
        var tex = m[1] || m[2] || m[3] || m[4];
        var display = !!(m[1] || m[2]);
        if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
        var span = document.createElement('span');
        try { window.katex.render(tex, span, { displayMode: display, throwOnError: false, strict: 'ignore' }); } catch (err) { span.textContent = m[0]; }
        frag.appendChild(span);
        last = MATH.lastIndex;
      }
      if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
      if (n.parentNode) n.parentNode.replaceChild(frag, n);
    });
    size();
  }
  glm.renderMath = function (el) { renderMath(el || document.body); };
  var mathQueued = false;
  function mathSoon() {
    if (mathQueued) return;
    mathQueued = true;
    requestAnimationFrame(function () { mathQueued = false; renderMath(document.body); });
  }

  // Height reported to the app: what the content takes, so the frame can also shrink.
  // Layouts sized by vh grow with the frame itself; a run of small growth steps is treated as that loop and stopped.
  var lastH = 0, creep = 0, lastGrow = 0;
  function size() {
    if (!document.body) return;
    var cs = getComputedStyle(document.body);
    var h = Math.ceil(document.body.getBoundingClientRect().height + parseFloat(cs.marginTop) + parseFloat(cs.marginBottom));
    if (h === lastH) return;
    var now = Date.now();
    if (h > lastH && h - lastH <= 40 && now - lastGrow < 600) { if (++creep > 6) return; } else creep = 0;
    if (h > lastH) lastGrow = now;
    lastH = h;
    post({ type: 'size', h: h });
  }

  function mount() {
    var doc = new DOMParser().parseFromString(data.html, 'text/html');
    if (doc.title) document.title = doc.title;
    var nodes = Array.prototype.slice.call(doc.head.childNodes).concat(Array.prototype.slice.call(doc.body.childNodes));
    nodes.forEach(function (n) {
      if (n.nodeType === 1 && /^(META|TITLE|BASE)$/.test(n.tagName)) return;
      document.body.appendChild(document.importNode(n, true));
    });
    dropHints(document.body);
    convertHandlers(document.body);
    new MutationObserver(function (records) {
      records.forEach(function (r) {
        if (r.type === 'attributes') convertHandlers(r.target);
        Array.prototype.forEach.call(r.addedNodes || [], function (n) { if (n.nodeType === 1) { dropHints(n); convertHandlers(n); } });
      });
      mathSoon();
      size();
    }).observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: HANDLERS });

    // Scripts imported from the parsed document do not run: recreate them, in order, as blob: or CDN scripts.
    var scripts = Array.prototype.slice.call(document.body.querySelectorAll('script'));
    scripts.forEach(function (old) {
      var type = (old.getAttribute('type') || '').trim().toLowerCase();
      if (type && !/^(text\/javascript|application\/javascript|module)$/.test(type)) return;
      var s = document.createElement('script');
      Array.prototype.slice.call(old.attributes).forEach(function (at) { if (at.name !== 'src') s.setAttribute(at.name, at.value); });
      if (old.src) s.src = old.src;
      else s.src = URL.createObjectURL(new Blob([old.textContent], { type: 'text/javascript' }));
      s.async = false;
      s.onerror = function () { if (old.src) report('无法加载脚本：' + old.src); };
      old.parentNode.replaceChild(s, old);
    });
    // After the interface's own scripts: replay the events they may be waiting for.
    var done = document.createElement('script');
    done.async = false;
    done.src = URL.createObjectURL(new Blob(['window.__glmReady && window.__glmReady()'], { type: 'text/javascript' }));
    window.__glmReady = function () {
      delete window.__glmReady;
      document.dispatchEvent(new Event('DOMContentLoaded', { bubbles: true }));
      if (document.readyState === 'complete') window.dispatchEvent(new Event('load'));
      renderMath(document.body);
      size();
      setTimeout(size, 300);
      setTimeout(size, 1200);
    };
    document.body.appendChild(done);

    if (window.ResizeObserver) new ResizeObserver(size).observe(document.body);
    window.addEventListener('load', size);
    size();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
})();
