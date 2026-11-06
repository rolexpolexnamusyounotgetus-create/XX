# Debut path: a dedicated model for UFC bouts with a debutant

Nov 6, 2026. Tool: `tools/debut.py`. Output: `data/derived/debut.json`. JS evaluator: `src/ml/debut.js`.
Test: `tests/test_debut.js`. Blind-test plugin: `tools/blindtest_plugins/debut.py`.

(Draft written before the single 2024-25 look; the full report replaces this file after the look.)

## Pre-registration of the single 2024-25 look (written Nov 6, 10:52 pm UTC, before `tools/debut.py holdout` runs)

Frozen by forward-chained CV on 2012-2023 (`out/debut_cache/cv.json`, sha256 prefix ff5b8cdb2659dcd2, built
2026-11-06T22:49:32Z; frame `out/debut_cache/frame.pkl` sha256 prefix 00f12a966c82463e; also in
`data/derived/debut.json` `cv`):

- Winner model: symmetric no-intercept logistic on side differences, blocks core + extra + gnet4 + promo2 + ufc
  (16 columns), C 1.0, tau 2.0.
- Stack decisions (forward-chained 2021-2023 stack CV, ml2's stack_fit and 0.0005 rule): no line = the raw debut
  model; open = stack [open, debut] (admitted, -0.0213); close = stack [close, debut] (admitted, -0.0008, marginal).
- Method: multinomial P(KO / SUB / DEC | winner) with walk-forward division base-rate offsets, lambda 30.

What is scored, once: the 172 decisive 2024-25 bouts of the debut universe (a side at 0 prior UFC bouts).
- Fits: annual walk-forward, the procedure CV used (2024 fit on 2012-2023 debut bouts, 2025 on 2012-2024).
- Primary metric: no-line winner log loss, debut model vs seeded Elo. Seeded Elo is the ledger's no-line debut
  fallback (tools/preufc.py walk-forward predictions). Paired event-cluster bootstrap, 2,000 card resamples.
- Secondaries (reported, never decisive):
  - debut model vs plain Elo, vs the open, vs the close, and vs the current fallback (the line when there is one,
    else seeded Elo);
  - the frozen stacks: [open, debut] vs the open, and [close, debut] vs the close, with weights fit on 2019..Y-1
    out-of-sample rows;
  - method: method3, method given the winner, and who x how vs division base rates x seeded Elo;
  - calibration slopes.
- Not clean: tools/preufc.py already scored these 172 bouts (its "a debutant in the bout" subgroup: seeded Elo
  0.6370), so the seeded-Elo side of the primary comparison is a seen number. No choice in this tool read a
  2024-25 row. The look is a confirmation, not a selection.
