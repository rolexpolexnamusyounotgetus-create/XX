/*!
 * assets/js/pages/newsletter.js (W6): renders The Thursday Letter sample issue on newsletter.html from
 * data/newsletter.js (BRIEF 4.8): subject and preheader in the hero phone, What's inside, The Letter
 * (calm: no stickers, no confetti, no emoji), One Thing (the mail-ballot reminder .ics for Mon, Jan 4,
 * 2027, 10 am New York time, plus the official links from YSD.cfg), The Picks, Spotlight, Ask the
 * Group Chat, the footer and the archive stubs. Every fact links its source. All text goes in with
 * textContent. The signup form at the bottom is the shared join form (assets/js/joinform.js, compact).
 */
(function (w, d) {
  'use strict';
  var YSD = w.YSD = w.YSD || {};
  var N = (w.YSD_DATA || {}).newsletter;
  if (!N || !N.issue) return;
  var I = N.issue;
  function lang() { return YSD.lang === 'es' ? 'es' : 'en'; }
  function L(o) { return o == null ? '' : typeof o === 'string' ? o : (o[lang()] != null ? o[lang()] : (o.en || '')); }
  function t(k, v) { return typeof YSD.t === 'function' ? YSD.t(k, v) : ''; }
  function cfg(p, fb) { return typeof YSD.cfg === 'function' ? YSD.cfg(p, fb) : fb; }
  function slot(name) { return d.querySelector('[data-nl="' + name + '"]'); }
  function el(tag, attrs, kids) {
    var n = d.createElement(tag);
    for (var k in attrs || {}) {
      if (!Object.prototype.hasOwnProperty.call(attrs, k) || attrs[k] == null || attrs[k] === false) continue;
      if (k === 'text') n.textContent = attrs[k];
      else if (k === 'class') n.className = attrs[k];
      else n.setAttribute(k, attrs[k] === true ? '' : attrs[k]);
    }
    (kids || []).forEach(function (c) { if (c != null && c !== '') n.appendChild(typeof c === 'string' ? d.createTextNode(c) : c); });
    return n;
  }
  function host(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return String(u || ''); } }
  function link(o) { return o ? (cfg(o.key, '') || o.url || '') : ''; }
  function pageHref(file) { return (YSD.root || '') + (lang() === 'es' ? 'es/' : '') + file; }
  function fmtDate(iso, time) { try { return YSD.fmt.date(iso, { time: !!time }); } catch (e) { return ''; } }

  var FACTS = {};
  (I.facts || []).forEach(function (f) { FACTS[f.id] = f; });

  /** A source line for one fact: its claim, then a link named by its host. */
  function factItem(f) {
    var a = el('a', { class: 'link link--out', href: f.source, rel: 'noopener', text: t('newsletter:source') + ': ' + host(f.source) });
    return el('li', {}, [el('span', { text: L(f.claim) + ' ' }), a]);
  }
  function sources(box, ids) {
    if (!box) return;
    var list = (ids || []).map(function (id) { return FACTS[id]; }).filter(Boolean);
    if (!list.length) return;
    box.textContent = '';
    box.appendChild(el('summary', { text: t('newsletter:sources') }));
    box.appendChild(el('ul', { class: 'x-sources__list' }, list.map(factItem)));
    box.hidden = false;
  }

  // ---------------------------------------------------------------- hero phone
  function hero() {
    var s = slot('subject'), p = slot('preheader');
    if (s) s.textContent = L(I.subject);
    if (p) p.textContent = L(I.preheader);
  }

  // ---------------------------------------------------------------- what's inside
  var SECTION_IDS = { oneThing: 'one-thing', picks: 'picks', spotlight: 'spotlight', askGroupChat: 'ask' };
  function inside() {
    var box = slot('inside');
    if (!box) return;
    (I.inside || []).forEach(function (it) {
      var id = SECTION_IDS[it.section];
      if (!id) return;
      box.appendChild(el('li', {}, [el('a', { href: '#' + id, text: L(it) })]));
    });
  }

  // ---------------------------------------------------------------- the letter
  function letter() {
    var Lt = I.letter;
    var by = slot('byline');
    if (by) {
      var who = Lt.byline || {};
      by.appendChild(el('span', { class: 'avatar avatar--lg x-byline__av', 'aria-hidden': 'true', translate: 'no', text: String(who.name || '?').charAt(0) }));
      by.appendChild(el('span', { class: 'x-byline__text' }, [
        el('span', { class: 'x-byline__name', text: L(who.label) }),
        el('span', { class: 'x-byline__date' }, [el('time', { datetime: I.date, text: fmtDate(I.date, true) }), ' ', el('span', { class: 'tag tag--demo', text: L(N.labels.demoWriter) })])
      ]));
    }
    var body = slot('letter');
    if (body) (Lt.paragraphs || []).forEach(function (p) { body.appendChild(el('p', { text: L(p) })); });
    var sign = slot('sign');
    if (sign) {
      sign.appendChild(el('p', { text: L(Lt.ritual) }));
      sign.appendChild(el('p', { class: 'x-sign__name', 'data-hand': true, text: L(Lt.signature) }));
    }
    sources(d.querySelector('[data-nl-sources="letter"]'), Lt.factIds);
  }

  // ---------------------------------------------------------------- one thing
  function oneThing() {
    var box = slot('one');
    if (!box) return;
    var O = I.oneThing, cal = O.cta && O.cta.calendar;
    var dl = new Date(Date.parse(O.deadline) + 12 * 3600e3);
    var mon = '', day = '';
    try {
      mon = new Intl.DateTimeFormat(lang() === 'es' ? 'es-US' : 'en-US', { month: 'short', timeZone: 'America/New_York' }).format(dl).replace('.', '');
      day = new Intl.DateTimeFormat('en-US', { day: 'numeric', timeZone: 'America/New_York' }).format(dl);
    } catch (e) {}
    var ticket = el('div', { class: 'ticket x-one__ticket', 'aria-hidden': 'true' }, [
      el('span', { class: 'ticket__month', text: mon }),
      el('span', { class: 'ticket__day', translate: 'no', text: day }),
      el('span', { class: 'ticket__time', translate: 'no', text: String(dl.getUTCFullYear()) })
    ]);
    var btns = el('div', { class: 'btn-row' });
    if (cal && YSD.cal) {
      var b = el('button', { class: 'btn btn--primary', type: 'button', text: L(O.cta.label) });
      b.addEventListener('click', function () {
        var ok = YSD.cal.download({ id: cal.id, title: L(cal.title), description: L(cal.description), start: cal.start, end: cal.end, url: link(O.link), alarm: 0 });
        try { if (YSD.track) YSD.track('reminder_add', { id: cal.id }); } catch (e) {}
        if (ok && YSD.ui) YSD.ui.toast(t('newsletter:one.added') || t('toast.saved'), { tone: 'success' });
      });
      btns.appendChild(b);
    }
    var how = link(O.link);
    if (how) btns.appendChild(el('a', { class: 'btn btn--ghost', href: how, rel: 'noopener', text: t('cta.howToRenew') }));
    var rec = link(O.check);
    var recLink = rec ? el('a', { class: 'link link--out', href: rec, rel: 'noopener', text: L(O.check.label) }) : null;
    box.appendChild(el('div', { class: 'x-one__top' }, [
      ticket,
      el('div', { class: 'stack stack--sm' }, [
        el('span', { class: 'tag tag--real', text: t('tag.realDeadline') }),
        el('h3', { class: 'x-one__title', text: L(O.title) })
      ])
    ]));
    box.appendChild(el('p', { class: 'x-one__body', text: L(O.body) }));
    box.appendChild(btns);
    var meta = el('p', { class: 'small muted x-one__meta' }, [t('newsletter:one.checked') + ' · ', recLink]);
    box.appendChild(meta);
    var det = el('details', { class: 'x-sources', hidden: true });
    box.appendChild(det);
    sources(det, O.factIds);
    // a toy that teaches: the mail-ballot sticker, tap for its sourced fact (data/stickers.js)
    var S = ((w.YSD_DATA || {}).stickers || {}).items || [], env = S.filter(function (x) { return x.id === 'envelope'; })[0];
    var wrap = box.parentNode;
    if (env && wrap && YSD.ui) {
      var st = el('button', { type: 'button', class: 'sticker sticker--lg x-one__sticker', 'data-sticker': 'envelope', 'aria-label': t('a11y.stickerTap', { name: L(env.name) }) });
      st.style.setProperty('--rot', '8deg');
      wrap.appendChild(st);
      YSD.ui.stickers(wrap); YSD.ui.stickerFacts(wrap);
    }
  }

  // ---------------------------------------------------------------- the picks
  var KIND_TONE = { place: 'celery', book: 'bubblegum', podcast: 'sun', show: 'tangerine' };
  function picks() {
    var box = slot('picks');
    if (!box) return;
    (I.picks || []).forEach(function (pk, i) {
      var kids = [
        el('div', { class: 'x-pick__top' }, [
          el('span', { class: 'x-pick__n', translate: 'no', text: String(i + 1).padStart(2, '0') }),
          el('span', { class: 'x-pick__kind', text: t('newsletter:picks.kind.' + pk.kind) || pk.kind })
        ]),
        el('h3', { class: 'x-pick__title', text: L(pk.title) })
      ];
      if (pk.creator || pk.detail) kids.push(el('p', { class: 'x-pick__meta', text: [L(pk.creator), L(pk.detail)].filter(Boolean).join(' · ') }));
      kids.push(el('p', { class: 'x-pick__why', text: L(pk.reason) }));
      var foot = el('div', { class: 'x-pick__foot' });
      if (pk.event) foot.appendChild(el('a', { class: 'link', href: pageHref('events/' + pk.event + '.html'), text: t('newsletter:picks.event') }));
      (pk.factIds || []).map(function (id) { return FACTS[id]; }).filter(Boolean).forEach(function (f) {
        foot.appendChild(el('a', { class: 'link link--quiet link--out', href: f.source, rel: 'noopener', title: L(f.claim), text: t('newsletter:source') + ': ' + host(f.source) }));
      });
      kids.push(foot);
      var li = el('li', { class: 'x-pick' }, kids);
      li.style.setProperty('--pick', 'var(--' + (KIND_TONE[pk.kind] || 'celery') + ')');
      box.appendChild(li);
    });
  }

  // ---------------------------------------------------------------- spotlight
  function spotlight() {
    var box = slot('spotlight'), S = I.spotlight;
    if (!box || !S) return;
    box.appendChild(el('div', { class: 'x-spot__badge', 'aria-hidden': 'true' }, [el('span', { translate: 'no', text: String(S.name || '?').charAt(0) })]));
    var kids = [
      el('div', { class: 'cluster cluster--sm' }, [el('span', { class: 'x-spot__who', text: L(S.label) }), el('span', { class: 'tag tag--demo', text: L(N.labels.demoMember) })]),
      el('h3', { class: 'x-spot__head', text: L(S.headline) }),
      el('p', { text: L(S.body) })
    ];
    if (S.event) kids.push(el('p', {}, [el('a', { class: 'link', href: pageHref('events/' + S.event + '.html'), text: t('newsletter:spot.event') })]));
    box.appendChild(el('div', { class: 'x-spot__text stack' }, kids));
  }

  // ---------------------------------------------------------------- ask the group chat
  function ask() {
    var box = slot('ask'), A = I.askGroupChat;
    if (!box || !A) return;
    box.appendChild(el('div', { class: 'bubble x-ask__q' }, [
      el('span', { class: 'bubble__who' }, [el('span', { class: 'tag tag--demo', text: L(A.label) })]),
      el('span', { text: L(A.q) })
    ]));
    box.appendChild(el('div', { class: 'bubble bubble--me x-ask__a' }, [
      el('span', { class: 'bubble__who', translate: 'no', text: t('newsletter:ask.from') }),
      el('span', { text: L(A.a) })
    ]));
    sources(d.querySelector('[data-nl-sources="ask"]'), A.factIds);
  }

  // ---------------------------------------------------------------- footer + archive
  function footer() {
    var F = I.footer;
    var fw = slot('forward'); if (fw) fw.textContent = L(F.forward);
    var lg = slot('lang');
    if (lg) {
      var other = lang() === 'es' ? 'en' : 'es';
      var a = el('a', { class: 'btn btn--ghost', lang: other, hreflang: other, href: YSD.ui && YSD.ui.langHref ? YSD.ui.langHref(other) : (other === 'es' ? 'es/newsletter.html' : '../newsletter.html'), text: L(F.languageSwitch) });
      lg.replaceWith(a);
    }
    var fine = slot('fine');
    if (fine) {
      fine.appendChild(el('p', {}, [el('strong', { text: t('newsletter:foot.unsubLabel') + ' ' }), L(F.unsubscribe)]));
      fine.appendChild(el('p', { text: L(F.why) }));
      fine.appendChild(el('p', { text: L(F.demoNote) }));
    }
    var arc = slot('archive');
    if (arc) (N.archive || []).forEach(function (it) {
      arc.appendChild(el('li', { class: 'x-archive__item' }, [
        el('p', { class: 'x-archive__meta' }, [
          el('span', { translate: 'no', text: (L(N.labels.issueNumber) || 'No. {n}').replace('{n}', it.number) }),
          el('span', { text: ' · ' + fmtDate(it.date, false) + ' ' }),
          el('span', { class: 'tag tag--demo', text: L(N.labels.demoIssue) })
        ]),
        el('h3', { class: 'x-archive__title', text: L(it.title) }),
        el('p', { class: 'small', text: L(it.blurb) })
      ]));
    });
  }


  // Hand face: switch it on only when a [data-hand] element nears the viewport (see the page CSS).
  function lazyHand() {
    var els = d.querySelectorAll('[data-hand]');
    if (!els.length) return;
    var on = function () { d.documentElement.setAttribute('data-hand', 'on'); };
    if (!('IntersectionObserver' in w)) { on(); return; }
    var io = new IntersectionObserver(function (es) { if (es.some(function (e) { return e.isIntersecting; })) { on(); io.disconnect(); } }, { rootMargin: '600px 0px' });
    Array.prototype.forEach.call(els, function (e) { io.observe(e); });
  }

  function boot() {
    hero(); inside(); letter(); oneThing(); picks(); spotlight(); ask(); footer(); lazyHand();
  }
  // Render now (the containers are already parsed) so nothing below the hero shifts later.
  if (YSD.fmt) boot(); else if (YSD.ui && YSD.ui.ready) YSD.ui.ready(boot); else d.addEventListener('DOMContentLoaded', boot);
})(window, document);
