export const meta = {
  name: 'vg-verify-relaunch',
  description: 'Re-run the adversarial verifiers that were cut off by the usage cap (dynamics, market, ml, fightweek)',
  phases: [ { title: 'Verify' } ],
}
const ROOT = '/home/user/XX'
const CTX = `Context: Nov 6, 2026. Project ${ROOT}: an MMA fight simulator whose prime goal is exceptional prediction. Rules in ${ROOT}/docs/BACKLOG.md ("Evaluation rule": symmetric evaluation, no intercepts that learn corner order; "Hidden-data protocol": tune 2019-2023, select on 2024-2025, never read 2026 fights). Python 3.13 + pandas/numpy (scikit-learn, lightgbm available), node 22. Full internet. No git commits.`
const ITEMS = [
  { key: 'dynamics', files: 'tools/dynamics.py, tools/dynamics_engine.js, data/derived/dynamics.json, research/model_dynamics.md' },
  { key: 'market', files: 'tools/market.py, data/derived/market.json, data/raw/odds/, research/model_market.md' },
  { key: 'ml', files: 'tools/ml.py, data/derived/ml.json, research/model_ml.md' },
  { key: 'fightweek', files: 'tools/fightweek.py, data/derived/fightweek.json, research/data_fightweek.md' },
]
const PICK = Array.isArray(args) && args.length ? ITEMS.filter((it) => args.includes(it.key)) : ITEMS
const V = { type: 'object', properties: { verdict: { type: 'string' }, problems: { type: 'array', items: { type: 'string' } }, fixes_made: { type: 'string' } }, required: ['verdict', 'problems', 'fixes_made'] }
const out = await parallel(PICK.map((it) => () => agent(`${CTX}\n\nYou are an adversarial reviewer of the ${it.key} work (${it.files}); the original verifier was cut off by a usage limit. Assume the headline results are inflated or wrong until proven otherwise: hunt for look-ahead leakage (features using the fight itself or later data; tuning on 2024+; any 2026 data), corner-order exploitation, wrong joins (fighter order, loser-first cards, NCs/draws, namesakes), data traps (in-play or post-result prices for market data), over-claimed precision, and code bugs. Re-run the headline numbers with fresh code of your own. Fix what is wrong in place, rerun, and append a "## Verification log" to the report.`, { label: `verify:${it.key}`, phase: 'Verify', schema: V }).then((v) => ({ key: it.key, v }))))
return out.filter(Boolean)
