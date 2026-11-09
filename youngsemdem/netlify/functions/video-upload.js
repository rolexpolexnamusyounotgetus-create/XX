/**
 * Young Seminole Democrats: production video upload endpoint (Netlify Function, CommonJS).
 * Netlify path: /.netlify/functions/video-upload. Map /api/video-upload to it with a redirect:
 *   [[redirects]] from = "/api/video-upload"  to = "/.netlify/functions/video-upload"  status = 200
 * (or point YSD_CONFIG.integrations.videoUploadEndpoint at /.netlify/functions/video-upload).
 *
 * Same protocol, environment variables and core code as functions/api/video-upload.js (the
 * Cloudflare Pages twin): see that file's header and docs/infra/video.md. Set the variables in
 * Netlify > Site configuration > Environment variables (scope: Functions). Needs Node 18+
 * (global fetch, Request, Response, btoa); Netlify's default runtime qualifies.
 * Written as a Lambda-compatible handler so it works without "type": "module" in package.json.
 */
'use strict';

exports.handler = async function handler(event) {
  const headers = new Headers();
  const h = event.headers || {};
  Object.keys(h).forEach((k) => { if (h[k] != null) headers.set(k, String(h[k])); });
  let url = event.rawUrl;
  if (!url) {
    const host = headers.get('host') || 'localhost';
    const qs = new URLSearchParams(event.queryStringParameters || {}).toString();
    url = 'https://' + host + (event.path || '/.netlify/functions/video-upload') + (qs ? '?' + qs : '');
  }
  const method = String(event.httpMethod || 'GET').toUpperCase();
  let body;
  if (method !== 'GET' && method !== 'HEAD' && event.body != null) {
    body = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : String(event.body);
  }
  const res = await handleVideoUpload(new Request(url, { method, headers, body }), process.env);
  const out = {};
  res.headers.forEach((v, k) => { out[k] = v; });
  return { statusCode: res.status, headers: out, body: res.status === 204 ? '' : await res.text() };
};

// ==== BEGIN SHARED CORE (identical in netlify/functions/video-upload.js; tests compare them) ====
const CF_API = 'https://api.cloudflare.com/client/v4';
const MUX_API = 'https://api.mux.com/video/v1';
const TURNSTILE_VERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v', 'video/3gpp', 'video/3gpp2', 'video/ogg', 'video/x-matroska'];
const CF_BASIC_MAX = 200 * 1024 * 1024;
const MAX_BODY = 16 * 1024;

function envList(v) { return String(v || '').split(',').map((s) => s.trim()).filter(Boolean); }
function envInt(v, d) { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : d; }
function clip(s, n) { return String(s == null ? '' : s).replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, n); }

function originAllowed(origin, allowed) {
  if (!allowed.length || !origin) return true;
  return allowed.some((a) => a === '*' || a.toLowerCase() === origin.toLowerCase());
}
function corsHeaders(origin, allowed) {
  if (!allowed.length || !origin || !originAllowed(origin, allowed)) return {};
  return {
    'Access-Control-Allow-Origin': allowed.indexOf('*') >= 0 ? '*' : origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin'
  };
}
function reply(status, body, extra) {
  return new Response(body == null ? null : JSON.stringify(body), {
    status,
    headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }, extra || {})
  });
}
function fail(status, error, message, extra) { return reply(status, { ok: false, error, message }, extra); }

function pickProvider(env, wanted) {
  const cf = !!(env.CF_ACCOUNT_ID && env.CF_STREAM_API_TOKEN);
  const mux = !!(env.MUX_TOKEN_ID && env.MUX_TOKEN_SECRET);
  const pref = String(wanted || env.VIDEO_PROVIDER || '').toLowerCase();
  if (pref === 'cloudflare') return cf ? 'cloudflare' : null;
  if (pref === 'mux') return mux ? 'mux' : null;
  return cf ? 'cloudflare' : mux ? 'mux' : null;
}
function cfHeaders(env) { return { Authorization: 'Bearer ' + env.CF_STREAM_API_TOKEN, 'Content-Type': 'application/json' }; }
function muxHeaders(env) { return { Authorization: 'Basic ' + btoa(env.MUX_TOKEN_ID + ':' + env.MUX_TOKEN_SECRET), 'Content-Type': 'application/json' }; }
async function providerJson(res) { try { return await res.json(); } catch (e) { return null; } }
function providerFail(name, res, cors) {
  console.error('[video-upload] ' + name + ' API error: HTTP ' + (res && res.status));
  return fail(502, 'provider-error', 'The video service did not accept the request. Try again later.', cors);
}

async function verifyTurnstile(env, token, ip) {
  if (!env.TURNSTILE_SECRET_KEY) return true;
  if (!token) return false;
  const form = new URLSearchParams();
  form.set('secret', env.TURNSTILE_SECRET_KEY);
  form.set('response', String(token));
  if (ip) form.set('remoteip', ip);
  try {
    const r = await fetch(TURNSTILE_VERIFY, { method: 'POST', body: form });
    const j = await providerJson(r);
    return !!(j && j.success);
  } catch (e) { return false; }
}

