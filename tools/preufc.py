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


def _txt(el):
    return re.sub(r"\s+", " ", el.text_content()).strip() if el is not None else ""


def parse_fighter(html):
    """Bio + fight-history sections of one Sherdog fighter page (lxml; same output as the bs4 version)."""
    import lxml.html
    if not html or html.startswith("<!-- 404"):
        return None
    doc = lxml.html.fromstring(html)
    fn = doc.xpath('//span[contains(concat(" ", normalize-space(@class), " "), " fn ")]')
    if not fn:
        return None
    bio = {"name": _txt(fn[0])}
    nk = doc.xpath('//span[contains(concat(" ", normalize-space(@class), " "), " nickname ")]')
    bio["nick"] = _txt(nk[0]).strip('"') if nk else None
    bd = doc.xpath('//span[@itemprop="birthDate"]')
    d = None
    if bd:
        try:
            d = dt.datetime.strptime(_txt(bd[0]), "%b %d, %Y").date()
        except ValueError:
            d = None
    bio["dob"] = d.isoformat() if d else None
    na = doc.xpath('//strong[@itemprop="nationality"]')
    bio["nationality"] = _txt(na[0]) if na else None
    loc = doc.xpath('//span[contains(concat(" ", normalize-space(@class), " "), " locality ")]')
    bio["locality"] = _txt(loc[0]) if loc else None
    w = doc.xpath('//b[@itemprop="weight"]')
    m = re.search(r"(\d+)", _txt(w[0])) if w else None
    bio["lbs"] = int(m.group(1)) if m else None
    h = doc.xpath('//b[@itemprop="height"]')
    bio["height"] = _txt(h[0]) if h else None
    asc = doc.xpath('//a[contains(concat(" ", normalize-space(@class), " "), " association ")]')
    bio["association"] = _txt(asc[0]) if asc else None
    cls = doc.xpath('//div[contains(concat(" ", normalize-space(@class), " "), " association-class ")]'
                    '//a[contains(@href, "weightclass=")]')
    bio["class"] = _txt(cls[0]) if cls else None
    sections = {}
    for title_div in doc.xpath('//div[contains(concat(" ", normalize-space(@class), " "), " slanted_title ")]'):
        t = title_div.xpath('./div')
        title = _txt(t[0]).upper() if t else ""
        if not title.startswith("FIGHT HISTORY"):
            continue
        kind = title.replace("FIGHT HISTORY", "").strip(" -").lower() or "pro"
        sec = title_div.xpath('./ancestor::section[1]')
        tab = sec[0].xpath('.//table[contains(concat(" ", normalize-space(@class), " "), " fighter ")]') if sec else []
        if not tab:
            continue
        rows = []
        for tr in tab[0].xpath('.//tr'):
            if "table_head" in (tr.get("class") or "").split():
                continue
            tds = tr.xpath('./td')
            if len(tds) < 6:
                continue
            res = _txt(tds[0]).lower()
            oa = tds[1].xpath('.//a')
            ea = tds[2].xpath('.//a')
            date = parse_sd_date(_txt(tds[2]))
            mb = tds[3].xpath('.//b')
            method = _txt(mb[0]) if mb else _txt(tds[3])
            ref = tds[3].xpath('.//a[starts-with(@href, "/referee/")]')
            rd = _txt(tds[4])
            ohref = oa[0].get("href", "") if oa else ""
            rows.append({
                "res": {"win": "W", "loss": "L", "draw": "D", "nc": "NC"}.get(res, res.upper()[:3]),
                "opp": _txt(oa[0]) if oa else _txt(tds[1]),
                "opp_href": ohref if ohref.startswith("/fighter/") else None,
                "event": _txt(ea[0]) if ea else _txt(tds[2]),
                "event_href": ea[0].get("href") if ea else None,
                "date": date.isoformat() if date else None,
                "method": method, "mclass": method_class(method),
                "ref": _txt(ref[0]) if ref else None,
                "rd": int(rd) if rd.isdigit() else None,
                "time": _txt(tds[5]),
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



# ------------------------------------------------------------------ evaluation (walk-forward)
TEST_FROM = dt.date(2024, 1, 1)
CV_YEARS = [2019, 2020, 2021, 2022, 2023]
LN10_400 = math.log(10) / 400.0


def ll(p, y):
    import numpy as np
    p = np.clip(p, 1e-6, 1 - 1e-6)
    return float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p)))


def scores(p, y):
    import numpy as np
    return {"n": int(len(y)), "log_loss": ll(p, y), "brier": float(np.mean((p - y) ** 2)),
            "accuracy": float(np.mean((p > 0.5) == (y > 0.5)))}


