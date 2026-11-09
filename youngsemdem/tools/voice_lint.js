#!/usr/bin/env node
/**
 * tools/voice_lint.js: checks site copy against the voice and brand-safety rules (BRIEF 0, 1.3, 2.3
 * to 2.6, 9; report 05 4 to 6). Rules live in tools/voice_rules.json.
 *
 *   node tools/voice_lint.js                       # every page, partial and data file
 *   node tools/voice_lint.js index.html data/events.js es/
 *   node tools/voice_lint.js --json | --quiet | --only candidate-names,ages-40-and-under
 *
 * What it reads:
 *   - HTML (pages and partials/*.html): visible text by block (headings, paragraphs, buttons...),
 *     plus alt, aria-label, title, placeholder, value and meta description / og / twitter text.
 *     Script, style and comments are skipped; partial interiors in pages are skipped (lint the
 *     partial itself). Language comes from <html lang> (es/ pages are Spanish).
 *   - data/*.js and data/pages/*.js: every en / es string (and clip captions), with its key path.
 *     Notes, sources, ids, urls and lists of words to avoid (never, avoid, banned...) are skipped.
 * What it checks: banned words (Native imagery, candidate names, slang costume, fossil talk, guilt
 *   and fake urgency, ableist and othering words, "Join the chat", "40 and under", wrong names,
 *   "era", "XP" and game words, "click here", AI features), mail-ballot overclaims ("every request
 *   expires Dec 31"), claims to avoid, am/pm format, builder leftovers; more than one "!" per
 *   block (none in serious copy); emoji in letters, errors, legal, SEO, serious or long copy, more
 *   than one emoji anywhere else, or an emoji that isn't at the end of its line.
 * Exit codes: 0 no errors (warnings allowed), 1 errors found (or warnings with --strict), 2 bad input.
 * Module: require('./tools/voice_lint') exports { run, loadRules, lintText, lintHtml, lintData, countEmoji }.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const es = require('./make_es');

const ROOT = path.resolve(__dirname, '..');
const RULES_FILE = path.join(__dirname, 'voice_rules.json');

// ------------------------------------------------------------------------------------------
// Rules
// ------------------------------------------------------------------------------------------

function loadRules(file) {
  const raw = JSON.parse(fs.readFileSync(file || RULES_FILE, 'utf8'));
  raw.rules = (raw.rules || []).map((r) => {
    const flags = (r.flags || 'iu').replace('g', '') + 'g';
    return Object.assign({}, r, {
      res: (r.patterns || []).map((p) => new RegExp(p, flags)),
      allowRes: (r.allow || []).map((p) => new RegExp(p, (r.flags || 'iu').replace('g', '')))
    });
  });
  raw.skip = new Set(raw.skipKeys || []);
  return raw;
}

// Emoji: Extended_Pictographic, minus symbols that are ordinary typography here.
const EMOJI_RE = /(?:\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*|\p{Regional_Indicator}{2})/gu;
const NOT_EMOJI = new Set(['©', '®', '™', '↔', '↕', '↖', '↗', '↘', '↙', '↩', '↪', 'ℹ', 'Ⓜ', '‼', '⁉', '✔', '✖', '✳', '✴', '❇', '〰', '〽', '♠', '♣', '♥', '♦']);
function emojiList(text) {
  const out = [];
  let m;
  EMOJI_RE.lastIndex = 0;
  while ((m = EMOJI_RE.exec(text))) { if (!NOT_EMOJI.has(m[0].replace(/️/g, ''))) out.push({ ch: m[0], index: m.index }); }
  return out;
}
function countEmoji(text) { return emojiList(String(text || '')).length; }

function excerpt(text, index, len) {
  const s = Math.max(0, index - 30), e = Math.min(text.length, index + (len || 0) + 30);
  return (s > 0 ? '…' : '') + text.slice(s, e).replace(/\s+/g, ' ').trim() + (e < text.length ? '…' : '');
}

/**
 * Lint one piece of copy. ctx = { lang: 'en'|'es', scope: 'html'|'data', serious, noEmoji, letter,
 * exclamationLimit }. Returns [{rule, severity, gate, message, suggest, match, excerpt}].
 */
