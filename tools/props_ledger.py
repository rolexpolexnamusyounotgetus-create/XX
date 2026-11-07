#!/usr/bin/env python3
"""props_ledger.py: props capture for the forward ledger (engine v7 work; docs/V6_V10_PLAN.md cycle 2 work item 6: "the ledger
captures props with the moneyline: same snapshot, recorded hours before the lock").

    python3 tools/props.py capture                                   # a timestamped props snapshot (data/predictions/props_snapshot_<UTC>.json)
    python3 tools/props_ledger.py --event 2026-11-14 [--props <stamp>] [--dry-run]

For the event's card (data/predictions/cards_upcoming.json) it takes the newest props snapshot taken BEFORE the card's lock
(the same rule tools/forward_ledger.py applies to odds snapshots) and writes data/predictions/<date>_<slug>.props.json next to
the ledger file: write-once (O_EXCL), read-only, refused at or after the lock. Each bout carries the de-vigged consensus oriented
to the card's a / b (the one power de-vig of training and src/ml/propspool.js; a snapshot bout listed the other way round is
mirrored), with the odds snapshot the ledger used and the time gap between the two snapshots.

Recorded, NEVER SCORED: no forward model version reads it (V6_V10_PLAN 6.4: a version that uses props needs its own
pre-registration in data/predictions/README.md first). tools/forward_ledger.py is not modified (its code hash is pinned by the
fwd-4.2 / fwd-4.3 addenda). The file name does not match the ledger-file pattern, so ledger tooling ignores it.
"""
import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import forward_ledger as FL  # noqa: E402

PROPS_KEEP = ("m6", "gd", "er", "wr", "mr", "itd", "ou", "ml", "n_books", "n_dropped")


def latest_props_snapshot(pred_dir, before, stamp=None):
    best = None
    for f in sorted(os.listdir(pred_dir)):
        if not (f.startswith("props_snapshot_") and f.endswith(".json")):
            continue
        st = f[len("props_snapshot_"):-5]
        if stamp and stamp != "auto" and st != stamp:
            continue
        d = FL.jload(os.path.join(pred_dir, f))
        t = FL.parse_utc(d["meta"]["snapshot_utc"])
        if t < before:
            best = (t, os.path.join(pred_dir, f), d)
    return best


def mirror_props(c):
    """A/B swap of a de-vigged consensus (as src/ml/blend.js mirrorProps)."""
    o = dict(c)
    if isinstance(c.get("m6"), list) and len(c["m6"]) == 6:
        o["m6"] = c["m6"][3:6] + c["m6"][0:3]
    if isinstance(c.get("wr"), list):
        K = (len(c["wr"]) - 2) // 2
        o["wr"] = c["wr"][K:2 * K] + c["wr"][0:K] + [c["wr"][2 * K + 1], c["wr"][2 * K]]
    if isinstance(c.get("mr"), list):
        K = (len(c["mr"]) - 2) // 4
        o["mr"] = c["mr"][2 * K:4 * K] + c["mr"][0:2 * K] + [c["mr"][4 * K + 1], c["mr"][4 * K]]
    if isinstance(c.get("itd"), list) and len(c["itd"]) == 2:
        o["itd"] = [c["itd"][1], c["itd"][0]]
    if isinstance(c.get("ml"), (int, float)):
        o["ml"] = 1 - c["ml"]
    return o