async function createUpload(provider, env, meta, origin, cors) {
  const maxDurationSeconds = meta.maxDurationSeconds;
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  if (provider === 'cloudflare') {
    const body = {
      maxDurationSeconds,
      expiry: expiresAt,
      requireSignedURLs: String(env.CF_STREAM_REQUIRE_SIGNED_URLS || '').toLowerCase() === 'true',
      allowedOrigins: envList(env.CF_STREAM_ALLOWED_ORIGINS),
      thumbnailTimestampPct: 0.1,
      meta: {
        name: meta.filename || 'clip', site: 'youngsemdem', review: 'pending', clientId: meta.clientId,
        caption: meta.caption, tags: meta.tags.join(','), author: meta.author, ref: meta.ref
      }
    };
    if (meta.author) body.creator = meta.author.slice(0, 64);
    const res = await fetch(CF_API + '/accounts/' + encodeURIComponent(env.CF_ACCOUNT_ID) + '/stream/direct_upload', {
      method: 'POST', headers: cfHeaders(env), body: JSON.stringify(body)
    });
    const j = await providerJson(res);
    if (!res.ok || !j || !j.success || !j.result || !j.result.uploadURL) return providerFail('Cloudflare', res, cors);
    return reply(200, {
      ok: true, provider: 'cloudflare', id: j.result.uid, uploadUrl: j.result.uploadURL, method: 'POST', field: 'file',
      maxBytes: meta.maxBytes, maxDurationSeconds, expiresAt
    }, cors);
  }
  const passthrough = JSON.stringify({ c: meta.clientId, a: meta.author, s: 'youngsemdem', r: 'pending' }).slice(0, 255);
  const res = await fetch(MUX_API + '/uploads', {
    method: 'POST', headers: muxHeaders(env),
    body: JSON.stringify({
      cors_origin: env.MUX_CORS_ORIGIN || origin || '*',
      timeout: 3600,
      new_asset_settings: {
        playback_policies: [env.MUX_PLAYBACK_POLICY === 'signed' ? 'signed' : 'public'],
        video_quality: env.MUX_VIDEO_QUALITY || 'basic',
        passthrough
      }
    })
  });
  const j = await providerJson(res);
  if (!res.ok || !j || !j.data || !j.data.url) return providerFail('Mux', res, cors);
  return reply(200, {
    ok: true, provider: 'mux', id: j.data.id, uploadUrl: j.data.url, method: 'PUT', headers: {},
    maxBytes: meta.maxBytes, maxDurationSeconds, expiresAt: new Date(Date.now() + 3600 * 1000).toISOString()
  }, cors);
}

async function uploadStatus(provider, env, id, cors) {
  if (provider === 'cloudflare') {
    if (!/^[a-f0-9]{32}$/i.test(id)) return fail(400, 'bad-id', 'Unknown video id.', cors);
    const res = await fetch(CF_API + '/accounts/' + encodeURIComponent(env.CF_ACCOUNT_ID) + '/stream/' + id, { headers: cfHeaders(env) });
    if (res.status === 404) return fail(404, 'not-found', 'Unknown video id.', cors);
    const j = await providerJson(res);
    if (!res.ok || !j || !j.result) return providerFail('Cloudflare', res, cors);
    const v = j.result, st = (v.status && v.status.state) || '';
    const state = v.readyToStream ? 'ready' : st === 'error' ? 'error' : st === 'pendingupload' ? 'waiting' : 'processing';
    const code = env.CF_STREAM_CUSTOMER_CODE;
    const base = code ? 'https://customer-' + code + '.cloudflarestream.com/' + id : '';
    const pb = v.playback || {};
    const playback = state === 'ready' ? {
      hls: pb.hls || (base ? base + '/manifest/video.m3u8' : null),
      dash: pb.dash || (base ? base + '/manifest/video.mpd' : null),
      mp4: null,
      poster: v.thumbnail || (base ? base + '/thumbnails/thumbnail.jpg' : null),
      iframe: v.preview || (base ? base + '/iframe' : null)
    } : null;
    return reply(200, {
      ok: true, provider, id, state, playback, duration: v.duration > 0 ? v.duration : null,
      width: (v.input && v.input.width) || null, height: (v.input && v.input.height) || null,
      message: state === 'error' ? clip(v.status && (v.status.errorReasonText || v.status.errReasonText), 200) : undefined
    }, cors);
  }
  if (!/^[A-Za-z0-9]{8,100}$/.test(id)) return fail(400, 'bad-id', 'Unknown upload id.', cors);
  const ures = await fetch(MUX_API + '/uploads/' + id, { headers: muxHeaders(env) });
  if (ures.status === 404) return fail(404, 'not-found', 'Unknown upload id.', cors);
  const uj = await providerJson(ures);
  if (!ures.ok || !uj || !uj.data) return providerFail('Mux', ures, cors);
  const u = uj.data;
  if (u.status === 'waiting') return reply(200, { ok: true, provider, id, state: 'waiting', playback: null }, cors);
  if (u.status !== 'asset_created' || !u.asset_id) return reply(200, { ok: true, provider, id, state: 'error', playback: null, message: clip(u.status, 40) }, cors);
  const ares = await fetch(MUX_API + '/assets/' + encodeURIComponent(u.asset_id), { headers: muxHeaders(env) });
  const aj = await providerJson(ares);
  if (!ares.ok || !aj || !aj.data) return providerFail('Mux', ares, cors);
  const a = aj.data;
  const state = a.status === 'ready' ? 'ready' : a.status === 'errored' ? 'error' : 'processing';
  const pid = (a.playback_ids || [])[0];
  const playback = state === 'ready' && pid ? {
    hls: 'https://stream.mux.com/' + pid.id + '.m3u8', dash: null, mp4: null,
    poster: 'https://image.mux.com/' + pid.id + '/thumbnail.jpg', iframe: null, policy: pid.policy
  } : null;
  return reply(200, { ok: true, provider, id, assetId: a.id, state, playback, duration: a.duration || null }, cors);
}

