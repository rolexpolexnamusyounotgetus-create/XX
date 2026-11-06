# Distributional stat lines (task key: statlines)

Nov 6, 2026. Tool: `tools/statlines.py` (+ `tools/statlines_engine.js`). Work in progress; this file is committed first
with the pre-registration below, before the single 2024-2025 look.

## Pre-registration of the 2024-2025 look (written 10:49 pm UTC, before `final` runs)

Frozen by forward-chained CV on 2021-2023 (folds fit on 2019..Y-1; `out/statlines_cache/cv.json`, `prereg.json`):

- **Per-stat model (JS-evaluable; no GBM won anywhere, so the overall choice is the same):** sig_att, h_att, l_att,
  d_att NB + ridge GLM (lambda 10000); sig_lnd, h_lnd, d_lnd, c_att, c_lnd, g_att, td_lnd NB + GLM (3000); b_att,
  b_lnd, l_lnd NB + GLM (30000, the grid edge, where the GLM fades toward nb_t); g_lnd, td_att, sub_att NB + GLM (300);
  kd NB with time terms (nb_t); ctrl zero-inflated Beta + GLM (300); rev NB with one shape (nb_base).
- **Winner expert:** rejected by the stack gate in all six stacks (CV gains +0.00046 to +0.00093, all worse; weight 0
  when fit through 2023). It enters nothing. Its 2024-25 numbers are reported as confirmation only.
- **What 2024-25 reports (once, models fit on 2019-2023):** per-stat conditional log score of the chosen model vs
  nb_base (blend mean, one NB shape) and vs Poisson(blend mean); Poisson deviance of the mean vs the blend and vs raw
  mlrates; PIT in80 / >P90 / <P10; engine v4 comparison (conditional-mean deviance, went-the-distance CRPS and PIT,
  unconditional CRPS, deviance and PIT).
- **Decision:** the model ships as the distributional layer if its 2024-25 conditional NLL is not worse than nb_base
  on any stat beyond the CI and PIT in80 stays within 0.78-0.82 on the large counts. Nothing is re-selected on
  2024-2025.
