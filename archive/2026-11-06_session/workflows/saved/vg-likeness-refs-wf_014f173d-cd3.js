export const meta = {
  name: 'vg-likeness-refs',
  description: 'Gather reference photos per fighter (Commons first; others reference-only), then write detailed likeness sheets with MakeHuman morph targets; fact-check each',
  phases: [
    { title: 'Gather', detail: 'photos + likeness sheet per fighter batch' },
    { title: 'Check', detail: 'a second agent re-looks at the photos and corrects the sheet' },
  ],
}
const ROOT = '/home/user/XX'
const SLUGS = Array.isArray(args) ? args : []
const BATCH = SLUGS.length <= 2 ? 1 : 4
const batches = []
for (let i = 0; i < SLUGS.length; i += BATCH) batches.push(SLUGS.slice(i, i + BATCH))
log(`${SLUGS.length} fighters in ${batches.length} batches`)
const MORPHS = 'head/head-scale-horiz-*, head/head-scale-vert-*, head/head-scale-depth-*, head/head-fat-*, head/head-oval|round|square|invertedtriangular, forehead/*, chin/chin-bones-*, chin/chin-width-*, chin/chin-height-*, chin/chin-prominent-*, chin/chin-cleft-*, cheek/l|r-cheek-bones-*, cheek/l|r-cheek-volume-*, eyes/* (scale, height2, trans in/out/up/down, corner1, epicanthus, bag), eyebrows/* (trans up/down, angle, forward/backward), nose/* (scale horiz/vert/depth, width1, hump, point up/down, point-width, nostrils-width, flaring), mouth/* (scale, trans, lip volumes, cupidsbow, angles, depth, dimples), ears/* (scale, rot, lobe, shape-pointed), neck/neck-scale-*, torso/measure-shoulder-dist-*, torso/measure-waist-circ-*, torso/measure-hips-circ-*, torso/torso-vshape-*, buttocks/*, macro sex/age/muscle/weight/height/proportions (leave africanM/asianM/caucasianM at their neutral defaults)'
const PRE = `Context: Nov 6, 2026. Project ${ROOT}: a 3D MMA fight simulator whose fighters are realistic MakeHuman (CC0) avatars shaped by morph targets (other agents are building src/avatar3d.js right now). The user wants strong likeness of the real fighters. Your job: build the reference layer for the fighters listed below.
Network: this machine now has full internet. Wikimedia needs a User-Agent header (use "FightLabSim/1.0 (private research tool)"; never put any email in it) or it returns 429; respect rate limits (sleep ~1 s between requests). Use web search (load WebSearch via ToolSearch "select:WebSearch") and WebFetch/curl to find photos.
For each fighter:
1. Collect 4-8 good reference photos: front-facing headshot, three-quarter face, profile if possible, full body in fight shorts (physique), and one recent (2025-2026) photo. Prefer Wikimedia Commons (search the Commons API: https://commons.wikimedia.org/w/api.php?action=query&list=search&srsearch=<name>&srnamespace=6&format=json, then imageinfo with iiprop=url|extmetadata&iiurlwidth=1200 for licence/author). Photos from other sites (news, promotions, Sherdog etc.) are allowed for REFERENCE ONLY: save them locally but mark them reference-only. Save to ${ROOT}/assets/reference/<slug>/ (jpg/png/webp; these are gitignored) and write ${ROOT}/assets/reference/<slug>/sources.json: [{file, url, page, author, license, date_taken, use: "embed-ok" (only CC0/PD/CC-BY/CC-BY-SA with attribution) or "reference-only", what: "headshot|3q|profile|body|action"}].
2. LOOK at every photo (Read the image file) and write ${ROOT}/data/likeness/<slug>.json: { slug, name, as_of, photos_used: [files], face: { shape, jaw, chin, cheekbones, brow_ridge, forehead, eyes (shape, spacing, colour), eyebrows (thickness, shape, colour), nose (length, width, bridge, hump, tip, any fight damage), mouth/lips, ears (size, cauliflower ear?), notable marks/scars }, hair: { style, length_cm, colour_hex, hairline, texture }, facial_hair: { type (none/stubble/short beard/full beard/moustache/goatee), colour_hex, density, shape }, skin: { tone_hex (sample from well-lit skin in 2+ photos, report each sample and the average), undertone, freckles/marks }, body: { build, body_fat (lean/average), shoulders, chest, arms, waist, legs/calves, posture, notable physique traits }, tattoos: [ { where, description, size } ] (only what is clearly visible; say none if none visible), kit: { typical shorts colours/brands seen }, morphs: { "<morph name>": value 0..1, ... } (your best estimate of MakeHuman slider values for this person, using ONLY these morph names: ${MORPHS}; macro values: sexM 1 for men, ageOldM/ageYoungM from age, muscleUpM, weightUpM/weightDownM, heightUpM/heightDownM, proportionsUpM), notes: "how confident, what to watch for" }.
Be concrete and visual, describe what is in the photos, never guess features from ethnicity, and keep descriptions neutral and respectful. If a fighter has few photos, say so. Do not edit files outside assets/reference/ and data/likeness/. No git commits.`

const SCHEMA = { type: 'object', properties: {
  done: { type: 'array', items: { type: 'object', properties: { slug: { type: 'string' }, photos: { type: 'number' }, embed_ok: { type: 'number' }, confidence: { type: 'string' } }, required: ['slug', 'photos', 'embed_ok', 'confidence'] } },
  problems: { type: 'array', items: { type: 'string' } },
}, required: ['done', 'problems'] }

const out = await pipeline(
  batches,
  (b) => agent(`${PRE}\n\nFighters (slugs from ${ROOT}/data/derived/fighters.json): ${b.join(', ')}`, { label: `likeness:${b[0]}${b.length > 1 ? '+' + (b.length - 1) : ''}`, phase: 'Gather', schema: SCHEMA }),
  (r, b) => r && agent(`${PRE}\n\nYou are the second pair of eyes for: ${b.join(', ')}. Open every photo in ${ROOT}/assets/reference/<slug>/ yourself and compare against ${ROOT}/data/likeness/<slug>.json. Correct anything the photos don't support (hair, facial hair, tattoos, skin samples, build, nose/ears), check the licence labels in sources.json against the source pages (anything not clearly CC0/PD/CC-BY/CC-BY-SA must be "reference-only"), make sure the morph names are valid and values in 0..1, and add photos if fewer than 4 were found. Fix in place and report.`, { label: `check:${b[0]}${b.length > 1 ? '+' + (b.length - 1) : ''}`, phase: 'Check', schema: SCHEMA }).then((c) => ({ b, r, c })),
)
return out.filter(Boolean).map((o) => ({ batch: o.b, done: o.c ? o.c.done : o.r.done, problems: [...o.r.problems, ...((o.c && o.c.problems) || [])] }))