def ufc_walk(fights, people):
    """Walk-forward UFC-only side features for every bout (before the bout), from ufcstats."""
    import numpy as np
    import build_db as B
    log = {}
    B.build_vectors(fights, log)
    KI = B.KI
    sig = [KI["d_lnd"], KI["c_lnd"], KI["g_lnd"]]
    siga = [KI["d_att"], KI["c_att"], KI["g_att"]]
    osig = [KI["od_lnd"], KI["oc_lnd"], KI["og_lnd"]]
    osiga = [KI["od_att"], KI["oc_att"], KI["og_att"]]
    # league rates from fights before 2019 (no test-era information)
    tot = np.zeros(B.NK)
    for f in fights:
        if f.stats and f.date < dt.date(2019, 1, 1) and f.date >= dt.date(2010, 1, 1):
            tot += f.stats["v"][0] + f.stats["v"][1]
    m = tot[KI["min"]]
    L = {"slpm": tot[sig].sum() / m, "acc": tot[sig].sum() / tot[siga].sum(),
         "td": tot[KI["td_lnd"]] / m, "tdacc": tot[KI["td_lnd"]] / tot[KI["td_att"]],
         "sub": tot[KI["sub_att"]] / m, "kd": tot[KI["kd"]] / m, "ctrl": tot[KI["ctrl"]] / m}
    lam = math.log(2) / 730.0
    st = {}
    out = {}
    M0, A0, T0 = 25.0, 100.0, 6.0
    for f in fights:
        a, b = f.persons
        if a == b:
            continue
        sides = []
        for s, p in ((0, a), (1, b)):
            S = st.get(p)
            if S is None:
                S = st[p] = {"n": 0, "w": 0, "l": 0, "ko_w": 0, "sub_w": 0, "ko_l": 0, "sub_l": 0, "last": None,
                             "S": np.zeros(B.NK), "t": f.day, "first": f.day}
            if f.day > S["t"]:
                S["S"] *= math.exp(-lam * (f.day - S["t"]))
                S["t"] = f.day
            v = S["S"]
            mn = v[KI["min"]]
            T = people[p].get("tott") or {}
            dob = T.get("dob")
            sides.append({
                "n": S["n"], "w": S["w"], "l": S["l"], "ko_w": S["ko_w"], "sub_w": S["sub_w"],
                "ko_l": S["ko_l"], "sub_l": S["sub_l"],
                "layoff": (f.day - S["last"]) if S["last"] else None,
                "age": (f.date - dob).days / 365.25 if dob else None,
                "reach": T.get("reach_in"), "height": T.get("height_in"),
                "slpm": (v[sig].sum() + M0 * L["slpm"]) / (mn + M0),
                "sapm": (v[osig].sum() + M0 * L["slpm"]) / (mn + M0),
                "acc": (v[sig].sum() + A0 * L["acc"]) / (v[siga].sum() + A0),
                "sdef": 1 - (v[osig].sum() + A0 * L["acc"]) / (v[osiga].sum() + A0),
                "td15": 15 * (v[KI["td_lnd"]] + M0 * L["td"]) / (mn + M0),
                "tdacc": (v[KI["td_lnd"]] + T0 * L["tdacc"]) / (v[KI["td_att"]] + T0),
                "tddef": 1 - (v[KI["otd_lnd"]] + T0 * L["tdacc"]) / (v[KI["otd_att"]] + T0),
                "sub15": 15 * (v[KI["sub_att"]] + M0 * L["sub"]) / (mn + M0),
                "kd15": 15 * (v[KI["kd"]] + M0 * L["kd"]) / (mn + M0),
                "okd15": 15 * (v[KI["okd"]] + M0 * L["kd"]) / (mn + M0),
                "ctrl": (v[KI["ctrl"]] + M0 * L["ctrl"]) / (mn + M0) / 60.0,
                "octrl": (v[KI["octrl"]] + M0 * L["ctrl"]) / (mn + M0) / 60.0,
            })
        out[f.fid] = sides
        for s, p in ((0, a), (1, b)):
            S = st[p]
            if f.stats:
                S["S"] += f.stats["v"][s]
            S["n"] += 1
            S["last"] = f.day
            won = f.winner == ("A" if s == 0 else "B")
            lost = f.winner == ("B" if s == 0 else "A")
            if won:
                S["w"] += 1
                if f.cat == "ko":
                    S["ko_w"] += 1
                elif f.cat == "sub":
                    S["sub_w"] += 1
            elif lost:
                S["l"] += 1
                if f.cat == "ko":
                    S["ko_l"] += 1
                elif f.cat == "sub":
                    S["sub_l"] += 1
    return out


class EloRunner:
    """Fast walk-forward Elo over every UFC bout. Debut seeds apply to people whose first UFC bout is on or
    after `seed_from`; the state just before `seed_from` is computed once and reused."""

    def __init__(self, fights, K, boost, boost_n=5, seed_from=None):
        self.K, self.boost, self.boost_n = K, boost, boost_n
        idx = {}
        seq = []
        for f in fights:
            a, b = f.persons
            if a == b:
                continue
            ia = idx.setdefault(a, len(idx))
            ib = idx.setdefault(b, len(idx))
            sa = {"A": 1.0, "B": 0.0, "D": 0.5}.get(f.winner)
            seq.append((ia, ib, sa, f.fid, f.date))
        self.idx = idx
        self.np = len(idx)
        self.seed_from = seed_from or dt.date(1900, 1, 1)
        self.head = [t for t in seq if t[4] < self.seed_from]
        self.tail = [t for t in seq if t[4] >= self.seed_from]
        R, N, pre = self._loop([1500.0] * self.np, [0] * self.np, self.head, self.boost)
        self.R0, self.N0, self.pre0 = R, N, pre
        self.tail_pos = {t[3]: k for k, t in enumerate(self.tail)}

    def _loop(self, R, N, seq, bo, until=None):
        K, bn = self.K, self.boost_n
        pre = {}
        for ia, ib, sa, fid, d in seq:
            if until is not None and d >= until:
                break
            ra, rb = R[ia], R[ib]
            ea = 1.0 / (1.0 + 10.0 ** ((rb - ra) / 400.0))
            pre[fid] = (ra, rb, ea)
            if sa is not None:
                ka = K * bo if N[ia] < bn else K
                kb = K * bo if N[ib] < bn else K
                R[ia] = ra + ka * (sa - ea)
                R[ib] = rb - kb * (sa - ea)
            N[ia] += 1
            N[ib] += 1
        return R, N, pre

    def run(self, seed=None, boost=None, until=None):
        """seed: {person index: debut rating} for people debuting on/after seed_from. Returns fid -> (ra, rb, ea)."""
        bo = self.boost if boost is None else boost
        R = list(self.R0)
        N = list(self.N0)
        if seed:
            for k, v in seed.items():
                if self.N0[k] == 0:
                    R[k] = float(v)
        _, _, pre = self._loop(R, N, self.tail, bo, until)
        out = dict(self.pre0)
        out.update(pre)
        return out


def side_pre(snap, n_prior):
    """Per-side pre-UFC feature vector (dict) from a preufc snapshot; None when the fighter is unresolved."""
    if snap is None:
        return None
    n, w, l = snap["n"], snap["w"], snap["l"]
    fin_w = snap["ko_w"] + snap["sub_w"]
    fin_l = snap["ko_l"] + snap["sub_l"]
    return {
        "pre_wpct": math.log((w + 1.5) / (l + 1.5)),
        "pre_logn": math.log1p(n),
        "pre_fin": (fin_w + 0.5) / (n + 2.0),
        "pre_ko": (snap["ko_w"] + 0.3) / (n + 2.0),
        "pre_sub": (snap["sub_w"] + 0.2) / (n + 2.0),
        "pre_finl": (fin_l + 0.3) / (n + 2.0),
        "pre_kol": (snap["ko_l"] + 0.2) / (n + 2.0),
        "pre_subl": (snap["sub_l"] + 0.1) / (n + 2.0),
        "pre_streak": math.log1p(snap["streak"]),
        "pre_l5": (snap["l5_w"] + 1.0) / (snap["l5_n"] + 2.0),
        "pre_yrs": min(snap["years_active"] or 0.0, 15.0),
        "pre_agedeb": snap["age_pro_debut"] if snap["age_pro_debut"] is not None else float("nan"),
        "pre_feed": snap["promo_feed"],
        "pre_feedmax": snap["promo_feed_max"],
        "pre_grad": (snap["promo_grad"] - 0.5) if snap["promo_grad"] is not None else 0.0,
        "pre_oppw": snap["opp_wpct"] if snap["opp_wpct"] is not None else float("nan"),
        "pre_oppufc": math.log1p(snap["opp_ufc_w"]),
        "pre_netelo": ((snap["net_elo"] or 1500.0) - 1500.0) / 100.0,
        "pre_dwcs": 1.0 if snap["dwcs_w"] > 0 else 0.0,
        "pre_tuf": 1.0 if snap["exh_n"] > 0 else 0.0,
        "pre_layoff": math.log1p(snap["layoff_days"]) if snap["layoff_days"] is not None else float("nan"),
    }


