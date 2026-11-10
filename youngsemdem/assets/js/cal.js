/*!
 * Young Seminole Democrats: add-to-calendar.  YSD.cal
 *
 *   text(event | [events], opts)  RFC 5545 iCalendar text (CRLF, escaped, folded at 75 octets)
 *   ics(event | [events], opts)   Blob (text/calendar;charset=utf-8), or null without Blob support
 *   dataUrl(event)                data: URL of the same text (for a plain <a download> link)
 *   download(event, filename)     saves <title>.ics; returns true/false
 *   google(event)                 Google Calendar "create event" URL
 *   outlook(event, {office})      Outlook.com URL ({office:true}: Microsoft 365 work/school accounts)
 *   links(event)                  { google, outlook, office365, ics (data URL) }
 *
 * event = {
 *   id,           stable id; becomes the UID (<id>@<domain>) so re-adding updates, not duplicates
 *   title,        SUMMARY
 *   start, end,   ISO 8601 with offset, e.g. '2026-11-14T10:00:00-05:00' (also 'Z', or no offset =
 *                 America/New_York wall time, or a Date / epoch ms). 'YYYY-MM-DD' = all-day; for
 *                 all-day events `end` is the LAST day (inclusive). No end = start + cal.defaultDurationMin.
 *   location,     venue name;  address: street address (both go into LOCATION)
 *   description,  plain text; url is appended to it and also written as URL
 *   url,
 *   alarm,        optional minutes-before reminder (VALARM)
 *   status,       optional 'confirmed' | 'tentative' | 'cancelled';  sequence: optional integer
 * }
 * Times are written as DTSTART;TZID=America/New_York with a matching VTIMEZONE (US rules since
 * 2007: EDT from the 2nd Sunday of March, EST from the 1st Sunday of November). Load order: after
 * config.js; nothing else required.
 */