function lintText(text, ctx, rules) {
  const out = [];
  const t = String(text == null ? '' : text);
  if (!t.trim()) return out;
  const lang = ctx.lang === 'es' ? 'es' : 'en';
  for (const r of rules.rules) {
    if (r.lang && r.lang !== 'any' && r.lang !== lang) continue;
    if (r.scope === 'html' && ctx.scope !== 'html') continue;
    if (ctx.only && ctx.only.indexOf(r.id) < 0) continue;
    const spans = [];
    for (const re of r.res) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(t))) {
        if (!m[0]) { re.lastIndex++; continue; }
        const around = t.slice(Math.max(0, m.index - 40), Math.min(t.length, m.index + m[0].length + 40));
        if (r.allowRes.some((a) => a.test(around))) continue;
        // one hit per span: "David Jolly" and "Jolly" are the same finding
        if (spans.some((sp) => m.index < sp[1] && m.index + m[0].length > sp[0])) continue;
        spans.push([m.index, m.index + m[0].length]);
        out.push({ rule: r.id, severity: r.severity, gate: r.gate, category: r.category, message: r.message, suggest: r.suggest, match: m[0], excerpt: excerpt(t, m.index, m[0].length) });
      }
    }
  }
  const only = (id) => !ctx.only || ctx.only.indexOf(id) >= 0;
  const bangs = (t.match(/!/g) || []).length;
  if (ctx.serious && bangs && only('serious-exclamation')) out.push({ rule: 'serious-exclamation', severity: 'error', gate: 'B26', message: 'No exclamation marks in serious copy (BRIEF 2.5).', suggest: 'Facts first, one honest feeling, one action.', match: '!', excerpt: excerpt(t, t.indexOf('!'), 1) });
  else if (ctx.countBangs !== false && bangs > (ctx.exclamationLimit || rules.exclamationsPerBlock || 1) && only('exclamations')) out.push({ rule: 'exclamations', severity: 'error', gate: 'B26', message: bangs + ' exclamation marks in one block; at most ' + (ctx.exclamationLimit || rules.exclamationsPerBlock || 1) + ' per screen (BRIEF 2.3).', suggest: 'Keep the one that matters.', match: '!', excerpt: excerpt(t, t.indexOf('!'), 1) });
  const em = emojiList(t);
  if (em.length && only('emoji')) {
    if (ctx.serious || ctx.noEmoji || ctx.letter || t.length > (rules.longCopyChars || 280)) {
      out.push({ rule: 'emoji', severity: 'error', gate: 'B26', message: 'No emoji in ' + (ctx.serious ? 'serious copy' : ctx.letter ? 'letters' : ctx.noEmoji ? 'errors, notices, legal or SEO copy' : 'long copy') + ' (BRIEF 2.4).', suggest: 'Remove it.', match: em[0].ch, excerpt: excerpt(t, em[0].index, 2) });
    } else if (em.length > 1) {
      out.push({ rule: 'emoji', severity: 'error', gate: 'B26', message: em.length + ' emoji; at most one, at the end of a line (BRIEF 2.4).', suggest: 'Keep one, at the end.', match: em.map((x) => x.ch).join(''), excerpt: excerpt(t, em[0].index, 2) });
    } else {
      const after = t.slice(em[0].index + em[0].ch.length).split('\n')[0];
      if (/[\p{L}\p{N}]/u.test(after)) out.push({ rule: 'emoji-position', severity: 'warning', gate: 'B26', message: 'An emoji goes at the end of the line and never replaces a word (BRIEF 2.4).', suggest: 'Move it to the end.', match: em[0].ch, excerpt: excerpt(t, em[0].index, 2) });
    }
  }
  return out;
}

// ------------------------------------------------------------------------------------------
// HTML
// ------------------------------------------------------------------------------------------

