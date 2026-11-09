#!/usr/bin/env node
/**
 * tools/csp.js: build the site's Content-Security-Policy from assets/js/config.js and keep the
 * copy in _headers in sync.
 *
 * The base policy allows the site itself, Google Fonts (fonts.googleapis.com styles,
 * fonts.gstatic.com font files), Unsplash photos (images.unsplash.com), blob: and data: for
 * media, and nothing else. Hosts are then added from config:
 *   - connect-src: the origin of every configured endpoint that is cross-origin
 *     (integrations.formEndpoint, actionNetwork.endpoint, squadEndpoint, countersEndpoint,
 *     videoUploadEndpoint, analytics.endpoint). Same-origin paths such as /api/video-upload are
 *     already covered by 'self'.
 *   - video provider hosts when integrations.videoUploadEndpoint is set: Cloudflare Stream
 *     (*.videodelivery.net, *.cloudflarestream.com) and/or Mux (*.mux.com, storage.googleapis.com),
 *     chosen by integrations.videoProvider or --video (default: both, since the provider is a
 *     server env var the browser config does not know).
 *   - analytics script and beacon hosts for provider 'plausible' or 'cloudflare'.
 *   - YSD_CONFIG.csp, if present: { 'directive-name': ['source', ...] } extra sources.
 *   - --add "directive source [source...]" on the command line (repeatable).
 *
 * CLI:
 *   node tools/csp.js            print the policy
 *   node tools/csp.js --write    rewrite the Content-Security-Policy line in _headers
 *   node tools/csp.js --check    exit 1 if _headers differs from the generated policy
 *   options: --root DIR, --headers FILE, --video cloudflare|mux|both|none, --add "..."
 *
 * Module: const { buildPolicy, serialize, syncHeaders } = require('./csp');
 *
 * There is no chat assistant or LLM endpoint on this site; nothing here allows one.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { readConfig, cfg, ROOT } = require('./read_config');

const ORDER = [
  'default-src', 'script-src', 'style-src', 'font-src', 'img-src', 'media-src', 'connect-src',
  'worker-src', 'manifest-src', 'frame-src', 'frame-ancestors', 'form-action', 'base-uri',
  'object-src', 'upgrade-insecure-requests'
];

function basePolicy() {
  return {
    'default-src': ["'self'"],
    'script-src': ["'self'"],
    'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    'font-src': ["'self'", 'data:', 'https://fonts.gstatic.com'],
    'img-src': ["'self'", 'data:', 'blob:', 'https://images.unsplash.com'],
    'media-src': ["'self'", 'data:', 'blob:'],
    'connect-src': ["'self'"],
    'worker-src': ["'self'", 'blob:'],
    'manifest-src': ["'self'"],
    'frame-src': ["'self'"],
    'frame-ancestors': ["'self'"],
    'form-action': ["'self'"],
    'base-uri': ["'self'"],
    'object-src': ["'none'"],
    'upgrade-insecure-requests': []
  };
}

const VIDEO_HOSTS = {
  cloudflare: {
    'connect-src': ['https://*.videodelivery.net', 'https://*.cloudflarestream.com'],
    'media-src': ['https://*.videodelivery.net', 'https://*.cloudflarestream.com'],
    'img-src': ['https://*.videodelivery.net', 'https://*.cloudflarestream.com'],
    'frame-src': ['https://*.videodelivery.net', 'https://*.cloudflarestream.com']
  },
  mux: {
    'connect-src': ['https://*.mux.com', 'https://storage.googleapis.com'],
    'media-src': ['https://*.mux.com'],
    'img-src': ['https://image.mux.com']
  }
};

function originOf(u, siteOrigin) {
  if (!u || typeof u !== 'string') return '';
  if (!/^https?:\/\//i.test(u)) return '';           // relative path: covered by 'self'
  try {
    const o = new URL(u).origin;
    return o === siteOrigin ? '' : o;
  } catch (e) { return ''; }
}

function add(policy, directive, sources) {
  if (!policy[directive]) policy[directive] = [];
  for (const s of [].concat(sources || [])) {
    if (s && policy[directive].indexOf(s) < 0) policy[directive].push(s);
  }
}

/**
 * Build the policy object { directive: [sources] } for a config object.
 * opts.video: 'cloudflare' | 'mux' | 'both' | 'none' (overrides integrations.videoProvider)
 * opts.add: ['directive source ...', ...]
 */
