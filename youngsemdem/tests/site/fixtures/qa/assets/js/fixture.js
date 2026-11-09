/* tests/site fixture page script: one share button the right way, and (on one page) the wrong way,
   plus the small behaviours the newer qa.js checks need (each runs only when its hook is on the page). */
(function () {
  'use strict';
  var YSD = window.YSD || {};
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-share]');
    if (!b || !YSD.share) return;
    YSD.share.native({ title: document.title, text: 'Come with me', url: YSD.share.url() });
  });
  var bad = document.querySelector('[data-origin-share]');
  if (bad) {
    // Seeded defect: a share link built from location.origin instead of YSD.share.url().
    bad.setAttribute('href', 'https://wa.me/?text=' + encodeURIComponent('Come with me ' + location.origin + '/events.html'));
  }
  // A colour that fades in after load (qa must read it after the transition, not halfway).
  window.addEventListener('load', function () {
    Array.prototype.forEach.call(document.querySelectorAll('[data-fade]'), function (el) { el.setAttribute('data-ready', ''); });
  });
  // A bottom bar that stays hidden until the visitor scrolls.
  var bar = document.querySelector('[data-bottom-bar]');
  if (bar) {
    var sync = function () { if (window.scrollY > 200) bar.setAttribute('data-shown', ''); else bar.removeAttribute('data-shown'); };
    window.addEventListener('scroll', sync, { passive: true });
    sync();
  }
  // The invite landing: shown when the link carries ?from= (block children, so words must not run together).
  var landing = document.querySelector('[data-invite-landing]');
  var from = (location.search.match(/[?&]from=([^&]+)/) || [])[1];
  if (landing && from) {
    var name = decodeURIComponent(from).slice(0, 24);
    landing.className = 'x-landing';
    landing.innerHTML = '<div class="x-landing__inner"><span class="x-avatar" aria-hidden="true"></span><div><p class="x-landing__who"></p><p class="x-landing__what">to Trivia night: Seminole County edition</p></div></div>';
    landing.querySelector('.x-avatar').textContent = name.charAt(0);
    landing.querySelector('.x-landing__who').textContent = name + ' invited you';
    landing.hidden = false;
  }
  // A panel that opens on a click (qa scenarios measure it open).
  var opener = document.querySelector('[data-open-panel]');
  if (opener) opener.addEventListener('click', function () { var p = document.querySelector('[data-panel]'); if (p) p.hidden = false; opener.setAttribute('aria-expanded', 'true'); });
  // Text that only JS writes, late (English left on a Spanish page; a source path).
  Array.prototype.forEach.call(document.querySelectorAll('[data-late-text]'), function (el) {
    setTimeout(function () { el.textContent = el.getAttribute('data-late-text'); }, 1200);
  });
})();