const BLOCK = new Set(['p', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'dt', 'dd', 'td', 'th', 'caption', 'figcaption', 'blockquote', 'summary',
  'button', 'label', 'legend', 'option', 'title', 'textarea', 'div', 'section', 'article', 'aside', 'header', 'footer', 'main', 'nav', 'form',
  'fieldset', 'details', 'dialog', 'ul', 'ol', 'dl', 'table', 'tr', 'figure', 'body', 'address', 'pre']);
const SCREEN = new Set(['section', 'article', 'aside', 'header', 'footer', 'dialog', 'nav', 'form', 'main', 'body']);
const TEXT_ATTRS = ['alt', 'aria-label', 'title', 'placeholder', 'aria-description'];
const META_TEXT = new Set(['description', 'og:title', 'og:description', 'og:image:alt', 'twitter:title', 'twitter:description', 'twitter:image:alt']);

function classOf(tok) { return ' ' + (es.attrVal(tok, 'class') || '') + ' '; }
function isSerious(chain) { return chain.some((t) => / band--serious /.test(classOf(t)) || /^(serious|calm)$/.test(es.attrVal(t, 'data-tone') || '')); }
function isLetter(chain) { return chain.some((t) => / letter /.test(classOf(t))); }
function noEmojiZone(chain) { return chain.some((t) => / (legal|notice|field__error|form__summary|band--serious|letter) /.test(classOf(t)) || t.name === 'form' && false); }

