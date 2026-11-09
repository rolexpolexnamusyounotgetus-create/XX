/*!
 * DEMO counter baselines for YSD.counters (assets/js/store.js).
 *
 * EVERY NUMBER HERE IS MADE UP FOR THE DEMO. None of them is a real count of anything. They exist
 * so the demo's social-proof widgets look alive. demo:true at the top marks the whole file as demo;
 * YSD.counters ignores demo baselines entirely when YSD_CONFIG.demo is false, so these can never
 * appear on the production site.
 *
 * Going live with REAL numbers: set demo:false on an item (or on the whole file) and put the real,
 * verified count in `base`; perDay growth is never applied to real items. Better still, wire
 * YSD_CONFIG.integrations.countersEndpoint so counts come from the server.
 *
 * Shape: items[name] = { base, perDay, label, live? }
 *   base    starting value at `epoch`
 *   perDay  demo-only drift per day since `epoch`, so return visits show growth
 *   label   human label for the design team (not rendered by the engine)
 *   live    false = never pick this counter for demo live ticks
 */
window.YSD_DATA = window.YSD_DATA || {};
window.YSD_DATA.counters = {
  demo: true,
  epoch: '2026-11-09T00:00:00-05:00',
  items: {
    members:    { base: 214,  perDay: 3,  label: 'people who joined' },
    pledges:    { base: 486,  perDay: 7,  label: 'pledges taken' },
    shares:     { base: 1320, perDay: 22, label: 'shares' },
    cards:      { base: 742,  perDay: 11, label: 'share cards made' },
    rsvps:      { base: 168,  perDay: 2,  label: 'event RSVPs' },
    volunteers: { base: 57,   perDay: 1,  label: 'volunteer sign-ups' },
    clips:      { base: 38,   perDay: 1,  label: 'video clips posted' },
    letters:    { base: 23,   perDay: 1,  label: 'letters drafted', live: false }
  }
};
