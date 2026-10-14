/* sandbox.js — runs the code GLM writes (Python through Pyodide, or JavaScript) in a Web Worker.
 *
 * app.js starts this file from a blob: URL, so the worker inherits the page's Content-Security-Policy.
 * Before any code runs, storage and network APIs are taken out of the worker: the code cannot read the
 * chats, the settings or the API key, and cannot send anything anywhere. The only network access left
 * is the loader below. It fetches the pinned Pyodide files from the app's own site (www/pyodide/), falling
 * back to mirrors reachable from mainland China (npmmirror, PyPI) and jsdelivr, checks every file against a
 * known hash, and keeps it in CacheStorage, so Python also works offline after the first download.
 */
'use strict';
(() => {
  const PY_VERSION = '0.29.5';
  // Pyodide is told this index; every fetch under it is answered by the loader below.
  const INDEX_URL = 'https://cdn.jsdelivr.net/pyodide/v0.29.5/full/';
  const CDN_BASES = [
    'https://cdn.jsdelivr.net/pyodide/v0.29.5/full/',
    'https://fastly.jsdelivr.net/pyodide/v0.29.5/full/',
    'https://gcore.jsdelivr.net/pyodide/v0.29.5/full/',
  ];
  // The npm package holds all core files in one 5.6 MB archive; npmmirror serves it fast inside China.
  const NPM_TGZ = 'https://registry.npmmirror.com/pyodide/-/pyodide-0.29.5.tgz';
  const CORE = {
    'pyodide.js': 'sha384-VR47TfKeAmT7vMej7bwOVg0tHTQLLGMSIpsXtFMCZG5OpKZSIXoSLtGY//qHcxc6',
    'pyodide.asm.js': 'sha384-8mBRd9rjeP9blbPmWuCum2qq484+GPVFDSaebLOh+ryUrQZz9SJ4v2dh4STKX9Jo',
    'pyodide.asm.wasm': 'sha384-8LoW84uYNGn2avpfQNVvzVXqylKrFwJgbBNJ87g6D5Ud+8bzAJzOV38jQkOpVBq7',
    'python_stdlib.zip': 'sha384-qFTVfVvRHvt1V/9yXR9tJ0uAKF7men+qhxh13+YPQPYWYMAq4dKaaL6N+/DIo4gR',
    'pyodide-lock.json': 'sha384-xDHcZeNLjl7+brzrlYDRbrxe3I9kROtVuWNljcqvsUtLl47M+jg2UGQ13S7KV5Xc',
  };
  // Pure-Python wheels also published on PyPI (different build, so PyPI's own hash).
  const PYPI = {
    'sympy-1.13.3-py3-none-any.whl': ['https://files.pythonhosted.org/packages/99/ff/c87e0622b1dadea79d2fb0b25ade9ed98954c9033722eb707053d310d4f3/sympy-1.13.3-py3-none-any.whl', 'sha256-VGEs9VpidV7nGCTOaSmG8jyI/6dyB7MME2jtpKcGD3M='],
    'mpmath-1.3.0-py3-none-any.whl': ['https://files.pythonhosted.org/packages/43/e3/7d92a15f894aa0c9c4b49b8ee9ac9850d6e63b03c9c32c0367a13ae62209/mpmath-1.3.0-py3-none-any.whl', 'sha256-oLK5/oC7zYGmZH/xMQhzjPtILUgdgmzA4C9bNeXIjSw='],
  };
  // Pure-Python packages that Pyodide does not ship, installed from PyPI when the code needs them.
  const EXTRA_WHEELS = {
    et_xmlfile: ['et_xmlfile-2.0.0-py3-none-any.whl', 'https://files.pythonhosted.org/packages/c1/8b/5fe2cc11fee489817272089c4203e679c63b570a5aaeb18d852ae3cbba6a/et_xmlfile-2.0.0-py3-none-any.whl', 'sha256-epFyC8dWhDUCw7dQTHe4/kQhfIXFN9hQN/D1NhUbLKo='],
    openpyxl: ['openpyxl-3.1.5-py2.py3-none-any.whl', 'https://files.pythonhosted.org/packages/c0/da/977ded879c29cbd04de313843e76868e6e13408a94ed6b987245dc7c8506/openpyxl-3.1.5-py2.py3-none-any.whl', 'sha256-UoLBKxB7/+74JfRhfcApr69B0Opggju7Zl7zB53HneI='],
    xlsxwriter: ['xlsxwriter-3.2.9-py3-none-any.whl', 'https://files.pythonhosted.org/packages/3a/0c/3662f4a66880196a590b202f0db82d919dd2f89e99a27fadef91c4a33d41/xlsxwriter-3.2.9-py3-none-any.whl', 'sha256-ml20K8Xf8BSAbFiiC56ucyKhNKu2/OPJLBgb+ydexbM='],
    python_docx: ['python_docx-1.2.0-py3-none-any.whl', 'https://files.pythonhosted.org/packages/d0/00/1e03a4989fa5795da308cd774f05b704ace555a70f9bf9d3be057b680bcf/python_docx-1.2.0-py3-none-any.whl', 'sha256-P9R48yUPu7/TuU/h6YWVVzfBRWJ0mIlqimv4H0uvZsc='],
  };
  // [what in the code needs them, wheels, Pyodide packages they depend on]
  const EXTRA_NEEDS = [
    [/\b(?:import|from)\s+openpyxl\b|\bread_excel\b|\.to_excel\b|\bExcelWriter\b/, ['et_xmlfile', 'openpyxl'], []],
    [/\b(?:import|from)\s+xlsxwriter\b|['"]xlsxwriter['"]/, ['xlsxwriter'], []],
    [/\b(?:import|from)\s+docx\b/, ['python_docx'], ['lxml', 'typing-extensions']],
  ];
  const CACHE_NAME = 'pyodide-' + PY_VERSION;
  const MIME = { wasm: 'application/wasm', js: 'text/javascript', json: 'application/json' };

  // ── take what the loader needs, then lock the worker down ──
  const native = {
    fetch: self.fetch.bind(self),
    caches: self.caches,
    post: self.postMessage.bind(self),
  };
  const preloaded = new Map(); // script URL -> source, served by the importScripts stand-in
  const BLOCKED = ['fetch', 'importScripts', 'XMLHttpRequest', 'WebSocket', 'WebSocketStream', 'EventSource',
    'WebTransport', 'BroadcastChannel', 'Worker', 'SharedWorker', 'indexedDB', 'caches', 'RTCPeerConnection'];
  for (const name of BLOCKED) {
    for (let o = self; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) {
      if (Object.prototype.hasOwnProperty.call(o, name)) { try { delete o[name]; } catch (e) { /* keep going */ } }
    }
  }
  const pin = (name, value) => {
    try { Object.defineProperty(self, name, { value, writable: false, configurable: false, enumerable: false }); } catch (e) { /* ignore */ }
  };
  pin('fetch', loaderFetch);
  pin('importScripts', function importScripts(...urls) {
    for (const u of urls) {
      const src = preloaded.get(String(u));
      if (src === undefined) throw new Error('importScripts is disabled in the sandbox');
      preloaded.delete(String(u));
      (0, eval)(src);
    }
  });
  for (const name of BLOCKED) if (!(name in self)) pin(name, undefined);
  // navigator.sendBeacon can also post data anywhere: take it away too.
  for (let o = self.navigator; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) {
    if (Object.prototype.hasOwnProperty.call(o, 'sendBeacon')) { try { delete o.sendBeacon; } catch (e) { /* keep going */ } }
  }
  try { Object.defineProperty(self.navigator, 'sendBeacon', { value: () => false, writable: false, configurable: false }); } catch (e) { /* ignore */ }

  let appBase = ''; // absolute URL of the app folder; self-hosted files may sit in <appBase>pyodide/
  let progress = () => {};
  const post = (m, transfer) => native.post(m, transfer || []);

  // ── loader ──
  const parseSri = (sri) => {
    const i = sri.indexOf('-');
    const alg = sri.slice(0, i);
    return { alg: alg === 'sha384' ? 'SHA-384' : alg === 'sha512' ? 'SHA-512' : 'SHA-256', b64: sri.slice(i + 1) };
  };
  async function verify(buf, sri) {
    const want = parseSri(sri);
    const h = new Uint8Array(await crypto.subtle.digest(want.alg, buf));
    let s = '';
    for (const b of h) s += String.fromCharCode(b);
    return btoa(s) === want.b64;
  }
  const mimeOf = (name) => MIME[name.split('.').pop()] || 'application/octet-stream';
  const mb = (n) => (n / 1048576).toFixed(1) + ' MB';

  async function cacheGet(url) {
    try { return await (await native.caches.open(CACHE_NAME)).match(url); } catch (e) { return undefined; }
  }
  async function cachePut(url, buf, name) {
    const res = new Response(buf, { headers: { 'Content-Type': mimeOf(name) } });
    try { await (await native.caches.open(CACHE_NAME)).put(url, res.clone()); } catch (e) { /* storage full: still usable now */ }
    return res;
  }

  /** Download with progress; gives up when nothing arrives for a while (blocked or stalled mirror). */
  async function download(url, label) {
    const ctrl = new AbortController();
    let timer = setTimeout(() => ctrl.abort(), 12000);
    const kick = () => { clearTimeout(timer); timer = setTimeout(() => ctrl.abort(), 20000); };
    try {
      const res = await native.fetch(url, { signal: ctrl.signal, credentials: 'omit', cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      kick();
      const total = Number(res.headers.get('Content-Length')) || 0;
      const reader = res.body.getReader();
      const chunks = [];
      let got = 0, last = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        got += value.length;
        kick();
        const now = Date.now();
        if (now - last > 250) {
          last = now;
          progress('下载' + label + '  ' + mb(got) + (total > got ? ' / ' + mb(total) : ''));
        }
      }
      const buf = new Uint8Array(got);
      let off = 0;
      for (const c of chunks) { buf.set(c, off); off += c.length; }
      return buf;
    } finally {
      clearTimeout(timer);
    }
  }

  async function gunzip(u8) {
    const stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  function* untar(u8) {
    const dec = new TextDecoder();
    const str = (a, b) => dec.decode(u8.subarray(a, b)).replace(/\0[\s\S]*$/, '');
    let off = 0;
    while (off + 512 <= u8.length) {
      if (u8[off] === 0) break;
      let name = str(off, off + 100);
      const prefix = str(off + 345, off + 500);
      if (prefix) name = prefix + '/' + name;
      const size = parseInt(str(off + 124, off + 136).trim() || '0', 8) || 0;
      const type = u8[off + 156];
      off += 512;
      if (type === 48 || type === 0) yield [name, u8.slice(off, off + size)];
      off += Math.ceil(size / 512) * 512;
    }
  }

  let tgzJob = null;
  function coreFromTarball() {
    if (!tgzJob) {
      tgzJob = (async () => {
        const tar = await gunzip(await download(NPM_TGZ, ' Python 环境'));
        for (const [path, data] of untar(tar)) {
          const name = path.replace(/^package\//, '');
          if (CORE[name] && (await verify(data, CORE[name]))) await cachePut(INDEX_URL + name, data, name);
        }
      })().catch((e) => { tgzJob = null; throw e; });
    }
    return tgzJob;
  }

  const inflight = new Map();
  /** One Pyodide file, by name: from the cache, else from the first mirror that delivers it intact. */
  function getFile(name, sri, only) {
    if (!inflight.has(name)) {
      const job = (async () => {
        const url = INDEX_URL + name;
        const hit = await cacheGet(url);
        if (hit) return hit;
        const sources = [];
        if (appBase) sources.push({ url: appBase + 'pyodide/' + name, sri });
        if (only) sources.push(only);
        else {
          if (CORE[name]) sources.push({ tgz: true });
          if (PYPI[name]) sources.push({ url: PYPI[name][0], sri: PYPI[name][1] });
          for (const b of CDN_BASES) sources.push({ url: b + name, sri });
        }
        const label = name.endsWith('.whl') ? ' ' + name.split('-')[0] : name === 'pyodide.asm.wasm' ? ' Python 环境' : ' ' + name;
        let lastErr = null;
        for (const s of sources) {
          try {
            if (s.tgz) {
              await coreFromTarball();
              const again = await cacheGet(url);
              if (again) return again;
              continue;
            }
            const buf = await download(s.url, label);
            if (!(await verify(buf, s.sri))) throw new Error('文件校验失败');
            return await cachePut(url, buf, name);
          } catch (e) {
            lastErr = e;
          }
        }
        throw new Error('无法下载 ' + name + (lastErr ? '（' + (lastErr.name === 'AbortError' ? '连接超时' : lastErr.message) + '）' : ''));
      })();
      inflight.set(name, job);
      job.catch(() => inflight.delete(name));
    }
    return inflight.get(name).then((r) => r.clone());
  }

  /** The worker's only fetch: Pyodide files, nothing else. */
  async function loaderFetch(input, init) {
    const url = String((input && input.url) || input);
    if (!url.startsWith(INDEX_URL)) throw new TypeError('沙箱内不能联网');
    const name = url.slice(INDEX_URL.length).split(/[?#]/)[0];
    const sri = CORE[name] || (init && init.integrity) || null;
    if (!sri) throw new TypeError('未知文件：' + name);
    return getFile(name, sri);
  }

  // ── Python ──
  const BOOT_PY = `
import sys, os, warnings, logging
warnings.filterwarnings("ignore", message=".*non-interactive.*")
warnings.filterwarnings("ignore", message=".*Glyph.*missing from.*")
logging.getLogger("matplotlib").setLevel(logging.ERROR)

async def __glm_run(src, ns):
    from pyodide.code import eval_code_async
    value = await eval_code_async(src, ns)
    return None if value is None else repr(value)

def __glm_cjk_font():
    # A tiny font whose CJK glyphs are empty but 1 em wide: matplotlib measures Chinese labels right,
    # and the SVG keeps text as text, so the phone draws it with its own Chinese font.
    from fontTools.fontBuilder import FontBuilder
    from fontTools.pens.ttGlyphPen import TTGlyphPen
    path = "/home/pyodide/.glm/GLMCJK.ttf"
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fb = FontBuilder(1000, isTTF=True)
    fb.setupGlyphOrder([".notdef", "cjk"])
    cmap = {}
    for a, b in [(0x2E80, 0x2FDF), (0x3000, 0x30FF), (0x3100, 0x312F), (0x3200, 0x33FF), (0x3400, 0x4DBF),
                 (0x4E00, 0x9FFF), (0xF900, 0xFAFF), (0xFE30, 0xFE4F), (0xFF00, 0xFF60), (0xFFE0, 0xFFE6)]:
        for c in range(a, b + 1):
            cmap[c] = "cjk"
    fb.setupCharacterMap(cmap)
    empty = TTGlyphPen(None).glyph()
    fb.setupGlyf({".notdef": empty, "cjk": empty})
    fb.setupHorizontalMetrics({".notdef": (500, 0), "cjk": (1000, 0)})
    fb.setupHorizontalHeader(ascent=880, descent=-120)
    fb.setupNameTable({"familyName": "GLM CJK", "styleName": "Regular"})
    fb.setupOS2(sTypoAscender=880, sTypoDescender=-120, usWinAscent=880, usWinDescent=120)
    fb.setupPost()
    fb.save(path)
    return path

__glm_mpl_ready = False
def __glm_mpl():
    global __glm_mpl_ready
    if __glm_mpl_ready:
        return
    __glm_mpl_ready = True
    import matplotlib
    from matplotlib import font_manager, rcParams
    try:
        font_manager.fontManager.addfont(__glm_cjk_font())
    except Exception:
        pass
    rcParams["font.sans-serif"] = ["DejaVu Sans", "GLM CJK", "PingFang SC", "Hiragino Sans GB", "Heiti SC",
        "Noto Sans CJK SC", "Noto Sans SC", "Source Han Sans SC", "Microsoft YaHei", "WenQuanYi Micro Hei"]
    rcParams["axes.unicode_minus"] = False
    rcParams["svg.fonttype"] = "none"

def __glm_figures():
    plt = sys.modules.get("matplotlib.pyplot")
    if plt is None:
        return []
    import io
    out = []
    for n in plt.get_fignums():
        buf = io.StringIO()
        plt.figure(n).savefig(buf, format="svg", bbox_inches="tight", pad_inches=0.25)
        out.append(buf.getvalue())
    plt.close("all")
    return out

def __glm_install_wheel(path):
    import zipfile, site, importlib
    zipfile.ZipFile(path).extractall(site.getsitepackages()[0])
    importlib.invalidate_caches()
`;
  let py = null;
  let pyJob = null;
  function ensurePython() {
    if (py) return Promise.resolve(py);
    if (!pyJob) {
      pyJob = (async () => {
        progress('准备 Python 环境…');
        const [loader, asm] = await Promise.all([
          getFile('pyodide.js', CORE['pyodide.js']),
          getFile('pyodide.asm.js', CORE['pyodide.asm.js']),
        ]);
        preloaded.set(INDEX_URL + 'pyodide.asm.js', await asm.text());
        (0, eval)(await loader.text());
        progress('启动 Python…');
        const pyodide = await self.loadPyodide({
          indexURL: INDEX_URL,
          env: { HOME: '/home/pyodide', MPLBACKEND: 'Agg' },
          stdout: () => {},
          stderr: () => {},
        });
        pyodide.setStdin({ error: true });
        pyodide.runPython(BOOT_PY);
        py = pyodide;
        return py;
      })().catch((e) => { pyJob = null; throw e; });
    }
    return pyJob;
  }

  function cleanTrace(msg) {
    const lines = String(msg).split('\n');
    const out = [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (/^\s*File "\/lib\/python[^"]*\/(_pyodide|pyodide)\//.test(l) || /__glm_run/.test(l)) {
        if (lines[i + 1] && /^\s{4,}/.test(lines[i + 1]) && !/^\s*File /.test(lines[i + 1])) i++;
        while (lines[i + 1] && /^\s*[\^~]+\s*$/.test(lines[i + 1])) i++;
        continue;
      }
      out.push(l);
    }
    return out.join('\n').trim();
  }

  const LIMIT = 100000;
  const installed = new Set();
  async function installExtras(pyodide, code) {
    for (const [re, wheels, deps] of EXTRA_NEEDS) {
      if (!re.test(code) || wheels.every((w) => installed.has(w))) continue;
      if (deps.length) await pyodide.loadPackage(deps, { messageCallback: () => {}, errorCallback: () => {} });
      for (const key of wheels) {
        if (installed.has(key)) continue;
        const [file, url, sri] = EXTRA_WHEELS[key];
        progress('加载 ' + key.replace('_', '-'));
        const res = await getFile(file, sri, { url, sri });
        pyodide.FS.writeFile('/tmp/' + file, new Uint8Array(await res.arrayBuffer()));
        pyodide.globals.get('__glm_install_wheel')('/tmp/' + file);
        installed.add(key);
      }
    }
  }

  // One namespace and folder per conversation, kept while the worker lives (like a notebook).
  const spaces = new Map();
  function space(pyodide, key) {
    let s = spaces.get(key);
    if (s) { s.fresh = false; return s; }
    const dir = '/home/pyodide/chat' + (spaces.size + 1);
    pyodide.FS.mkdirTree(dir + '/files');
    pyodide.FS.mkdirTree(dir + '/outputs');
    const ns = pyodide.globals.get('dict')();
    ns.set('__name__', '__main__');
    s = { ns, dir, files: new Map(), fresh: true };
    spaces.set(key, s);
    return s;
  }
  const safeName = (n) => String(n || 'file').replace(/[\/\\\0]/g, '_').replace(/^\.+/, '_').slice(0, 120) || 'file';

  function putFiles(pyodide, s, files) {
    for (const f of files || []) {
      if (s.files.has(f.id)) continue;
      let name = safeName(f.name);
      const taken = new Set(s.files.values());
      for (let i = 2; taken.has(name); i++) name = name.replace(/(\.[^.]*)?$/, '-' + i + '$1');
      const data = typeof f.data === 'string' ? new TextEncoder().encode(f.data) : new Uint8Array(f.data);
      pyodide.FS.writeFile(s.dir + '/files/' + name, data);
      s.files.set(f.id, name);
    }
  }

  function takeOutputs(pyodide, s) {
    const out = [];
    let total = 0;
    const dir = s.dir + '/outputs';
    const walk = (d, prefix) => {
      for (const name of pyodide.FS.readdir(d)) {
        if (name === '.' || name === '..') continue;
        const p = d + '/' + name;
        const st = pyodide.FS.stat(p);
        if (pyodide.FS.isDir(st.mode)) { walk(p, prefix + name + '/'); continue; }
        if (total + st.size <= 30 * 1048576) {
          const data = pyodide.FS.readFile(p);
          total += data.length;
          out.push({ name: prefix + name, data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) });
        } else out.push({ name: prefix + name, skipped: true, size: st.size });
        pyodide.FS.unlink(p);
      }
    };
    try { walk(dir, ''); } catch (e) { /* no outputs */ }
    return out;
  }

  async function runPython(code, id, key, files) {
    const pyodide = await ensurePython();
    await pyodide.loadPackagesFromImports(code, {
      messageCallback: (m) => { if (/^Loading /.test(m)) progress('加载 ' + m.slice(8)); },
      errorCallback: () => {},
    });
    await installExtras(pyodide, code);
    const s = space(pyodide, key || 'default');
    putFiles(pyodide, s, files);
    if (pyodide.loadedPackages.matplotlib) {
      try { pyodide.globals.get('__glm_mpl')(); } catch (e) { /* charts still work, just without the CJK tweaks */ }
    }
    pyodide.runPython('import os; os.chdir(' + JSON.stringify(s.dir) + ')');
    post({ type: 'progress', id, phase: 'exec' });
    progress('运行中…');
    const out = [];
    let size = 0;
    const sink = (s) => {
      if (size > LIMIT) return;
      size += s.length + 1;
      out.push(size > LIMIT ? s.slice(0, 2000) + '\n…（输出过长，已截断）' : s);
    };
    pyodide.setStdout({ batched: sink });
    pyodide.setStderr({ batched: sink });
    let result = null, error = null, images = [];
    try {
      const run = pyodide.globals.get('__glm_run');
      result = await run(code, s.ns);
      run.destroy();
    } catch (e) {
      error = cleanTrace(e && e.message ? e.message : e);
    }
    try {
      const figs = pyodide.globals.get('__glm_figures');
      const list = figs();
      images = list.toJs();
      list.destroy();
      figs.destroy();
    } catch (e) { /* no figures */ }
    return { stdout: out.join('\n'), result, error, svgs: images, outputs: takeOutputs(pyodide, s), fresh: s.fresh };
  }

  // ── JavaScript ──
  function fmt(v, depth = 0) {
    if (typeof v === 'bigint') return v.toString() + 'n';
    if (typeof v === 'string') return depth ? JSON.stringify(v) : v;
    if (typeof v === 'function') return '[Function ' + (v.name || 'anonymous') + ']';
    if (v === null || typeof v !== 'object') return String(v);
    if (v instanceof Error) return v.name + ': ' + v.message;
    if (depth > 4) return Array.isArray(v) ? '[Array]' : '[Object]';
    if (Array.isArray(v) || ArrayBuffer.isView(v)) {
      const a = Array.from(v);
      return '[' + a.slice(0, 500).map((x) => fmt(x, depth + 1)).join(', ') + (a.length > 500 ? ', …共 ' + a.length + ' 项' : '') + ']';
    }
    if (v instanceof Map) return 'Map {' + [...v].slice(0, 200).map(([k, x]) => fmt(k, depth + 1) + ' => ' + fmt(x, depth + 1)).join(', ') + '}';
    if (v instanceof Set) return 'Set {' + [...v].slice(0, 200).map((x) => fmt(x, depth + 1)).join(', ') + '}';
    try {
      return '{' + Object.keys(v).slice(0, 200).map((k) => k + ': ' + fmt(v[k], depth + 1)).join(', ') + '}';
    } catch (e) {
      return String(v);
    }
  }

  async function runJs(code, id) {
    post({ type: 'progress', id, phase: 'exec' });
    const out = [];
    let size = 0;
    const log = (...a) => {
      if (size > LIMIT) return;
      const s = a.map((x) => fmt(x)).join(' ');
      size += s.length + 1;
      out.push(size > LIMIT ? s.slice(0, 2000) + '\n…（输出过长，已截断）' : s);
    };
    self.console = { log, info: log, warn: log, error: log, debug: log, table: log, dir: log, trace: log };
    let result = null, error = null;
    try {
      let v;
      try {
        v = (0, eval)(code);
      } catch (e) {
        if (e instanceof SyntaxError && /\bawait\b/.test(code)) v = await (0, eval)('(async () => {\n' + code + '\n})()');
        else throw e;
      }
      if (v && typeof v.then === 'function') v = await v;
      if (v !== undefined) result = fmt(v);
    } catch (e) {
      error = e && e.stack ? String(e.stack).split('\n').slice(0, 6).join('\n') : String(e);
      if (e && e.stack && !String(e.stack).startsWith(String(e.name))) error = e.name + ': ' + e.message + '\n' + error;
    }
    return { stdout: out.join('\n'), result, error, images: [] };
  }

  // ── messages from the page ──
  self.onmessage = async (event) => {
    const m = event.data || {};
    if (m.type === 'config') {
      appBase = typeof m.appBase === 'string' && /^https?:\/\//.test(m.appBase) ? m.appBase : '';
      return;
    }
    const id = m.id;
    progress = (text) => post({ type: 'progress', id, text });
    const t0 = performance.now();
    try {
      if (m.type === 'prepare') {
        await ensurePython();
        await py.loadPackage(['sympy', 'mpmath'], { messageCallback: (s) => { if (/^Loading /.test(s)) progress('加载 ' + s.slice(8)); } });
        post({ type: 'result', id, stdout: 'Python ' + PY_VERSION + ' 已就绪', ms: Math.round(performance.now() - t0) });
      } else if (m.type === 'run') {
        const r = m.lang === 'python' ? await runPython(String(m.code || ''), id, m.ns, m.files) : await runJs(String(m.code || ''), id);
        const transfer = (r.outputs || []).filter((f) => f.data).map((f) => f.data);
        post(Object.assign({ type: 'result', id, ms: Math.round(performance.now() - t0) }, r), transfer);
      }
    } catch (e) {
      post({ type: 'result', id, error: String((e && e.message) || e), setup: true, ms: Math.round(performance.now() - t0) });
    }
  };
  post({ type: 'hello' });
})();
