/*!
 * Young Democrats of Seminole County (YDSC; site handle youngsemdems): site configuration.
 *
 * Every swappable value lives here. Pages load this file FIRST, then assets/js/store.js, then the
 * rest. To override values without editing this file (for a staging deploy, a local test, a real
 * domain), define window.YSD_CONFIG before this script runs; anything set there wins, key by key
 * (deep merge). Example, in a tiny inline script or config.local.js loaded before this file:
 *
 *   window.YSD_CONFIG = { demo: false, site: { url: 'https://example.org' },
 *                         integrations: { formEndpoint: '/api/join' } };
 *
 * Conventions
 *  - '' (empty string) means "not configured": pages must hide the feature or fall back.
 *  - Secrets (API keys, tokens) NEVER go here. This file ships to every browser. Secrets live in
 *    the serverless functions' environment variables (functions/, netlify/functions/).
 *  - demo === true keeps all state in the browser (localStorage + IndexedDB) and makes no network
 *    calls for joins, counters or uploads. Demo-only numbers and people are flagged demo:true.
 *
 * There is deliberately NO chat assistant, LLM integration or "ask" endpoint on this site (cut by
 * Kira, Nov 2026). Do not add one here.
 *
 * Helpers defined at the bottom (the only code in this file):
 *  YSD.cfg(path, fallback)  read a dotted path, e.g. YSD.cfg('integrations.formEndpoint', '')
 *  YSD.emit(name, detail)   dispatch a 'ysd:<name>' CustomEvent on document (design hooks)
 *  YSD.debug                true when the URL has ?debug=1 (sticky for the tab session)
 *  YSD.log(...)             console.log that is silent unless YSD.debug
 *  YSD.track(...)           queue stub until assets/js/track.js loads and replays the queue
 *  YSD.root                 the site root URL (folder holding assets/), with trailing slash,
 *                           derived from this script's own src so it works on file://, localhost
 *                           and any sub-path deploy; YSD.share.url() resolves paths against it
 *                           (or against site.url when that is set).
 */
