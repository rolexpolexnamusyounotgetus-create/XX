#!/usr/bin/env node
/**
 * tools/make_es.js: writes the Spanish twin es/<page> of an English page, from its data-t keys.
 *
 *   node tools/make_es.js index.html events.html     # write es/index.html and es/events.html
 *   node tools/make_es.js --all                      # every root-level page (not styleguide.html)
 *   node tools/make_es.js --check [pages | --all]    # write nothing; exit 1 on any problem
 *
 * What it does to each English page (BRIEF 7.5):
 *   - every element with data-t="<key>" gets the Spanish value as its text (leaf elements only);
 *     data-t-<attr>="<key>" sets <attr> (aria-label, placeholder, alt, title, content, value...).
 *     Keys without a colon resolve in data/strings.js (entries); "page:key" in data/pages/<page>.js.
 *     {tokens} from data/strings.js are filled from assets/js/config.js (or their fallback).
 *   - <html lang="es">; <base href="/"> becomes <base href="/es/"> (404.html);
 *   - partial markers <!-- @header --> become <!-- @header-es --> when partials/header-es.html
 *     exists (demo-banner, header and footer always need one); shared partials (head, scripts)
 *     keep their name. Then tools/sync_partials.py fills the es/ pages (skip with --no-sync);
 *   - relative URLs: links to pages that have a Spanish twin stay as written (so they point at the
 *     Spanish sibling); everything else (assets, data, manifest, styleguide) gets one more "../";
 *     links into es/ in the English page (a language link) point back at the English page;
 *   - og:image / twitter:image move to assets/img/og/es/...; the ysd:og JSON gets Spanish text from
 *     its "keys" ({"title": "seo.events.ogTitle"}) or its "es" object ({"title": "..."});
 *   - og:locale swaps en_US / es_US;
 *   - hreflang alternates (en, es, x-default = English) are written into BOTH files, right after
 *     <!-- /@head --> (absolute from config site.url when set, else relative).
 *
 * --check fails (exit 1) on: a visible text node or attribute (alt, aria-label, placeholder,
 *   title, value, meta description, og/twitter text, the ysd:og text) that no key covers; a key
 *   with no Spanish value; data-t on an element that has child elements; a {placeholder} that
 *   can't be filled statically; a missing -es partial; a missing or out-of-date es/ page; stale
 *   hreflang in the English page. Text inside translate="no", lang="es", script/style, or made only
 *   of numbers, punctuation and names (Sanford, SunRail, Young Dems...) needs no key.
 *   Warnings (not failures): the English text in the page differs from the key's English value.
 *
 * Options: --root DIR  --no-sync  --json  --quiet  --strict (generate mode: exit 1 on warnings too)
 *          --neutral "Name,Other name" (extra words that are the same in both languages)
 * Exit codes: 0 ok, 1 problems found, 2 bad input or crash.
 *
 * Module: require('./tools/make_es') exports { run, tokenize, annotate, decodeEntities, isNeutral,
 *   loadData, lookup, valueFor, buildPage, audit, prettyPath, VISIBLE_ATTRS, NEUTRAL }.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const P = path.posix;

// ------------------------------------------------------------------------------------------
// HTML tokenizer (keeps byte offsets so edits never reformat the page)
// ------------------------------------------------------------------------------------------

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const RAW = new Set(['script', 'style']);
const RCDATA = new Set(['textarea', 'title']);

function parseAttrs(html, from, to) {
  const attrs = [];
  const re = /([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  const s = html.slice(from, to);
  let m;
  while ((m = re.exec(s))) {
    const name = m[1].toLowerCase();
    let value = null, quote = '', vStart = -1, vEnd = -1;
    if (m[2] !== undefined || m[3] !== undefined || m[4] !== undefined) {
      const raw = m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4];
      quote = m[2] !== undefined ? '"' : m[3] !== undefined ? "'" : '';
      const off = m[0].length - raw.length - (quote ? 1 : 0);
      vStart = from + m.index + off;
      vEnd = vStart + raw.length;
      value = decodeEntities(raw);
    }
    attrs.push({ name, value, raw: m[0], quote, start: from + m.index, end: from + m.index + m[0].length, vStart, vEnd });
  }
  return attrs;
}

/** Tokens: {type: text|raw|comment|doctype|start|end, start, end, name?, attrs?, selfClosing?}. */
function tokenize(html) {
  const toks = [];
  const n = html.length;
  let i = 0;
  while (i < n) {
    const lt = html.indexOf('<', i);
    if (lt < 0) { toks.push({ type: 'text', start: i, end: n }); break; }
    if (lt > i) toks.push({ type: 'text', start: i, end: lt });
    if (html.startsWith('<!--', lt)) {
      const e = html.indexOf('-->', lt + 4);
      const end = e < 0 ? n : e + 3;
      toks.push({ type: 'comment', start: lt, end });
      i = end;
      continue;
    }
    if (html[lt + 1] === '!' || html[lt + 1] === '?') {
      const e = html.indexOf('>', lt);
      const end = e < 0 ? n : e + 1;
      toks.push({ type: 'doctype', start: lt, end });
      i = end;
      continue;
    }
    const m = /^<\/?([a-zA-Z][a-zA-Z0-9:-]*)/.exec(html.slice(lt, lt + 80));
    if (!m) { toks.push({ type: 'text', start: lt, end: lt + 1 }); i = lt + 1; continue; }
    let j = lt + m[0].length, q = null;
    while (j < n) {
      const c = html[j];
      if (q) { if (c === q) q = null; } else if (c === '"' || c === "'") q = c; else if (c === '>') break;
      j++;
    }
    const end = Math.min(n, j + 1);
    const name = m[1].toLowerCase();
    if (html[lt + 1] === '/') { toks.push({ type: 'end', name, start: lt, end }); i = end; continue; }
    const tok = { type: 'start', name, start: lt, end, attrs: parseAttrs(html, lt + m[0].length, j), selfClosing: html[j - 1] === '/' };
    toks.push(tok);
    i = end;
    if (RAW.has(name) || RCDATA.has(name)) {
      const re = new RegExp('</' + name + '\\s*>', 'ig');
      re.lastIndex = i;
      const mm = re.exec(html);
      const cend = mm ? mm.index : n;
      if (cend > i) toks.push({ type: RAW.has(name) ? 'raw' : 'text', start: i, end: cend });
      if (mm) toks.push({ type: 'end', name, start: mm.index, end: mm.index + mm[0].length });
      i = mm ? mm.index + mm[0].length : n;
    }
  }
  return toks;
}

