#!/usr/bin/env python3
"""Volkanovski vs Gaethje: five-round lightweight Monte Carlo (built Nov 6, 2026).

Inputs are UFC career rates from CBS Sports / UFCStats-style profiles.
Anything marked ASSUMPTION is a judgment call: change it and rerun.

Per round, each simulated fight gets:
  - takedown attempts and control time (Gaethje stands up fast)
  - standing exchanges: landed strikes drawn from each man's offense averaged
    with the other man's leakiness, adjusted for round pace, damage taken,
    and leg-kick attrition
  - knockdown risk per landed strike (from career knockdown rates), scaled
    by the defender's durability and accumulated damage; some knockdowns
    end the fight, the rest swing the round
  - three judges with shared and individual noise, 10-8s for 2+ knockdown gaps
  - corner/doctor stoppage risk between rounds once damage piles up
"""
import numpy as np

# Sourced career rates
V = dict(slpm=5.99, sapm=3.31, kd15=0.30, tdacc=0.34, tddef=0.70)  # Volkanovski
G = dict(slpm=6.29, sapm=6.83, kd15=0.67, tdacc=0.27, tddef=0.73)  # Gaethje

VOLK_PACE = np.array([1.00, 1.00, 1.02, 1.05, 1.106])  # R5 bump: UFC.com (7.52 vs 6.8 SLpM)
GAE_PACE = np.array([1.04, 1.00, 0.98, 0.95, 0.92])    # ASSUMPTION: late dip (Holloway won R5 62-18)