PRE_KEYS = ["pre_wpct", "pre_logn", "pre_fin", "pre_ko", "pre_sub", "pre_finl", "pre_kol", "pre_subl",
            "pre_streak", "pre_l5", "pre_yrs", "pre_agedeb", "pre_feed", "pre_feedmax", "pre_grad", "pre_oppw",
            "pre_oppufc", "pre_netelo", "pre_dwcs", "pre_tuf"]
PRE_CORE = ["pre_wpct", "pre_logn", "pre_fin", "pre_finl", "pre_streak", "pre_feed", "pre_grad", "pre_oppufc",
            "pre_netelo", "pre_dwcs", "pre_agedeb"]
BASE_KEYS = ["elo", "age", "reach", "height", "logn", "uwin", "ufin", "ufinl", "layoff", "slpm", "sapm", "acc",
             "sdef", "td15", "tdacc", "tddef", "sub15", "kd15", "okd15", "ctrl", "octrl"]


def base_side(u, elo):
    n = u["n"]
    return {"elo": elo / 100.0, "age": u["age"] if u["age"] is not None else float("nan"),
            "reach": u["reach"] if u["reach"] is not None else float("nan"),
            "height": u["height"] if u["height"] is not None else float("nan"),
            "logn": math.log1p(n), "uwin": math.log((u["w"] + 1.5) / (u["l"] + 1.5)),
            "ufin": (u["ko_w"] + u["sub_w"] + 0.5) / (n + 2.0),
            "ufinl": (u["ko_l"] + u["sub_l"] + 0.3) / (n + 2.0),
            "layoff": math.log1p(u["layoff"]) if u["layoff"] is not None else float("nan"),
            "slpm": u["slpm"], "sapm": u["sapm"], "acc": u["acc"], "sdef": u["sdef"], "td15": u["td15"],
            "tdacc": u["tdacc"], "tddef": u["tddef"], "sub15": u["sub15"], "kd15": u["kd15"],
            "okd15": u["okd15"], "ctrl": u["ctrl"], "octrl": u["octrl"]}


def build_frame(fights, people, ufc, elo_pre, snaps, from_date):
    """One row per decisive bout from from_date on: per-side base + pre-UFC features, outcome, flags."""
    import numpy as np
    rows = []
    for f in fights:
        a, b = f.persons
        if a == b or f.date < from_date or f.fid not in ufc:
            continue
        if a.startswith(("amb:", "name:")) or b.startswith(("amb:", "name:")):
            continue
        ua, ub = ufc[f.fid]
        ra, rb, ea = elo_pre[f.fid]
        r = {"fid": f.fid, "date": f.date, "year": f.date.year, "winner": f.winner, "cat": f.cat,
             "method": f.method, "division": f.division, "rounds": f.sched, "elo_p": ea,
             "nA": ua["n"], "nB": ub["n"], "slugA": people[a]["slug"], "slugB": people[b]["slug"]}
        for tag, u, el, p in (("A", ua, ra, a), ("B", ub, rb, b)):
            bs = base_side(u, el)
            for k, v in bs.items():
                r[k + "_" + tag] = v
            sp = side_pre(snaps.get((people[p]["slug"], f.fid)), u["n"])
            r["res_" + tag] = 0.0 if sp is None else 1.0
            for k in PRE_KEYS + ["pre_layoff"]:
                r[k + "_" + tag] = (sp or {}).get(k, float("nan"))
            r["uko_" + tag] = (u["ko_w"] + 0.3) / (u["n"] + 2.0)
            r["usub_" + tag] = (u["sub_w"] + 0.2) / (u["n"] + 2.0)
            r["ukol_" + tag] = (u["ko_l"] + 0.2) / (u["n"] + 2.0)
            r["usubl_" + tag] = (u["sub_l"] + 0.1) / (u["n"] + 2.0)
        rows.append(r)
    import pandas as pd
    df = pd.DataFrame(rows)
    df["y"] = (df["winner"] == "A").astype(float)
    df["decisive"] = df["winner"].isin(["A", "B"])
    df["newc"] = (df[["nA", "nB"]].min(axis=1) <= 3)
    return df


class DiffModel:
    """Symmetric logistic model on side differences: p(A) = sigma(w . (g(xA) - g(xB))), no intercept.

    Side features are imputed with the training mean (missing -> 0 contribution), pre-UFC features are
    multiplied by exp(-n / tau) so they fade with UFC experience, then scaled (not centred)."""

    def __init__(self, base, pre, C=1.0, tau=None, add_missing=True):
        self.base, self.pre, self.C, self.tau, self.add_missing = list(base), list(pre), C, tau, add_missing

    def _side(self, df, tag, fit=False):
        import numpy as np
        cols = []
        X = []
        for k in self.base:
            v = df[k + "_" + tag].to_numpy(float)
            X.append(v)
            cols.append(k)
        w = np.ones(len(df))
        if self.tau:
            w = np.exp(-df["n" + tag].to_numpy(float) / self.tau)
        for k in self.pre:
            v = df[k + "_" + tag].to_numpy(float)
            X.append(v)
            cols.append(k)
        X = np.vstack(X).T if X else np.zeros((len(df), 0))
        return X, w, cols

    def design(self, df, fit=False):
        import numpy as np
        XA, wA, cols = self._side(df, "A")
        XB, wB, _ = self._side(df, "B")
        if fit:
            both = np.vstack([XA, XB])
            self.mu = np.nanmean(both, axis=0)
            self.mu = np.where(np.isnan(self.mu), 0.0, self.mu)
        XA = np.where(np.isnan(XA), self.mu, XA)
        XB = np.where(np.isnan(XB), self.mu, XB)
        nb = len(self.base)
        # pre-UFC block: centre at the mean, fade with experience
        XA[:, nb:] = (XA[:, nb:] - self.mu[nb:]) * wA[:, None]
        XB[:, nb:] = (XB[:, nb:] - self.mu[nb:]) * wB[:, None]
        D = XA - XB
        if self.pre and self.add_missing:
            mA = (1 - df["res_A"].to_numpy(float)) * wA
            mB = (1 - df["res_B"].to_numpy(float)) * wB
            D = np.hstack([D, (mA - mB)[:, None]])
        if fit:
            self.sd = D.std(axis=0)
            self.sd = np.where(self.sd < 1e-9, 1.0, self.sd)
        return D / self.sd

    def fit(self, df):
        from sklearn.linear_model import LogisticRegression
        D = self.design(df, fit=True)
        self.m = LogisticRegression(C=self.C, fit_intercept=False, max_iter=2000)
        self.m.fit(D, df["y"].to_numpy())
        return self

    def predict(self, df):
        return self.m.predict_proba(self.design(df))[:, 1]

    def coefs(self):
        names = self.base + self.pre + (["pre_missing"] if self.pre and self.add_missing else [])
        return {k: round(float(c), 4) for k, c in zip(names, self.m.coef_[0])}