function lintHtml(html, file, rules, opts) {
  opts = opts || {};
  const toks = es.annotate(html, es.tokenize(html));
  let lang = 'en';
  for (const t of toks) if (t.type === 'start' && t.name === 'html') { lang = (es.attrVal(t, 'lang') || 'en').toLowerCase().slice(0, 2); break; }
  if (/(^|\/)es\//.test(file.replace(/\\/g, '/')) && lang === 'en') lang = 'es';
  const isPartial = /(^|\/)partials\//.test(file.replace(/\\/g, '/'));
  if (isPartial && /-es\.html$/.test(file)) lang = 'es';
  const issues = [];
  const lc = (pos) => lineOf(html, pos);
  const push = (list, pos, where) => { for (const i of list) issues.push(Object.assign({ file, line: lc(pos), where }, i)); };
  // Gather text per leaf block, and "!" per screen.
  const blocks = new Map(); // start token -> {text, pos, chain}
  const screens = new Map();
  for (const t of toks) {
    if (t.partial && !isPartial) continue;
    if (t.type === 'start') {
      const chain = t.stack.concat([t]);
      const elLang = es.innerLang(t);
      const l = elLang ? elLang.slice(0, 2) : lang;
      for (const a of TEXT_ATTRS) {
        const v = es.attrVal(t, a);
        if (v && v.trim()) push(lintText(v, { lang: l, scope: 'html', serious: isSerious(chain), noEmoji: true, only: opts.only }, rules), t.start, '<' + t.name + ' ' + a + '>');
      }
      if (t.name === 'input' && /^(submit|button|reset)$/i.test(es.attrVal(t, 'type') || '')) {
        const v = es.attrVal(t, 'value');
        if (v) push(lintText(v, { lang: l, scope: 'html', only: opts.only }, rules), t.start, '<input value>');
      }
      if (t.name === 'meta') {
        const key = (es.attrVal(t, 'property') || es.attrVal(t, 'name') || '').toLowerCase();
        const v = es.attrVal(t, 'content');
        if (META_TEXT.has(key) && v) push(lintText(v, { lang, scope: 'html', noEmoji: true, only: opts.only }, rules), t.start, '<meta ' + key + '>');
        if (key === 'ysd:og' && v) {
          let og = null;
          try { og = JSON.parse(v); } catch (e) { og = null; }
          if (og) for (const f of es.OG_TEXT_FIELDS) if (typeof og[f] === 'string') push(lintText(og[f], { lang: og.lang || lang, scope: 'html', noEmoji: true, only: opts.only }, rules), t.start, 'ysd:og ' + f);
        }
      }
      continue;
    }
    if (t.type !== 'text') continue;
    const raw = html.slice(t.start, t.end);
    if (!raw.trim()) continue;
    const chain = t.stack;
    if (chain.some((s) => s.name === 'head') && !(t.parent && t.parent.name === 'title')) continue;
    let block = null, screen = null;
    for (let k = chain.length - 1; k >= 0; k--) {
      if (!block && BLOCK.has(chain[k].name)) block = chain[k];
      if (!screen && SCREEN.has(chain[k].name)) screen = chain[k];
    }
    const key = block || t;
    const text = es.decodeEntities(raw);
    if (!blocks.has(key)) {
      const elLang = es.innerLang(t);
      blocks.set(key, { text: '', pos: t.start, chain, lang: elLang ? elLang.slice(0, 2) : lang, screen });
    }
    blocks.get(key).text += text;
  }
  for (const [, b] of blocks) {
    const ctx = { lang: b.lang, scope: 'html', serious: isSerious(b.chain), letter: isLetter(b.chain), noEmoji: noEmojiZone(b.chain), countBangs: false, only: opts.only };
    push(lintText(b.text.replace(/\s+/g, ' '), ctx, rules), b.pos, null);
    const sk = b.screen || 'page';
    if (!screens.has(sk)) screens.set(sk, { bangs: 0, pos: b.pos, letter: false, serious: false, text: '' });
    const s = screens.get(sk);
    s.bangs += (b.text.match(/!/g) || []).length;
    s.letter = s.letter || ctx.letter;
    s.serious = s.serious || ctx.serious;
    if (!s.text) s.text = b.text;
  }
  if (!opts.only || opts.only.indexOf('exclamations') >= 0 || opts.only.indexOf('serious-exclamation') >= 0) {
    for (const [, s] of screens) {
      if (s.serious && s.bangs) issues.push({ file, line: lc(s.pos), rule: 'serious-exclamation', severity: 'error', gate: 'B26', message: 'No exclamation marks in serious copy (BRIEF 2.5).', suggest: 'Facts first, one honest feeling, one action.', match: '!', excerpt: es.decodeEntities(s.text).replace(/\s+/g, ' ').trim().slice(0, 80) });
      else if (s.bangs > (rules.exclamationsPerBlock || 1)) issues.push({ file, line: lc(s.pos), rule: 'exclamations', severity: 'error', gate: 'B26', message: s.bangs + ' exclamation marks in one section; at most 1 per screen (BRIEF 2.3).', suggest: 'Keep the one that matters.', match: '!', excerpt: es.decodeEntities(s.text).replace(/\s+/g, ' ').trim().slice(0, 80) });
    }
  }
  return issues;
}

function lineOf(text, pos) {
  let n = 1;
  for (let i = text.indexOf('\n'); i >= 0 && i < pos; i = text.indexOf('\n', i + 1)) n++;
  return n;
}

// ------------------------------------------------------------------------------------------
// Data files
// ------------------------------------------------------------------------------------------

function evalData(file) {
  const sb = { console: { log() {}, warn() {}, error() {}, info() {} } };
  sb.window = sb; sb.self = sb; sb.YSD_DATA = {};
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(file, 'utf8'), sb, { filename: file, timeout: 5000 });
  return sb.YSD_DATA || {};
}

