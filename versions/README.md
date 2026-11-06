# Frozen engine versions

One folder per measured engine version: the exact files `tools/evalv.js --version v<N>` evaluates (the engine file
names stay engine3.js / params3.js for every version; `FightEngine.VERSION` and `FightParams.version` say which).

| folder | engine | params | notes |
|---|---|---|---|
| v3/ | 3.0.0 | 3.0.0-wf-2026-11-06 | copied before any v4 edit; [selfcal] values fit to all-years priors (see data/derived/version_history.json) |
| v4/ | 4.0.0 | 4.0.0-selfcal-pre2024 | + ml/mlrates.js (the learned stat-line adapter the engine requires as ./ml/mlrates.js) |

Never edit a frozen folder: a change is a new version. Hashes are recorded in data/derived/version_history.json.
