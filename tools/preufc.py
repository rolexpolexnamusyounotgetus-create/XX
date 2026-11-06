#!/usr/bin/env python3
"""Pre-UFC record enrichment from Sherdog, and a walk-forward test of whether it helps predict newcomers.

Run from the project root:

    python3 tools/preufc.py crawl     # resolve + fetch Sherdog pages (cached, <= 1 request/second)
    python3 tools/preufc.py build     # parse the cache -> data/derived/preufc.json (records + snapshots)
    python3 tools/preufc.py eval      # held-out test on newcomer fights, adds predictions to preufc.json
    python3 tools/preufc.py all       # build + eval (no network)

Targets: every roster fighter in data/derived/fighters.json plus every fighter who had 0-3 prior UFC
fights in a UFC bout on or after 2019-01-01 (this covers every backtest side with n < 4, and the UFC
debuts that backtest.json leaves out). `--extra-since YYYY-MM-DD` widens the newcomer window.

Resolution of a ufcstats person to a Sherdog page:
  1. graph links: a verified Sherdog page links every opponent; an opponent row that matches one of the
     page owner's ufcstats bouts (date within 3 days, similar name) gives that opponent's Sherdog URL;
  2. otherwise Sherdog's fight finder (name, then first+last, then last name, then nickname), candidates
     ranked by name / nickname / weight and fetched until one verifies.
  A page verifies when its pro history contains the person's ufcstats bouts (date within 3 days and an
  opponent with a similar name): at least min(2, n_ufc) of them and at least half.

Raw HTML is cached under data/raw/sherdog_cache/ (gitignored) and never re-fetched.
Walk-forward rule: a snapshot for a UFC bout counts only Sherdog pro fights dated before that bout's date
(and not the same event), so every feature is known before the fight.
"""
import argparse
import datetime as dt
import difflib
import json
import math
import os
import re
import ssl
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
CACHE = os.path.join(ROOT, "data", "raw", "sherdog_cache")
DERIVED = os.path.join(ROOT, "data", "derived")
RESOLVE = os.path.join(CACHE, "resolve.json")
UA = "FightLabSim/1.0"
BASE = "https://www.sherdog.com"
MIN_GAP = 1.1                      # seconds between requests (<= 1 request/second)
CA = "/root/.ccr/ca-bundle.crt"


# ------------------------------------------------------------------ text helpers
def ascii_fold(s):
    return unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode()


def norm(s):
    s = ascii_fold(s).lower().replace("&#039;", "'").replace("&apos;", "'")
    s = re.sub(r"[^a-z0-9 ]+", " ", s.replace("'", ""))
    return re.sub(r"\s+", " ", s).strip()


def toks(s):
    return set(t for t in norm(s).split() if len(t) >= 2)


def name_sim(a, b):
    """0..1 similarity between two person names (order-insensitive, tolerant of middle names)."""
    na, nb = norm(a), norm(b)
    if not na or not nb:
        return 0.0
    if na == nb:
        return 1.0
    ta, tb = set(na.split()), set(nb.split())
    jac = len(ta & tb) / max(1, min(len(ta), len(tb)))
    r1 = difflib.SequenceMatcher(None, na, nb).ratio()
    r2 = difflib.SequenceMatcher(None, " ".join(sorted(ta)), " ".join(sorted(tb))).ratio()
    return max(jac * 0.95, r1, r2)


# ------------------------------------------------------------------ polite fetcher
class Fetcher:
    def __init__(self, offline=False):
        self.last = 0.0
        self.n = 0
        self.offline = offline
        self.ctx = ssl.create_default_context(cafile=CA) if os.path.exists(CA) else ssl.create_default_context()

    def get(self, url, path):
        if os.path.exists(path) and os.path.getsize(path) > 0:
            with open(path, encoding="utf-8", errors="replace") as fh:
                return fh.read()
        if self.offline:
            return None
        for attempt in range(4):
            wait = MIN_GAP - (time.time() - self.last)
            if wait > 0:
                time.sleep(wait)
            self.last = time.time()
            self.n += 1
            try:
                req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html"})
                with urllib.request.urlopen(req, context=self.ctx, timeout=30) as r:
                    html = r.read().decode("utf-8", errors="replace")
                os.makedirs(os.path.dirname(path), exist_ok=True)
                with open(path, "w", encoding="utf-8") as fh:
                    fh.write(html)
                return html
            except urllib.error.HTTPError as e:
                if e.code == 404:
                    with open(path, "w", encoding="utf-8") as fh:
                        fh.write("<!-- 404 -->")
                    return "<!-- 404 -->"
                time.sleep(5 * (attempt + 1) if e.code in (429, 500, 502, 503, 504) else 2)
            except Exception:
                time.sleep(3 * (attempt + 1))
        return None


def fighter_path(href):
    return os.path.join(CACHE, "fighter", href.rsplit("/", 1)[-1] + ".html")


def search_path(q):
    return os.path.join(CACHE, "search", re.sub(r"[^A-Za-z0-9]+", "_", ascii_fold(q)).strip("_")[:120] + ".html")


