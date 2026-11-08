# Session archive: Nov 6-7, 2026 (engine v4 -> v10 protocol, prediction labs, forward ledger)

Files that lived only in the session's temporary scratchpad, saved here so the work can be revisited elsewhere.

- `workflows/`: the orchestration scripts that ran the work (component builds, v5 merge, prediction labs 3-5,
  v6-v10 cycles, 3D passes). `workflows/saved/` holds every inline workflow script as the runner saved it.
  `v5_merge_args.json` is the verdict object passed to the v5 merge.
- `components/`: the roadmap component patches and reports (durability, dynamics, styles_sos, officials,
  blend_anchor, realism_sens) with their verifier notes, as applied in the v5 merge.
- `vault_2026_spent/`: the sealed 2026 fights (Jan 24 - Oct 31, 2026) and the per-fight outputs of both vault
  audits (`audit1/`, `audit2/`). BOTH ALLOWED OPENINGS ARE SPENT (research/vault_audit_v5.md,
  research/vault_audit_v10.md). This data is kept only so the audits can be reproduced. Do not use it to choose,
  tune or compare new models: it is no longer a clean test. The forward-test ledger (data/predictions/) is the only
  clean test left.

Not saved, by design: reference photos (copyrighted, local-only; each fighter's assets/reference/<slug>/sources.json
lists where to re-fetch them), raw scrape caches (data/raw/*_cache, regenerable), the agent worktrees and their local
branches (their content is in components/ and versions/).
