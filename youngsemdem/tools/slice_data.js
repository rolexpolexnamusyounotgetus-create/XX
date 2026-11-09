#!/usr/bin/env node
/**
 * tools/slice_data.js: write a small, generated subset ("slice") of the data files (BRIEF §7.3).
 *
 * Pages that only need part of a big data file load a slice instead: data/slices/core.js (the
 * shared UI strings, on every page) and data/slices/<page>.js (written by each page's owner). A slice
 * keeps the namespaces of the full files (window.YSD_DATA.strings, .events, ...). Slices merge into
 * each other, so core.js + home.js can both add strings entries. A page loads either a slice or the
 * full file for a namespace, never both (the full file would replace the slice anyway).
 *
 * The spec that made a slice is stored in the slice's own header, so it regenerates byte for byte:
 *
 *   node tools/slice_data.js --rerun data/slices/core.js          # same spec, fresh data
 *   node tools/slice_data.js --rerun data/slices/core.js --check  # exit 1 if the file would change
 *   node tools/slice_data.js --spec my-slice.json --out data/slices/home.js
 *   node tools/slice_data.js --all [--check]                      # every data/slices/*.js
 *   node tools/slice_data.js --core                               # (re)write data/slices/core.js
 *
 * Spec (JSON):
 *   {
 *     "name": "home",                      // label only
 *     "description": "What this slice is for",
 *     "asOf": "2026-11-09",                // optional fixed date for "where" filters (keeps reruns stable)
 *     "pick": [
 *       { "file": "data/strings.js",       // a classic data script that sets window.YSD_DATA.<ns>
 *         "ns": "strings",
 *         "copy": ["version", "tokens"],   // dotted paths copied whole
 *         "map": "entries",                // an object of keyed entries ...
 *         "match": ["cta.*", "a11y.*"],    // ... keep the keys matching these globs (* = any run of characters)
 *         "drop": ["note", "confidence"]   // fields removed from every kept map entry / list item
 *       },
 *       { "file": "data/events.js", "ns": "events",
 *         "copy": ["version", "schedule"],
 *         "list": "items",                 // an array ...
 *         "where": "item.start >= asOf",   // ... filtered by a JS expression (item, asOf, index) ...
 *         "sort": "start",                 // ... sorted by a field (prefix "-" for descending) ...
 *         "limit": 6,                      // ... cut to N items ...
 *         "fields": ["id", "title", "start", "end", "cover", "city"]   // ... keeping only these fields
 *       }
 *     ]
 *   }
 * Output is deterministic: keys keep their source order and no timestamps are written.
 * Exit codes: 0 ok, 1 --check found a stale slice, 2 bad input.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const MARK = ' * @slice ';

const CORE_SPEC = {
  name: 'core',
  description: 'Shared UI strings for every page (BRIEF §7.3): a11y, cta, form, error, success, toast, shareSheet, demo, lang, event, count, format, footer, plus tag and brand. Loaded by the scripts partial before assets/js/ui.js.',
  pick: [{
    file: 'data/strings.js',
    ns: 'strings',
    copy: ['version', 'updated', 'status', 'reviewedSpanish', 'langs', 'tokens'],
    map: 'entries',
    match: ['brand.*', 'a11y.*', 'cta.*', 'form.*', 'error.*', 'success.*', 'toast.*', 'shareSheet.*', 'demo.*', 'lang.*', 'event.*', 'count.*', 'format.*', 'footer.*', 'tag.*'],
    drop: ['note', 'confidence', 'recheck', 'max', 'mirror', 'sources']
  }]
};

function fail(msg) { const e = new Error(msg); e.code = 2; throw e; }

function loadNs(file, ns, root) {
  const abs = path.resolve(root, file);
  if (!fs.existsSync(abs)) fail('no such data file: ' + file);
  const sandbox = { window: {}, console: { log() {}, warn() {}, error() {} } };
  sandbox.window.YSD_DATA = {};
  sandbox.self = sandbox.window;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(abs, 'utf8'), sandbox, { filename: abs, timeout: 5000 });
  const data = sandbox.window.YSD_DATA && sandbox.window.YSD_DATA[ns];
  if (data === undefined) fail(file + ' does not set window.YSD_DATA.' + ns);
  return JSON.parse(JSON.stringify(data)); // plain JSON, detached from the sandbox
}

function getPath(obj, dotted) {
  return String(dotted).split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function setPath(obj, dotted, val) {
  const parts = String(dotted).split('.');
  let o = obj;
  for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]] = o[parts[i]] && typeof o[parts[i]] === 'object' ? o[parts[i]] : {};
  o[parts[parts.length - 1]] = val;
}
function globRe(g) { return new RegExp('^' + String(g).split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$'); }
function stripFields(v, drop) {
  if (!drop || !drop.length || !v || typeof v !== 'object' || Array.isArray(v)) return v;
  const out = {};
  for (const k of Object.keys(v)) if (!drop.includes(k)) out[k] = v[k];
  return out;
}

function buildPick(p, spec, root) {
  const src = loadNs(p.file, p.ns, root);
  const out = {};
  for (const c of p.copy || []) {
    const v = getPath(src, c);
    if (v !== undefined) setPath(out, c, v);
  }
  if (p.map) {
    const m = getPath(src, p.map);
    if (!m || typeof m !== 'object') fail(p.file + ': ' + p.map + ' is not an object');
    const res = (p.match || ['*']).map(globRe);
    const kept = {};
    for (const k of Object.keys(m)) if (res.some((r) => r.test(k))) kept[k] = stripFields(m[k], p.drop);
    setPath(out, p.map, kept);
  }
  if (p.list) {
    let arr = getPath(src, p.list);
    if (!Array.isArray(arr)) fail(p.file + ': ' + p.list + ' is not an array');
    if (p.where) {
      const fn = new Function('item', 'asOf', 'index', 'return (' + p.where + ');');
      const asOf = spec.asOf || new Date().toISOString().slice(0, 10);
      arr = arr.filter((it, i) => fn(it, asOf, i));
    }
    if (p.sort) {
      const desc = p.sort[0] === '-', key = desc ? p.sort.slice(1) : p.sort;
      arr = arr.slice().sort((a, b) => { const x = getPath(a, key), y = getPath(b, key); return (x > y ? 1 : x < y ? -1 : 0) * (desc ? -1 : 1); });
    }
    if (p.limit) arr = arr.slice(0, p.limit);
    if (p.fields) arr = arr.map((it) => { const o = {}; for (const f of p.fields) { const v = getPath(it, f); if (v !== undefined) setPath(o, f, v); } return o; });
    else arr = arr.map((it) => stripFields(it, p.drop));
    setPath(out, p.list, arr);
  }
  return out;
}

/** JSON with one map entry per line for readable diffs, compact otherwise. */
function serialize(obj) {
  const lines = ['{'];
  const keys = Object.keys(obj);
  keys.forEach((k, i) => {
    const v = obj[k], comma = i < keys.length - 1 ? ',' : '';
    if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length > 3) {
      lines.push('  ' + JSON.stringify(k) + ': {');
      const ks = Object.keys(v);
      ks.forEach((k2, j) => lines.push('    ' + JSON.stringify(k2) + ': ' + JSON.stringify(v[k2]) + (j < ks.length - 1 ? ',' : '')));
      lines.push('  }' + comma);
    } else if (Array.isArray(v)) {
      lines.push('  ' + JSON.stringify(k) + ': [');
      v.forEach((it, j) => lines.push('    ' + JSON.stringify(it) + (j < v.length - 1 ? ',' : '')));
      lines.push('  ]' + comma);
    } else {
      lines.push('  ' + JSON.stringify(k) + ': ' + JSON.stringify(v) + comma);
    }
  });
  lines.push('}');
  return lines.join('\n');
}