# ------------------------------------------------------------------ Sherdog parsing
MONTHS = {m: i for i, m in enumerate(["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct",
                                      "Nov", "Dec"], 1)}


def parse_sd_date(s):
    m = re.search(r"([A-Z][a-z]{2})\s*/\s*(\d{1,2})\s*/\s*(\d{4})", s or "")
    if not m or m.group(1) not in MONTHS:
        return None
    try:
        return dt.date(int(m.group(3)), MONTHS[m.group(1)], int(m.group(2)))
    except ValueError:
        return None


def parse_search(html):
    from bs4 import BeautifulSoup
    out = []
    if not html:
        return out
    soup = BeautifulSoup(html, "lxml")
    tab = soup.find("table", class_="fightfinder_result")
    if not tab:
        return out
    for tr in tab.find_all("tr"):
        a = tr.find("a", href=re.compile(r"^/fighter/"))
        if not a:
            continue
        tds = tr.find_all("td")
        txt = [td.get_text(" ", strip=True) for td in tds]
        nick = txt[2].strip('"') if len(txt) > 2 else ""
        lbs = None
        if len(txt) > 4:
            m = re.search(r"(\d+)\s*lbs", txt[4])
            lbs = int(m.group(1)) if m else None
        out.append({"href": a["href"], "name": a.get_text(strip=True), "nick": nick, "lbs": lbs,
                    "assoc": txt[5] if len(txt) > 5 else ""})
    return out


def method_class(m):
    m0 = (m or "").lower()
    if m0.startswith(("ko", "tko")) or "ko" in m0.split(" ")[0]:
        return "ko"
    if m0.startswith("submission") or m0.startswith("technical submission"):
        return "sub"
    if m0.startswith("decision") or m0.startswith("technical decision"):
        return "dec"
    if m0.startswith("dq") or "disqualification" in m0:
        return "dq"
    if m0.startswith("no contest") or m0.startswith("nc"):
        return "nc"
    if m0.startswith("draw"):
        return "dec"
    return "other"


def parse_fighter(html):
    """Bio + fight-history sections of one Sherdog fighter page."""
    from bs4 import BeautifulSoup
    if not html or html.startswith("<!-- 404"):
        return None
    soup = BeautifulSoup(html, "lxml")
    fn = soup.find("span", class_="fn")
    if not fn:
        return None
    bio = {"name": fn.get_text(strip=True)}
    nk = soup.find("span", class_="nickname")
    bio["nick"] = nk.get_text(strip=True).strip('"') if nk else None
    bd = soup.find("span", itemprop="birthDate")
    d = None
    if bd:
        try:
            d = dt.datetime.strptime(bd.get_text(strip=True), "%b %d, %Y").date()
        except ValueError:
            d = None
    bio["dob"] = d.isoformat() if d else None
    na = soup.find("strong", itemprop="nationality")
    bio["nationality"] = na.get_text(strip=True) if na else None
    loc = soup.find("span", class_="locality")
    bio["locality"] = loc.get_text(strip=True) if loc else None
    w = soup.find("b", itemprop="weight")
    m = re.search(r"(\d+)", w.get_text()) if w else None
    bio["lbs"] = int(m.group(1)) if m else None
    h = soup.find("b", itemprop="height")
    bio["height"] = h.get_text(strip=True) if h else None
    asc = soup.find("a", class_="association")
    bio["association"] = asc.get_text(strip=True) if asc else None
    cls = soup.find("div", class_="association-class")
    bio["class"] = None
    if cls:
        a = cls.find("a", href=re.compile(r"weightclass="))
        bio["class"] = a.get_text(strip=True) if a else None
    sections = {}
    for title_div in soup.find_all("div", class_="slanted_title"):
        t = title_div.find("div")
        title = t.get_text(" ", strip=True).upper() if t else ""
        if not title.startswith("FIGHT HISTORY"):
            continue
        kind = title.replace("FIGHT HISTORY", "").strip(" -").lower() or "pro"
        sec = title_div.find_parent("section")
        tab = sec.find("table", class_="fighter") if sec else None
        if tab is None:
            continue
        rows = []
        for tr in tab.find_all("tr"):
            if "table_head" in (tr.get("class") or []):
                continue
            tds = tr.find_all("td")
            if len(tds) < 6:
                continue
            res = tds[0].get_text(strip=True).lower()
            oa = tds[1].find("a")
            ea = tds[2].find("a")
            date = parse_sd_date(tds[2].get_text(" ", strip=True))
            meth_b = tds[3].find("b")
            method = meth_b.get_text(" ", strip=True) if meth_b else tds[3].get_text(" ", strip=True)
            ref = tds[3].find("a", href=re.compile(r"^/referee/"))
            rd = tds[4].get_text(strip=True)
            rows.append({
                "res": {"win": "W", "loss": "L", "draw": "D", "nc": "NC"}.get(res, res.upper()[:3]),
                "opp": oa.get_text(strip=True) if oa else tds[1].get_text(strip=True),
                "opp_href": oa["href"] if oa and oa.get("href", "").startswith("/fighter/") else None,
                "event": ea.get_text(" ", strip=True) if ea else tds[2].get_text(" ", strip=True),
                "event_href": ea["href"] if ea else None,
                "date": date.isoformat() if date else None,
                "method": method, "mclass": method_class(method),
                "ref": ref.get_text(strip=True) if ref else None,
                "rd": int(rd) if rd.isdigit() else None,
                "time": tds[5].get_text(strip=True),
            })
        sections[kind] = sections.get(kind, []) + rows
    return {"bio": bio, "sections": sections}


