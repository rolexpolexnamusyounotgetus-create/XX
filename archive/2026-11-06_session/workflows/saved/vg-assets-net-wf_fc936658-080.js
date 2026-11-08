export const meta = {
  name: 'vg-assets-net',
  description: 'Download high-quality CC0 assets now that the network is open (HDRIs, PBR textures, MakeHuman hair/beards/brows/skins, MPFB2 face targets); verify licences',
  phases: [ { title: 'Fetch' }, { title: 'Verify' } ],
}
const ROOT = '/home/user/XX'
const DEST = '/tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/scratchpad/assets_net'
const PRE = `Context: Nov 6, 2026. Project ${ROOT}: 3D MMA fight simulator page (three.js r128, single self-contained HTML, total budget ~15 MB, assets later embedded as data URIs; another agent builds MakeHuman avatars in src/avatar3d.js from HumanForge's CC0 MakeHuman/MPFB2 body with a Mixamo-named rig and its own morph format; see ${ROOT}/research/assets.md). The machine now has FULL internet access (use a User-Agent like "FightLabSim/1.0" for Wikimedia/MakeHuman sites; never include an email). Download into ${DEST}/ (organised by type) with ${DEST}/manifest.json: [{file, source_url, page, author, license, license_url, bytes, notes}].`
const FETCH = `${PRE}

TASK: fetch the best CC0 (or CC-BY with attribution, flagged) assets for a broadcast-quality cage fight:
1. Poly Haven (api.polyhaven.com / dl.polyhaven.org, CC0): 3-4 indoor HDRIs suited to a dark arena or studio with overhead lights (e.g. search categories indoor/studio/night; download 1k and 2k .hdr), and PBR texture sets at 1k-2k (diffuse/normal/roughness, jpg): a woven fabric or canvas (for the octagon mat), black rubber/vinyl, brushed or painted metal, leather (gloves), concrete floor, fabric for seats.
2. ambientCG (ambientcg.com, CC0): a chain-link fence texture with alpha/opacity map, plus canvas/fabric if better than Poly Haven.
3. MakeHuman community CC0 assets (files2.makehumancommunity.org asset packs and the makehumancommunity GitHub repos; only items explicitly CC0): short male hairstyles (buzz cut, short crop, fade, short curly, bald cap), beards and stubble proxies, eyebrows, eyelashes, and higher-resolution male skin textures (light to dark tones, ideally with normal/specular maps). Note their file formats (.mhclo/.obj/.mhmat/.png) and whether they fit the MPFB2/HumanForge base mesh topology.
4. MPFB2 (github.com/makehumancommunity/mpfb2, CC0 data): the full face/body target set (src/mpfb/data/targets/...) — list what exists beyond HumanForge's 57 detail morphs (nose, mouth, eyes, ears, chin, cheeks, head shape, jaw, muscles), download the targets most useful for facial likeness, and document the format (.target / .target.gz vertex-offset lists) and how they map to the base mesh vertex indices.
5. HumanForge upstream (GitHub): any additional CC0 skins, hairstyles, brows and beards packaged for its format.
Check every licence on its source page; skip anything not CC0/CC-BY. Keep total download under ~400 MB. Return a summary listing the best picks per category with sizes.`
const R = { type: 'object', properties: { summary: { type: 'string' }, best: { type: 'array', items: { type: 'object', properties: { category: { type: 'string' }, file: { type: 'string' }, license: { type: 'string' }, bytes: { type: 'number' }, why: { type: 'string' } }, required: ['category', 'file', 'license', 'why'] } }, problems: { type: 'array', items: { type: 'string' } } }, required: ['summary', 'best', 'problems'] }
phase('Fetch')
const f = await agent(FETCH, { label: 'fetch:assets', phase: 'Fetch', schema: R })
phase('Verify')
const v = await agent(`${PRE}\n\nVerify the downloads in ${DEST}/ against manifest.json: each file exists, parses (images open, HDR headers valid, target files readable), sizes match, and each licence is confirmed CC0/CC-BY on its source page (fix the manifest; move anything unclear to ${DEST}/_unclear/). Then write ${DEST}/RECOMMENDATIONS.md: the exact files the avatar and arena code should embed, at which resolution, with estimated embedded size, staying within ~6 MB total for embedded assets. Fetcher report:\n${JSON.stringify(f).slice(0, 8000)}`, { label: 'verify:assets', phase: 'Verify', schema: R })
return { fetch: f, verify: v }
