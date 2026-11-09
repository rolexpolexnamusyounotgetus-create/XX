#!/usr/bin/env node
/**
 * tools/make_quiz_pages.js (W5): writes the static quiz result pages, English and Spanish (BRIEF 4.7, 7.5).
 *
 *   node tools/make_quiz_pages.js            # write quiz/show-up/<slug>.html, quiz/issue/<slug>.html + es/ twins
 *   node tools/make_quiz_pages.js --check    # write nothing; exit 1 if any page is missing or out of date
 *
 * Why: link previews don't run JavaScript, so a shared result needs its own page with its own OG tags
 * (report 04 B7). 6 "How do you show up?" types + 9 issues = 15 pages per language, 30 in all.
 * Source: data/quiz.js (results, copy), data/issues.js (issue facts and actions), data/pages/quiz.js
 * (page copy), data/strings.js (seo.quizResult.*, cta.shareGroup). Generated subpages are written in both
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
const DATA = load(['data/quiz.js', 'data/issues.js', 'data/pages/quiz.js', 'data/strings.js']);
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
  let name, slug, color, lead, sub, kicker, eyebrow, calm = false, sticker = '', sections = [], others = [], ogTitle, ogSub;
  if (kind === 'show-up') {
    const r = byId(Q.organizerEra.results, id);
    name = pick(r.name, L); slug = r.slug; color = r.color; sticker = ART[id];
    lead = (r.description[L] || r.description.en).join(' ');
    sub = pick(r.card.subline, L);
    kicker = pick(Q.organizerEra.copy.matchLabel, L).toUpperCase();
    eyebrow = p('r.eyebrowShowUp', L);
    sections.push(['x-str', pick(Q.organizerEra.copy.strengthsTitle, L), '<ul class="x-strengths">' + (r.strengths[L] || r.strengths.en).map((s) => '<li>' + esc(s) + '</li>').join('') + '</ul>']);
    sections.push(['x-acts', pick(Q.organizerEra.copy.actionsTitle, L), actions(r.actions, L, pg)]);
    sections.push(['x-ev', pick(Q.organizerEra.copy.eventsTitle, L), seriesChips(r.eventSeries, L, pg)]);
    others = Q.organizerEra.results.filter((x) => x.id !== id).map((x) => ({ href: x.slug + '.html', text: pick(x.name, L), c: colorVar(x.color), fg: DARK.has(x.color) ? 'var(--cream)' : 'var(--night)' }));
    sections.push(['x-oth', p('r.others', L), '<ul class="x-rothers">' + others.map((o) => '<li><a href="' + o.href + '" style="--c: ' + o.c + '; --fg: ' + o.fg + '">' + esc(o.text) + '</a></li>').join('') + '</ul>']);
    ogTitle = str('seo.quizResult.ogTitle', L, { match: name });
    ogSub = sub;
  } else {
    const it = byId(I.items, id), res = Q.issueFinder.results[id];
    name = pick(it.title, L); slug = res.slug; color = it.color; calm = it.tone === 'serious'; sticker = calm ? '' : (ISSUE_ART[id] || '');
    lead = pick(it.hook, L);
    // dated lines (voting: the student-ID rule from Jan 1, 2027) switch when the pages are regenerated after the date
    const after = res.card.sublineAfter && Date.now() >= Date.parse(res.card.sublineAfter.date + 'T00:00:00-05:00');
    sub = pick(after ? res.card.sublineAfter : res.card.subline, L).replace(/\s*(Find your issue\.|Encuentra tu tema\.)\s*$/, '');
    kicker = pick(Q.issueFinder.copy.matchLabel, L).toUpperCase();
    eyebrow = p('r.eyebrowIssue', L);
    const facts = (it.facts || []).slice(0, 3).map((f) => '<li class="x-fact">' +
      (f.stat ? '<p class="x-fact__stat"><b>' + esc((L === 'es' && f.stat.valueEs) || f.stat.value) + '</b> <span>' + esc(pick(f.stat.label, L)) + '</span></p>' : '') +
      '<p class="x-fact__text">' + esc(pick(f.text, L)) + '</p>' +
      (f.source ? '<p class="x-fact__src"><a class="link link--out" href="' + esc(f.source) + '" rel="noopener"><span>' + esc(pick(Q.ui.source, L) + ':') + '</span>&nbsp;<span lang="en" translate="no">' + esc(String(f.sourceName || '').split(/[,:]/)[0].trim()) + '</span></a></p>' : '') +
      '</li>').join('');
    sections.push(['x-facts', pick(Q.issueFinder.copy.factsTitle, L), '<ul class="x-facts" data-real>' + facts + '</ul>']);
    sections.push(['x-acts', pick(Q.issueFinder.copy.actionsTitle, L), actions([it.action].concat(it.moreActions || []), L, pg)]);
    sections.push(['x-ev', pick(Q.organizerEra.copy.eventsTitle, L), seriesChips(it.eventSeries, L, pg)]);
    others = I.items.filter((x) => x.id !== id && Q.issueFinder.results[x.id]).map((x) => ({ href: Q.issueFinder.results[x.id].slug + '.html', text: cap(pick(x.short, L)), c: colorVar(x.color, 'issue'), fg: DARK.has(x.color) ? 'var(--cream)' : 'var(--night)' }));
    sections.push(['x-oth', p('r.otherIssues', L), '<ul class="x-rothers">' + others.map((o) => '<li><a href="' + o.href + '" style="--c: ' + o.c + '; --fg: ' + o.fg + '">' + esc(o.text) + '</a></li>').join('') + '</ul>']);
    ogTitle = str('seo.quizResult.ogTitle', L, { match: cap(pick(it.short, L)) });
    ogSub = str('seo.quizResult.ogDescription', L);
  }
  const dark = DARK.has(color), cv = colorVar(color, kind === 'issue' ? 'issue' : ''), fg = dark ? 'var(--cream)' : 'var(--night)';
  const match = kind === 'issue' ? cap(pick(byId(I.items, id).short, L)) : name;
  const file = 'quiz/' + kind + '/' + slug + '.html';
  const og = { template: 'og-quiz', kicker: kicker, title: match, sub: ogSub, color: calm ? 'lake' : color, lang: L };
  const ogImg = up + 'assets/img/og/' + (isEs ? 'es/' : '') + file.replace(/\.html$/, '.png');
  const take = kind === 'show-up' ? p('r.takeShowUp', L) : p('r.takeIssue', L);
  const all = kind === 'show-up' ? p('r.allTypes', L) : p('r.allIssues', L);
  const takeHref = pg + 'quiz.html#' + (kind === 'show-up' ? 'show-up' : 'issue');
  const allHref = pg + 'quiz.html#' + (kind === 'show-up' ? 'types' : 'issues-list');
  const hl = isEs
    ? ['<link rel="alternate" hreflang="en" href="../../../' + file + '">', '<link rel="alternate" hreflang="es" href="' + slug + '.html">', '<link rel="alternate" hreflang="x-default" href="../../../' + file + '">']
    : ['<link rel="alternate" hreflang="en" href="' + slug + '.html">', '<link rel="alternate" hreflang="es" href="../../es/' + file + '">', '<link rel="alternate" hreflang="x-default" href="' + slug + '.html">'];
  const sfx = isEs ? '-es' : '';
  const paid = isEs ? 'Pagado por [nombre y dirección del comité]' : 'Paid for by [committee name and address placeholder]';
  return {
    rel: (isEs ? 'es/' : '') + file,
    html: [
      '<!doctype html>',
      '<!-- GENERATED by tools/make_quiz_pages.js from data/quiz.js, data/issues.js and data/pages/quiz.js. Do not edit by hand. -->',
      '<html lang="' + L + '" data-page="quiz">',
      '<head>',
      '  <meta charset="utf-8">',
      '  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
      '  <title>' + esc(str('seo.quizResult.title', L, { match: match })) + '</title>',
      '  <meta name="description" content="' + esc(str('seo.quizResult.description', L)) + '">',
      '  <meta property="og:title" content="' + esc(ogTitle) + '">',
      '  <meta property="og:description" content="' + esc(str('seo.quizResult.ogDescription', L)) + '">',
      '  <meta property="og:image" content="' + ogImg + '">',
      '  <meta property="og:image:alt" content="' + esc(ogTitle + ' ' + ogSub) + '">',
      '  <meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">',
      '  <meta property="og:locale" content="' + (isEs ? 'es_US' : 'en_US') + '"><meta property="og:locale:alternate" content="' + (isEs ? 'en_US' : 'es_US') + '">',
      "  <meta name=\"ysd:og\" content='" + esc(JSON.stringify(og)) + "'>",
      '  <!-- @head --><!-- /@head -->',
      hl.map((x) => '  ' + x).join('\n'),
      '  <link rel="stylesheet" href="' + up + 'assets/css/pages/quiz.css">',
      '</head>',
      '<body class="p-quiz">',
      '  <!-- @demo-banner' + sfx + ' --><!-- /@demo-banner' + sfx + ' -->',
      '  <!-- @header' + sfx + ' --><!-- /@header' + sfx + ' -->',
      '  <main id="main">',
      '    <section class="section ' + (dark ? 'theme-dark' : 'theme-light') + ' x-rhero" style="--c: ' + cv + '; --fg: ' + fg + '" aria-labelledby="r-title"' + (calm ? ' data-tone="calm"' : '') + '>',
      '      <div class="wrap x-rhero__grid">',
      '        <div class="x-rhero__copy">',
      '          <p class="x-rhero__eyebrow">' + esc(eyebrow) + '</p>',
      '          <h1 class="x-rhero__name" id="r-title"' + (Math.max.apply(null, name.split(/\s+/).map((w) => w.length)) > 10 ? ' data-len="long"' : '') + (name.length >= 12 ? ' data-wrap' : '') + '>' + esc(name) + '</h1>',
      '          <p class="x-rhero__lead"' + (kind === 'issue' ? ' data-real' : '') + '>' + esc(lead) + '</p>',
      '          <div class="btn-row">',
      '            <a class="btn btn--primary btn--lg" href="' + takeHref + '">' + esc(take) + '</a>',
      '            <a class="btn ' + (dark ? 'btn--ghost' : 'btn--ink') + '" href="' + allHref + '">' + esc(all) + '</a>',
      '          </div>',
      '          <p class="x-rhero__note">' + esc(p('r.someone', L)) + '</p>',
      '        </div>',
      '        <div class="x-rcard" style="--c: ' + cv + '; --fg: ' + fg + '" aria-hidden="true"' + (calm ? ' data-tone="calm"' : '') + '>',
      sticker ? '          <span class="sticker x-rcard__sticker" data-sticker="' + sticker + '"></span>' : '',
      '          <div class="x-rcard__top"><span class="x-rcard__kicker">' + esc(kicker) + '</span></div>',
      '          <p class="x-rcard__name"' + (Math.max.apply(null, match.split(/\s+/).map((w) => w.length)) > 10 ? ' data-len="long"' : '') + '>' + esc(match) + '</p>',
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
      '        <button class="btn btn--ink btn--lg" type="button" data-share><span>' + esc(str('cta.shareGroup', L)) + '</span></button>',
      '      </div>',
      '    </section>',
      '  </main>',
      '  <!-- @footer' + sfx + ' --><!-- /@footer' + sfx + ' -->',
      '  <!-- @scripts --><!-- /@scripts -->',
      '  <script src="' + up + 'data/slices/quiz.js"></script>',
      '</body>',
      '</html>',
      ''
    ].filter((x) => x !== '').join('\n')
  };
}
function actions(list, L, pg) {
  return '<ol class="x-actions">' + list.slice(0, 3).map((a, i) => {
    const file = (I.pages || {})[a.page] || (a.page + '.html');
    const href = pg + file + (a.query ? '?' + a.query : '') + (a.hash ? '#' + a.hash : '');
    return '<li class="x-action"><span class="x-action__n" aria-hidden="true">' + (i + 1) + '</span><a class="x-action__link" href="' + esc(href) + '">' + esc(actionLabel(a, L)) + '</a>' + (a.demo ? '<span class="tag tag--demo">DEMO</span>' : '') + '</li>';
  }).join('') + '</ol>';
}
function seriesChips(series, L, pg) {
  const known = (series || []).filter((s) => Q.eventSeries[s]);
  // no series for this issue yet: route by kind instead (learn, then hang out)
  const chips = known.length
    ? known.map((s) => '<a class="chip" href="' + pg + 'events.html?series=' + encodeURIComponent(s) + '">' + esc(pick(Q.eventSeries[s].label, L)) + '</a>')
    : ['learn', 'social'].filter((k) => (Q.eventKinds || {})[k]).map((k) => '<a class="chip" href="' + pg + 'events.html?kind=' + k + '">' + esc(pick(Q.eventKinds[k].label, L)) + '</a>');
  return '<div class="chip-row">' + chips.join('') + '</div>';
}

function stripPartials(s) { return s.replace(/(<!-- @([\w-]+) -->)[\s\S]*?(<!-- \/@\2 -->)/g, '$1$3'); }
function main() {
  const pages = [];
  for (const L of ['en', 'es']) {
    for (const r of Q.organizerEra.results) pages.push(page('show-up', r.id, L));
    for (const id of Object.keys(Q.issueFinder.results)) if (byId(I.items, id)) pages.push(page('issue', id, L));
  }
  const written = [], stale = [];
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