# ------------------------------------------------------------------ ufcstats side
def load_ufc():
    """Fights (date order) with persons, people dict, and per-person UFC bout lists."""
    import build_db as B
    log = {}
    fights, _ = B.parse_fights(log)
    people = B.build_people(fights, log)
    bouts = defaultdict(list)            # person -> [(date, opp_person, opp_name, fight)]
    for f in fights:
        a, b = f.persons
        if a == b:
            continue
        bouts[a].append((f.date, b, f.names[1], f))
        bouts[b].append((f.date, a, f.names[0], f))
    return fights, people, bouts


def targets(fights, people, newcomer_since, extra_since=None):
    roster = json.load(open(os.path.join(DERIVED, "fighters.json")))["fighters"]
    slug2p = {P["slug"]: p for p, P in people.items()}
    T = set(slug2p[s] for s in roster if s in slug2p)
    since = dt.date.fromisoformat(extra_since or newcomer_since)
    N = Counter()
    for f in fights:
        for p in f.persons:
            if f.date >= since and N[p] <= 3:
                T.add(p)
        for p in f.persons:
            N[p] += 1
    return sorted(p for p in T if not p.startswith(("amb:", "name:")))


def verify(parsed, ub):
    """How many of the person's ufcstats bouts appear in the Sherdog pro history."""
    if not parsed:
        return 0, []
    rows = [r for k, v in parsed["sections"].items() if "amateur" not in k for r in v]
    matched = []
    used = set()
    for (d, q, oname, f) in ub:
        best = None
        for i, r in enumerate(rows):
            if i in used or not r["date"]:
                continue
            rd = dt.date.fromisoformat(r["date"])
            if abs((rd - d).days) > 3:
                continue
            s = name_sim(oname, r["opp"])
            if s >= 0.72 and (best is None or s > best[0]):
                best = (s, i)
        if best:
            used.add(best[1])
            matched.append((f.fid, best[1], q))
    return len(matched), matched


def is_verified(k, n):
    return k >= min(2, n) and k >= 0.5 * n


# ------------------------------------------------------------------ crawl
def crawl(args):
    fights, people, bouts = load_ufc()
    T = targets(fights, people, args.since, args.extra_since)
    if args.limit:
        T = T[:args.limit]
    res = json.load(open(RESOLVE)) if os.path.exists(RESOLVE) else {}
    fx = Fetcher(offline=args.offline)
    links = defaultdict(Counter)        # person -> Counter(sherdog href) from verified opponent pages
    parsed_cache = {}

    def page(href):
        if href not in parsed_cache:
            parsed_cache[href] = parse_fighter(fx.get(BASE + href, fighter_path(href)))
        return parsed_cache[href]

    def harvest(p, href, matched):
        P = page(href)
        rows = [r for k, v in P["sections"].items() if "amateur" not in k for r in v]
        for fid, i, q in matched:
            h = rows[i]["opp_href"]
            if h and not q.startswith(("amb:", "name:")):
                links[q][h] += 1

    # harvest links from pages already resolved in earlier runs
    for p, r in res.items():
        if r.get("href") and r.get("status") == "ok":
            k, matched = verify(page(r["href"]), bouts[p])
            harvest(p, r["href"], matched)

    def try_href(p, href, how):
        P = page(href)
        k, matched = verify(P, bouts[p])
        n = len(bouts[p])
        if is_verified(k, n):
            res[p] = {"href": href, "status": "ok", "how": how, "matched": k, "n_ufc": n,
                      "name": people[p]["name"], "slug": people[p]["slug"]}
            harvest(p, href, matched)
            return True
        return False

    def search_resolve(p):
        P = people[p]
        name = P["name"]
        T_ = P.get("tott") or {}
        lbs = T_.get("lbs")
        nick = P.get("nick")
        tk = norm(name).split()
        queries = [name]
        if len(tk) > 2:
            queries.append(tk[0] + " " + tk[-1])
        if len(tk) >= 2:
            queries.append(tk[-1])
        if nick:
            queries.append(nick)
        tried = set()
        for q in queries:
            html = fx.get(BASE + "/stats/fightfinder?" + urllib.parse.urlencode({"SearchTxt": q}),
                          search_path(q))
            cands = parse_search(html)
            scored = []
            for c in cands:
                if c["href"] in tried:
                    continue
                s = name_sim(name, c["name"])
                if q == nick:
                    s = max(s, 0.6 if norm(c["nick"]) == norm(nick) else 0)
                if nick and c["nick"] and norm(c["nick"]) == norm(nick):
                    s += 0.25
                if lbs and c["lbs"]:
                    s -= min(0.3, abs(c["lbs"] - lbs) / 100.0)
                scored.append((s, c["href"]))
            scored.sort(reverse=True)
            for s, href in scored[:4]:
                if s < 0.55:
                    break
                tried.add(href)
                if try_href(p, href, "search:" + q):
                    return True
        res[p] = {"href": None, "status": "unresolved", "n_ufc": len(bouts[p]), "name": name,
                  "slug": P["slug"], "tried": sorted(tried)}
        return False

    pending = [p for p in T if res.get(p, {}).get("status") != "ok"
               and not (res.get(p, {}).get("status") == "unresolved" and not args.retry)]
    pending.sort(key=lambda p: -len(bouts[p]))
    print("targets %d; already resolved %d; pending %d" % (len(T), sum(1 for p in T if res.get(p, {}).get("status") == "ok"),
                                                           len(pending)), flush=True)
    t0 = time.time()
    done = 0
    while pending:
        # cheap first: anyone with a graph link
        linked = [p for p in pending if links[p]]
        if linked:
            p = linked[0]
            ok = False
            for href, _ in links[p].most_common(2):
                if try_href(p, href, "link"):
                    ok = True
                    break
            if not ok:
                search_resolve(p)
        else:
            p = pending[0]
            search_resolve(p)
        pending.remove(p)
        done += 1
        if done % 25 == 0:
            json.dump(res, open(RESOLVE, "w"), indent=0)
            okn = sum(1 for p in T if res.get(p, {}).get("status") == "ok")
            print("%5d done, %d ok, %d requests, %.0f s, %d pending" % (done, okn, fx.n, time.time() - t0,
                                                                        len(pending)), flush=True)
    json.dump(res, open(RESOLVE, "w"), indent=0)
    okn = sum(1 for p in T if res.get(p, {}).get("status") == "ok")
    print("finished: %d targets, %d resolved, %d requests, %.0f s" % (len(T), okn, fx.n, time.time() - t0))



