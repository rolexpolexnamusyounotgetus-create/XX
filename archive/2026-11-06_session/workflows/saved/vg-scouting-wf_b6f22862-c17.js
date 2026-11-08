export const meta = {
  name: 'vg-scouting',
  description: 'In-depth scouting dossiers for big-name UFC fighters (status, style, techniques, appearance), each batch adversarially fact-checked',
  phases: [
    { title: 'Scout', detail: 'one researcher per batch of fighters' },
    { title: 'Check', detail: 'one fact-checker per batch' },
  ],
}
const ROOT = '/home/user/XX'
const SLUGS = Array.isArray(args) ? args : []
const BATCH = 5
const batches = []
for (let i = 0; i < SLUGS.length; i += BATCH) batches.push(SLUGS.slice(i, i + BATCH))
log(`${SLUGS.length} fighters in ${batches.length} batches`)

const PRE = `Context: today is Friday, Nov 6, 2026. Project ${ROOT}: a data-driven MMA fight simulator (any two UFC fighters; 3D animated). The statistical profile of every fighter already comes from the UFC stats snapshot in ${ROOT}/data/derived/fighters.json (look up each fighter there by slug: record, recent fights, height/reach/stance, Elo). Your job is the qualitative, current layer that stats can't give: status, style, signature techniques and appearance, for the fighters listed below.
Read ${ROOT}/docs/SCOUTING_SCHEMA.md and follow it exactly: write one JSON file per fighter at ${ROOT}/data/scouting/<slug>.json and one markdown dossier at ${ROOT}/research/fighters/<slug>.md (300-700 words: current status with dates, recent fights with how they were won/lost, style breakdown, strengths, weaknesses, durability, cardio, what the numbers in fighters.json say about him/her, and a sources list).
Rules: search the web for every fighter (load the WebSearch tool via ToolSearch "select:WebSearch"; use mode "standard", "extended" for recent/niche facts; use WebFetch if available). Events after mid-2026 are beyond most training data, so verify current status (titles, rankings, retirements, injuries, bookings) on the web and against the recent fights in fighters.json; never rely on memory for them. Cite URLs. Never invent stats, quotes, injuries, tattoos or kit colours; write null or "unknown" if you can't confirm. Use tags only from the schema's TAGS list and an archetype from ARCHETYPES. For "moves" weights, base them on scouting sources and the fighter's target split in fighters.json (head/body/leg shares from the sums) and say how in "notes". Appearance: describe build, hair, facial hair and skin tone from widely published photos/descriptions in neutral terms for an avatar; skip tattoos unless a source describes them. Fighters' pronouns: use he/him or she/her as the fighter's own coverage does. Do not edit any file outside data/scouting/ and research/fighters/. No git commits.`

const SCOUT_SCHEMA = { type: 'object', properties: {
  written: { type: 'array', items: { type: 'string' } },
  headlines: { type: 'array', items: { type: 'object', properties: { slug: { type: 'string' }, status: { type: 'string' }, archetype: { type: 'string' }, confidence: { type: 'string' } }, required: ['slug', 'status', 'archetype', 'confidence'] } },
  uncertain: { type: 'array', items: { type: 'string' } },
}, required: ['written', 'headlines', 'uncertain'] }
const CHECK_SCHEMA = { type: 'object', properties: {
  checked: { type: 'array', items: { type: 'object', properties: { slug: { type: 'string' }, verdict: { type: 'string' }, fixes: { type: 'string' } }, required: ['slug', 'verdict', 'fixes'] } },
  schema_ok: { type: 'boolean' },
}, required: ['checked', 'schema_ok'] }

const out = await pipeline(
  batches,
  (b, _, i) => agent(`${PRE}\n\nFighters (slugs): ${b.join(', ')}\n\nReturn the structured summary.`, { label: `scout:${b[0]}+${b.length - 1}`, phase: 'Scout', schema: SCOUT_SCHEMA }),
  (res, b) => res && agent(`${PRE}\n\nYou are an adversarial fact-checker for the scouting files of: ${b.join(', ')} (in ${ROOT}/data/scouting/ and ${ROOT}/research/fighters/). Assume errors exist. For each fighter: re-verify the status block (title, ranking, active, next fight, injuries) with independent web searches dated as recently as possible; check the most recent fight result against ${ROOT}/data/derived/fighters.json; spot-check two style/signature claims against their sources; delete any appearance detail (tattoos, kit) that no source supports; validate the JSON against ${ROOT}/docs/SCOUTING_SCHEMA.md (allowed tags/archetypes, required fields, slug matches fighters.json) by loading it with node or python. Fix problems in place. Return verdicts.`, { label: `check:${b[0]}+${b.length - 1}`, phase: 'Check', schema: CHECK_SCHEMA }).then((c) => ({ batch: b, res, check: c })),
)
return out.filter(Boolean).map((o) => ({ batch: o.batch, headlines: o.res.headlines, uncertain: o.res.uncertain, check: o.check }))