const OPEN_MARK = /^<!--\s*@([A-Za-z0-9][A-Za-z0-9_-]*)\s*-->$/;
const CLOSE_MARK = /^<!--\s*\/@([A-Za-z0-9][A-Za-z0-9_-]*)\s*-->$/;

/**
 * Adds context to tokens: tok.stack (open ancestors), tok.parent, tok.partial (outermost partial
 * marker name or null), start tags get tok.close (matching end token) and tok.children (count of
 * child elements). Returns toks.
 */
function annotate(html, toks) {
  const stack = [];
  const marks = [];
  for (const t of toks) {
    t.partial = marks.length ? marks[0] : null;
    if (t.type === 'comment') {
      const raw = html.slice(t.start, t.end);
      let m;
      if ((m = OPEN_MARK.exec(raw))) { t.mark = { open: true, name: m[1] }; marks.push(m[1]); }
      else if ((m = CLOSE_MARK.exec(raw))) {
        t.mark = { open: false, name: m[1] };
        const k = marks.lastIndexOf(m[1]);
        if (k >= 0) marks.splice(k);
        t.partial = marks.length ? marks[0] : m[1];
      }
      continue;
    }
    t.stack = stack.slice();
    t.parent = stack.length ? stack[stack.length - 1] : null;
    if (t.type === 'start') {
      if (t.parent) t.parent.children = (t.parent.children || 0) + 1;
      if (!VOID.has(t.name) && !t.selfClosing) stack.push(t);
    } else if (t.type === 'end') {
      for (let k = stack.length - 1; k >= 0; k--) {
        if (stack[k].name === t.name) { stack[k].close = t; stack.length = k; break; }
      }
    }
  }
  return toks;
}

function attr(tok, name) {
  if (!tok || !tok.attrs) return null;
  for (const a of tok.attrs) if (a.name === name) return a;
  return null;
}
function attrVal(tok, name) { const a = attr(tok, name); return a ? (a.value == null ? '' : a.value) : null; }

// ------------------------------------------------------------------------------------------
// Entities and escaping
// ------------------------------------------------------------------------------------------

