#!/usr/bin/env node
/*
 * Video workstream tests: demo clips + data/clips.js, YSD.clips, YSD.feed, upload functions.
 *
 *   node tests/infra/video.test.js           everything (Node checks + headless Chromium)
 *   node tests/infra/video.test.js --node    Node checks only (files, MP4/JPEG parsing, functions)
 *
 * Needs Node 22; the browser part needs Playwright (require('playwright')) with Chromium.
 * Serves the site from a throwaway local HTTP server (with a mock upload API) and also loads it
 * over file://. Exits 1 on any failure.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const vm = require('vm');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..', '..');
const NODE_ONLY = process.argv.includes('--node');
const OWNED = [
  'assets/js/clips.js', 'assets/js/feed.js', 'functions/api/video-upload.js',
  'netlify/functions/video-upload.js', 'data/clips.js', 'assets/video/make_demo_clips.py'
];

let passed = 0, failed = 0;
const failures = [];
function ok(cond, name, detail) {
  if (cond) { passed++; return true; }
  failed++;
  failures.push(name + (detail !== undefined ? '  ->  ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''));
  return false;
}
function eq(a, b, name) { return ok(a === b, name, { got: a, want: b }); }
async function section(name, fn) {
  const before = failed;
  try { await fn(); } catch (e) { failed++; failures.push(name + ' threw: ' + (e && e.stack || e)); }
  console.log((failed === before ? 'ok   ' : 'FAIL ') + name);
}
const read = (f) => fs.readFileSync(path.join(ROOT, f));

function loadClipData() {
  const win = {};
  win.window = win;
  vm.runInContext(read('data/clips.js').toString('utf8'), vm.createContext(win), { filename: 'data/clips.js' });
  return win.YSD_DATA && win.YSD_DATA.clips;
}

// ------------------------------------------------------------------ MP4 / JPEG parsing (no ffprobe needed)
function boxes(buf, start, end) {
  const out = [];
  let p = start;
  while (p + 8 <= end) {
    let size = buf.readUInt32BE(p), hdr = 8;
    const type = buf.toString('latin1', p + 4, p + 8);
    if (size === 1) { size = Number(buf.readBigUInt64BE(p + 8)); hdr = 16; } else if (size === 0) size = end - p;
    if (size < hdr || p + size > end) break;
    out.push({ type, start: p, body: p + hdr, end: p + size });
    p += size;
  }
  return out;
}
function child(buf, box, type) { return boxes(buf, box.body, box.end).find((b) => b.type === type); }
function mp4Info(buf) {
  const top = boxes(buf, 0, buf.length);
  const order = top.map((b) => b.type);
  const moov = top.find((b) => b.type === 'moov');
  const info = { order, duration: NaN, tracks: [] };
  if (!moov) return info;
  const mvhd = child(buf, moov, 'mvhd');
  if (mvhd) {
    const v = buf[mvhd.body];
    const ts = v === 1 ? buf.readUInt32BE(mvhd.body + 20) : buf.readUInt32BE(mvhd.body + 12);
    const du = v === 1 ? Number(buf.readBigUInt64BE(mvhd.body + 24)) : buf.readUInt32BE(mvhd.body + 16);
    info.duration = du / ts;
  }
  boxes(buf, moov.body, moov.end).filter((b) => b.type === 'trak').forEach((trak) => {
    const tkhd = child(buf, trak, 'tkhd');
    const mdia = child(buf, trak, 'mdia');
    const hdlr = mdia && child(buf, mdia, 'hdlr');
    const minf = mdia && child(buf, mdia, 'minf');
    const stbl = minf && child(buf, minf, 'stbl');
    const stsd = stbl && child(buf, stbl, 'stsd');
    info.tracks.push({
      handler: hdlr ? buf.toString('latin1', hdlr.body + 8, hdlr.body + 12) : '',
      width: tkhd ? buf.readUInt32BE(tkhd.end - 8) / 65536 : 0,
      height: tkhd ? buf.readUInt32BE(tkhd.end - 4) / 65536 : 0,
      codec: stsd ? buf.toString('latin1', stsd.body + 12, stsd.body + 16) : ''
    });
  });
  return info;
}
function jpegSize(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let p = 2;
  while (p < buf.length) {
    if (buf[p] !== 0xff) { p++; continue; }
    const m = buf[p + 1];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { height: buf.readUInt16BE(p + 5), width: buf.readUInt16BE(p + 7), progressive: m === 0xc2 };
    p += 2 + buf.readUInt16BE(p + 2);
  }
  return null;
}

// ------------------------------------------------------------------ function harness
function mockFetchFactory() {
  const calls = [];
  const routes = [];
  async function fakeFetch(url, init) {
    init = init || {};
    url = String(url);
    const headers = {};
    new Headers(init.headers || {}).forEach((v, k) => { headers[k] = v; });
    const body = init.body == null ? null : typeof init.body === 'string' ? init.body : init.body.toString();
    calls.push({ url, method: (init.method || 'GET').toUpperCase(), headers, body });
    for (const r of routes) {
      if (r.match(url, init)) {
        const out = await r.reply(url, init, body);
        return new Response(JSON.stringify(out.body), { status: out.status || 200, headers: { 'Content-Type': 'application/json' } });
      }
    }
    return new Response('{"error":"unmocked"}', { status: 599 });
  }
  return {
    calls, fetch: fakeFetch,
    route(match, reply) { routes.unshift({ match: typeof match === 'function' ? match : (u) => u.indexOf(match) >= 0, reply }); },
    reset() { calls.length = 0; routes.length = 0; }
  };
}

async function functionSuite(label, call) {
  const mock = mockFetchFactory();
  const realFetch = globalThis.fetch;
  globalThis.fetch = mock.fetch;
  const quiet = console.error;
  console.error = () => {};
  const CF = { CF_ACCOUNT_ID: 'acc123', CF_STREAM_API_TOKEN: 'cf-secret-token-XYZ' };
  const MUX = { VIDEO_PROVIDER: 'mux', MUX_TOKEN_ID: 'muxid', MUX_TOKEN_SECRET: 'mux-secret-ABC' };
  const URL0 = 'https://site.test/api/video-upload';
  const post = (body, headers) => new Request(URL0, { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}), body: typeof body === 'string' ? body : JSON.stringify(body) });
  const good = { action: 'create', filename: 'clip.mp4', size: 5000000, type: 'video/mp4', duration: 42, caption: 'hi', tags: ['vote'], author: '@demo.x', clientId: 'clip_1' };
  try {
    let r, j;
    r = await call(post(good), {});
    eq(r.status, 503, label + ': unconfigured -> 503');

    mock.route('/stream/direct_upload', () => ({ body: { success: true, result: { uid: 'a'.repeat(32), uploadURL: 'https://upload.videodelivery.net/abc' } } }));
    r = await call(post(good), CF); j = await r.json();
    eq(r.status, 200, label + ': cloudflare create 200');
    eq(j.provider, 'cloudflare', label + ': provider cloudflare');
    eq(j.method, 'POST', label + ': cloudflare method POST');
    eq(j.field, 'file', label + ': cloudflare multipart field');
    eq(j.uploadUrl, 'https://upload.videodelivery.net/abc', label + ': uploadUrl passed through');
    const c0 = mock.calls[mock.calls.length - 1];
    eq(c0.url, 'https://api.cloudflare.com/client/v4/accounts/acc123/stream/direct_upload', label + ': cloudflare API URL');
    eq(c0.headers.authorization, 'Bearer cf-secret-token-XYZ', label + ': cloudflare bearer token');
    const cb = JSON.parse(c0.body);
    eq(cb.maxDurationSeconds, 180, label + ': default max 180 s sent');
    eq(cb.meta.review, 'pending', label + ': uploads tagged review pending');
    eq(cb.creator, '@demo.x', label + ': creator set');
    ok(JSON.stringify(j).indexOf('cf-secret') < 0, label + ': token never in response');
    eq(r.headers.get('cache-control'), 'no-store', label + ': no-store');

    r = await call(post(Object.assign({}, good, { size: 151 * 1024 * 1024 })), CF);
    eq(r.status, 413, label + ': >150 MB -> 413');
    r = await call(post(Object.assign({}, good, { size: 210 * 1024 * 1024 })), Object.assign({ VIDEO_MAX_BYTES: String(500 * 1024 * 1024) }, CF));
    eq(r.status, 413, label + ': cloudflare basic upload capped at 200 MB');
    r = await call(post(Object.assign({}, good, { duration: 181.5 })), CF);
    eq(r.status, 400, label + ': >3 min -> 400');
    eq((await r.json()).error, 'too-long', label + ': too-long code');
    r = await call(post(Object.assign({}, good, { type: 'image/png' })), CF);
    eq(r.status, 415, label + ': non-video -> 415');
    r = await call(post('{not json'), CF);
    eq(r.status, 400, label + ': bad JSON -> 400');
    r = await call(post('x'.repeat(20000)), CF);
    eq(r.status, 413, label + ': oversized body -> 413');
    r = await call(new Request(URL0, { method: 'PUT', body: 'x' }), CF);
    eq(r.status, 405, label + ': PUT -> 405');
    r = await call(new Request(URL0), CF); j = await r.json();
    ok(r.status === 200 && j.configured === true, label + ': GET without id reports configured', j);

    // Turnstile
    const TS = Object.assign({ TURNSTILE_SECRET_KEY: 'ts-secret' }, CF);
    mock.route('challenges.cloudflare.com', (u, init, body) => ({ body: { success: /response=good/.test(body) } }));
    r = await call(post(good), TS);
    eq(r.status, 403, label + ': turnstile required -> 403 without token');
    r = await call(post(Object.assign({ turnstileToken: 'good' }, good)), TS);
    eq(r.status, 200, label + ': valid turnstile token -> 200');
    const tsCall = mock.calls.filter((c) => c.url.indexOf('siteverify') >= 0).pop();
    ok(tsCall && /secret=ts-secret/.test(tsCall.body), label + ': turnstile verified with secret');

    // Origins + CORS
    const OR = Object.assign({ ALLOWED_ORIGINS: 'https://youngsemdem.org' }, CF);
    r = await call(post(good, { Origin: 'https://evil.test' }), OR);
    eq(r.status, 403, label + ': foreign origin -> 403');
    r = await call(post(good, { Origin: 'https://youngsemdem.org' }), OR);
    eq(r.headers.get('access-control-allow-origin'), 'https://youngsemdem.org', label + ': CORS echoes allowed origin');
    r = await call(new Request(URL0, { method: 'OPTIONS', headers: { Origin: 'https://youngsemdem.org' } }), OR);
    ok(r.status === 204 && /POST/.test(r.headers.get('access-control-allow-methods') || ''), label + ': OPTIONS preflight 204');

    // Cloudflare status
    const uid = 'b'.repeat(32);
    mock.route('/stream/' + uid, () => ({ body: { success: true, result: { uid, readyToStream: true, status: { state: 'ready' }, playback: { hls: 'https://h/x.m3u8', dash: 'https://h/x.mpd' }, thumbnail: 'https://h/t.jpg', preview: 'https://h/p', duration: 12.5, input: { width: 720, height: 1280 } } } }));
    r = await call(new Request(URL0 + '?id=' + uid + '&provider=cloudflare'), CF); j = await r.json();
    ok(j.state === 'ready' && j.playback && j.playback.hls === 'https://h/x.m3u8' && j.width === 720, label + ': cloudflare status ready', j);
    const uid2 = 'c'.repeat(32);
    mock.route('/stream/' + uid2, () => ({ body: { success: true, result: { uid: uid2, readyToStream: false, status: { state: 'pendingupload' } } } }));
    r = await call(new Request(URL0 + '?id=' + uid2), CF); j = await r.json();
    eq(j.state, 'waiting', label + ': cloudflare pendingupload -> waiting');
    r = await call(new Request(URL0 + '?id=../../etc'), CF);
    eq(r.status, 400, label + ': bad id -> 400');

    // provider failure never leaks
    mock.reset();
    mock.route('/stream/direct_upload', () => ({ status: 500, body: { success: false, errors: [{ message: 'token cf-secret-token-XYZ invalid' }] } }));
    r = await call(post(good), CF); const txt = await r.text();
    ok(r.status === 502 && txt.indexOf('cf-secret') < 0 && /provider-error/.test(txt), label + ': provider error -> 502 without details', txt);

    // Mux
    mock.reset();
    mock.route('api.mux.com/video/v1/uploads', (u, init) => (String(init.method || 'GET').toUpperCase() === 'POST'
      ? { status: 201, body: { data: { id: 'UpLoAd123', url: 'https://storage.googleapis.com/video-storage/abc', status: 'waiting' } } }
      : null));
    r = await call(post(good, { Origin: 'https://site.test' }), MUX); j = await r.json();
    ok(r.status === 200 && j.provider === 'mux' && j.method === 'PUT' && j.id === 'UpLoAd123', label + ': mux create', j);
    const m0 = mock.calls[0];
    eq(m0.url, 'https://api.mux.com/video/v1/uploads', label + ': mux API URL');
    eq(m0.headers.authorization, 'Basic ' + Buffer.from('muxid:mux-secret-ABC').toString('base64'), label + ': mux basic auth');
    const mb = JSON.parse(m0.body);
    ok(mb.new_asset_settings.playback_policies[0] === 'public' && mb.cors_origin === 'https://site.test', label + ': mux body', mb);
    ok(mb.new_asset_settings.passthrough.length <= 255, label + ': mux passthrough <= 255 chars');
    ok(JSON.stringify(j).indexOf('mux-secret') < 0, label + ': mux secret never in response');

    mock.reset();
    let uploadState = 'waiting';
    mock.route((u) => /\/uploads\/UpLoAd123$/.test(u), () => ({ body: { data: { id: 'UpLoAd123', status: uploadState, asset_id: uploadState === 'asset_created' ? 'AsSeT9' : undefined } } }));
    mock.route((u) => /\/assets\/AsSeT9$/.test(u), () => ({ body: { data: { id: 'AsSeT9', status: 'ready', duration: 33.3, playback_ids: [{ id: 'PlAy1', policy: 'public' }] } } }));
    r = await call(new Request(URL0 + '?id=UpLoAd123&provider=mux'), MUX); j = await r.json();
    eq(j.state, 'waiting', label + ': mux upload waiting');
    uploadState = 'asset_created';
    r = await call(new Request(URL0 + '?id=UpLoAd123&provider=mux'), MUX); j = await r.json();
    ok(j.state === 'ready' && j.playback.hls === 'https://stream.mux.com/PlAy1.m3u8' && j.playback.poster === 'https://image.mux.com/PlAy1/thumbnail.jpg', label + ': mux asset ready -> playback', j);
  } finally {
    globalThis.fetch = realFetch;
    console.error = quiet;
  }
}

// ------------------------------------------------------------------ static server with a mock upload API
function startServer() {
  const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mp4': 'video/mp4', '.jpg': 'image/jpeg', '.json': 'application/json', '.css': 'text/css' };
  const state = { requests: [], uploads: [], creates: [], statusCalls: 0, failUploads: false, seq: 0 };
  function page(q) {
    const variant = q.get('v') || 'demo';
    const cfgs = {
      demo: { demo: true },
      demoEndpoint: { demo: true, integrations: { videoUploadEndpoint: '/api/video-upload' } },
      prod: { demo: false, integrations: { videoUploadEndpoint: '/api/video-upload' } },
      prodPut: { demo: false, integrations: { videoUploadEndpoint: '/api/video-upload?mode=put' } },
      nostore: { demo: true }
    };
    const scripts = ['assets/js/config.js'];
    if (variant !== 'nostore') scripts.push('assets/js/store.js');
    scripts.push('data/clips.js', 'assets/js/clips.js', 'assets/js/feed.js');
    return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>video test</title><script>window.YSD_CONFIG=' + JSON.stringify(cfgs[variant] || cfgs.demo) + ';</script>' +
      scripts.map((s) => '<script src="/' + s + '"></script>').join('') +
      '<style>html,body{margin:0}</style></head><body><div id="feed"></div></body></html>';
  }
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    state.requests.push({ method: req.method, path: u.pathname, search: u.search });
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      if (u.pathname === '/__video__.html') { res.writeHead(200, { 'Content-Type': TYPES['.html'] }); res.end(page(u.searchParams)); return; }
      if (u.pathname === '/api/video-upload') {
        if (req.method === 'POST') {
          let j = {};
          try { j = JSON.parse(body.toString('utf8')); } catch (e) {}
          state.creates.push(j);
          const n = ++state.seq;
          const put = u.searchParams.get('mode') === 'put';
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, provider: 'mock', id: 'up' + n, uploadUrl: '/__upload/' + n, method: put ? 'PUT' : 'POST', field: put ? undefined : 'file' }));
          return;
        }
        state.statusCalls++;
        const id = u.searchParams.get('id');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(state.statusCalls % 2 === 1 ? { ok: true, id, state: 'processing' } : { ok: true, id, state: 'ready', playback: { hls: 'https://example.test/' + id + '.m3u8', poster: 'https://example.test/' + id + '.jpg' }, duration: 1.2 }));
        return;
      }
      if (u.pathname.indexOf('/__upload/') === 0) {
        state.uploads.push({ method: req.method, type: req.headers['content-type'] || '', bytes: body.length });
        res.writeHead(state.failUploads ? 500 : 200, { 'Content-Type': 'text/plain' });
        res.end(state.failUploads ? 'nope' : 'ok');
        return;
      }
      const file = path.normalize(path.join(ROOT, decodeURIComponent(u.pathname)));
      if (file.indexOf(ROOT) !== 0 || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end('not found'); return; }
      const stat = fs.statSync(file), type = TYPES[path.extname(file)] || 'application/octet-stream';
      const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
      if (range) {
        const start = range[1] ? +range[1] : 0, end = range[2] ? Math.min(+range[2], stat.size - 1) : stat.size - 1;
        res.writeHead(206, { 'Content-Type': type, 'Content-Length': end - start + 1, 'Content-Range': 'bytes ' + start + '-' + end + '/' + stat.size, 'Accept-Ranges': 'bytes' });
        fs.createReadStream(file, { start, end }).pipe(res);
        return;
      }
      res.writeHead(200, { 'Content-Type': type, 'Content-Length': stat.size, 'Accept-Ranges': 'bytes' });
      fs.createReadStream(file).pipe(res);
    });
  });
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve({ srv, state, base: 'http://127.0.0.1:' + srv.address().port })));
}

// In-page helpers (stringified into the page).
const PAGE_HELPERS = `
window.__events = [];
['clip-added','clip-rejected','clip-removed','clip-liked','clip-view','clip-upload-start','clip-upload-progress','clip-uploaded','clip-upload-failed','clip-ready','feed-change','feed-like','feed-view','feed-mute','feed-play','feed-pause']
  .forEach(function (n) { document.addEventListener('ysd:' + n, function (e) { var d = e.detail || {}; window.__events.push({ name: n, id: d.id || (d.clip && d.clip.id) || null, progress: d.progress, x: d.x, y: d.y, index: d.index, code: d.code, muted: d.muted }); }); });
window.__makeWebm = async function (w, h, ms) {
  var c = document.createElement('canvas'); c.width = w; c.height = h; var ctx = c.getContext('2d');
  var stream = c.captureStream(30), rec = new MediaRecorder(stream, { mimeType: 'video/webm' }), chunks = [], f = 0;
  rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
  var iv = setInterval(function () { ctx.fillStyle = 'hsl(' + (f * 25 % 360) + ',80%,50%)'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#fff'; ctx.fillRect((f * 7) % w, 10, 20, 20); f++; }, 33);
  rec.start(100);
  await new Promise(function (r) { setTimeout(r, ms); });
  var stopped = new Promise(function (r) { rec.onstop = r; });
  rec.stop(); await stopped; clearInterval(iv);
  return new File(chunks, 'test.webm', { type: 'video/webm' });
};
window.__mp4File = async function (src) { var b = await (await fetch(src)).blob(); return new File([b], 'demo.mp4', { type: 'video/mp4' }); };
window.__canLoad = function (src) { return new Promise(function (res) { var v = document.createElement('video'); v.muted = true; v.preload = 'metadata';
  var t = setTimeout(function () { res({ ok: false, why: 'timeout' }); }, 8000);
  v.onloadedmetadata = function () { clearTimeout(t); res({ ok: true, duration: v.duration, w: v.videoWidth, h: v.videoHeight }); };
  v.onerror = function () { clearTimeout(t); res({ ok: false, why: 'error' }); }; v.src = src; }); };
`;

// ------------------------------------------------------------------ main
(async () => {
  await section('files: video workstream files exist', async () => {
    OWNED.forEach((f) => ok(fs.existsSync(path.join(ROOT, f)), 'exists ' + f));
    const vids = fs.readdirSync(path.join(ROOT, 'assets/video'));
    const mp4 = vids.filter((f) => f.endsWith('.mp4')), jpg = vids.filter((f) => f.endsWith('.jpg'));
    ok(mp4.length >= 6 && mp4.length <= 8, '6-8 demo clips', mp4.length);
    eq(jpg.length, mp4.length, 'one poster per clip');
  });

  await section('files: no assistant, no LLM calls, no secrets in browser code', async () => {
    OWNED.filter((f) => /\.js$/.test(f)).forEach((f) => {
      const s = read(f).toString('utf8');
      ok(!/anthropic|openai|claude|\bllm\b|askEndpoint|\/api\/ask/i.test(s), 'no assistant/LLM references in ' + f);
    });
    ['assets/js/clips.js', 'assets/js/feed.js', 'data/clips.js'].forEach((f) => {
      const s = read(f).toString('utf8');
      ok(!/CF_STREAM_API_TOKEN|MUX_TOKEN_SECRET|Bearer /.test(s), 'no provider credentials in ' + f);
    });
  });

  const data = loadClipData();
  await section('data/clips.js: demo items, credits, flags', async () => {
    ok(data && Array.isArray(data.items), 'YSD_DATA.clips.items is an array');
    eq(data.demo, true, 'data flagged demo');
    ok(data.items.length >= 6 && data.items.length <= 8, '6-8 items');
    const ids = new Set();
    data.items.forEach((it) => {
      const n = it.id;
      ok(!ids.has(n), n + ': unique id'); ids.add(n);
      eq(it.demo, true, n + ': demo:true');
      ok(/^@demo\.[a-z]+$/.test(it.author && it.author.handle), n + ': fake @demo.* handle', it.author);
      ok(/demo/i.test(it.author.name || ''), n + ': name says demo');
      ok(typeof it.caption === 'string' && it.caption.length > 10 && it.caption.length <= 300, n + ': caption');
      ok(Array.isArray(it.tags) && it.tags.length > 0, n + ': tags');
      ok(Number.isInteger(it.likes) && it.likes > 0 && Number.isInteger(it.views) && it.views >= it.likes, n + ': likes/views');
      ok(!isNaN(Date.parse(it.createdAt)), n + ': createdAt parses');
      ok(fs.existsSync(path.join(ROOT, it.src)) && fs.existsSync(path.join(ROOT, it.poster)), n + ': src and poster files exist');
      ok(!/^\//.test(it.src) && !/^\//.test(it.poster), n + ': site-relative paths (file:// safe)');
      ok(Array.isArray(it.photos) && it.photos.length >= 1, n + ': photo credits');
      (it.photos || []).forEach((p) => {
        ok(/^https:\/\/images\.unsplash\.com\/photo-\d+-[0-9a-f]+$/.test(p.url), n + ': unsplash image url ' + p.url);
        // credit link: the Unsplash photo page, or the photographer's profile when the photo slug can't be confirmed
        ok(/^https:\/\/unsplash\.com\/(photos\/|@)/.test(p.page), n + ': unsplash page url (photo page or photographer profile)');
        eq(p.license, 'Unsplash License', n + ': license');
        ok(p.photographer && p.description, n + ': photographer + description');
      });
      (it.facts || []).forEach((f) => ok(/^https:\/\//.test(f.source) && f.claim, n + ': fact has a source'));
      ok(Array.isArray(it.burnedInText) && it.burnedInText.length >= 2, n + ': burned-in text recorded');
      ok(it.burnedInText.every((l) => !/\n/.test(l) && !/\.(gov|com|org)\s+[A-Z]/.test(l)), n + ': one on-screen sentence per transcript line', it.burnedInText);
    });
    const mail = data.items.find((i) => i.id === 'demo-mail-ballot-renew');
    eq(mail.burnedInText.slice(-2).join(' | '), 'Ask again: voteseminole.gov | Should last through 2028', 'mail-ballot: the last box is two transcript lines');
    const topics = data.items.map((i) => i.id).join(' ');
    ['mail-ballot', 'sunrail', 'first-time-voter', 'lake-monroe', 'precinct-captain', 'trivia'].forEach((t) => ok(topics.indexOf(t) >= 0, 'topic present: ' + t));
  });

  await section('demo clips: H.264 vertical MP4s, 6-12 s, <~1.5 MB, no audio, faststart', async () => {
    data.items.forEach((it) => {
      const buf = read(it.src), info = mp4Info(buf), n = path.basename(it.src);
      ok(buf.length <= 1550000, n + ': size ' + buf.length + ' <= ~1.5 MB');
      eq(buf.length, it.bytes, n + ': bytes match data');
      ok(info.order.indexOf('moov') >= 0 && info.order.indexOf('moov') < info.order.indexOf('mdat'), n + ': moov before mdat (faststart)', info.order);
      ok(info.duration >= 6 && info.duration <= 12, n + ': duration 6-12 s', info.duration);
      ok(Math.abs(info.duration - it.duration) < 0.15, n + ': duration matches data', [info.duration, it.duration]);
      const vids = info.tracks.filter((t) => t.handler === 'vide');
      eq(vids.length, 1, n + ': one video track');
      ok(!info.tracks.some((t) => t.handler === 'soun'), n + ': no audio track');
      const v = vids[0] || {};
      ok((v.width === 720 && v.height === 1280) || (v.width === 1080 && v.height === 1920), n + ': 720x1280 or 1080x1920', v);
      eq(v.codec, 'avc1', n + ': H.264 (avc1)');
      eq(it.width + 'x' + it.height, v.width + 'x' + v.height, n + ': data dims match');
      eq(it.orientation, 'vertical', n + ': vertical');
      // posters: pages show them at 469x836 CSS px at most, so 540x960 (the video's 9:16), progressive, <= 60 KB
      const pbuf = read(it.poster), js = jpegSize(pbuf);
      ok(js && js.width === 540 && js.height === 960 && Math.abs(js.width / js.height - v.width / v.height) < 0.002, n + ': poster 540x960, same aspect as the video', js);
      ok(js && js.progressive, n + ': progressive JPEG');
      ok(pbuf.length <= 60000, n + ': poster ' + pbuf.length + ' bytes <= 60 KB');
      eq([it.posterBytes, it.posterWidth, it.posterHeight].join(','), [pbuf.length, js && js.width, js && js.height].join(','), n + ': poster bytes and size match data');
    });
  });

  await section('node sandbox: clips.js/feed.js load with or without optional modules', async () => {
    function sandbox(files) {
      const win = { console: { log() {}, warn() {}, error() {} }, setTimeout: () => 0, clearTimeout() {}, Date, Math, JSON, URL, Promise, location: { search: '', href: 'https://example.test/' } };
      win.window = win;
      const ctx = vm.createContext(win);
      files.forEach((f) => vm.runInContext(read(f).toString('utf8'), ctx, { filename: f }));
      return win;
    }
    const full = sandbox(['assets/js/config.js', 'assets/js/store.js', 'data/clips.js', 'assets/js/clips.js', 'assets/js/feed.js']);
    ok(full.YSD.clips && full.YSD.feed, 'modules attach to window.YSD');
    const st = full.YSD.clips.like('demo-sunrail-rally');
    ok(st.liked && st.likes === 288, 'like() before any list() uses the demo baseline', st);
    eq(full.YSD.clips.stats('demo-precinct-captain').likes, 341, 'stats() baseline');
    eq(full.YSD.clips.validate({ name: 'a.mp4', type: 'video/mp4', size: 151 * 1024 * 1024 }).code, 'size', 'validate() without a DOM');
    const bare = sandbox(['assets/js/clips.js', 'assets/js/feed.js']);
    ok(bare.YSD.clips && typeof bare.YSD.clips.list === 'function', 'clips.js loads without config/store/data');
    const lst = await bare.YSD.clips.list();
    ok(Array.isArray(lst) && lst.length === 0, 'list() is empty without data', lst);
    eq(bare.YSD.clips.toggleLike('x').liked, true, 'likes work on the fallback store');
  });

  await section('functions: Cloudflare and Netlify files share one core', async () => {
    const cut = (s) => s.slice(s.indexOf('// ==== BEGIN SHARED CORE'), s.indexOf('// ==== END SHARED CORE ===='));
    const a = cut(read('functions/api/video-upload.js').toString('utf8')), b = cut(read('netlify/functions/video-upload.js').toString('utf8'));
    ok(a.length > 1000, 'core block found');
    ok(a === b, 'shared core blocks are identical (re-copy the block if this fails)');
  });

  const cfMod = await import('data:text/javascript,' + encodeURIComponent(read('functions/api/video-upload.js').toString('utf8')));
  await section('functions: Cloudflare Pages handler (mocked provider APIs)', async () => {
    ok(typeof cfMod.onRequest === 'function', 'exports onRequest');
    await functionSuite('cf', (req, env) => cfMod.onRequest({ request: req, env }));
  });
  const nl = require(path.join(ROOT, 'netlify/functions/video-upload.js'));
  await section('functions: Netlify handler (mocked provider APIs)', async () => {
    ok(typeof nl.handler === 'function', 'exports handler');
    await functionSuite('netlify', async (req, env) => {
      const saved = process.env;
      process.env = Object.assign({}, env);
      try {
        const u = new URL(req.url), headers = {};
        req.headers.forEach((v, k) => { headers[k] = v; });
        const body = req.method === 'GET' ? null : await req.text();
        const r = await nl.handler({ httpMethod: req.method, headers, rawUrl: req.url, path: u.pathname, queryStringParameters: Object.fromEntries(u.searchParams), body, isBase64Encoded: false });
        return new Response(r.statusCode === 204 ? null : r.body, { status: r.statusCode, headers: r.headers });
      } finally { process.env = saved; }
    });
  });

  if (!NODE_ONLY) await browserTests();

  console.log('\nvideo tests: ' + passed + ' passed, ' + failed + ' failed');
  if (failed) { console.log('\nFailures:\n  ' + failures.join('\n  ')); }
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

async function browserTests() {
  let chromium;
  try { ({ chromium } = require('playwright')); } catch (e) { ok(false, 'playwright available', String(e && e.message)); return; }
  const { srv, state, base } = await startServer();
  const browser = await chromium.launch();
  const pageErrors = [];
  async function open(ctx, variant) {
    const page = await ctx.newPage();
    page.on('pageerror', (e) => pageErrors.push(variant + ': ' + e.message));
    await page.addInitScript(PAGE_HELPERS);
    await page.goto(base + '/__video__.html?v=' + variant);
    await page.waitForFunction(() => window.YSD && window.YSD.clips && window.YSD.feed);
    return page;
  }
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 780 } });
    let page = await open(ctx, 'demo');

    await section('browser: clips list() resolves demo clips', async () => {
      const r = await page.evaluate(async () => {
        const all = await YSD.clips.list();
        const top = await YSD.clips.list({ sort: 'top' });
        const tag = await YSD.clips.list({ tag: '#explainer' });
        const load = await __canLoad(all[0].src);
        return { n: all.length, srcs: all.map((c) => c.src), posters: all.map((c) => c.poster), demo: all.every((c) => c.demo && c.source === 'demo'),
          topLikes: top.map((c) => c.likes), tagIds: tag.map((c) => c.id), load, first: all[0], expectN: YSD_DATA.clips.items.length };
      });
      eq(r.n, r.expectN, 'all demo clips listed');
      ok(r.srcs.every((s) => s.indexOf(base + '/assets/video/') === 0 && /\.mp4$/.test(s)), 'src resolved against site root', r.srcs[0]);
      ok(r.posters.every((s) => /\/assets\/video\/.+\.jpg$/.test(s)), 'posters resolved');
      ok(r.demo, 'flagged demo');
      ok(r.topLikes.every((v, i, a) => i === 0 || a[i - 1] >= v), 'sort top = likes desc', r.topLikes);
      ok(r.tagIds.length === 2 && r.tagIds.indexOf('demo-precinct-captain') >= 0, 'tag filter', r.tagIds);
      ok(r.load.ok && r.load.h === 1280 && Math.abs(r.load.duration - r.first.duration) < 0.2, 'first clip plays in Chromium', r.load);
      eq(r.first.id, 'demo-trivia-night-recap', 'default sort newest first');
    });

    await section('browser: validate() types, sizes and limits', async () => {
      const r = await page.evaluate(() => {
        const v = YSD.clips.validate;
        return {
          txt: v(new File(['hi'], 'a.txt', { type: 'text/plain' })),
          none: v(null),
          empty: v(new File([], 'a.mp4', { type: 'video/mp4' })),
          big: v(new File([new Uint8Array(2000)], 'a.mp4', { type: 'video/mp4' }), { maxBytes: 1000 }),
          mov: v(new File([new Uint8Array(10)], 'IMG_0001.MOV', { type: '' })),
          mp4: v(new File([new Uint8Array(10)], 'a.mp4', { type: 'video/mp4' })),
          long: v(new File([new Uint8Array(10)], 'a.mp4', { type: 'video/mp4' }), { duration: 200 }),
          limits: YSD.clips.limits()
        };
      });
      ok(!r.txt.ok && r.txt.code === 'type' && r.txt.reason.length > 5, 'text file rejected', r.txt);
      eq(r.none.code, 'no-file', 'missing file');
      eq(r.empty.code, 'empty', 'empty file');
      ok(r.big.code === 'size' && /KB|B/.test(r.big.reason), 'size cap', r.big);
      ok(r.mov.ok && r.mov.type === 'video/quicktime', 'MIME-less .MOV accepted by extension', r.mov);
      ok(r.mp4.ok, 'mp4 ok');
      eq(r.long.code, 'duration', 'duration cap via opts.duration');
      eq(r.limits.maxBytes, 150 * 1024 * 1024, 'default cap 150 MB');
      eq(r.limits.maxDuration, 180, 'default cap 3 minutes');
    });

    await section('browser: probe() vertical MP4 -> duration, orientation, JPEG poster', async () => {
      const r = await page.evaluate(async () => {
        const f = await __mp4File(YSD_DATA.clips.items[0].src);
        const m = await YSD.clips.probe(f);
        let pw = 0, ph = 0;
        if (m.poster) { const bmp = await createImageBitmap(m.poster); pw = bmp.width; ph = bmp.height; }
        return { duration: m.duration, w: m.width, h: m.height, o: m.orientation, ptype: m.posterType, psize: m.poster && m.poster.size, pw, ph, err: m.error, expect: YSD_DATA.clips.items[0].duration };
      });
      ok(Math.abs(r.duration - r.expect) < 0.2, 'duration read', r);
      ok(r.w === 720 && r.h === 1280 && r.o === 'vertical', 'vertical 720x1280', r);
      ok(r.ptype === 'image/jpeg' && r.psize > 2000 && r.pw === 405 && r.ph === 720, 'poster JPEG scaled to 720 px', r);
      eq(r.err, null, 'no probe error');
    });

    await section('browser: probe() horizontal WebM with Infinity duration (MediaRecorder)', async () => {
      const r = await page.evaluate(async () => {
        const f = await __makeWebm(320, 180, 1300);
        window.__webm = f;
        const m = await YSD.clips.probe(f);
        return { duration: m.duration, w: m.width, h: m.height, o: m.orientation, poster: !!m.poster, err: m.error };
      });
      ok(isFinite(r.duration) && r.duration > 0.6 && r.duration < 3, 'finite duration recovered', r);
      ok(r.w === 320 && r.h === 180 && r.o === 'horizontal', 'horizontal detected', r);
      ok(r.poster, 'poster captured');
    });

    await section('browser: add() enforces duration cap and unplayable files', async () => {
      const r = await page.evaluate(async () => {
        let e1 = null, e2 = null;
        try { await YSD.clips.add(window.__webm, { maxDuration: 0.5 }); } catch (e) { e1 = e.code; }
        try { await YSD.clips.add(new File([new Uint8Array(4096)], 'junk.mp4', { type: 'video/mp4' }), { probeTimeout: 4000 }); } catch (e) { e2 = e.code; }
        return { e1, e2, rejected: __events.filter((x) => x.name === 'clip-rejected').map((x) => x.code) };
      });
      eq(r.e1, 'duration', 'over-long clip rejected');
      ok(r.e2 === 'unplayable' || r.e2 === 'timeout', 'garbage file rejected', r.e2);
      ok(r.rejected.indexOf('duration') >= 0, 'clip-rejected event fired', r.rejected);
    });

    let addedId = null;
    await section('browser: add/list/get/like/view in demo mode (IndexedDB)', async () => {
      const r = await page.evaluate(async () => {
        const f = await __mp4File(YSD_DATA.clips.items[2].src);
        const c = await YSD.clips.add(f, { caption: '  Hello <b>world</b> ', author: 'tester', tags: '#Vote, rally, vote' });
        const all = await YSD.clips.list();
        const mine = await YSD.clips.list({ mine: true });
        const got = await YSD.clips.get(c.id);
        const l1 = YSD.clips.like(c.id), l2 = YSD.clips.like(c.id);
        const v1 = YSD.clips.view(c.id), v2 = YSD.clips.view(c.id);
        const load = await __canLoad(c.src);
        const demoLike = YSD.clips.toggleLike('demo-sunrail-rally');
        return { c, firstId: all[0].id, mineN: mine.length, got: got && got.id, l1, l2, v1, v2, load, backend: YSD.db && YSD.db.backend, demoLike,
          added: __events.filter((x) => x.name === 'clip-added').length };
      });
      addedId = r.c.id;
      ok(/^clip_/.test(r.c.id), 'clip id');
      ok(/^blob:/.test(r.c.src) && /^blob:/.test(r.c.poster), 'object URLs for src and poster', [r.c.src, r.c.poster]);
      ok(r.c.status === 'local' && r.c.persisted === true && r.c.mine === true && r.c.demo === false, 'local, persisted, mine', r.c);
      eq(r.c.caption, 'Hello <b>world</b>', 'caption trimmed (escaping is the renderer\'s job)');
      eq(r.c.author.handle, '@tester', 'author handle normalised');
      eq(JSON.stringify(r.c.tags), '["vote","rally"]', 'tags normalised and deduped');
      eq(r.c.orientation, 'vertical', 'orientation stored');
      eq(r.firstId, r.c.id, 'newest first in list()');
      eq(r.mineN, 1, 'list({mine:true})');
      eq(r.got, r.c.id, 'get(id)');
      ok(r.l1.liked && r.l1.likes === 1 && r.l2.likes === 1, 'like once per browser', [r.l1, r.l2]);
      ok(r.v1.views === 1 && r.v2.views === 1, 'view counted once per session', [r.v1, r.v2]);
      ok(r.load.ok, 'stored clip plays from its object URL');
      eq(r.backend, 'indexeddb', 'YSD.db on IndexedDB');
      ok(r.demoLike.liked && r.demoLike.likes === 288, 'demo clip like = base + 1', r.demoLike);
      eq(r.added, 1, 'clip-added event');
    });

    await section('browser: clips survive a reload; remove() and hide work', async () => {
      await page.reload();
      await page.waitForFunction(() => window.YSD && window.YSD.clips);
      const r = await page.evaluate(async (id) => {
        const all = await YSD.clips.list();
        const c = all.find((x) => x.id === id);
        const load = c ? await __canLoad(c.src) : { ok: false };
        const sun = all.find((x) => x.id === 'demo-sunrail-rally');
        await YSD.clips.remove(id);
        const after = await YSD.clips.list();
        const blob = await YSD.db.get('clips', id);
        await YSD.clips.remove('demo-lake-monroe-canvass');
        const hidden = (await YSD.clips.list()).some((x) => x.id === 'demo-lake-monroe-canvass');
        YSD.clips.unhideAll();
        const back = (await YSD.clips.list()).some((x) => x.id === 'demo-lake-monroe-canvass');
        return { found: !!c, src: c && c.src, liked: c && c.liked, likes: c && c.likes, load, sunLikes: sun.likes, gone: !after.some((x) => x.id === id), blob, hidden, back };
      }, addedId);
      ok(r.found && /^blob:/.test(r.src), 'clip listed after reload with a fresh object URL', r);
      ok(r.load.ok, 'reloaded clip plays (blob from IndexedDB)');
      ok(r.liked && r.likes === 1, 'like persisted');
      eq(r.sunLikes, 288, 'demo like persisted');
      ok(r.gone && r.blob === null, 'remove() deletes metadata and blob');
      ok(!r.hidden && r.back, 'demo clip hidden, then restored');
    });

    await section('browser: demo mode never uploads even with an endpoint', async () => {
      const p2 = await open(ctx, 'demoEndpoint');
      const before = state.creates.length;
      const r = await p2.evaluate(async () => {
        const c = await YSD.clips.add(window.__webm || await __makeWebm(160, 284, 900), { caption: 'x' });
        return { status: c.status, enabled: YSD.clips.uploadEnabled() };
      });
      eq(r.enabled, false, 'uploadEnabled() false in demo');
      eq(r.status, 'local', 'clip stays local');
      eq(state.creates.length, before, 'no create request sent');
      await p2.close();
    });

    await section('browser: production seam: POST multipart upload, progress, status poll', async () => {
      const p3 = await open(ctx, 'prod');
      const before = state.uploads.length;
      const r = await p3.evaluate(async () => {
        const listed = await YSD.clips.list();
        const f = await __makeWebm(180, 320, 1200);
        const ready = new Promise((res) => document.addEventListener('ysd:clip-ready', (e) => res(e.detail), { once: true }));
        const prog = [];
        const c = await YSD.clips.add(f, { caption: 'Prod clip', tags: ['rally'], author: '@me', awaitUpload: true, pollInterval: 150, onProgress: (p) => prog.push(p.progress) });
        const rd = await Promise.race([ready, new Promise((res) => setTimeout(() => res(null), 5000))]);
        const after = await YSD.clips.get(c.id);
        return { demoShown: listed.filter((x) => x.demo).length, status: c.status, upload: c.upload, prog, evProg: __events.filter((x) => x.name === 'clip-upload-progress').map((x) => x.progress),
          uploaded: __events.some((x) => x.name === 'clip-uploaded'), ready: rd, afterStatus: after && after.status, hls: after && after.hls, size: f.size };
      });
      eq(r.demoShown, 0, 'demo clips hidden when YSD_CONFIG.demo is false');
      eq(r.status, 'processing', 'upload resolves to processing');
      ok(r.upload && r.upload.provider === 'mock' && /^up\d+$/.test(r.upload.id), 'remote ids recorded', r.upload);
      ok(r.prog.length >= 1 && r.prog[r.prog.length - 1] === 1, 'onProgress reaches 1', r.prog);
      ok(r.evProg.length >= 1 && r.evProg[r.evProg.length - 1] === 1, 'clip-upload-progress events', r.evProg);
      ok(r.uploaded, 'clip-uploaded event');
      ok(r.ready && r.afterStatus === 'ready' && /\.m3u8$/.test(r.hls || ''), 'status poll -> ready with HLS', r);
      const cr = state.creates[state.creates.length - 1];
      ok(cr && cr.action === 'create' && cr.size === r.size && cr.type === 'video/webm' && cr.caption === 'Prod clip' && cr.duration > 0 && cr.author === '@me', 'create request carries metadata', cr);
      const up = state.uploads[state.uploads.length - 1];
      ok(state.uploads.length === before + 1 && up.method === 'POST' && /multipart\/form-data/.test(up.type) && up.bytes >= r.size, 'file posted as multipart', up);
      await p3.close();
    });

    await section('browser: production seam: PUT upload, failure, retry', async () => {
      const p4 = await open(ctx, 'prodPut');
      state.failUploads = true;
      const r1 = await p4.evaluate(async () => {
        const f = await __makeWebm(180, 320, 800);
        let code = null;
        try { await YSD.clips.add(f, { awaitUpload: true, poll: false }); } catch (e) { code = e.code; }
        const mine = await YSD.clips.list({ mine: true });
        return { code, status: mine[0] && mine[0].status, id: mine[0] && mine[0].id, failed: __events.some((x) => x.name === 'clip-upload-failed') };
      });
      eq(r1.code, 'upload-failed', 'HTTP 500 upload rejects');
      eq(r1.status, 'failed', 'status failed');
      ok(r1.failed, 'clip-upload-failed event');
      state.failUploads = false;
      const r2 = await p4.evaluate(async (id) => { const c = await YSD.clips.retry(id, { poll: false }); return c.status; }, r1.id);
      eq(r2, 'processing', 'retry succeeds');
      const up = state.uploads[state.uploads.length - 1];
      ok(up.method === 'PUT' && up.type === 'video/webm' && up.bytes > 1000, 'raw PUT with content type', up);
      await p4.close();
    });

    await section('browser: moderation fields ride on the record; demo never keeps the guardian contact', async () => {
      const p6 = await open(ctx, 'demoEndpoint');
      const before = state.creates.length;
      const r = await p6.evaluate(async () => {
        const c = await YSD.clips.add(await __makeWebm(160, 284, 700), { caption: 'teen clip', captionsConfirmed: true, containsMinors: 'yes',
          guardianContact: 'mom@example.org', consents: ['rights', 'people', { id: 'rules', version: 'rules-v2' }, 'rights'] });
        const got = await YSD.clips.get(c.id);
        const raw = JSON.stringify(Object.assign({}, localStorage)) + JSON.stringify(got) + JSON.stringify(c);
        let code = null;
        try { await YSD.clips.upload(c.id, { force: true, poll: false }); } catch (e) { code = e.code; }
        const plain = await YSD.clips.add(await __makeWebm(160, 284, 800), { caption: 'plain' });
        return { c: { cc: c.captionsConfirmed, minors: c.containsMinors, need: c.needsGuardian, given: c.guardianContactProvided, consents: c.consents, has: 'guardianContact' in c },
          got: { minors: got.containsMinors, consents: got.consents.length }, leaked: raw.indexOf('mom@example.org') >= 0, code,
          plain: { cc: plain.captionsConfirmed, minors: plain.containsMinors, need: plain.needsGuardian, consents: plain.consents.length } };
      });
      ok(r.c.cc === true && r.c.minors === 'yes' && r.c.need === true && r.c.given === true && !r.c.has, 'record: captions confirmed, minors yes, needs a guardian, contact given but not kept', r.c);
      eq(r.c.consents.map((x) => x.id + '@' + x.version).join(','), 'rights@clip-consent-2026-11-09-draft,people@clip-consent-2026-11-09-draft,rules@rules-v2', 'consents carry a version (config default or their own), deduped');
      ok(r.c.consents.every((x) => !isNaN(Date.parse(x.at))), 'consents carry when they were given');
      ok(r.got.minors === 'yes' && r.got.consents === 3, 'fields survive storage', r.got);
      eq(r.leaked, false, 'the guardian contact is in no stored record, localStorage or clip object (demo)');
      eq(r.code, 'guardian-required', 'demo held nothing: a forced upload of a clip that needs a guardian is refused, nothing sent');
      ok(r.plain.cc === false && r.plain.minors === null && r.plain.need === false && r.plain.consents === 0, 'no moderation answers: neutral defaults', r.plain);
      eq(state.creates.length, before, 'no create request in demo');
      await p6.close();
    });

    await section('browser: production seam: create request carries moderation fields; the guardian contact is sent once, never stored', async () => {
      const p7 = await open(ctx, 'prod');
      const n0 = state.creates.length;
      const r = await p7.evaluate(async () => {
        const a = await YSD.clips.add(await __makeWebm(160, 284, 700), { caption: 'with a teen', captionsConfirmed: true, containsMinors: 'yes',
          guardianContact: ' dad@example.org ', consents: ['rights', 'people', 'rules'], awaitUpload: true, poll: false });
        const b = await YSD.clips.add(await __makeWebm(160, 284, 800), { caption: 'adults only', captionsConfirmed: true, containsMinors: 'no',
          consents: [{ id: 'rights', version: 'v9' }], consentVersion: 'ignored-when-own', awaitUpload: true, poll: false });
        const leaked = JSON.stringify(Object.assign({}, localStorage)).indexOf('dad@example.org') >= 0;
        let code = null;
        try { await YSD.clips.retry(a.id, { poll: false }); } catch (e) { code = e.code; }
        const failed = await YSD.clips.get(a.id);
        const again = await YSD.clips.retry(a.id, { poll: false, guardianContact: 'dad@example.org' });
        let teen = null;
        try { await YSD.clips.add(await __makeWebm(160, 284, 800), { containsMinors: true, awaitUpload: true, poll: false }); } catch (e) { teen = e.code; }
        let young = null;
        try { await YSD.clips.add(await __makeWebm(160, 284, 800), { containsMinors: 'no', guardianRequired: true, awaitUpload: true, poll: false }); } catch (e) { young = e.code; }
        return { a: a.status, b: b.status, leaked, code, failedStatus: failed.status, failedError: failed.upload && failed.upload.error, again: again.status, teen, young,
          failEvents: __events.filter((x) => x.name === 'clip-upload-failed' && x.code === 'guardian-required').length };
      });
      const cr = state.creates.slice(n0);
      eq(cr.length, 3, 'three create requests: the teen clip, the adults clip, the retry with a guardian (refusals send nothing)');
      ok(cr[0].captionsConfirmed === true && cr[0].containsMinors === 'yes' && cr[0].needsGuardian === true && cr[0].guardianContact === 'dad@example.org', 'create request: captions, minors, guardian contact (trimmed)', cr[0]);
      eq(cr[0].consents.map((x) => x.id + '@' + x.version).join(','), 'rights@clip-consent-2026-11-09-draft,people@clip-consent-2026-11-09-draft,rules@clip-consent-2026-11-09-draft', 'create request: consents with version');
      ok(cr[1].containsMinors === 'no' && cr[1].needsGuardian === false && !('guardianContact' in cr[1]) && cr[1].consents.length === 1 && cr[1].consents[0].version === 'v9', 'no minors: no guardian field; a consent keeps its own version', cr[1]);
      eq(cr[2].guardianContact, 'dad@example.org', 'a retry carries the contact passed to it');
      ok(r.a === 'processing' && r.b === 'processing' && r.again === 'processing', 'uploads go through', r);
      eq(r.leaked, false, 'the guardian contact never reaches localStorage');
      eq(r.code, 'guardian-required', 'sent once: after a successful create it is not kept for a retry');
      ok(r.failedStatus === 'failed' && r.failedError === 'guardian-required' && r.failEvents >= 1, 'a refusal marks the clip failed and emits clip-upload-failed', r);
      eq(r.teen, 'guardian-required', 'someone under 18 in the clip and no guardian contact: refused');
      eq(r.young, 'guardian-required', 'a poster under 18 (guardianRequired) and no guardian contact: refused');
      await p7.close();
    });

    await section('browser: works without store.js (own IndexedDB + localStorage fallbacks)', async () => {
      const ctx2 = await browser.newContext();
      const p5 = await open(ctx2, 'nostore');
      const r1 = await p5.evaluate(async () => {
        const f = await __makeWebm(180, 320, 700);
        const c = await YSD.clips.add(f, { caption: 'no store' });
        YSD.clips.like(c.id);
        return { id: c.id, hasStore: !!YSD.store, persisted: c.persisted, n: (await YSD.clips.list()).length };
      });
      ok(!r1.hasStore && r1.persisted, 'stored without YSD.store/YSD.db', r1);
      await p5.reload();
      await p5.waitForFunction(() => window.YSD && window.YSD.clips);
      const r2 = await p5.evaluate(async (id) => { const c = await YSD.clips.get(id); return c && { liked: c.liked, src: c.src }; }, r1.id);
      ok(r2 && r2.liked && /^blob:/.test(r2.src), 'clip and like survive reload', r2);
      await ctx2.close();
    });

    await section('browser: feed autoplay, preload, keys, mute, double-tap like, views', async () => {
      const ctx3 = await browser.newContext({ viewport: { width: 390, height: 700 } });
      const p = await open(ctx3, 'demo');
      await p.evaluate(async () => { window.__feed = YSD.feed.mount('#feed', await YSD.clips.list({ sort: 'top' }), { doubleTapMs: 350 }); });
      await p.waitForFunction(() => { const it = document.querySelector('[data-feed-item]'); return it && it.getAttribute('data-feed-state') === 'playing'; }, null, { timeout: 8000 });
      let s = await p.evaluate(() => {
        const items = [...document.querySelectorAll('[data-feed-item]')];
        const vids = items.map((i) => i.querySelector('video'));
        return { n: items.length, idx: __feed.index, muted: vids[0].muted, attr: document.getElementById('feed').getAttribute('data-feed-muted'),
          p0: vids[0].paused, src1: !!vids[1].getAttribute('src'), src5: !!vids[5].getAttribute('src'), active: items[0].getAttribute('data-feed-active'), autoplay: document.getElementById('feed').getAttribute('data-feed-autoplay') };
      });
      ok(s.idx === 0 && !s.p0 && s.active === 'true', 'first item active and playing', s);
      ok(s.muted && s.attr === 'true', 'muted by default', s);
      ok(s.src1 && !s.src5, 'next item preloaded, far item not loaded', s);
      eq(s.autoplay, 'on', 'autoplay on');
      await p.keyboard.press('j');
      await p.waitForFunction(() => __feed.index === 1 && document.querySelectorAll('[data-feed-item]')[1].getAttribute('data-feed-state') === 'playing', null, { timeout: 6000 });
      await p.waitForTimeout(1100);   // let the smooth scroll settle: the observer must not bounce back
      s = await p.evaluate(() => ({ p0: document.querySelectorAll('video')[0].paused, p1: document.querySelectorAll('video')[1].paused, idx: __feed.index }));
      ok(s.p0 && !s.p1 && s.idx === 1, 'j: next item plays, previous paused (after scroll settles)', s);
      await p.keyboard.press('k');
      await p.waitForFunction(() => __feed.index === 0, null, { timeout: 6000 });
      await p.waitForTimeout(1100);
      s = await p.evaluate(() => ({ p0: document.querySelectorAll('video')[0].paused, p1: document.querySelectorAll('video')[1].paused, idx: __feed.index }));
      ok(!s.p0 && s.p1 && s.idx === 0, 'k: back to the first item', s);
      await p.keyboard.press('m');
      s = await p.evaluate(() => ({ muted: document.querySelectorAll('video')[0].muted, attr: document.getElementById('feed').getAttribute('data-feed-muted'), btn: document.querySelector('[data-feed-mute]').getAttribute('aria-pressed') }));
      ok(!s.muted && s.attr === 'false' && s.btn === 'false', 'm: unmuted', s);
      await p.keyboard.press('m');
      await p.keyboard.press(' ');
      await p.waitForFunction(() => document.querySelector('[data-feed-item]').getAttribute('data-feed-state') === 'paused', null, { timeout: 4000 }).catch(() => {});
      s = await p.evaluate(() => ({ state: document.querySelector('[data-feed-item]').getAttribute('data-feed-state'), paused: document.querySelectorAll('video')[0].paused, idx: __feed.index }));
      ok(s.state === 'paused' && s.paused && s.idx === 0, 'space: paused', s);
      await p.keyboard.press(' ');
      await p.waitForFunction(() => !document.querySelectorAll('video')[0].paused, null, { timeout: 4000 });
      const before = await p.evaluate(() => { const it = document.querySelector('[data-feed-item]'); return { likes: it.querySelector('[data-feed-likes]').textContent, id: it.getAttribute('data-clip-id') }; });
      const box = await p.locator('[data-feed-item]').first().boundingBox();
      await p.mouse.click(box.x + box.width / 2, box.y + box.height / 3);
      await p.mouse.click(box.x + box.width / 2, box.y + box.height / 3);
      await p.waitForTimeout(500);
      s = await p.evaluate((id) => {
        const it = document.querySelector('[data-feed-item]');
        const ev = __events.filter((x) => x.name === 'feed-like').pop();
        return { likes: it.querySelector('[data-feed-likes]').textContent, pressed: it.querySelector('[data-feed-like]').getAttribute('aria-pressed'), ev, liked: YSD.clips.liked(id), paused: it.querySelector('video').paused };
      }, before.id);
      ok(s.ev && s.ev.index === 0 && typeof s.ev.x === 'number' && s.ev.y > 0, 'double-tap fires feed-like with coordinates', s.ev);
      ok(s.liked && s.pressed === 'true' && parseInt(s.likes.replace(/\D/g, ''), 10) === parseInt(before.likes.replace(/\D/g, ''), 10) + 1, 'like count +1', [before.likes, s.likes]);
      ok(!s.paused, 'double-tap does not toggle playback');
      await p.waitForFunction(() => __events.some((x) => x.name === 'feed-view'), null, { timeout: 8000 });
      s = await p.evaluate((id) => YSD.clips.stats(id).views - YSD_DATA.clips.items.find((x) => x.id === id).views, before.id);
      eq(s, 1, 'view counted after 2 s of playback');
      // single tap pauses
      await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await p.waitForFunction(() => document.querySelectorAll('video')[0].paused, null, { timeout: 4000 });
      ok(true, 'single tap pauses');
      await ctx3.close();
    });

    await section('browser: feed respects prefers-reduced-motion (no autoplay) and escapes text', async () => {
      const ctx4 = await browser.newContext({ viewport: { width: 390, height: 700 }, reducedMotion: 'reduce' });
      const p = await open(ctx4, 'demo');
      await p.evaluate(async () => { window.__feed = YSD.feed.mount('#feed', await YSD.clips.list()); });
      await p.waitForTimeout(1200);
      let s = await p.evaluate(() => ({ auto: document.getElementById('feed').getAttribute('data-feed-autoplay'), paused: document.querySelector('video').paused, idx: __feed.index, poster: !!document.querySelector('video').getAttribute('poster') }));
      ok(s.auto === 'off' && s.paused && s.idx === 0, 'no autoplay under reduced motion', s);
      ok(s.poster, 'poster shown instead');
      const box = await p.locator('[data-feed-item]').first().boundingBox();
      await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await p.waitForFunction(() => !document.querySelector('video').paused, null, { timeout: 5000 });
      ok(true, 'tap starts playback');
      s = await p.evaluate(() => {
        YSD.feed.mount('#feed', [{ id: 'x1', caption: '<img src=x onerror="window.__xss=1">', author: { handle: '@a"><b>' }, tags: ['t'], src: 'assets/video/trivia-night-recap.mp4', likes: 1 }]);
        return new Promise((res) => setTimeout(() => res({ img: document.querySelectorAll('#feed img').length, b: document.querySelectorAll('#feed b').length, xss: window.__xss || null, text: document.querySelector('[data-feed-caption]').textContent }), 300));
      });
      ok(s.img === 0 && s.b === 0 && s.xss === null && /<img/.test(s.text), 'user text rendered as text', s);
      await ctx4.close();
    });

    await section('browser: file:// page lists and plays demo clips', async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ysd-video-'));
      const html = path.join(tmp, 'index.html');
      const src = (f) => pathToFileURL(path.join(ROOT, f)).href;
      fs.writeFileSync(html, '<!doctype html><meta charset="utf-8"><script>window.YSD_CONFIG={demo:true}</script>' +
        ['assets/js/config.js', 'assets/js/store.js', 'data/clips.js', 'assets/js/clips.js', 'assets/js/feed.js'].map((f) => '<script src="' + src(f) + '"></script>').join('') + '<div id="feed"></div>');
      const p = await ctx.newPage();
      p.on('pageerror', (e) => pageErrors.push('file: ' + e.message));
      await p.addInitScript(PAGE_HELPERS);
      await p.goto(pathToFileURL(html).href);
      await p.waitForFunction(() => window.YSD && window.YSD.clips);
      const r = await p.evaluate(async () => { const all = await YSD.clips.list(); return { n: all.length, src: all[0].src, load: await __canLoad(all[0].src) }; });
      ok(r.n >= 6 && /^file:\/\/.+\/assets\/video\/.+\.mp4$/.test(r.src), 'file:// src resolved', r);
      ok(r.load.ok, 'clip loads over file://', r.load);
      await p.close();
      fs.rmSync(tmp, { recursive: true, force: true });
    });

    await section('browser: no uncaught page errors', async () => {
      ok(pageErrors.length === 0, 'no page errors', pageErrors);
    });
    await ctx.close();
  } finally {
    await browser.close();
    srv.close();
  }
}
