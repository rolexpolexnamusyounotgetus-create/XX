/*!
 * Young Seminole Democrats (youngsemdem): site configuration.
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
 * Helpers defined at the bottom (the only code in this file):
 *  YSD.cfg(path, fallback)  read a dotted path, e.g. YSD.cfg('integrations.askEndpoint', '')
 *  YSD.emit(name, detail)   dispatch a 'ysd:<name>' CustomEvent on document (design hooks)
 *  YSD.debug                true when the URL has ?debug=1 (sticky for the tab session)
 */
(function (w) {
  'use strict';

  var defaults = {
    /** Schema version of this config object (bump when keys are renamed). */
    version: 1,

    /** Demo mode: everything stays in this browser. Set false only when integrations are wired. */
    demo: true,

    org: {
      name: 'Young Seminole Democrats',
      short: 'YSD',
      handle: 'youngsemdem',
      county: 'Seminole County',
      state: 'Florida',
      stateCode: 'FL',
      /** Membership is Democrats aged 40 and under. Pages use this for copy and soft checks. */
      ageCap: 40,
      /**
       * Youngest age the join form accepts. 13 is a placeholder floor because US COPPA rules
       * cover collecting data from children under 13; the party should confirm its own policy.
       * (Florida lets 16- and 17-year-olds PRE-register to vote; see links.vote.register.)
       */
      minAge: 13,
      /** PLACEHOLDER tagline: the research/design workflow will supply real copy. */
      tagline: 'Seminole County Democrats, 40 and under.',
      timezone: 'America/New_York'
    },

    site: {
      /** Canonical origin, no trailing slash. '' means use location.origin at runtime. */
      url: '',
      lang: 'en',
      locales: ['en', 'es'],
      defaultLocale: 'en',
      /** Default share title/description (PLACEHOLDER copy). */
      title: 'Young Seminole Democrats',
      description: 'Democrats 40 and under in Seminole County, Florida.',
      /** Absolute or root-relative default share image ('' = none yet). */
      ogImage: '',
      /** Hostname used in calendar UIDs when site.url is '' and the page runs from file://. */
      uidDomain: 'youngsemdem'
    },

    /**
     * Social accounts. PLACEHOLDERS: handles are the intended names, NOT verified as owned by the
     * group. url '' means "not live": pages must not render a link until a real url is set.
     */
    social: {
      instagram: { handle: 'youngsemdem', url: '' },
      tiktok: { handle: 'youngsemdem', url: '' },
      x: { handle: 'youngsemdem', url: '' },
      threads: { handle: 'youngsemdem', url: '' },
      bluesky: { handle: 'youngsemdem', url: '' },
      facebook: { handle: 'youngsemdem', url: '' },
      youtube: { handle: 'youngsemdem', url: '' }
    },

    links: {
      /**
       * Official voting links. Each URL was checked on Mon Nov 9, 2026 (loaded, title/content
       * confirmed against the official site that links to it). Re-check before each election.
       */
      vote: {
        // Florida Online Voter Registration System (Florida Dept. of State). Register, update
        // address/party, or check "Am I already registered?". Linked from dos.fl.gov and
        // voteseminole.gov/voters/register-to-vote/. Checked 2026-11-09.
        register: 'https://registertovoteflorida.gov/home',
        // Florida Division of Elections statewide voter status lookup. Checked 2026-11-09
        // (the old registration.elections.myflorida.com/CheckVoterStatus 301-redirects here).
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
        // Seminole SOE office phone, as listed on voteseminole.gov. Checked 2026-11-09.
        countyPhone: '407-585-8683'
      },
      /** Party-controlled links: EMPTY PLACEHOLDERS until the party provides them. */
      actblue: '',          // ActBlue contribution form URL, e.g. https://secure.actblue.com/donate/<form>
      actionNetwork: '',    // Hosted Action Network form/page URL (fallback link for joins)
      mobilize: '',         // Mobilize organization or event-feed URL
      volunteer: '',        // Volunteer sign-up page if separate from the join form
      countyParty: '',      // Seminole County Democratic Party site (party to confirm the URL)
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
       * Action Network via YOUR serverless proxy (the proxy holds the OSDI API key; the
       * browser never does). endpoint receives the Action Network "person signup helper" body:
       * { person: { given_name, family_name, email_addresses, phone_numbers, postal_addresses },
       *   add_tags }. tags are added to every join.
       */
      actionNetwork: { endpoint: '', tags: ['youngsemdem-site'] },
      /** Squad lookup: GET <squadEndpoint>?ref=CODE -> { squad: [{ name, joinedAt }] }. */
      squadEndpoint: '',
      /** Counters: GET -> { name: value, ... }; POST { name, n } increments. '' = local only. */
      countersEndpoint: '',
      /** AI assistant streaming endpoint (functions/api/ask.js). '' = offline scripted mode. */
      askEndpoint: '',
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
        /** Custom collector: receives JSON { event, props, path, ts } via sendBeacon. */
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
      utm: { utm_source: 'share', utm_medium: 'social', utm_campaign: 'youngsemdem' },
      /** Query parameter that carries a referral code. */
      refParam: 'ref',
      /** Days a captured ref counts for attribution. */
      attributionDays: 30,
      /** Default hashtags for share text (no '#'). */
      hashtags: ['YoungSemDem']
    },

    cards: {
      /** Font specs to wait for before drawing (CSS font shorthand, e.g. '800 64px Inter'). */
      fonts: [],
      /** Draw a small DEMO mark on cards in demo mode. */
      demoWatermark: true
    },

    features: {
      referrals: true,
      squad: true,
      cards: true,
      ask: true,
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
  YSD.version = YSD.version || '0.1.0';

  /** Read a dotted config path with a fallback: YSD.cfg('integrations.askEndpoint', ''). */
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

  /** Console logger that is silent unless YSD.debug. */
  YSD.log = function () {
    if (!YSD.debug) return;
    try { w.console && w.console.log.apply(w.console, ['[ysd]'].concat([].slice.call(arguments))); } catch (e) {}
  };
})(typeof window !== 'undefined' ? window : this);