(function (w) {
  'use strict';
  var YSD = w.YSD = w.YSD || {};
  function cfg(p, fb) { return typeof YSD.cfg === 'function' ? YSD.cfg(p, fb) : fb; }
  function emit(n, d) { if (typeof YSD.emit === 'function') YSD.emit(n, d); }
  function track(e, p) { try { if (typeof YSD.track === 'function') YSD.track(e, p); } catch (x) {} }
  function log() { if (typeof YSD.log === 'function') YSD.log.apply(null, arguments); }

  var TZID = 'America/New_York';
  var CRLF = '\r\n';
  var MIN = 60000, DAY = 86400000;

  function pad(n, l) { n = String(n); while (n.length < (l || 2)) n = '0' + n; return n; }

  // -------------------------------------------------------------- America/New_York offset
  function nthSunday(year, month, n) {
    var dow = new Date(Date.UTC(year, month, 1)).getUTCDay();
    return 1 + ((7 - dow) % 7) + (n - 1) * 7;
  }
  /** UTC offset in minutes (-240 EDT, -300 EST) for a UTC instant, US rules since 2007. */
  function nyOffset(ms) {
    var y = new Date(ms).getUTCFullYear();
    var start = Date.UTC(y, 2, nthSunday(y, 2, 2), 7);   // 2:00 EST = 07:00 UTC
    var end = Date.UTC(y, 10, nthSunday(y, 10, 1), 6);   // 2:00 EDT = 06:00 UTC
    return ms >= start && ms < end ? -240 : -300;
  }
  /** Parse a time value. Returns {ms} for instants or {allDay:true, y, m, d}; null when invalid. */
  function parseWhen(v) {
    if (v instanceof Date) return isNaN(v.getTime()) ? null : { ms: v.getTime() };
    if (typeof v === 'number') return isFinite(v) ? { ms: v } : null;
    var s = String(v == null ? '' : v).replace(/^\s+|\s+$/g, '');
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (m) return { allDay: true, y: +m[1], m: +m[2], d: +m[3] };
    m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i.exec(s);
    if (!m) return null;
    var wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
    if (isNaN(wall)) return null;
    if (m[7]) {
      if (/^z$/i.test(m[7])) return { ms: wall };
      var sign = m[7].charAt(0) === '-' ? -1 : 1, hm = m[7].slice(1).replace(':', '');
      return { ms: wall - sign * (+hm.slice(0, 2) * 60 + +hm.slice(2, 4)) * MIN };
    }
    // No offset: New York wall-clock time.
    var ms = wall + 300 * MIN, off = nyOffset(ms);
    ms = wall - off * MIN;
    if (nyOffset(ms) !== off) ms = wall - nyOffset(ms) * MIN;
    return { ms: ms };
  }
  function nyParts(ms) {
    var d = new Date(ms + nyOffset(ms) * MIN);
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds() };
  }
  function fmtLocal(ms) {
    var p = nyParts(ms);
    return pad(p.y, 4) + pad(p.m) + pad(p.d) + 'T' + pad(p.h) + pad(p.mi) + pad(p.s);
  }
  function fmtUtc(ms) {
    var d = new Date(ms);
    return pad(d.getUTCFullYear(), 4) + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + 'T' +
      pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + 'Z';
  }
  function isoUtc(ms) { return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z'); }
  function ymd(y, m, d) { return pad(y, 4) + pad(m) + pad(d); }
  function dayAdd(p, n) {
    var t = new Date(Date.UTC(p.y, p.m - 1, p.d) + n * DAY);
    return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
  }

  /** Normalise an event; throws TypeError when start is missing or invalid. */
  function norm(ev) {
    ev = ev || {};
    var st = parseWhen(ev.start);
    if (!st) throw new TypeError('YSD.cal: event.start is missing or not ISO 8601: ' + ev.start);
    var en = ev.end != null && ev.end !== '' ? parseWhen(ev.end) : null;
    var out = {
      id: ev.id != null ? String(ev.id) : '',
      title: String(ev.title || ''),
      location: [ev.location, ev.address].filter(function (x) { return x; }).join(', '),
      description: String(ev.description || ''),
      url: String(ev.url || ''),
      alarm: +ev.alarm > 0 ? Math.round(+ev.alarm) : 0,
      status: String(ev.status || '').toUpperCase(),
      sequence: Math.max(0, parseInt(ev.sequence, 10) || 0),
      allDay: !!st.allDay
    };
    if (st.allDay) {
      out.startDay = { y: st.y, m: st.m, d: st.d };
      var last = en && en.allDay ? { y: en.y, m: en.m, d: en.d } : out.startDay;
      out.endDayExcl = dayAdd(last, 1);
      if (ymd(out.endDayExcl.y, out.endDayExcl.m, out.endDayExcl.d) <= ymd(st.y, st.m, st.d)) out.endDayExcl = dayAdd(out.startDay, 1);
    } else {
      out.start = st.ms;
      out.end = en && !en.allDay && en.ms > st.ms ? en.ms : st.ms + (+cfg('cal.defaultDurationMin', 120) || 120) * MIN;
    }
    out.details = out.description + (out.url ? (out.description ? '\n\n' : '') + out.url : '');
    return out;
  }

  // -------------------------------------------------------------- RFC 5545 text helpers
  /** TEXT value escaping (RFC 5545 3.3.11): backslash, semicolon, comma, newline. */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/\\/g, '\\\\')
      .replace(/\r\n|\r|\n/g, '\\n')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,');
  }
  function utf8Len(cp) { return cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4; }
  /** Fold a content line to at most 75 octets per physical line (RFC 5545 3.1), never splitting a UTF-8 sequence. */
  function fold(line) {
    var out = [], cur = '', len = 0;
    for (var i = 0; i < line.length; i++) {
      var c = line.charCodeAt(i), ch = line.charAt(i);
      if (c >= 0xd800 && c <= 0xdbff && i + 1 < line.length) {
        var c2 = line.charCodeAt(i + 1);
        if (c2 >= 0xdc00 && c2 <= 0xdfff) { ch = line.slice(i, i + 2); c = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00); i++; }
      }
      var b = utf8Len(c);
      if (len + b > 75) { out.push(cur); cur = ' '; len = 1; }
      cur += ch; len += b;
    }
    out.push(cur);
    return out.join(CRLF);
  }
  function uriValue(s) { return String(s || '').replace(/[\r\n]+/g, ''); }
  function hash(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 16777619) >>> 0; }
    return h.toString(36);
  }
  function uidDomain() {
    var site = String(cfg('site.url', '') || '');
    var m = /^[a-z]+:\/\/([^\/:?#]+)/i.exec(site);
    if (m) return m[1];
    var d = String(cfg('site.uidDomain', '') || '');
    if (d) return d;
    try { if (w.location && w.location.hostname) return w.location.hostname; } catch (e) {}
    return 'youngsemdem';
  }

  var VTIMEZONE = [
    'BEGIN:VTIMEZONE',
    'TZID:' + TZID,
    'X-LIC-LOCATION:' + TZID,
    'BEGIN:DAYLIGHT',
    'TZOFFSETFROM:-0500',
    'TZOFFSETTO:-0400',
    'TZNAME:EDT',
    'DTSTART:19700308T020000',
    'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU',
    'END:DAYLIGHT',
    'BEGIN:STANDARD',
    'TZOFFSETFROM:-0400',
    'TZOFFSETTO:-0500',
    'TZNAME:EST',
    'DTSTART:19701101T020000',
    'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU',
    'END:STANDARD',
    'END:VTIMEZONE'
  ];

  function veventLines(ev, stamp) {
    var e = norm(ev);
    var uid = (e.id ? e.id.replace(/[\s@]+/g, '-') : 'ev-' + hash(e.title + '|' + (e.start || ymd(e.startDay.y, e.startDay.m, e.startDay.d)))) + '@' + uidDomain();
    var L = ['BEGIN:VEVENT', 'UID:' + uid, 'DTSTAMP:' + stamp];
    if (e.allDay) {
      L.push('DTSTART;VALUE=DATE:' + ymd(e.startDay.y, e.startDay.m, e.startDay.d));
      L.push('DTEND;VALUE=DATE:' + ymd(e.endDayExcl.y, e.endDayExcl.m, e.endDayExcl.d));
    } else {
      L.push('DTSTART;TZID=' + TZID + ':' + fmtLocal(e.start));
      L.push('DTEND;TZID=' + TZID + ':' + fmtLocal(e.end));
    }
    L.push('SUMMARY:' + esc(e.title));
    if (e.location) L.push('LOCATION:' + esc(e.location));
    if (e.details) L.push('DESCRIPTION:' + esc(e.details));
    if (e.url) L.push('URL:' + uriValue(e.url));
    L.push('STATUS:' + (/^(TENTATIVE|CANCELLED)$/.test(e.status) ? e.status : 'CONFIRMED'));
    L.push('SEQUENCE:' + e.sequence);
    L.push('TRANSP:' + (e.allDay ? 'TRANSPARENT' : 'OPAQUE'));
    if (e.alarm) {
      L.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + esc(e.title || 'Reminder'), 'TRIGGER:-PT' + e.alarm + 'M', 'END:VALARM');
    }
    L.push('END:VEVENT');
    return { lines: L, allDay: e.allDay };
  }

  /** iCalendar text for one event or an array of events. opts = { name, method }. */
  function text(events, opts) {
    opts = opts || {};
    var list = Array.isArray(events) ? events : [events];
    if (!list.length) throw new TypeError('YSD.cal: no events');
    var stamp = fmtUtc(opts.now != null ? +opts.now : Date.now());
    var bodies = [], needTz = false;
    for (var i = 0; i < list.length; i++) {
      var v = veventLines(list[i], stamp);
      if (!v.allDay) needTz = true;
      bodies = bodies.concat(v.lines);
    }
    var L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:' + cfg('cal.prodId', '-//Young Seminole Democrats//youngsemdem site//EN'),
      'CALSCALE:GREGORIAN', 'METHOD:' + (opts.method || 'PUBLISH')];
    var name = opts.name || (list.length > 1 ? cfg('cal.name', '') : '');
    if (name) L.push('X-WR-CALNAME:' + esc(name));
    if (needTz) { L.push('X-WR-TIMEZONE:' + TZID); L = L.concat(VTIMEZONE); }
    L = L.concat(bodies);
    L.push('END:VCALENDAR');
    var out = '';
    for (var j = 0; j < L.length; j++) out += fold(L[j]) + CRLF;
    return out;
  }

  /** Blob of the .ics text, or null when Blob is unavailable. Throws TypeError on an invalid start. */
  function ics(events, opts) {
    var t = text(events, opts);
    try { return new w.Blob([t], { type: 'text/calendar;charset=utf-8' }); } catch (e) { return null; }
  }
  function dataUrl(events, opts) {
    try { return 'data:text/calendar;charset=utf-8,' + encodeURIComponent(text(events, opts)); } catch (e) { log('cal.dataUrl', e); return ''; }
  }
  function slug(s) {
    return String(s || 'event').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'event';
  }

  /** Save the event as an .ics file. Returns true when a download was started. */
  function download(ev, filename) {
    var first = Array.isArray(ev) ? ev[0] : ev;
    try {
      var blob = ics(ev);
      var d = w.document;
      if (!d || !d.body) return false;
      var name = filename || slug(first && first.title) + '.ics';
      var a = d.createElement('a');
      var href = '';
      var URLo = w.URL || w.webkitURL;
      if (blob && URLo && typeof URLo.createObjectURL === 'function') href = URLo.createObjectURL(blob);
      else href = dataUrl(ev);
      a.href = href;
      a.download = name;
      a.rel = 'noopener';
      a.style.display = 'none';
      d.body.appendChild(a);
      a.click();
      d.body.removeChild(a);
      if (href.indexOf('blob:') === 0) setTimeout(function () { try { URLo.revokeObjectURL(href); } catch (e) {} }, 60000);
      emit('calendar', { method: 'ics', event: first || null });
      track('calendar_add', { method: 'ics', id: first && first.id ? String(first.id) : '' });
      return true;
    } catch (e) {
      log('cal.download failed', e);
      emit('calendar-error', { error: String(e && e.message || e) });
      return false;
    }
  }

  /** Google Calendar template URL ('' when the event is invalid). */
  function google(ev) {
    var e;
    try { e = norm(ev); } catch (x) { log(x); return ''; }
    var dates = e.allDay
      ? ymd(e.startDay.y, e.startDay.m, e.startDay.d) + '/' + ymd(e.endDayExcl.y, e.endDayExcl.m, e.endDayExcl.d)
      : fmtUtc(e.start) + '/' + fmtUtc(e.end);
    var q = 'action=TEMPLATE&text=' + encodeURIComponent(e.title) + '&dates=' + dates;
    if (e.details) q += '&details=' + encodeURIComponent(e.details);
    if (e.location) q += '&location=' + encodeURIComponent(e.location);
    q += '&ctz=' + encodeURIComponent(TZID);
    return 'https://calendar.google.com/calendar/render?' + q;
  }

  /**
   * Outlook web "add event" deeplink ('' when invalid). Times are sent in UTC (startdt/enddt).
   * opts.office true -> outlook.office.com (work/school), else outlook.live.com (personal).
   * Microsoft does not document these parameters; they are the widely used community format.
   */
  function outlook(ev, opts) {
    var e;
    try { e = norm(ev); } catch (x) { log(x); return ''; }
    var host = opts && opts.office ? 'https://outlook.office.com' : 'https://outlook.live.com';
    var s, en;
    if (e.allDay) {
      s = pad(e.startDay.y, 4) + '-' + pad(e.startDay.m) + '-' + pad(e.startDay.d);
      en = pad(e.endDayExcl.y, 4) + '-' + pad(e.endDayExcl.m) + '-' + pad(e.endDayExcl.d);
    } else { s = isoUtc(e.start); en = isoUtc(e.end); }
    var q = 'path=/calendar/action/compose&rru=addevent' +
      '&subject=' + encodeURIComponent(e.title) +
      '&startdt=' + encodeURIComponent(s) + '&enddt=' + encodeURIComponent(en) +
      (e.allDay ? '&allday=true' : '');
    if (e.details) q += '&body=' + encodeURIComponent(e.details);
    if (e.location) q += '&location=' + encodeURIComponent(e.location);
    return host + '/calendar/0/deeplink/compose?' + q;
  }

  function links(ev) {
    return { google: google(ev), outlook: outlook(ev), office365: outlook(ev, { office: true }), ics: dataUrl(ev) };
  }

  YSD.cal = {
    TZID: TZID,
    text: text,
    ics: ics,
    dataUrl: dataUrl,
    download: download,
    google: google,
    outlook: outlook,
    links: links,
    // exposed for tests and for pages that format times
    _nyOffset: nyOffset,
    _parse: parseWhen,
    _fold: fold,
    _escape: esc
  };
})(typeof window !== 'undefined' ? window : this);
