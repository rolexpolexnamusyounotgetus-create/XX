# Frozen engine versions

One folder per measured engine version: the exact files `tools/evalv.js --version v<N>` evaluates (the engine file
names stay engine3.js / params3.js for every version; `FightEngine.VERSION` and `FightParams.version` say which).

| folder | engine | params | notes |
|---|---|---|---|
| v3/ | 3.0.0 | 3.0.0-wf-2026-11-06 | copied before any v4 edit; [selfcal] values fit to all-years priors (see data/derived/version_history.json); one validation look Nov 6 (val winner log loss 0.6424) |
| v4/ | 4.0.0 | 4.0.0-selfcal-pre2024 | + ml/mlrates.js (the learned stat-line adapter the engine requires as ./ml/mlrates.js); validated Nov 6 and kept: val winner log loss 0.6324 vs v3 0.6424, paired -0.0100 [-0.0170, -0.0030]. Current validated engine until v5's look (src/ now holds v5) |
| v5/ | 5.0.0 | 5.0.0-selfcal-pre2024 | the v5 merge on v4.0.0 (components v401, durability, dynamics, styles_sos, officials, realism_sens, embed, oppadj, preufc, blend_anchor) + Calibrate A's flags + Calibrate B's joint level pass (components.calB) and blend_anchor refits; frozen Nov 7 (research/v5_calB.md). Also holds styles_sos.js, mlpathrec.js and ml/{mlrates,embed,blend,moe,ml2,mlpage}.js (blend.js needs method/round cells or handles passed in: it cannot reach tools/methodround_model.js from here). Train numbers only so far; the Measure stage takes the single validation look |
| v4.0.1-rejected/ | 4.0.1 | 4.0.1-pre2024 | the v4 review's fixes (train-only EM judging weights, point deductions, learned-path TD/control/sub levels, cumulative takedown cap); validated Nov 6 and rejected: val winner log loss 0.6289 vs v4 0.6324, paired -0.0034 [-0.0073, +0.0008], nothing else significant. `v4.0.1` is a symlink to it. See its README.md |

Never edit a frozen folder: a change is a new version. Hashes are recorded in data/derived/version_history.json.