/** Best-effort line of a string literal in the source. */
function findLine(src, s, from) {
  const probes = [];
  const chunk = s.slice(0, 48);
  probes.push(JSON.stringify(chunk).slice(1, -1));
  probes.push(chunk.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n'));
  probes.push(chunk);
  for (const p of probes) {
    if (!p) continue;
    let i = src.indexOf(p, from || 0);
    if (i < 0) i = src.indexOf(p);
    if (i >= 0) return { line: lineOf(src, i), pos: i };
  }
  return { line: 0, pos: from || 0 };
}

function lintData(file, rules, opts) {
  opts = opts || {};
  const rel = path.relative(opts.root || ROOT, file).replace(/\\/g, '/');
  const src = fs.readFileSync(file, 'utf8');
  let data;
  try { data = evalData(file); } catch (e) { return [{ file: rel, line: 0, rule: 'data-load', severity: 'error', gate: 'B26', message: 'Could not evaluate: ' + String(e.message).split('\n')[0], match: '', excerpt: '' }]; }
  const issues = [];
  const noEmojiFile = (rules.noEmojiFiles || []).indexOf(rel) >= 0;
  const prefixes = rules.noEmojiKeyPrefixes || [];
  const serTones = new Set(rules.seriousTones || ['serious', 'calm']);
  const copyKeys = new Set(rules.copyKeys || ['en', 'es']);
  const letterPaths = rules.letterPaths || [];
  let cursor = 0;
  function walk(o, keyPath, ctx) {
    if (o == null) return;
    if (typeof o === 'string') {
      if (!ctx.copy) return;
      const pathStr = keyPath.join('.');
      const isLetter = letterPaths.some((p) => pathStr.startsWith(p)) && /letter|body|intro/i.test(pathStr);
      const entryKey = ctx.entryKey || '';
      const noEmoji = noEmojiFile || prefixes.some((p) => entryKey.startsWith(p)) || /(^|\.)(error|errors|legal|seo|notice)(\.|$)/i.test(pathStr);
      const isShare = /(^|\.)(share|sms|whatsapp|igStory|short|toast)(\.|$)/.test(entryKey + '.' + pathStr);
      const found = lintText(o, { lang: ctx.lang, scope: 'data', serious: ctx.serious, noEmoji: noEmoji && !isShare, letter: isLetter, only: opts.only }, rules);
      if (found.length) {
        const where = findLine(src, o, cursor);
        cursor = where.pos;
        for (const f of found) issues.push(Object.assign({ file: rel, line: where.line, where: pathStr }, f));
      }
      return;
    }
    if (Array.isArray(o)) { o.forEach((x, i) => walk(x, keyPath.concat(String(i)), ctx)); return; }
    if (typeof o !== 'object') return;
    const serious = ctx.serious || serTones.has(o.tone) || o.tone === 'serious';
    for (const k of Object.keys(o)) {
      if (rules.skip.has(k)) continue;
      const v = o[k];
      const sub = Object.assign({}, ctx, { serious });
      if (keyPath.length && keyPath[keyPath.length - 1] === 'entries' || /^[a-z][a-zA-Z0-9]*(\.[A-Za-z0-9_-]+)+$/.test(k)) sub.entryKey = k;
      if (k === 'en' || k === 'es') { sub.lang = k; sub.copy = true; }
      else if (copyKeys.has(k)) { sub.copy = true; sub.lang = sub.lang || 'en'; }
      walk(v, keyPath.concat(k), sub);
    }
  }
  walk(data, [], { lang: 'en', copy: false, serious: false });
  return issues;
}

// ------------------------------------------------------------------------------------------
// CLI
// ------------------------------------------------------------------------------------------

const SKIP_DIRS = new Set(['tools', 'tests', 'docs', 'netlify', 'functions', 'vendor', 'node_modules', 'dist', 'build']);
function defaultTargets(root) {
  const out = [];
  (function walk(dir, rel) {
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const e of ents.sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.name.startsWith('.')) continue;
      const r = rel + e.name;
      if (e.isDirectory()) {
        if (rel === '' && SKIP_DIRS.has(e.name)) continue;
        if (r === 'assets' || r === 'data/slices') continue;
        walk(path.join(dir, e.name), r + '/');
      } else if (/\.html$/i.test(e.name) && e.name !== 'styleguide.html') out.push(r);
      else if (/\.js$/.test(e.name) && /^data\/(pages\/)?[^/]+\.js$/.test(r)) out.push(r);
    }
  })(root, '');
  return out;
}
function expandTargets(root, list) {
  const out = [];
  for (const x of list) {
    const abs = path.resolve(root, x);
    if (!fs.existsSync(abs)) { out.push({ missing: x }); continue; }
    if (fs.statSync(abs).isDirectory()) {
      (function walk(d) {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          const p = path.join(d, e.name);
          if (e.isDirectory()) { if (!e.name.startsWith('.') && e.name !== 'node_modules') walk(p); }
          else if (/\.(html|js)$/.test(e.name)) out.push(path.relative(root, p));
        }
      })(abs);
    } else out.push(path.relative(root, abs));
  }
  return out;
}

