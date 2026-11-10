#!/usr/bin/env node
/**
 * tools/read_config.js: evaluate assets/js/config.js outside a browser and return YSD_CONFIG.
 *
 * Used by tools/csp.js, tools/check_site.js and tools/make_sitemap.py (which shells out to it),
 * so every tool reads the same values the pages do, including the deep-merged overrides.
 *
 * Load order mirrors a page: assets/js/config.local.js first (optional, git-ignored, sets
 * window.YSD_CONFIG overrides for local work), then any --pre files, then assets/js/config.js.
 *
 * CLI:
 *   node tools/read_config.js [--root DIR] [--pre FILE]... [--no-local] [dotted.path]
 *   prints the whole config (or the value at dotted.path) as JSON; exits 2 if config.js is missing.
 *
 * Module:
 *   const { readConfig, cfg } = require('./read_config');
 *   const conf = readConfig(root, { override: { demo: false }, pre: [], local: true });
 *   cfg(conf, 'site.url', '')
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');

function runInto(ctx, file) {
  const code = fs.readFileSync(file, 'utf8');
  vm.runInContext(code, ctx, { filename: file, timeout: 2000 });
}

/**
 * Evaluate the site's config. Returns a plain object (JSON round-tripped), or null when
 * assets/js/config.js does not exist under root.
 */
function readConfig(root, opts) {
  root = path.resolve(root || ROOT);
  opts = opts || {};
  const main = path.join(root, 'assets', 'js', 'config.js');
  if (!fs.existsSync(main)) return null;
  const ctx = vm.createContext({});
  ctx.window = ctx;
  ctx.self = ctx;
  ctx.console = { log() {}, warn() {}, error() {}, info() {} };
  if (opts.override && typeof opts.override === 'object') ctx.YSD_CONFIG = JSON.parse(JSON.stringify(opts.override));
  const local = path.join(root, 'assets', 'js', 'config.local.js');
  if (opts.local !== false && fs.existsSync(local)) runInto(ctx, local);
  (opts.pre || []).forEach((f) => runInto(ctx, path.resolve(f)));
  runInto(ctx, main);
  return JSON.parse(JSON.stringify(ctx.YSD_CONFIG || {}));
}

/** Read a dotted path from a config object, like YSD.cfg in the browser. */
function cfg(conf, dotted, fallback) {
  let cur = conf;
  const parts = String(dotted || '').split('.').filter(Boolean);
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object' || !(p in cur)) return fallback;
    cur = cur[p];
  }
  return cur === undefined ? fallback : cur;
}

function main(argv) {
  let root = ROOT, local = true, key = '';
  const pre = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root') root = argv[++i];
    else if (a === '--pre') pre.push(argv[++i]);
    else if (a === '--no-local') local = false;
    else if (a === '-h' || a === '--help') {
      process.stdout.write('usage: node tools/read_config.js [--root DIR] [--pre FILE]... [--no-local] [dotted.path]\n');
      return 0;
    } else key = a;
  }
  let conf;
  try {
    conf = readConfig(root, { pre, local });
  } catch (e) {
    process.stderr.write('read_config: could not evaluate config: ' + e.message + '\n');
    return 2;
  }
  if (!conf) {
    process.stderr.write('read_config: no assets/js/config.js under ' + path.resolve(root) + '\n');
    return 2;
  }
  const out = key ? cfg(conf, key, null) : conf;
  process.stdout.write(JSON.stringify(out, null, key ? 0 : 2) + '\n');
  return 0;
}

module.exports = { readConfig, cfg, ROOT };

if (require.main === module) process.exitCode = main(process.argv.slice(2));
