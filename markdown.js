/* markdown.js — a small, dependency-free Markdown renderer for chat output.
 *
 * Everything that comes from the model is HTML-escaped; only tags built here reach innerHTML.
 * Supports: headings, paragraphs (single newline = line break), emphasis, strikethrough, inline code,
 * fenced code with syntax highlighting, lists (nested, task lists), blockquotes, tables, rules,
 * links / autolinks, LaTeX math ($…$, $$…$$, \(…\), \[…\]) via KaTeX when it is loaded, and
 * numbered citations [1] that point at web-search sources.
 */
(function (global) {
  'use strict';

  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);
  const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // ───────────────────────── syntax highlighting ─────────────────────────
  const words = (s) => new Set(s.split(/\s+/).filter(Boolean));
  const LANGS = {};
  const def = (names, d) => names.split(' ').forEach((n) => (LANGS[n] = d));

  def('js javascript jsx mjs cjs ts typescript tsx node', {
    kw: words('break case catch class const continue debugger default delete do else enum export extends finally for function if implements import in instanceof interface let new of package private protected public return static super switch this throw try typeof var void while with yield async await from as type declare namespace readonly abstract keyof satisfies get set'),
    lit: words('true false null undefined NaN Infinity'),
    comment: ['//', '/*'], str: ['`', '"', "'"],
  });
  def('python py python3 py3 ipython', {
    kw: words('and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case self'),
    lit: words('True False None'), comment: ['#'], str: ['"""', "'''", '"', "'"], deco: true,
  });
  def('java kotlin kt kts scala groovy dart', {
    kw: words('abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static super switch synchronized this throw throws transient try void volatile while var val fun object when is in override open data sealed lateinit companion suspend internal inline typealias init by late required async await dynamic'),
    lit: words('true false null'), comment: ['//', '/*'], str: ['"""', '"', "'"], deco: true,
  });
  def('c cpp c++ h hpp cc cxx hh objc objective-c objectivec cs csharp c#', {
    kw: words('auto break case char const continue default do double else enum extern float for goto if inline int long register restrict return short signed sizeof static struct switch typedef union unsigned void volatile while class namespace template typename public private protected virtual override final new delete this friend operator using try catch throw constexpr bool string var foreach in out ref readonly sealed base lock get set async await interface internal is as event delegate decltype noexcept static_cast dynamic_cast reinterpret_cast const_cast'),
    lit: words('true false NULL nullptr null'), comment: ['//', '/*'], str: ['"', "'"], pre: true,
  });
  def('go golang', {
    kw: words('break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var'),
    lit: words('true false nil iota'), comment: ['//', '/*'], str: ['`', '"', "'"],
  });
  def('rust rs', {
    kw: words('as async await break const continue crate dyn else enum extern fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait type unsafe use where while'),
    lit: words('true false None Some Ok Err'), comment: ['//', '/*'], str: ['"'], macro: true,
  });
  def('swift', {
    kw: words('associatedtype class deinit enum extension fileprivate func import init inout internal let open operator private protocol public rethrows static struct subscript typealias var break case continue default defer do else fallthrough for guard if in repeat return switch where while as catch is throw throws try async await some any self Self super weak unowned lazy mutating override final required convenience'),
    lit: words('true false nil'), comment: ['//', '/*'], str: ['"""', '"'], deco: true,
  });
  def('php', {
    kw: words('abstract and array as break callable case catch class clone const continue declare default do echo else elseif empty enddeclare endfor endforeach endif endswitch endwhile extends final finally fn for foreach function global goto if implements include include_once instanceof insteadof interface isset list match namespace new or print private protected public readonly require require_once return static switch throw trait try unset use var while xor yield'),
    lit: words('true false null TRUE FALSE NULL'), comment: ['//', '/*', '#'], str: ['"', "'"], vars: true,
  });
  def('ruby rb', {
    kw: words('alias and begin break case class def defined do else elsif end ensure for if in module next not or redo rescue retry return self super then undef unless until when while yield require attr_accessor attr_reader puts'),
    lit: words('true false nil'), comment: ['#'], str: ['"', "'"],
  });
  def('bash sh shell zsh console shellscript fish powershell ps1 bat cmd dockerfile docker makefile make', {
    kw: words('if then else elif fi for while until do done case esac function in return export local readonly declare source alias unset shift exit echo cd sudo set eval exec trap FROM RUN CMD COPY ADD ENV WORKDIR EXPOSE ENTRYPOINT ARG LABEL USER VOLUME'),
    lit: words('true false'), comment: ['#'], str: ['"', "'"], vars: true,
  });
  def('sql mysql postgresql postgres psql sqlite plsql tsql', {
    kw: words('select from where and or not insert into values update set delete create table drop alter add index view join left right inner outer full cross on group by order having limit offset as distinct union all case when then else end primary key foreign references is in like between exists default unique check constraint database if begin commit rollback returning with asc desc count sum avg min max cast varchar int integer text boolean date timestamp serial bigint float double decimal char'),
    lit: words('true false null'), comment: ['--', '/*'], str: ["'", '"'], ci: true,
  });
  def('lua', { kw: words('and break do else elseif end for function goto if in local not or repeat return then until while'), lit: words('true false nil'), comment: ['--'], str: ['"', "'"] });
  def('r', { kw: words('if else repeat while function for in next break library return'), lit: words('TRUE FALSE NULL NA Inf NaN T F'), comment: ['#'], str: ['"', "'"] });
  def('yaml yml toml ini conf properties env', { kw: words(''), lit: words('true false null yes no on off'), comment: ['#'], str: ['"', "'"], keyColon: true });
  def('json json5 jsonc jsonl', { json: true });
  def('css scss sass less', { css: true });
  def('html xml svg vue xhtml markup plist', { markup: true });
  def('diff patch', { diff: true });

  const span = (cls, text) => '<span class="tk-' + cls + '">' + esc(text) + '</span>';
  const reCache = new Map();

  function genericRe(d) {
    if (reCache.has(d)) return reCache.get(d);
    const parts = [];
    const cm = d.comment || [];
    if (d.pre) parts.push(['m', '#[ \\t]*(?:include|define|undef|ifdef|ifndef|if|elif|else|endif|pragma|error|import|region|endregion)\\b[^\\n]*']);
    if (cm.includes('//')) parts.push(['c', '//[^\\n]*']);
    if (cm.includes('/*')) parts.push(['c', '/\\*[\\s\\S]*?(?:\\*/|$)']);
    if (cm.includes('#')) parts.push(['c', '#[^\\n]*']);
    if (cm.includes('--')) parts.push(['c', '--[^\\n]*']);
    for (const q of d.str || []) {
      if (q.length === 3) parts.push(['s', reEsc(q) + '[\\s\\S]*?(?:' + reEsc(q) + '|$)']);
      else if (q === '`') parts.push(['s', '`(?:\\\\[\\s\\S]|[^`\\\\])*`?']);
      else parts.push(['s', reEsc(q) + '(?:\\\\.|[^' + reEsc(q) + '\\\\\\n])*' + reEsc(q) + '?']);
    }
    if (d.deco) parts.push(['m', '@[A-Za-z_][\\w.]*']);
    if (d.vars) parts.push(['v', '\\$\\{[^}\\n]*\\}|\\$[A-Za-z_]\\w*|\\$[0-9@#?*$!-]']);
    if (d.keyColon) parts.push(['a', '^[ \\t-]*[A-Za-z_][\\w.-]*(?=[ \\t]*[:=])']);
    parts.push(['n', '\\b(?:0[xX][\\da-fA-F_]+|0[bB][01_]+|\\d[\\d_]*(?:\\.\\d[\\d_]*)?(?:[eE][+-]?\\d+)?)[a-zA-Z]*\\b']);
    parts.push(['w', '[A-Za-z_$][\\w$]*']);
    const re = { re: new RegExp(parts.map((p) => '(' + p[1] + ')').join('|'), d.keyColon ? 'gm' : 'g'), types: parts.map((p) => p[0]) };
    reCache.set(d, re);
    return re;
  }

  function hlGeneric(code, d) {
    const { re, types } = genericRe(d);
    re.lastIndex = 0;
    let out = '', last = 0, m;
    while ((m = re.exec(code))) {
      if (m[0] === '') { re.lastIndex++; continue; }
      if (m.index > last) out += esc(code.slice(last, m.index));
      let gi = 1;
      while (m[gi] === undefined) gi++;
      const type = types[gi - 1];
      const tok = m[0];
      if (type === 'w') {
        const k = d.ci ? tok.toLowerCase() : tok;
        const next = code[re.lastIndex];
        if (d.kw && d.kw.has(k)) out += span('k', tok);
        else if (d.lit && d.lit.has(d.ci ? k : tok)) out += span('l', tok);
        else if (next === '(' || (d.macro && next === '!')) out += span('f', tok);
        else if (/^[A-Z][a-z0-9]\w*$/.test(tok)) out += span('t', tok);
        else out += esc(tok);
      } else out += span(type, tok);
      last = re.lastIndex;
    }
    return out + esc(code.slice(last));
  }

  function hlJson(code) {
    const re = /("(?:\\.|[^"\\\n])*")(\s*:)|("(?:\\.|[^"\\\n])*")|\b(true|false|null)\b|(-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)|(\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$))/g;
    let out = '', last = 0, m;
    while ((m = re.exec(code))) {
      out += esc(code.slice(last, m.index));
      if (m[1]) out += span('a', m[1]) + esc(m[2]);
      else if (m[3]) out += span('s', m[3]);
      else if (m[4]) out += span('l', m[4]);
      else if (m[5]) out += span('n', m[5]);
      else out += span('c', m[6]);
      last = re.lastIndex;
    }
    return out + esc(code.slice(last));
  }

  function hlMarkup(code) {
    const re = /(<!--[\s\S]*?(?:-->|$))|(<\/?)([A-Za-z][\w:.-]*)((?:\s+[^\s=>\/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)(\s*\/?>)?/g;
    let out = '', last = 0, m;
    while ((m = re.exec(code))) {
      out += esc(code.slice(last, m.index));
      if (m[1]) out += span('c', m[1]);
      else {
        out += esc(m[2]) + span('k', m[3]);
        out += (m[4] || '').replace(/(\s+)([^\s=>\/]+)(?:(\s*=\s*)("[^"]*"|'[^']*'|[^\s>]+))?/g, (_, sp, name, eq, val) =>
          esc(sp) + span('a', name) + (eq ? esc(eq) + span('s', val) : ''));
        out += esc(m[5] || '');
      }
      last = re.lastIndex;
    }
    return out + esc(code.slice(last));
  }

  function hlCss(code) {
    const re = /(\/\*[\s\S]*?(?:\*\/|$))|("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')|(@[\w-]+)|(#[0-9a-fA-F]{3,8}\b)|(-?(?:\d*\.)?\d+(?:px|em|rem|%|vh|vw|dvh|svh|s|ms|deg|fr|ch|ex|pt)?\b)|(--[\w-]+|[a-zA-Z-]+)(?=\s*:[^:{;]*[;}\n])|(\.[\w-]+|::?[\w-]+)/g;
    let out = '', last = 0, m;
    while ((m = re.exec(code))) {
      out += esc(code.slice(last, m.index));
      const t = m[1] ? 'c' : m[2] ? 's' : m[3] ? 'k' : m[4] ? 'n' : m[5] ? 'n' : m[6] ? 'a' : 't';
      out += span(t, m[0]);
      last = re.lastIndex;
    }
    return out + esc(code.slice(last));
  }

  function hlDiff(code) {
    return code.split('\n').map((l) => {
      if (/^(\+\+\+|---)/.test(l)) return span('k', l);
      if (l[0] === '+') return span('ins', l);
      if (l[0] === '-') return span('del', l);
      if (l.startsWith('@@')) return span('m', l);
      return esc(l);
    }).join('\n');
  }

  const GENERIC = { kw: words('if else for while return function def class import from const let var new this true false null None'), lit: words('true false null None nil'), comment: ['//', '/*', '#'], str: ['"', "'", '`'] };

  function highlight(code, lang) {
    const d = LANGS[lang];
    if (code.length > 120000) return esc(code);
    try {
      if (!d) return lang && /^(text|txt|plain|plaintext|output|log|markdown|md)$/.test(lang) ? esc(code) : hlGeneric(code, GENERIC);
      if (d.json) return hlJson(code);
      if (d.markup) return hlMarkup(code);
      if (d.css) return hlCss(code);
      if (d.diff) return hlDiff(code);
      return hlGeneric(code, d);
    } catch (e) {
      return esc(code);
    }
  }

  // ───────────────────────── math ─────────────────────────
  const mathCache = new Map();
  const MD = { pendingMath: false };

  function mathHtml(tex, display) {
    tex = tex.trim();
    if (!tex) return '';
    const key = (display ? 'D' : 'I') + tex;
    if (mathCache.has(key)) return mathCache.get(key);
    if (global.katex) {
      let html;
      try {
        html = global.katex.renderToString(tex, { displayMode: display, throwOnError: false, strict: 'ignore', output: 'html', trust: false });
      } catch (e) {
        html = esc(tex);
      }
      html = display ? '<div class="math-display">' + html + '</div>' : '<span class="math-inline">' + html + '</span>';
      if (mathCache.size > 3000) mathCache.clear();
      mathCache.set(key, html);
      return html;
    }
    MD.pendingMath = true;
    return display ? '<div class="math-display math-raw">' + esc(tex) + '</div>' : '<span class="math-inline math-raw">' + esc(tex) + '</span>';
  }

  // ───────────────────────── inline ─────────────────────────
  const OPEN = '\u0001', CLOSE = '\u0002';
  const ALLOWED_TAGS = /&lt;(\/?)(br|sup|sub|u|kbd|mark|b|i|s|del|ins|small|em|strong)\s*\/?&gt;/gi;

  function safeUrl(url) {
    url = url.trim().replace(/^<|>$/g, '');
    if (/^(https?:|mailto:|tel:)/i.test(url)) return url;
    if (/^www\./i.test(url)) return 'https://' + url;
    return null;
  }

  function inline(text, ctx) {
    const slots = [];
    const put = (html) => OPEN + (slots.push(html) - 1) + CLOSE;

    // 1. code spans
    text = text.replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, (m, ticks, code) => {
      if (/^ .* $/.test(code)) code = code.slice(1, -1);
      return put('<code>' + esc(code) + '</code>');
    });
    // 2. math
    text = text.replace(/\$\$([\s\S]+?)\$\$/g, (m, tex) => put(mathHtml(tex, true)));
    text = text.replace(/\\\[([\s\S]+?)\\\]/g, (m, tex) => put(mathHtml(tex, true)));
    text = text.replace(/\\\(([\s\S]+?)\\\)/g, (m, tex) => put(mathHtml(tex, false)));
    text = text.replace(/(^|[^\\$])\$(?=[^\s$])((?:\\.|[^$\\\n])+?)\$(?![\d$])/g, (m, pre, tex) => {
      if (/\s$/.test(tex)) return m; // "$5 and $10" is money, not math
      return pre + put(mathHtml(tex, false));
    });
    // 3. backslash escapes
    text = text.replace(/\\([\\`*_{}\[\]()#+\-.!|~<>$])/g, (m, ch) => put(esc(ch)));
    // 4. links and images
    text = text.replace(/(!?)\[([^\[\]\n]+)\]\((<[^>\n]+>|[^()\s]+(?:\([^()\s]*\)[^()\s]*)*)(?:\s+"[^"\n]*")?\)/g, (m, bang, label, url) => {
      const href = safeUrl(url);
      if (!href) return m;
      const inner = bang ? '🖼 ' + emph(esc(label)) : emph(esc(label));
      return put('<a href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">' + inner + '</a>');
    });
    // 5. bare URLs
    text = text.replace(/(^|[^\w/@.])((?:https?:\/\/|www\.)[^\s<>"'`\u0001\u0002（）【】「」《》，。；！？、]+)/g, (m, pre, url) => {
      let tail = '';
      while (/[.,;:!?'")\]}*_~]$/.test(url)) {
        if (url.endsWith(')') && (url.match(/\(/g) || []).length >= (url.match(/\)/g) || []).length) break;
        tail = url.slice(-1) + tail;
        url = url.slice(0, -1);
      }
      const href = safeUrl(url);
      if (!href) return m;
      return pre + put('<a href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">' + esc(url) + '</a>') + tail;
    });
    // 6. citations to web-search sources: [1] [1,2] [1][2] 【1】 [ref_1]
    if (ctx && ctx.cites && ctx.cites.size) {
      const cite = (n) => {
        const s = ctx.cites.get(Number(n));
        if (!s) return null;
        return '<a class="cite" href="' + esc(safeUrl(s.link || '') || '#') + '" target="_blank" rel="noopener noreferrer" title="' + esc(s.title || '') + '">' + n + '</a>';
      };
      text = text.replace(/[\[【](?:ref_)?(\d{1,2}(?:\s*[,，、]\s*(?:ref_)?\d{1,2})*)[\]】](?!\()/g, (m, list) => {
        const html = list.split(/\s*[,，、]\s*/).map((n) => cite(n.replace('ref_', ''))).filter(Boolean);
        return html.length ? put('<sup class="cites">' + html.join('') + '</sup>') : m;
      });
    }
    // 7. escape, emphasis, a few harmless inline tags
    text = emph(esc(text)).replace(ALLOWED_TAGS, '<$1$2>');
    // keep CJK punctuation on the same line as the formula / code next to it
    text = text.replace(/([（「『【《]*)(\u0001\d+\u0002)([，。、；：！？）」』】》]*)/g,
      (m, open, slot, close) => (open || close ? '<span class="nobr">' + m + '</span>' : m));
    // 8. restore slots (they may nest)
    for (let i = 0; i < 4 && text.indexOf(OPEN) !== -1; i++) {
      text = text.replace(/\u0001(\d+)\u0002/g, (m, n) => slots[n]);
    }
    return text;
  }

  function emph(t) {
    return t
      .replace(/\*\*\*(?=\S)([\s\S]*?\S)\*\*\*/g, '<strong><em>$1</em></strong>')
      .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^\w])__(?=\S)([\s\S]*?\S)__(?!\w)/g, '$1<strong>$2</strong>')
      .replace(/(^|[^*\w])\*(?=[^\s*])([^*\n]*?[^\s*])\*(?!\*)/g, '$1<em>$2</em>')
      .replace(/(^|[^\w_])_(?=[^\s_])([^_\n]*?[^\s_])_(?![\w_])/g, '$1<em>$2</em>')
      .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>');
  }

  // ───────────────────────── blocks ─────────────────────────
  const LIST_RE = /^( *)([-*+]|\d{1,9}[.)])(?:[ \t]+(.*))?$/;
  const HR_RE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
  const FENCE_RE = /^( *)(`{3,}|~{3,})[ \t]*([^`\s]*)[^`]*$/;
  const HEAD_RE = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
  const isBlank = (l) => /^\s*$/.test(l);
  const indentOf = (l) => {
    let n = 0;
    for (const ch of l) { if (ch === ' ') n++; else if (ch === '\t') n += 4; else break; }
    return n;
  };
  const stripIndent = (l, n) => {
    let i = 0, col = 0;
    while (i < l.length && col < n && (l[i] === ' ' || l[i] === '\t')) { col += l[i] === '\t' ? 4 : 1; i++; }
    return l.slice(i);
  };
  const isTableSep = (l) => !!l && l.includes('|') && l.includes('-') && /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/.test(l);

  function splitRow(l) {
    l = l.trim();
    if (l.startsWith('|')) l = l.slice(1);
    if (l.endsWith('|') && !l.endsWith('\\|')) l = l.slice(0, -1);
    const cells = [];
    let cur = '', inCode = false;
    for (let i = 0; i < l.length; i++) {
      const ch = l[i];
      if (ch === '\\' && l[i + 1] === '|') { cur += '|'; i++; continue; }
      if (ch === '`') inCode = !inCode;
      if (ch === '|' && !inCode) { cells.push(cur.trim()); cur = ''; continue; }
      cur += ch;
    }
    cells.push(cur.trim());
    return cells;
  }

  function startsBlock(l, next) {
    return FENCE_RE.test(l) || HEAD_RE.test(l) || /^ {0,3}>/.test(l) || HR_RE.test(l) ||
      (LIST_RE.test(l) && LIST_RE.exec(l)[3] !== undefined) || /^\s*\$\$/.test(l) || /^\s*\\\[\s*$/.test(l) ||
      (l.includes('|') && isTableSep(next));
  }

  const COPY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8"/></svg>';

  function codeBlock(code, lang) {
    const l = (lang || '').toLowerCase();
    if (l === 'math' || l === 'katex' || l === 'tex-math') return mathHtml(code, true);
    return '<div class="code-block"><div class="code-head"><span class="code-lang">' + esc(l || 'text') +
      '</span><button class="code-copy" type="button" aria-label="复制代码">' + COPY_ICON + '<span>复制</span></button></div>' +
      '<pre><code>' + highlight(code, l) + '</code></pre></div>';
  }

  function parseList(lines, start, ctx) {
    const first = LIST_RE.exec(lines[start]);
    const base = first[1].length;
    const ordered = /\d/.test(first[2]);
    const startNum = ordered ? parseInt(first[2], 10) : 1;
    const items = [];
    let loose = false;
    let i = start;
    while (i < lines.length) {
      const l = lines[i];
      const m = LIST_RE.exec(l);
      if (m && Math.abs(m[1].length - base) <= 1 && /\d/.test(m[2]) === ordered) {
        items.push({ lines: [m[3] || ''], indent: m[1].length + m[2].length + 1 });
        i++;
        continue;
      }
      const cur = items[items.length - 1];
      if (isBlank(l)) {
        let j = i + 1;
        while (j < lines.length && isBlank(lines[j])) j++;
        if (j >= lines.length) break;
        const nm = LIST_RE.exec(lines[j]);
        const ind = indentOf(lines[j]);
        if (ind > base + 1 || (nm && Math.abs(nm[1].length - base) <= 1 && /\d/.test(nm[2]) === ordered)) {
          if (!(ind > base + 1)) loose = true;
          for (; i < j; i++) cur.lines.push('');
          continue;
        }
        break;
      }
      const ind = indentOf(l);
      if (ind > base + 1) {
        cur.lines.push(stripIndent(l, Math.min(ind, cur.indent)));
        i++;
        continue;
      }
      if (m) break; // a different list type at the same level
      if (!startsBlock(l, lines[i + 1]) && cur.lines[cur.lines.length - 1] !== '') {
        cur.lines.push(l.trim()); // lazy continuation
        i++;
        continue;
      }
      break;
    }
    const tag = ordered ? 'ol' : 'ul';
    let html = '<' + tag + (ordered && startNum !== 1 ? ' start="' + startNum + '"' : '') + '>';
    for (const it of items) {
      let content = it.lines;
      let task = null;
      const tm = /^\[([ xX])\][ \t]+([\s\S]*)$/.exec(content[0]);
      if (tm) { task = tm[1] !== ' '; content = [tm[2]].concat(content.slice(1)); }
      while (content.length && isBlank(content[content.length - 1])) content.pop();
      let inner = parseBlocks(content, ctx);
      if (!loose) inner = inner.replace(/^<p>([\s\S]*?)<\/p>/, '$1');
      html += task === null ? '<li>' + inner + '</li>'
        : '<li class="task"><span class="task-box' + (task ? ' done' : '') + '"></span>' + inner + '</li>';
    }
    return { html: html + '</' + tag + '>', next: i };
  }

  function parseBlocks(lines, ctx) {
    let out = '';
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (isBlank(line)) { i++; continue; }
      let m;

      if ((m = FENCE_RE.exec(line))) {
        const ind = m[1].length, fence = m[2], lang = m[3] || '';
        const close = new RegExp('^ {0,' + (ind + 3) + '}' + reEsc(fence[0]) + '{' + fence.length + ',}[ \\t]*$');
        const buf = [];
        i++;
        while (i < lines.length && !close.test(lines[i])) { buf.push(ind ? stripIndent(lines[i], ind) : lines[i]); i++; }
        i++;
        out += codeBlock(buf.join('\n'), lang);
        continue;
      }

      if (/^\s*\$\$/.test(line)) {
        const t = line.trim();
        if (t.length > 4 && t.endsWith('$$')) { out += mathHtml(t.slice(2, -2), true); i++; continue; }
        const buf = [t.slice(2)];
        i++;
        while (i < lines.length && !/\$\$\s*$/.test(lines[i])) { buf.push(lines[i]); i++; }
        if (i < lines.length) { buf.push(lines[i].replace(/\$\$\s*$/, '')); i++; }
        out += mathHtml(buf.join('\n'), true);
        continue;
      }
      if (/^\s*\\\[/.test(line) && !/\\\]/.test(line.replace(/^\s*\\\[/, ''))) {
        const buf = [line.replace(/^\s*\\\[/, '')];
        i++;
        while (i < lines.length && !/\\\]\s*$/.test(lines[i])) { buf.push(lines[i]); i++; }
        if (i < lines.length) { buf.push(lines[i].replace(/\\\]\s*$/, '')); i++; }
        out += mathHtml(buf.join('\n'), true);
        continue;
      }

      if ((m = HEAD_RE.exec(line))) {
        const n = m[1].length;
        out += '<h' + n + '>' + inline(m[2], ctx) + '</h' + n + '>';
        i++;
        continue;
      }

      if (HR_RE.test(line)) { out += '<hr>'; i++; continue; }

      if (/^ {0,3}>/.test(line)) {
        const buf = [];
        while (i < lines.length && /^ {0,3}>/.test(lines[i])) { buf.push(lines[i].replace(/^ {0,3}> ?/, '')); i++; }
        out += '<blockquote>' + parseBlocks(buf, ctx) + '</blockquote>';
        continue;
      }

      if (line.includes('|') && isTableSep(lines[i + 1])) {
        const head = splitRow(line);
        const aligns = splitRow(lines[i + 1]).map((c) => (/^:-+:$/.test(c) ? 'center' : /-+:$/.test(c) ? 'right' : ''));
        i += 2;
        let html = '<div class="table-wrap"><table><thead><tr>';
        head.forEach((c, k) => { html += '<th' + (aligns[k] ? ' style="text-align:' + aligns[k] + '"' : '') + '>' + inline(c, ctx) + '</th>'; });
        html += '</tr></thead><tbody>';
        while (i < lines.length && !isBlank(lines[i]) && lines[i].includes('|')) {
          const cells = splitRow(lines[i]);
          html += '<tr>';
          for (let k = 0; k < head.length; k++) {
            html += '<td' + (aligns[k] ? ' style="text-align:' + aligns[k] + '"' : '') + '>' + inline(cells[k] || '', ctx) + '</td>';
          }
          html += '</tr>';
          i++;
        }
        out += html + '</tbody></table></div>';
        continue;
      }

      if ((m = LIST_RE.exec(line)) && m[3] !== undefined) {
        const r = parseList(lines, i, ctx);
        out += r.html;
        i = r.next;
        continue;
      }

      const buf = [line.trim()];
      i++;
      while (i < lines.length && !isBlank(lines[i]) && !startsBlock(lines[i], lines[i + 1])) { buf.push(lines[i].trim()); i++; }
      out += '<p>' + buf.map((l) => inline(l, ctx)).join('<br>') + '</p>';
    }
    return out;
  }

  /** Put a display-math opener that trails a line of text ("如下：$$") on a line of its own. */
  function normalize(src) {
    const out = [];
    let fence = null;
    for (const l of src.split('\n')) {
      const fm = /^ *(`{3,}|~{3,})/.exec(l);
      if (fm) {
        if (!fence) fence = fm[1][0];
        else if (fm[1][0] === fence) fence = null;
        out.push(l);
        continue;
      }
      if (!fence) {
        const n = (l.match(/\$\$/g) || []).length;
        if (n % 2 === 1 && !/^\s*\$\$/.test(l)) {
          const k = l.lastIndexOf('$$');
          out.push(l.slice(0, k), l.slice(k));
          continue;
        }
        if (/\\\[\s*$/.test(l) && !/^\s*\\\[/.test(l)) {
          const k = l.lastIndexOf('\\[');
          out.push(l.slice(0, k), l.slice(k));
          continue;
        }
      }
      out.push(l);
    }
    return out;
  }

  MD.render = function (src, opts) {
    const ctx = { cites: (opts && opts.cites) || null };
    src = String(src || '').replace(/\r\n?/g, '\n');
    try {
      return parseBlocks(normalize(src), ctx);
    } catch (e) {
      console.error(e);
      return '<p>' + esc(src).replace(/\n/g, '<br>') + '</p>';
    }
  };

  /** Plain text for read-aloud and previews. */
  MD.toPlain = function (src) {
    return String(src || '')
      .replace(/```[\s\S]*?(```|$)/g, '（代码略）')
      .replace(/\$\$[\s\S]*?\$\$/g, '（公式）')
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/\[\d{1,2}(?:\s*[,，]\s*\d{1,2})*\]/g, '')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/^\s*[-*+]\s+/gm, '')
      .replace(/^\s*>\s?/gm, '')
      .replace(/[*_~`|]+/g, '')
      .replace(/^\s*:?-{3,}:?\s*$/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  };

  MD.escape = esc;
  MD.highlight = highlight;
  global.MD = MD;
})(window);