def run(n=200_000, seed=7,
        volk_out=0.95, volk_pow=0.85, volk_dur=1.15,  # ASSUMPTION: 155-lb tax on Volk
        gae_out=1.00, gae_pow=1.00, gae_dur=1.00,
        volk_td_att=0.8, gae_td_att=0.6,              # takedown attempts per round
        gae_judge_weight=1.10):                       # ASSUMPTION: judges credit heavier shots
    r = np.random.default_rng(seed)
    lamV = (V["slpm"] + G["sapm"]) / 2 * volk_out / 60   # Volk landed per second
    lamG = (G["slpm"] + V["sapm"]) / 2 * gae_out / 60    # Gaethje landed per second
    kdV = V["kd15"] / (V["slpm"] * 15) * volk_pow         # knockdown chance per landed strike
    kdG = G["kd15"] / (G["slpm"] * 15) * gae_pow
    pTDV = (V["tdacc"] + 1 - G["tddef"]) / 2
    pTDG = (G["tdacc"] + 1 - V["tddef"]) / 2

    dmgV = np.zeros(n); dmgG = np.zeros(n)
    durV = np.full(n, float(volk_dur)); durG = np.full(n, float(gae_dur))
    legV = np.ones(n); legG = np.ones(n)
    alive = np.ones(n, bool)
    win = np.zeros(n, np.int8)   # +1 Volk, -1 Gaethje, 0 draw
    how = np.zeros(n, np.int8)   # 1 KO/TKO, 2 sub, 3 unanimous dec, 4 split/majority dec
    rnd = np.zeros(n, np.int8)
    cards = np.zeros((n, 3, 2))
    t_strV = np.zeros(n); t_strG = np.zeros(n); t_kdV = np.zeros(n); t_kdG = np.zeros(n)

    for i in range(5):
        a = alive.copy()

        # Grappling
        tdV = r.binomial(r.poisson(volk_td_att, n), pTDV)
        tdG = r.binomial(r.poisson(gae_td_att, n), pTDG)
        ctrlV = r.gamma(np.where(tdV > 0, tdV, 1), 45.0) * (tdV > 0)  # ASSUMPTION: ~45s per takedown
        ctrlG = r.gamma(np.where(tdG > 0, tdG, 1), 40.0) * (tdG > 0)
        ground = ctrlV + ctrlG
        shrink = np.where(ground > 200, 200 / np.maximum(ground, 1e-9), 1.0)
        ctrlV *= shrink; ctrlG *= shrink
        stand = 300 - ctrlV - ctrlG

        # Striking rates after pace, damage, and leg attrition
        sV = lamV * VOLK_PACE[i] * np.clip(1 - 0.0012 * dmgV, 0.5, 1) * legV
        sG = lamG * GAE_PACE[i] * np.clip(1 - 0.0012 * dmgG, 0.5, 1) * legG
        pkV = kdV * durG * (1 + dmgG / 250)
        pkG = kdG * durV * (1 + dmgV / 250)
        pfV = np.clip(0.25 + 0.001 * dmgG, 0, 0.55)  # ASSUMPTION: share of knockdowns that end it
        pfG = np.clip(0.25 + 0.001 * dmgV, 0, 0.55)

        gnp = 2.0 / 60  # ground strikes per second from top
        koV = sV * stand * pkV * pfV + gnp * ctrlV * 0.006 * durG * (1 + dmgG / 250)
        koG = sG * stand * pkG * pfG + gnp * ctrlG * 0.006 * durV * (1 + dmgV / 250)
        subV = 0.0202 * tdV  # ~2% per Volk takedown
        subG = 0.0101 * tdG  # ~1% per Gaethje takedown
        EV = koV + subV; EG = koG + subG
        tV = r.exponential(1.0, n) / np.maximum(EV, 1e-12)
        tG = r.exponential(1.0, n) / np.maximum(EG, 1e-12)
        finV = a & (tV < 1) & (tV < tG)
        finG = a & (tG < 1) & (tG <= tV)
        subPickV = r.random(n) < subV / np.maximum(EV, 1e-12)
        subPickG = r.random(n) < subG / np.maximum(EG, 1e-12)
        win[finV] = 1; how[finV] = np.where(subPickV, 2, 1)[finV]; rnd[finV] = i + 1
        win[finG] = -1; how[finG] = np.where(subPickG, 2, 1)[finG]; rnd[finG] = i + 1
        a = a & ~finV & ~finG

        # Rounds that finish: volume, non-finishing knockdowns, scoring
        strV = r.poisson(sV * stand); strG = r.poisson(sG * stand)
        gV = r.poisson(gnp * ctrlV); gG = r.poisson(gnp * ctrlG)
        kdnV = r.poisson(sV * stand * pkV * (1 - pfV))
        kdnG = r.poisson(sG * stand * pkG * (1 - pfG))

        ptsV = strV + 0.8 * gV + 10 * kdnV + ctrlV / 20 + 1.5 * tdV
        ptsG = gae_judge_weight * strG + 0.8 * gG + 10 * kdnG + ctrlG / 20 + 1.5 * tdG
        tot = ptsV + ptsG + 1
        shared = r.normal(0, 0.07 * tot)
        kd_gap = kdnV - kdnG
        for j in range(3):
            d = ptsV - ptsG + shared + r.normal(0, 0.10 * tot + 1)
            vr = d > 0
            v_pts = np.where(vr, 10, np.where(kd_gap <= -2, 8, 9))
            g_pts = np.where(vr, np.where(kd_gap >= 2, 8, 9), 10)
            cards[:, j, 0] += np.where(a, v_pts, 0)
            cards[:, j, 1] += np.where(a, g_pts, 0)

        # Damage and attrition
        dmgG = np.where(a, dmgG + volk_pow * strV + gV + 15 * kdnV, dmgG)
        dmgV = np.where(a, dmgV + 1.25 * gae_pow * strG + gG + 15 * kdnG, dmgV)
        durG = np.where(a, durG * 1.15 ** kdnV, durG)
        durV = np.where(a, durV * 1.15 ** kdnG, durV)
        legV = np.where(a, legV * (1 - 0.004 * 0.23 * strG), legV)  # Gaethje: ~23% of strikes to legs
        legG = np.where(a, legG * (1 - 0.004 * 0.15 * strV), legG)  # ASSUMPTION: Volk ~15%
        t_strV += np.where(a, strV, 0); t_strG += np.where(a, strG, 0)
        t_kdV += np.where(a, kdnV, 0); t_kdG += np.where(a, kdnG, 0)

        # Corner / doctor stoppage between rounds
        if i < 4:
            stV = a & (r.random(n) < np.clip((dmgV - 110) / 350, 0, 0.4))
            stG = a & (r.random(n) < np.clip((dmgG - 110) / 350, 0, 0.4))
            coin = r.random(n) < 0.5
            gW = (stV & ~stG) | (stV & stG & coin)
            vW = (stG & ~stV) | (stV & stG & ~coin)
            win[gW] = -1; how[gW] = 1; rnd[gW] = i + 1
            win[vW] = 1; how[vW] = 1; rnd[vW] = i + 1
            a = a & ~gW & ~vW
        alive = a

    jv = (cards[:, :, 0] > cards[:, :, 1]).sum(1)
    jg = (cards[:, :, 1] > cards[:, :, 0]).sum(1)
    vd = alive & (jv >= 2); gd = alive & (jg >= 2)
    win[vd] = 1; how[vd] = np.where(jv == 3, 3, 4)[vd]
    win[gd] = -1; how[gd] = np.where(jg == 3, 3, 4)[gd]
    return dict(win=win, how=how, rnd=rnd, dist=alive,
                strV=t_strV, strG=t_strG, kdV=t_kdV, kdG=t_kdG)


