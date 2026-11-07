"""v501_real_rounds.py (engine v5.0.1; TRAIN only): real per fighter-round rows of the 2019-2023 backtest fights from
data/raw/ufc_fight_stats.csv (the v5 dynamics review's rounds_real.py, adopted), the data side of tools/v501_dynfit.js.
    python3 tools/v501_real_rounds.py [out]   (default data/derived/v501_real_rounds.json)
Only fights dated 2019-01-01..2023-12-31 in data/derived/backtest_dev.json are kept; no validation or vault fight is read."""
import csv, json, re, sys
ROOT = "/home/user/XX"
OUT = sys.argv[1] if len(sys.argv) > 1 else f"{ROOT}/data/derived/v501_real_rounds.json"
bt = json.load(open(f"{ROOT}/data/derived/backtest_dev.json"))
fights = {f["id"]: f for f in bt["fights"] if "2019-01-01" <= f["date"] < "2024-01-01"}
key2id = {}
with open(f"{ROOT}/data/raw/ufc_fight_results.csv", newline="") as fh:
    for r in csv.DictReader(fh):
        fid = r["URL"].strip().rstrip("/").split("/")[-1]
        if fid in fights:
            key2id[(r["EVENT"].strip(), r["BOUT"].strip())] = fid

def of(s):
    m = re.match(r"\s*(\d+)\s+of\s+(\d+)", s or "")
    return (int(m.group(1)), int(m.group(2))) if m else (0, 0)

def ctrl(s):
    m = re.match(r"\s*(\d+):(\d+)", s or "")
    return int(m.group(1)) * 60 + int(m.group(2)) if m else 0

def norm(n):
    return re.sub(r"[^a-z]", "", (n or "").lower())

rows = []
miss = set()
with open(f"{ROOT}/data/raw/ufc_fight_stats.csv", newline="") as fh:
    for r in csv.DictReader(fh):
        k = (r["EVENT"].strip(), r["BOUT"].strip())
        fid = key2id.get(k)
        if not fid:
            continue
        f = fights[fid]
        rm = re.match(r"Round (\d+)", r["ROUND"] or "")
        if not rm:
            continue
        rnd = int(rm.group(1))
        nm = norm(r["FIGHTER"])
        if nm == norm(f["A"]["name"]):
            side = 0
        elif nm == norm(f["B"]["name"]):
            side = 1
        else:
            parts = [norm(x) for x in k[1].split(" vs. ")]
            side = 0 if parts and nm == parts[0] else (1 if len(parts) > 1 and nm == parts[1] else None)
            if side is None:
                miss.add(fid)
                continue
        sl, sa = of(r["SIG.STR."])
        hl, ha = of(r["HEAD"])
        tl, ta = of(r["TD"])
        try:
            kd = int(float(r["KD"] or 0))
        except ValueError:
            kd = 0
        try:
            sub = int(float(r["SUB.ATT"] or 0))
        except ValueError:
            sub = 0
        res = f["result"]
        R = f.get("rounds") or (5 if f.get("title") else 3)
        dec = res["method"] in ("UD", "SD", "MD", "DRAW")
        fin_round = res.get("round") or R
        full = 1 if (dec or rnd < fin_round) else 0
        rows.append(dict(fid=fid, div=f["division"], R=R, rnd=rnd, side=side, full=full, sig_att=sa, sig_lnd=sl, h_lnd=hl, kd=kd,
                         td_att=ta, td_lnd=tl, ctrl=ctrl(r["CTRL"]), sub_att=sub, method=res["method"], fin_round=fin_round,
                         fin_t=res.get("time_s"), winner=res["winner"]))
json.dump({"meta": {"tool": "tools/v501_real_rounds.py", "range": ["2019-01-01", "2023-12-31"], "source": "data/raw/ufc_fight_stats.csv + data/raw/ufc_fight_results.csv", "full": "1 if the round went the full 5 minutes (decision, or an earlier round than the finish)"}, "rows": rows}, open(OUT, "w"))
print(len(rows), "rows;", len({r["fid"] for r in rows}), "fights; unmatched names in", len(miss), "fights; ids matched", len(set(key2id.values())), "of", len(fights))