def capture_doc(snapp, bout_ids, odds_snap, ledger_name, lock):
    by = {x.get("bout_id"): x for x in snapp[2]["bouts"] if x.get("bout_id")}
    rows = []
    for bid in bout_ids:
        x, flip = by.get(bid), False
        if x is None and ":" in bid and "__" in bid:
            d0, rest = bid.split(":", 1)
            sa, sb = rest.split("__", 1)
            x = by.get("%s:%s__%s" % (d0, sb, sa))
            flip = x is not None
        cons = (x or {}).get("consensus") or None
        if cons and flip:
            cons = mirror_props(cons)
        rows.append({"bout_id": bid, "found": x is not None, "flipped_from_snapshot": flip,
                     "fetched_utc": (x or {}).get("fetched_utc"), "families_present": (x or {}).get("families_present"),
                     "has_method_props": bool(cons and isinstance(cons.get("m6"), list)),
                     "consensus": {k: cons[k] for k in PROPS_KEEP if k in cons} if cons else None})
    gap = round((snapp[0] - odds_snap[0]).total_seconds() / 60.0, 1) if odds_snap else None
    return {"meta": {"tool": "tools/props_ledger.py (recorded, never scored)", "ledger_file": ledger_name, "lock_utc": FL.iso(lock),
                     "props_snapshot": {"file": os.path.relpath(snapp[1], FL.ROOT), "snapshot_utc": FL.iso(snapp[0]), "sha16": FL.sha16(snapp[1])},
                     "odds_snapshot": {"file": os.path.relpath(odds_snap[1], FL.ROOT), "snapshot_utc": FL.iso(odds_snap[0])} if odds_snap else None,
                     "props_minus_odds_minutes": gap, "devig": snapp[2]["meta"].get("devig"),
                     "note": "consensus oriented to the ledger's a / b; m6 = [a KO, a SUB, a DEC, b KO, b SUB, b DEC]; no forward model "
                             "version reads this file (V6_V10_PLAN 6.4)"},
            "n_bouts": len(rows), "n_with_method_props": sum(1 for r in rows if r["has_method_props"]), "bouts": rows}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--event", required=True, help="event date (YYYY-MM-DD) or a name substring")
    ap.add_argument("--cards", default=os.path.join(FL.PRED_DIR, "cards_upcoming.json"))
    ap.add_argument("--dir", default=FL.PRED_DIR)
    ap.add_argument("--props", default="auto", help="props snapshot stamp (default: the newest before the lock)")
    ap.add_argument("--odds", default=None, help="odds snapshot stamp (default: the newest before the lock, as the ledger)")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--dry-out", default=None)
    a = ap.parse_args()
    cards = FL.load_cards(a.cards)
    ev = FL.find_event(cards, a.event)
    lock, _ = FL.lock_of(ev)
    if FL.now_utc() >= lock and not a.dry_run:
        raise SystemExit("refused: the %s card locked at %s; a capture after the lock is not a forward record" % (ev["name"], FL.iso(lock)))
    slug = FL.slugify(ev["name"])
    ledgers = sorted(f for f in os.listdir(a.dir) if FL.LEDGER_RE.match(f) and f.startswith("%s_%s" % (ev["date"], slug)))
    ledger = ledgers[-1] if ledgers else "%s_%s.json" % (ev["date"], slug)
    if ledgers:
        bout_ids = [b["bout_id"] for b in FL.jload(os.path.join(a.dir, ledger))["bouts"]]
    else:
        bout_ids = [FL.bout_id(ev["date"], b) for b in ev["bouts"]]
    snapp = latest_props_snapshot(a.dir, lock, a.props)
    if snapp is None:
        raise SystemExit("no props snapshot before the lock (run python3 tools/props.py capture first)")
    odds = FL.latest_snapshot(a.dir, lock, a.odds)
    doc = capture_doc(snapp, bout_ids, odds, ledger, lock)
    print("props capture for %s: %s, %d of %d bouts with method props (props minus odds snapshot: %s min)" % (
        ev["name"], doc["meta"]["props_snapshot"]["file"], doc["n_with_method_props"], doc["n_bouts"], doc["meta"]["props_minus_odds_minutes"]))
    if a.dry_run:
        if a.dry_out:
            json.dump(doc, open(a.dry_out, "w"), indent=1)
            print("dry run: wrote %s" % a.dry_out)
        return
    target = os.path.join(a.dir, ledger[:-5] + ".props.json")
    fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o444)
    with os.fdopen(fd, "w") as fh:
        json.dump(doc, fh, indent=1)
        fh.write("\n")
    print("wrote %s (read-only; recorded, never scored)" % os.path.relpath(target, FL.ROOT))


if __name__ == "__main__":
    main()