def summarize(label, res):
    w, h, rd, dist = res["win"], res["how"], res["rnd"], res["dist"]
    pct = lambda m: 100 * m.mean()
    print(f"\n=== {label} ===")
    print(f"Volkanovski {pct(w == 1):5.1f}%  |  Gaethje {pct(w == -1):5.1f}%  |  draw {pct(w == 0):4.1f}%")
    print(f"  Volk:    KO/TKO {pct((w == 1) & (h == 1)):4.1f}  sub {pct((w == 1) & (h == 2)):4.1f}  "
          f"UD {pct((w == 1) & (h == 3)):4.1f}  split {pct((w == 1) & (h == 4)):4.1f}")
    print(f"  Gaethje: KO/TKO {pct((w == -1) & (h == 1)):4.1f}  sub {pct((w == -1) & (h == 2)):4.1f}  "
          f"UD {pct((w == -1) & (h == 3)):4.1f}  split {pct((w == -1) & (h == 4)):4.1f}")
    fin = (h == 1) | (h == 2)
    print("  Finishes by round (% of all fights):", [round(pct((rd == k) & fin), 1) for k in range(1, 6)])
    print(f"  Goes 25 min: {pct(dist):.1f}%   Volk wins those on the cards: {100 * (w[dist] == 1).mean():.1f}%")
    print(f"  Avg sig strikes landed (completed rounds): Volk {res['strV'].mean():.0f}  Gaethje {res['strG'].mean():.0f}")
    print(f"  Avg knockdowns that didn't end it: Volk {res['kdV'].mean():.2f}  Gaethje {res['kdG'].mean():.2f}")


SCENARIOS = {
    "Baseline": {},
    "155 tax (Volk smaller, older, more hittable)": dict(volk_out=0.90, volk_pow=0.75, volk_dur=1.35),
    "Gaethje's mileage (age, wrist/knee, Topuria war)": dict(gae_out=0.93, gae_pow=0.95, gae_dur=1.20),
    "Volk wrestles (2.5 shots a round)": dict(volk_td_att=2.5),
    "Islam-1 Volk (prime version at 155)": dict(volk_out=1.00, volk_pow=0.95, volk_dur=1.00),
    "Sensitivity: judges score volume only": dict(gae_judge_weight=1.00),
    "Sensitivity: judges love power": dict(gae_judge_weight=1.25),
}

if __name__ == "__main__":
    for k, (label, kw) in enumerate(SCENARIOS.items()):
        summarize(label, run(seed=100 + k, **kw))
