# Pre-lock check: UFC Fight Night: Cortes-Acosta vs. Walker (UFC Vegas 124), Nov 7, 2026

Checked Sat Nov 7, 2026, from about 2:00 pm to 2:10 pm UTC. The lock is 10:00 pm UTC (prelims, 2026-11-07T22:00Z).
No bout had started and no outcome information existed.

**Decision: keep v1. No superseding file.** The scored file stays
`2026-11-07_ufc-fight-night-cortes-acosta-vs-walker.json` (fwd-4.1, commit 87e0050, card as_of
2026-11-06T21:13:10Z, odds snapshot 20261106-2118). That file was not touched.

## Rule (fixed before any new data was read)

Supersede with `python3 tools/forward_ledger.py predict --event 2026-11-07 --supersede` (fwd-4.1, 20,000 sims per corner
order) if and only if:

- (a) a bout was cancelled, replaced or added since the v1 card snapshot, confirmed by at least two independent
  current sources; or
- (b) a remaining bout's consensus no-vig probability moved by 0.04 or more between the v1 snapshot and a fresh one.

Engine changes are not a reason to supersede: the engine stays v4.

"Consensus no-vig p_a" means the market block's `p_a_consensus`, which is the snapshot's `consensus.p_consensus`: the
logit-mean of per-book Shin no-vig over the sportsbooks. It was fixed before the fresh snapshot was taken. Two other
moves are shown for robustness only: `p_a_novig`, the BestFightOdds-mean multiplicative no-vig (the ledger's
`market_novig` benchmark), and `p_a_open_stack_input`, the line fed to the primary `ml2_stack_open`.

## (a) Card: no change since 2026-11-06T21:13Z

| Source | Fetched (UTC) | What it shows |
|---|---|---|
| ESPN scoreboard / fightcenter feed (event 600061268) | about 2:00 pm | 14 bouts, all "Scheduled". Same pairs, same prelim (22:00Z) / main (01:00Z) split. |
| Sherdog event page (UFC Fight Night 293) | about 2:03 pm | Same 28 fighters in the same 14 pairs. |
| MMA Fighting schedule | about 2:03 pm | Same 14 bouts in the same order and split (main 8 p.m. ET, prelims 5 p.m. ET). |
| Wikipedia event page | about 2:03 pm | Last edited Nov 4, 11:52 pm UTC. Nothing new. |
| Odds sources (fightodds.io, BestFightOdds, Action Network, Covers) in snapshot 20261107-1404 | 2:04 to 2:06 pm | No Vegas 124 bout outside the card's 14. The 5 unmatched source bouts all belong to other events. |
| News search (Sherdog, MMAmania, Bloody Elbow, Cageside Press, ESPN) | about 2:05 pm | Only the pre-snapshot changes: Bonfim-Brady cancelled Oct 29, Cortes-Acosta-Walker the new main event, Calderon for Brennan. All of them are already in `cards_upcoming.json` `removed`. |

UFC.com could not be reached from this session: curl got HTTP 403, and the host is outside the fetch tool's allowed
network. MMA Junkie and Tapology also refused (402 / 403).

`cards_upcoming.json` was not refreshed because nothing changed.

## (b) Market: largest move 0.0056

v1 is `market.p_a_consensus` from snapshot 20261106-2118, captured 9:20 pm UTC Nov 6. The fresh value is the same
field from snapshot 20261107-1404, captured 2:06 pm UTC Nov 7, about 7.9 h before the lock. Both are oriented to the
card's (a, b) by `forward_ledger.market_for`. No bout was flipped, and the v1 values re-derive exactly from their
snapshot.

| Bout (a vs b) | v1 | fresh | diff | BFO-mean diff | open-stack input diff | books (v1 to fresh) |
|---|---|---|---|---|---|---|
| Waldo Cortes-Acosta vs Johnny Walker | 0.6752 | 0.6735 | -0.0017 | -0.0024 | -0.0017 | 20 to 20 |
| Tatiana Suarez vs Virna Jandiroba | 0.6503 | 0.6447 | -0.0056 | +0.0008 | -0.0045 | 21 to 21 |
| Davey Grant vs Elijah Smith | 0.2588 | 0.2607 | +0.0019 | -0.0009 | +0.0008 | 22 to 21 |
| Billy Elekana vs Lucas Fernando | 0.2508 | 0.2503 | -0.0005 | -0.0096 | -0.0013 | 22 to 21 |
| Priscila Cachoeira vs Nina Nikolija Milošević | 0.1861 | 0.1823 | -0.0038 | -0.0048 | -0.0040 | 21 to 21 |
| Mitch Raposo vs Marcos Degli | 0.3184 | 0.3175 | -0.0009 | -0.0016 | -0.0012 | 21 to 21 |
| Keiichiro Nakamura vs Ollie Schmid | 0.7583 | 0.7565 | -0.0018 | +0.0015 | -0.0014 | 21 to 21 |
| Gabriel Lourenço vs Thomas Petersen | 0.3920 | 0.3961 | +0.0041 | +0.0007 | +0.0034 | 20 to 20 |
| Karine Silva vs Gabriella Fernandes | 0.6720 | 0.6691 | -0.0029 | +0.0003 | -0.0023 | 21 to 22 |
| José Mauro Delano vs Murtazali Magomedov | 0.5167 | 0.5221 | +0.0054 | -0.0023 | +0.0050 | 21 to 22 |
| Austin Bashi vs Carlos Calderon | 0.8397 | 0.8452 | +0.0055 | +0.0081 | +0.0047 | 19 to 19 |
| Mantas Kondratavičius vs Andre Petroski | 0.7333 | 0.7337 | +0.0004 | +0.0036 | +0.0005 | 20 to 20 |
| Ko Seok-hyeon vs Wellington Turman | 0.8528 | 0.8534 | +0.0006 | +0.0011 | +0.0010 | 21 to 21 |
| Jonny Parsons vs José Henrique Souza | 0.3194 | 0.3215 | +0.0021 | -0.0020 | +0.0015 | 20 to 20 |

- The largest absolute move in consensus no-vig is 0.0056 (Suarez vs Jandiroba). The threshold is 0.04.
- The robustness columns are also far under the threshold: 0.0096 at most on the BFO mean, 0.0050 on the open-stack input.

## Result

Neither (a) nor (b) holds, so the rule does not fire. v1 is the file that gets scored.

This check wrote two files under `data/predictions`: this note and `odds_snapshot_20261107-1404.json`. The snapshot
tool also rebuilt `data/derived/odds_upcoming.json`, its timeline. The UA was the tool's own "FightLabSim/1.0 (private
research)" and "FightLabSim/1.0" for the direct fetches.
