/*!
 * Young Democrats of Seminole County (YDSC): quizzes.  window.YSD_DATA.quiz
 *
 * Two tap quizzes, English and Spanish, built on the beauty "shade finder" pattern (report 08,
 * technique 28; report 04 B9): ask about everyday things you already know (not abstract opinions),
 * show progress, hand back ONE confident match plus a close second (the "undertone"), show the
 * full mix as a strip (like a fair-to-deep shade strip), offer "not quite you? see your next match",
 * and end on a share card and 3 concrete actions.
 *
 *   issueFinder   "Find your issue": 7 daily-life questions -> one of the 9 issue cards in
 *                 data/issues.js (load issues.js too). Quick mode = the 4 `core` questions.
 *   organizerEra  "How do you show up?" (slug show-up; renamed from the old era quiz, BRIEF 4.7): 8 playful
 *                 questions -> one of 6 organizer types. The internal key stays organizerEra.
 *
 * Copy follows report 05 (voice): plain words, a wink not a costume, no slang cosplay, no guilt.
 * Nothing here is a statistic about real people except issue facts referenced by factRef, which
 * live (with sources) in data/issues.js.
 *
 * ---------------------------------------------------------------------------------------------
 * SCHEMA
 *
 * quiz = {
 *   version, updated ('YYYY-MM-DD'), lang: ['en','es'], demo: false,
 *   ui: { key: {en,es} }          shared buttons and labels (progress uses {n} and {total})
 *   eventSeries: { series: { label {en,es} } }  display labels for the `series` ids in
 *                                 data/events.js (the same ids data/levels.js badges use); used by
 *                                 result.eventSeries and events.html?series=<id>
 *   eventKinds: { kind: { label {en,es} } }  labels for events.js `kind` (events.html?kind=<kind>)
 *   icons: { id: svg }            picture-tile art for options that carry `icon` (Nov 10, 2026)
 *   issueFinder: Quiz,
 *   organizerEra: Quiz
 * }
 *
 * Quiz = {
 *   id, slug                      slug = folder for static result pages (report 04 B7: pre-render
 *                                 /quiz/<slug>/<result-slug>.html with its own OG tags, because
 *                                 link previews don't run JavaScript)
 *   title, intro, cta, privacy    {en,es}
 *   modes?                        { quick: { questionIds, label {en,es} }, full: { label {en,es} } }
 *   questions: [{
 *     id, core?: bool             core = asked in quick mode
 *     weight?: number             multiplies every score of the chosen option (default 1)
 *     prompt {en,es}
 *     options: [{ id, label {en,es}, icon?, scores: { resultId: points } }]   scores may be {} (neutral);
 *                               icon = a key of quiz.icons: the question renders as picture tiles
 *   }],
 *   shuffleOptions: bool          front ends may shuffle option order (scoring doesn't care)
 *   scoring: {
 *     resultIds: [...]            every possible result, in tie-break order
 *     normalize: bool             true: rank by raw / max-possible (fit); false: rank by raw
 *     recency: bool               true: on a full tie, the type that led the most recent answer wins
 *     rules: [string]             the same rules in words
 *   },
 *   copy: { key: {en,es} }        result-screen strings; templates use {match}, {undertone}, {name}.
 *                                 issueFinder fills {match}/{undertone} with the issue's `short`
 *                                 (Spanish shorts carry their article: "el alquiler"), organizerEra
 *                                 with the result `name`. Capitalize the first letter when a
 *                                 template starts with a placeholder.
 *   results: ...                  issueFinder: { [issueId]: { slug, identity?, character?, card } }
 *                                 identity { name {en,es} }: the shareable name above the plain issue
 *                                 ("The Rent Realist"; genz-brand-14). Serious issues keep the calm template;
 *                                 reproductive freedom has no identity and no character (stays plain).
 *                                 character: false = no art (else assets/img/characters/issue/<slug>.svg)
 *                                 (issue content comes
 *                                 from YSD_DATA.issues.items: title, short, color, facts, actions)
 *                                 organizerEra: [Result]
 * }
 *
 * card (share card, YSD.cards 'story' 1080x1920 and 'square') = {
 *   headline {en,es}, subline {en,es},
 *   sublineAfter? { date, en, es, factRef? }  use instead of subline on/after date (with its own
 *                 factRef when the dated line rests on a different fact)
 *   factRef?  '<issueId>.<factId>'  the sourced fact behind the subline (print its source small)
 * }
 *
 * Result (organizerEra) = {
 *   id, slug, color, onColor      colour tokens (report 03); map to var(--ysd-<token>)
 *   name {en,es}                  the Spanish names are their own jokes, not translations
 *   description { en: [line1, line2], es: [line1, line2] }
 *   strengths { en: [3], es: [3] }
 *   actions [Action]              3 per type (BRIEF 4.7), same Action shape as data/issues.js (type, label, labelAfter?,
 *                                 page, hash, query, official?, demo?)
 *   eventSeries [series]          keys of quiz.eventSeries, best fit first. Front ends show a chip only
 *                                 for a series with a visible upcoming event; a series that exists only
 *                                 behind the January drop gets the drop line + Notify me; no chips at all
 *                                 falls back to eventKinds (journeys-05)
 *   card { headline, subline }    share card copy
 *   Character art: assets/img/characters/show-up/<slug>.svg (and characters.js for canvas cards).
 * }
 *
 * Page map: actions use page keys from YSD_DATA.issues.pages (home, issues, quiz, vote, events,
 * join, clips, post). vote.html hashes are data/civic.js step ids (see issues.anchors). Events
 * filters use data/events.js fields: ?series=<series> or ?kind=<kind> (no `tags` or `type` field
 * exists there).
 *
 * Event caution: there is deliberately no "voter registration drive" or "petition" format.
 * Florida regulates third-party voter registration (F.S. 97.0575) and petition circulating
 * (HB 1205, 2025; see docs/research/01 section 3b). Add those only after a compliance check.
 *
 * Privacy: do not store or send per-question answers. Sharing sends only the result.
 * Analytics, if any, may record the result id only (quiz complete), never the answers.
 *
 * ---------------------------------------------------------------------------------------------
 * SCORING (both quizzes, any front end)
 *
 *  1. For each answered question, add the chosen option's points (x question weight) to raw[id].
 *  2. max[id] = sum, over the ANSWERED questions only, of the most points id could get from any
 *     option of that question (x weight). Unanswered questions count for nothing, which is what
 *     makes quick mode (4 core questions) and full mode (all 7) use the same rules.
 *  3. fit[id] = raw[id] / max[id] when normalize is true (0 when max is 0), else raw[id].
 *  4. Rank: fit desc, then raw desc, then (if recency) the id that led the latest answer, then
 *     resultIds order. match = 1st. undertone = 2nd if its fit > 0.
 *  5. mix (the strip): fit shares in whole percents that sum to 100 (largest remainder; ties go
 *     to resultIds order). Show the top 3 to 5 as a bar, or all as a strip.
 *  6. "Not quite you?" steps through ranked[1], ranked[2]... (the shade finder's lighter/deeper).
 *
 * Reference implementation (ES5, no dependencies). tools/tests may extract and run it.
 * @@reference-scorer-start
 * function ysdScoreQuiz(quiz, answers) {
 *   var s = quiz.scoring, ids = s.resultIds, raw = {}, max = {}, fit = {}, last = {}, n = 0, i, id;
 *   for (i = 0; i < ids.length; i++) { raw[ids[i]] = 0; max[ids[i]] = 0; last[ids[i]] = -1; }
 *   for (var qi = 0; qi < quiz.questions.length; qi++) {
 *     var q = quiz.questions[qi], pick = answers[q.id], w = q.weight || 1, best = {}, chosen = null;
 *     if (pick == null) continue;
 *     for (var oi = 0; oi < q.options.length; oi++) {
 *       var o = q.options[oi];
 *       for (id in o.scores) if (o.scores[id] > (best[id] || 0)) best[id] = o.scores[id];
 *       if (o.id === pick) chosen = o;
 *     }
 *     if (!chosen) continue;
 *     n++;
 *     for (id in best) if (id in max) max[id] += best[id] * w;
 *     var top = 0;
 *     for (id in chosen.scores) { if (id in raw) raw[id] += chosen.scores[id] * w; if (chosen.scores[id] > top) top = chosen.scores[id]; }
 *     for (id in chosen.scores) if (id in last && chosen.scores[id] === top) last[id] = qi;
 *   }
 *   for (i = 0; i < ids.length; i++) id = ids[i], fit[id] = s.normalize ? (max[id] ? raw[id] / max[id] : 0) : raw[id];
 *   var ranked = ids.slice().sort(function (a, b) {
 *     return (fit[b] - fit[a]) || (raw[b] - raw[a]) || (s.recency ? last[b] - last[a] : 0) || (ids.indexOf(a) - ids.indexOf(b));
 *   });
 *   var total = 0, mix = {}, rem = [], used = 0;
 *   for (i = 0; i < ids.length; i++) total += fit[ids[i]];
 *   for (i = 0; i < ids.length; i++) {
 *     var exact = total ? 100 * fit[ids[i]] / total : 0;
 *     mix[ids[i]] = Math.floor(exact); used += mix[ids[i]]; rem.push([ids[i], exact - mix[ids[i]], i]);
 *   }
 *   rem.sort(function (a, b) { return (b[1] - a[1]) || (a[2] - b[2]); });
 *   for (i = 0; total && used < 100; i++, used++) mix[rem[i][0]]++;
 *   return { match: n ? ranked[0] : null, undertone: n && fit[ranked[1]] > 0 ? ranked[1] : null,
 *            ranked: ranked, fit: fit, raw: raw, mix: mix, answered: n };
 * }
 * @@reference-scorer-end
 * Usage: ysdScoreQuiz(YSD_DATA.quiz.issueFinder, { commute: 'transit', home: 'renting', ... })
 *
 * Checked by enumerating every answer combination (Nov 9, 2026): every result is reachable in
 * both quizzes; organizer types have equal maximum scores (17 each). Measured shares of all
 * combinations: issueFinder full (680,400) housing 17.5, transit 14.3, wages 13.3, water 11.9,
 * heat 9.8, repro 9.2, schools 8.3, lgbtq 7.9, voting 7.8; quick (1,350) lgbtq 15.6 down to heat
 * 6.3; organizerEra (1,679,616) every type 16.0-17.0. Re-run after changing any scores.
 *
 * Spanish terms match data/issues.js: "boleta por correo", "solicitud de boleta por correo",
 * "inscripción", "identificación".
 */
