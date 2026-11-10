/*! YDSC · styleguide.html demo wiring (F0). Only drives the guide's live specimens; every
 * behaviour it calls lives in assets/js/ui.js so pages get the same thing. */
(function (w, d) {
  'use strict';
  var YSD = w.YSD || {}, ui = YSD.ui || {};
  function $$(s, r) { return Array.prototype.slice.call((r || d).querySelectorAll(s)); }

  d.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-sg-toast], [data-sg-confetti], [data-sg-chip], [data-sg-loading], [data-sg-queue], [data-sg-reveal]');
    if (!b) return;
    if (b.hasAttribute('data-sg-queue')) {
      // The journeys-14 case: a sticker note is waiting when "Link copied" arrives; the copy wins, the note follows.
      ui.toast && ui.toast('New sticker: Card Maker.', { priority: 'low' });
      ui.toast && ui.toast(YSD.t ? YSD.t('toast.linkCopied') || 'Link copied.' : 'Link copied.', { priority: 'high' });
      return;
    }
    if (b.hasAttribute('data-sg-reveal')) {
      var id = b.getAttribute('data-sg-reveal'), st = ui.sticker ? ui.sticker(id) : null, es = YSD.lang === 'es';
      ui.reveal && ui.reveal({
        sticker: id, ring: 'sky',
        title: es ? 'Escuadrón de tres' : 'Squad of Three',
        body: (YSD.t && YSD.t('reveal.onCard')) || (st && st.fact ? (st.fact[YSD.lang] || st.fact.en) : ''),
        actions: [{ label: (YSD.t && YSD.t('reveal.seeStickers')) || 'See your stickers', href: '#brand', primary: true }]
      });
      return;
    }
    if (b.hasAttribute('data-sg-toast')) {
      ui.toast && ui.toast(b.getAttribute('data-sg-toast'), { tone: b.getAttribute('data-tone') || 'success' });
    } else if (b.hasAttribute('data-sg-confetti')) {
      var fired = ui.confetti && ui.confetti(b);
      ui.toast && ui.toast(fired ? 'Seat saved. Add it to your calendar so future you remembers too.' : 'Seat saved. (Confetti stays off: reduced motion, Pause motion or a serious block.)');
    } else if (b.hasAttribute('data-sg-chip')) {
      b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true'));
    } else if (b.hasAttribute('data-sg-loading')) {
      if (b.getAttribute('data-state')) return;
      b.setAttribute('data-state', 'loading');
      setTimeout(function () { b.setAttribute('data-state', 'done'); }, 900);
      setTimeout(function () { b.removeAttribute('data-state'); }, 2400);
    }
  });

  $$('form[data-sg-form]').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var errors = {};
      var name = form.querySelector('[name="firstName"]'), contact = form.querySelector('[name="email"]');
      if (name && !name.value.trim()) errors.firstName = 'required';
      if (contact) {
        var v = contact.value.trim();
        if (!v) errors.email = 'required';
        else if (v.indexOf('@') < 0 && !/^\+?[\d\s().-]{10,}$/.test(v)) errors.email = 'missingAt';
      }
      if (Object.keys(errors).length) { ui.form && ui.form.errors(form, errors); return; }
      ui.form && ui.form.clear(form);
      var btn = form.querySelector('[type="submit"]');
      ui.confetti && ui.confetti(btn);
      ui.toast && ui.toast(YSD.t ? YSD.t('toast.rsvpSaved') || 'Seat saved.' : 'Seat saved.');
    });
  });
})(window, document);
