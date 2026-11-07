# Frozen engine versions

One folder per measured engine version: the exact files `tools/evalv.js --version v<N>` evaluates (the engine file
names stay engine3.js / params3.js for every version; `FightEngine.VERSION` and `FightParams.version` say which).

| folder | engine | params | notes |
|---|---|---|---|
| v3/ | 3.0.0 | 3.0.0-wf-2026-11-06 | copied before any v4 edit; [selfcal] values fit to all-years priors (see data/derived/version_history.json); one validation look Nov 6 (val winner log loss 0.6424) |
| v4/ | 4.0.0 | 4.0.0-selfcal-pre2024 | + ml/mlrates.js (the learned stat-line adapter the engine requires as ./ml/mlrates.js); validated Nov 6 and kept: val winner log loss 0.6324 vs v3 0.6424, paired -0.0100 [-0.0170, -0.0030]. **Current validated engine** (src/ holds it again since v5, v5.0.1 and v6 were rejected on Nov 7) |
| v5-rejected/ | 5.0.0 | 5.0.0-selfcal-pre2024 | the v5 merge on v4.0.0 (components v401, durability, dynamics, styles_sos, officials, realism_sens, embed, oppadj, preufc, blend_anchor, calB); frozen Nov 7, one validation look (8:51 pm ET Nov 6) and **rejected**: val winner log loss 0.6301 vs v4 0.6324, paired -0.0022 [-0.0099, +0.0053]; stat-line deviance better on 4 of 5 stats, but KD per 100 head (+21% vs 12% tolerance) and KO share (+2.7 vs 2 pts) newly out of tolerance. Holds styles_sos.js, mlpathrec.js, ml/{mlrates,embed,blend,moe,ml2,mlpage}.js, the v5-engine tests and logs. `v5` is a symlink to it. See its README.md |
| v5.0.1-rejected/ | 5.0.1 | 5.0.1-selfcal-pre2024 | 5.0.0 + the v5 review's fixes (input guards; components.v501: durFallback, dynNoise, levels; kdBase kept L730 by a forward-chained 2019-2023 check); validated once Nov 7 (the second look at 2024-25 for the v5 lineage, pre-registered as such) and **rejected**: val winner log loss 0.6267 vs v4 0.6324, paired -0.0057 [-0.0141, +0.0023]; four stat-line deviances better after Holm, but KD per 100 head 0.827 vs 0.684 fails the paired base-rate test. `v5.0.1` is a symlink to it. See its README.md |
| v6-rejected/ | 6.0.0 | 6.0.0-selfcal-pre2024 | the v5.0.1 simulator re-bundled with review gate 1 (fold-honest learned rates / embedding recipe, Calibrate A calls and the joint level pass rerun) + cycle 1 of docs/V6_V10_PLAN.md (ML v2 blend-head stacks by line regime in FightEngine.predict, routing, S2 cells, JS tree evaluator) + lab-3 debut path and stat-line bands. Train gate passed (forward-chained 2021-23); validated once Nov 7 (pre-registered; confirmation look) and **rejected** by branch 1: open-regime winner log loss vs the v5.0.1 package 0.58193 vs 0.58438, paired -0.00245 [-0.00588, +0.00099]; engine level vs v4 -0.0065 [-0.0148, +0.0016]. `v6` is a symlink to it. See its README.md |
| v4.0.1-rejected/ | 4.0.1 | 4.0.1-pre2024 | the v4 review's fixes (train-only EM judging weights, point deductions, learned-path TD/control/sub levels, cumulative takedown cap); validated Nov 6 and rejected: val winner log loss 0.6289 vs v4 0.6324, paired -0.0034 [-0.0073, +0.0008], nothing else significant. `v4.0.1` is a symlink to it. See its README.md |

Never edit a frozen folder: a change is a new version. Hashes are recorded in data/derived/version_history.json.

v6 review (Nov 7, ~08:00 UTC): no new version. v6 stays rejected; its train gate is relabelled "failed as first run; passes
only under a comparator chosen after the failure" (docs/CHANGELOG.md "v6 review"). versions/v6-rejected/tools/ holds the
look-time harness tools.