class GBMDiff:
    """LightGBM on side features with swap augmentation; prediction averaged over both corner orders."""

    def __init__(self, keys, params=None):
        self.keys = list(keys)
        self.params = params or {}

    def _X(self, df, swap=False):
        import numpy as np
        a, b = ("B", "A") if swap else ("A", "B")
        cols = []
        for k in self.keys:
            cols.append(df[k + "_" + a].to_numpy(float))
            cols.append(df[k + "_" + b].to_numpy(float))
            cols.append(df[k + "_" + a].to_numpy(float) - df[k + "_" + b].to_numpy(float))
        cols.append(df["n" + a].to_numpy(float))
        cols.append(df["n" + b].to_numpy(float))
        return np.vstack(cols).T

    def fit(self, df):
        import numpy as np
        import lightgbm as lgb
        X = np.vstack([self._X(df), self._X(df, swap=True)])
        y = np.concatenate([df["y"].to_numpy(), 1 - df["y"].to_numpy()])
        p = dict(n_estimators=300, learning_rate=0.02, num_leaves=7, min_child_samples=40, subsample=0.8,
                 subsample_freq=1, colsample_bytree=0.7, reg_lambda=5.0, verbose=-1)
        p.update(self.params)
        self.m = lgb.LGBMClassifier(**p)
        self.m.fit(X, y)
        return self

    def predict(self, df):
        p1 = self.m.predict_proba(self._X(df))[:, 1]
        p2 = self.m.predict_proba(self._X(df, swap=True))[:, 1]
        return 0.5 * (p1 + 1 - p2)