function parseArgs(argv) {
  const o = { root: ROOT, files: [], json: false, quiet: false, strict: false, rules: RULES_FILE, only: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => { if (i + 1 >= argv.length) throw new Error(a + ' needs a value'); return argv[++i]; };
    if (a === '--root') o.root = path.resolve(val());
    else if (a === '--json') o.json = true;
    else if (a === '--quiet') o.quiet = true;
    else if (a === '--strict') o.strict = true;
    else if (a === '--rules') o.rules = path.resolve(val());
    else if (a === '--only') o.only = val().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '-h' || a === '--help') o.help = true;
    else if (a.startsWith('--')) throw new Error('unknown option ' + a);
    else o.files.push(a);
  }
  return o;
}

function run(opts) {
  const rules = loadRules(opts.rules);
  const root = opts.root;
  const targets = opts.files.length ? expandTargets(root, opts.files) : defaultTargets(root);
  const report = { tool: 'tools/voice_lint.js', root, files: 0, issues: [], missing: [], errors: 0, warnings: 0 };
  for (const t of targets) {
    if (t.missing) { report.missing.push(t.missing); continue; }
    const abs = path.join(root, t);
    const rel = t.replace(/\\/g, '/');
    report.files++;
    if (/\.html$/i.test(t)) report.issues.push(...lintHtml(fs.readFileSync(abs, 'utf8'), rel, rules, { only: opts.only }));
    else if (/\.js$/.test(t)) report.issues.push(...lintData(abs, rules, { root, only: opts.only }));
  }
  for (const i of report.issues) { if (i.severity === 'error') report.errors++; else report.warnings++; }
  return report;
}

function printReport(report, opts) {
  const L = [];
  for (const m of report.missing) L.push('error: ' + m + ' not found');
  const byFile = {};
  for (const i of report.issues) (byFile[i.file] = byFile[i.file] || []).push(i);
  for (const f of Object.keys(byFile)) {
    for (const i of byFile[f].sort((a, b) => a.line - b.line)) {
      if (opts.quiet && i.severity !== 'error') continue;
      L.push(`${i.file}:${i.line || '?'}  ${i.severity === 'error' ? 'error' : 'warn '}  ${i.rule}  "${i.match}"  ${i.excerpt ? '«' + i.excerpt + '»' : ''}${i.where ? '  [' + i.where + ']' : ''}`);
      if (!opts.quiet && i.suggest) L.push(`      ${i.message} Try: ${i.suggest}`);
      else if (!opts.quiet) L.push(`      ${i.message}`);
    }
  }
  const byRule = {};
  for (const i of report.issues) byRule[i.rule] = (byRule[i.rule] || 0) + 1;
  const top = Object.entries(byRule).sort((a, b) => b[1] - a[1]).map(([r, n]) => r + ' ' + n).join(', ');
  L.push(`voice_lint: ${report.files} files, ${report.errors} errors, ${report.warnings} warnings${top ? ' (' + top + ')' : ''}`);
  return L.join('\n');
}

function main(argv) {
  let opts;
  try { opts = parseArgs(argv); } catch (e) { console.error('voice_lint: ' + e.message); return 2; }
  if (opts.help) { console.log('Usage: node tools/voice_lint.js [files or folders...] [--json] [--quiet] [--strict] [--only rule,rule] [--rules FILE] [--root DIR]'); return 0; }
  let report;
  try { report = run(opts); } catch (e) { console.error('voice_lint crashed: ' + (e && e.stack || e)); return 2; }
  if (opts.json) console.log(JSON.stringify(report, null, 2));
  else console.log(printReport(report, opts));
  if (report.missing.length) return 2;
  return report.errors || (opts.strict && report.warnings) ? 1 : 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { run, main, parseArgs, loadRules, lintText, lintHtml, lintData, countEmoji, emojiList, defaultTargets, RULES_FILE };