(function (w) {
  'use strict';

  var defaults = {
    /** Schema version of this config object (bump when keys are renamed). */
    version: 1,

    /** Demo mode: everything stays in this browser. Set false only when integrations are wired. */
    demo: true,

    org: {
      /**
       * The real, chartered chapter: Young Democrats of Seminole County (YDSC). Confirmed by Kira
       * on Nov 9, 2026 as the org this site is for (she is getting sign-off). ActBlue slug and
       * the youngsemdems.com domain both use "youngsemdems". See docs/research/02.
       */
      name: 'Young Democrats of Seminole County',
      short: 'YDSC',
      /** Casual display name for headlines and stickers. */
      nickname: 'Young Dems',
      /** Matches the ActBlue slug and youngsemdems.com; social handles are NOT verified. */
      handle: 'youngsemdems',
      /** Parent party (Seminole County Democratic Executive Committee). */
      parent: 'Seminole County Democrats',
      county: 'Seminole County',
      state: 'Florida',
      stateCode: 'FL',
      /**
       * Oldest member age, inclusive. YDSC's dues page says members are 14 to under 40, so 39.
       * (Kira's brief said "40 and under"; the chapter's own rule wins. Confirm against bylaws.)
       */
      ageCap: 39,
      /**
       * Youngest member age. YDSC's dues page says 14 (also above the COPPA under-13 line).
       * Members under 18 need the minors policy (photos, video uploads, SMS) before launch.
       * (Florida lets 16- and 17-year-olds PRE-register to vote; see links.vote.register.)
       */
      minAge: 14,
      /** Dues per YDSC's ActBlue dues page: $20 a year, paid in January; hardship = non-voting member. */
      dues: { amount: 20, period: 'year', due: 'January', hardshipPath: true },
      /** PLACEHOLDER tagline: the research/design workflow will supply real copy. */
      tagline: 'Young Democrats in Seminole County, 14 to 39.',
      timezone: 'America/New_York'
    },

    site: {
      /** Canonical origin, no trailing slash. '' means use location.origin at runtime. */
      url: '',
      lang: 'en',
      locales: ['en', 'es'],
      defaultLocale: 'en',
      /** Default share title/description (PLACEHOLDER copy). */
      title: 'Young Democrats of Seminole County',
      description: 'The Young Democrats of Seminole County, Florida: ages 14 to 39.',
      /** Absolute or root-relative default share image ('' = none yet). */
      ogImage: '',
      /** Domain used in calendar UIDs while site.url is '' (any host, file:// too), so UIDs stay stable across preview hosts. */
      uidDomain: 'youngsemdems'
    },

    /**
     * Social accounts. PLACEHOLDERS: handles are the intended names, NOT verified as owned by the
     * group. url '' means "not live": pages must not render a link until a real url is set.
     */
    social: {
      instagram: { handle: 'youngsemdems', url: '' },
      tiktok: { handle: 'youngsemdems', url: '' },
      x: { handle: 'youngsemdems', url: '' },
      threads: { handle: 'youngsemdems', url: '' },
      bluesky: { handle: 'youngsemdems', url: '' },
      facebook: { handle: 'youngsemdems', url: '' },
      youtube: { handle: 'youngsemdems', url: '' }
    },

    links: {
      /**
       * Official voting links. Each URL was checked on Mon Nov 9, 2026 (loaded, title/content
       * confirmed against the official site that links to it). Re-check before each election.
       */
      vote: {
        // Florida Online Voter Registration System (Florida Dept. of State; relaunched 2023 per
        // the DOS press release). Register or update address/party. Checked 2026-11-09: this exact
        // URL is the link on voteseminole.gov/voters/register-to-vote/. The site blocks non-browser
        // clients (scripts get a 404), so check it in a real browser.
        register: 'https://registertovoteflorida.gov/home',
        // Florida Division of Elections statewide voter status lookup ("State of Florida Voter
        // Lookup"). Checked 2026-11-09: dos.fl.gov/elections links the old
        // registration.elections.myflorida.com/CheckVoterStatus, which 301-redirects here.
        checkRegistration: 'https://registration.dos.fl.gov/CheckVoterStatus',
        // Florida Division of Elections home. Checked 2026-11-09.
        stateElections: 'https://dos.fl.gov/elections/',
        // Seminole County Supervisor of Elections home. Checked 2026-11-09.
        countyElections: 'https://voteseminole.gov/',
        // Seminole SOE register-to-vote page (paper and online options, pre-registration at 16).
        // Checked 2026-11-09.
        countyRegister: 'https://voteseminole.gov/voters/register-to-vote/',
        // Seminole SOE "My Voter Record": registration status, sample ballot, polling place,
        // mail ballot status. Checked 2026-11-09.
        myVoterRecord: 'https://voteseminole.gov/voters/my-voter-record/',
        // Seminole SOE vote-by-mail page (links the online request form). Checked 2026-11-09.
        voteByMail: 'https://voteseminole.gov/how-to-vote/vote-by-mail/',
        // Seminole SOE "Find My Polling Location" map (linked from the voter record page).
        // Checked 2026-11-09.
        pollingPlace: 'https://voteseminole.dolphmap.com/',
        // Seminole SOE early voting page. Checked 2026-11-09.
        earlyVoting: 'https://voteseminole.gov/how-to-vote/early-voting/',
        // Seminole SOE upcoming elections list (as of 2026-11-09 it still lists the
        // Nov 3, 2026 general; no 2027/2028 dates posted yet). Checked 2026-11-09.
        upcomingElections: 'https://voteseminole.gov/elections/upcoming-elections/',
        // Seminole SOE office phone, as listed on voteseminole.gov (407-708-7705 there is the
        // fax). Checked 2026-11-09.
        countyPhone: '407-585-8683'
      },
      /** Party-controlled links: EMPTY PLACEHOLDERS until the party provides them. */
      // YDSC's public ActBlue pages (cited in docs/research/02; ActBlue blocks scripted checks,
      // so confirm in a browser). The chapter should confirm before launch.
      actblue: 'https://secure.actblue.com/donate/youngsemdems',
      dues: 'https://secure.actblue.com/donate/ydscdues',
      actionNetwork: '',    // Hosted Action Network form/page URL (fallback link for joins)
      mobilize: '',         // Mobilize organization or event-feed URL
      volunteer: '',        // Volunteer sign-up page if separate from the join form
      countyParty: 'https://semdems.com/', // Seminole County Democrats (checked 2026-11-09)
      contact: ''           // mailto: or contact page
    },

    integrations: {
      /**
       * Join form endpoint. '' = none. YSD.members POSTs here when demo is false.
       * formEncoding 'json' (default) sends application/json; 'form' sends
       * application/x-www-form-urlencoded (Netlify Forms, Formspree and similar).
       */
      formEndpoint: '',
      formEncoding: 'json',
      /** Netlify Forms needs the form name in the body when formEncoding is 'form'. */
      formName: 'join',
      /**
       * Action Network via YOUR serverless proxy (the proxy adds the OSDI-API-Token header from a
       * server env var; the browser never sees the key) that forwards to
       * https://actionnetwork.org/api/v2/people/ (the "person signup helper"). The browser POSTs:
       * { person: { given_name, family_name, email_addresses: [{address, status}],
       *   phone_numbers: [{number, status}], postal_addresses: [{postal_code, region, country}],
       *   custom_fields: { ysd_ref_code, ysd_referred_by } }, add_tags }. Used only when
       * formEndpoint is ''. tags are added to every join.
       */
      actionNetwork: { endpoint: '', tags: ['youngsemdems-site'] },
      /** Squad lookup: GET <squadEndpoint>?ref=CODE -> { squad: [{ name, joinedAt }] }. */
      squadEndpoint: '',
      /** Counters: GET -> { name: value, ... }; POST { name, n } increments. '' = local only. */
      countersEndpoint: '',
      /** Video upload endpoint (functions/api/video-upload.js). '' = local-only clips. */
      videoUploadEndpoint: '',
      analytics: {
        /** 'none' | 'plausible' | 'cloudflare' | 'custom'. Demo mode never sends. */
        provider: 'none',
        /** Plausible: site domain and script URL (self-hosted or plausible.io). */
        plausibleDomain: '',
        plausibleSrc: 'https://plausible.io/js/script.js',
        /** Cloudflare Web Analytics beacon token (public token, page views only). */
        cloudflareToken: '',
        /**
         * Custom collector: receives { event, props, path, ts, ref } as JSON text (sent with
         * navigator.sendBeacon as text/plain so no CORS preflight is needed; parse the body).
         */
        endpoint: '',
        /** Skip analytics for visitors sending Global Privacy Control or Do Not Track. */
        respectDoNotTrack: true
      }
    },

    legal: {
      /**
       * PLACEHOLDER disclaimer. Florida's political advertising disclaimer rules are in
       * Fla. Stat. 106.143; the party (and its counsel) must supply the final wording,
       * paying entity name and address before launch.
       */
      paidFor: '[PLACEHOLDER] Paid political advertisement paid for by [committee name], [address]. Final wording to be supplied by the party.',
      privacyEmail: '',
      /** Small line drawn on share cards ('' = none). */
      cardFooter: ''
    },

    /**
     * Theme FALLBACK colours (PLACEHOLDERS, the design team will replace them). The live values
     * come from CSS custom properties on :root: --ysd-<key> (e.g. --ysd-brand), and for share
     * cards --ysd-card-<key> first. These hexes are only used when a variable is missing.
     */
    theme: {
      bg: '#101114',
      fg: '#ffffff',
      brand: '#2f5bea',
      accent: '#ff4f8b',
      pop: '#ffd23f',
      muted: '#9aa0aa',
      ink: '#101114',
      paper: '#ffffff',
      fontDisplay: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
      fontBody: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
    },

    share: {
      /** Default utm values added by YSD.share.url(). */
      utm: { utm_source: 'share', utm_medium: 'social', utm_campaign: 'youngsemdems' },
      /** Query parameter that carries a referral code. */
      refParam: 'ref',
      /** Days a captured ref counts for attribution. */
      attributionDays: 30,
      /** Default hashtags for share text (no '#'); only the X link uses them. PLACEHOLDER. */
      hashtags: ['YoungDemsSeminole'],
      /**
       * Remove ?ref= and utm_* from the address bar after capture (after the page 'load' event, so
       * analytics still sees the UTM tags). Off by default.
       */
      cleanUrl: false,
      /** ActBlue refcode used when no referral code applies (letters, digits, underscore). */
      actblueRefcode: 'ysd_site'
    },

    members: {
      /**
       * Referral code style. 'name': up to refNameMax letters of the first name + refRandom
       * characters (e.g. KIRA7QX). 'random': 6 random characters (e.g. B7KQ2M). Random characters
       * come from an alphabet with no vowels and no look-alikes (0/O, 1/I/L), so codes stay
       * readable and cannot spell words.
       */
      refCodeStyle: 'name',
      refNameMax: 5,
      refRandom: 3,
      /** Join form rules. minAge is a hard floor; the age cap only warns unless enforceAgeCap. */
      enforceAgeCap: false,
      /** 5-digit ZIPs counted as "in county" for a soft warning. [] = no check (PLACEHOLDER). */
      countyZips: [],
      /**
       * After a successful production submit, drop email/phone/ZIP from the copy kept in this
       * browser (the server has them). Demo mode always keeps them locally (nothing is sent).
       */
      keepContactLocally: false,
      /** Demo only: how many simulated squad members can appear after joining (flagged demo). */
      demoSquadMax: 6
    },

    cal: {
      /** PRODID written into .ics files. */
      prodId: '-//Young Democrats of Seminole County//youngsemdems site//EN',
      /** Event length used when an event has no end. */
      defaultDurationMin: 120,
      /** Calendar name shown by some apps (X-WR-CALNAME) for multi-event files. */
      name: 'Young Democrats of Seminole County'
    },

    cards: {
      /** Font specs to wait for before drawing (CSS font shorthand, e.g. '800 64px Inter'). */
      fonts: [],
      /** Draw a small DEMO mark on cards in demo mode. */
      demoWatermark: true
    },

    /**
     * Member video clips (assets/js/clips.js). These are clips.js's own defaults, listed here so
     * they can be swapped in one place; per-call options still win. Keep maxBytes and maxDuration
     * in step with the upload function's VIDEO_MAX_BYTES / VIDEO_MAX_DURATION_SECONDS env vars.
     */
    clips: {
      maxBytes: 157286400,    // 150 MB
      maxDuration: 180,       // seconds
      minDuration: 0.5,
      captionMax: 300,
      tagsMax: 8
    },

    /**
     * Service worker (assets/js/sw-register.js, sw.js). Off on file:// and, by default, in demo
     * mode (demo deploys change often). ?sw=0 in the URL unregisters it for debugging.
     */
    pwa: {
      serviceWorker: true,
      serviceWorkerInDemo: false,
      swUrl: 'sw.js'
    },

    features: {
      referrals: true,
      squad: true,
      cards: true,
      clips: true,
      calendar: true,
      /** Demo-only: simulated squad members appear over time after joining (flagged demo). */
      demoSquadGrowth: true,
      /** Demo-only: counters tick up while the page is open (flagged demo). */
      demoLiveCounters: true
    }
  };

  // ---- deep merge: window.YSD_CONFIG (set before this file) wins over defaults ----
  function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }
  function merge(base, over) {
    var out = {}, k;
    for (k in base) if (Object.prototype.hasOwnProperty.call(base, k)) out[k] = base[k];
    for (k in over) {
      if (!Object.prototype.hasOwnProperty.call(over, k)) continue;
      out[k] = isObj(base[k]) && isObj(over[k]) ? merge(base[k], over[k]) : over[k];
    }
    return out;
  }
  var pre = isObj(w.YSD_CONFIG) ? w.YSD_CONFIG : {};
  w.YSD_CONFIG = merge(defaults, pre);

  // ---- tiny bootstrap shared by every module ----
  var YSD = w.YSD = w.YSD || {};
  YSD.version = YSD.version || '0.2.0';

  /** Site root (folder that holds assets/), from this script's src; see header. */
  YSD.root = (function () {
    var re = /^(.*\/)assets\/js\/config\.js(?:[?#].*)?$/, src = '', m;
    try {
      var d = w.document;
      if (d && d.currentScript && d.currentScript.src) src = d.currentScript.src;
      if (!re.test(src) && d && d.getElementsByTagName) {
        var ss = d.getElementsByTagName('script');
        for (var i = ss.length - 1; i >= 0; i--) if (re.test(ss[i].src || '')) { src = ss[i].src; break; }
      }
      m = re.exec(src);
      if (m) return m[1];
    } catch (e) {}
    try { return new w.URL('.', w.location.href).href; } catch (e) {}
    return '';
  })();

  /** Read a dotted config path with a fallback: YSD.cfg('integrations.formEndpoint', ''). */
  YSD.cfg = function (path, fallback) {
    var cur = w.YSD_CONFIG, parts = String(path || '').split('.');
    for (var i = 0; i < parts.length; i++) {
      if (!parts[i]) continue;
      if (cur == null || typeof cur !== 'object' || !(parts[i] in cur)) return fallback;
      cur = cur[parts[i]];
    }
    return cur === undefined ? fallback : cur;
  };

  /** Dispatch a 'ysd:<name>' CustomEvent on document. Never throws. */
  YSD.emit = function (name, detail) {
    try {
      var d = w.document;
      if (!d || typeof d.dispatchEvent !== 'function') return;
      var ev;
      if (typeof w.CustomEvent === 'function') ev = new w.CustomEvent('ysd:' + name, { detail: detail });
      else if (d.createEvent) { ev = d.createEvent('CustomEvent'); ev.initCustomEvent('ysd:' + name, false, false, detail); }
      if (ev) d.dispatchEvent(ev);
    } catch (e) { /* hooks must never break the page */ }
  };

  /** ?debug=1 turns on console logging for the tab session; ?debug=0 turns it off. */
  YSD.debug = (function () {
    var q = '';
    try { q = String((w.location && w.location.search) || ''); } catch (e) {}
    var m = /[?&]debug=([01])\b/.exec(q);
    try {
      if (m) w.sessionStorage.setItem('ysd:debug', m[1]);
      return (m ? m[1] : w.sessionStorage.getItem('ysd:debug')) === '1';
    } catch (e) { return !!(m && m[1] === '1'); }
  })();

  /**
   * Analytics queue stub: modules may call YSD.track() before assets/js/track.js loads (or when a
   * page does not include it). Calls are queued here and replayed by track.js.
   */
  if (typeof YSD.track !== 'function') {
    YSD.track = function () {
      var q = YSD.track.q = YSD.track.q || [];
      if (q.length < 100) q.push([].slice.call(arguments));
      return false;
    };
  }

  /** Console logger that is silent unless YSD.debug. */
  YSD.log = function () {
    if (!YSD.debug) return;
    try { w.console && w.console.log.apply(w.console, ['[ysd]'].concat([].slice.call(arguments))); } catch (e) {}
  };
})(typeof window !== 'undefined' ? window : this);