def evaluate(args):
    import numpy as np
    import pandas as pd
    t0 = time.time()
    path = os.path.join(DERIVED, "preufc.json")
    pre = json.load(open(path))
    cols = pre["meta"]["snapshot_columns"]
    snaps = {}
    for slug, v in pre["fighters"].items():
        if v.get("status") != "ok":
            continue
        for row in v["snapshots"]:
            snaps[(slug, row[1])] = dict(zip(cols, row))
    fights, people, bouts = load_ufc()
    train_from = dt.date.fromisoformat(args.extra_since or args.since)
    rep = json.load(open(os.path.join(DERIVED, "elo_report.json")))
    K, boost = rep["chosen"]["K"], rep["chosen"]["boost"]
    E = EloRunner(fights, K, boost, seed_from=train_from)
    elo_pre = E.run()
    ufc = ufc_walk(fights, people)
    df_all = build_frame(fights, people, ufc, elo_pre, snaps, train_from)
    # sanity: our Elo equals backtest.json's pre-fight Elo
    bt = json.load(open(os.path.join(DERIVED, "backtest.json")))["fights"]
    btid = {e["id"]: e for e in bt}
    chk = [abs(elo_pre[e["id"]][0] - e["A"]["elo"]) for e in bt[:500] if e["id"] in elo_pre]
    print("Elo check vs backtest.json: max |diff| %.4f over %d" % (max(chk), len(chk)))
    df = df_all[df_all["decisive"]].copy()
    tested = set(T for T in targets(fights, people, args.since, args.extra_since))
    print("rows %d decisive since %s; newcomer rows %d; %.0f s" % (len(df), train_from, int(df["newc"].sum()),
                                                                   time.time() - t0))
    # coverage among newcomer sides
    nc = df[df["newc"]]
    cov = {}
    for lab, sel in (("train", nc["date"] < TEST_FROM), ("test", nc["date"] >= TEST_FROM)):
        sub = nc[sel]
        sides = [(r["nA"], r["res_A"]) for _, r in sub.iterrows()] + [(r["nB"], r["res_B"]) for _, r in sub.iterrows()]
        new_sides = [(n, rs) for n, rs in sides if n <= 3]
        cov[lab] = {"fights": int(len(sub)), "newcomer_sides": len(new_sides),
                    "newcomer_sides_with_sherdog": int(sum(rs for _, rs in new_sides)),
                    "debut_sides": sum(1 for n, _ in new_sides if n == 0),
                    "debut_sides_with_sherdog": int(sum(rs for n, rs in new_sides if n == 0))}
    print("coverage", cov)

    # ---------------- seeded Elo: debut rating = 1500 + beta . z(pre-UFC record at debut)
    deb = {}
    first_fid = {}
    for p, ub in bouts.items():
        if p.startswith(("amb:", "name:")):
            continue
        d, q, on, f = min(ub, key=lambda t: (t[0], -t[3].idx))
        first_fid[p] = (f.fid, d)
    for p, (fid, d) in first_fid.items():
        if p not in tested:
            continue                          # not crawled (debut long before the window): plain 1500
        sp = side_pre(snaps.get((people[p]["slug"], fid)), 0)
        deb[p] = sp
    seed_keys_all = {"pre": PRE_CORE, "pre_small": ["pre_wpct", "pre_logn", "pre_feed", "pre_netelo", "pre_oppufc"]}

    def age_at(p, d):
        T = people[p].get("tott") or {}
        return (d - T["dob"]).days / 365.25 if T.get("dob") else float("nan")

    def fit_seed(keys, use_age, fit_to, fit_from=train_from, sigma=75.0, fit_boost=False):
        """Fit seed coefficients (Elo points per SD) by minimizing Elo log loss on newcomer bouts in
        [fit_from, fit_to); mild ridge = Gaussian prior with sd `sigma` Elo points per coefficient."""
        from scipy.optimize import minimize
        nk = len(keys) + int(use_age)
        ps = [p for p in deb if first_fid[p][1] >= train_from and p in E.idx]

        def raw(p):
            sp = deb[p]
            row = [sp[k] for k in keys] if sp else [float("nan")] * len(keys)
            if use_age:
                row.append(age_at(p, first_fid[p][1]))
            return row
        fitp = [p for p in ps if first_fid[p][1] < fit_to]
        M = np.array([raw(p) for p in fitp], float) if fitp else np.zeros((0, nk))
        mu = np.nanmean(M, axis=0) if len(M) else np.zeros(nk)
        sdv = np.nanstd(M, axis=0) if len(M) else np.ones(nk)
        sdv = np.where(~np.isfinite(sdv) | (sdv < 1e-9), 1.0, sdv)
        mu = np.where(np.isfinite(mu), mu, 0.0)
        Zrows, Zidx = [], []
        for p in ps:
            v = np.array(raw(p), float)
            miss = deb[p] is None
            v = np.where(np.isnan(v), mu, v)
            z = (v - mu) / sdv
            if miss and keys:
                z[:len(keys)] = 0.0
            Zrows.append(np.concatenate([z, [1.0 if (miss and keys) else 0.0]]))
            Zidx.append(E.idx[p])
        Z = np.array(Zrows) if Zrows else np.zeros((0, nk + 1))
        sel = df[(df["date"] >= fit_from) & (df["date"] < fit_to) & df["newc"]]
        fids, yv = sel["fid"].tolist(), sel["y"].to_numpy()
        nfit = max(1, len(fids))

        def obj(theta):
            beta = theta[:nk + 1]
            bo = theta[nk + 1] if fit_boost else None
            sv = 1500.0 + Z @ beta
            pre_ = E.run(dict(zip(Zidx, sv)), boost=bo, until=fit_to)
            p = np.array([pre_[f][2] for f in fids])
            return ll(p, yv) + float(beta @ beta) / (2 * sigma ** 2 * nfit)
        th0 = np.zeros(nk + 1 + int(fit_boost))
        if fit_boost:
            th0[-1] = boost
        r = minimize(obj, th0, method="L-BFGS-B", options={"eps": 0.25, "maxiter": 200})
        beta = r.x[:nk + 1]
        bo = r.x[nk + 1] if fit_boost else None
        return {"beta": beta, "boost": bo, "mu": mu, "sd": sdv, "keys": keys + (["age_debut"] if use_age else []),
                "Z": Z, "Zidx": Zidx, "loss": r.fun, "nit": r.nit}

    def seeded_pre(sfit):
        sv = 1500.0 + sfit["Z"] @ sfit["beta"]
        return E.run(dict(zip(sfit["Zidx"], sv)), boost=sfit["boost"]), sv

    # ---------------- model zoo
    base_sets = {"elo": ["elo"], "base": BASE_KEYS}
    results = {}
    newc = df[df["newc"]].copy()

    def cv_eval(make, data, years=CV_YEARS, extra=None):
        """Time-ordered CV: for each year Y train on [train_from, Y), score Y. Returns pooled oof preds."""
        oof = pd.Series(np.nan, index=data.index)
        for Y in years:
            tr = data[(data["date"] < dt.date(Y, 1, 1))]
            va = data[(data["year"] == Y)]
            if len(tr) < 50 or len(va) == 0:
                continue
            m = make().fit(tr)
            oof.loc[va.index] = m.predict(va)
        return oof

    def oof_ll(oof, data):
        s = oof.notna()
        return ll(oof[s].to_numpy(), data.loc[s, "y"].to_numpy())

    trainval = newc[newc["date"] < TEST_FROM]
    test = newc[newc["date"] >= TEST_FROM]
    cvlog = []
    # 1) Elo calibrated, base logistic, base + pre logistic (C, tau grids)
    best = {}
    for name, mk in [("elo_cal", lambda C: DiffModel(["elo"], [], C=C))]:
        for C in (1.0,):
            o = cv_eval(lambda: mk(C), trainval)
            cvlog.append({"model": name, "C": C, "cv_ll": oof_ll(o, trainval)})
    for C in (0.01, 0.03, 0.1, 0.3, 1.0):
        o = cv_eval(lambda: DiffModel(BASE_KEYS, [], C=C), trainval)
        cvlog.append({"model": "base", "C": C, "cv_ll": oof_ll(o, trainval)})
    for fs_name, fs in (("core", PRE_CORE), ("all", PRE_KEYS)):
        for C in (0.01, 0.03, 0.1, 0.3):
            for tau in (1.0, 2.0, 4.0, None):
                o = cv_eval(lambda: DiffModel(BASE_KEYS, fs, C=C, tau=tau), trainval)
                cvlog.append({"model": "base+pre_" + fs_name, "C": C, "tau": tau, "cv_ll": oof_ll(o, trainval)})
                o = cv_eval(lambda: DiffModel(["elo"], fs, C=C, tau=tau), trainval)
                cvlog.append({"model": "elo+pre_" + fs_name, "C": C, "tau": tau, "cv_ll": oof_ll(o, trainval)})
    for row in cvlog:
        k = row["model"]
        if k not in best or row["cv_ll"] < best[k]["cv_ll"]:
            best[k] = row
    print("CV best:", json.dumps(best, default=str))
    # GBM
    for fs_name, keys in (("gbm_base", BASE_KEYS), ("gbm_base+pre", BASE_KEYS + PRE_CORE + ["res"])):
        o = cv_eval(lambda: GBMDiff(keys), trainval)
        best[fs_name] = {"model": fs_name, "cv_ll": oof_ll(o, trainval)}
    print("CV gbm:", {k: round(v["cv_ll"], 4) for k, v in best.items() if k.startswith("gbm")})

    # 2) seeded Elo: CV per year (fit on [train_from, Y), score newcomer bouts of year Y)
    seed_cv = {}
    for nm, keys, use_age in (("seed_age", [], True), ("seed_pre", PRE_CORE, False), ("seed_pre+age", PRE_CORE, True),
                              ("seed_small+age", seed_keys_all["pre_small"], True)):
        ps, ys = [], []
        for Y in CV_YEARS:
            sf = fit_seed(keys, use_age, dt.date(Y, 1, 1))
            pre_, _ = seeded_pre(sf)
            va = trainval[trainval["year"] == Y]
            ps.extend(pre_[f][2] for f in va["fid"])
            ys.extend(va["y"])
        seed_cv[nm] = ll(np.array(ps), np.array(ys))
        print("seed CV", nm, round(seed_cv[nm], 4), "%.0f s" % (time.time() - t0), flush=True)
    va = trainval[trainval["year"] >= CV_YEARS[0]]
    seed_cv["elo_raw"] = ll(va["elo_p"].to_numpy(), va["y"].to_numpy())
    print("seed CV elo_raw", round(seed_cv["elo_raw"], 4))

    # ---------------- final fits on [train_from, 2024) and one look at 2024+
    final = {}
    preds_test = {}
    preds_test["elo"] = test["elo_p"].to_numpy()
    b = best["elo_cal"]
    m_elo = DiffModel(["elo"], [], C=b["C"]).fit(trainval)
    preds_test["elo_cal"] = m_elo.predict(test)
    b = best["base"]
    m_base = DiffModel(BASE_KEYS, [], C=b["C"]).fit(trainval)
    preds_test["base"] = m_base.predict(test)
    pick = min((best["base+pre_core"], best["base+pre_all"]), key=lambda r: r["cv_ll"])
    fs = PRE_CORE if pick["model"].endswith("core") else PRE_KEYS
    m_bp = DiffModel(BASE_KEYS, fs, C=pick["C"], tau=pick["tau"]).fit(trainval)
    preds_test["base+pre"] = m_bp.predict(test)
    pick_e = min((best["elo+pre_core"], best["elo+pre_all"]), key=lambda r: r["cv_ll"])
    fs_e = PRE_CORE if pick_e["model"].endswith("core") else PRE_KEYS
    m_ep = DiffModel(["elo"], fs_e, C=pick_e["C"], tau=pick_e["tau"]).fit(trainval)
    preds_test["elo+pre"] = m_ep.predict(test)
    g0 = GBMDiff(BASE_KEYS).fit(trainval)
    g1 = GBMDiff(BASE_KEYS + PRE_CORE + ["res"]).fit(trainval)
    preds_test["gbm_base"] = g0.predict(test)
    preds_test["gbm_base+pre"] = g1.predict(test)
    seed_fits = {}
    for nm, keys, use_age in (("seed_age", [], True), ("seed_pre+age", PRE_CORE, True),
                              ("seed_pre", PRE_CORE, False)):
        sf = fit_seed(keys, use_age, TEST_FROM)
        seed_fits[nm] = sf
        pre_, seed = seeded_pre(sf)
        preds_test["elo_" + nm] = np.array([pre_[f][2] for f in test["fid"]])
    print("final fits done %.0f s" % (time.time() - t0), flush=True)
    yt = test["y"].to_numpy()

    # ---------------- bootstrap CIs
    rng = np.random.default_rng(20261106)
    B_ = 2000
    nT = len(yt)
    idxs = rng.integers(0, nT, size=(B_, nT))

    def boot(p):
        p = np.clip(p, 1e-6, 1 - 1e-6)
        lls = -(yt * np.log(p) + (1 - yt) * np.log(1 - p))
        br = (p - yt) ** 2
        ac = ((p > 0.5) == (yt > 0.5)).astype(float)
        out = {}
        for k, v in (("log_loss", lls), ("brier", br), ("accuracy", ac)):
            bs = v[idxs].mean(axis=1)
            out[k] = [float(v.mean()), float(np.percentile(bs, 2.5)), float(np.percentile(bs, 97.5))]
        return out, lls

    test_res = {}
    lls_by = {}
    for k, p in preds_test.items():
        test_res[k], lls_by[k] = boot(p)
    deltas = {}
    for ref in ("elo", "elo_cal", "base"):
        for k in preds_test:
            if k == ref:
                continue
            dlt = lls_by[k] - lls_by[ref]
            bs = dlt[idxs].mean(axis=1)
            deltas["%s - %s" % (k, ref)] = [float(dlt.mean()), float(np.percentile(bs, 2.5)),
                                           float(np.percentile(bs, 97.5)), float((bs < 0).mean())]
    # subgroups
    sub = {}
    groups = {"debut (a side with 0 prior UFC bouts)": (test[["nA", "nB"]].min(axis=1) == 0).to_numpy(),
              "1-3 prior (no debutant)": (test[["nA", "nB"]].min(axis=1) > 0).to_numpy(),
              "both sides newcomers": (test[["nA", "nB"]].max(axis=1) <= 3).to_numpy(),
              "newcomer vs veteran (4+)": (test[["nA", "nB"]].max(axis=1) >= 4).to_numpy(),
              "both newcomer sides resolved": ((test["res_A"] + (test["nA"] > 3)).clip(0, 1) *
                                              (test["res_B"] + (test["nB"] > 3)).clip(0, 1) > 0).to_numpy()}
    for g, msk in groups.items():
        sub[g] = {"n": int(msk.sum())}
        for k in preds_test:
            sub[g][k] = round(float(lls_by[k][msk].mean()), 4)
    # calibration for the main candidates
    def calib(p, y, nb=10):
        out = []
        for i in range(nb):
            lo, hi = i / nb, (i + 1) / nb
            m = (p >= lo) & ((p < hi) | ((i == nb - 1) & (p <= 1)))
            if m.sum():
                out.append({"lo": lo, "hi": hi, "n": int(m.sum()), "pred": round(float(p[m].mean()), 4),
                            "obs": round(float(y[m].mean()), 4)})
        return out

    def ece(p, y, nb=10):
        e = 0.0
        for i in range(nb):
            m = (p >= i / nb) & (p < (i + 1) / nb)
            if m.sum():
                e += m.sum() / len(p) * abs(p[m].mean() - y[m].mean())
        return float(e)
    calib_out = {k: {"bins": calib(preds_test[k], yt), "ece": round(ece(preds_test[k], yt), 4)}
                 for k in preds_test}

    # all 2024+ decisive bouts: does the seeded Elo hurt veterans?
    allt = df[df["date"] >= TEST_FROM]
    overall = {"n": int(len(allt)), "elo": scores(allt["elo_p"].to_numpy(), allt["y"].to_numpy())}
    for nm, sf in seed_fits.items():
        pre_, _ = seeded_pre(sf)
        p = np.array([pre_[f][2] for f in allt["fid"]])
        overall["elo_" + nm] = scores(p, allt["y"].to_numpy())
    both_prior = allt[(allt["nA"] >= 1) & (allt["nB"] >= 1)]
    overall["backtest_rule_subset (both >= 1 prior)"] = {"n": int(len(both_prior)),
                                                         "elo": scores(both_prior["elo_p"].to_numpy(),
                                                                       both_prior["y"].to_numpy())}
    for nm, sf in seed_fits.items():
        pre_, _ = seeded_pre(sf)
        p = np.array([pre_[f][2] for f in both_prior["fid"]])
        overall["backtest_rule_subset (both >= 1 prior)"]["elo_" + nm] = scores(p, both_prior["y"].to_numpy())

    # ---------------- method (how): KO / SUB / DEC for newcomer bouts
    meth = method_eval(df_all, train_from)

    # ---------------- out-of-sample predictions for every newcomer bout 2019+ (CV years oof, 2024+ final)
    predictions = {}
    oof_bp = cv_eval(lambda: DiffModel(BASE_KEYS, fs, C=pick["C"], tau=pick["tau"]), trainval)
    oof_b = cv_eval(lambda: DiffModel(BASE_KEYS, [], C=best["base"]["C"]), trainval)
    seedY = {}
    for Y in CV_YEARS:
        sf = fit_seed(PRE_CORE, True, dt.date(Y, 1, 1))
        seedY[Y], _ = seeded_pre(sf)
    pre_final, seed_final = seeded_pre(seed_fits["seed_pre+age"])
    for i, r in trainval[trainval["year"] >= CV_YEARS[0]].iterrows():
        predictions[r["fid"]] = {"date": r["date"].isoformat(), "split": "cv", "in_backtest": r["fid"] in btid,
                                 "nA": int(r["nA"]), "nB": int(r["nB"]),
                                 "p_elo": round(float(r["elo_p"]), 4),
                                 "p_seeded_elo": round(float(seedY[r["year"]][r["fid"]][2]), 4),
                                 "p_base": round(float(oof_b[i]), 4), "p_base_pre": round(float(oof_bp[i]), 4)}
    for j, (i, r) in enumerate(test.iterrows()):
        predictions[r["fid"]] = {"date": r["date"].isoformat(), "split": "test", "in_backtest": r["fid"] in btid,
                                 "nA": int(r["nA"]), "nB": int(r["nB"]),
                                 "p_elo": round(float(r["elo_p"]), 4),
                                 "p_seeded_elo": round(float(preds_test["elo_seed_pre+age"][j]), 4),
                                 "p_base": round(float(preds_test["base"][j]), 4),
                                 "p_base_pre": round(float(preds_test["base+pre"][j]), 4)}
    # every backtest bout: seeded-Elo probability (walk-forward), for the ensemble
    seeded_bt = {}
    for e in bt:
        Y = int(e["date"][:4])
        src = seedY.get(Y, pre_final) if Y < 2024 else pre_final
        if e["id"] in src:
            seeded_bt[e["id"]] = round(float(src[e["id"]][2]), 4)

    # ---------------- roster-level newcomer priors (live use, fit on everything before 2024 + refit to now)
    roster = roster_priors(pre, people, bouts, seed_fits["seed_pre+age"], first_fid, age_at, fights, snaps)

    ev = {
        "built": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
        "design": {
            "rows": "decisive UFC bouts (draws and no-contests excluded) where at least one side had 0-3 prior UFC "
                    "bouts; train/tune [%s, 2024-01-01), time-ordered CV years %s (fit on all earlier years, score "
                    "year Y); test 2024-01-01 to %s scored once" % (train_from, CV_YEARS, max(df["date"])),
            "elo": "walk-forward Elo over every UFC bout since 1994, K=%d, boost %.1f for the first 5 UFC bouts "
                   "(tools/build_db.py rule; reproduced exactly)" % (K, boost),
            "base": "symmetric no-intercept logistic on side differences: Elo, age, reach, height, log(1+n UFC), "
                    "UFC win log-odds, UFC finish win / finished-loss rates, layoff, shrunk decayed UFC rates "
                    "(sig landed/absorbed per min, accuracy, defense, TD/15, TD acc, TD def, sub att/15, KD/15 for "
                    "and against, control for and against)",
            "pre": "Sherdog pre-UFC features per side from snapshots dated strictly before the bout, imputed at the "
                   "train mean when unresolved (plus a missing flag), faded by exp(-n_UFC/tau)",
            "seeded_elo": "Elo whose debut rating is 1500 + beta . z(pre-UFC record at debut [+ age at debut]); beta "
                          "fit by minimizing Elo log loss on train newcomer bouts; every later bout uses the same "
                          "Elo updates",
        },
        "coverage": cov,
        "cv": {"best": best, "seeded_elo_cv_ll": seed_cv, "grid": cvlog},
        "test": {"metrics_ci95": test_res, "delta_log_loss_ci95 [mean, lo, hi, P(<0)]": deltas,
                 "subgroups_log_loss": sub, "calibration": calib_out, "all_2024plus_bouts": overall},
        "models": {"base+pre": {"features": fs, "C": pick["C"], "tau": pick["tau"], "coef": m_bp.coefs()},
                   "elo+pre": {"features": fs_e, "C": pick_e["C"], "tau": pick_e["tau"], "coef": m_ep.coefs()},
                   "base": {"C": best["base"]["C"], "coef": m_base.coefs()},
                   "seeded_elo": {nm: {"keys": sf["keys"] + ["missing"], "beta_elo_points_per_sd":
                                       [round(float(x), 2) for x in sf["beta"]],
                                       "mu": [round(float(x), 4) for x in sf["mu"]],
                                       "sd": [round(float(x), 4) for x in sf["sd"]],
                                       "boost": sf["boost"]} for nm, sf in seed_fits.items()}},
        "method": meth,
    }
    pre["eval"] = ev
    pre["predictions"] = predictions
    pre["seeded_elo_backtest"] = seeded_bt
    pre["roster_priors"] = roster
    with open(path, "w") as fh:
        json.dump(pre, fh, separators=(",", ":"), default=str)
    print(json.dumps({"test": {k: [round(x, 4) for x in v["log_loss"]] for k, v in test_res.items()}}, indent=1))
    print(json.dumps({k: [round(x, 4) for x in v] for k, v in deltas.items() if k.endswith("- elo") or
                      k.endswith("- base")}, indent=1))
    print(json.dumps(sub, indent=1))
    print(json.dumps(overall, indent=1, default=str)[:3000])
    print("done %.0f s" % (time.time() - t0))
    return ev