const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®', trade: '™',
  hellip: '…', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“',
  middot: '·', bull: '•', rarr: '→', larr: '←', times: '×', iexcl: '¡', iquest: '¿',
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ', uuml: 'ü',
  Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Ntilde: 'Ñ', Uuml: 'Ü',
  laquo: '«', raquo: '»', deg: '°', thinsp: ' ', ensp: ' ', emsp: ' ', shy: '­', zwj: '‍', zwnj: '‌'
};
function decodeEntities(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, e) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return String.fromCodePoint(cp); } catch (x) { return m; }
    }
    return Object.prototype.hasOwnProperty.call(NAMED, e) ? NAMED[e] : m;
  });
}
function escapeText(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function escapeAttr(s, quote) {
  let v = String(s).replace(/&/g, '&amp;');
  if (quote === "'") v = v.replace(/'/g, '&#39;');
  else v = v.replace(/"/g, '&quot;');
  return v;
}

// ------------------------------------------------------------------------------------------
// Language-neutral text
// ------------------------------------------------------------------------------------------

/** Words that read the same on English and Spanish pages (names, products, the DEMO label). */
const NEUTRAL = [
  'Young Democrats of Seminole County', 'Young Dems', 'YDSC', 'DEMO', 'Seminole', 'Sanford', 'Lake Mary', 'Oviedo',
  'Winter Springs', 'Altamonte Springs', 'Altamonte', 'Casselberry', 'Longwood', 'Geneva', 'Chuluota', 'Lake Monroe',
  'Lake Jesup', 'Riverwalk', 'SunRail', 'LYNX', 'Big Tree Park', 'Wekiva', 'Florida', 'FL', 'ActBlue', 'Instagram',
  'TikTok', 'WhatsApp', 'YouTube', 'Bluesky', 'Threads', 'Facebook', 'Telegram', 'Signal', 'iMessage', 'Google',
  'Outlook', 'Office 365', 'Apple', 'iCal', 'Mobilize', 'Netlify', 'Cloudflare', 'X', 'YD', 'Instagram Stories',
  'voteseminole.gov', 'semdems.com', 'youngsemdems', 'Gen Z', 'LGBTQ+', 'ASL', 'Celery City', 'The Senator', 'Phoenix'
];
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"']+|\b[a-z0-9.-]+\.(?:gov|com|org|net|edu|us)(?:\/[^\s<>"']*)?/gi;
const EMAIL_RE = /\b[^\s@<>"']+@[^\s@<>"']+\.[a-z]{2,}\b/gi;
const HANDLE_RE = /(^|\s)@[\w.]+/g;
let neutralRe = null, neutralKey = '';
function neutralRegex(extra) {
  const list = NEUTRAL.concat(extra || []);
  const key = list.join('|');
  if (neutralRe && neutralKey === key) return neutralRe;
  const parts = list.slice().sort((a, b) => b.length - a.length).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  neutralRe = new RegExp('(^|[^\\p{L}\\p{N}])(?:' + parts.join('|') + ')(?=$|[^\\p{L}\\p{N}])', 'gu');
  neutralKey = key;
  return neutralRe;
}
/** True when the text has no words that need translating. */
function isNeutral(s, extra) {
  let t = decodeEntities(String(s == null ? '' : s));
  if (!/\p{L}/u.test(t)) return true;
  t = t.replace(URL_RE, ' ').replace(EMAIL_RE, ' ').replace(HANDLE_RE, ' ');
  t = t.replace(neutralRegex(extra), '$1 ');
  return !/\p{L}/u.test(t);
}

// ------------------------------------------------------------------------------------------
// Data (strings, page copy, config tokens)
// ------------------------------------------------------------------------------------------

function loadData(root) {
  const sandbox = { console: { log() {}, warn() {}, error() {}, info() {} } };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.YSD_DATA = {};
  vm.createContext(sandbox);
  const notes = [];
  const files = [];
  if (fs.existsSync(path.join(root, 'data', 'strings.js'))) files.push('data/strings.js');
  const pd = path.join(root, 'data', 'pages');
  try { for (const f of fs.readdirSync(pd).sort()) if (/\.js$/.test(f)) files.push('data/pages/' + f); } catch (e) { /* none yet */ }
  for (const f of files) {
    try { vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), sandbox, { filename: f, timeout: 5000 }); }
    catch (e) { notes.push(f + ' did not load: ' + String(e && e.message || e).split('\n')[0]); }
  }
  let conf = null;
  try { conf = require('./read_config').readConfig(root); } catch (e) { conf = null; }
  return { data: sandbox.YSD_DATA || {}, conf, notes, files };
}

function cfg(conf, p, fb) {
  let o = conf;
  for (const k of String(p).split('.')) { if (o == null || typeof o !== 'object') return fb; o = o[k]; }
  return o === undefined ? fb : o;
}

function lookup(data, key) {
  const k = String(key || '').trim();
  const i = k.indexOf(':');
  if (i < 0) {
    const S = data.strings;
    if (!S) return undefined;
    if (S.entries && S.entries[k] !== undefined) return S.entries[k];
    return undefined;
  }
  const page = k.slice(0, i), sub = k.slice(i + 1);
  const Pg = data.pages && data.pages[page];
  if (!Pg) return undefined;
  if (Pg[sub] !== undefined) return Pg[sub];
  let o = Pg;
  for (const s of sub.split('.')) { if (o == null || typeof o !== 'object') return undefined; o = o[s]; }
  return o;
}

/** {text, error?} for a key in a language. error: missing-key | missing-es | unfilled */
function valueFor(ctx, key, lang) {
  const e = lookup(ctx.data, key);
  if (e === undefined || e === null) return { text: '', error: 'missing-key' };
  let v = typeof e === 'string' ? (lang === 'en' ? e : '') : e[lang];
  if (typeof v !== 'string' || !v.trim()) return { text: '', error: lang === 'en' ? 'missing-en' : 'missing-es' };
  const tokens = (ctx.data.strings && ctx.data.strings.tokens) || {};
  v = v.replace(/\{(\w+)\}/g, (m, k) => {
    const t = tokens[k];
    if (!t) return m;
    const c = t.from ? cfg(ctx.conf, t.from, '') : '';
    return c !== '' && c != null ? String(c) : ((t.fallback && (t.fallback[lang] || t.fallback.en)) || m);
  });
  const left = /\{(\w+)\}/.exec(v);
  return left ? { text: v, error: 'unfilled', detail: left[0] } : { text: v };
}

// ------------------------------------------------------------------------------------------
// Paths
// ------------------------------------------------------------------------------------------

const SKIP_PAGES = new Set(['styleguide.html']);
const NO_TWIN_DIRS = ['assets/', 'data/', 'tools/', 'tests/', 'docs/', 'partials/', 'netlify/', 'functions/', 'vendor/'];
const URL_ATTRS = new Set(['href', 'src', 'poster', 'action', 'formaction', 'data-src', 'data-poster', 'data-href', 'cite']);
const SRCSET_ATTRS = new Set(['srcset', 'imagesrcset', 'data-srcset']);
/** Attributes whose text people read or hear, so they need a Spanish value. */
const VISIBLE_ATTRS = ['alt', 'aria-label', 'aria-description', 'aria-roledescription', 'aria-valuetext', 'placeholder', 'title', 'label'];
const META_TEXT = new Set(['description', 'og:title', 'og:description', 'og:image:alt', 'twitter:title', 'twitter:description',
  'twitter:image:alt', 'apple-mobile-web-app-title', 'application-name', 'og:site_name']);
const OG_TEXT_FIELDS = ['kicker', 'title', 'accent', 'sub', 'cta', 'date', 'time', 'place', 'badge', 'label', 'note'];

function isRelativeUrl(u) {
  if (u == null) return false;
  const s = String(u).trim();
  if (!s || s[0] === '#' || s[0] === '/' || s[0] === '?' || s.startsWith('{{')) return false;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(s)) return false;
  return true;
}
function splitUrl(u) {
  const m = /^([^?#]*)([?#].*)?$/.exec(u);
  return { p: m[1], rest: m[2] || '' };
}
/** Root-relative path that a relative URL points at, from a page directory ('' or 'events/'). */
function resolveRel(dir, p) {
  const j = P.normalize(P.join(dir || '.', p || '.'));
  let out = j === '.' ? '' : j;
  if ((p === '' || p.endsWith('/') || p === '.' || p === './') && out && !out.endsWith('/')) out += '/';
  return out.replace(/^\.\//, '');
}
function relFrom(dir, target) {
  let r = P.relative(dir || '.', target || '.');
  if (target.endsWith('/') && r && !r.endsWith('/')) r += '/';
  if (!r) r = target.endsWith('/') ? './' : P.basename(target);
  return r;
}
function hasTwin(target, ctx) {
  if (target.startsWith('es/')) return false;
  if (NO_TWIN_DIRS.some((d) => target.startsWith(d))) return false;
  const file = target === '' || target.endsWith('/') ? target + 'index.html' : target;
  if (!/\.html?$/i.test(file)) return false;
  if (SKIP_PAGES.has(file)) return false;
  if (ctx && ctx.noTwin && ctx.noTwin.has(file)) return false;
  return true;
}
function prettyPath(rel) {
  let p = '/' + rel.replace(/\\/g, '/');
  if (p.endsWith('/index.html')) p = p.slice(0, -'index.html'.length);
  else if (p.endsWith('.html')) p = p.slice(0, -5);
  return p;
}

// ------------------------------------------------------------------------------------------
// Building the Spanish page
// ------------------------------------------------------------------------------------------

function lineCol(html, pos) {
  let line = 1, last = -1;
  for (let i = html.indexOf('\n'); i >= 0 && i < pos; i = html.indexOf('\n', i + 1)) { line++; last = i; }
  return { line, col: pos - last };
}
function clip(s, n) { s = String(s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
function norm(s) { return decodeEntities(String(s)).replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim(); }

/** Nearest lang attribute among the token's ancestors (not counting <html>), or ''. */
function innerLang(tok) {
  const chain = (tok.stack || []).concat(tok.type === 'start' ? [tok] : []);
  for (let k = chain.length - 1; k >= 0; k--) {
    if (chain[k].name === 'html') break;
    const l = attrVal(chain[k], 'lang');
    if (l != null) return l.toLowerCase();
  }
  return '';
}
function translateNo(tok) {
  const chain = (tok.stack || []).concat(tok.type === 'start' ? [tok] : []);
  for (let k = chain.length - 1; k >= 0; k--) {
    const v = attrVal(chain[k], 'translate');
    if (v != null) return v.toLowerCase() === 'no';
  }
  return false;
}

function partialsInfo(root) {
  const dir = path.join(root, 'partials');
  const names = new Set();
  try { for (const f of fs.readdirSync(dir)) if (/\.html$/.test(f)) names.add(f.slice(0, -5)); } catch (e) { /* none */ }
  return { dir, names, exists: names.size > 0 };
}
const NEEDS_ES = new Set(['demo-banner', 'header', 'footer']);

/**
 * Coverage audit of an English page. Returns {issues:[{kind, severity, line, col, text, key?}]}.
 * kinds: untranslated-text, untranslated-attr, untranslated-og, missing-key, missing-es, unfilled,
 * non-leaf, en-drift (warning), bad-ysd-og, partial-no-es.
 */
function audit(html, toks, ctx, pageRel) {
  const issues = [];
  const add = (kind, pos, text, extra) => {
    const lc = lineCol(html, pos);
    issues.push(Object.assign({ kind, severity: kind === 'en-drift' || kind === 'partial-missing' ? 'warning' : 'error', page: pageRel, line: lc.line, col: lc.col, text: clip(text, 90) }, extra || {}));
  };
  const extra = ctx.neutral || [];
  const checkKey = (key, pos, where) => {
    const r = valueFor(ctx, key, 'es');
    if (r.error === 'missing-key') add('missing-key', pos, where, { key });
    else if (r.error === 'missing-es') add('missing-es', pos, where, { key });
    else if (r.error === 'unfilled') add('unfilled', pos, where + ' ' + r.detail, { key });
    return r;
  };
  let inHead = false, inBody = false;
  const seenPartials = new Set();
  for (const t of toks) {
    if (t.type === 'comment' && t.mark && t.mark.open) {
      const name = t.mark.name;
      if (seenPartials.has(name)) continue;
      seenPartials.add(name);
      const has = ctx.partials.names.has(name), hasEs = ctx.partials.names.has(name + '-es');
      if (!ctx.partials.exists) continue;
      if (!has && !name.endsWith('-es')) add('partial-missing', t.start, '<!-- @' + name + ' --> has no partials/' + name + '.html yet');
      else if (!hasEs && (NEEDS_ES.has(name) || (has && partialHasText(ctx, name)))) add('partial-no-es', t.start, 'partials/' + name + '-es.html is missing');
      continue;
    }
    if (t.partial) continue;
    if (t.type === 'start') {
      if (t.name === 'head') inHead = true;
      if (t.name === 'body') { inBody = true; inHead = false; }
      const tn = translateNo(t);
      const dt = attrVal(t, 'data-t');
      if (dt != null) {
        if (t.children) add('non-leaf', t.start, '<' + t.name + ' data-t="' + dt + '"> has child elements; put data-t on a leaf element', { key: dt });
        const r = checkKey(dt, t.start, '<' + t.name + ' data-t="' + dt + '">');
        if (t.close && !t.children && !r.error) {
          const en = valueFor(ctx, dt, 'en');
          const inner = html.slice(t.end, t.close.start);
          if (!en.error && norm(inner) && norm(inner) !== norm(en.text)) add('en-drift', t.start, 'page says "' + clip(norm(inner), 40) + '", ' + dt + ' says "' + clip(en.text, 40) + '"', { key: dt });
        }
      }
      for (const a of t.attrs) {
        if (a.name.startsWith('data-t-') && a.value) checkKey(a.value, t.start, a.name + '="' + a.value + '"');
      }
      if (t.name === 'a' && dt == null && t.close) {
        const h = attrVal(t, 'href');
        let dir = P.dirname(pageRel) === '.' ? '' : P.dirname(pageRel);
        if (h && isRelativeUrl(h) && resolveRel(dir, splitUrl(h.trim()).p).startsWith('es/') && !t.children && html.slice(t.end, t.close.start).trim())
          add('untranslated-text', t.start, 'language link "' + norm(html.slice(t.end, t.close.start)) + '" needs data-t (lang.switch) so the Spanish page links back in English');
      }
      if (tn) continue;
      const lang = innerLang(t);
      if (lang && !lang.startsWith('en')) continue;
      for (const name of VISIBLE_ATTRS) {
        const a = attr(t, name);
        if (!a || a.value == null || !a.value.trim()) continue;
        if (name === 'label' && ['option', 'optgroup', 'track', 'menuitem'].indexOf(t.name) < 0) continue;
        if (name === 'title' && t.name === 'link') continue;
        if (attr(t, 'data-t-' + name)) continue;
        if (isNeutral(a.value, extra)) continue;
        add('untranslated-attr', a.start, '<' + t.name + ' ' + name + '="' + a.value + '">');
      }
      if (t.name === 'input') {
        const ty = (attrVal(t, 'type') || '').toLowerCase();
        const v = attr(t, 'value');
        if (['submit', 'button', 'reset'].indexOf(ty) >= 0 && v && v.value && !attr(t, 'data-t-value') && !isNeutral(v.value, extra)) add('untranslated-attr', v.start, '<input value="' + v.value + '">');
      }
      if (t.name === 'meta') {
        const key = (attrVal(t, 'property') || attrVal(t, 'name') || '').toLowerCase();
        const c = attr(t, 'content');
        if (META_TEXT.has(key) && c && c.value && !attr(t, 'data-t-content') && !isNeutral(c.value, extra)) add('untranslated-attr', c.start, '<meta ' + key + ' content="' + c.value + '">');
        if (key === 'ysd:og' && c) {
          let og = null;
          try { og = JSON.parse(c.value); } catch (e) { add('bad-ysd-og', c.start, 'ysd:og content is not valid JSON'); }
          if (og) {
            for (const f of OG_TEXT_FIELDS) {
              if (typeof og[f] !== 'string' || isNeutral(og[f], extra)) continue;
              const k = og.keys && og.keys[f];
              const es = og.es && og.es[f];
              if (k) checkKey(k, c.start, 'ysd:og ' + f);
              else if (!(typeof es === 'string' && es.trim())) add('untranslated-og', c.start, 'ysd:og "' + f + '": ' + og[f]);
            }
          }
        }
      }
      continue;
    }
    if (t.type !== 'text') continue;
    const raw = html.slice(t.start, t.end);
    if (!raw.trim()) continue;
    if (inHead && !(t.parent && t.parent.name === 'title')) continue;
    if (t.parent && attr(t.parent, 'data-t')) continue;
    if (t.stack.some((s) => attr(s, 'data-t'))) continue; // reported as non-leaf on the element
    if (translateNo(t)) continue;
    const lang = innerLang(t);
    if (lang && !lang.startsWith('en')) continue;
    if (isNeutral(raw, extra)) continue;
    add('untranslated-text', t.start, decodeEntities(raw));
  }
  return { issues };
}

function partialHasText(ctx, name) {
  if (!ctx.partialText) ctx.partialText = {};
  if (ctx.partialText[name] !== undefined) return ctx.partialText[name];
  let html = '';
  try { html = fs.readFileSync(path.join(ctx.partials.dir, name + '.html'), 'utf8'); } catch (e) { return (ctx.partialText[name] = false); }
  const toks = annotate(html, tokenize(html));
  let found = false;
  for (const t of toks) {
    if (t.type === 'text' && !t.partial && html.slice(t.start, t.end).trim() && !isNeutral(html.slice(t.start, t.end), ctx.neutral)) {
      if (t.parent && (t.parent.name === 'title')) continue;
      found = true; break;
    }
    if (t.type === 'start' && !t.partial) {
      for (const n of VISIBLE_ATTRS) { const a = attr(t, n); if (a && a.value && !isNeutral(a.value, ctx.neutral)) { found = true; break; } }
      if (found) break;
    }
  }
  return (ctx.partialText[name] = found);
}

function applyEdits(html, edits) {
  const sorted = edits.map((e, i) => Object.assign({ i }, e)).sort((a, b) => (b.start - a.start) || (b.i - a.i));
  let out = html;
  for (const e of sorted) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}
function setAttrEdit(html, tok, name, value, edits) {
  const a = attr(tok, name);
  if (a && a.vStart >= 0) {
    edits.push({ start: a.vStart, end: a.vEnd, text: escapeAttr(value, a.quote || '"') });
    if (!a.quote) { edits[edits.length - 1].start = a.vStart; edits[edits.length - 1].text = '"' + escapeAttr(value, '"') + '"'; }
  } else if (a) {
    edits.push({ start: a.end, end: a.end, text: '="' + escapeAttr(value, '"') + '"' });
  } else {
    const pos = tok.selfClosing ? html.lastIndexOf('/', tok.end - 1) : tok.end - 1;
    edits.push({ start: pos, end: pos, text: ' ' + name + '="' + escapeAttr(value, '"') + '"' });
  }
}
/** Remove a whole tag, plus its line when it sits alone on one. */
function removeTagEdit(html, tok, edits) {
  let s = tok.start, e = tok.end;
  const ls = html.lastIndexOf('\n', s - 1) + 1;
  let le = html.indexOf('\n', e); if (le < 0) le = html.length;
  if (!html.slice(ls, s).trim() && !html.slice(e, le).trim()) { s = ls; e = Math.min(html.length, le + 1); }
  edits.push({ start: s, end: e, text: '' });
}

function hreflangLinks(enRel, isEs, ctx) {
  const site = String(cfg(ctx.conf, 'site.url', '') || '').replace(/\/+$/, '');
  const esRel = 'es/' + enRel;
  let en, es;
  if (site) { en = site + prettyPath(enRel); es = site + prettyPath(esRel); }
  else {
    const dir = P.dirname(isEs ? esRel : enRel);
    const d = dir === '.' ? '' : dir;
    en = relFrom(d, enRel);
    es = relFrom(d, esRel);
  }
  return [['en', en], ['es', es], ['x-default', en]];
}
function hreflangEdits(html, toks, links, edits) {
  let anchor = null, headClose = null, indent = '  ';
  for (const t of toks) {
    if (t.type === 'comment' && t.mark && !t.mark.open && t.mark.name === 'head') anchor = t;
    if (t.type === 'end' && t.name === 'head' && !headClose) headClose = t;
    if (t.type === 'start' && t.name === 'link' && !t.partial) {
      const rel = (attrVal(t, 'rel') || '').toLowerCase();
      if (rel.split(/\s+/).indexOf('alternate') >= 0 && attr(t, 'hreflang')) removeTagEdit(html, t, edits);
    }
  }
  if (!links || !links.length) return;
  const at = anchor || headClose;
  if (!at) return;
  const ls = html.lastIndexOf('\n', at.start - 1) + 1;
  const lead = html.slice(ls, at.start);
  if (!lead.trim()) indent = lead;
  const block = links.map(([l, h]) => indent + '<link rel="alternate" hreflang="' + l + '" href="' + escapeAttr(h, '"') + '">').join('\n');
  if (anchor) edits.push({ start: anchor.end, end: anchor.end, text: '\n' + block });
  else {
    // before </head>, on its own lines
    if (!lead.trim()) edits.push({ start: ls, end: ls, text: block + '\n' });
    else edits.push({ start: headClose.start, end: headClose.start, text: '\n' + block + '\n' });
  }
}

function rewriteUrl(u, enDir, esDir, ctx) {
  if (!isRelativeUrl(u)) return u;
  const lead = /^\s*/.exec(u)[0], trail = /\s*$/.exec(u)[0];
  const { p, rest } = splitUrl(u.trim());
  const target = resolveRel(enDir, p);
  let newTarget;
  if (target.startsWith('es/')) newTarget = target.slice(3);
  else if (hasTwin(target, ctx)) newTarget = 'es/' + target;
  else newTarget = target;
  return lead + relFrom(esDir, newTarget) + rest + trail;
}
function esImageUrl(u, enDir, esDir) {
  const s = String(u || '').trim();
  if (!s) return s;
  if (/^https?:\/\//i.test(s) || s[0] === '/') {
    return /\/assets\/img\/og\/es\//.test(s) ? s : s.replace(/\/assets\/img\/og\//, '/assets/img/og/es/');
  }
  if (!isRelativeUrl(s)) return s;
  const { p, rest } = splitUrl(s);
  let target = resolveRel(enDir, p);
  if (target.startsWith('assets/img/og/') && !target.startsWith('assets/img/og/es/')) target = 'assets/img/og/es/' + target.slice('assets/img/og/'.length);
  return relFrom(esDir, target) + rest;
}
function rewriteStyleUrls(css, enDir, esDir, ctx) {
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (m, q, u) => isRelativeUrl(u) && !/^data:/i.test(u) ? 'url(' + q + rewriteUrl(u, enDir, esDir, ctx) + q + ')' : m);
}

/**
 * Build the Spanish page (and the English page's new hreflang) in memory.
 * Returns {enRel, esRel, en: newEnglishHtml, es: spanishHtml, issues}.
 */
function buildPage(root, enRel, ctx) {
  const enPath = path.join(root, enRel);
  const html = fs.readFileSync(enPath, 'utf8');
  const toks = annotate(html, tokenize(html));
  const { issues } = audit(html, toks, ctx, enRel);
  const esRel = 'es/' + enRel;
  let enDir = P.dirname(enRel) === '.' ? '' : P.dirname(enRel);
  let esDir = P.dirname(esRel);
  const edits = [];
  let noindex = false;
  for (const t of toks) {
    if (t.type === 'start' && t.name === 'meta' && (attrVal(t, 'name') || '').toLowerCase() === 'robots' && /noindex/i.test(attrVal(t, 'content') || '')) noindex = true;
  }
  // <base href>: relative URLs resolve against it, not the file's folder.
  for (const t of toks) {
    if (t.type === 'start' && t.name === 'base' && !t.partial) {
      const h = attrVal(t, 'href');
      if (h != null && h.startsWith('/')) {
        enDir = '';
        esDir = 'es';
        const nh = h.replace(/^\/(es\/)?/, '/es/');
        setAttrEdit(html, t, 'href', nh, edits);
      }
    }
  }
  const skipHreflang = noindex || /(^|\/)(404|offline)\.html$/.test(enRel);
  const enEdits = [];
  hreflangEdits(html, toks, skipHreflang ? [] : hreflangLinks(enRel, false, ctx), enEdits);
  const enOut = applyEdits(html, enEdits);

  for (const t of toks) {
    if (t.type === 'comment' && t.mark) {
      const name = t.mark.name;
      if (!name.endsWith('-es') && (ctx.partials.names.has(name + '-es') || (!ctx.partials.exists && NEEDS_ES.has(name)))) {
        const raw = html.slice(t.start, t.end);
        edits.push({ start: t.start, end: t.end, text: raw.replace('@' + name, '@' + name + '-es') });
      }
      continue;
    }
    if (t.partial) continue;
    if (t.type === 'raw' && t.parent && t.parent.name === 'style') {
      const css = html.slice(t.start, t.end);
      const nc = rewriteStyleUrls(css, enDir, esDir, ctx);
      if (nc !== css) edits.push({ start: t.start, end: t.end, text: nc });
      continue;
    }
    if (t.type !== 'start') continue;
    if (t.name === 'html') { setAttrEdit(html, t, 'lang', 'es', edits); continue; }
    if (t.name === 'link' && /(^|\s)alternate(\s|$)/i.test(attrVal(t, 'rel') || '') && attr(t, 'hreflang')) continue; // rewritten below
    if (t.name === 'base') continue;
    const dt = attrVal(t, 'data-t');
    if (dt != null && t.close && !t.children) {
      const r = valueFor(ctx, dt, 'es');
      if (!r.error || r.error === 'unfilled') {
        const inner = html.slice(t.end, t.close.start);
        const lead = /^\s*/.exec(inner)[0];
        const trail = inner.trim() ? /\s*$/.exec(inner)[0] : '';
        edits.push({ start: t.end, end: t.close.start, text: lead + escapeText(r.text) + trail });
      }
    }
    for (const a of t.attrs) {
      if (a.name.startsWith('data-t-') && a.value) {
        const target = a.name.slice(7);
        if (!target) continue;
        const r = valueFor(ctx, a.value, 'es');
        if (!r.error || r.error === 'unfilled') setAttrEdit(html, t, target, r.text, edits);
      }
    }
    if (t.name === 'a') {
      // A language link (into es/ on the English page) becomes the link back to English.
      const h = attrVal(t, 'href');
      if (h && isRelativeUrl(h) && resolveRel(enDir, splitUrl(h.trim()).p).startsWith('es/')) {
        if ((attrVal(t, 'hreflang') || '').toLowerCase() === 'es') setAttrEdit(html, t, 'hreflang', 'en', edits);
        if ((attrVal(t, 'lang') || '').toLowerCase() === 'es') setAttrEdit(html, t, 'lang', 'en', edits);
      }
    }
    for (const a of t.attrs) {
      if (a.value == null || a.vStart < 0) continue;
      if (a.name.startsWith('data-t')) continue;
      if (URL_ATTRS.has(a.name)) {
        const nu = rewriteUrl(a.value, enDir, esDir, ctx);
        if (nu !== a.value) setAttrEdit(html, t, a.name, nu, edits);
      } else if (SRCSET_ATTRS.has(a.name)) {
        const nv = a.value.split(',').map((part) => {
          const m = /^(\s*)(\S+)(.*)$/.exec(part);
          return m ? m[1] + rewriteUrl(m[2], enDir, esDir, ctx) + m[3] : part;
        }).join(',');
        if (nv !== a.value) setAttrEdit(html, t, a.name, nv, edits);
      } else if (a.name === 'style' && /url\(/i.test(a.value)) {
        const nv = rewriteStyleUrls(a.value, enDir, esDir, ctx);
        if (nv !== a.value) setAttrEdit(html, t, 'style', nv, edits);
      }
    }
    if (t.name === 'meta') {
      const key = (attrVal(t, 'property') || attrVal(t, 'name') || '').toLowerCase();
      const c = attr(t, 'content');
      if (!c || c.value == null) continue;
      if (key === 'og:image' || key === 'og:image:url' || key === 'og:image:secure_url' || key === 'twitter:image') {
        const nv = esImageUrl(c.value, enDir, esDir);
        if (nv !== c.value) setAttrEdit(html, t, 'content', nv, edits);
      } else if (key === 'og:locale' || key === 'og:locale:alternate') {
        const nv = c.value === 'en_US' ? 'es_US' : c.value === 'es_US' ? 'en_US' : c.value;
        if (nv !== c.value) setAttrEdit(html, t, 'content', nv, edits);
      } else if (key === 'ysd:og') {
        let og = null;
        try { og = JSON.parse(c.value); } catch (e) { og = null; }
        if (og) {
          const out = Object.assign({}, og);
          delete out.es;
          if (og.keys) for (const f of Object.keys(og.keys)) {
            const r = valueFor(ctx, og.keys[f], 'es');
            if (!r.error || r.error === 'unfilled') out[f] = r.text;
          }
          if (og.es && typeof og.es === 'object') Object.assign(out, og.es);
          out.lang = 'es';
          setAttrEdit(html, t, 'content', JSON.stringify(out), edits);
        }
      }
    }
  }
  hreflangEdits(html, toks, skipHreflang ? [] : hreflangLinks(enRel, true, ctx), edits);
  const esOut = applyEdits(html, edits);
  return { enRel, esRel, en: enOut, es: esOut, issues, changedEn: enOut !== html };
}

/** Blank out everything between partial markers, so a synced page compares equal to a fresh build. */
function stripPartials(html) {
  let prev, out = String(html).replace(/\r\n/g, '\n');
  do {
    prev = out;
    out = out.replace(/<!--\s*@([A-Za-z0-9][A-Za-z0-9_-]*)\s*-->[\s\S]*?<!--\s*\/@\1\s*-->/g, '<!-- @$1 --><!-- /@$1 -->');
  } while (out !== prev);
  return out;
}

// ------------------------------------------------------------------------------------------
// CLI
// ------------------------------------------------------------------------------------------

function parseArgs(argv) {
  const o = { root: ROOT, pages: [], all: false, check: false, sync: true, json: false, quiet: false, strict: false, neutral: [], help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => { if (i + 1 >= argv.length) throw new Error(a + ' needs a value'); return argv[++i]; };
    if (a === '--all') o.all = true;
    else if (a === '--check') o.check = true;
    else if (a === '--root') o.root = path.resolve(val());
    else if (a === '--no-sync') o.sync = false;
    else if (a === '--json') o.json = true;
    else if (a === '--quiet') o.quiet = true;
    else if (a === '--strict') o.strict = true;
    else if (a === '--neutral') o.neutral = o.neutral.concat(val().split(',').map((s) => s.trim()).filter(Boolean));
    else if (a === '--pages') o.pages = o.pages.concat(val().split(',').map((s) => s.trim()).filter(Boolean));
    else if (a === '-h' || a === '--help') o.help = true;
    else if (a.startsWith('--')) throw new Error('unknown option ' + a);
    else o.pages.push(a);
  }
  return o;
}

function allPages(root) {
  let files = [];
  try { files = fs.readdirSync(root).filter((f) => /\.html$/i.test(f) && fs.statSync(path.join(root, f)).isFile()); } catch (e) { files = []; }
  return files.filter((f) => !SKIP_PAGES.has(f) && !f.startsWith('_')).filter((f) => {
    const head = fs.readFileSync(path.join(root, f), 'utf8').slice(0, 4000);
    return !/<html[^>]*\sdata-es\s*=\s*["']?skip/i.test(head) && !/<meta[^>]+name=["']ysd:es["'][^>]+content=["']skip/i.test(head);
  }).sort((a, b) => (a === 'index.html' ? -1 : b === 'index.html' ? 1 : a.localeCompare(b)));
}

function run(opts) {
  const root = opts.root;
  const report = { tool: 'tools/make_es.js', mode: opts.check ? 'check' : 'write', root, pages: [], written: [], notes: [], errors: 0, warnings: 0 };
  const loaded = loadData(root);
  report.notes.push(...loaded.notes);
  if (!loaded.data.strings) report.notes.push('data/strings.js has no strings; every key will be missing');
  const ctx = { data: loaded.data, conf: loaded.conf, partials: partialsInfo(root), neutral: opts.neutral || [], noTwin: new Set() };
  if (!ctx.partials.exists) report.notes.push('partials/ has no partial files yet: assumed demo-banner, header and footer will have -es variants');
  let pages = opts.pages.slice();
  if (!pages.length || opts.all) pages = Array.from(new Set(pages.concat(allPages(root))));
  pages = pages.map((p) => p.replace(/\\/g, '/').replace(/^\.\//, ''));
  for (const f of fs.existsSync(root) ? fs.readdirSync(root) : []) if (SKIP_PAGES.has(f)) ctx.noTwin.add(f);
  if (!pages.length) { report.notes.push('no pages yet; nothing to do'); return report; }
  const toSync = [];
  for (const rel of pages) {
    const pr = { page: rel, es: 'es/' + rel, status: 'ok', issues: [] };
    report.pages.push(pr);
    if (rel.startsWith('es/')) { pr.status = 'error'; pr.issues.push({ kind: 'bad-input', severity: 'error', text: 'pass the English page, not ' + rel }); continue; }
    if (!fs.existsSync(path.join(root, rel))) { pr.status = 'error'; pr.issues.push({ kind: 'bad-input', severity: 'error', text: rel + ' not found' }); continue; }
    let b;
    try { b = buildPage(root, rel, ctx); } catch (e) { pr.status = 'error'; pr.issues.push({ kind: 'crash', severity: 'error', text: String(e && e.stack || e).split('\n').slice(0, 3).join(' | ') }); continue; }
    pr.issues.push(...b.issues);
    const esPath = path.join(root, b.esRel);
    const onDisk = fs.existsSync(esPath) ? fs.readFileSync(esPath, 'utf8') : null;
    const same = onDisk != null && stripPartials(onDisk) === stripPartials(b.es);
    if (opts.check) {
      if (onDisk == null) pr.issues.push({ kind: 'es-missing', severity: 'error', text: b.esRel + ' does not exist: run node tools/make_es.js ' + rel });
      else if (!same) pr.issues.push({ kind: 'es-stale', severity: 'error', text: b.esRel + ' is out of date: run node tools/make_es.js ' + rel });
      if (b.changedEn) pr.issues.push({ kind: 'hreflang-stale', severity: 'error', text: rel + ' hreflang links are missing or out of date: run node tools/make_es.js ' + rel });
    } else {
      if (b.changedEn) { fs.writeFileSync(path.join(root, rel), b.en); report.written.push(rel); }
      if (!same) {
        fs.mkdirSync(path.dirname(esPath), { recursive: true });
        fs.writeFileSync(esPath, b.es);
        report.written.push(b.esRel);
        toSync.push(esPath);
      }
    }
    const errs = pr.issues.filter((x) => x.severity === 'error').length;
    pr.status = errs ? 'error' : pr.issues.length ? 'warning' : 'ok';
  }
  if (!opts.check && opts.sync && toSync.length && ctx.partials.exists) {
    const r = spawnSync('python3', [path.join(__dirname, 'sync_partials.py'), '--root', root, '--quiet'].concat(toSync), { encoding: 'utf8' });
    report.sync = { code: r.status, out: ((r.stdout || '') + (r.stderr || '')).trim() };
    if (r.status !== 0) report.notes.push('sync_partials.py exited ' + r.status + ': ' + report.sync.out.split('\n').slice(-3).join(' | '));
  }
  for (const p of report.pages) for (const i of p.issues) { if (i.severity === 'error') report.errors++; else report.warnings++; }
  return report;
}

const KIND_LABEL = {
  'untranslated-text': 'untranslated text', 'untranslated-attr': 'untranslated attribute', 'untranslated-og': 'untranslated ysd:og',
  'missing-key': 'key not found', 'missing-es': 'no Spanish value', unfilled: 'placeholder', 'non-leaf': 'data-t on non-leaf',
  'en-drift': 'English differs', 'bad-ysd-og': 'bad ysd:og', 'partial-no-es': 'no -es partial', 'partial-missing': 'partial missing',
  'es-missing': 'es page missing', 'es-stale': 'es page stale', 'hreflang-stale': 'hreflang stale', 'bad-input': 'bad input', crash: 'crash'
};

function printReport(report, opts) {
  const L = [];
  for (const n of report.notes) L.push('note: ' + n);
  for (const p of report.pages) {
    const untr = p.issues.filter((i) => /^untranslated/.test(i.kind)).length;
    const miss = p.issues.filter((i) => i.kind === 'missing-key' || i.kind === 'missing-es').length;
    const mark = p.status === 'ok' ? 'ok  ' : p.status === 'warning' ? 'warn' : 'FAIL';
    L.push(`${mark} ${p.page} -> ${p.es}: ${untr} untranslated, ${miss} missing Spanish` + (p.issues.length - untr - miss ? `, ${p.issues.length - untr - miss} other` : ''));
    if (opts.quiet && p.status !== 'error') continue;
    for (const i of p.issues) {
      if (opts.quiet && i.severity !== 'error') continue;
      L.push(`     ${i.severity === 'error' ? 'error' : 'warn '} ${i.line ? p.page + ':' + i.line + ':' + i.col + ' ' : ''}${KIND_LABEL[i.kind] || i.kind}${i.key ? ' [' + i.key + ']' : ''}: ${i.text}`);
    }
  }
  if (report.written.length) L.push('wrote ' + report.written.join(', '));
  L.push(`make_es: ${report.pages.length} pages, ${report.errors} errors, ${report.warnings} warnings (${report.mode})`);
  return L.join('\n');
}

function main(argv) {
  let opts;
  try { opts = parseArgs(argv); } catch (e) { console.error('make_es: ' + e.message); return 2; }
  if (opts.help) {
    console.log('Usage: node tools/make_es.js [--all | page.html ...] [--check] [--root DIR] [--no-sync] [--json] [--quiet] [--strict] [--neutral "A,B"]');
    return 0;
  }
  let report;
  try { report = run(opts); } catch (e) { console.error('make_es crashed: ' + (e && e.stack || e)); return 2; }
  if (opts.json) console.log(JSON.stringify(report, null, 2));
  else console.log(printReport(report, opts));
  if (report.pages.some((p) => p.issues.some((i) => i.kind === 'bad-input' || i.kind === 'crash'))) return 2;
  // Writing always succeeds when the pages could be built; --check (or --strict) is the gate.
  if (opts.check || opts.strict) return report.errors || (opts.strict && report.warnings) ? 1 : 0;
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = {
  run, main, parseArgs, tokenize, annotate, attr, attrVal, decodeEntities, escapeText, escapeAttr, isNeutral, loadData, lookup,
  valueFor, buildPage, audit, prettyPath, stripPartials, translateNo, innerLang, partialsInfo, VISIBLE_ATTRS, META_TEXT, NEUTRAL,
  OG_TEXT_FIELDS, VOID, cfg
};
