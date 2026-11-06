#!/usr/bin/env python3
"""Corner-symmetry test for tools/seqnet.py's network (no data cache needed; runs in a few seconds).

Checks, for random weights and random inputs, for both encoders (GRU and transformer):
- the winner logit is antisymmetric: z(A, B) = -z(B, A), so P(A) = 1 - P(B) and there is no intercept;
- the method x round head for A given A wins equals the head for B given B wins after the corner swap;
- the stat-line heads swap exactly;
- an all-equal matchup (A and B identical) gives z = 0 exactly.

    python3 tests/test_seqnet.py
"""
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "tools"))


def main():
    import torch
    torch.set_num_threads(1)
    import seqnet as S
    torch.manual_seed(0)
    n, L, d_tok, d_side, d_ctx = 64, 12, 88, 10, 6
    worst = {}
    for enc in ("gru", "tfm"):
        cfg = dict(S.DEFAULT_CFG, enc=enc)
        m = S.make_model(cfg, d_tok, d_side, d_ctx)
        m.eval()
        g = torch.Generator().manual_seed(1)
        ta = torch.randn(n, L, d_tok + 3, generator=g)
        tb = torch.randn(n, L, d_tok + 3, generator=g)
        la = torch.randint(0, L + 1, (n,), generator=g)
        lb = torch.randint(0, L + 1, (n,), generator=g)
        la[0], lb[1] = 0, 0                         # empty histories (debut-like) take the learned empty state
        sa = torch.randn(n, d_side, generator=g)
        sb = torch.randn(n, d_side, generator=g)
        ctx = torch.randn(n, d_ctx, generator=g)
        with torch.no_grad():
            z1, qa1, qb1, ea1, eb1 = m(ta, la, tb, lb, sa, sb, ctx)
            z2, qa2, qb2, ea2, eb2 = m(tb, lb, ta, la, sb, sa, ctx)
            z0, *_ = m(ta, la, ta, la, sa, sa, ctx)
        p1, p2 = torch.sigmoid(z1), torch.sigmoid(z2)
        w = {"max|z+z_swapped|": float((z1 + z2).abs().max()),
             "max|pA+pA_swapped-1|": float((p1 + p2 - 1).abs().max()),
             "max|methodA-methodB_swapped|": max(float((qa1 - qb2).abs().max()), float((qb1 - qa2).abs().max())),
             "max|statA-statB_swapped|": max(float((ea1 - eb2).abs().max()), float((eb1 - ea2).abs().max())),
             "max|z(A,A)|": float(z0.abs().max()),
             "n_params": int(sum(p.numel() for p in m.parameters()))}
        worst[enc] = w
        print(enc, w)
        assert w["max|z+z_swapped|"] < 1e-5, enc
        assert w["max|methodA-methodB_swapped|"] < 1e-5, enc
        assert w["max|statA-statB_swapped|"] < 1e-5, enc
        assert w["max|z(A,A)|"] < 1e-6, enc
        assert w["n_params"] < 1_000_000, enc
        assert float(z1.abs().max()) > 1e-4, "degenerate network (z identically 0)"
    print("seqnet symmetry test: OK")


if __name__ == "__main__":
    main()
