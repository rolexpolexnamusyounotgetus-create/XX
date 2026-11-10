#!/usr/bin/env node
/**
 * tools/manifest.js: keep manifest.webmanifest in step with assets/js/config.js.
 *
 * Copies these values from config into the manifest and leaves every other key (icons, display,
 * scope, start_url, id...) as it is:
 *   name             <- org.name
 *   short_name       <- org.nickname, else org.short (home-screen label; keep it 12 characters or fewer)
 *   description      <- site.description
 *   lang             <- site.lang
 *   background_color <- theme.bg     (placeholder until the design team sets real colours)
 *   theme_color      <- theme.brand
 *
 * CLI:  node tools/manifest.js [--write | --check] [--root DIR]
 *   (no flag) print the manifest it would write; --check exits 1 on drift.
 * Module: const { buildManifest } = require('./manifest');
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { readConfig, cfg, ROOT } = require('./read_config');

function buildManifest(current, conf) {
  const m = Object.assign({}, current || {});
  const set = (k, v) => { if (typeof v === 'string' && v.trim()) m[k] = v.trim(); };
  set('name', cfg(conf, 'org.name', ''));
  set('short_name', cfg(conf, 'org.nickname', '') || cfg(conf, 'org.short', ''));
  set('description', cfg(conf, 'site.description', ''));
  set('lang', cfg(conf, 'site.lang', ''));
  const hex = (v) => (/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(String(v || '')) ? v : '');
  set('background_color', hex(cfg(conf, 'theme.bg', '')));
  set('theme_color', hex(cfg(conf, 'theme.brand', '')));
  return m;
}

function main(argv) {
  let root = ROOT, mode = 'print';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') root = path.resolve(argv[++i]);
    else if (argv[i] === '--write') mode = 'write';
    else if (argv[i] === '--check') mode = 'check';
    else if (argv[i] === '-h' || argv[i] === '--help') { process.stdout.write('usage: node tools/manifest.js [--write|--check] [--root DIR]\n'); return 0; }
    else { process.stderr.write('manifest: unknown argument ' + argv[i] + '\n'); return 2; }
  }
  const file = path.join(root, 'manifest.webmanifest');
  let current;
  try { current = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {
    process.stderr.write('manifest: cannot read ' + file + ': ' + e.message + '\n');
    return 2;
  }
  const conf = readConfig(root);
  if (!conf) { process.stderr.write('manifest: no assets/js/config.js under ' + root + '\n'); return 2; }
  const next = buildManifest(current, conf);
  const text = JSON.stringify(next, null, 2) + '\n';
  if (mode === 'print') { process.stdout.write(text); return 0; }
  const changed = JSON.stringify(current) !== JSON.stringify(next);
  if (mode === 'check') {
    if (changed) { process.stdout.write('manifest: manifest.webmanifest is out of date with config.js; run `node tools/manifest.js --write`.\n'); return 1; }
    process.stdout.write('manifest: manifest.webmanifest matches config.js.\n');
    return 0;
  }
  if (changed) fs.writeFileSync(file, text);
  process.stdout.write('manifest: ' + (changed ? 'updated' : 'unchanged') + ' manifest.webmanifest\n');
  return 0;
}

module.exports = { buildManifest };

if (require.main === module) process.exitCode = main(process.argv.slice(2));
