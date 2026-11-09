/* tests/site fixture page script: one share button the right way, and (on one page) the wrong way. */
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
})();