# ------------------------------------------------------------------ build: records + walk-forward snapshots
PROMO_ALIASES = [
    (r"contender series|^dwcs\b|lookin.? for a fight", "DWCS"),
    (r"^road to ufc", "Road to UFC"),
    (r"^(ufc|the ultimate fighter|tuf)\b", "UFC"),
    (r"^bellator", "Bellator"),
    (r"^(pfl|professional fighters league|wsof|world series of fighting)\b", "PFL/WSOF"),
    (r"^one (championship|fc|fight night|on prime|warrior|dangal|hero)|^one\b(?! friday)", "ONE"),
    (r"^one friday fights", "ONE Friday Fights"),
    (r"^(lfa|legacy fighting alliance)\b", "LFA"),
    (r"^(rfa|resurrection fighting alliance)\b", "RFA"),
    (r"^(lfc|legacy fc|legacy fighting championship)\b", "Legacy FC"),
    (r"^(cwfc|cage warriors)", "Cage Warriors"),
    (r"^m-1", "M-1"),
    (r"^(aca|acb|absolute championship)", "ACA"),
    (r"^ksw\b", "KSW"),
    (r"^rizin", "Rizin"),
    (r"^(pride|pride fc)\b", "Pride"),
    (r"^(sf|strikeforce)\b", "Strikeforce"),
    (r"^wec\b|world extreme cagefighting", "WEC"),
    (r"^(cffc|cage fury)", "CFFC"),
    (r"^(brave|brave cf)\b", "Brave CF"),
    (r"^(invicta|invicta fc)\b", "Invicta FC"),
    (r"^(oktagon)", "Oktagon"),
    (r"^(uae warriors)", "UAE Warriors"),
    (r"^(jungle fight)", "Jungle Fight"),
    (r"^(shooto brazil)", "Shooto Brazil"),
    (r"^(titan fc|titan fighting)", "Titan FC"),
    (r"^(kotc|king of the cage)\b", "KOTC"),
    (r"^(eternal mma)", "Eternal MMA"),
    (r"^(hex fight)", "Hex Fight Series"),
    (r"^(fury fc)", "Fury FC"),
    (r"^(eagle fc)", "Eagle FC"),
]


def promotion(event):
    e = ascii_fold(event or "").strip()
    pre = e.split(" - ")[0].strip()
    low = e.lower()
    for pat, name in PROMO_ALIASES:
        if re.search(pat, low) or re.search(pat, pre.lower()):
            return name
    out = []
    for t in pre.split():
        if re.fullmatch(r"#?\d+[a-z]?|\d{4}|[IVX]{1,4}|season|week|episode|vol\.?|volume|night|day|\(.*", t,
                        re.I):
            break
        out.append(t)
    return " ".join(out) or pre or "?"


def row_list(parsed):
    """Pro rows (amateur and exhibition sections excluded), oldest first."""
    rows = []
    for k, v in parsed["sections"].items():
        if "amateur" in k or "exhibition" in k:
            continue
        rows.extend(v)
    rows = list(reversed(rows))                          # page lists newest first
    rows.sort(key=lambda r: r["date"] or "0000")        # stable: same-day order kept
    return rows


