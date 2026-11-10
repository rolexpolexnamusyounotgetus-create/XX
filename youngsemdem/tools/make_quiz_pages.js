#!/usr/bin/env node
/**
 * tools/make_quiz_pages.js (W5): writes the static quiz result pages, English and Spanish (BRIEF 4.7, 7.5).
 *
 *   node tools/make_quiz_pages.js            # write quiz/show-up/<slug>.html, quiz/issue/<slug>.html + es/ twins
 *   node tools/make_quiz_pages.js --check    # write nothing; exit 1 if any page is missing or out of date
 *
 * Why: link previews don't run JavaScript, so a shared result needs its own page with its own OG tags
 * (report 04 B7). 6 "How do you show up?" types + 9 issues = 15 pages per language, 30 in all.
 * Source: data/quiz.js (results, identities, copy), data/issues.js (issue facts and actions), data/pages/quiz.js
 * (page copy), data/strings.js (seo.quizResult.*, cta.shareGroup, share.quiz*), data/events.js (which event series
 * are open, behind the January drop, or gone: journeys-05; assets/js/pages/quiz.js re-checks at runtime).
 * Round 1 (Nov 10, 2026): pages carry the result's character (assets/img/characters), the issue identity name,
 * a "Kira got The Hype Captain. Your turn…" slot for ?from= (genz-brand-13), a share button that sends quiz.html
 * with the sharer's own ref and from (journeys-23), and an og-quiz image with the character and a whole subline
 * (genz-brand-15). It also writes assets/img/characters/characters.js from the SVGs (see below). Generated subpages are written in both
 * languages by this generator (BRIEF 7.5), with hreflang pairs; then tools/sync_partials.py fills the
 * partials. Each page declares <meta name="ysd:og"> (og-quiz) so `node tools/make_og.js` renders its
 * preview image at assets/img/og/quiz/... and assets/img/og/es/quiz/...
 * Idempotent: files are only rewritten when their bytes change (partials are compared after syncing).
 * Exit codes: 0 ok, 1 --check found stale pages, 2 crash.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const CHECK = process.argv.includes('--check');
const ART = { hype: 'sun', chat: 'calendar', data: 'cypress', doors: 'chicken', creator: 'camera', plusone: 'heart' };
const ISSUE_ART = { housing: 'heart', heat: 'sun', schools: 'calendar', wages: 'celery', transit: 'train', water: 'gator', voting: 'calendar' };
const DARK = new Set(['violet', 'violet-deep']);

function load(files) {
  const sb = { window: {}, console: { log() {}, warn() {}, error() {} } };
  sb.window.YSD_DATA = {};
  vm.createContext(sb);
  for (const f of files) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sb, { filename: f });
  return JSON.parse(JSON.stringify(sb.window.YSD_DATA));
}
const DATA = load(['data/quiz.js', 'data/issues.js', 'data/pages/quiz.js', 'data/strings.js', 'data/events.js']);
const Q = DATA.quiz, I = DATA.issues, P = DATA.pages.quiz, S = DATA.strings.entries;

function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
function pick(o, L) { return !o ? '' : typeof o === 'string' ? o : (o[L] != null ? o[L] : (o.en || '')); }
function fill(s, v) { return String(s).replace(/\{(\w+)\}/g, (m, k) => (v[k] != null ? v[k] : m)); }
function cap(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }
function p(key, L) { return pick(P[key], L); }
function str(key, L, v) { return fill(pick(S[key], L), v || {}); }
function byId(a, id) { return (a || []).find((x) => x && x.id === id) || null; }
function colorVar(name, kind) { return kind === 'issue' ? 'var(--issue-' + name + ')' : 'var(--' + name + ')'; }
function actionLabel(a, L) { return a.labelAfter && Date.now() >= Date.parse(a.labelAfter.date + 'T00:00:00-05:00') ? pick(a.labelAfter, L) : pick(a.label, L); }

/** One result page. kind: 'show-up' | 'issue'. */
function page(kind, id, L) {
  const isEs = L === 'es';
  const up = isEs ? '../../../' : '../../';     // to the site root (assets, data)
  const pg = '../../';                          // to sibling pages in this language (es/ pages stay in es/)
  let name, plain = '', slug, color, lead, sub, kicker, eyebrow, calm = false, sticker = '', art = '', sections = [], others = [], ogTitle, ogSub, ogKicker;
  let seriesIds = [], quizId, quizHash;
  if (kind === 'show-up') {
    const r = byId(Q.organizerEra.results, id);
    name = pick(r.name, L); slug = r.slug; color = r.color; sticker = ART[id]; art = r.character === false ? '' : 'show-up/' + r.slug;
    lead = (r.description[L] || r.description.en).join(' ');
    sub = pick(r.card.subline, L);
    kicker = pick(Q.organizerEra.copy.matchLabel, L).toUpperCase();
    eyebrow = p('r.eyebrowShowUp', L);
    sections.push(['x-str', pick(Q.organizerEra.copy.strengthsTitle, L), '<ul class="x-strengths">' + (r.strengths[L] || r.strengths.en).map((s) => '<li>' + esc(s) + '</li>').join('') + '</ul>']);
    sections.push(['x-acts', pick(Q.organizerEra.copy.actionsTitle, L), actions(r.actions, L, pg)]);
    seriesIds = r.eventSeries || [];
    others = Q.organizerEra.results.filter((x) => x.id !== id).map((x) => ({ href: x.slug + '.html', text: pick(x.name, L), c: colorVar(x.color), fg: DARK.has(x.color) ? 'var(--cream)' : 'var(--night)', art: 'show-up/' + x.slug }));
    ogTitle = str('seo.quizResult.ogTitle', L, { match: name });
    ogKicker = pick(Q.organizerEra.copy.matchLabel, L).toUpperCase();
    ogSub = sub;
    quizId = Q.organizerEra.id; quizHash = 'show-up';
  } else {
    const it = byId(I.items, id), res = Q.issueFinder.results[id];
    const ident = res.identity ? pick(res.identity.name, L) : '';
    plain = cap(pick(it.short, L));
    name = ident || pick(it.title, L); slug = res.slug; color = it.color; calm = it.tone === 'serious';
    sticker = calm ? '' : (ISSUE_ART[id] || ''); art = res.character === false ? '' : 'issue/' + res.slug;
    lead = pick(it.hook, L);
    // dated lines (voting: the student-ID rule from Jan 1, 2027) switch when the pages are regenerated after the date
    const after = res.card.sublineAfter && Date.now() >= Date.parse(res.card.sublineAfter.date + 'T00:00:00-05:00');
    sub = pick(after ? res.card.sublineAfter : res.card.subline, L).replace(/\s*(Find your issue\.|Encuentra tu tema\.)\s*$/, '');
    kicker = pick(ident ? Q.issueFinder.copy.identityLabel : Q.issueFinder.copy.matchLabel, L).toUpperCase();
    eyebrow = p('r.eyebrowIssue', L);
    const facts = (it.facts || []).slice(0, 3).map((f) => '<li class="x-fact">' +
      (f.stat ? '<p class="x-fact__stat"><b>' + esc((L === 'es' && f.stat.valueEs) || f.stat.value) + '</b> <span>' + esc(pick(f.stat.label, L)) + '</span></p>' : '') +
      '<p class="x-fact__text">' + esc(pick(f.text, L)) + '</p>' +
      (f.source ? '<p class="x-fact__src"><a class="link link--out" href="' + esc(f.source) + '" rel="noopener"><span>' + esc(pick(Q.ui.source, L) + ':') + '</span>&nbsp;<span lang="en" translate="no">' + esc(String(f.sourceName || '').split(/[,:]/)[0].trim()) + '</span></a></p>' : '') +
      '</li>').join('');
    sections.push(['x-facts', pick(Q.issueFinder.copy.factsTitle, L), '<ul class="x-facts" data-real>' + facts + '</ul>']);
    sections.push(['x-acts', pick(Q.issueFinder.copy.actionsTitle, L), actions([it.action].concat(it.moreActions || []), L, pg)]);
    seriesIds = res.eventSeries || it.eventSeries || [];
    others = I.items.filter((x) => x.id !== id && Q.issueFinder.results[x.id]).map((x) => {
      const rr = Q.issueFinder.results[x.id];
      return { href: rr.slug + '.html', text: rr.identity ? pick(rr.identity.name, L) : cap(pick(x.short, L)), c: colorVar(x.color, 'issue'), fg: DARK.has(x.color) ? 'var(--cream)' : 'var(--night)', art: rr.character === false ? '' : 'issue/' + rr.slug };
    });
    // the link preview names the identity and keeps the sourced number whole (genz-brand-14, genz-brand-15)
    ogTitle = str('seo.quizResult.ogTitle', L, { match: ident || plain });
    ogKicker = pick(Q.issueFinder.copy.identityLabel, L).toUpperCase();
    ogSub = ident ? plain + ' · ' + sub : sub;
    quizId = Q.issueFinder.id; quizHash = 'issue';
  }
  const series = seriesIds.filter((s) => Q.eventSeries[s]).map((s) => ({ id: s, label: pick(Q.eventSeries[s].label, L) }));
  const kinds = ['learn', 'social', 'volunteer'].filter((k) => (Q.eventKinds || {})[k]).map((k) => ({ id: k, label: pick(Q.eventKinds[k].label, L) }));
  sections.push(['x-ev', pick(Q.organizerEra.copy.eventsTitle, L), '<div data-quiz-series-slot>' + seriesStatic(series, kinds, L, pg) + '</div>']);
  sections.push(['x-oth', p(kind === 'show-up' ? 'r.others' : 'r.otherIssues', L), '<ul class="x-rothers">' + others.map((o) =>
    '<li><a href="' + o.href + '" style="--c: ' + o.c + '; --fg: ' + o.fg + '">' + (o.art ? '<img data-src="assets/img/characters/' + o.art + '.svg" alt="" width="36" height="37" decoding="async">' : '') + '<span>' + esc(o.text) + '</span></a></li>').join('') + '</ul>']);
  const dark = DARK.has(color), cv = colorVar(color, kind === 'issue' ? 'issue' : ''), fg = dark ? 'var(--cream)' : 'var(--night)';
  const file = 'quiz/' + kind + '/' + slug + '.html';
  const og = { template: 'og-quiz', kicker: ogKicker, title: name, sub: ogSub, color: calm ? 'lake' : color, lang: L };
  if (art) og.character = art;
  const ogImg = up + 'assets/img/og/' + (isEs ? 'es/' : '') + file.replace(/\.html$/, '.png');
  const take = kind === 'show-up' ? p('r.takeShowUp', L) : p('r.takeIssue', L);
  const all = kind === 'show-up' ? p('r.allTypes', L) : p('r.allIssues', L);
  const takeHref = pg + 'quiz.html#' + quizHash;
  const allHref = pg + 'quiz.html#' + (kind === 'show-up' ? 'types' : 'issues-list');
  const hl = isEs
    ? ['<link rel="alternate" hreflang="en" href="../../../' + file + '">', '<link rel="alternate" hreflang="es" href="' + slug + '.html">', '<link rel="alternate" hreflang="x-default" href="../../../' + file + '">']
    : ['<link rel="alternate" hreflang="en" href="' + slug + '.html">', '<link rel="alternate" hreflang="es" href="../../es/' + file + '">', '<link rel="alternate" hreflang="x-default" href="' + slug + '.html">'];
  const sfx = isEs ? '-es' : '';
  const paid = isEs ? 'Pagado por [nombre y dirección del comité]' : 'Paid for by [committee name and address placeholder]';
  // runtime config for assets/js/pages/quiz.js (sender line, share target, the series against today's calendar)
  const names = {};
  if (kind === 'show-up') Q.organizerEra.results.forEach((x) => { names[x.id] = pick(x.name, L); });
  else Object.keys(Q.issueFinder.results).forEach((k) => { const x = byId(I.items, k); if (x) names[k] = pick(x.short, L); });   // "my Seminole issue is rent + housing"
  const fromTpl = kind === 'show-up' ? Q.ui.fromShowUp : (plain && name !== plain ? Q.ui.fromIssue : Q.ui.fromIssuePlain);
  const cfg = {
    kind, id, quizId, base: pg, share: (isEs ? 'es/' : '') + 'quiz.html#' + quizHash,
    from: fill(pick(fromTpl, L), { match: kind === 'issue' && name === pick(byId(I.items, id).title, L) ? pick(byId(I.items, id).short, L) : name }),
    shareText: str('share.quiz.sms', L, { link: '' }).replace(/\s+$/, ''),
    mineText: str(kind === 'show-up' ? 'share.quizEra.sms' : 'share.quizIssue.sms', L, { link: '' }).replace(/\s+$/, ''),
    names, series, kinds,
    ui: { notify: pick(Q.ui.notify, L), notifyDone: pick(Q.ui.notifyDone, L), dropSeries: pick(Q.ui.dropSeries, L), dropWhen: pick(Q.ui.dropWhen, L), dropTag: pick(Q.ui.dropTag, L), next: p('result.next', L) }
  };
  const longName = Math.max.apply(null, name.split(/\s+/).map((w) => w.length)) > 10;
  return {
    rel: (isEs ? 'es/' : '') + file,
    html: [
      '<!doctype html>',
      '<!-- GENERATED by tools/make_quiz_pages.js from data/quiz.js, data/issues.js and data/pages/quiz.js. Do not edit by hand. -->',
      '<html lang="' + L + '" data-page="quiz">',
      '<head>',
      '  <meta charset="utf-8">',
      '  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
      '  <title>' + esc(str('seo.quizResult.title', L, { match: name })) + '</title>',
      '  <meta name="description" content="' + esc(str('seo.quizResult.description', L)) + '">',
      '  <meta property="og:title" content="' + esc(ogTitle) + '">',
      '  <meta property="og:description" content="' + esc(ogSub) + '">',
      '  <meta property="og:image" content="' + ogImg + '">',
      '  <meta property="og:image:alt" content="' + esc(ogTitle + ' ' + ogSub) + '">',
      '  <meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">',
      '  <meta property="og:locale" content="' + (isEs ? 'es_US' : 'en_US') + '"><meta property="og:locale:alternate" content="' + (isEs ? 'en_US' : 'es_US') + '">',
      "  <meta name=\"ysd:og\" content='" + esc(JSON.stringify(og)) + "'>",
      '  <!-- @head --><!-- /@head -->',
      hl.map((x) => '  ' + x).join('\n'),
      '  <link rel="stylesheet" href="' + up + 'assets/css/pages/quiz.css">',
      '</head>',
      '<body class="p-quiz" data-landing="custom">',
      '  <!-- @demo-banner' + sfx + ' --><!-- /@demo-banner' + sfx + ' -->',
      '  <!-- @header' + sfx + ' --><!-- /@header' + sfx + ' -->',
      "  <main id=\"main\" data-quiz-rpage='" + esc(JSON.stringify(cfg)) + "'>",
      '    <section class="section ' + (dark ? 'theme-dark' : 'theme-light') + ' x-rhero" style="--c: ' + cv + '; --fg: ' + fg + '" aria-labelledby="r-title"' + (calm ? ' data-tone="calm"' : '') + '>',
      '      <div class="wrap x-rhero__grid">',
      '        <div class="x-rhero__copy">',
      '          <p class="x-sent" data-quiz-from hidden></p>',
      art ? '          <img class="x-rhero__char" src="' + up + 'assets/img/characters/' + art + '.svg" alt="" width="256" height="264" decoding="async">' : '',
      '          <p class="x-rhero__eyebrow">' + esc(eyebrow) + '</p>',
      '          <h1 class="x-rhero__name" id="r-title"' + (longName ? ' data-len="long"' : '') + '>' + esc(name) + '</h1>',
      plain && plain !== name ? '          <p class="x-rhero__issue">' + esc(plain) + '</p>' : '',
      '          <p class="x-rhero__lead"' + (kind === 'issue' ? ' data-real' : '') + '>' + esc(lead) + '</p>',
      '          <div class="btn-row">',
      '            <a class="btn btn--primary btn--lg" href="' + takeHref + '">' + esc(take) + '</a>',
      '            <a class="btn ' + (dark ? 'btn--ghost' : 'btn--ink') + '" href="' + allHref + '">' + esc(all) + '</a>',
      '          </div>',
      '          <p class="x-rhero__note" data-quiz-someone>' + esc(p('r.someone', L)) + '</p>',
      '        </div>',
      '        <div class="x-rcard" style="--c: ' + cv + '; --fg: ' + fg + '" aria-hidden="true"' + (calm ? ' data-tone="calm"' : '') + '>',
      !art && sticker ? '          <span class="sticker x-rcard__sticker" data-sticker="' + sticker + '"></span>' : '',
      '          <div class="x-rcard__top"><span class="x-rcard__kicker">' + esc(kicker) + '</span></div>',
      art ? '          <img class="x-rcard__char" src="' + up + 'assets/img/characters/' + art + '.svg" alt="" width="256" height="264" loading="lazy" decoding="async">' : '',
      '          <p class="x-rcard__name"' + (longName ? ' data-len="long"' : '') + '>' + esc(name) + '</p>',
      '          <p class="x-rcard__line">' + esc(sub) + '</p>',
      '          <p class="x-rcard__foot"><span>' + esc(paid) + '</span><span class="tag tag--demo">DEMO</span></p>',
      '        </div>',
      '      </div>',
      '    </section>',
      '    <section class="section">',
      '      <div class="wrap x-rbody">',
      sections.filter((s) => s[2]).map((s) => '        <section aria-labelledby="' + s[0] + '"><h2 id="' + s[0] + '">' + esc(s[1]) + '</h2>' + s[2] + '</section>').join('\n'),
      '      </div>',
      '    </section>',
      '    <section class="section section--celery x-share" aria-labelledby="share-title">',
      '      <div class="wrap x-share__inner">',
      '        <div><h2 class="x-share__title" id="share-title">' + esc(p('share.title', L)) + '</h2><p class="x-share__sub">' + esc(p('share.sub', L)) + '</p></div>',
      '        <button class="btn btn--ink btn--lg" type="button" data-share="quiz" data-quiz-share><span>' + esc(str('cta.shareGroup', L)) + '</span></button>',
      '      </div>',
      '    </section>',
      '  </main>',
      '  <!-- @footer' + sfx + ' --><!-- /@footer' + sfx + ' -->',
      '  <!-- @scripts --><!-- /@scripts -->',
      '  <script src="' + up + 'data/slices/quiz.js"></script>',
      '  <script src="' + up + 'assets/js/pages/quiz.js"></script>',
      '</body>',
      '</html>',
      ''
    ].filter((x) => x !== '').join('\n')
  };
}
function actions(list, L, pg) {
  return '<ol class="x-actions">' + list.slice(0, 3).map((a, i) => {
    const file = (I.pages || {})[a.page] || (a.page + '.html');
    const m = /(?:^|&)series=([^&]+)/.exec(a.query || '');
    let query = a.query || '', when = '';
    if (m) {
      const s = decodeURIComponent(m[1]), st = seriesState(s);
      if (st === 'drop') when = '<span class="tag tag--new x-action__when">' + esc(pick(Q.ui.dropTag, L)) + '</span>';
      else if (st === 'none') { const k = kindOfSeries(s); query = k && kindOpen(k) ? 'kind=' + k : ''; }
    }
    const href = pg + file + (query ? '?' + query : '') + (a.hash ? '#' + a.hash : '');
    return '<li class="x-action"><span class="x-action__n" aria-hidden="true">' + (i + 1) + '</span><a class="x-action__link" href="' + esc(href) + '"' + (m ? ' data-series="' + esc(decodeURIComponent(m[1])) + '"' : '') + '>' + esc(actionLabel(a, L)) + '</a>' + when + (a.demo ? '<span class="tag tag--demo">DEMO</span>' : '') + '</li>';
  }).join('') + '</ol>';
}
// ---------------------------------------------------------------- events at build time (quiz.js re-checks at runtime)
const EV = (DATA.events && DATA.events.items) || [], DROP = DATA.events && DATA.events.schedule && DATA.events.schedule.drop;
function dropClosed() { return !!(DROP && Date.now() < Date.parse(DROP.opensAt)); }
function upcoming(e) { return e && e.status !== 'cancelled' && Date.parse(e.end || e.start) >= Date.now(); }
function hiddenByDrop(e) { return dropClosed() && Date.parse(e.start) > Date.parse(DROP.cutoff); }
function seriesState(s) { let st = 'none'; EV.forEach((e) => { if (e.series !== s || !upcoming(e)) return; if (!hiddenByDrop(e)) st = 'open'; else if (st !== 'open') st = 'drop'; }); return st; }
function kindOpen(k) { return EV.some((e) => e.kind === k && upcoming(e) && !hiddenByDrop(e)); }
function kindOfSeries(s) { const e = EV.find((x) => x.series === s); return e ? e.kind : ''; }
function listJoin(items, L) { return items.length > 1 ? items.slice(0, -1).join(', ') + (L === 'es' ? ' y ' : ' and ') + items[items.length - 1] : (items[0] || ''); }
function lowerFirst(s) { return /^[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(\s|$)/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s; }
/** The no-JS version of the "Events made for you" block: same rules as quiz.js seriesBlock(). */
function seriesStatic(series, kinds, L, pg) {
  const chips = [], dropped = [];
  series.forEach((s) => { const st = seriesState(s.id); if (st === 'open') chips.push('<a class="chip" href="' + pg + 'events.html?series=' + encodeURIComponent(s.id) + '">' + esc(s.label) + '</a>'); else if (st === 'drop') dropped.push(s.label); });
  if (!chips.length) kinds.forEach((k) => { if (kindOpen(k.id)) chips.push('<a class="chip" href="' + pg + 'events.html?kind=' + encodeURIComponent(k.id) + '">' + esc(k.label) + '</a>'); });
  let out = chips.length ? '<div class="chip-row">' + chips.join('') + '</div>' : '';
  if (dropped.length && DROP) {
    const names = listJoin(dropped.map((x, i) => (i ? lowerFirst(x) : x)), L);
    out += '<div class="x-drop" data-quiz-drop><p class="x-drop__text"><b>' + esc(fill(pick(Q.ui.dropSeries, L), { series: names })) + '</b> <span>' + esc(pick(Q.ui.dropWhen, L)) + '</span></p></div>';
  }
  return out;
}

// ---------------------------------------------------------------- characters (genz-brand-02)
// assets/img/characters/<kind>/<slug>.svg are the source art (hand-tuned, optimised). Canvas cards can't draw an
// SVG file on file:// without tainting, so this writes assets/img/characters/characters.js: the same SVGs as
// strings, plus English and Spanish alt text, in window.YSD_DATA.characters.items['show-up/hype-captain'].
const CHAR_DIR = path.join(ROOT, 'assets', 'img', 'characters');
function characterAlt(kind, slug) {
  const out = {};
  for (const L of ['en', 'es']) {
    let name = '';
    if (kind === 'show-up') { const r = Q.organizerEra.results.find((x) => x.slug === slug); name = r ? pick(r.name, L) : slug; }
    else { const id = Object.keys(Q.issueFinder.results).find((k) => Q.issueFinder.results[k].slug === slug); const res = Q.issueFinder.results[id] || {}; name = res.identity ? pick(res.identity.name, L) : slug; }
    out[L] = fill(p('char.alt', L) || '{name}', { name });
  }
  return out;
}
function characterBundle() {
  const items = {};
  for (const kind of ['show-up', 'issue']) {
    const dir = path.join(CHAR_DIR, kind);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((x) => /\.svg$/.test(x)).sort()) {
      const slug = f.replace(/\.svg$/, ''), svg = fs.readFileSync(path.join(dir, f), 'utf8').trim();
      if (/<script|on\w+=|href=/i.test(svg)) throw new Error('character ' + f + ': scripts, handlers and links are not allowed');
      items[kind + '/' + slug] = { svg, alt: characterAlt(kind, slug) };
    }
  }
  return '/*! assets/img/characters/characters.js · GENERATED by tools/make_quiz_pages.js from assets/img/characters/<kind>/<slug>.svg.\n' +
    ' * Do not edit by hand: edit the SVG, then run node tools/make_quiz_pages.js.\n' +
    ' * The illustrated character set (genz-brand-02): one per "How do you show up?" type and one per issue identity\n' +
    ' * (reproductive freedom stays plain). Drawn for this site in the sticker style: no real people, no candidate\n' +
    ' * likeness, no Native imagery. Pages show the .svg files with <img>; canvas cards (assets/js/cards-brand.js,\n' +
    ' * assets/js/cards-og.js) read these strings as data: URLs so file:// never taints a canvas.\n' +
    ' *   window.YSD_DATA.characters = { version, items: { "<kind>/<slug>": { svg, alt: { en, es } } } }\n */\n' +
    'window.YSD_DATA = window.YSD_DATA || {};\nwindow.YSD_DATA.characters = ' + JSON.stringify({ version: 1, items }, null, 0)
      .replace(/\},"/g, '},\n"') + ';\n';
}