def method_eval(df_all, train_from):
    """KO / SUB / DEC multinomial for decisive newcomer bouts: UFC-only finish rates vs + pre-UFC finish rates."""
    import numpy as np
    from sklearn.linear_model import LogisticRegression
    d = df_all[df_all["decisive"] & df_all["newc"] & df_all["cat"].isin(["ko", "sub", "dec"])].copy()
    lab = {"ko": 0, "sub": 1, "dec": 2}
    y = d["cat"].map(lab).to_numpy()
    divs = sorted(d["division"].unique())

    def X(dd, with_pre, tau=2.0):
        cols = []
        for dv in divs:
            cols.append((dd["division"] == dv).astype(float).to_numpy())
        cols.append((dd["rounds"] == 5).astype(float).to_numpy())
        for k in ("uko", "usub", "ukol", "usubl"):
            cols.append(dd[k + "_A"].to_numpy() + dd[k + "_B"].to_numpy())
        if with_pre:
            for k in ("pre_ko", "pre_sub", "pre_kol", "pre_subl", "pre_fin", "pre_finl"):
                tot = 0
                for t in "AB":
                    v = dd[k + "_" + t].to_numpy(float)
                    mu = np.nanmean(d[k + "_A"].to_numpy(float))
                    v = np.where(np.isnan(v), mu, v) - mu
                    tot = tot + v * np.exp(-dd["n" + t].to_numpy(float) / tau)
                cols.append(tot)
        return np.vstack(cols).T

    out = {}
    tr = (d["date"] < TEST_FROM).to_numpy()
    te = ~tr
    base_rate = np.bincount(y[tr], minlength=3) / tr.sum()
    res = {"n_train": int(tr.sum()), "n_test": int(te.sum()), "train_shares": base_rate.round(4).tolist()}
    yt = y[te]

    def mll(P, yy):
        return float(-np.mean(np.log(np.clip(P[np.arange(len(yy)), yy], 1e-9, 1))))
    res["test_ll_base_rate"] = mll(np.tile(base_rate, (te.sum(), 1)), yt)
    rng = np.random.default_rng(7)
    idx = rng.integers(0, te.sum(), size=(2000, te.sum()))
    P = {}
    for nm, wp in (("ufc_only", False), ("ufc+pre", True)):
        best = None
        for C in (0.03, 0.1, 0.3, 1.0):
            # time-ordered CV inside train
            lls = []
            for Y in CV_YEARS:
                a = tr & (d["date"] < dt.date(Y, 1, 1)).to_numpy()
                b = tr & (d["year"] == Y).to_numpy()
                if a.sum() < 50 or b.sum() == 0:
                    continue
                m = LogisticRegression(C=C, max_iter=3000).fit(X(d[a], wp), y[a])
                lls.append((mll(m.predict_proba(X(d[b], wp)), y[b]), b.sum()))
            cvl = sum(l * n for l, n in lls) / sum(n for _, n in lls)
            if best is None or cvl < best[0]:
                best = (cvl, C)
        m = LogisticRegression(C=best[1], max_iter=3000).fit(X(d[tr], wp), y[tr])
        P[nm] = m.predict_proba(X(d[te], wp))
        lv = -np.log(np.clip(P[nm][np.arange(len(yt)), yt], 1e-9, 1))
        bs = lv[idx].mean(axis=1)
        res[nm] = {"cv_ll": round(best[0], 4), "C": best[1], "test_ll": round(float(lv.mean()), 4),
                   "ci95": [round(float(np.percentile(bs, 2.5)), 4), round(float(np.percentile(bs, 97.5)), 4)]}
        if wp:
            res[nm]["coef_pre (KO,SUB,DEC rows; last 6 = pre_ko pre_sub pre_kol pre_subl pre_fin pre_finl)"] = \
                np.round(m.coef_[:, -6:], 3).tolist()
    l0 = -np.log(np.clip(P["ufc_only"][np.arange(len(yt)), yt], 1e-9, 1))
    l1 = -np.log(np.clip(P["ufc+pre"][np.arange(len(yt)), yt], 1e-9, 1))
    dl = l1 - l0
    bs = dl[idx].mean(axis=1)
    res["delta_ll (ufc+pre - ufc_only)"] = [round(float(dl.mean()), 4), round(float(np.percentile(bs, 2.5)), 4),
                                            round(float(np.percentile(bs, 97.5)), 4), round(float((bs < 0).mean()), 3)]
    # finish vs decision (binary) calibration of the + pre model
    pf = P["ufc+pre"][:, 0] + P["ufc+pre"][:, 1]
    yf = (yt < 2).astype(float)
    res["finish_binary"] = {"ufc_only_ll": round(ll(P["ufc_only"][:, 0] + P["ufc_only"][:, 1], yf), 4),
                            "ufc+pre_ll": round(ll(pf, yf), 4), "base_rate_ll": round(ll(np.full(len(yf), base_rate[:2].sum()), yf), 4)}
    print("method:", json.dumps({k: v for k, v in res.items() if not k.startswith("coef")}, default=str))
    return res


