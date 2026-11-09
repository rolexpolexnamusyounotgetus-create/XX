/* Direction C "Organizer Arcade": homepage prototype behaviour (DEMO).
 * Everything stays in this browser (localStorage). Nothing is sent anywhere.
 * Content (quiz, events, levels) is copied from youngsemdem/data/*.js, EN + ES.
 */
(function () {
  'use strict';

  var D = window.YDSC_C_DATA;
  if (!D) return;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var lang = 'en';
  var T = function (o) { return o ? (o[lang] || o.en || '') : ''; };

  /* ------------------------------------------------------------------ sprites */
  var COL = { g: '#2FE07A', G: '#12A150', n: '#A8652F', N: '#6B3B17', y: '#FFD60A', o: '#FF8A2A', p: '#FF5FA8', P: '#D63384',
    b: '#3346FF', B: '#6FD6FF', w: '#FFFFFF', c: '#FFF8EA', k: '#15121F', v: '#B9A6FF' };
  var SPR = {
    seed: ['............', '.....gg.....', '....gGgg....', '.....Gg.....', '.....G......', '....nnnn....', '...nnNnnn...', '..nnnnnNnn..', '..nnNnnnnn..', '...nnnnNn...', '....nnnn....', '............'],
    sprout: ['.gg......gg.', 'gGgg....ggGg', '.gGgg..ggGg.', '..ggGggGgg..', '....gGGg....', '.....GG.....', '.....GG.....', '...oooooo...', '...oyyyyo...', '....oooo....', '....oooo....', '............'],
    sapling: ['.....gg.....', '...ggGGgg...', '..gGGgGGGg..', '.gGgGGgGgGg.', '..gGGGGGGg..', '.gGgGGgGGgg.', '..ggGgGGgg..', '....gnng....', '.....nn.....', '.....nn.....', '....nnnn....', '............'],
    cypress: ['.....GG.....', '....gGGg....', '....gGgg....', '...gGGgGg...', '...ggGGgg...', '..gGgGGgGg..', '..ggGGGGgg..', '.gGGgGGgGGg.', '..ggggGggg..', '.....nn.....', '....nnnn....', '...nn..nn...'],
    phoenix: ['....y..y....', '...yoyyoy...', '....oyyo....', '...gGGgGg...', '...ggGGgg...', '..gGgGGgGg..', '..ggGGGGgg..', '.gGGgGGgGGg.', '..ggggGggg..', '.....nn.....', '....nnnn....', '...nn..nn...'],
    heart: ['............', '..ppp..ppp..', '.pwwpppppPp.', '.pwppppppPp.', '.ppppppppPp.', '..pppppppP..', '...ppppPP...', '....pppP....', '.....pP.....', '............', '............', '............'],
    star: ['.....yy.....', '....yyyy....', '....ywyy....', 'yyyyywyyyyyy', '.yyyyyyyyyy.', '..yyyyyyyy..', '...yyyyyy...', '..yyyyyyyy..', '..yyy..yyy..', '.yyy....yyy.', '.yy......yy.', '............'],
    envelope: ['............', '............', 'cccccccccccc', 'ckcccccccckc', 'cckcccccckcc', 'ccckcccckccc', 'cccckkkkcccc', 'cccccccccccc', 'ccccccccbbcc', 'cccccccccccc', '............', '............'],
    calendar: ['..k......k..', '.bbbbbbbbbb.', '.bbbbbbbbbb.', '.cccccccccc.', '.ckcckcckcc.', '.cccccccccc.', '.ckcckccgcc.', '.cccccccccc.', '.ckcckcckcc.', '.cccccccccc.', '............', '............'],
    check: ['....kkkk....', '..cckkkkcc..', '..cccccccc..', '..ccccccgc..', '..cccccggc..', '..cgccggcc..', '..cggggccc..', '..ccggcccc..', '..cccccccc..', '..cccccccc..', '............', '............'],
    sun: ['.....oo.....', '..o..oo..o..', '...oyyyyo...', '..oyyyyyyo..', '.oyywyyyyyo.', 'ooywyyyyyyoo', 'ooyyyyyyyyoo', '.oyyyyyyyyo.', '..oyyyyyyo..', '...oyyyyo...', '..o..oo..o..', '.....oo.....'],
    card: ['............', '............', 'cccccccccccc', 'cvvvvccccccc', 'cvwwvckkkkkc', 'cvwwvccccccc', 'cvvvvckkkkcc', 'cccccccccccc', 'cpppppppppcc', 'cccccccccccc', '............', '............'],
    controller: ['............', '............', '.bbbbbbbbbb.', 'bbbbbbbbbbbb', 'bbwbbbbbbybb', 'bwwwbbbbpbgb', 'bbwbbbbbbBbb', 'bbbbbbbbbbbb', 'bbbb....bbbb', '.bb......bb.', '............', '............'],
    play: ['............', '.bbbbbbbbbb.', '.bbbbbbbbbb.', '.bbbwbbbbbb.', '.bbbwwbbbbb.', '.bbbwwwbbbb.', '.bbbwwwwbbb.', '.bbbwwwbbbb.', '.bbbwwbbbbb.', '.bbbwbbbbbb.', '.bbbbbbbbbb.', '............'],
    phone: ['............', '.cccccccccc.', 'cccccccccccc', 'cckkckkckkcc', 'cccccccccccc', 'cckkkkckkkcc', 'cccccccccccc', '.cccccccccc.', '..ccc.......', '..cc........', '..c.........', '............'],
    door: ['...nnnnnn...', '...nNNNNn...', '...nNnnNn...', '...nNnnNn...', '...nNNNNn...', '...nNnnNn...', '...nNnyNn...', '...nNnnNn...', '...nNNNNn...', '...nnnnnn...', '..cccccccc..', '............'],
    trophy: ['............', '..yyyyyyyy..', 'yyyyyyyyyyyy', 'y.yyywyyyy.y', 'y.yyywyyyy.y', '.yyyyyyyyyy.', '..yyyyyyyy..', '....yyyy....', '.....yy.....', '.....yy.....', '...oooooo...', '...oooooo...'],
    three: ['............', '.pp..pp..pp.', 'pppppppppppp', 'pppppppppppp', '.pp..pp..pp.', '............', '..bbbbbbbb..', '.bbbbbbbbbb.', '.bbbbbbbbbb.', '............', '............', '............']
  };
  function spriteSVG(name) {
    var rows = SPR[name] || SPR.star;
    var h = rows.length + 2, w = rows[0].length + 2, g = [], y, x, out = '';
    for (y = 0; y < h; y++) { g.push([]); for (x = 0; x < w; x++) { var r = rows[y - 1]; g[y].push(r && x > 0 && x <= r.length ? r.charAt(x - 1) : '.'); } }
    for (y = 0; y < h; y++) {
      var runC = null, runX = 0;
      for (x = 0; x <= w; x++) {
        var c = x < w ? g[y][x] : null, fill = null;
        if (c && c !== '.') fill = COL[c];
        else if (c === '.') {
          for (var dy = -1; dy <= 1 && !fill; dy++) for (var dx = -1; dx <= 1; dx++) {
            var yy = y + dy, xx = x + dx; if (yy < 0 || xx < 0 || yy >= h || xx >= w) continue;
            if (g[yy][xx] !== '.' && g[yy][xx] !== 'k') { fill = COL.k; break; }
          }
        }
        if (fill !== runC) {
          if (runC) out += '<rect x="' + runX + '" y="' + y + '" width="' + (x - runX) + '" height="1" fill="' + runC + '"/>';
          runC = fill; runX = x;
        }
      }
    }
    return '<svg viewBox="0 0 ' + w + ' ' + h + '" aria-hidden="true" focusable="false">' + out + '</svg>';
  }
  function paintSprites(root) { $$('[data-sprite]', root).forEach(function (el) { el.innerHTML = spriteSVG(el.getAttribute('data-sprite')); }); }
  function setSprite(el, name) { if (!el) return; el.setAttribute('data-sprite', name); el.innerHTML = spriteSVG(name); }

  /* ------------------------------------------------------------------ state */
  var KEY = 'ydsc-c-demo-v1';
  function defaults() { return { xp: 0, done: {}, badges: {}, weekOn: false, name: '', code: '', era: null, mix: null, under: null, squad: 0, rsvp: {}, joined: false, posted: false }; }
  var S = (function () { try { var s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s && typeof s === 'object') { var d = defaults(); for (var k in s) d[k] = s[k]; return d; } } catch (e) {} return defaults(); })();
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }

  var LEVELS = D.levels.levels;
  function levelOf(xp) { var cur = LEVELS[0]; LEVELS.forEach(function (l) { if (xp >= l.minXp) cur = l; }); return cur; }
  function nextOf(l) { var i = LEVELS.indexOf(l); return LEVELS[i + 1] || null; }

  /* ------------------------------------------------------------------ toast / announce */
  var toastT;
  function toast(msg) { var t = $('#toast'); t.textContent = msg; t.classList.add('is-on'); clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove('is-on'); }, 3200); }

  /* ------------------------------------------------------------------ HUD + player card */
  function renderHUD() {
    var l = levelOf(S.xp), n = nextOf(l), i = LEVELS.indexOf(l);
    var pct = n ? Math.round((S.xp - l.minXp) / (n.minXp - l.minXp) * 100) : 100;
    $('#hudXp').textContent = S.xp;
    $('#hudLv').textContent = 'LV ' + (i + 1);
    $('#hudBar').style.width = pct + '%';
    setSprite($('.hud-sprite'), l.id);
    $('#hudName').textContent = ', ' + T(l.name) + ', demo';
    setSprite($('#playerSprite'), l.id);
    $('#playerLv').textContent = (lang === 'es' ? 'Nivel ' : 'Level ') + (i + 1) + ' · ' + T(l.name);
    $('#playerXp').textContent = S.xp;
    $('#xpbarFill').style.width = pct + '%';
    $('#xpbar').setAttribute('aria-valuenow', pct);
    if (n) { $('#toNext').textContent = (n.minXp - S.xp) + ' XP'; $('#nextLv').textContent = T(n.name); $('#nextPerk').textContent = T(n.perk); }
    else { $('#toNext').textContent = 'Top level'; $('#nextLv').textContent = ''; $('#nextPerk').textContent = T(l.perk); }
    renderWeeks(); renderBadges(); renderQuests(); renderCup(); renderCardStats();
  }

  var WEEKS = [['Oct', '19'], ['Oct', '26'], ['Nov', '2'], ['Nov', '9', 'now'], ['Nov', '16'], ['Nov', '23', 'rest'], ['Nov', '30'], ['Dec', '7']];
  function renderWeeks() {
    var row = $('#weekRow'); row.innerHTML = '';
    WEEKS.forEach(function (w) {
      var li = document.createElement('li'); li.className = 'wk' + (w[2] === 'now' ? ' is-now' : '') + (w[2] === 'rest' ? ' is-rest' : '') + (w[2] === 'now' && S.weekOn ? ' is-on' : '');
      var mark = w[2] === 'rest' ? 'Z' : (w[2] === 'now' && S.weekOn ? '✓' : '');
      li.innerHTML = '<i aria-hidden="true">' + mark + '</i><b>' + w[0] + '</b>' + w[1];
      var label = w[0] + ' ' + w[1] + (w[2] === 'now' ? ', this week' + (S.weekOn ? ', active' : ', not active yet') : w[2] === 'rest' ? ', rest week' : '');
      li.setAttribute('aria-label', label);
      row.appendChild(li);
    });
    $('#weeksTxt').textContent = (lang === 'es' ? 'Semanas activas: ' : 'Active weeks: ') + (S.weekOn ? 1 : 0);
  }

  var BADGES = [['doors-open', 'door'], ['plus-one', 'heart'], ['squad-of-three', 'three'], ['renew-ready', 'calendar'], ['plan-made', 'check'], ['on-camera', 'play'], ['card-carrier', 'card'], ['golden-hour', 'sun']];
  function badgeById(id) { for (var i = 0; i < D.levels.badges.length; i++) if (D.levels.badges[i].id === id) return D.levels.badges[i]; }
  function renderBadges() {
    var g = $('#badgeGrid'); g.innerHTML = ''; var n = 0;
    BADGES.forEach(function (b) {
      var data = badgeById(b[0]); if (!data) return; var on = !!S.badges[b[0]]; if (on) n++;
      var li = document.createElement('li'); li.className = 'bdg' + (on ? ' is-on' : '');
      li.innerHTML = '<span class="b-ico" data-sprite="' + b[1] + '"></span><span>' + T(data.name) + '</span>';
      li.title = T(data.desc); li.setAttribute('aria-label', T(data.name) + (on ? ', unlocked: ' : ', not yet: ') + T(data.desc));
      g.appendChild(li);
    });
    paintSprites(g);
    $('#badgeCount').textContent = n + ' of ' + BADGES.length;
  }
  function unlock(id) {
    if (S.badges[id]) return; S.badges[id] = Date.now(); save();
    var b = badgeById(id); if (b) setTimeout(function () { toast('Badge unlocked: ' + T(b.name) + '. ' + T(b.desc)); }, 900);
  }

  function renderQuests() {
    $$('.quest').forEach(function (q) { var id = q.getAttribute('data-quest'); q.classList.toggle('is-done', !!S.done[id]); });
    var nm = $$('.nm-card'); if (nm[0]) nm[0].classList.toggle('is-done', !!S.done.reminder);
    if (nm[1]) nm[1].classList.toggle('is-done', !!S.rsvp['sunset-walk-lake-monroe']);
  }

  /* ------------------------------------------------------------------ XP award + effects */
  function award(id, xp, label, src) {
    if (id && S.done[id]) return false;
    if (id) S.done[id] = Date.now();
    var before = levelOf(S.xp);
    S.xp += xp; S.weekOn = true; save();
    flyXP(xp, src, function () {
      renderHUD();
      var hud = $('#hud'); hud.classList.remove('bump'); void hud.offsetWidth; hud.classList.add('bump');
      var after = levelOf(S.xp); if (after !== before) levelUp(after);
    });
    var msg = (label ? label + ': ' : '') + '+' + xp + ' XP';
    toast(msg + (lang === 'es' ? ' (demo, solo en este navegador)' : ' (demo, saved in this browser)'));
    if (src) burst(src);
    return true;
  }
  function centerOf(el) { var r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }
  function flyXP(xp, src, done) {
    var hud = $('#hud');
    if (reduce || !src || !hud.animate) { done(); return; }
    var a = centerOf(src), b = centerOf(hud);
    var f = document.createElement('span'); f.className = 'xp-fly'; f.textContent = '+' + xp + ' XP'; document.body.appendChild(f);
    var w = f.offsetWidth / 2, h = f.offsetHeight / 2;
    var anim = f.animate([
      { transform: 'translate(' + (a.x - w) + 'px,' + (a.y - h) + 'px) scale(.6)', opacity: 0 },
      { transform: 'translate(' + (a.x - w) + 'px,' + (a.y - h - 46) + 'px) scale(1.15)', opacity: 1, offset: .3 },
      { transform: 'translate(' + (b.x - w) + 'px,' + (b.y - h) + 'px) scale(.55)', opacity: .9 }
    ], { duration: 900, easing: 'cubic-bezier(.45,-0.2,.6,1)' });
    anim.onfinish = function () { f.remove(); done(); };
  }
  function burst(src) {
    if (reduce || !document.body.animate) return;
    var c = centerOf(src), cols = ['#FFD60A', '#2FE07A', '#FF5FA8', '#3346FF', '#FF8A2A', '#6FD6FF'];
    for (var i = 0; i < 18; i++) {
      var p = document.createElement('i'); p.className = 'confetti'; p.style.background = cols[i % cols.length];
      document.body.appendChild(p);
      var ang = Math.random() * Math.PI * 2, d = 60 + Math.random() * 90, x = Math.cos(ang) * d, y = Math.sin(ang) * d - 40;
      var an = p.animate([
        { transform: 'translate(' + c.x + 'px,' + c.y + 'px) rotate(0) scale(1)', opacity: 1 },
        { transform: 'translate(' + (c.x + x) + 'px,' + (c.y + y + 90) + 'px) rotate(' + (Math.random() * 540) + 'deg) scale(.6)', opacity: 0 }
      ], { duration: 800 + Math.random() * 500, easing: 'cubic-bezier(.2,.8,.4,1)' });
      an.onfinish = (function (el) { return function () { el.remove(); }; })(p);
    }
  }
  function levelUp(l) {
    var box = $('#lvlup'); setSprite($('#lvlupSprite'), l.id);
    $('#lvlupName').textContent = T(l.name);
    $('#lvlupPerk').textContent = (lang === 'es' ? 'Ventaja (ejemplo): ' : 'Example perk: ') + T(l.perk) + '.';
    box.hidden = false; var ok = $('#lvlupOk'); ok.focus();
    var close = function () { box.hidden = true; document.removeEventListener('keydown', esc); $('#hud').focus(); };
    var esc = function (e) { if (e.key === 'Escape') close(); };
    ok.onclick = close; box.onclick = function (e) { if (e.target === box) close(); };
    document.addEventListener('keydown', esc);
    if (!reduce) burst(ok);
  }

  /* ------------------------------------------------------------------ downloads, ICS, share */
  function download(name, data, type) {
    var blob = data instanceof Blob ? data : new Blob([data], { type: type });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 800);
  }
  function icsDate(iso) { return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); }
  function esc(s) { return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n'); }
  function ics(o) {
    var L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Young Democrats of Seminole County//youngsemdems demo//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
      'UID:' + o.uid + '@youngsemdems', 'DTSTAMP:' + icsDate(new Date().toISOString())];
    if (o.allDay) { L.push('DTSTART;VALUE=DATE:' + o.date, 'DTEND;VALUE=DATE:' + o.dateEnd); }
    else { L.push('DTSTART:' + icsDate(o.start), 'DTEND:' + icsDate(o.end)); }
    L.push('SUMMARY:' + esc(o.title), 'DESCRIPTION:' + esc(o.desc));
    if (o.location) L.push('LOCATION:' + esc(o.location));
    if (o.url) L.push('URL:' + o.url);
    L.push('END:VEVENT', 'END:VCALENDAR');
    return L.join('\r\n');
  }
  function reminderICS() {
    return ics({ uid: 'renew-mail-ballot-2027', allDay: true, date: '20270101', dateEnd: '20270102', title: lang === 'es' ? 'Renovar mi solicitud de boleta por correo' : 'Renew my mail-ballot request',
      desc: (lang === 'es'
        ? 'Las solicitudes anteriores vencieron el 31 de diciembre de 2026. Renuévala en línea en la página de voto por correo de Seminole (voteseminole.gov) o llama al 407-585-8683 en un día hábil. Ten a mano el número de tu licencia o identificación de Florida, o los últimos 4 dígitos de tu Seguro Social.'
        : 'Old requests ended Dec 31, 2026. Renew online on Seminole\'s vote-by-mail page (voteseminole.gov) or call 407-585-8683 on a business day. Have your Florida license or ID number, or the last 4 of your Social Security number.') + ' (Reminder from the Young Dems demo site.)',
      url: 'https://voteseminole.gov/how-to-vote/vote-by-mail/' });
  }
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    return new Promise(function (res, rej) {
      var ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy') ? res() : rej(); } catch (e) { rej(e); } ta.remove();
    });
  }
  function shareOrCopy(data, onDone) {
    var full = data.text + (data.url ? ' ' + data.url : '');
    if (navigator.share) { navigator.share(data).then(onDone, function () {}); return; }
    copyText(full).then(function () { toast(lang === 'es' ? 'Copiado. Pégalo en el chat del grupo.' : 'Copied. Paste it in the group chat.'); onDone && onDone(); },
      function () { window.prompt('Copy this:', full); onDone && onDone(); });
  }

  /* ------------------------------------------------------------------ referral code */
  var ALPH = 'BCDFGHJKMNPQRSTVWXZ23456789';
  function rnd(n) { var s = ''; for (var i = 0; i < n; i++) s += ALPH.charAt(Math.floor(Math.random() * ALPH.length)); return s; }
  function makeCode(name) {
    var letters = String(name || '').normalize('NFD').replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 5);
    return letters ? letters + rnd(3) : rnd(6);
  }
  function ensureCode() { if (!S.code) { S.code = makeCode(S.name); save(); } return S.code; }
  function shareUrl() {
    var base = /^https?:$/.test(location.protocol) ? location.origin + location.pathname : 'https://youngsemdems.com/';
    return base + '?ref=' + ensureCode() + '&utm_source=share&utm_medium=social&utm_campaign=youngsemdems';
  }

  /* ------------------------------------------------------------------ actions wiring */
  function doReminder(btn) {
    download('renew-mail-ballot-jan-1-2027.ics', reminderICS(), 'text/calendar');
    if (award('reminder', 15, lang === 'es' ? 'Recordatorio listo' : 'Reminder set', btn)) unlock('renew-ready');
    else toast(lang === 'es' ? 'Descargado otra vez. Ya tienes los XP.' : 'Downloaded again. You already have the XP for this one.');
  }
  document.addEventListener('click', function (e) {
    var a = e.target.closest('[data-action]'); if (!a) return;
    var act = a.getAttribute('data-action');
    if (act === 'reminder') { e.preventDefault(); doReminder(a); }
    else if (act === 'honor') { e.preventDefault(); if (!award(a.getAttribute('data-quest-id'), +a.getAttribute('data-xp'), lang === 'es' ? 'Registro revisado' : 'Registration checked', a)) toast('Already counted. Thanks for checking.'); }
    else if (act === 'open-post') { e.preventDefault(); openPost(); }
    else if (act === 'goto-rsvp') { e.preventDefault(); var id = a.getAttribute('data-event'); var card = document.getElementById('ev-' + id); if (card) { card.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' }); setTimeout(function () { openRSVP(id); }, reduce ? 0 : 450); } }
  });

  /* ------------------------------------------------------------------ quiz */
  var Q = D.quiz, qi = 0, answers = [];
  function renderPips() { var p = $('#pips'); p.innerHTML = ''; Q.questions.forEach(function (_, i) { var li = document.createElement('li'); if (i <= qi) li.className = 'is-on'; p.appendChild(li); }); }
  function renderQ() {
    var box = $('#quizOpts'), q = Q.questions[qi];
    $('#quizCount').textContent = (lang === 'es' ? 'Pregunta ' : 'Question ') + (qi + 1) + (lang === 'es' ? ' de ' : ' of ') + Q.questions.length;
    $('#quizQ').textContent = T(q.prompt);
    box.innerHTML = '';
    q.options.forEach(function (o, i) {
      var b = document.createElement('button'); b.type = 'button'; b.className = 'opt-btn';
      b.innerHTML = '<span class="k" aria-hidden="true">' + 'ABCDEF'.charAt(i) + '</span><span></span>';
      b.lastChild.textContent = T(o.label);
      b.addEventListener('click', function () { pick(i, b); });
      box.appendChild(b);
    });
    box.classList.remove('quiz-anim'); void box.offsetWidth; box.classList.add('quiz-anim');
    $('#quizBack').hidden = qi === 0;
    renderPips();
  }
  function pick(i, b) {
    b.classList.add('is-picked'); answers[qi] = i;
    setTimeout(function () { qi++; if (qi < Q.questions.length) renderQ(); else finishQuiz(); }, reduce ? 0 : 220);
  }
  $('#quizBack').addEventListener('click', function () { if (qi > 0) { qi--; renderQ(); } });
  function score() {
    var ids = Q.results.map(function (r) { return r.id; }), tot = {}, lead = null;
    ids.forEach(function (id) { tot[id] = 0; });
    Q.questions.forEach(function (q, i) {
      var o = q.options[answers[i]]; if (!o) return; var w = i === Q.questions.length - 1 ? 1.5 : 1;
      for (var k in o.scores) { tot[k] += o.scores[k] * w; if (o.scores[k] === 2) lead = k; }
    });
    var order = ids.slice().sort(function (a, b) {
      if (tot[b] !== tot[a]) return tot[b] - tot[a];
      if (a === lead) return -1; if (b === lead) return 1;
      return ids.indexOf(a) - ids.indexOf(b);
    });
    var sum = 0; ids.forEach(function (id) { sum += tot[id]; });
    var raw = ids.map(function (id) { var v = sum ? tot[id] / sum * 100 : 0; return { id: id, f: Math.floor(v), r: v - Math.floor(v) }; });
    var left = 100 - raw.reduce(function (s, x) { return s + x.f; }, 0);
    raw.slice().sort(function (a, b) { return b.r - a.r; }).slice(0, left).forEach(function (x) { x.f++; });
    var mix = {}; raw.forEach(function (x) { mix[x.id] = x.f; });
    return { match: order[0], under: order[1], mix: mix };
  }
  function resultById(id) { for (var i = 0; i < Q.results.length; i++) if (Q.results[i].id === id) return Q.results[i]; }
  function finishQuiz() {
    var r = score(); S.era = r.match; S.under = r.under; S.mix = r.mix; save();
    renderQuizDone(); renderCard(true);
    toast(lang === 'es' ? 'Tu tarjeta está lista.' : 'Your card is ready. Send it to the group chat.');
  }
  function renderQuizDone() {
    var res = resultById(S.era), und = resultById(S.under), box = $('#quizOpts');
    $('#quizCount').textContent = lang === 'es' ? 'Resultado' : 'Your result';
    $('#quizQ').textContent = (lang === 'es' ? 'Te salió: ' + T(res.name) : 'You\'re ' + T(res.name).replace(/^The /, 'the ') + '.');
    box.innerHTML = '';
    var d = document.createElement('div'); d.className = 'quiz-done quiz-anim';
    d.innerHTML = '<p></p><p class="und"></p><p><b>' + (lang === 'es' ? 'Empieza por aquí: ' : 'Start here: ') + '</b><span class="act"></span></p><div class="row"><a class="btn btn-white" href="#events">' + (lang === 'es' ? 'Eventos para ti' : 'Events for you') + '</a><button type="button" class="link-btn" id="retake">' + (lang === 'es' ? 'Repetir el quiz' : 'Retake the quiz') + '</button></div>';
    d.firstChild.textContent = T(res.desc).join ? T(res.desc).join(' ') : T(res.desc);
    d.querySelector('.und').textContent = T(Q.copy.undertone).replace('{match}', T(res.name)).replace('{undertone}', T(und.name));
    d.querySelector('.act').textContent = T(res.action);
    box.appendChild(d);
    $('#quizBack').hidden = true;
    $('#pips').innerHTML = Q.questions.map(function () { return '<li class="is-on"></li>'; }).join('');
    $('#retake').addEventListener('click', function () { qi = 0; answers = []; renderQ(); });
  }

  /* ------------------------------------------------------------------ era card */
  var SPR_FOR = { hype: 'star', chat: 'phone', data: 'calendar', doors: 'door', creator: 'play', plusone: 'heart' };
  var NAMES_SHORT = function (id) { var r = resultById(id); return r ? T(r.name).replace(/^The /, '') : id; };
  function renderCardStats() {
    if (!$('#ecXp')) return;
    $('#ecXp').textContent = S.xp;
    $('#ecQuests').textContent = Object.keys(S.done).length;
    $('#ecBadges').textContent = Object.keys(S.badges).length;
    var l = levelOf(S.xp); $('#ecLevel').textContent = (lang === 'es' ? 'Nivel ' : 'Level ') + (LEVELS.indexOf(l) + 1) + ' · ' + T(l.name) + ' · DEMO XP';
    $('#ecCode').textContent = ensureCode();
  }
  function renderCard(real) {
    var id = S.era || 'chat', res = resultById(id);
    var mix = S.mix || { chat: 41, plusone: 27, data: 14, hype: 9, doors: 6, creator: 3 };
    var under = S.under || 'plusone';
    var card = $('#eraCard'); card.setAttribute('data-color', res.color);
    $('#ecName').textContent = T(res.name);
    $('#ecSub').textContent = T(res.subline);
    setSprite($('.ec-sprite'), SPR_FOR[id]);
    var top = Object.keys(mix).sort(function (a, b) { return mix[b] - mix[a]; }).slice(0, 3);
    $('#ecMix').innerHTML = top.map(function (k) { return '<li><span>' + NAMES_SHORT(k) + ' · ' + mix[k] + '%</span><span class="bar"><i data-w="' + mix[k] + '"></i></span></li>'; }).join('');
    $('#ecUnder').textContent = (lang === 'es' ? 'con un toque de ' : 'with ') + NAMES_SHORT(under) + (lang === 'es' ? '' : ' undertones');
    $('#ecSample').hidden = !!S.era;
    $('#cardNote').textContent = S.era
      ? (lang === 'es' ? 'Tu tarjeta muestra tu tipo y tus XP de demo, nunca tus respuestas.' : 'Your card shows your type and your demo XP, never your answers.')
      : (lang === 'es' ? 'Termina el quiz para hacerla tuya. La tarjeta muestra tu tipo y tus XP de demo, nunca tus respuestas.' : 'Finish the quiz to make it yours. The card shows your type and your demo XP, never your answers.');
    renderCardStats();
    if (real) goSlide(0);
  }
  var slide = 0, slideT = null, paused = false, DUR = 3800;
  function goSlide(i) {
    var slides = $$('.ec-slide'), bars = $$('.ec-progress i');
    slide = (i + slides.length) % slides.length;
    slides.forEach(function (s, k) { s.classList.toggle('is-on', k === slide); });
    bars.forEach(function (b, k) { b.classList.remove('is-run'); b.classList.toggle('is-done', k < slide); b.style.setProperty('--dur', DUR + 'ms'); });
    void $('#eraCard').offsetWidth;
    if (!paused && !reduce) bars[slide].classList.add('is-run'); else bars[slide].classList.add('is-done');
    if (slide === 1) $$('#ecMix .bar i').forEach(function (b) { b.style.width = '0'; setTimeout(function () { b.style.width = b.getAttribute('data-w') + '%'; }, 60); });
    clearTimeout(slideT);
    if (!paused && !reduce) slideT = setTimeout(function () { goSlide(slide + 1); }, DUR);
  }
  $$('.ec-nav').forEach(function (b) { b.addEventListener('click', function () { goSlide(slide + (+b.getAttribute('data-dir'))); }); });
  $('#pauseCard').addEventListener('click', function () {
    paused = !paused; this.setAttribute('aria-pressed', String(paused)); $('#eraCard').classList.toggle('is-paused', paused);
    if (paused) clearTimeout(slideT); else goSlide(slide);
  });
  if (reduce) { paused = true; $('#pauseCard').setAttribute('aria-pressed', 'true'); }

  /* canvas export 1080x1920 */
  function wrapLines(ctx, text, max) {
    var words = text.split(' '), lines = [], cur = '';
    words.forEach(function (w) { var t = cur ? cur + ' ' + w : w; if (ctx.measureText(t).width > max && cur) { lines.push(cur); cur = w; } else cur = t; });
    if (cur) lines.push(cur); return lines;
  }
  function rrect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  function drawSprite(ctx, name, x, y, cell) {
    var rows = SPR[name], h = rows.length + 2, w = rows[0].length + 2, g = [];
    for (var yy = 0; yy < h; yy++) { g.push([]); for (var xx = 0; xx < w; xx++) { var r = rows[yy - 1]; g[yy].push(r && xx > 0 && xx <= r.length ? r.charAt(xx - 1) : '.'); } }
    for (yy = 0; yy < h; yy++) for (xx = 0; xx < w; xx++) {
      var c = g[yy][xx], f = null;
      if (c !== '.') f = COL[c]; else { for (var dy = -1; dy <= 1 && !f; dy++) for (var dx = -1; dx <= 1; dx++) { var a = yy + dy, b = xx + dx; if (a >= 0 && b >= 0 && a < h && b < w && g[a][b] !== '.' && g[a][b] !== 'k') { f = COL.k; break; } } }
      if (f) { ctx.fillStyle = f; ctx.fillRect(x + xx * cell, y + yy * cell, cell + .5, cell + .5); }
    }
  }
  function renderPNG() {
    var id = S.era || 'chat', res = resultById(id), mix = S.mix || { chat: 41, plusone: 27, data: 14 };
    var BG = { celery: '#2FE07A', sky: '#6FD6FF', violet: '#B9A6FF', orange: '#FF8A2A', bubblegum: '#FF5FA8', teal: '#2FD4C4' }[res.color] || '#6FD6FF';
    var cv = document.createElement('canvas'); cv.width = 1080; cv.height = 1920; var x = cv.getContext('2d');
    x.fillStyle = BG; x.fillRect(0, 0, 1080, 1920);
    x.fillStyle = 'rgba(21,18,31,.14)'; for (var yy = 24; yy < 1920; yy += 48) for (var xx = 24; xx < 1080; xx += 48) { x.beginPath(); x.arc(xx, yy, 4.5, 0, 6.3); x.fill(); }
    x.strokeStyle = '#15121F'; x.lineWidth = 12; rrect(x, 30, 30, 1020, 1860, 60); x.stroke();
    x.fillStyle = '#15121F'; x.font = '400 46px "Jersey 15"'; x.fillText((lang === 'es' ? 'MI MODO DE ORGANIZAR' : 'MY ORGANIZER ERA'), 96, 190);
    x.fillStyle = '#FFF8EA'; rrect(x, 96, 250, 300, 300, 56); x.fill(); x.lineWidth = 9; x.stroke();
    drawSprite(x, SPR_FOR[id], 126, 280, 17);
    x.fillStyle = '#15121F'; x.font = '800 118px Unbounded';
    var lines = wrapLines(x, T(res.name), 880), y0 = 720; lines.forEach(function (l, i) { x.fillText(l, 96, y0 + i * 126); });
    var y = y0 + lines.length * 126 + 10;
    x.font = '600 50px Lexend'; wrapLines(x, T(res.subline), 880).forEach(function (l, i) { x.fillText(l, 96, y + i * 64); });
    y += 190;
    x.font = '400 50px "Jersey 15"'; x.fillText(lang === 'es' ? 'MI MEZCLA' : 'MY MIX', 96, y);
    Object.keys(mix).sort(function (a, b) { return mix[b] - mix[a]; }).slice(0, 3).forEach(function (k, i) {
      var yy2 = y + 40 + i * 110; x.font = '700 40px Lexend'; x.fillStyle = '#15121F'; x.fillText(NAMES_SHORT(k) + ' · ' + mix[k] + '%', 96, yy2 + 30);
      x.fillStyle = '#FFF8EA'; rrect(x, 96, yy2 + 50, 880, 38, 19); x.fill(); x.lineWidth = 7; x.stroke();
      x.fillStyle = '#15121F'; rrect(x, 96, yy2 + 50, Math.max(40, 880 * mix[k] / 100), 38, 19); x.fill();
    });
    x.fillStyle = '#15121F'; x.font = '700 40px Lexend';
    x.fillText((lang === 'es' ? '¿Y el tuyo? Código ' : 'What\'s yours? Code ') + ensureCode(), 96, 1700);
    x.font = '700 36px Lexend'; x.fillText('Young Dems · Seminole County', 96, 1800);
    x.fillStyle = '#15121F'; rrect(x, 830, 1758, 150, 58, 12); x.fill(); x.fillStyle = '#FFD60A'; x.font = '400 44px "Jersey 15"'; x.fillText('DEMO', 858, 1800);
    return cv;
  }
  function withFonts(fn) {
    var ready = document.fonts && document.fonts.load ? Promise.all(['800 118px Unbounded', '600 50px Lexend', '700 40px Lexend', '400 46px "Jersey 15"'].map(function (f) { return document.fonts.load(f); })) : Promise.resolve();
    ready.then(fn, fn);
  }
  $('#saveCard').addEventListener('click', function () {
    var btn = this;
    withFonts(function () {
      var cv = renderPNG();
      cv.toBlob(function (b) { if (b) download('my-organizer-era-ydsc-demo.png', b); award('share-card', 10, lang === 'es' ? 'Tarjeta guardada' : 'Card saved', btn); });
    });
  });
  $('#shareCard').addEventListener('click', function () {
    var btn = this, res = resultById(S.era || 'chat');
    if (!S.era) { toast(lang === 'es' ? 'Primero termina el quiz.' : 'Take the quiz first, then send your own card.'); $('#quiz').scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' }); return; }
    var text = T(Q.copy.shareText).replace('{match}', T(res.name));
    shareOrCopy({ title: 'Young Dems of Seminole County', text: text, url: shareUrl() }, function () { award('share-card', 10, lang === 'es' ? 'Tarjeta compartida' : 'Card shared', btn); });
  });

  /* ------------------------------------------------------------------ reel */
  var CLIPS = [
    { id: 'mail-ballot-renew', h: '@demo.maria', cap: 'PSA: requested a mail ballot in 2025 or 2026? Yours ends Dec 31.', chip: 'Add the reminder', act: 'reminder', xp: 15, views: '3.8K' },
    { id: 'lake-monroe-canvass', h: '@demo.luis', cap: 'Sunset canvass by Lake Monroe. Met neighbors, caught the sky.', chip: 'Sunset walk Sat', href: '#ev-sunset-walk-lake-monroe', xp: 10, views: '1.6K' },
    { id: 'trivia-night-recap', h: '@demo.sam', cap: 'Trivia night recap: new friends, questionable team names.', chip: 'Trivia Thu Nov 19', href: '#ev-trivia-how-seminole-are-you', xp: 10, views: '2.0K' },
    { id: 'precinct-captain', h: '@demo.priya', cap: 'What is a precinct captain? Your neighborhood organizer, explained.', chip: 'Find your era', href: '#era', xp: 10, views: '3.0K' },
    { id: 'sunrail-rally', h: '@demo.jordan', cap: 'Took SunRail to the meetup. No parking, no stress.', chip: 'Bring a friend', href: '#squad', xp: 60, views: '2.4K' },
    { id: 'first-time-voter', h: '@demo.ava', cap: 'POV: you just voted for the first time.', chip: 'Check registration', href: 'https://voteseminole.gov/voters/my-voter-record/', ext: true, xp: 15, views: '5.1K' }
  ];
  function renderReel() {
    var row = $('#reelRow');
    CLIPS.forEach(function (c) {
      var li = document.createElement('li'); li.className = 'clip';
      var chip = c.act ? '<button type="button" class="clip-chip" data-action="' + c.act + '">' : '<a class="clip-chip" href="' + c.href + '"' + (c.ext ? ' target="_blank" rel="noopener"' : '') + '>';
      chip += '<span></span><span class="xp-chip">+' + c.xp + '</span>' + (c.act ? '</button>' : '</a>');
      li.innerHTML = '<div class="clip-frame"><img loading="lazy" width="432" height="768" src="media/' + c.id + '.jpg" alt=""><button type="button" class="clip-play"><span><svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d="M8 5l12 7-12 7z" fill="#15121F"/></svg></span><span class="sr-only"></span></button><div class="clip-meta">' + chip + '</div></div><p class="clip-cap"><b></b><span></span></p><p class="clip-stats">' + c.views + ' views · DEMO CLIP</p>';
      li.querySelector('.clip-chip span').textContent = c.chip;
      li.querySelector('.clip-cap b').textContent = c.h;
      li.querySelector('.clip-cap span').textContent = c.cap;
      li.querySelector('.clip-play .sr-only').textContent = 'Play demo clip by ' + c.h + ': ' + c.cap;
      li.querySelector('img').alt = 'Demo clip cover: ' + c.cap;
      li.querySelector('.clip-play').addEventListener('click', function () {
        var fr = li.querySelector('.clip-frame'), v = document.createElement('video');
        v.src = 'media/' + c.id + '.mp4'; v.poster = 'media/' + c.id + '.jpg'; v.muted = true; v.playsInline = true; v.setAttribute('playsinline', ''); v.controls = true; v.loop = true; v.preload = 'auto';
        v.setAttribute('aria-label', 'Demo clip by ' + c.h + '. Captions are burned into the video. ' + c.cap);
        fr.querySelector('img').replaceWith(v); this.remove(); v.play().catch(function () {});
      });
      row.appendChild(li);
    });
  }
  function openPost() {
    var p = $('#postPanel'); p.hidden = false;
    p.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
    setTimeout(function () { $('#postTitle').focus({ preventScroll: true }); }, reduce ? 0 : 400);
  }
  $('#postClose').addEventListener('click', function () { $('#postPanel').hidden = true; });
  $('#postPanel').addEventListener('submit', function (e) {
    e.preventDefault();
    var link = $('#ppLink').value.trim(), file = $('#ppFile').files && $('#ppFile').files[0], msg = $('#postMsg');
    var boxes = $$('#postPanel input[type=checkbox]'), allOk = boxes.every(function (b) { return b.checked; });
    if (!link && !file) { msg.textContent = 'Add a link or pick a video first.'; $('#ppLink').setAttribute('aria-invalid', 'true'); $('#ppLink').focus(); return; }
    if (link && !/^https?:\/\/(www\.|m\.|vm\.)?(tiktok\.com|instagram\.com|youtube\.com|youtu\.be)\//i.test(link)) { msg.textContent = 'That link doesn\'t look like TikTok, Instagram or YouTube. Try once more?'; $('#ppLink').setAttribute('aria-invalid', 'true'); $('#ppLink').focus(); return; }
    $('#ppLink').removeAttribute('aria-invalid');
    if (!allOk) { msg.textContent = 'Tick all three boxes so we can put it in the review queue.'; return; }
    S.posted = true; save();
    msg.textContent = 'In the review queue (demo: nothing was uploaded). You get +30 XP and the On Camera badge once a person approves it.';
    toast('Clip sent for review (demo).');
    burst($('#postPanel .btn-blue'));
  });

  /* ------------------------------------------------------------------ events */
  var COVERS = {
    'sunset-walk-lake-monroe': { id: '1783676056910-e5f3b27bdcbd', alt: 'People on a lakeside path at sunset, the water glowing orange (stock photo)' },
    'trivia-how-seminole-are-you': { id: '1646934280686-768a69c444eb', alt: 'Friends laughing around a wooden table during a card game (stock photo)' },
    'text-bank-dec-31-heads-up': { id: '1768299947895-06b676197f74', alt: 'Three friends laughing while looking at a phone together outdoors (stock photo)' }
  };
  var FACE_COLS = ['#FFD60A', '#2FE07A', '#FF5FA8', '#6FD6FF', '#FF8A2A', '#B9A6FF'];
  var FACE_INIT = [['M', 'J', 'A', 'L', 'S'], ['P', 'D', 'K', 'R', 'T'], ['E', 'N', 'C', 'V', 'B']];
  var MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'], DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  var MON_ES = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'], DOW_ES = ['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB'];
  function nyParts(iso) {
    var d = new Date(iso);
    var f = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'numeric', day: 'numeric' }).formatToParts(d);
    var o = {}; f.forEach(function (p) { o[p.type] = p.value; });
    var dowI = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(o.weekday);
    return { dow: (lang === 'es' ? DOW_ES : DOW)[dowI], day: o.day, mon: (lang === 'es' ? MON_ES : MON)[(+o.month) - 1] };
  }
  function renderEvents() {
    var g = $('#evGrid'); g.innerHTML = '';
    D.events.forEach(function (e, idx) {
      var p = nyParts(e.start), cov = COVERS[e.id], going = e.going + (S.rsvp[e.id] ? 1 : 0);
      var art = document.createElement('article'); art.className = 'ev'; art.id = 'ev-' + e.id; art.setAttribute('aria-labelledby', 'evt-' + e.id);
      var faces = FACE_INIT[idx % 3].map(function (ch, i) { return '<span style="background:' + FACE_COLS[(i + idx) % FACE_COLS.length] + '">' + ch + '</span>'; }).join('') + (S.rsvp[e.id] ? '<span class="me">' + (lang === 'es' ? 'Tú' : 'You') + '</span>' : '');
      art.innerHTML =
        '<div class="ev-cover"><img loading="lazy" width="800" height="500" src="https://images.unsplash.com/photo-' + cov.id + '?w=800&auto=format&fit=crop&q=70" alt="">' +
        '<p class="ev-date" aria-hidden="true"><small>' + p.dow + '</small><b>' + p.day + '</b><em>' + p.mon + '</em></p>' +
        '<span class="ev-tag demo-tag">' + (lang === 'es' ? 'EVENTO DEMO' : 'DEMO EVENT') + '</span></div>' +
        '<div class="ev-body"><h3 id="evt-' + e.id + '"></h3><p class="ev-when"></p><p class="ev-where"></p><p class="ev-tagline"></p>' +
        '<ul class="vibes" role="list"></ul>' +
        '<div class="going"><div class="faces" aria-hidden="true">' + faces + '</div><p><b class="gn">' + going + '</b> ' + (lang === 'es' ? 'van' : 'going') + ' · ' + T(e.cost) + ' <span class="demo-tag">DEMO</span></p></div>' +
        '<p class="ev-access"><b>' + (lang === 'es' ? 'Accesibilidad: ' : 'Access: ') + '</b><span></span></p>' +
        '<div class="ev-slot"></div></div>';
      art.querySelector('h3').textContent = T(e.title);
      art.querySelector('.ev-when').textContent = T(e.when);
      art.querySelector('.ev-where').textContent = T(e.place);
      art.querySelector('.ev-tagline').textContent = T(e.tagline);
      art.querySelector('.ev-access span').textContent = T(e.access);
      art.querySelector('img').alt = cov.alt;
      art.querySelector('.vibes').innerHTML = e.vibes.map(function (v) { return '<li></li>'; }).join('');
      $$('.vibes li', art).forEach(function (li, i) { li.textContent = T(e.vibes[i]); });
      g.appendChild(art);
      renderSlot(e);
    });
  }
  function evById(id) { for (var i = 0; i < D.events.length; i++) if (D.events[i].id === id) return D.events[i]; }
  function renderSlot(e) {
    var slot = $('#ev-' + e.id + ' .ev-slot');
    if (S.rsvp[e.id]) {
      slot.innerHTML = '<div class="ev-done" role="status"><p>' + (lang === 'es' ? 'Lugar guardado. Te mandamos un recordatorio el día antes. (Demo: no se envía nada.)' : 'Seat saved. We\'ll send a reminder the day before. (Demo: nothing is sent.)') + '</p><div class="row">' +
        '<button type="button" class="btn btn-white btn-sm" data-cal="' + e.id + '">' + (lang === 'es' ? 'Agregar al calendario' : 'Add to calendar') + '</button>' +
        '<button type="button" class="btn btn-pink btn-sm" data-share-ev="' + e.id + '">' + (lang === 'es' ? 'Mándaselo a alguien' : 'Text this to a friend') + '</button></div></div>';
    } else {
      slot.innerHTML = '<div class="ev-actions"><button type="button" class="btn btn-blue" data-rsvp="' + e.id + '" aria-expanded="false"><span>' + (lang === 'es' ? 'Guárdame un lugar' : 'Save my seat') + '</span> <span class="xp-chip">+10</span></button>' +
        '<button type="button" class="icon-btn" data-cal="' + e.id + '"><span class="sr-only">' + (lang === 'es' ? 'Agregar al calendario' : 'Add to calendar') + '</span><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="3" fill="none" stroke="currentColor" stroke-width="2.6"/><path d="M3 10h18M8 2v5M16 2v5" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg></button>' +
        '<button type="button" class="icon-btn" data-share-ev="' + e.id + '"><span class="sr-only">' + (lang === 'es' ? 'Mándaselo a alguien' : 'Text this to a friend') + '</span><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linejoin="round"/></svg></button></div>';
    }
  }
  function openRSVP(id) {
    var e = evById(id), slot = $('#ev-' + id + ' .ev-slot'); if (!e || S.rsvp[id] || slot.querySelector('form')) { if (slot.querySelector('input')) slot.querySelector('input').focus(); return; }
    var btn = slot.querySelector('[data-rsvp]'); if (btn) btn.setAttribute('aria-expanded', 'true');
    var f = document.createElement('form'); f.className = 'ev-form'; f.noValidate = true;
    var es = lang === 'es';
    f.innerHTML = '<div class="row2"><div class="field"><label for="rn-' + id + '">' + (es ? '¿Cómo te llamamos?' : 'First name') + '</label><input id="rn-' + id + '" autocomplete="given-name" required></div>' +
      '<div class="field"><label for="rc-' + id + '">' + (es ? 'Email o celular' : 'Email or mobile') + '</label><input id="rc-' + id + '" autocomplete="email" inputmode="email" required></div></div>' +
      '<div class="field"><label for="ra-' + id + '">' + (es ? '¿Algo que te lo haría más fácil? ' : 'Anything that would make this easier? ') + '<span class="opt">' + (es ? '(opcional)' : '(optional)') + '</span></label><input id="ra-' + id + '" placeholder="' + (es ? 'Transporte, ASL, un rincón tranquilo, vienen niños' : 'Rides, ASL, a quiet corner, kids in tow') + '"></div>' +
      '<button type="submit" class="btn btn-blue"><span>' + (es ? 'Guárdame un lugar' : 'Save my seat') + '</span> <span class="xp-chip">+10 XP</span></button><p class="hint" role="status"></p>';
    slot.appendChild(f);
    f.querySelector('input').focus();
    f.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var n = f.querySelector('#rn-' + id), c = f.querySelector('#rc-' + id), msg = f.querySelector('.hint');
      [n, c].forEach(function (i) { i.removeAttribute('aria-invalid'); });
      if (!n.value.trim()) { n.setAttribute('aria-invalid', 'true'); msg.textContent = es ? 'Pon tu nombre para guardar tu lugar.' : 'Add your first name so we can save your seat.'; n.focus(); return; }
      var v = c.value.trim(), digits = v.replace(/\D/g, '');
      if (!(/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) || digits.length >= 10)) { c.setAttribute('aria-invalid', 'true'); msg.textContent = v.indexOf('@') < 0 && /[a-z]/i.test(v) ? (es ? 'A ese email le falta la @. ¿Otra vez?' : 'That email\'s missing an @. Happens to everyone. Try once more?') : (es ? 'Pon un email o un celular de 10 dígitos.' : 'Add an email, or a 10-digit mobile number.'); c.focus(); return; }
      if (!S.name) { S.name = n.value.trim(); }
      S.rsvp[id] = Date.now(); save();
      var sub = f.querySelector('button[type=submit]');
      award('rsvp', 10, es ? 'Lugar guardado' : 'Seat saved', sub) || burst(sub);
      var art = $('#ev-' + id); var gn = art.querySelector('.gn'); gn.textContent = e.going + 1;
      var fc = art.querySelector('.faces'); var me = document.createElement('span'); me.className = 'me'; me.textContent = es ? 'Tú' : 'You'; fc.appendChild(me);
      renderSlot(e); renderQuests();
    });
  }
  document.addEventListener('click', function (ev) {
    var r = ev.target.closest('[data-rsvp]'); if (r) { openRSVP(r.getAttribute('data-rsvp')); return; }
    var c = ev.target.closest('[data-cal]'); if (c) { var e = evById(c.getAttribute('data-cal')); download(e.id + '.ics', ics({ uid: e.id, start: e.start, end: e.end, title: T(e.title) + ' (Young Dems demo event)', desc: T(e.cal), location: T(e.place) + ', Seminole County, FL' }), 'text/calendar'); toast(lang === 'es' ? 'Archivo de calendario descargado.' : 'Calendar file downloaded.'); return; }
    var s = ev.target.closest('[data-share-ev]'); if (s) { var e2 = evById(s.getAttribute('data-share-ev')); var text = T(e2.share).replace(' {url}', '').replace('{url}', ''); shareOrCopy({ title: T(e2.title), text: text, url: shareUrl() + '#ev-' + e2.id }, function () { award('share-event-' + e2.id, 10, lang === 'es' ? 'Invitación enviada' : 'Invite sent', s); }); }
  });

  /* ------------------------------------------------------------------ squad + cup */
  var CUP = [
    { n: 'Celery City Crew', c: 'Sanford', p: 412 },
    { n: 'Campus Commuters', c: 'Oviedo', p: 377 },
    { n: 'SunRail Regulars', c: 'Longwood', p: 351, up: '+38%' },
    { n: 'Lakeside Night Owls', c: 'Lake Mary', p: 298 },
    { n: 'Spreadsheet Witches', c: 'Altamonte Springs', p: 264 },
    { n: 'Chuluota Porch Club', c: 'Unincorporated', p: 231 }
  ];
  function renderCup() {
    var list = $('#cupList'); if (!list) return;
    var you = { n: (S.name ? S.name + '\u2019s squad' : 'Your squad') , c: 'you + ' + S.squad, p: S.xp, you: true };
    var max = CUP[0].p;
    var rows = CUP.map(function (r, i) { return { r: r, rank: i + 1 }; });
    list.innerHTML = rows.concat([{ r: you, rank: '?' }]).map(function (o) {
      var r = o.r;
      return '<li class="cup-row' + (r.you ? ' is-you' : '') + '"><span class="cup-rank">' + (r.you ? 'YOU' : o.rank) + '</span><p class="cup-name"><span class="cup-n"></span> <span class="cup-city"></span>' + (r.up ? '<span class="cup-up">' + r.up + '</span>' : '') + '</p><span class="cup-pts">' + r.p + '</span><span class="cup-bar"><i style="width:' + Math.min(100, Math.max(2, r.p / max * 100)) + '%"></i></span></li>';
    }).join('');
    $$('.cup-row', list).forEach(function (li, i) {
      var r = i < CUP.length ? CUP[i] : you;
      li.querySelector('.cup-n').textContent = r.n; li.querySelector('.cup-city').textContent = r.c;
      li.setAttribute('aria-label', (r.you ? 'Your squad' : 'Rank ' + (i + 1) + ', ' + r.n) + ', ' + r.c + ', ' + r.p + ' points' + (r.up ? ', most improved ' + r.up : '') + (r.you ? '' : ' (demo)'));
    });
  }
  function renderSquad() {
    var code = ensureCode();
    $('#slCode').textContent = code;
    $('#slUrl').textContent = 'youngsemdems · ?ref=';
    if (S.name && !$('#slName').value) $('#slName').value = S.name;
    $$('#slots .slot').forEach(function (s, i) {
      var on = i < S.squad; s.classList.toggle('is-on', on);
      s.querySelector('.slot-t').textContent = on ? (['Jordan', 'Priya', 'Luis'][i] + ' (simulated, DEMO)') : 'Friend ' + (i + 1);
      s.querySelector('.slot-c').textContent = on ? '✓' : (i + 1);
    });
  }
  $('#slName').addEventListener('input', function () {
    var v = this.value.trim(); S.name = v; S.code = makeCode(v); save(); renderSquad(); renderCardStats(); renderCup();
  });
  var demoFriendT = null;
  function simulateFriend() {
    if (S.squad >= 3 || demoFriendT) return;
    demoFriendT = setTimeout(function () {
      demoFriendT = null; S.squad++; save(); renderSquad();
      var slot = $$('#slots .slot')[S.squad - 1];
      award('friend-' + S.squad, 60, lang === 'es' ? 'Alguien se unió con tu enlace (simulado)' : 'A friend joined with your link (simulated)', slot);
      unlock('plus-one'); if (S.squad >= 3) unlock('squad-of-three');
    }, 2600);
  }
  $('#slCopy').addEventListener('click', function () {
    var btn = this, url = shareUrl();
    copyText(url).then(function () { toast((lang === 'es' ? 'Enlace copiado: ' : 'Link copied: ') + url.replace(/^https?:\/\//, '').slice(0, 48) + '…'); }, function () { window.prompt('Copy your link:', url); });
    btn.classList.add('is-pressed'); setTimeout(function () { btn.classList.remove('is-pressed'); }, 160);
    simulateFriend();
  });
  $('#slShare').addEventListener('click', function () {
    var text = lang === 'es' ? 'Me uní a los Young Dems de Seminole. ¿Vienes a la próxima conmigo?' : 'I just joined the Young Dems in Seminole. Come to the next one with me?';
    var url = shareUrl();
    if (navigator.share) { navigator.share({ title: 'Young Dems', text: text, url: url }).then(simulateFriend, function () {}); }
    else { location.href = 'sms:?&body=' + encodeURIComponent(text + ' ' + url); simulateFriend(); }
  });

  /* ------------------------------------------------------------------ join + letter */
  $('#joinForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var n = $('#jName'), c = $('#jContact'), msg = $('#joinMsg'), es = lang === 'es';
    [n, c].forEach(function (i) { i.removeAttribute('aria-invalid'); });
    if (!n.value.trim()) { n.setAttribute('aria-invalid', 'true'); msg.textContent = es ? '¿Cómo te llamamos? Falta tu nombre.' : 'What should we call you? Add a first name.'; n.focus(); return; }
    var v = c.value.trim(), digits = v.replace(/\D/g, '');
    if (!(/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) || digits.length >= 10)) { c.setAttribute('aria-invalid', 'true'); msg.textContent = es ? 'Pon un email o un celular de 10 dígitos.' : (v.indexOf('@') < 0 && /[a-z]/i.test(v) ? 'That email\'s missing an @. Happens to everyone. Try once more?' : 'Add an email, or a 10-digit mobile number.'); c.focus(); return; }
    S.name = n.value.trim(); if (!S.code || /^[B-Z2-9]{6}$/.test(S.code)) S.code = makeCode(S.name);
    S.joined = true; save();
    var btn = this.querySelector('button[type=submit]');
    award('join', 50, es ? 'Bienvenida al equipo' : 'Welcome to the team', btn);
    var tier = (this.querySelector('input[name=tier]:checked') || {}).value;
    if (tier) unlock('card-carrier');
    msg.textContent = (es ? 'Listo, ya estás. Tu primera carta llega el jueves. ' : 'You\'re in. Your first letter lands Thursday. Go drink some water. ') + (tier === 'voting' ? (es ? 'Las cuotas se pagan en enero en ActBlue. ' : 'Dues are paid in January on ActBlue. ') : '') + (es ? '(Demo: no se envió nada.)' : '(Demo: nothing was sent.)');
    renderSquad(); renderCup();
  });
  $('#letterForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var i = $('#lEmail'), m = $('#letterMsg'), v = i.value.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) { i.setAttribute('aria-invalid', 'true'); m.textContent = v && v.indexOf('@') < 0 ? ' That email\'s missing an @. Try once more?' : ' Add your email first.'; i.focus(); return; }
    i.removeAttribute('aria-invalid');
    m.textContent = lang === 'es' ? ' Listo. Tu primera carta llega el jueves. (Demo: no se envían correos.)' : ' You\'re in. Your first letter lands Thursday. (Demo: no emails are sent.)';
    burst(this.querySelector('button'));
  });

  /* ------------------------------------------------------------------ chrome: menu, marquee, theme, language */
  $('#menuBtn').addEventListener('click', function () { var o = $('#nav').classList.toggle('is-open'); this.setAttribute('aria-expanded', String(o)); });
  $$('#nav a').forEach(function (a) { a.addEventListener('click', function () { $('#nav').classList.remove('is-open'); $('#menuBtn').setAttribute('aria-expanded', 'false'); }); });
  $('#marqueePause').addEventListener('click', function () { var p = $('#marquee').classList.toggle('is-paused'); this.setAttribute('aria-pressed', String(p)); });
  if (reduce) { $('#marquee').classList.add('is-paused'); $('#marqueePause').setAttribute('aria-pressed', 'true'); }

  function isDark() { var t = document.documentElement.getAttribute('data-theme'); return t ? t === 'dark' : (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches); }
  function syncThemeBtn() { $('#themeBtn').setAttribute('aria-label', isDark() ? 'Switch to light mode' : 'Switch to dark mode'); }
  $('#themeBtn').addEventListener('click', function () {
    var t = isDark() ? 'light' : 'dark'; document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem('ydsc-c-theme', t); } catch (e) {} syncThemeBtn();
  });
  syncThemeBtn();

  var ES = {
    demobar: 'Prototipo para los Young Democrats of Seminole County. Las personas, los eventos, los videos y los contadores son de muestra.', demobarShort: 'Prototipo. Personas, eventos y cifras de muestra.', joinShort: 'Únete',
    navQuests: 'Misiones', navEvents: 'Eventos', navReel: 'Videos', navSquad: 'Tu gente', navLetter: 'Carta del Jueves', join: 'Únete gratis',
    heroEyebrow: 'Young Democrats of Seminole County', heroAges: '· de 14 a 39 años', heroH1a: 'Dale', heroH1b: 'play', heroH1c: 'en el condado de Seminole.',
    heroSub: 'Según el conteo no oficial, Seminole votó azul para gobernador el 3 de noviembre; el estado no. La próxima ronda es local y se arma con movimientos pequeños, uno por semana, con gente que de verdad te va a caer bien.',
    heroCta: 'Únete gratis', heroCta2: 'Ver las misiones de la semana', heroMicro: 'Empezar cuesta $0 · unos 20 segundos · nunca vendemos tu información',
    nextTitle: 'Tres cosas que vale la pena hacer esta semana',
    nm1Title: 'Tu solicitud de boleta por correo vence el 31 de diciembre.', nm1Body: 'Ponte un recordatorio para renovarla el 1 de enero y te cubre hasta finales de 2028. Renovar toma un minuto en el sitio del condado.', nm1Cta: 'Agregar el recordatorio',
    nm2Title: 'Caminata al atardecer en el lago Monroe', nm2Body: 'Te haya ido como te haya ido el 3 de noviembre, ven a caminar con nosotros. Gratis, a paso lento, y si prefieres, te quedas en una banca.', nm2Cta: 'Guárdame un lugar',
    nm3Title: 'La identificación de estudiante deja de servir para votar.', nm3Body: 'Desde el 1 de enero de 2027, Florida deja de aceptar la identificación de estudiante para votar (la medida está impugnada en los tribunales). Lleva tu licencia de conducir, tu identificación estatal o tu pasaporte, y revisa voteseminole.gov antes de ir.', nm3Cta: 'Qué identificación llevar',
    questTitle: 'Las misiones de esta semana', questLede: 'Movimientos pequeños y reales. Cada uno suma XP, y con uno por semana mantienes tu racha. ¿Se te pasó una semana? No pasa nada. Tu racha te espera.',
    eraTitle: '¿En qué modo organizas tú?', eraLede: '8 preguntas rápidas. No hay respuestas incorrectas, y cada tipo tiene su lugar en el equipo. Al final te llevas una tarjeta para el chat del grupo.',
    reelTitle: 'Sesenta segundos, hechos por miembros', reelLede: 'Videos verticales sobre la vida en Seminole y las fechas que importan. Cada video termina con algo que puedes hacer. (Estos seis son de muestra.)', postCta: 'Sube un video',
    eventsTitle: 'Guarda tu lugar', eventsLede: 'Gratis, sin alcohol e ideales si es tu primera vez. Cada evento explica desde el principio cómo es el acceso. ¿Vienes sin compañía? Perfecto.',
    squadTitle: 'Trae a tu gente', squadLede: 'Un mensaje de alguien conocido mueve más que cualquier anuncio. Así que la mejor jugada es tuya: manda tu enlace a tres personas con las que de verdad saldrías.',
    scoreTitle: 'El marcador real', scoreLede: 'Aquí no hay números de muestra. Cada cifra enlaza a su fuente.', joinTitle: 'Únete al equipo', letterTitle: 'La Carta del Jueves'
  };
  var EN = {};
  $$('[data-i18n]').forEach(function (el) { EN[el.getAttribute('data-i18n')] = el.textContent; });
  function applyLang() {
    document.documentElement.lang = lang;
    $$('[data-i18n]').forEach(function (el) { var k = el.getAttribute('data-i18n'); var v = (lang === 'es' ? ES : EN)[k]; if (v) el.textContent = v; });
    $('#langBtn').setAttribute('aria-pressed', String(lang === 'es'));
    $('#langBtn').innerHTML = lang === 'es' ? '<span aria-hidden="true">EN</span><span class="sr-only">View in English</span>' : '<span aria-hidden="true">ES</span><span class="sr-only">Ver en español</span>';
    $('#langBtn').setAttribute('lang', lang === 'es' ? 'en' : 'es');
    renderEvents(); renderHUD(); renderCard(false);
    if (S.era && qi >= Q.questions.length) renderQuizDone(); else renderQ();
  }
  $('#langBtn').addEventListener('click', function () { lang = lang === 'es' ? 'en' : 'es'; applyLang(); toast(lang === 'es' ? 'Español (borrador: falta revisión de hablantes nativos)' : 'English'); });

  /* ------------------------------------------------------------------ boot */
  paintSprites(document);
  renderReel();
  renderEvents();
  renderSquad();
  renderHUD();
  renderCard(false);
  if (S.era) { qi = Q.questions.length; renderQuizDone(); } else renderQ();
  goSlide(0);
  window.YDSC_C = { state: S, reset: function () { try { localStorage.removeItem(KEY); } catch (e) {} location.reload(); } };
})();