def sid(href):
    m = re.search(r"-(\d+)$", href or "")
    return int(m.group(1)) if m else None


def years(a, b):
    return round((b - a).days / 365.25, 3)


def snapshot_feats(rows, D, dob, ex_rows, net, promo_q, same_event_fid=None):
    """Features from Sherdog pro fights dated strictly before D (the UFC bout date)."""
    pre = [r for r in rows if r["date"] and r["_d"] < D]
    nu = [r for r in pre if not r["_ufc"]]
    c = Counter()
    for r in nu:
        res = r["res"]
        if res in ("W", "L"):
            c[res] += 1
            c[r["mclass"] + "_" + res.lower()] += 1
        elif res == "D":
            c["D"] += 1
        else:
            c["NC"] += 1
    w, l, d = c["W"], c["L"], c["D"]
    n = w + l + d
    f = {"n": n, "w": w, "l": l, "d": d, "nc": c["NC"],
         "ko_w": c["ko_w"], "sub_w": c["sub_w"], "dec_w": c["dec_w"], "oth_w": c["other_w"] + c["dq_w"],
         "ko_l": c["ko_l"], "sub_l": c["sub_l"], "dec_l": c["dec_l"], "oth_l": c["other_l"] + c["dq_l"]}

    def streak(rs):
        s = 0
        for r in reversed(rs):
            if r["res"] == "W":
                s += 1
            elif r["res"] == "NC":
                continue
            else:
                break
        return s

    def lstreak(rs):
        s = 0
        for r in reversed(rs):
            if r["res"] == "L":
                s += 1
            elif r["res"] == "NC":
                continue
            else:
                break
        return s
    f["streak"] = streak(nu)                 # non-UFC win streak (entering the UFC, for a debut)
    f["streak_all"] = streak(pre)            # overall pro win streak entering this bout
    f["lstreak_all"] = lstreak(pre)
    last5 = [r for r in nu if r["res"] in ("W", "L", "D")][-5:]
    f["l5_w"] = sum(r["res"] == "W" for r in last5)
    f["l5_n"] = len(last5)
    f["n_ufc_sd"] = sum(1 for r in pre if r["_ufc"])
    if pre:
        first = pre[0]["_d"]
        f["pro_debut"] = first.isoformat()
        f["years_active"] = years(first, D)
        f["age_pro_debut"] = years(dob, first) if dob else None
        f["layoff_days"] = (D - pre[-1]["_d"]).days
        f["n_2y"] = sum(1 for r in pre if (D - r["_d"]).days <= 730)
    else:
        f.update({"pro_debut": None, "years_active": 0.0, "age_pro_debut": years(dob, D) if dob else None,
                  "layoff_days": None, "n_2y": 0})
    if nu:
        f["last_nonufc"] = nu[-1]["_d"].isoformat()
    pc = Counter(r["_promo"] for r in nu)
    f["promos"] = [p for p, _ in pc.most_common(4)]
    f["n_promos"] = len(pc)
    f["last_promo"] = nu[-1]["_promo"] if nu else None
    f["dwcs_w"] = sum(1 for r in nu if r["_promo"] == "DWCS" and r["res"] == "W")
    f["dwcs_n"] = sum(1 for r in nu if r["_promo"] == "DWCS")
    # promotion quality as of D (walk-forward): graduates count and their UFC results
    qs, qw = [], []
    for r in nu[-6:]:
        q = promo_q(r["_promo"], D)
        qs.append(q["feed"])
        qw.append(q["grad"])
    f["promo_feed"] = round(sum(qs) / len(qs), 4) if qs else 0.0
    f["promo_feed_max"] = round(max(qs), 4) if qs else 0.0
    f["promo_grad"] = round(sum(qw) / len(qw), 4) if qw else None
    # opponent quality from the Sherdog network (every opponent fight observed on any cached page)
    known = [r for r in nu if r.get("_opp_n", 0) >= 3]
    f["opp_known"] = len(known)
    f["opp_wpct"] = round(sum(r["_opp_w"] / r["_opp_n"] for r in known) / len(known), 4) if known else None
    f["opp_ufc_w"] = sum(1 for r in nu if r["res"] == "W" and r.get("_opp_ufc_first") and r["_opp_ufc_first"] < D)
    f["opp_ufc_n"] = sum(1 for r in nu if r.get("_opp_ufc_first") and r["_opp_ufc_first"] < D)
    f["net_elo"] = round(net(D), 1) if net else None
    # TUF house fights (Sherdog files them under pro exhibition)
    ex = [r for r in ex_rows if r["date"] and r["_d"] < D]
    f["exh_n"] = len(ex)
    f["exh_w"] = sum(1 for r in ex if r["res"] == "W")
    return f


SNAP_KEYS = ["n", "w", "l", "d", "nc", "ko_w", "sub_w", "dec_w", "oth_w", "ko_l", "sub_l", "dec_l", "oth_l",
             "streak", "streak_all", "lstreak_all", "l5_w", "l5_n", "n_ufc_sd", "years_active", "age_pro_debut",
             "layoff_days", "n_2y", "n_promos", "dwcs_w", "dwcs_n", "promo_feed", "promo_feed_max", "promo_grad",
             "opp_known", "opp_wpct", "opp_ufc_w", "opp_ufc_n", "net_elo", "exh_n", "exh_w"]


