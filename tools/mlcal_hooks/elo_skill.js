/* mlcal hook example: couple an external rating into the engine's per-fight knobs, with tunable weights.

   The harness calls matchupOpts(opts, ctx) in each worker before FightEngine.matchup(A, B, opts).
   ctx = { fight, swap, A, B, hookParams, params }: A and B are the profiles in simulation corner order
   (already swapped when the fixed-hash swap applies), hookParams holds every "hook.<name>" dimension of
   the spec. The coupling must be antisymmetric in A and B (swap the corners, the adjustments swap), so
   it cannot learn corner order (docs/BACKLOG.md, Evaluation rule).

   Here the rating is the walk-forward pre-fight Elo stored in each backtest snapshot (fighters.json carries
   the live one), d = (Elo_A - Elo_B) / 400:
     accuracy odds   A x exp(w_acc d),  B x exp(-w_acc d)
     KD power        A x exp(w_pow d),  B x exp(-w_pow d);  chin (KD susceptibility) the inverse
     takedown odds   B's shots / exp(w_td d) (via A's tdDef knob: the engine divides a man's TD success odds by
                     his opponent's tdDef), A's shots / exp(-w_td d) (via B's tdDef); i.e. the higher-rated man
                     defends takedowns better (review note, Nov 6: this line used to say "A's shots x exp(w_td d)
                     via B's tdDef", which is not what the code does; the effect is antisymmetric either way)
   Other analysts' outputs (data/derived/ratings.json, oppadj.json, durability.json) plug in the same way:
   look the fighter up by ctx.A.slug and ctx.fight.date, turn the signal into an antisymmetric knob change. */
"use strict";
module.exports = {
  matchupOpts(opts, ctx) {
    const hp = ctx.hookParams || {};
    const eA = ctx.A && ctx.A.elo, eB = ctx.B && ctx.B.elo;
    if (eA == null || eB == null || !isFinite(eA) || !isFinite(eB)) return opts;
    const d = (eA - eB) / 400;
    const sAcc = Math.exp((+hp.w_acc || 0) * d), sPow = Math.exp((+hp.w_pow || 0) * d), sTd = Math.exp((+hp.w_td || 0) * d);
    const adjA = Object.assign({}, opts.adjA || {}), adjB = Object.assign({}, opts.adjB || {});
    const mul = (o, k, f) => { o[k] = (o[k] != null && isFinite(o[k]) ? +o[k] : 1) * f; };
    mul(adjA, "acc", sAcc); mul(adjB, "acc", 1 / sAcc);
    mul(adjA, "pow", sPow); mul(adjB, "pow", 1 / sPow);
    mul(adjA, "chin", 1 / sPow); mul(adjB, "chin", sPow);
    mul(adjA, "tdDef", sTd); mul(adjB, "tdDef", 1 / sTd);   // success odds of the other man's shots are divided by tdDef
    return Object.assign({}, opts, { adjA, adjB });
  }
};