window.YSD_DATA = window.YSD_DATA || {};
window.YSD_DATA.quiz = {
  version: 1,
  updated: '2026-11-10',
  lang: ['en', 'es'],
  demo: false,

  ui: {
    start: { en: 'Start', es: 'Empezar' },
    next: { en: 'Next', es: 'Siguiente' },
    back: { en: 'Back', es: 'Atrás' },
    progress: { en: 'Question {n} of {total}', es: 'Pregunta {n} de {total}' },
    retake: { en: 'Take it again', es: 'Hacerlo de nuevo' },
    shareCard: { en: 'Share my card', es: 'Compartir mi tarjeta' },
    saveCard: { en: 'Save the image', es: 'Guardar la imagen' },
    copyLink: { en: 'Copy link', es: 'Copiar enlace' },
    otherQuiz: { en: 'Try the other quiz', es: 'Prueba el otro quiz' },
    source: { en: 'Source', es: 'Fuente' },
    demoTag: { en: 'DEMO', es: 'DEMO' },
    // Nov 10, 2026 (round 1): honest live lean, sender lines, the January drop line
    leaning: { en: 'Leaning: {name}', es: 'Por ahora: {name}' },
    sentBy: { en: '{name} sent you this one. Your turn.', es: '{name} te mandó esto. Te toca.' },
    sentByFriend: { en: 'A friend sent you this one. Your turn.', es: 'Alguien te mandó esto. Te toca.' },
    fromShowUp: { en: '{name} got {match}. Your turn: 8 questions, about a minute.', es: '{name} sacó {match}. Te toca: 8 preguntas, como un minuto.' },
    fromIssue: { en: '{name} got {match}. Your turn: 4 taps, about a minute.', es: '{name} sacó {match}. Te toca: 4 toques, como un minuto.' },
    fromIssuePlain: { en: '{name}’s issue is {match}. Find yours: 4 taps, about a minute.', es: 'El tema de {name} es {match}. Encuentra el tuyo: 4 toques, como un minuto.' },
    dropSeries: { en: '{series}: in January’s lineup.', es: '{series}: en la programación de enero.' },
    // keep in step with data/events.js schedule.drop.opensAt
    dropWhen: { en: 'It drops Tue, Dec 15 at noon (DEMO).', es: 'Sale el mar. 15 de dic. a las 12 p. m. (DEMO).' },
    dropTag: { en: 'JAN', es: 'ENE' },
    notify: { en: 'Notify me', es: 'Avísame' },
    notifyDone: { en: 'Calendar file ready. It pings you at noon on Dec 15.', es: 'Archivo de calendario listo. Te avisa el 15 de dic. a las 12 p. m.' },
    picked: { en: 'Picked', es: 'Elegida' }
  },

  // Keys = data/events.js `series` ids (checked against events.js on Nov 9, 2026).
  eventSeries: {
    'sunset-walk': { label: { en: 'Sunset walks', es: 'Caminatas al atardecer' } },
    trivia: { label: { en: 'Trivia nights', es: 'Noches de trivia' } },
    'text-bank': { label: { en: 'Text-a-friend nights', es: 'Noches de mensajes' } },
    'creator-night': { label: { en: 'Creator nights', es: 'Noches de video' } },
    'renew-ready': { label: { en: 'Renewal parties', es: 'Fiestas para renovar' } },
    'workshop-es': { label: { en: 'Workshops in Spanish', es: 'Talleres en español' } },
    mixer: { label: { en: 'Member mixers', es: 'Encuentros de miembros' } },
    sunrail: { label: { en: 'SunRail socials', es: 'Salidas en SunRail' } },
    canvass: { label: { en: 'Neighbor check-ins', es: 'Visitas al vecindario' } },
    karaoke: { label: { en: 'Karaoke nights', es: 'Noches de karaoke' } },
    picnic: { label: { en: 'Picnics', es: 'Pícnics' } }
  },
  eventKinds: {
    social: { label: { en: 'Hang out', es: 'Para pasarla bien' } },
    learn: { label: { en: 'Learn something', es: 'Para aprender' } },
    volunteer: { label: { en: 'Pitch in', es: 'Para echar una mano' } },
    create: { label: { en: 'Make something', es: 'Para crear' } }
  },

  // Picture-tile art (genz-brand-11): sticker-style pictograms drawn for the quiz (viewBox 0 0 64 64, no ids, no
  // text, no external refs). An option with `icon` renders as a picture tile; its label stays the accessible name.
  icons: {
    car: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><g stroke="#170B33" stroke-width="0" stroke-linejoin="round" stroke-linecap="round"><circle cx="32" cy="32" r="29" fill="#FFD23F" stroke-width="3.5"/><path d="M12 40 L14 30 C15 26 18 24 22 24 L42 24 C46 24 49 26 50 30 L52 40 Z" fill="#FF6B1A" stroke-width="3"/><path d="M18 30 L21 26 L43 26 L46 30Z" fill="#4FD6FF" stroke-width="2.5"/><rect x="10" y="36" width="44" height="10" rx="4" fill="#FF6B1A" stroke-width="3"/><circle cx="20" cy="46" r="5" fill="#170B33" stroke-width="2"/><circle cx="44" cy="46" r="5" fill="#170B33" stroke-width="2"/><circle cx="14" cy="40" r="2" fill="#FFD23F"/><circle cx="50" cy="40" r="2" fill="#FFD23F"/></g></svg>',
    train: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><g stroke="#170B33" stroke-width="0" stroke-linejoin="round" stroke-linecap="round"><circle cx="32" cy="32" r="29" fill="#4FD6FF" stroke-width="3.5"/><rect x="18" y="12" width="28" height="34" rx="8" fill="#FFF6EA" stroke-width="3"/><rect x="22" y="17" width="20" height="12" rx="3" fill="#4FD6FF" stroke-width="2.5"/><rect x="18" y="33" width="28" height="5" fill="#6A2BFF"/><circle cx="24" cy="41" r="2.5" fill="#170B33"/><circle cx="40" cy="41" r="2.5" fill="#170B33"/><path d="M22 46 L16 54 M42 46 L48 54 M19 51 H45" fill="none" stroke-width="3"/></g></svg>',
    bike: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><g stroke="#170B33" stroke-width="0" stroke-linejoin="round" stroke-linecap="round"><circle cx="32" cy="32" r="29" fill="#7EE081" stroke-width="3.5"/><circle cx="20" cy="40" r="9" fill="none" stroke-width="3.5"/><circle cx="44" cy="40" r="9" fill="none" stroke-width="3.5"/><path d="M20 40 L28 26 L40 26 L44 40 M28 26 L34 40 L40 26 M26 22 H32 M38 22 L42 20" fill="none" stroke-width="3.5"/><circle cx="34" cy="40" r="2.5" fill="#170B33"/></g></svg>',
    carpool: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><g stroke="#170B33" stroke-width="0" stroke-linejoin="round" stroke-linecap="round"><circle cx="32" cy="32" r="29" fill="#FF7AC6" stroke-width="3.5"/><path d="M12 40 L14 30 C15 26 18 24 22 24 L42 24 C46 24 49 26 50 30 L52 40 Z" fill="#6A2BFF" stroke-width="3"/><path d="M18 30 L21 26 L43 26 L46 30Z" fill="#4FD6FF" stroke-width="2.5"/><rect x="10" y="36" width="44" height="10" rx="4" fill="#6A2BFF" stroke-width="3"/><circle cx="20" cy="46" r="5" fill="#170B33" stroke-width="2"/><circle cx="44" cy="46" r="5" fill="#170B33" stroke-width="2"/><circle cx="14" cy="40" r="2" fill="#FFD23F"/><circle cx="50" cy="40" r="2" fill="#FFD23F"/><path d="M32 18 C29 14 24 16 26 20 L32 25 L38 20 C40 16 35 14 32 18Z" fill="#FF4D4D" stroke-width="2.5"/></g></svg>',
    laptop: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><g stroke="#170B33" stroke-width="0" stroke-linejoin="round" stroke-linecap="round"><circle cx="32" cy="32" r="29" fill="#C8F03C" stroke-width="3.5"/><rect x="16" y="18" width="32" height="22" rx="3" fill="#FFF6EA" stroke-width="3"/><rect x="20" y="22" width="24" height="14" rx="2" fill="#4FD6FF"/><path d="M10 44 L54 44 L50 48 L14 48Z" fill="#6A2BFF" stroke-width="3"/><path d="M26 30 C28 26 36 26 38 30" fill="none" stroke-width="2.5"/></g></svg>',
    kayak: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><g stroke="#170B33" stroke-width="0" stroke-linejoin="round" stroke-linecap="round"><circle cx="32" cy="32" r="29" fill="#4FD6FF" stroke-width="3.5"/><path d="M6 40 C20 34 44 34 58 40" fill="none" stroke-width="3"/><path d="M12 38 C22 46 42 46 52 38 C40 34 24 34 12 38Z" fill="#FF8B3D" stroke-width="3"/><path d="M18 16 L46 46" fill="none" stroke-width="4"/><path d="M14 12 C12 16 16 20 20 18 L18 14Z" fill="#FFD23F" stroke-width="2.5"/><path d="M50 50 C52 46 48 42 44 44 L46 48Z" fill="#FFD23F" stroke-width="2.5"/><path d="M10 50 C16 48 20 52 26 50 M34 52 C40 50 44 54 50 52" fill="none" stroke="#2236C9" stroke-width="2.5"/></g></svg>',
    sunset: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><g stroke="#170B33" stroke-width="0" stroke-linejoin="round" stroke-linecap="round"><circle cx="32" cy="32" r="29" fill="#FF7AC6" stroke-width="3.5"/><path d="M14 36 A18 18 0 0 1 50 36Z" fill="#FFD23F" stroke-width="3"/><path d="M32 10 V14 M16 18 L19 21 M48 18 L45 21 M8 30 H12 M52 30 H56" fill="none" stroke-width="3"/><rect x="6" y="36" width="52" height="4" fill="#170B33"/><path d="M14 44 H30 M36 44 H50 M20 50 H44" fill="none" stroke="#2236C9" stroke-width="3"/></g></svg>',
    books: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><g stroke="#170B33" stroke-width="0" stroke-linejoin="round" stroke-linecap="round"><circle cx="32" cy="32" r="29" fill="#C8F03C" stroke-width="3.5"/><rect x="14" y="40" width="36" height="8" rx="2" fill="#6A2BFF" stroke-width="3"/><rect x="17" y="32" width="32" height="8" rx="2" fill="#FF8B3D" stroke-width="3"/><rect x="13" y="24" width="34" height="8" rx="2" fill="#4FD6FF" stroke-width="3"/><path d="M36 10 L44 10 L44 24 L40 20 L36 24Z" fill="#FF4D4D" stroke-width="2.5"/></g></svg>',
    pride: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><g stroke="#170B33" stroke-width="0" stroke-linejoin="round" stroke-linecap="round"><circle cx="32" cy="32" r="29" fill="#4FD6FF" stroke-width="3.5"/><path d="M32 52 L12 32 C4 22 14 8 26 14 L32 18 L38 14 C50 8 60 22 52 32Z" fill="#FFFFFF" stroke-width="3.5"/><path d="M16 24 H48" stroke="#FF7AC6" stroke-width="6"/><path d="M15 31 H49" stroke="#FFD23F" stroke-width="6"/><path d="M20 38 H44" stroke="#7EE081" stroke-width="6"/><path d="M26 44 H38" stroke="#6A2BFF" stroke-width="6"/><path d="M32 52 L12 32 C4 22 14 8 26 14 L32 18 L38 14 C50 8 60 22 52 32Z" fill="none" stroke-width="3.5"/></g></svg>',
    apron: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><g stroke="#170B33" stroke-width="0" stroke-linejoin="round" stroke-linecap="round"><circle cx="32" cy="32" r="29" fill="#FFD23F" stroke-width="3.5"/><path d="M22 14 L22 22 M42 14 L42 22" stroke-width="3"/><path d="M18 22 L46 22 L48 52 L16 52Z" fill="#4FD6FF" stroke-width="3"/><rect x="24" y="38" width="16" height="10" rx="2" fill="#4FD6FF" stroke-width="2.5"/><rect x="22" y="26" width="20" height="8" rx="2" fill="#FFF6EA" stroke-width="2.5"/></g></svg>',
    snowflake: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><g stroke="#170B33" stroke-width="0" stroke-linejoin="round" stroke-linecap="round"><circle cx="32" cy="32" r="29" fill="#4FD6FF" stroke-width="3.5"/><path d="M32 10 V54 M13 21 L51 43 M13 43 L51 21" fill="none" stroke="#FFFFFF" stroke-width="4"/><path d="M32 10 V54 M13 21 L51 43 M13 43 L51 21" fill="none" stroke-width="0.01"/><g fill="none" stroke-width="4"><path d="M32 10 V54 M13 21 L51 43 M13 43 L51 21"/><path d="M26 14 L32 19 L38 14 M26 50 L32 45 L38 50"/></g><circle cx="32" cy="32" r="5" fill="#FFF6EA" stroke-width="3"/></g></svg>',
    music: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><g stroke="#170B33" stroke-width="0" stroke-linejoin="round" stroke-linecap="round"><circle cx="32" cy="32" r="29" fill="#FF7AC6" stroke-width="3.5"/><path d="M26 44 V18 L46 14 V40" fill="none" stroke-width="4"/><ellipse cx="21" cy="44" rx="7" ry="5.5" fill="#FFD23F" stroke-width="3"/><ellipse cx="41" cy="40" rx="7" ry="5.5" fill="#FFD23F" stroke-width="3"/><path d="M26 24 L46 20" fill="none" stroke-width="4"/></g></svg>',
    messages: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><g stroke="#170B33" stroke-width="0" stroke-linejoin="round" stroke-linecap="round"><circle cx="32" cy="32" r="29" fill="#4FD6FF" stroke-width="3.5"/><path d="M14 16 H46 a6 6 0 0 1 6 6 V36 a6 6 0 0 1 -6 6 H30 L20 50 L22 42 H14 a6 6 0 0 1 -6 -6 V22 a6 6 0 0 1 6 -6Z" fill="#FFFFFF" stroke-width="3"/><circle cx="20" cy="29" r="3" fill="#170B33"/><circle cx="30" cy="29" r="3" fill="#170B33"/><circle cx="40" cy="29" r="3" fill="#170B33"/></g></svg>',
    grid: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><g stroke="#170B33" stroke-width="0" stroke-linejoin="round" stroke-linecap="round"><circle cx="32" cy="32" r="29" fill="#C8F03C" stroke-width="3.5"/><rect x="14" y="14" width="36" height="36" rx="4" fill="#FFF6EA" stroke-width="3"/><path d="M14 26 H50 M14 38 H50 M26 14 V50 M38 14 V50" fill="none" stroke-width="2.5"/><rect x="27" y="27" width="10" height="10" fill="#6A2BFF"/><rect x="39" y="39" width="10" height="10" fill="#FF7AC6"/><rect x="15" y="39" width="10" height="10" fill="#4FD6FF"/></g></svg>',
    pin: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><g stroke="#170B33" stroke-width="0" stroke-linejoin="round" stroke-linecap="round"><circle cx="32" cy="32" r="29" fill="#7EE081" stroke-width="3.5"/><path d="M32 54 C24 42 16 34 16 26 A16 16 0 0 1 48 26 C48 34 40 42 32 54Z" fill="#FF6B1A" stroke-width="3"/><circle cx="32" cy="26" r="6" fill="#FFF6EA" stroke-width="3"/></g></svg>',
    camera: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><g stroke="#170B33" stroke-width="0" stroke-linejoin="round" stroke-linecap="round"><circle cx="32" cy="32" r="29" fill="#FFD23F" stroke-width="3.5"/><rect x="10" y="20" width="44" height="30" rx="6" fill="#6A2BFF" stroke-width="3"/><path d="M22 20 L26 14 L38 14 L42 20Z" fill="#6A2BFF" stroke-width="3"/><circle cx="32" cy="35" r="9" fill="#4FD6FF" stroke-width="3"/><circle cx="32" cy="35" r="3" fill="#170B33"/><circle cx="47" cy="26" r="2.5" fill="#FF4D4D"/></g></svg>',
    contacts: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><g stroke="#170B33" stroke-width="0" stroke-linejoin="round" stroke-linecap="round"><circle cx="32" cy="32" r="29" fill="#00B3A6" stroke-width="3.5"/><circle cx="26" cy="24" r="8" fill="#FFF6EA" stroke-width="3"/><path d="M12 50 C12 38 20 34 26 34 C32 34 40 38 40 50Z" fill="#FFD23F" stroke-width="3"/><circle cx="46" cy="38" r="9" fill="#FF7AC6" stroke-width="3"/><path d="M46 33 V43 M41 38 H51" fill="none" stroke-width="3.5"/></g></svg>'
  },

  // =========================================================================== FIND YOUR ISSUE
  issueFinder: {
    id: 'issue-finder',
    slug: 'issue',
    title: { en: 'Find your issue', es: 'Encuentra tu tema' },
    intro: {
      en: 'A few taps about your actual life (your commute, your rent, your 2 am thoughts) and we’ll match you with the Seminole issue that fits.',
      es: 'Unas cuantas preguntas sobre tu vida real (cómo te mueves, tu alquiler, lo que piensas a las 2 a. m.) y te mostramos el tema de Seminole que más va contigo.'
    },
    cta: { en: 'Match me', es: 'Encuentra mi tema' },
    privacy: {
      en: 'We don’t save your answers. If you share, only your result goes with it.',
      es: 'No guardamos tus respuestas. Si compartes, solo se comparte tu resultado.'
    },
    modes: {
      quick: {
        questionIds: ['commute', 'home', 'two-am', 'saturday'],
        label: { en: 'Quick match (4 taps)', es: 'Rápido (4 toques)' }
      },
      full: { label: { en: 'Full match (7 taps)', es: 'Completo (7 toques)' } }
    },
    shuffleOptions: false,

    questions: [
      {
        id: 'commute',
        core: true,
        prompt: { en: 'How do you mostly get around Seminole?', es: '¿Cómo te mueves casi siempre por Seminole?' },
        options: [
          { id: 'drive', icon: 'car', label: { en: 'I drive everywhere, and gas adds up', es: 'Manejo a todos lados, y la gasolina suma' }, scores: { wages: 2, transit: 1 } },
          { id: 'transit', icon: 'train', label: { en: 'SunRail or the bus when I can', es: 'SunRail o el autobús cuando puedo' }, scores: { transit: 3 } },
          { id: 'wheels', icon: 'bike', label: { en: 'Bike, scooter or my own two feet', es: 'Bici, scooter o a pie' }, scores: { transit: 2, heat: 1 } },
          { id: 'rides', icon: 'carpool', label: { en: 'Rides from friends or family', es: 'Me llevan amistades o familia' }, scores: { transit: 2, wages: 1 } },
          { id: 'home', icon: 'laptop', label: { en: 'I mostly work or study from home', es: 'Casi siempre trabajo o estudio desde casa' }, scores: { heat: 2, housing: 1 } }
        ]
      },
      {
        id: 'home',
        core: true,
        prompt: { en: 'Where are you living right now?', es: '¿Dónde vives ahora?' },
        options: [
          { id: 'renting', label: { en: 'Renting, and the lease renewal is coming', es: 'Alquilo, y ya viene la renovación del contrato' }, scores: { housing: 3 } },
          { id: 'family', label: { en: 'With family, saving up', es: 'Con mi familia, ahorrando' }, scores: { housing: 2, wages: 1 } },
          { id: 'shared', label: { en: 'Roommates or a dorm', es: 'Comparto apartamento o vivo en una residencia estudiantil' }, scores: { housing: 2, voting: 1 } },
          { id: 'own', label: { en: 'My family or I own the place', es: 'La casa es mía o de mi familia' }, scores: { heat: 3 } },
          { id: 'between', label: { en: 'Between places right now', es: 'Entre un lugar y otro por ahora' }, scores: { housing: 3, wages: 1 } }
        ]
      },
      {
        id: 'two-am',
        core: true,
        prompt: { en: 'It’s 2 am and you can’t sleep. What’s keeping you up?', es: 'Son las 2 a. m. y no te puedes dormir. ¿Qué te está quitando el sueño?' },
        options: [
          { id: 'rent', label: { en: 'My rent went up again', es: 'Me volvieron a subir el alquiler' }, scores: { housing: 3 } },
          { id: 'insurance', label: { en: 'My insurance renewal letter', es: 'La carta de renovación del seguro' }, scores: { heat: 3 } },
          { id: 'body', label: { en: 'Politicians deciding what happens to my body', es: 'Políticos decidiendo sobre mi cuerpo' }, scores: { repro: 3 } },
          { id: 'friends', label: { en: 'Friends getting targeted for who they are', es: 'Que ataquen a mis amistades por ser quienes son' }, scores: { lgbtq: 3 } },
          { id: 'books', label: { en: 'Books disappearing from school libraries', es: 'Libros que desaparecen de las bibliotecas escolares' }, scores: { schools: 3 } },
          { id: 'paycheck', label: { en: 'My paycheck vs. literally everything', es: 'Mi sueldo contra absolutamente todo' }, scores: { wages: 3 } },
          { id: 'traffic', label: { en: 'Sitting in traffic for 45 minutes, again', es: 'Otra vez 45 minutos en el tráfico' }, scores: { transit: 3 } },
          { id: 'lake', label: { en: 'Green slime on the lake', es: 'Las algas verdes en el lago' }, scores: { water: 3 } },
          { id: 'vote', label: { en: 'Worrying my vote won’t count', es: 'Que mi voto no cuente' }, scores: { voting: 3 } }
        ]
      },
      {
        id: 'saturday',
        core: true,
        prompt: { en: 'Pick your perfect Saturday.', es: 'Elige tu sábado ideal.' },
        options: [
          { id: 'kayak', icon: 'kayak', label: { en: 'Kayaking the Wekiva', es: 'Kayak en el Wekiva' }, scores: { water: 3 } },
          { id: 'riverwalk', icon: 'sunset', label: { en: 'Sunset on the Sanford Riverwalk', es: 'Atardecer en el Riverwalk de Sanford' }, scores: { water: 2, transit: 1 } },
          { id: 'library', icon: 'books', label: { en: 'A library haul, then coffee', es: 'Sacar libros de la biblioteca y luego un café' }, scores: { schools: 3 } },
          { id: 'pride', icon: 'pride', label: { en: 'Pride brunch or a drag show', es: 'Un brunch de Pride o un show de drag' }, scores: { lgbtq: 3 } },
          { id: 'shift', icon: 'apron', label: { en: 'Picking up an extra shift', es: 'Tomar un turno extra' }, scores: { wages: 3 } },
          { id: 'ac', icon: 'snowflake', label: { en: 'Staying in with the AC on full blast', es: 'Quedarme en casa con el aire acondicionado al máximo' }, scores: { heat: 3 } }
        ]
      },
      {
        id: 'group-chat',
        prompt: { en: 'Your group chat is blowing up about…', es: 'Tu chat de grupo no para de sonar por…' },
        options: [
          { id: 'landlord', label: { en: 'Someone’s landlord, again', es: 'El dueño del apartamento de alguien, otra vez' }, scores: { housing: 3 } },
          { id: 'ids', label: { en: 'The new rules for IDs at the polls', es: 'Las nuevas reglas de identificación para votar' }, scores: { voting: 3 } },
          { id: 'school-board', label: { en: 'Last night’s school board meeting', es: 'La reunión de anoche de la junta escolar' }, scores: { schools: 3 } },
          { id: 'birth-control', label: { en: 'Birth control, and who gets to decide', es: 'Los anticonceptivos, y quién decide' }, scores: { repro: 3 } },
          { id: 'rides', label: { en: 'Who’s driving to the thing', es: 'Quién maneja para ir al plan' }, scores: { transit: 2 } },
          { id: 'hurricane', label: { en: 'Hurricane prep, again', es: 'Prepararse para el huracán, otra vez' }, scores: { heat: 3 } },
          { id: 'pride', label: { en: 'Pride plans (and outfits)', es: 'Los planes para Pride (y qué ponerse)' }, scores: { lgbtq: 3 } },
          { id: 'lake-day', label: { en: 'Lake day plans', es: 'Planes para ir al lago' }, scores: { water: 2 } }
        ]
      },
      {
        id: 'bank-app',
        prompt: { en: 'You open your banking app. Where did the money go?', es: 'Abres la app del banco. ¿A dónde se fue el dinero?' },
        options: [
          { id: 'ok', label: { en: 'Honestly? I’m doing OK', es: '¿La verdad? Estoy bien' }, scores: {} },
          { id: 'rent', label: { en: 'Rent took most of it', es: 'El alquiler se llevó casi todo' }, scores: { housing: 3, wages: 1 } },
          { id: 'car', label: { en: 'Gas and car stuff', es: 'Gasolina y cosas del carro' }, scores: { transit: 2, wages: 1 } },
          { id: 'tips', label: { en: 'Depends on tips and shifts this week', es: 'Depende de las propinas y los turnos de esta semana' }, scores: { wages: 3 } },
          { id: 'student', label: { en: 'Student budget, so: carefully', es: 'Presupuesto de estudiante, así que: con cuidado' }, scores: { voting: 2, schools: 1 } },
          { id: 'power', label: { en: 'The power bill took a bite', es: 'La factura de la luz se llevó un buen pedazo' }, scores: { heat: 3 } },
          { id: 'doctor', label: { en: 'Doctor and pharmacy bills', es: 'El médico y la farmacia' }, scores: { repro: 1 } }
        ]
      },
      {
        id: 'headline',
        prompt: { en: 'Which headline would you actually tap?', es: '¿Qué titular sí abrirías?' },
        options: [
          { id: 'rent', label: { en: 'What’s actually driving rent in Seminole', es: 'Qué está subiendo de verdad el alquiler en Seminole' }, scores: { housing: 3 } },
          { id: 'insurance', label: { en: 'Why home insurance costs so much here', es: 'Por qué el seguro de vivienda cuesta tanto aquí' }, scores: { heat: 3 } },
          { id: 'abortion-law', label: { en: 'Florida’s abortion law, in plain words', es: 'La ley de aborto de Florida, en palabras simples' }, scores: { repro: 3 } },
          { id: 'pride-rights', label: { en: 'Know your rights at Pride this year', es: 'Conoce tus derechos en Pride este año' }, scores: { lgbtq: 3 } },
          { id: 'books', label: { en: 'Which books got pulled, and who decided', es: 'Qué libros retiraron, y quién lo decidió' }, scores: { schools: 3 } },
          { id: 'wage', label: { en: '$15 minimum wage: is it enough here?', es: 'Salario mínimo de $15: ¿alcanza aquí?' }, scores: { wages: 3 } },
          { id: 'sunrail', label: { en: 'Could SunRail ever run on weekends?', es: '¿Algún día SunRail funcionará los fines de semana?' }, scores: { transit: 3 } },
          { id: 'jesup', label: { en: 'What’s working in the Lake Jesup cleanup', es: 'Lo que sí está funcionando en la limpieza del lago Jesup' }, scores: { water: 3 } },
          { id: 'voter-id', label: { en: 'The new voter ID rules, in 60 seconds', es: 'Las nuevas reglas de identificación para votar, en 60 segundos' }, scores: { voting: 3 } }
        ]
      }
    ],

    scoring: {
      resultIds: ['housing', 'heat', 'repro', 'lgbtq', 'schools', 'wages', 'transit', 'water', 'voting'],
      normalize: true,
      recency: false,
      rules: [
        'Add the chosen option’s points to each issue (raw).',
        'For each issue, add up the most points it could have earned on the questions actually answered (max).',
        'fit = raw / max. Highest fit is the match; ties go to higher raw, then resultIds order.',
        'The second-ranked issue with fit above 0 is the undertone.',
        'mix = each issue’s share of total fit, in whole percents summing to 100 (largest remainder).',
        'Quick mode asks only the 4 core questions; the same rules apply because unanswered questions count for nothing.'
      ]
    },

    copy: {
      matchLabel: { en: 'Your match', es: 'Tu tema' },
      undertone: { en: '{match}, with a hint of {undertone}', es: '{match}, con {undertone} de fondo' },
      mixLabel: { en: 'Your mix', es: 'Tu mezcla' },
      notQuite: { en: 'Not quite you? See your next match', es: '¿No es lo tuyo? Mira tu siguiente opción' },
      refine: { en: 'Fine-tune it (3 more taps)', es: 'Afínalo (3 toques más)' },
      actionsTitle: { en: '3 things you can do this month', es: '3 cosas que puedes hacer este mes' },
      factsTitle: { en: 'The Seminole receipts', es: 'Los datos de Seminole' },
      seeAll: { en: 'See all 9 issues', es: 'Mira los 9 temas' },
      shareText: { en: 'My Seminole issue is {match}. Find yours:', es: 'Mi tema en Seminole es {match}. Encuentra el tuyo:' },
      shareIdentity: { en: 'Took the Young Dems issue quiz: I’m {identity} ({issue}). What are you? Takes about a minute.', es: 'Hice el quiz de temas de los Young Dems: me salió {identity} ({issue}). ¿Y a ti? Toma como un minuto.' },
      identityLabel: { en: 'Your Seminole issue', es: 'Tu tema en Seminole' }
    },

    results: {
      housing: {
        slug: 'rent',
        identity: { name: { en: 'The Rent Realist', es: 'Ojo al Alquiler' } },
        card: {
          headline: { en: 'My Seminole issue: rent.', es: 'Mi tema en Seminole: el alquiler.' },
          subline: { en: 'Median rent here: $1,890 a month. Find your issue.', es: 'Alquiler mediano aquí: $1,890 al mes. Encuentra tu tema.' },
          factRef: 'housing.median-rent'
        }
      },
      heat: {
        slug: 'heat-insurance',
        identity: { name: { en: 'The Shade Seeker', es: 'Sombrita, Por Favor' } },
        card: {
          headline: { en: 'My Seminole issue: heat and insurance.', es: 'Mi tema en Seminole: el calor y los seguros.' },
          subline: { en: 'Average home insurance here: $3,545 a year. Find your issue.', es: 'Seguro de vivienda promedio aquí: $3,545 al año. Encuentra tu tema.' },
          factRef: 'heat.insurance-premium'
        }
      },
      repro: {
        slug: 'reproductive-freedom',
        character: false,   // stays plain, calm template, no identity (genz-brand-14)
        card: {
          headline: { en: 'My Seminole issue: reproductive freedom.', es: 'Mi tema en Seminole: la libertad reproductiva.' },
          subline: { en: 'More than 60% of Seminole voters said yes to protecting abortion access in 2024. Find your issue.', es: 'Más del 60% de los votantes de Seminole dijo sí a proteger el acceso al aborto en 2024. Encuentra tu tema.' },
          factRef: 'repro.amendment-4-seminole'
        }
      },
      lgbtq: {
        slug: 'lgbtq-freedom',
        identity: { name: { en: 'Come As You Are', es: 'Ven Como Eres' } },
        card: {
          headline: { en: 'My Seminole issue: LGBTQ+ freedom.', es: 'Mi tema en Seminole: la libertad LGBTQ+.' },
          subline: { en: 'Safe, respected and left alone to live. Find your issue.', es: 'Seguridad, respeto y libertad para vivir en paz. Encuentra tu tema.' }
        }
      },
      schools: {
        slug: 'freedom-to-read',
        identity: { name: { en: 'The Card-Carrying Reader', es: 'Ratón de Biblioteca' } },
        card: {
          headline: { en: 'My Seminole issue: the freedom to read.', es: 'Mi tema en Seminole: la libertad para leer.' },
          subline: { en: 'Seminole schools pulled 30+ books in 2023. Find your issue.', es: 'Las escuelas de Seminole retiraron más de 30 libros en 2023. Encuentra tu tema.' },
          factRef: 'schools.scps-31-books'
        }
      },
      wages: {
        slug: 'wages',
        identity: { name: { en: 'The Living-Wage Legend', es: 'Quincena Digna' } },
        card: {
          headline: { en: 'My Seminole issue: wages.', es: 'Mi tema en Seminole: los sueldos.' },
          subline: { en: '$15 minimum. $25.52 living wage. Find your issue.', es: 'Mínimo: $15. Salario digno: $25.52. Encuentra tu tema.' },
          factRef: 'wages.living-wage'
        }
      },
      transit: {
        slug: 'transit',
        identity: { name: { en: 'The SunRail Romantic', es: 'Modo SunRail' } },
        card: {
          headline: { en: 'My Seminole issue: transit.', es: 'Mi tema en Seminole: el transporte.' },
          subline: { en: '4 SunRail stations. 0.5% of us take transit to work. Find your issue.', es: '4 estaciones de SunRail. Solo el 0.5% va al trabajo en transporte público. Encuentra tu tema.' },
          factRef: 'transit.commute-modes'
        }
      },
      water: {
        slug: 'clean-water',
        identity: { name: { en: 'The Lake Keeper', es: 'Alma de Manantial' } },
        card: {
          headline: { en: 'My Seminole issue: clean water.', es: 'Mi tema en Seminole: el agua limpia.' },
          subline: { en: 'Lake Jesup has had a state cleanup plan since 2010. Find your issue.', es: 'El lago Jesup tiene un plan estatal de limpieza desde 2010. Encuentra tu tema.' },
          factRef: 'water.lake-jesup'
        }
      },
      voting: {
        slug: 'voting-rights',
        identity: { name: { en: 'Ballot Ready', es: 'Boleta Lista' } },
        card: {
          headline: { en: 'My Seminole issue: voting rights.', es: 'Mi tema en Seminole: el derecho al voto.' },
          // first two sentences of the required mail-ballot shape (docs/research/00), verbatim
          subline: { en: 'Asked for a mail ballot before Nov 3? That request ends Dec 31. Find your issue.', es: '¿Pediste la boleta por correo antes del 3 de noviembre? Esa solicitud vence el 31 de diciembre. Encuentra tu tema.' },
          sublineAfter: {
            date: '2027-01-01',
            en: 'Student IDs no longer count at the polls (it’s being challenged in court). Find your issue.',
            es: 'La identificación de estudiante ya no sirve para votar en persona (la medida está impugnada en los tribunales). Encuentra tu tema.',
            factRef: 'voting.student-id'
          },
          factRef: 'voting.mail-ballot-expires'
        }
      }
    }
  },

  // ===================================================================== HOW DO YOU SHOW UP?
  organizerEra: {
    id: 'show-up',
    slug: 'show-up',
    title: { en: 'How do you show up?', es: '¿Cuál es tu modo de organizar?' },
    intro: {
      en: '8 quick questions. No wrong answers, and every type has a spot on the team.',
      es: '8 preguntas rápidas. No hay respuestas incorrectas, y cada tipo tiene su lugar en el equipo.'
    },
    cta: { en: 'Show me my type', es: 'Muéstrame mi modo' },
    privacy: {
      en: 'We don’t save your answers. If you share, only your result goes with it.',
      es: 'No guardamos tus respuestas. Si compartes, solo se comparte tu resultado.'
    },
    shuffleOptions: true,

    questions: [
      {
        id: 'friday',
        prompt: { en: 'Friday night. Your ideal plan?', es: 'Viernes en la noche. ¿Tu plan ideal?' },
        options: [
          { id: 'music', label: { en: 'Wherever the music is loudest', es: 'Donde la música esté más alta' }, scores: { hype: 2, plusone: 1 } },
          { id: 'poll', label: { en: 'Making the plan and sending the group a poll', es: 'Armar el plan y mandarle una encuesta al grupo' }, scores: { chat: 2, data: 1 } },
          { id: 'project', label: { en: 'A cozy night with a project (and a tracker for it)', es: 'Una noche tranquila con un proyecto (y su tabla de seguimiento)' }, scores: { data: 2, chat: 1 } },
          { id: 'downtown', label: { en: 'Walking downtown Sanford, talking to whoever', es: 'Caminar por el centro de Sanford, conversando con quien sea' }, scores: { doors: 2, hype: 1 } },
          { id: 'filming', label: { en: 'Filming the whole night for my close friends', es: 'Grabar toda la noche para mis amistades cercanas' }, scores: { creator: 2, doors: 1 } },
          { id: 'someone-new', label: { en: 'Bringing someone new to whatever we’re doing', es: 'Llevar a alguien nuevo a lo que sea que hagamos' }, scores: { plusone: 2, creator: 1 } }
        ]
      },
      {
        id: 'chat-role',
        prompt: { en: 'In the group chat, you’re the one who…', es: 'En el chat de grupo, tú eres quien…' },
        options: [
          { id: 'were-going', label: { en: 'Sends the “WE’RE GOING” text', es: 'Manda el “NOS VEMOS ALLÁ”' }, scores: { hype: 2, chat: 1 } },
          { id: 'birthdays', label: { en: 'Remembers every deadline and birthday', es: 'Se acuerda de cada fecha límite y cada cumpleaños' }, scores: { chat: 2, data: 1 } },
          { id: 'shared-doc', label: { en: 'Makes the shared doc everyone ends up using', es: 'Hace el documento compartido que al final todo el mundo usa' }, scores: { data: 2, creator: 1 } },
          { id: 'call', label: { en: 'Would honestly rather just call', es: 'La verdad, prefiere llamar' }, scores: { doors: 2, plusone: 1 } },
          { id: 'memes', label: { en: 'Posts the memes', es: 'Manda los memes' }, scores: { creator: 2, hype: 1 } },
          { id: 'adds-people', label: { en: 'Keeps adding new people to the chat', es: 'Sigue agregando gente nueva al chat' }, scores: { plusone: 2, doors: 1 } }
        ]
      },
      {
        id: 'directions',
        prompt: { en: 'Someone on the Sanford Riverwalk asks you for directions. You…', es: 'Alguien en el Riverwalk de Sanford te pide indicaciones. Tú…' },
        options: [
          { id: 'walk-them', label: { en: 'Walk them there and hype up downtown on the way', es: 'Vas con esa persona hasta allá y le recomiendas medio centro en el camino' }, scores: { hype: 2, doors: 1 } },
          { id: 'pin', label: { en: 'Drop a pin, then send a backup pin', es: 'Mandas la ubicación, y luego una de respaldo' }, scores: { chat: 2, data: 1 } },
          { id: 'route', label: { en: 'Give the fastest route, the parking situation and the hours', es: 'Le das la ruta más rápida, dónde estacionar y el horario' }, scores: { data: 2, chat: 1 } },
          { id: 'twenty-min', label: { en: 'End up talking for 20 minutes', es: 'Terminan conversando 20 minutos' }, scores: { doors: 2, plusone: 1 } },
          { id: 'photo-spot', label: { en: 'Point out the best photo spot', es: 'Le dices cuál es el mejor lugar para fotos' }, scores: { creator: 2, hype: 1 } },
          { id: 'introduce', label: { en: 'Introduce them to a friend who lives nearby', es: 'Le presentas a una amistad que vive cerca' }, scores: { plusone: 2, creator: 1 } }
        ]
      },
      {
        id: 'superpower',
        prompt: { en: 'Pick a superpower.', es: 'Elige un superpoder.' },
        options: [
          { id: 'louder', label: { en: 'Making any room louder', es: 'Animar cualquier lugar' }, scores: { hype: 2, creator: 1 } },
          { id: 'dates', label: { en: 'Never forgetting a date', es: 'Nunca olvidar una fecha' }, scores: { chat: 2, data: 1 } },
          { id: 'pattern', label: { en: 'Finding the pattern in any mess', es: 'Encontrar el patrón en cualquier desorden' }, scores: { data: 2, chat: 1 } },
          { id: 'open-up', label: { en: 'Getting anyone to open up', es: 'Lograr que cualquiera se abra contigo' }, scores: { doors: 2, plusone: 1 } },
          { id: 'story', label: { en: 'Turning 30 seconds into a story', es: 'Convertir 30 segundos en una historia' }, scores: { creator: 2, hype: 1 } },
          { id: 'who-meets', label: { en: 'Knowing exactly who should meet who', es: 'Saber exactamente quién tiene que conocer a quién' }, scores: { plusone: 2, doors: 1 } }
        ]
      },
      {
        id: 'app',
        prompt: { en: 'Your most-used app is probably…', es: 'Tu app más usada probablemente es…' },
        options: [
          { id: 'music', icon: 'music', label: { en: 'Music, always on', es: 'La música, siempre sonando' }, scores: { hype: 2, plusone: 1 } },
          { id: 'messages', icon: 'messages', label: { en: 'Messages, obviously', es: 'Los mensajes, obvio' }, scores: { chat: 2, hype: 1 } },
          { id: 'spreadsheets', icon: 'grid', label: { en: 'Notes and spreadsheets', es: 'Notas y hojas de cálculo' }, scores: { data: 2, chat: 1 } },
          { id: 'maps', icon: 'pin', label: { en: 'Maps, because I’m always out', es: 'El mapa, porque siempre ando en la calle' }, scores: { doors: 2, data: 1 } },
          { id: 'camera', icon: 'camera', label: { en: 'Camera, no contest', es: 'La cámara, sin duda' }, scores: { creator: 2, doors: 1 } },
          { id: 'contacts', icon: 'contacts', label: { en: 'Contacts (it’s packed)', es: 'Los contactos (está lleno)' }, scores: { plusone: 2, creator: 1 } }
        ]
      },
      {
        id: 'long-meeting',
        prompt: { en: 'A meeting is running long. You’re…', es: 'Una reunión se está alargando. Tú estás…' },
        options: [
          { id: 'slow-clap', label: { en: 'Starting the slow clap to wrap it up', es: 'Empezando un aplauso lento para cerrar' }, scores: { hype: 2, creator: 1 } },
          { id: 'recap', label: { en: 'Typing the recap for whoever left early', es: 'Escribiendo el resumen para quien se fue temprano' }, scores: { chat: 2, data: 1 } },
          { id: 'agenda', label: { en: 'Timing next week’s agenda so this never happens again', es: 'Poniéndole tiempos a la agenda de la próxima semana para que no vuelva a pasar' }, scores: { data: 2, chat: 1 } },
          { id: 'snacks', label: { en: 'Chatting with the new person by the snacks', es: 'Conversando con la persona nueva junto a la comida' }, scores: { doors: 2, plusone: 1 } },
          { id: 'clip', label: { en: 'Getting a clip of the best moment', es: 'Grabando el mejor momento' }, scores: { creator: 2, hype: 1 } },
          { id: 'ride-home', label: { en: 'Making sure the new person has a ride home', es: 'Asegurándote de que la persona nueva tenga cómo volver a casa' }, scores: { plusone: 2, doors: 1 } }
        ]
      },
      {
        id: 'potluck',
        prompt: { en: 'Potluck at the park. What are you bringing?', es: 'Comida compartida en el parque. ¿Qué llevas?' },
        options: [
          { id: 'speaker', label: { en: 'The speaker and the playlist', es: 'La música y el altavoz' }, scores: { hype: 2, plusone: 1 } },
          { id: 'sign-up', label: { en: 'The sign-up sheet, so we don’t end up with six bags of chips', es: 'La lista de quién trae qué, para no terminar con seis bolsas de papas' }, scores: { chat: 2, data: 1 } },
          { id: 'labeled', label: { en: 'A labeled dish with the ingredients listed', es: 'Un plato con etiqueta y la lista de ingredientes' }, scores: { data: 2, chat: 1 } },
          { id: 'myself', label: { en: 'Myself. I’m here to talk to people', es: 'A mí. Vengo a conversar con la gente' }, scores: { doors: 2, hype: 1 } },
          { id: 'photogenic', label: { en: 'The dish that looks amazing on camera', es: 'El plato que se ve increíble en cámara' }, scores: { creator: 2, doors: 1 } },
          { id: 'two-friends', label: { en: 'Two extra friends (and two extra chairs)', es: 'Dos amistades más (y dos sillas más)' }, scores: { plusone: 2, creator: 1 } }
        ]
      },
      {
        id: 'proudest',
        weight: 1.5,
        prompt: { en: 'After a big day, what makes you proudest?', es: 'Después de un gran día, ¿qué te da más orgullo?' },
        options: [
          { id: 'packed', label: { en: 'The room was packed and loud', es: 'El lugar se llenó y hubo muy buen ambiente' }, scores: { hype: 2, plusone: 1 } },
          { id: 'on-time', label: { en: 'Everyone showed up on time because of my reminders', es: 'Todo el mundo llegó a tiempo gracias a mis recordatorios' }, scores: { chat: 2, data: 1 } },
          { id: 'numbers', label: { en: 'The numbers added up, and we can show our work', es: 'Los números cuadraron, y podemos demostrarlo' }, scores: { data: 2, chat: 1 } },
          { id: 'neighbor', label: { en: 'A neighbor I just met said they’d come next time', es: 'Alguien del barrio que acabo de conocer dijo que vendrá la próxima vez' }, scores: { doors: 2, hype: 1 } },
          { id: 'recap-video', label: { en: 'The recap video ended up in group chats all over the county', es: 'El video resumen terminó en chats de grupo por todo el condado' }, scores: { creator: 2, doors: 1 } },
          { id: 'three-friends', label: { en: 'Three friends came because I asked', es: 'Vinieron tres amistades gracias a mi invitación' }, scores: { plusone: 2, creator: 1 } }
        ]
      }
    ],

    scoring: {
      resultIds: ['hype', 'chat', 'data', 'doors', 'creator', 'plusone'],
      normalize: false,
      recency: true,
      rules: [
        'Each option gives 2 points to its main type and 1 to a second type. The last question counts 1.5x.',
        'Every type can earn the same maximum, so the highest raw total wins.',
        'On a tie, the type that led your most recent answer wins; then resultIds order.',
        'The second-ranked type is the undertone.',
        'mix = each type’s share of the total, in whole percents summing to 100 (largest remainder).'
      ]
    },

    copy: {
      matchLabel: { en: 'How you show up', es: 'Tu modo' },
      undertone: { en: '{match}, with {undertone} undertones', es: '{match}, con {undertone} de fondo' },
      mixLabel: { en: 'Your mix', es: 'Tu mezcla' },
      notQuite: { en: 'Not quite you? See your next match', es: '¿No es lo tuyo? Mira tu siguiente opción' },
      strengthsTitle: { en: 'What you bring', es: 'Lo que aportas' },
      actionsTitle: { en: 'Start here', es: 'Empieza por aquí' },
      eventsTitle: { en: 'Events made for you', es: 'Eventos hechos para ti' },
      allTypes: { en: 'Meet all 6 types', es: 'Conoce los 6 tipos' },
      shareText: { en: 'I got {match} on the Young Dems quiz “How do you show up?” What’s yours?', es: 'Me salió {match} en el quiz de los Young Dems. ¿Y a ti?' }
    },

    results: [
      {
        id: 'hype',
        slug: 'hype-captain',
        color: 'celery',
        onColor: 'ink',
        name: { en: 'The Hype Captain', es: 'La Chispa' },
        description: {
          en: ['You walk in and the room gets louder, in a good way.', 'People come because they know you’ll be there.'],
          es: ['Llegas y el ambiente se anima, para bien.', 'La gente viene porque sabe que vas a estar.']
        },
        strengths: {
          en: ['Turning a meeting into a moment', 'Getting first-timers to stay for round two', 'Emceeing without notes'],
          es: ['Convertir una reunión en un buen momento', 'Lograr que quien viene por primera vez se quede', 'Animar sin guion']
        },
        actions: [
          { type: 'event', label: { en: 'Find a room to fill', es: 'Busca un evento para animar' }, page: 'events', query: 'kind=social', demo: true },
          { type: 'join', label: { en: 'Offer to host or emcee a night', es: 'Ofrécete para organizar o animar una noche' }, page: 'join' },
          { type: 'event', label: { en: 'Bring a team to trivia night', es: 'Arma un equipo para la noche de trivia' }, page: 'events', query: 'series=trivia', demo: true }
        ],
        eventSeries: ['trivia', 'karaoke', 'mixer'],
        card: {
          headline: { en: 'I’m the Hype Captain.', es: 'Soy La Chispa.' },
          subline: { en: 'I bring the energy. You bring a friend.', es: 'Yo pongo la energía. Tú traes a alguien.' }
        }
      },
      {
        id: 'chat',
        slug: 'group-chat-general',
        color: 'sky',
        onColor: 'ink',
        name: { en: 'The Group-Chat General', es: 'Modo Admin' },
        description: {
          en: ['You know every deadline, every birthday and who still owes $12 for pizza.', 'When you say “leaving in 10,” people actually leave in 10.'],
          es: ['Te sabes cada fecha límite, cada cumpleaños y quién todavía debe $12 de la pizza.', 'Cuando dices “salimos en 10”, la gente de verdad sale en 10.']
        },
        strengths: {
          en: ['Reminders that actually land', 'Turning a maybe into a yes', 'Knowing exactly who to text'],
          es: ['Recordatorios que sí funcionan', 'Convertir un “tal vez” en un “sí”', 'Saber exactamente a quién escribirle']
        },
        actions: [
          {
            type: 'share',
            label: { en: 'Text 3 friends about Dec 31', es: 'Avísales a 3 amistades del 31 de diciembre' },
            labelAfter: {
              date: '2027-01-01',
              en: 'Text 3 friends to renew their mail ballot request',
              es: 'Avísales a 3 amistades que renueven su solicitud de boleta por correo'
            },
            page: 'vote',
            hash: 'renew-mail-ballot',
            official: 'links.vote.voteByMail'
          },
          { type: 'event', label: { en: 'Join a text-a-friend night', es: 'Únete a una noche de mensajes' }, page: 'events', query: 'series=text-bank', demo: true },
          { type: 'join', label: { en: 'Join and get your own invite link', es: 'Únete y consigue tu propio enlace de invitación' }, page: 'join' }
        ],
        eventSeries: ['text-bank', 'renew-ready'],
        card: {
          headline: { en: 'I’m the Group-Chat General.', es: 'Estoy en Modo Admin.' },
          subline: { en: 'If I texted you a deadline, it’s real.', es: 'Si te mandé una fecha, va en serio.' }
        }
      },
      {
        id: 'data',
        slug: 'spreadsheet-witch',
        color: 'violet',
        onColor: 'paper',
        name: { en: 'The Spreadsheet Witch', es: 'Magia en Celdas' },
        description: {
          en: ['You color-code for fun, and your formulas have never once broken.', 'Chaos walks in. A clean tracker walks out.'],
          es: ['Organizas por colores porque te divierte, y tus fórmulas nunca fallan.', 'Entra el caos. Sale una tabla impecable.']
        },
        strengths: {
          en: ['Turning a mess into a plan', 'Spotting the number that matters', 'Sign-in sheets that actually work'],
          es: ['Convertir un desorden en un plan', 'Ver el número que importa', 'Listas de asistencia que sí funcionan']
        },
        actions: [
          { type: 'join', label: { en: 'Help run RSVPs and sign-ins', es: 'Ayuda con las confirmaciones y la lista de asistencia' }, page: 'join' },
          { type: 'vote', label: { en: 'Learn the 2027-28 election dates', es: 'Conoce las fechas de elecciones de 2027-28' }, page: 'vote', hash: 'dates', official: 'links.vote.upcomingElections' },
          { type: 'event', label: { en: 'Help set up a renewal party', es: 'Ayuda a preparar una fiesta para renovar' }, page: 'events', query: 'series=renew-ready', demo: true }
        ],
        eventSeries: ['renew-ready', 'picnic', 'text-bank'],
        card: {
          headline: { en: 'I’m the Spreadsheet Witch.', es: 'Lo mío es Magia en Celdas.' },
          subline: { en: 'Give me chaos. I’ll give you a tracker.', es: 'Dame el caos y te devuelvo una tabla.' }
        }
      },
      {
        id: 'doors',
        slug: 'door-knock-natural',
        color: 'orange',
        onColor: 'ink',
        name: { en: 'The Door-Knock Natural', es: 'Toc, Toc' },
        description: {
          en: ['You can talk to anyone, and somehow they end up telling you their whole story.', 'Neighbors remember your name. You remember their dog’s.'],
          es: ['Hablas con cualquiera, y de alguna forma terminan contándote su vida.', 'Los vecinos se acuerdan de tu nombre. Tú, del nombre de su perro.']
        },
        strengths: {
          en: ['Listening more than talking', 'Making a stranger feel like a neighbor', 'Staying calm when someone disagrees'],
          es: ['Escuchar más de lo que hablas', 'Hacer que alguien desconocido se sienta en confianza', 'Mantener la calma cuando alguien no está de acuerdo']
        },
        actions: [
          { type: 'event', label: { en: 'Try a neighbor check-in shift (training included)', es: 'Prueba un turno de visitas al vecindario (con capacitación incluida)' }, page: 'events', query: 'series=canvass', demo: true },
          { type: 'vote', label: { en: 'Learn the 2027 ID change so you can explain it', es: 'Aprende el cambio de identificación de 2027 para poder explicarlo' }, page: 'vote', hash: 'what-id', official: 'links.vote.countyElections' },
          { type: 'event', label: { en: 'Come to a sunset walk-and-talk', es: 'Ven a una caminata al atardecer' }, page: 'events', query: 'series=sunset-walk', demo: true }
        ],
        eventSeries: ['canvass', 'sunset-walk'],
        card: {
          headline: { en: 'I’m a Door-Knock Natural.', es: 'Toc, toc: soy yo.' },
          subline: { en: 'Talking to neighbors? Honestly my favorite part.', es: '¿Hablar con los vecinos? Lo mejor del día.' }
        }
      },
      {
        id: 'creator',
        slug: 'creator',
        color: 'bubblegum',
        onColor: 'ink',
        name: { en: 'The Creator', es: 'Luces, Cámara, Acción' },
        description: {
          en: ['You can turn 30 seconds of a Tuesday meeting into something people actually watch.', 'Your camera roll is mostly B-roll, and you’re not sorry.'],
          es: ['Conviertes 30 segundos de una reunión de martes en algo que la gente sí quiere ver.', 'Tu galería está llena de tomas “por si acaso”, y no te arrepientes.']
        },
        strengths: {
          en: ['Finding the story in a normal day', 'Making a deadline look good', 'Captions people read to the end'],
          es: ['Encontrar la historia en un día normal', 'Hacer que una fecha límite se vea bien', 'Textos que la gente lee hasta el final']
        },
        actions: [
          { type: 'clip', label: { en: 'Post a 60-second take', es: 'Sube un video de 60 segundos' }, page: 'post' },
          { type: 'event', label: { en: 'Come to a creator night', es: 'Ven a una noche de video' }, page: 'events', query: 'series=creator-night', demo: true },
          { type: 'card', label: { en: 'Put yourself on the cover', es: 'Ponte en la portada' }, page: 'quiz', hash: 'cover' }
        ],
        eventSeries: ['creator-night', 'picnic', 'karaoke'],
        card: {
          headline: { en: 'I’m the Creator.', es: 'Lo mío es luces, cámara, acción.' },
          subline: { en: 'Hit record. Keep it local.', es: 'Grabo lo que pasa aquí.' }
        }
      },
      {
        id: 'plusone',
        slug: 'plus-one',
        color: 'teal',
        onColor: 'ink',
        name: { en: 'The Plus-One', es: 'Conoce a Medio Mundo' },
        description: {
          en: ['You never show up alone, and nobody you bring ever regrets it.', 'Half your friends met each other because of you.'],
          es: ['Nunca llegas sin compañía, y nadie a quien llevas se arrepiente.', 'La mitad de tus amistades se conocieron gracias a ti.']
        },
        strengths: {
          en: ['Bringing new people in', 'Introductions that stick', 'Remembering who needs a ride'],
          es: ['Traer gente nueva', 'Presentaciones que terminan en amistad', 'Acordarte de quién necesita transporte']
        },
        actions: [
          { type: 'join', label: { en: 'Join and share your invite link', es: 'Únete y comparte tu enlace de invitación' }, page: 'join' },
          { type: 'event', label: { en: 'Bring someone to a member mixer', es: 'Lleva a alguien a un encuentro de miembros' }, page: 'events', query: 'series=mixer', demo: true },
          { type: 'event', label: { en: 'Ride SunRail to a meetup with a friend', es: 'Ve en SunRail a un encuentro con alguien' }, page: 'events', query: 'series=sunrail', demo: true }
        ],
        eventSeries: ['mixer', 'sunrail', 'trivia'],
        card: {
          headline: { en: 'I’m the Plus-One.', es: 'Conozco a medio mundo.' },
          subline: { en: 'Wherever I go, I’m bringing you.', es: 'Y a donde voy, te llevo.' }
        }
      }
    ]
  }
};