def build(args):
    fights, people, bouts = load_ufc()
    T = targets(fights, people, args.since, args.extra_since)
    res = json.load(open(RESOLVE)) if os.path.exists(RESOLVE) else {}
    fx = Fetcher(offline=True)
    snap_date = max(f.date for f in fights)
    today = dt.date.today()
    first_ufc = {}
    for p, ub in bouts.items():
        first_ufc[p] = min(d for d, *_ in ub)
    parsed = {}
    rowsby = {}
    exrows = {}
    href2p = {}
    vinfo = {}
    sec_kinds = Counter()
    for p, r in res.items():
        if r.get("status") != "ok" or p not in people:
            continue
        P = parse_fighter(fx.get(BASE + r["href"], fighter_path(r["href"])))
        if not P:
            continue
        parsed[p] = P
        for k in P["sections"]:
            sec_kinds[k] += 1
        rows = row_list(P)
        k, matched = verify({"sections": {"pro": rows}}, bouts[p])
        fidrow = {i: fid for fid, i, q in matched}
        for i, row in enumerate(rows):
            row["_d"] = dt.date.fromisoformat(row["date"]) if row["date"] else None
            row["_promo"] = promotion(row["event"])
            row["_fid"] = fidrow.get(i)
            # UFC rows that ufcstats lacks still count as UFC experience, never as a pre-UFC record
            row["_ufc"] = row["_fid"] is not None or row["_promo"] == "UFC"
            row["_sid"] = sid(row["opp_href"])
        for fid, i, q in matched:
            h = rows[i]["opp_href"]
            if h and not q.startswith(("amb:", "name:")):
                href2p.setdefault(sid(h), q)
        href2p[sid(r["href"])] = p
        ex = [x for kk, v in P["sections"].items() if "exhibition" in kk for x in v]
        for x in ex:
            x["_d"] = dt.date.fromisoformat(x["date"]) if x["date"] else None
        exrows[p] = ex
        rowsby[p] = rows
        sd_ufc_rows = [x for x in rows if x["_promo"] == "UFC"]
        vinfo[p] = {"matched": k, "n_ufc": len(bouts[p]),
                    "sd_ufc_unmatched": sum(1 for x in sd_ufc_rows if x["_fid"] is None)}
    print("parsed %d resolved pages; section kinds %s" % (len(parsed), dict(sec_kinds)))

    # ---- promotion quality, walk-forward: graduates (resolved UFC fighters who fought there before their
    # UFC debut) with debut before D, and those graduates' results in their first 3 UFC bouts before D
    grads = defaultdict(list)          # promo -> sorted debut dates
    gradres = defaultdict(list)        # promo -> [(date, win)] first-3 UFC bouts of its graduates
    import bisect
    grad_from = dt.date.fromisoformat(args.extra_since or args.since)
    for p, rows in rowsby.items():
        deb = first_ufc[p]
        if deb < grad_from:            # older debuts are only the survivors still in the roster: skip them
            continue
        promos = set(r["_promo"] for r in rows if not r["_ufc"] and r["_d"] and r["_d"] < deb)
        ub = sorted(bouts[p], key=lambda t: t[0])[:3]
        for pr in promos:
            grads[pr].append(deb)
            for (d, q, on, f) in ub:
                if f.winner in ("A", "B"):
                    won = (f.winner == "A") == (f.persons[0] == p)
                    gradres[pr].append((d, 1 if won else 0))
    for pr in grads:
        grads[pr].sort()
        gradres[pr].sort()
    grad_dates = {pr: [d for d, _ in v] for pr, v in gradres.items()}
    grad_cumw = {}
    for pr, v in gradres.items():
        cw, s = [], 0
        for _, w_ in v:
            s += w_
            cw.append(s)
        grad_cumw[pr] = cw
    PRIOR_GRAD = 10.0

    all_deb = sorted(first_ufc[p] for p in rowsby if first_ufc[p] >= grad_from)

    def promo_q(pr, D):
        G = bisect.bisect_left(all_deb, D)
        g = bisect.bisect_left(grads.get(pr, []), D)
        k = bisect.bisect_left(grad_dates.get(pr, []), D)
        wins = grad_cumw[pr][k - 1] if k > 0 else 0
        return {"feed": math.log1p(1000.0 * g / max(G, 1)), "grad": (wins + PRIOR_GRAD * 0.5) / (k + PRIOR_GRAD), "n_grad": g,
                "n_res": k}

    # ---- Sherdog network: every pro fight seen on any resolved page, deduped; opponent records and a
    # network Elo walked forward in date order
    allf = {}
    for p, rows in rowsby.items():
        me = None
        for r in res.values():
            pass
        me = sid(res[p]["href"])
        for r in rows:
            if not r["_d"] or r["_sid"] is None:
                continue
            a, b = me, r["_sid"]
            key = (r["date"], min(a, b), max(a, b))
            if key in allf:
                continue
            sc = {"W": 1.0, "L": 0.0, "D": 0.5}.get(r["res"])
            if sc is None:
                continue
            allf[key] = (r["_d"], a, b, sc)
    net_fights = sorted(allf.values(), key=lambda t: t[0])
    R = defaultdict(lambda: 1500.0)
    WL = defaultdict(lambda: [0, 0])
    hist = defaultdict(list)           # sid -> [(date, rating after)]
    pre_rec = {}                       # (date, a, b) -> (a_w, a_n, b_w, b_n)
    NK = 32.0
    for (d, a, b, sc) in net_fights:
        ra, rb = R[a], R[b]
        ea = 1 / (1 + 10 ** ((rb - ra) / 400))
        pre_rec[(d, a, b)] = (WL[a][0], WL[a][1], WL[b][0], WL[b][1])
        R[a] = ra + NK * (sc - ea)
        R[b] = rb - NK * (sc - ea)
        if sc == 1.0:
            WL[a][0] += 1
        elif sc == 0.0:
            WL[b][0] += 1
        WL[a][1] += 1
        WL[b][1] += 1
        hist[a].append((d, R[a]))
        hist[b].append((d, R[b]))
    for p, rows in rowsby.items():
        me = sid(res[p]["href"])
        for r in rows:
            if not r["_d"] or r["_sid"] is None:
                continue
            a, b = me, r["_sid"]
            pr = pre_rec.get((r["_d"], a, b))
            if pr is None:
                pr2 = pre_rec.get((r["_d"], b, a))
                if pr2 is not None:
                    pr = (pr2[2], pr2[3], pr2[0], pr2[1])
            if pr is not None:
                r["_opp_w"], r["_opp_n"] = pr[2], pr[3]
            q = href2p.get(r["_sid"])
            if q and q in first_ufc:
                r["_opp_ufc_first"] = first_ufc[q]

    def net_for(me):
        H = hist.get(me, [])
        ds = [d for d, _ in H]

        def f(D):
            k = bisect.bisect_left(ds, D)
            return H[k - 1][1] if k > 0 else 1500.0
        return f

    # ---- per fighter output
    out = {}
    cover = Counter()
    for p in T:
        P = people[p]
        slug = P["slug"]
        r = res.get(p, {})
        cover["targets"] += 1
        if p not in rowsby:
            cover["unresolved"] += 1
            out[slug] = {"name": P["name"], "ufc_id": P["id"], "status": r.get("status", "not_crawled"),
                         "n_ufc": len(bouts[p])}
            continue
        cover["resolved"] += 1
        rows = rowsby[p]
        Pp = parsed[p]
        tt = P.get("tott") or {}
        dob = tt.get("dob")
        sd_dob = dt.date.fromisoformat(Pp["bio"]["dob"]) if Pp["bio"].get("dob") else None
        if dob and sd_dob:
            cover["dob_both"] += 1
            cover["dob_agree"] += int(abs((dob - sd_dob).days) <= 1)
        dob = dob or sd_dob
        net = net_for(sid(r["href"]))
        snaps = []
        deb = None
        ub = sorted(bouts[p], key=lambda t: (t[0], -t[3].idx))
        for j, (d, q, on, f) in enumerate(ub):
            ft = snapshot_feats(rows, d, dob, exrows[p], net, promo_q)
            if j == 0:
                deb = dict(ft, date=d.isoformat(), fid=f.fid)
            snaps.append([d.isoformat(), f.fid, j] + [ft[k] for k in SNAP_KEYS])
        cur = snapshot_feats(rows, today + dt.timedelta(days=1), dob, exrows[p], net, promo_q)
        fl = [[x["date"], x["res"], x["mclass"], x["_promo"], x["opp"], x["_sid"], x["rd"],
               x["_fid"] or ("UFC" if x["_ufc"] else "")] for x in rows]
        v = vinfo[p]
        cover["ufc_bouts"] += v["n_ufc"]
        cover["ufc_bouts_matched"] += v["matched"]
        out[slug] = {
            "name": P["name"], "ufc_id": P["id"], "status": "ok",
            "sherdog": {"url": BASE + r["href"], "name": Pp["bio"]["name"], "nick": Pp["bio"]["nick"],
                        "dob": Pp["bio"]["dob"], "nationality": Pp["bio"]["nationality"],
                        "locality": Pp["bio"]["locality"], "association": Pp["bio"]["association"],
                        "class": Pp["bio"]["class"], "how": r.get("how"),
                        "ufc_bouts_found": v["matched"], "n_ufc": v["n_ufc"],
                        "sd_ufc_rows_not_in_ufcstats": v["sd_ufc_unmatched"],
                        "amateur_n": sum(len(x) for k, x in Pp["sections"].items() if "amateur" in k)},
            "debut": deb,
            "current": cur,
            "snapshots": snaps,
            "fights": fl,
        }
    meta = {
        "source": "sherdog.com fighter pages (pro fight history), fetched by tools/preufc.py at <= 1 request/s; "
                  "raw HTML cached in data/raw/sherdog_cache/ (gitignored)",
        "built": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
        "ufcstats_snapshot": snap_date.isoformat(),
        "targets": "roster (fighters.json) + every fighter with 0-3 prior UFC bouts in a UFC bout on/after %s"
                   % (args.extra_since or args.since),
        "coverage": dict(cover),
        "walk_forward": "snapshots[k] uses only Sherdog pro fights dated strictly before the k-th UFC bout's date; "
                        "rows matched to ufcstats bouts (or any UFC-promoted row) are UFC experience and never "
                        "count in the non-UFC record; amateur and exhibition (TUF house) fights are excluded "
                        "from the record (exh_n/exh_w count exhibitions)",
        "snapshot_columns": ["date", "fid", "n_ufc_prior"] + SNAP_KEYS,
        "graduates_from": (args.extra_since or args.since),
        "fields": {
            "n w l d nc": "non-UFC pro record before the bout (w+l+d = n)",
            "ko_w sub_w dec_w oth_w / ko_l sub_l dec_l oth_l": "non-UFC wins and losses by method "
                                                               "(KO includes TKO; oth = DQ and other)",
            "streak": "non-UFC win streak at the end of the non-UFC record (entering the UFC for a debut)",
            "streak_all / lstreak_all": "overall pro win / loss streak entering the bout (UFC included)",
            "l5_w l5_n": "wins in the last (up to) 5 non-UFC fights",
            "n_ufc_sd": "UFC bouts Sherdog lists before this bout",
            "years_active": "years from pro debut to the bout", "age_pro_debut": "age at pro debut",
            "layoff_days": "days since the last pro fight of any kind", "n_2y": "pro fights in the 2 years before",
            "promos / last_promo / n_promos": "non-UFC promotions (Sherdog event-name prefix, big orgs merged)",
            "dwcs_w dwcs_n": "Dana White's Contender Series wins / fights (not in ufcstats)",
            "promo_feed": "mean over the last 6 non-UFC fights of log(1 + 1000 x share of all UFC debutants before the "
                          "bout date who came through that promotion); graduates counted only from "
                          "meta.graduates_from on, where the target set holds every debut (older debuts are "
                          "survivors only)",
            "promo_feed_max": "max of the same over the last 6 non-UFC fights",
            "promo_grad": "mean over the last 6 non-UFC fights of the promotion's graduates' win rate in their first "
                          "3 UFC bouts before the bout date (shrunk to 0.5 with 10 pseudo-bouts)",
            "opp_wpct / opp_known": "mean pre-fight win share of non-UFC opponents with >= 3 fights seen in the "
                                    "Sherdog network (union of every cached page), and how many such opponents",
            "opp_ufc_w / opp_ufc_n": "non-UFC wins / fights against opponents who had a UFC bout before the bout date",
            "net_elo": "Elo over every fight in the Sherdog network (K 32, start 1500), as of the bout date",
            "exh_n exh_w": "exhibition (TUF house) fights / wins before the bout",
            "snapshots": "one row per UFC bout in meta.snapshot_columns order (walk-forward features)",
            "debut": "the first snapshot as a dict (the record entering the UFC), plus date and fid",
            "fights": "[date, result, method class, promotion, opponent, opponent sherdog id, round, ufcstats fight id "
                      "or 'UFC' for UFC rows ufcstats lacks or '' for non-UFC]",
            "current": "the same features as of today (non-UFC record including fights between or after UFC stints)",
        },
        "promotions": {pr: {"graduates": len(v), "grad_bouts": len(gradres[pr]),
                            "grad_win": round(promo_q(pr, today)["grad"], 4)}
                       for pr, v in sorted(grads.items(), key=lambda kv: -len(kv[1]))[:80]},
        "network": {"fights": len(net_fights), "nodes": len(R)},
    }
    obj = {"meta": meta, "fighters": dict(sorted(out.items()))}
    old = os.path.join(DERIVED, "preufc.json")
    if os.path.exists(old):
        try:
            prev = json.load(open(old))
            for k in ("predictions", "eval"):
                if k in prev:
                    obj[k] = prev[k]
        except Exception:
            pass
    with open(old, "w") as fh:
        json.dump(obj, fh, separators=(",", ":"), default=str)
    print("wrote %s (%.1f MB); coverage %s" % (old, os.path.getsize(old) / 1e6, dict(cover)))
    return obj


# ------------------------------------------------------------------ main
def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("cmd", choices=["crawl", "build", "eval", "all"])
    ap.add_argument("--since", default="2019-01-01", help="newcomer window start (bouts with <= 3 prior UFC fights)")
    ap.add_argument("--extra-since", default=None, help="widen the newcomer window (e.g. 2015-01-01)")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--offline", action="store_true")
    ap.add_argument("--retry", action="store_true", help="retry unresolved targets")
    args = ap.parse_args()
    if args.cmd == "crawl":
        crawl(args)
    elif args.cmd in ("build", "all"):
        build(args)
        if args.cmd == "all":
            evaluate(args)
    elif args.cmd == "eval":
        evaluate(args)


if __name__ == "__main__":
    main()