async function handleVideoUpload(request, env) {
  env = env || {};
  const method = request.method.toUpperCase();
  const origin = request.headers.get('Origin') || '';
  const allowed = envList(env.ALLOWED_ORIGINS);
  const cors = corsHeaders(origin, allowed);
  if (!originAllowed(origin, allowed)) return fail(403, 'origin-not-allowed', 'This site may not upload here.');
  if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (method !== 'GET' && method !== 'POST') return fail(405, 'method-not-allowed', 'Use GET or POST.', Object.assign({ Allow: 'GET, POST, OPTIONS' }, cors));

  if (method === 'GET') {
    const url = new URL(request.url);
    const id = url.searchParams.get('id') || '';
    const provider = pickProvider(env, url.searchParams.get('provider'));
    if (!provider) return fail(503, 'not-configured', 'Video uploads are not configured.', cors);
    if (!id) return reply(200, { ok: true, provider, configured: true }, cors);
    try { return await uploadStatus(provider, env, id, cors); } catch (e) { return providerFail(provider, null, cors); }
  }

  const provider = pickProvider(env);
  if (!provider) return fail(503, 'not-configured', 'Video uploads are not configured.', cors);
  const raw = await request.text();
  if (raw.length > MAX_BODY) return fail(413, 'body-too-large', 'Request too large.', cors);
  let body;
  try { body = JSON.parse(raw || '{}'); } catch (e) { return fail(400, 'bad-json', 'Send JSON.', cors); }
  if (!body || typeof body !== 'object') return fail(400, 'bad-json', 'Send JSON.', cors);
  if (body.action && body.action !== 'create') return fail(400, 'bad-action', 'Unknown action.', cors);

  let maxBytes = envInt(env.VIDEO_MAX_BYTES, 150 * 1024 * 1024);
  if (provider === 'cloudflare') maxBytes = Math.min(maxBytes, CF_BASIC_MAX);
  const maxDurationSeconds = envInt(env.VIDEO_MAX_DURATION_SECONDS, 180);
  const size = Number(body.size);
  const type = String(body.type || '').toLowerCase().split(';')[0];
  const duration = body.duration == null || body.duration === '' ? null : Number(body.duration);
  if (!Number.isFinite(size) || size <= 0) return fail(400, 'bad-size', 'File size missing.', cors);
  if (size > maxBytes) return fail(413, 'too-large', 'Videos can be up to ' + Math.floor(maxBytes / 1048576) + ' MB.', cors);
  if (VIDEO_TYPES.indexOf(type) < 0) return fail(415, 'bad-type', 'Upload an MP4, MOV or WebM video.', cors);
  if (duration !== null && (!Number.isFinite(duration) || duration > maxDurationSeconds + 1)) {
    return fail(400, 'too-long', 'Videos can be up to ' + maxDurationSeconds + ' seconds.', cors);
  }
  const ip = request.headers.get('CF-Connecting-IP') || (request.headers.get('X-Forwarded-For') || '').split(',')[0].trim();
  if (!(await verifyTurnstile(env, body.turnstileToken, ip))) return fail(403, 'challenge-failed', 'Please complete the check and try again.', cors);

  const meta = {
    filename: clip(body.filename, 120), clientId: clip(body.clientId, 64), caption: clip(body.caption, 300),
    tags: (Array.isArray(body.tags) ? body.tags : []).slice(0, 8).map((t) => clip(t, 30)).filter(Boolean),
    author: clip(body.author, 40), ref: clip(body.ref, 40), maxBytes, maxDurationSeconds
  };
  try { return await createUpload(provider, env, meta, origin, cors); } catch (e) { return providerFail(provider, null, cors); }
}
// ==== END SHARED CORE ====