/** quiz.html's hero deck draws its characters inline (no extra requests in the first view): fill every
 *  <span class="x-deck__char" data-char="show-up/<slug>"> with that SVG. make_es.js copies it to es/quiz.html. */
function inlineDeck(html) {
  return html.replace(/(<span class="x-deck__char" data-char="([\w-]+\/[\w-]+)">)[\s\S]*?(<\/span>)/g, (m, open, p, close) => {
    const f = path.join(CHAR_DIR, p + '.svg');
    if (!fs.existsSync(f)) return m;
    const svg = fs.readFileSync(f, 'utf8').trim().replace('<svg ', '<svg aria-hidden="true" focusable="false" ');
    return open + svg + close;
  });
}

function stripPartials(s) { return s.replace(/(<!-- @([\w-]+) -->)[\s\S]*?(<!-- \/@\2 -->)/g, '$1$3'); }
function main() {
  const pages = [];
  for (const L of ['en', 'es']) {
    for (const r of Q.organizerEra.results) pages.push(page('show-up', r.id, L));
    for (const id of Object.keys(Q.issueFinder.results)) if (byId(I.items, id)) pages.push(page('issue', id, L));
  }
  const written = [], stale = [];
  const quizAbs = path.join(ROOT, 'quiz.html');
  if (fs.existsSync(quizAbs)) {
    const q0 = fs.readFileSync(quizAbs, 'utf8'), q1 = inlineDeck(q0);
    if (q0 !== q1) { if (CHECK) stale.push('quiz.html (deck characters)'); else { fs.writeFileSync(quizAbs, q1); console.log('make_quiz_pages: inlined the deck characters in quiz.html (run make_es.js quiz.html next)'); } }
  }
  const bundle = characterBundle(), bundleAbs = path.join(CHAR_DIR, 'characters.js');
  const oldBundle = fs.existsSync(bundleAbs) ? fs.readFileSync(bundleAbs, 'utf8') : null;
  if (oldBundle !== bundle) { if (CHECK) stale.push('assets/img/characters/characters.js'); else { fs.writeFileSync(bundleAbs, bundle); console.log('make_quiz_pages: wrote assets/img/characters/characters.js'); } }
  for (const pg of pages) {
    const abs = path.join(ROOT, pg.rel);
    const old = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
    const same = old != null && stripPartials(old) === stripPartials(pg.html);
    if (same) continue;
    if (CHECK) { stale.push(pg.rel); continue; }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, pg.html);
    written.push(abs);
  }
  if (!CHECK && written.length) {
    const r = spawnSync('python3', [path.join(__dirname, 'sync_partials.py'), '--quiet'].concat(written), { encoding: 'utf8' });
    if (r.status !== 0) { process.stderr.write(r.stdout + r.stderr); process.exit(2); }
  }
  console.log('make_quiz_pages: ' + pages.length + ' pages (' + (pages.length / 2) + ' EN + ' + (pages.length / 2) + ' ES), ' +
    (CHECK ? stale.length + ' stale' : written.length + ' written'));
  if (CHECK && stale.length) { stale.forEach((s) => console.log('  stale: ' + s)); process.exit(1); }
}
try { main(); } catch (e) { console.error(e && e.stack || e); process.exit(2); }
