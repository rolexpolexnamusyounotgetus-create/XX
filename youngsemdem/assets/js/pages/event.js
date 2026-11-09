/*! YDSC · assets/js/pages/event.js (W2). Behaviour for the generated event / invite pages (events/<id>.html,
 * es/events/<id>.html). The page is complete without JavaScript; this adds: the group-chat share with the
 * event's own friend-voice text and your +1 link, the past and drop notes by the visitor's clock, and fresh
 * related events. RSVP, counts, calendar links and the invite landing come from assets/js/rsvp.js.
 * No network calls, no AI.
 */
(function (w, d) {
  'use strict';
  var YSD = w.YSD = w.YSD || {};
  function $(s, r) { return (r || d).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || d).querySelectorAll(s)); }

  function init() {
    var E = YSD.events;
    var id = d.documentElement.getAttribute('data-event');
    var e = E && id ? E.get(id) : null;
    if (!e) return;

    // Send it to the group chat: this event's text + your +1 link (rsvp.js builds both).
    $$('[data-event-share]').forEach(function (b) {
      b.addEventListener('click', function (evt) {
        evt.preventDefault();
        evt.stopPropagation(); // ui.js would share the generic page text instead
        if (YSD.rsvp && YSD.rsvp.share) YSD.rsvp.share(id, b);
        else if (YSD.ui && YSD.ui.share) YSD.ui.share();
      });
    });

    // Past events: no RSVP, point at what's next.
    if (E.isPast(e)) {
      var past = $('[data-past-note]'); if (past) past.hidden = false;
      $$('.rsvp-row__btns').forEach(function (r) { r.hidden = true; });
    } else if (E.drop.isDropEvent(e) && !E.drop.isOpen()) {
      var dn = $('[data-drop-note]'); if (dn) dn.hidden = false;
    }

    // Related: the next two upcoming events by the visitor's clock (same kind first).
    var box = $('[data-related]');
    if (box) {
      var list = E.upcoming({}).filter(function (x) { return x.id !== id; });
      var same = list.filter(function (x) { return x.kind === e.kind; });
      var pick = same.slice(0, 1).concat(list.filter(function (x) { return same.slice(0, 1).indexOf(x) < 0; })).slice(0, 2);
      if (!pick.length) { var sec = $('[data-related-section]'); if (sec) sec.hidden = true; }
      else {
        box.textContent = '';
        pick.forEach(function (x) { box.appendChild(E.render(x, { variant: 'invite', level: 3 })); });
      }
    }
    if (YSD.ui && YSD.ui.stickers) YSD.ui.stickers(d);
    if (YSD.rsvp) YSD.rsvp.refresh();
  }
  if (YSD.ui && YSD.ui.ready) YSD.ui.ready(init); else if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', init); else init();
})(window, document);
