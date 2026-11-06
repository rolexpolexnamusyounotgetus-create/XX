"""Reviewer helper: true pre-fight layoff (days) per backtest_dev fight from the mlrates dataset cache
(out/mlrates_cache/dataset.pkl, built by `tools/mlrates.py build`), for the with-layoff evaluator check."""
import json, os, pickle
ROOT = "/home/user/XX"
V = os.environ.get("MLRATES_REVIEW_DIR", ROOT + "/out/mlrates_review")
os.makedirs(V, exist_ok=True)
d = pickle.load(open(ROOT + "/out/mlrates_cache/dataset.pkl", "rb"))
byid = {r["id"]: r for r in d["rows"]}
lay = {f["id"]: [byid[f["id"]]["sides"][0]["layoff"], byid[f["id"]]["sides"][1]["layoff"]]
       for f in json.load(open(ROOT + "/data/derived/backtest_dev.json"))["fights"]}
json.dump(lay, open(V + "/layoff.json", "w"))
print(len(lay))