def roster_priors(pre, people, bouts, sfit, first_fid, age_at, fights, snaps):
    """Per roster fighter: the seeded-Elo debut shift and finish-propensity multipliers from the pre-UFC record."""
    import numpy as np
    out = {}
    keys = sfit["keys"]
    nk = len(keys)
    beta = sfit["beta"]
    slug2p = {P["slug"]: p for p, P in people.items()}
    for slug, v in pre["fighters"].items():
        p = slug2p.get(slug)
        if p is None:
            continue
        item = {"n_ufc": len(bouts.get(p, []))}
        if v.get("status") == "ok" and v.get("debut"):
            sp = side_pre(v["debut"], 0)
            row = [sp[k] for k in keys if k != "age_debut"]
            if "age_debut" in keys:
                row.append(age_at(p, first_fid[p][1]) if p in first_fid else float("nan"))
            x = np.array(row, float)
            x = np.where(np.isnan(x), sfit["mu"], x)
            z = (x - sfit["mu"]) / sfit["sd"]
            shift = float(z @ beta[:nk])
            item["elo_debut_shift"] = round(shift, 1)
            item["elo_debut_shift_pre_only"] = round(float(sum(z[i] * beta[i] for i, k in enumerate(keys)
                                                               if k != "age_debut")), 1)
            d = v["debut"]
            nn = d["n"]
            item["pre_record"] = "%d-%d-%d" % (d["w"], d["l"], d["d"])
            item["pre_ko_rate"] = round((d["ko_w"] + 0.3) / (nn + 2.0), 3)
            item["pre_sub_rate"] = round((d["sub_w"] + 0.2) / (nn + 2.0), 3)
            item["pre_finished_rate"] = round((d["ko_l"] + d["sub_l"] + 0.3) / (nn + 2.0), 3)
            c = v["current"]
            item["current_nonufc_record"] = "%d-%d-%d" % (c["w"], c["l"], c["d"])
        else:
            item["elo_debut_shift"] = round(float(beta[nk]), 1)
            item["status"] = v.get("status")
        out[slug] = item
    # finish multipliers relative to the roster mean (engine power / sub-threat priors for newcomers)
    ko = np.array([o["pre_ko_rate"] for o in out.values() if "pre_ko_rate" in o])
    sb = np.array([o["pre_sub_rate"] for o in out.values() if "pre_sub_rate" in o])
    for o in out.values():
        if "pre_ko_rate" in o:
            o["ko_rate_vs_roster"] = round(o["pre_ko_rate"] / ko.mean(), 3)
            o["sub_rate_vs_roster"] = round(o["pre_sub_rate"] / sb.mean(), 3)
    return out


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
