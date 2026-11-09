/* Concept A · "Group Chat" · Young Democrats of Seminole County (DEMO prototype)
   Plain JS, no dependencies. Everything stays in this browser (demo mode). */
(function () {
  'use strict';

  var CFG = {
    siteUrl: 'https://youngsemdems.com/',          // intended domain (matches the ActBlue slug); demo only
    siteLabel: 'youngsemdems.com',
    tz: 'America/New_York',
    mailDeadline: [2026, 12, 31],                    // F.S. 101.62: every request on file ends Dec 31, 2026
    refAlphabet: 'BCDFGHJKMNPQRSTVWXZ23456789',      // no vowels, no look-alikes (matches config.members)
    disclaimer: 'Paid for by [committee name and address placeholder] · DEMO'
  };

  var root = document.documentElement;
  var $ = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem('ysdA:' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem('ysdA:' + k, JSON.stringify(v)); } catch (e) {} }
  };
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function motionOff() { return reduceMotion || root.classList.contains('paused'); }

  /* ---------------- toast ---------------- */
  var toastEl = $('[data-toast]'), toastT;
  function toast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add('is-on');
    clearTimeout(toastT);
    toastT = setTimeout(function () { toastEl.classList.remove('is-on'); }, 4200);
  }

  /* ---------------- confetti ---------------- */
  var cv = $('[data-confetti]'), cx = cv && cv.getContext('2d'), parts = [], raf = 0;
  var COLORS = ['#C8F03C', '#6A2BFF', '#FF7AC6', '#4FD6FF', '#FF8B3D', '#FFF6EA'];
  function confetti(fromEl) {
    if (!cx || motionOff()) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = innerWidth * dpr; cv.height = innerHeight * dpr; cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var r = fromEl ? fromEl.getBoundingClientRect() : { left: innerWidth / 2, top: innerHeight / 2, width: 0, height: 0 };
    var ox = r.left + r.width / 2, oy = r.top + r.height / 2;
    for (var i = 0; i < 90; i++) {
      var a = Math.random() * Math.PI * 2, s = 4 + Math.random() * 8;
      parts.push({ x: ox, y: oy, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 6, w: 6 + Math.random() * 7, h: 8 + Math.random() * 10, rot: Math.random() * 6, vr: (Math.random() - .5) * .4, c: COLORS[i % COLORS.length], life: 0 });
    }
    cv.classList.add('is-on');
    if (!raf) raf = requestAnimationFrame(tick);
  }
  function tick() {
    cx.clearRect(0, 0, innerWidth, innerHeight);
    parts = parts.filter(function (p) { return p.life < 90 && p.y < innerHeight + 40; });
    parts.forEach(function (p) {
      p.life++; p.vy += .32; p.vx *= .985; p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      cx.save(); cx.translate(p.x, p.y); cx.rotate(p.rot); cx.fillStyle = p.c; cx.globalAlpha = Math.max(0, 1 - p.life / 90);
      cx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); cx.restore();
    });
    raf = parts.length ? requestAnimationFrame(tick) : 0;
    if (!raf) { cx.clearRect(0, 0, innerWidth, innerHeight); cv.classList.toggle('is-on', false); }
  }

  /* ---------------- clipboard ---------------- */
  function copyText(t) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(t).then(function () { return true; }, function () { return legacyCopy(t); });
    return Promise.resolve(legacyCopy(t));
  }
  function legacyCopy(t) {
    var ta = document.createElement('textarea'); ta.value = t; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); var ok = false; try { ok = document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta); return ok;
  }

  /* ---------------- theme ---------------- */
  var themeBtn = $('[data-theme-toggle]'), themeOrder = ['auto', 'light', 'dark'];
  function setTheme(t) {
    root.setAttribute('data-theme', t); store.set('theme', t);
    if (themeBtn) {
      var label = { auto: 'Auto', light: 'Light', dark: 'Dark' }[t];
      $('[data-theme-label]', themeBtn).textContent = label;
      themeBtn.setAttribute('aria-label', 'Color theme: ' + label + '. Change theme');
    }
  }
  setTheme(store.get('theme', 'auto'));
  themeBtn && themeBtn.addEventListener('click', function () {
    var cur = root.getAttribute('data-theme') || 'auto';
    setTheme(themeOrder[(themeOrder.indexOf(cur) + 1) % 3]);
  });

  /* ---------------- menu ---------------- */
  var menuBtn = $('[data-menu]'), nav = $('#nav');
  function closeMenu() { nav.classList.remove('is-open'); menuBtn.setAttribute('aria-expanded', 'false'); }
  menuBtn && menuBtn.addEventListener('click', function () {
    var open = !nav.classList.contains('is-open');
    nav.classList.toggle('is-open', open); menuBtn.setAttribute('aria-expanded', String(open));
  });
  $$('#nav a').forEach(function (a) { a.addEventListener('click', closeMenu); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && nav.classList.contains('is-open')) { closeMenu(); menuBtn.focus(); } });

  /* ---------------- motion toggle ---------------- */
  var motionBtn = $('[data-motion-toggle]');
  function setPaused(p) {
    root.classList.toggle('paused', p); store.set('paused', p);
    if (motionBtn) { motionBtn.setAttribute('aria-pressed', String(p)); $('[data-motion-label]', motionBtn).textContent = p ? 'Play motion' : 'Pause motion'; }
    if (p) finishChat(); else startRotor();
  }
  motionBtn && motionBtn.addEventListener('click', function () { setPaused(!root.classList.contains('paused')); });

  /* ---------------- i18n (Spanish drafts; need native review) ---------------- */
  var ES = {
    'ribbon': 'Prototipo para los Jóvenes Demócratas del Condado de Seminole, pendiente de aprobación del capítulo. Los eventos, personas, clips y cifras marcados DEMO son de muestra.',
    'nav.vote': 'Para votar', 'nav.invite': 'Invita', 'nav.clips': 'Clips', 'nav.events': 'Eventos', 'nav.letter': 'La carta',
    'ribbon.short': 'Prototipo pendiente de aprobación de YDSC. Todo lo marcado DEMO es de muestra.',
    'notif.from': 'Young Dems', 'notif.when': '· lo próximo', 'notif.msg': 'Noche de trivia, jue 19 de nov, 7 pm, Lake Mary. Gratis. ¿Vienes?',
    'cta.join': 'Únete', 'menu': 'Menú', 'cta.joinChat': 'Únete al chat', 'cta.whatsOn': 'Mira qué hay',
    'hero.eyebrow': 'Jóvenes Demócratas del Condado de Seminole · de 14 a 39 años',
    'hero.title.a': 'El chat de grupo', 'hero.title.b': 'que sí llega.',
    'hero.rotor.lead': 'Somos quien', 'hero.rotor.sr': 'Somos quien siempre sabe la fecha límite, tiene plan para el jueves y te guarda un asiento.',
    'hero.sub': 'Reuniones, ayuda para votar con enlaces directos a las fuentes oficiales y un grupo de Sanford a Oviedo. Ven como eres. Trae a alguien.',
    'hero.fine': 'Unirte a la lista es gratis. Los eventos están abiertos a todos, seas demócrata registrado o no.',
    'pinned.kicker': 'Fijado en el chat', 'pinned.title': 'Lo próximo que hay que hacer', 'pinned.sub': 'Ordenado por fecha límite. Los enlaces para votar van directo a los sitios oficiales del condado y del estado.',
    'pinned.mail.days': 'días', 'pinned.mail.title': 'Toda solicitud de voto por correo en Florida vence el 31 de dic.',
    'pinned.mail.body': 'Incluye la tuya si votaste por correo este año. Vuelve a pedirla para las elecciones municipales de 2027 y para 2028.',
    'pinned.mail.cta': 'Renueva en voteseminole.gov', 'pinned.mail.fine': '¿No sabes cuándo abren las solicitudes de 2027? Pregunta a la Supervisora de Elecciones:',
    'pinned.id.title': '¿ID de estudiante? Deja de valer para votar.',
    'pinned.id.body': 'Desde el 1 de enero de 2027, Florida deja de aceptar identificaciones de estudiante en las urnas (la ley está impugnada en la corte). Lleva tu licencia de conducir, tu ID del estado o tu pasaporte, y revisa voteseminole.gov antes de ir.',
    'pinned.id.shout': 'UCF y Seminole State, esto es para ustedes.', 'pinned.id.cta': 'Revisa voteseminole.gov',
    'pinned.next.kicker': 'Próxima reunión', 'pinned.next.title': 'Noche de trivia: edición Seminole', 'pinned.next.when': 'jue 19 de nov · 7 pm · Lake Mary',
    'pinned.next.body': 'Gratis. Equipos de 4, o te buscamos uno. Preguntas sobre donde vives, cero exámenes sorpresa de política.',
    'pinned.next.cta': 'Voy', 'pinned.next.cal': 'Añadir al calendario', 'pinned.next.going': 'van (cifra demo)',
    'pinned.reg.kicker': 'Toma 2 minutos', 'pinned.reg.title': '¿Cumples 16? Preinscríbete ya.',
    'pinned.reg.body': 'Florida te deja preinscribirte a los 16, para que todo esté listo el día que cumplas 18. ¿Ya estás inscrito? Revisa que tu dirección esté al día.',
    'pinned.reg.cta': 'Revisar mi registro', 'pinned.reg.cta2': 'Inscribirme', 'pinned.checked': 'Enlaces revisados el 9 de nov de 2026',
    'maker.kicker': 'Trae a tres', 'maker.title': 'Mándalo al chat del grupo.', 'maker.sub': 'Haz una tarjeta, copia tu enlace y suéltalo en el chat. Quien se una con tu enlace entra a tu grupo.',
    'maker.send': 'Mandar al chat', 'maker.save': 'Guardar imagen', 'maker.text': 'Mandar SMS',
    'maker.what': '1. ¿Qué vas a mandar?', 'maker.tpl.trivia': 'Invitación a trivia', 'maker.tpl.mail': 'Aviso de voto por correo', 'maker.tpl.join': 'Únete conmigo',
    'maker.name': '2. Tu nombre', 'maker.city': 'Tu ciudad', 'maker.color': '3. Colores', 'maker.sticker': '4. Sticker',
    'maker.msg': 'Tu mensaje (cámbialo, es tuyo)', 'maker.link': 'Tu enlace de grupo', 'maker.copy': 'Copiar',
    'maker.squad': '0 de 3 amistades dentro.', 'maker.squadsub': 'Trae a tres y ambos reciben el paquete de stickers.',
    'reel.kicker': 'Clips del grupo', 'reel.title': 'Los clips', 'reel.sub': 'Verticales, de menos de un minuto, con subtítulos. Los hacen miembros. Una persona real del equipo ve cada clip antes de publicarlo.',
    'reel.post': 'Sube un clip', 'reel.postsub': '60 segundos. En vertical. Sobre por qué llegaste.',
    'events.kicker': 'Estás invitado', 'events.title': 'Invitaciones', 'events.sub': '¿Primera vez? Perfecto. Cada invitación dice el costo y los detalles de acceso.',
    'join.kicker': 'Toma 30 segundos', 'join.title': 'Entra al chat.', 'join.sub': 'Dos campos. Sin experiencia. Te mandamos la próxima reunión y las fechas que importan, nada más.'
  };
  var ROTOR = {
    en: ['always knows the deadline.', 'has a plan for Thursday.', 'saves you a seat.', 'reads the agenda first.', 'texts you back.'],
    es: ['siempre sabe la fecha límite.', 'tiene plan para el jueves.', 'te guarda un asiento.', 'lee la agenda primero.', 'te contesta el mensaje.']
  };
  var lang = 'en', langBtn = $('[data-lang-toggle]');
  function applyLang(l) {
    lang = l; root.lang = l; store.set('lang', l);
    $$('[data-i18n]').forEach(function (el) {
      if (el.dataset.en === undefined) el.dataset.en = el.textContent;
      var k = el.getAttribute('data-i18n');
      el.textContent = (l === 'es' && ES[k]) ? ES[k] : el.dataset.en;
    });
    if (langBtn) {
      langBtn.setAttribute('aria-pressed', String(l === 'es'));
      langBtn.innerHTML = l === 'es' ? '<span lang="en">EN</span>' : '<span lang="es">ES</span>';
      langBtn.setAttribute('aria-label', l === 'es' ? 'EN, read in English' : 'ES, leer en español');
    }
    rotorIdx = 0; var rw = $('[data-rotor]'); if (rw) rw.textContent = ROTOR[l][0];
    refreshRsvpLabels(); renderMaker(true); updateCountdown();
  }
  langBtn && langBtn.addEventListener('click', function () { applyLang(lang === 'es' ? 'en' : 'es'); });

  /* ---------------- kinetic rotor ---------------- */
  var rotorIdx = 0, rotorTimer = 0, rotorLoops = 0;
  function startRotor() {
    clearTimeout(rotorTimer);
    if (motionOff() || rotorLoops > 3) return;
    rotorTimer = setTimeout(stepRotor, 2600);
  }
  function stepRotor() {
    var el = $('[data-rotor]'); if (!el || motionOff()) return;
    var nextIdx = (rotorIdx + 1) % ROTOR[lang].length;
    el.classList.toggle('is-in', false); el.classList.toggle('is-out', true);
    setTimeout(function () {
      el.textContent = ROTOR[lang][nextIdx];
      el.classList.toggle('is-out', false); el.classList.toggle('is-in', true);
      rotorIdx = nextIdx; if (rotorIdx === 0) rotorLoops++;
      startRotor();
    }, 220);
  }

  /* ---------------- kinetic section titles (stretch in on scroll) ---------------- */
  var titles = $$('.sec-title');
  if (reduceMotion || !('IntersectionObserver' in window)) titles.forEach(function (t) { t.classList.add('is-in'); });
  else {
    var tio = new IntersectionObserver(function (ents) {
      ents.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add('is-in'); tio.unobserve(en.target); } });
    }, { rootMargin: '0px 0px -8% 0px' });
    titles.forEach(function (t) { tio.observe(t); });
  }

  /* ---------------- hero chat sequence ---------------- */
  var thread = $('[data-thread]'), chatTimers = [];
  function finishChat() {
    chatTimers.forEach(clearTimeout); chatTimers = [];
    if (!thread) return;
    $$('.msg', thread).forEach(function (m) { m.classList.add('is-in'); });
  }
  function playChat() {
    // Messages keep their final positions and only fade/slide in (opacity + transform): zero layout shift.
    if (!thread) return;
    if (motionOff()) { finishChat(); return; }
    var msgs = $$('.msg', thread);
    thread.setAttribute('data-animate', '');
    msgs.forEach(function (m) { m.classList.toggle('is-in', false); });
    var t = 450;
    msgs.forEach(function (m) {
      var last = m.classList.contains('msg--typing');
      t += last ? 700 : (m.classList.contains('msg--me') ? 520 : 640);
      chatTimers.push(setTimeout(function () { m.classList.add('is-in'); }, t));
    });
  }

  /* ---------------- countdown ---------------- */
  function todayNY() {
    try {
      var p = new Intl.DateTimeFormat('en-CA', { timeZone: CFG.tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).split('-');
      return Date.UTC(+p[0], +p[1] - 1, +p[2]);
    } catch (e) { var d = new Date(); return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()); }
  }
  function updateCountdown() {
    var dl = Date.UTC(CFG.mailDeadline[0], CFG.mailDeadline[1] - 1, CFG.mailDeadline[2]);
    var days = Math.round((dl - todayNY()) / 864e5);
    var b = $('[data-days]'), sr = $('[data-countdown-sr]');
    if (!b) return;
    var wrap = b.parentNode;
    if (days < 0) { wrap.hidden = true; if (sr) sr.textContent = 'The December 31, 2026 deadline has passed. Request a new mail ballot.'; return; }
    b.textContent = String(days);
    if (sr) sr.textContent = (lang === 'es' ? 'Quedan ' + days + ' días hasta el 31 de diciembre de 2026.' : days + (days === 1 ? ' day' : ' days') + ' left until December 31, 2026.');
  }

  /* ---------------- events: RSVP + calendar ---------------- */
  var EVENTS = {
    trivia: { title: 'Trivia night: Seminole edition (DEMO event)', short: 'trivia night in Lake Mary', when: 'Thu, Nov 19 at 7 pm', start: '20261120T000000Z', end: '20261120T020000Z', loc: 'Lake Mary, FL (demo venue)', desc: 'DEMO event on the Young Democrats of Seminole County prototype. Free. Teams of 4, or we will put you on one.', base: 23 },
    cleanup: { title: 'Riverwalk cleanup + coffee (DEMO event)', short: 'the Riverwalk cleanup in Sanford', when: 'Sat, Nov 21 at 9 am', start: '20261121T140000Z', end: '20261121T160000Z', loc: 'Sanford Riverwalk, Sanford, FL', desc: 'DEMO event on the Young Democrats of Seminole County prototype. Gloves and bags provided. Free.', base: 14 },
    semdems: { title: 'Seminole County Democrats monthly meeting', short: 'the SemDems monthly meeting', when: 'Thu, Nov 12 at 7 pm', start: '20261113T000000Z', end: '20261113T020000Z', loc: 'Altamonte Springs, FL', desc: 'Open to the public. Socializing from 6:30 pm. Listed on https://events.floridadems.org/org/seminole-county-democrats (checked Nov 9, 2026); confirm details and venue there.' }
  };
  var rsvp = store.get('rsvp', {});
  var RSVP_TOAST = {
    in: 'Seat saved (demo). Add it to your calendar so future you remembers.',
    maybe: 'Maybe it is. We\'ll keep a seat warm.',
    no: 'All good. Rest counts too. There\'s always the next one.',
    off: 'No worries. Your seat\'s open if you change your mind.'
  };
  function refreshRsvpLabels() {
    Object.keys(EVENTS).forEach(function (ev) {
      var st = rsvp[ev] || null;
      $$('[data-rsvp="' + ev + '"]').forEach(function (b) {
        b.setAttribute('aria-pressed', String(b.getAttribute('data-rsvp-val') === st));
        if (b.getAttribute('data-rsvp-val') === 'in') {
          var lab = $('[data-rsvp-label]', b) || b;
          var on = st === 'in';
          if (lab.hasAttribute('data-i18n')) { lab.textContent = on ? (lang === 'es' ? 'Vas ✓' : 'You\'re in ✓') : (lang === 'es' && ES[lab.getAttribute('data-i18n')] ? ES[lab.getAttribute('data-i18n')] : lab.dataset.en || 'I\'m in'); }
          else lab.textContent = on ? 'You\'re in ✓' : 'I\'m in';
        }
      });
      $$('[data-going="' + ev + '"]').forEach(function (g) { g.textContent = String((EVENTS[ev].base || 0) + (st === 'in' ? 1 : 0)); });
    });
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-rsvp]'); if (!b) return;
    var ev = b.getAttribute('data-rsvp'), val = b.getAttribute('data-rsvp-val');
    var next = rsvp[ev] === val ? null : val;
    rsvp[ev] = next; store.set('rsvp', rsvp); refreshRsvpLabels();
    toast(RSVP_TOAST[next || 'off']);
    if (next === 'in') confetti(b);
  });
  function ics(ev) {
    var e = EVENTS[ev]; if (!e) return;
    var stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    var esc = function (s) { return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n'); };
    var body = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Young Democrats of Seminole County//youngsemdems concept A//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
      'BEGIN:VEVENT', 'UID:' + ev + '-' + e.start + '@youngsemdems', 'DTSTAMP:' + stamp, 'DTSTART:' + e.start, 'DTEND:' + e.end,
      'SUMMARY:' + esc(e.title), 'LOCATION:' + esc(e.loc), 'DESCRIPTION:' + esc(e.desc),
      'BEGIN:VALARM', 'TRIGGER:-PT3H', 'ACTION:DISPLAY', 'DESCRIPTION:' + esc(e.title), 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    var url = URL.createObjectURL(new Blob([body], { type: 'text/calendar;charset=utf-8' }));
    var a = document.createElement('a'); a.href = url; a.download = ev + '-young-dems.ics'; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    toast('Calendar file downloaded. Open it to add ' + e.short + '.');
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-ics]'); if (b) ics(b.getAttribute('data-ics'));
    var p = e.target.closest('[data-plusone]');
    if (p) {
      var ev = EVENTS[p.getAttribute('data-plusone')];
      var text = 'I\'m going to ' + ev.short + ', ' + ev.when + '. It\'s free. Come with? (demo event)';
      shareOrCopy({ title: ev.title, text: text, url: refUrl() }, p);
    }
  });

  /* ---------------- share helpers ---------------- */
  function refCode() {
    var name = ($('#mk-name') && $('#mk-name').value) || '';
    var letters = name.normalize ? name.normalize('NFD').replace(/[\u0300-\u036f]/g, '') : name;
    letters = letters.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5) || 'FRIEND';
    var sfx = store.get('sfx', '');
    if (!sfx) { for (var i = 0; i < 3; i++) sfx += CFG.refAlphabet[Math.floor(Math.random() * CFG.refAlphabet.length)]; store.set('sfx', sfx); }
    return letters + sfx;
  }
  function refUrl() { return CFG.siteUrl + '?ref=' + refCode() + '&s=share'; }
  function shareOrCopy(data, btn) {
    if (navigator.share) {
      navigator.share(data).then(function () { toast('Sent. That\'s how it starts.'); confetti(btn); }, function () {});
      return;
    }
    copyText(data.text + (data.text.indexOf(data.url) === -1 ? ' ' + data.url : '')).then(function (ok) {
      toast(ok ? 'Copied. Paste it in the group chat.' : 'Couldn\'t copy automatically. Long-press the link to copy it.');
      if (ok) confetti(btn);
    });
  }

  /* ---------------- invite card maker (canvas) ---------------- */
  var form = $('[data-maker]'), canvas = $('#card'), ctx = canvas && canvas.getContext('2d');
  var textArea = $('#mk-text'), textDirty = false, stickerCache = {};
  var WAYS = {
    celery: { bg: '#C8F03C', fg: '#170B33', hi: '#6A2BFF', blob: '#FF7AC6', dot: 'rgba(23,11,51,.13)' },
    violet: { bg: '#6A2BFF', fg: '#FFF6EA', hi: '#C8F03C', blob: '#FF7AC6', dot: 'rgba(255,246,234,.18)' },
    pink: { bg: '#FF7AC6', fg: '#170B33', hi: '#6A2BFF', blob: '#C8F03C', dot: 'rgba(23,11,51,.13)' },
    tangerine: { bg: '#FF8B3D', fg: '#170B33', hi: '#6A2BFF', blob: '#4FD6FF', dot: 'rgba(23,11,51,.13)' },
    night: { bg: '#170B33', fg: '#FFF6EA', hi: '#C8F03C', blob: '#6A2BFF', dot: 'rgba(255,246,234,.14)' }
  };
  function tplData(tpl, name, city) {
    var N = (name || 'A friend').trim() || 'A friend';
    var es = lang === 'es';
    if (tpl === 'mail') return {
      kicker: (es ? 'AVISO DE ' + N + ' EN ' + city : 'PSA FROM ' + N + ' IN ' + city).toUpperCase(),
      head: es ? 'Tu solicitud de voto por correo vence el 31 de dic.' : 'Your mail ballot request runs out Dec 31.',
      d1: es ? 'Pídela otra vez para 2027 y 2028' : 'Request again for 2027 + 2028',
      d2: 'voteseminole.gov · 407-585-8683',
      text: es ? 'Aviso: toda solicitud de voto por correo en Florida vence el 31 de dic. Pídela otra vez para 2027 y 2028 en voteseminole.gov. Más aquí: ' : 'PSA: every Florida mail ballot request runs out Dec 31. Request again for 2027 and 2028 at voteseminole.gov. More here: '
    };
    if (tpl === 'join') return {
      kicker: (es ? N + ' EN ' + city + ' TE QUIERE AQUÍ' : N + ' IN ' + city + ' WANTS YOU IN').toUpperCase(),
      head: es ? 'Entra al chat del grupo.' : 'Get in the group chat.',
      d1: es ? 'Jóvenes Demócratas de Seminole' : 'Young Dems of Seminole County',
      d2: es ? '14 a 39 años · Ven como eres' : 'Ages 14 to 39 · Come as you are',
      text: es ? 'Me estoy uniendo a los Jóvenes Demócratas del Condado de Seminole. ¿Vienes conmigo a la próxima? ' : 'I\'m getting into the Young Dems of Seminole County. Come to the next one with me? '
    };
    return {
      kicker: (es ? N + ' DE ' + city + ' DICE:' : N + ' FROM ' + city + ' SAYS:').toUpperCase(),
      head: es ? '¿Noche de trivia? Ven conmigo.' : 'Trivia night? Come with me.',
      d1: es ? 'jue 19 de nov · 7 pm · Lake Mary' : 'Thu, Nov 19 · 7 pm · Lake Mary',
      d2: es ? 'Gratis · Equipos de 4 · Evento demo' : 'Free · Teams of 4 · Demo event',
      text: es ? 'Trivia en Lake Mary, jue 19 de nov a las 7 pm. Es gratis y no quiero ser la única persona nueva. ¿Vienes? (evento demo) ' : 'Trivia in Lake Mary, Thu Nov 19 at 7 pm. It\'s free and I don\'t want to be the only new person. Come with? (demo event) '
    };
  }
  function val(name) { var el = form && form.querySelector('[name="' + name + '"]:checked') || (form && form.querySelector('[name="' + name + '"]')); return el ? el.value : ''; }
  function stickerImg(name, cb) {
    if (stickerCache[name]) { if (stickerCache[name].complete) cb(stickerCache[name]); else stickerCache[name].addEventListener('load', function () { cb(stickerCache[name]); }); return; }
    var sym = document.getElementById('stk-' + name); if (!sym) return;
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + sym.getAttribute('viewBox') + '" width="600" height="600"><defs><clipPath id="clip-disc"><circle cx="60" cy="60" r="54"/></clipPath></defs>' + sym.innerHTML + '</svg>';
    var img = new Image(); img.onload = function () { cb(img); };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    stickerCache[name] = img;
  }
  function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
  function wrap(c, text, maxW) {
    var words = text.split(/\s+/), lines = [], line = '';
    words.forEach(function (w) { var t = line ? line + ' ' + w : w; if (c.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t; });
    if (line) lines.push(line); return lines;
  }
  function setDisplayFont(c, size) {
    if ('fontStretch' in c) c.fontStretch = 'condensed';
    c.font = '800 ' + size + 'px "Bricolage Grotesque", "Arial Narrow", sans-serif';
    if ('fontStretch' in c) c.fontStretch = 'condensed';
  }
  function renderMaker(resetText) {
    if (!ctx) return;
    var tpl = val('tpl') || 'trivia', way = WAYS[val('color')] || WAYS.celery, stk = val('stk') || 'celery';
    var name = ($('#mk-name').value || '').trim(), city = $('#mk-city').value;
    var d = tplData(tpl, name, city), code = refCode();
    var W = 1080, H = 1350, c = ctx;
    c.save();
    c.clearRect(0, 0, W, H);
    c.fillStyle = way.bg; c.fillRect(0, 0, W, H);
    // dot grid
    c.fillStyle = way.dot;
    for (var y = 30; y < H; y += 44) for (var x = 30; x < W; x += 44) { c.beginPath(); c.arc(x, y, 3.2, 0, Math.PI * 2); c.fill(); }
    // blobs
    c.fillStyle = way.blob; c.beginPath(); c.arc(W - 90, 150, 250, 0, Math.PI * 2); c.fill();
    c.strokeStyle = way.fg; c.lineWidth = 8; c.beginPath(); c.arc(W - 90, 150, 250, 0, Math.PI * 2); c.stroke();
    // top chip
    c.font = '800 34px "Atkinson Hyperlegible Next", system-ui, sans-serif';
    var chip = 'YOUNG DEMS · SEMINOLE COUNTY'; c.letterSpacing = '3px';
    var cw = c.measureText(chip).width + 64;
    c.fillStyle = way.fg; rr(c, 72, 72, cw, 74, 37); c.fill();
    c.fillStyle = way.bg; c.textBaseline = 'middle'; c.fillText(chip, 104, 110);
    c.letterSpacing = '0px';
    // DEMO chip
    c.save(); c.translate(W - 210, 300); c.rotate(-0.12);
    c.fillStyle = '#FF8B3D'; rr(c, -10, -40, 190, 80, 40); c.fill(); c.strokeStyle = '#170B33'; c.lineWidth = 6; c.stroke();
    c.fillStyle = '#170B33'; c.font = '800 40px "Atkinson Hyperlegible Next", system-ui, sans-serif'; c.textAlign = 'center'; c.fillText('DEMO', 85, 2); c.restore();
    c.textAlign = 'left';
    // kicker
    c.fillStyle = way.fg; c.font = '800 38px "Atkinson Hyperlegible Next", system-ui, sans-serif'; c.letterSpacing = '2px';
    var kLines = wrap(c, d.kicker, 760);
    kLines.slice(0, 2).forEach(function (l, i) { c.fillText(l, 72, 300 + i * 48); });
    c.letterSpacing = '0px';
    // headline: auto-fit
    var size = 176, lines, maxW = W - 144, top = 300 + Math.min(kLines.length, 2) * 48 + 40;
    for (; size > 90; size -= 6) { setDisplayFont(c, size); lines = wrap(c, d.head, maxW); if (lines.length * size * .9 <= 560 && lines.length <= 5) break; }
    c.textBaseline = 'alphabetic';
    lines.forEach(function (l, i) {
      c.fillStyle = i === lines.length - 1 ? way.hi : way.fg;
      if (i === lines.length - 1 && way.bg === '#C8F03C') c.fillStyle = '#6A2BFF';
      c.fillText(l, 72, top + size * .84 + i * size * .9);
    });
    // ticket box
    var by = 1000, bh = 200;
    c.fillStyle = '#FFF6EA'; rr(c, 72, by, W - 144, bh, 34); c.fill();
    c.strokeStyle = '#170B33'; c.lineWidth = 7; c.stroke();
    c.fillStyle = '#170B33'; c.font = '800 48px "Atkinson Hyperlegible Next", system-ui, sans-serif'; c.textBaseline = 'middle';
    c.fillText(d.d1, 112, by + 70);
    c.font = '600 36px "Atkinson Hyperlegible Next", system-ui, sans-serif'; c.fillText(d.d2, 112, by + 135);
    // footer url + disclaimer
    c.fillStyle = way.fg; c.font = '800 34px ui-monospace, Menlo, monospace'; c.fillText(CFG.siteLabel + '/?ref=' + code, 72, 1262);
    c.globalAlpha = .82; c.font = '600 24px "Atkinson Hyperlegible Next", system-ui, sans-serif'; c.fillText(CFG.disclaimer, 72, 1306); c.globalAlpha = 1;
    c.restore();
    // sticker (async)
    stickerImg(stk, function (img) {
      if ((val('stk') || 'celery') !== stk) return;
      c.save(); c.translate(W - 210, 860); c.rotate(0.2);
      c.shadowColor = 'rgba(23,11,51,.35)'; c.shadowBlur = 24; c.shadowOffsetY = 12;
      c.fillStyle = '#fff'; c.beginPath(); c.arc(0, 0, 168, 0, Math.PI * 2); c.fill();
      c.shadowColor = 'transparent'; c.drawImage(img, -156, -156, 312, 312); c.restore();
    });
    // text + links
    if (resetText || !textDirty) { textArea.value = d.text + refUrl(); textDirty = false; }
    $('[data-reflink]').textContent = CFG.siteLabel + '/?ref=' + code;
    updateShareLinks();
  }
  function updateShareLinks() {
    var t = textArea.value;
    var sms = $('[data-sms]'), wa = $('[data-wa]');
    if (sms) sms.href = 'sms:?&body=' + encodeURIComponent(t);
    if (wa) wa.href = 'https://wa.me/?text=' + encodeURIComponent(t);
  }
  if (form) {
    form.addEventListener('change', function (e) { renderMaker(e.target.name === 'tpl'); });
    $('#mk-name').addEventListener('input', function () { renderMaker(false); });
    textArea.addEventListener('input', function () { textDirty = true; updateShareLinks(); });
    $('[data-copy]').addEventListener('click', function (e) {
      copyText(refUrl()).then(function (ok) { toast(ok ? 'Link copied. Friends who join with it land in your squad.' : 'Couldn\'t copy. Long-press the link instead.'); if (ok) confetti(e.target); });
    });
    $('[data-save]').addEventListener('click', function (e) {
      canvas.toBlob(function (blob) {
        if (!blob) return;
        var url = URL.createObjectURL(blob), a = document.createElement('a');
        a.href = url; a.download = 'young-dems-' + (val('tpl') || 'card') + '.png'; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
        toast('Saved. Post it to your story or drop it in the chat.'); confetti(e.target);
      }, 'image/png');
    });
    $('[data-share]').addEventListener('click', function (e) {
      var btn = e.currentTarget, text = textArea.value;
      canvas.toBlob(function (blob) {
        var file = blob && window.File ? new File([blob], 'young-dems-invite.png', { type: 'image/png' }) : null;
        if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
          navigator.share({ files: [file], text: text }).then(function () { toast('Sent. That\'s how it starts.'); confetti(btn); }, function () {});
        } else shareOrCopy({ title: 'Young Dems of Seminole County', text: text, url: refUrl() }, btn);
      }, 'image/png');
    });
  }

  /* ---------------- reel ---------------- */
  function stopOthers(except) { $$('.clip video').forEach(function (v) { if (v !== except && !v.paused) { v.pause(); v.closest('.clip').classList.remove('is-playing'); } }); }
  function toggleClip(clip) {
    var v = $('video', clip), btn = $('[data-play]', clip); if (!v) return;
    if (v.paused) {
      stopOthers(v); var p = v.play(); clip.classList.add('is-playing');
      btn.setAttribute('aria-label', btn.getAttribute('aria-label').replace('Play', 'Pause'));
      if (p && p.catch) p.catch(function () { clip.classList.remove('is-playing'); });
    } else {
      v.pause(); clip.classList.remove('is-playing');
      btn.setAttribute('aria-label', btn.getAttribute('aria-label').replace('Pause', 'Play'));
    }
  }
  $$('.clip').forEach(function (clip) {
    var b = $('[data-play]', clip), v = $('video', clip);
    if (b) b.addEventListener('click', function () { toggleClip(clip); });
    if (v) v.addEventListener('click', function () { toggleClip(clip); });
  });
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (ents) { ents.forEach(function (en) { if (!en.isIntersecting) { var v = en.target; if (!v.paused) { v.pause(); v.closest('.clip').classList.remove('is-playing'); } } }); }, { threshold: .2 });
    $$('.clip video').forEach(function (v) { io.observe(v); });
  }

  /* lazy video posters: assign when the reel nears the viewport */
  var posterVids = $$('video[data-poster]');
  function setPoster(v) { if (!v.poster) v.poster = v.getAttribute('data-poster'); }
  if ('IntersectionObserver' in window) {
    var pio = new IntersectionObserver(function (ents) { ents.forEach(function (en) { if (en.isIntersecting) { setPoster(en.target); pio.unobserve(en.target); } }); }, { rootMargin: '600px 600px' });
    posterVids.forEach(function (v) { pio.observe(v); });
  } else posterVids.forEach(setPoster);

  /* ---------------- post-a-clip dialog ---------------- */
  var dlg = $('#post-dialog'), lastFocus;
  $$('[data-open-post]').forEach(function (b) {
    b.addEventListener('click', function () {
      lastFocus = b;
      if (dlg && dlg.showModal) dlg.showModal(); else toast('Your browser can\'t open the clip form here. Try another browser.');
    });
  });
  if (dlg) {
    $('[data-close]', dlg).addEventListener('click', function () { dlg.close(); });
    dlg.addEventListener('close', function () { lastFocus && lastFocus.focus(); });
    dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); });
    $('[data-post]', dlg).addEventListener('submit', function (e) {
      e.preventDefault();
      var f = e.target, msg = $('[data-post-msg]', dlg);
      var link = f.link.value.trim(), file = f.file.files && f.file.files[0];
      msg.className = 'form-msg is-error';
      if (!link && !file) { msg.textContent = 'Add a link or pick a video file, then send it.'; f.link.focus(); return; }
      if (link && !/^https:\/\/(www\.|m\.|vm\.)?(tiktok\.com|instagram\.com|youtube\.com|youtu\.be)\//i.test(link)) { msg.textContent = 'That link doesn\'t look like TikTok, Instagram or YouTube. Check it and try once more?'; f.link.focus(); return; }
      if (file && file.size > 157286400) { msg.textContent = 'That file is over 150 MB. Trim it a little and try again.'; return; }
      if (!f.c1.checked || !f.c2.checked || !f.c3.checked) { msg.textContent = 'Tick all three boxes so we can post it safely.'; return; }
      msg.className = 'form-msg is-ok';
      msg.textContent = 'Got it. On the real site, a person on our team watches it before it goes live. (Demo: nothing was uploaded.)';
      confetti($('[type=submit]', f)); f.reset();
      setTimeout(function () { if (dlg.open) dlg.close(); toast('Clip sent for review (demo).'); }, 2600);
    });
  }

  /* ---------------- join form ---------------- */
  var ISSUE = { rent: 'rent & housing', bills: 'wages & bills', abortion: 'abortion access', lgbtq: 'LGBTQ+ safety', transit: 'transit', water: 'clean water', voting: 'voting rights', schools: 'schools & books' };
  function picked() { return $$('[data-issues] [aria-pressed="true"]').map(function (b) { return ISSUE[b.getAttribute('data-issue')]; }); }
  $$('[data-issues] button').forEach(function (b) {
    b.addEventListener('click', function () {
      b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true'));
      var p = picked(), echo = $('[data-issue-echo]');
      echo.textContent = !p.length ? '' : p.length === 1 ? 'Got it: ' + p[0] + ' first.' : 'Got it: ' + p.slice(0, 2).join(', ') + (p.length > 2 ? ' and more.' : '.');
    });
  });
  var join = $('[data-join]');
  join && join.addEventListener('submit', function (e) {
    e.preventDefault();
    var msg = $('[data-join-msg]'), name = join.name.value.trim(), contact = join.contact.value.trim();
    msg.className = 'form-msg is-error';
    if (!name) { msg.textContent = 'What should we call you? We need a name for the name tag.'; join.name.focus(); return; }
    var digits = contact.replace(/\D/g, '');
    var isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact), isPhone = /^[\d\s().+-]+$/.test(contact) && (digits.length === 10 || (digits.length === 11 && digits[0] === '1'));
    if (!isEmail && !isPhone) {
      msg.textContent = /[a-z]/i.test(contact) && contact.indexOf('@') === -1 ? 'That email\'s missing an @. Happens to everyone. Try once more?' : 'Add an email or a 10-digit mobile number so we can reach you.';
      join.contact.focus(); return;
    }
    var p = picked(), safe = name.replace(/[<>&"]/g, '');
    join.innerHTML = '<div class="success-card"><span class="tag tag--demo">DEMO: saved in this browser only</span><h3 tabindex="-1">You\'re in, ' + safe + '.</h3>' +
      '<p>Your first letter lands Thursday. Go drink some water.</p>' +
      (p.length ? '<p>We\'ll lead with <b>' + p.join(', ').replace(/&/g, '&amp;') + '</b> for you.</p>' : '') +
      '<div class="hero__ctas" style="margin-top:.4rem"><a class="btn btn--violet" href="#invite">Make your invite card</a><a class="btn btn--ghost-ink" href="#events">See what\'s on</a></div></div>';
    var h = $('h3', join); h && h.focus();
    if ($('#mk-name') && !$('#mk-name').dataset.touched) { $('#mk-name').value = safe.slice(0, 16); renderMaker(false); }
    confetti(h);
  });
  $('#mk-name') && $('#mk-name').addEventListener('input', function () { this.dataset.touched = '1'; });

  /* ---------------- letter form ---------------- */
  var letter = $('[data-letter]');
  letter && letter.addEventListener('submit', function (e) {
    e.preventDefault();
    var msg = $('[data-letter-msg]'), v = letter.email.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) { msg.className = 'form-msg is-error'; msg.textContent = v && v.indexOf('@') === -1 ? 'That email\'s missing an @. Happens to everyone. Try once more?' : 'Add your email and we\'ll send Thursdays your way.'; letter.email.focus(); return; }
    msg.className = 'form-msg is-ok'; msg.textContent = 'You\'re in. Your first letter lands Thursday. Go drink some water. (Demo: nothing was sent.)';
    letter.reset(); confetti(msg);
  });

  /* ---------------- sticker facts ---------------- */
  var FACTS = {
    celery: 'Sanford was the Celery City: celery farming made its name around 1900.',
    gator: 'Lake Jesup, Seminole\'s biggest lake, has one of Florida\'s densest alligator populations.',
    sun: 'Florida\'s minimum wage hit $15 an hour on Sept 30, 2026. From Sept 30, 2027 it rises with inflation.',
    train: 'SunRail stops four times in Seminole: Altamonte Springs, Longwood, Lake Mary and Sanford.',
    chicken: 'Oviedo\'s free-roaming downtown chickens are local legend. These days it\'s mostly nostalgia.',
    heart: 'Come as you are: LGBTQ+, disabled, Spanish-speaking, first-timers, the not-yet-sure. All of you.',
    mail: 'One Florida mail ballot request lasts through the end of the next general election year. That\'s why yours ends Dec 31.'
  };
  $$('[data-fact]').forEach(function (s) {
    s.addEventListener('click', function () {
      s.classList.remove('is-wiggle'); void s.offsetWidth; s.classList.add('is-wiggle');
      toast(FACTS[s.getAttribute('data-fact')]);
    });
  });

  /* ---------------- boot ---------------- */
  var startLang = store.get('lang', 'en');
  updateCountdown();
  refreshRsvpLabels();
  // The Google Fonts stylesheet loads non-blocking (media=print swap), so wait for it before asking for faces.
  var gf = document.getElementById('gf');
  var cssReady = new Promise(function (res) {
    if (!gf || gf.media === 'all' || gf.sheet && gf.media !== 'print') return res();
    gf.addEventListener('load', function () { setTimeout(res, 0); }); gf.addEventListener('error', res);
  });
  var fontsReady = (document.fonts && document.fonts.load) ? cssReady.then(function () {
    return Promise.all([
      document.fonts.load('800 100px "Bricolage Grotesque"'),
      document.fonts.load('800 40px "Atkinson Hyperlegible Next"'),
      document.fonts.load('600 36px "Atkinson Hyperlegible Next"'),
      document.fonts.load('400 17px "Atkinson Hyperlegible Next"'),
      document.fonts.load('700 17px "Atkinson Hyperlegible Next"'),
      document.fonts.load('400 30px "Caveat Brush"')
    ]);
  }).then(function () { return document.fonts.ready; }).catch(function () {}) : Promise.resolve();
  var booted = false;
  function boot() {
    if (booted) return; booted = true;
    root.classList.add('ready');
    if (store.get('paused', false)) setPaused(true);
    playChat(); startRotor();
    // Draw the invite card only when its section is near (keeps boot work off the main thread)
    var makerSec = document.getElementById('invite'), drawn = false;
    function drawOnce() { if (drawn) return; drawn = true; if (startLang === 'es') applyLang('es'); else renderMaker(true); }
    if (startLang === 'es' || !makerSec || !('IntersectionObserver' in window)) drawOnce();
    else {
      var mio = new IntersectionObserver(function (ents) { if (ents.some(function (e) { return e.isIntersecting; })) { mio.disconnect(); drawOnce(); } }, { rootMargin: '900px 0px' });
      mio.observe(makerSec);
    }
  }
  fontsReady.then(boot); setTimeout(boot, 1500);
})();