function buildPolicy(conf, opts) {
  conf = conf || {};
  opts = opts || {};
  const policy = basePolicy();
  let siteOrigin = '';
  try { siteOrigin = cfg(conf, 'site.url', '') ? new URL(cfg(conf, 'site.url', '')).origin : ''; } catch (e) {}

  const endpoints = [
    'integrations.formEndpoint', 'integrations.actionNetwork.endpoint', 'integrations.squadEndpoint',
    'integrations.countersEndpoint', 'integrations.videoUploadEndpoint', 'integrations.analytics.endpoint'
  ];
  for (const k of endpoints) add(policy, 'connect-src', originOf(cfg(conf, k, ''), siteOrigin));

  if (cfg(conf, 'integrations.videoUploadEndpoint', '')) {
    let v = String(opts.video || cfg(conf, 'integrations.videoProvider', '') || 'both').toLowerCase();
    const list = v === 'both' ? ['cloudflare', 'mux'] : v === 'none' ? [] : [v];
    for (const p of list) {
      const hosts = VIDEO_HOSTS[p];
      if (!hosts) throw new Error('unknown video provider "' + p + '" (use cloudflare, mux, both or none)');
      for (const d of Object.keys(hosts)) add(policy, d, hosts[d]);
    }
  }

  const provider = String(cfg(conf, 'integrations.analytics.provider', 'none') || 'none').toLowerCase();
  if (provider === 'plausible') {
    const o = originOf(cfg(conf, 'integrations.analytics.plausibleSrc', ''), siteOrigin);
    add(policy, 'script-src', o);
    add(policy, 'connect-src', o);
  } else if (provider === 'cloudflare') {
    add(policy, 'script-src', 'https://static.cloudflareinsights.com');
    add(policy, 'connect-src', 'https://cloudflareinsights.com');
  }

  const extra = cfg(conf, 'csp', null);
  if (extra && typeof extra === 'object') {
    for (const d of Object.keys(extra)) add(policy, d, extra[d]);
  }
  for (const line of opts.add || []) {
    const parts = String(line).trim().split(/\s+/);
    if (parts.length < 2) throw new Error('--add needs "directive source [source...]", got "' + line + '"');
    add(policy, parts[0], parts.slice(1));
  }
  return policy;
}

/** Serialize in a fixed directive order (unknown directives go last, alphabetically). */
function serialize(policy) {
  const names = Object.keys(policy);
  names.sort((a, b) => {
    const ia = ORDER.indexOf(a), ib = ORDER.indexOf(b);
    if (ia < 0 && ib < 0) return a < b ? -1 : 1;
    if (ia < 0) return 1;
    if (ib < 0) return -1;
    return ia - ib;
  });
  return names.map((n) => [n].concat(policy[n]).join(' ')).join('; ');
}

const CSP_LINE = /^([ \t]+)Content-Security-Policy:[ \t]*(.*)$/m;

/** Return { changed, before, after, text } for _headers text with the CSP line replaced. */
function syncHeaders(text, csp) {
  const m = CSP_LINE.exec(text);
  if (!m) return { changed: false, missing: true, before: '', after: csp, text };
  const next = text.slice(0, m.index) + m[1] + 'Content-Security-Policy: ' + csp + text.slice(m.index + m[0].length);
  return { changed: m[2].trim() !== csp, missing: false, before: m[2].trim(), after: csp, text: next };
}

function main(argv) {
  let root = ROOT, headersFile = '', mode = 'print', video = '';
  const adds = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root') root = path.resolve(argv[++i]);
    else if (a === '--headers') headersFile = path.resolve(argv[++i]);
    else if (a === '--write') mode = 'write';
    else if (a === '--check') mode = 'check';
    else if (a === '--video') video = argv[++i];
    else if (a === '--add') adds.push(argv[++i]);
    else if (a === '-h' || a === '--help') {
      process.stdout.write('usage: node tools/csp.js [--write|--check] [--root DIR] [--headers FILE] [--video cloudflare|mux|both|none] [--add "directive source..."]\n');
      return 0;
    } else { process.stderr.write('csp: unknown argument ' + a + '\n'); return 2; }
  }
  headersFile = headersFile || path.join(root, '_headers');
  let conf;
  try { conf = readConfig(root) || {}; } catch (e) { process.stderr.write('csp: config error: ' + e.message + '\n'); return 2; }
  let csp;
  try { csp = serialize(buildPolicy(conf, { video, add: adds })); } catch (e) { process.stderr.write('csp: ' + e.message + '\n'); return 2; }
  if (mode === 'print') { process.stdout.write(csp + '\n'); return 0; }
  if (!fs.existsSync(headersFile)) { process.stderr.write('csp: ' + headersFile + ' not found\n'); return 2; }
  const res = syncHeaders(fs.readFileSync(headersFile, 'utf8'), csp);
  if (res.missing) { process.stderr.write('csp: no "  Content-Security-Policy:" line in ' + headersFile + '\n'); return 2; }
  if (mode === 'check') {
    if (res.changed) {
      process.stdout.write('csp: _headers is out of date.\n  have: ' + res.before + '\n  want: ' + res.after + '\n  fix:  node tools/csp.js --write\n');
      return 1;
    }
    process.stdout.write('csp: _headers matches config.\n');
    return 0;
  }
  if (res.changed) fs.writeFileSync(headersFile, res.text);
  process.stdout.write('csp: ' + (res.changed ? 'updated ' : 'unchanged ') + path.relative(process.cwd(), headersFile) + '\n');
  return 0;
}

module.exports = { basePolicy, buildPolicy, serialize, syncHeaders, VIDEO_HOSTS };

if (require.main === module) process.exitCode = main(process.argv.slice(2));