function render(spec, outRel, root) {
  if (!spec || !Array.isArray(spec.pick) || !spec.pick.length) fail('spec needs a non-empty "pick" array');
  const byNs = new Map();
  for (const p of spec.pick) {
    if (!p.file || !p.ns) fail('every pick needs "file" and "ns"');
    const part = buildPick(p, spec, root);
    byNs.set(p.ns, Object.assign(byNs.get(p.ns) || {}, part));
  }
  const files = [...new Set(spec.pick.map((p) => p.file))].join(', ');
  const head = [
    '/*! ' + outRel + ' · GENERATED by tools/slice_data.js from ' + files + '. Do not edit by hand.',
    ' * Regenerate: node tools/slice_data.js --rerun ' + outRel,
    ' * ' + (spec.description || ('Slice "' + (spec.name || '') + '".')).replace(/\*\//g, '* /'),
    ' * Slices merge into window.YSD_DATA.<ns> (entries and other plain objects merge key by key), so',
    ' * several slices can share a namespace. Never load the full file for a namespace on the same page.',
    MARK + JSON.stringify(spec).replace(/\*\//g, '*\\/'),
    ' */',
    'window.YSD_DATA = window.YSD_DATA || {};',
    '(function (D, add) {',
    '  for (var ns in add) {',
    '    var cur = D[ns], src = add[ns];',
    '    if (!cur || typeof cur !== "object") { D[ns] = src; continue; }',
    '    for (var k in src) {',
    '      var a = cur[k], b = src[k];',
    '      if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) { for (var j in b) a[j] = b[j]; }',
    '      else cur[k] = b;',
    '    }',
    '  }',
    '})(window.YSD_DATA, {'
  ];
  const nss = [...byNs.keys()];
  const body = nss.map((ns, i) => '  ' + JSON.stringify(ns) + ': ' + serialize(byNs.get(ns)).split('\n').join('\n  ') + (i < nss.length - 1 ? ',' : ''));
  return head.join('\n') + '\n' + body.join('\n') + '\n});\n';
}

function readSpec(file) {
  const txt = fs.readFileSync(file, 'utf8');
  const line = txt.split('\n').find((l) => l.startsWith(MARK));
  if (!line) fail(file + ' has no "@slice" spec line in its header');
  return JSON.parse(line.slice(MARK.length).replace(/\*\\\//g, '*/'));
}

function write(outAbs, text, check) {
  const rel = path.relative(ROOT, outAbs).split(path.sep).join('/');
  const old = fs.existsSync(outAbs) ? fs.readFileSync(outAbs, 'utf8') : null;
  if (check) {
    if (old !== text) { console.log('stale: ' + rel + (old === null ? ' (missing)' : '')); return false; }
    console.log('ok: ' + rel + ' (' + Buffer.byteLength(text) + ' bytes)');
    return true;
  }
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });
  if (old !== text) fs.writeFileSync(outAbs, text);
  console.log((old === text ? 'unchanged: ' : 'wrote: ') + rel + ' (' + Buffer.byteLength(text) + ' bytes)');
  return true;
}

function main(argv) {
  const a = { check: false, rerun: [], spec: null, out: null, all: false, core: false, root: ROOT };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === '--check') a.check = true;
    else if (x === '--all') a.all = true;
    else if (x === '--core') a.core = true;
    else if (x === '--rerun') a.rerun.push(argv[++i]);
    else if (x === '--spec') a.spec = argv[++i];
    else if (x === '--out') a.out = argv[++i];
    else if (x === '--root') a.root = path.resolve(argv[++i]);
    else if (x === '-h' || x === '--help') { console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0]); return 0; }
    else fail('unknown argument: ' + x);
  }
  const jobs = [];
  if (a.core) jobs.push({ spec: CORE_SPEC, out: path.join(a.root, 'data/slices/core.js') });
  if (a.all) {
    const dir = path.join(a.root, 'data/slices');
    for (const f of fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []) if (f.endsWith('.js')) a.rerun.push(path.join(dir, f));
  }
  for (const f of a.rerun) { const abs = path.resolve(f); jobs.push({ spec: readSpec(abs), out: abs }); }
  if (a.spec) {
    if (!a.out) fail('--spec needs --out');
    jobs.push({ spec: JSON.parse(fs.readFileSync(a.spec, 'utf8')), out: path.resolve(a.out) });
  }
  if (!jobs.length) fail('nothing to do: pass --core, --all, --rerun FILE or --spec FILE --out FILE');
  let ok = true;
  for (const j of jobs) {
    const rel = path.relative(a.root, j.out).split(path.sep).join('/');
    ok = write(j.out, render(j.spec, rel, a.root), a.check) && ok;
  }
  return ok ? 0 : 1;
}

if (require.main === module) {
  try { process.exit(main(process.argv.slice(2))); } catch (e) { console.error('slice_data: ' + e.message); process.exit(e.code === 2 ? 2 : 2); }
}
module.exports = { render, readSpec, CORE_SPEC, main };
