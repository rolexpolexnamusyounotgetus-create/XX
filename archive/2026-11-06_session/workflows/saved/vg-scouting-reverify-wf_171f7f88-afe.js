export const meta = {
  name: 'vg-scouting-reverify',
  description: 'Re-verify scouting fields flagged unknown/unverified via direct fetches (batch 3)',
  phases: [ { title: 'Reverify' }, { title: 'Check' } ],
}
const ROOT = '/home/user/XX'
const SLUGS = Array.isArray(args) ? args : []
const B = 7
const batches = []
for (let i = 0; i < SLUGS.length; i += B) batches.push(SLUGS.slice(i, i + B))
const PRE = `Context: Nov 6, 2026. Project ${ROOT}: MMA simulator. Scouting files ${ROOT}/data/scouting/<slug>.json (schema ${ROOT}/docs/SCOUTING_SCHEMA.md) and dossiers ${ROOT}/research/fighters/<slug>.md were written while the web-search budget was exhausted and most news hosts were unreachable, so many fields say "unknown", "unverified", "not found" or "from search summary". The network is now fully open. DO NOT rely on the WebSearch tool (its shared budget runs out); instead search with curl: https://html.duckduckgo.com/html/?q=<url-encoded query> (generic User-Agent "Mozilla/5.0 (FightLabSim/1.0)"; never an email; ~1 request/second) and fetch the result pages directly (ufc.com may 403 — use espn.com, sherdog.com, tapology.com (may 403), mmafighting.com, mmajunkie.usatoday.com, bloodyelbow.com, cagesidepress.com, en.wikipedia.org via its API with a User-Agent). Also check the photo-based likeness sheet ${ROOT}/data/likeness/<slug>.json if it exists (it is the better source for appearance; copy its hair/facial hair/skin/tattoo conclusions into the scouting appearance block with a pointer). For each fighter: resolve every unknown/unverified item you can (current status as of Nov 6, 2026: title, official UFC ranking or reputable mirror with date, active/retired, next booked fight with event/date, injuries; pro record; appearance: hair, facial hair, skin, tattoos, typical kit), cite the page URLs, and keep anything still unconfirmed explicitly marked. Update the JSON (validate against the schema) and the dossier. No git commits.`
const S = { type: 'object', properties: { updated: { type: 'array', items: { type: 'string' } }, still_unknown: { type: 'array', items: { type: 'string' } } }, required: ['updated', 'still_unknown'] }
const out = await pipeline(batches,
  (b) => agent(`${PRE}\n\nFighters: ${b.join(', ')}`, { label: `reverify:${b[0]}+${b.length - 1}`, phase: 'Reverify', schema: S }),
  (r, b) => r && agent(`${PRE}\n\nYou are the checker for: ${b.join(', ')}. Re-open the cited pages for every field changed in this pass (git -C ${ROOT} diff -- data/scouting research/fighters) and confirm each one; revert or mark anything the source doesn't support; validate the JSON. Report.`, { label: `check:${b[0]}+${b.length - 1}`, phase: 'Check', schema: S }).then((c) => ({ b, r, c })))
return out.filter(Boolean).map((o) => ({ batch: o.b, still_unknown: (o.c || o.r).still_unknown }))
