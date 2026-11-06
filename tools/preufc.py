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


SUFFIX = {"jr", "sr", "ii", "iii", "iv", "junior"}


def core_name(s):
    return " ".join(t for t in norm(s).split() if t not in SUFFIX)


def name_sim(a, b):
    """0..1 similarity between two person names (order-insensitive, tolerant of middle names and suffixes)."""
    na, nb = core_name(a), core_name(b)
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


# ufcstats ring names that Sherdog files under the legal name (checked by hand on Sherdog's fight finder)
SD_ALIASES = {"Loma Lookboonmee": "Konklak Suphisara", "CM Punk": "Phil Brooks", "Blood Diamond": "Mike Mathetha",
              "Tina Black": "Valesca Machado"}


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
            dd = abs((rd - d).days)
            if dd > 3:
                continue
            s = name_sim(oname, r["opp"])
            if oname in SD_ALIASES:
                s = max(s, name_sim(SD_ALIASES[oname], r["opp"]))
            on, ro = core_name(oname).split(), core_name(r["opp"]).split()
            if on and ro and on[-1] == ro[-1]:
                s = max(s, 0.8)            # same surname on the same card (RJ / Richard Harris)
            if dd <= 1 and s >= 0.4 and promotion(r["event"]) == "UFC":
                s = max(s, 0.73)           # a UFC row on the bout date with a loosely similar opponent
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
        tk = core_name(name).split()
        queries = [name] + ([SD_ALIASES[name]] if name in SD_ALIASES else [])
        if core_name(name) != norm(name):
            queries.append(" ".join(tk))
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
                s = max(name_sim(name, c["name"]), name_sim(SD_ALIASES.get(name, ""), c["name"]))
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
    (r"^(cwfc|cage warriors)|^cw\b.*cage warriors", "Cage Warriors"),
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
    def cut(x):
        out = []
        for t in x.split():
            if re.fullmatch(r"#?\d+[a-z]?:?|\d{4}|[IVX]{1,4}|season|week|episode|vol\.?|volume|night|day|\(.*", t,
                            re.I):
                break
            out.append(t)
        return " ".join(out).strip(" :")
    key = cut(pre) or pre or "?"
    # Sherdog prefixes are acronyms that collide (AFC = Aspera FC, Absolute FC, Australian FC ...): when the
    # text after the dash reads like the organization's long name (no "vs", same initial), append it
    parts = e.split(" - ", 1)
    if len(parts) == 2 and re.fullmatch(r"[A-Z0-9&\-]{2,6}", key):
        sub = cut(parts[1].split(":")[0])
        if (" vs" not in parts[1].lower() and len(sub.split()) >= 2 and sub[:1].upper() == key[:1]
                and len(sub) <= 50):
            key = key + " | " + sub
    return key


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
             "opp_known", "opp_wpct", "opp_ufc_w", "opp_ufc_n", "net_elo", "exh_n", "exh_w",
             "net_elo_h", "opp_wpct_h", "opp_known_h"]


class StrictNetwork:
    """Time-honest version of the Sherdog-network features (net Elo, opponents' records).

    The full network (net_elo, opp_wpct) is the union of every cached page. Which pages are cached depends on
    the future: a regional opponent who reached the UFC in 2025 has his whole history in the network, one who
    never did has only his fights against cached fighters. A 2021 snapshot that rates its opponents with that
    network uses who-made-the-UFC-later information. Here a bout dated D uses network_C with C = Jan 1 of D's
    year, built only from the pages of UFC debutants whose first UFC bout is in [graduates_from, C): every such
    debutant was crawled (complete set, chosen by facts known before C). The fighter's own page is always known
    on the bout date; when it is not in network_C, his rating is a one-sided Elo walk over his own rows
    against opponents rated in network_C on each fight date. Opponent records are their network_C win share
    before the fight date (>= 3 known fights). Same K (32) and start (1500) as the full network."""

    NK = 32.0

    def __init__(self, rowsby, res, first_ufc, grad_from, today):
        import bisect
        self.bisect = bisect
        self.first_ufc = first_ufc
        self.grad_from = grad_from
        uniq = {}
        for p, rows in rowsby.items():
            of = first_ufc[p]
            if of < grad_from:
                continue
            me = sid(res[p]["href"])
            for r in rows:
                if not r["_d"] or r["_sid"] is None:
                    continue
                sc = {"W": 1.0, "L": 0.0, "D": 0.5}.get(r["res"])
                if sc is None:
                    continue
                a, b = me, r["_sid"]
                key = (r["date"], min(a, b), max(a, b))
                if key in uniq:
                    uniq[key][4] = min(uniq[key][4], of)       # in network_C if either owner debuted before C
                    continue
                uniq[key] = [r["_d"], a, b, sc, of]
        fl = sorted(uniq.values(), key=lambda t: t[0])
        self.n_fights = len(fl)
        self.cuts = [dt.date(y, 1, 1) for y in range(grad_from.year, today.year + 2)]
        self.R = {}        # cut -> sid -> (dates, ratings after)
        self.W = {}        # cut -> sid -> (dates, cumulative wins, cumulative fights) after each fight
        for C in self.cuts:
            R = defaultdict(lambda: 1500.0)
            hist = defaultdict(lambda: ([], []))
            rec = defaultdict(lambda: ([], [], []))
            wl = defaultdict(lambda: [0, 0])
            for d, a, b, sc, of in fl:
                if of >= C:
                    continue
                ra, rb = R[a], R[b]
                ea = 1 / (1 + 10 ** ((rb - ra) / 400))
                R[a] = ra + self.NK * (sc - ea)
                R[b] = rb - self.NK * (sc - ea)
                if sc == 1.0:
                    wl[a][0] += 1
                elif sc == 0.0:
                    wl[b][0] += 1
                wl[a][1] += 1
                wl[b][1] += 1
                for x in (a, b):
                    hist[x][0].append(d)
                    hist[x][1].append(R[x])
                    rec[x][0].append(d)
                    rec[x][1].append(wl[x][0])
                    rec[x][2].append(wl[x][1])
            self.R[C] = dict(hist)
            self.W[C] = dict(rec)

    def cut_for(self, D):
        C = dt.date(D.year, 1, 1)
        return C if C in self.R else (self.cuts[-1] if C > self.cuts[-1] else self.cuts[0])

    def rating(self, C, s, D):
        H = self.R[C].get(s)
        if not H:
            return 1500.0
        k = self.bisect.bisect_left(H[0], D)
        return H[1][k - 1] if k > 0 else 1500.0

    def record(self, C, s, D):
        H = self.W[C].get(s)
        if not H:
            return 0, 0
        k = self.bisect.bisect_left(H[0], D)
        return (H[1][k - 1], H[2][k - 1]) if k > 0 else (0, 0)

    def feats(self, p, me, rows, D):
        C = self.cut_for(D)
        pre = [r for r in rows if r["_d"] and r["_d"] < D]
        of = self.first_ufc.get(p)
        if of is not None and self.grad_from <= of < C:
            elo = self.rating(C, me, D)                      # own page is part of network_C
        else:
            elo = 1500.0                                     # one-sided walk over the fighter's own rows
            for r in pre:
                sc = {"W": 1.0, "L": 0.0, "D": 0.5}.get(r["res"])
                if sc is None or r["_sid"] is None:
                    continue
                ro = self.rating(C, r["_sid"], r["_d"])
                elo += self.NK * (sc - 1 / (1 + 10 ** ((ro - elo) / 400)))
        wp = []
        for r in pre:
            if r["_ufc"] or r["_sid"] is None:
                continue
            w, n = self.record(C, r["_sid"], r["_d"])
            if n >= 3:
                wp.append(w / n)
        return {"net_elo_h": round(elo, 1), "opp_wpct_h": round(sum(wp) / len(wp), 4) if wp else None,
                "opp_known_h": len(wp)}


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

    strict = StrictNetwork(rowsby, res, first_ufc, grad_from, today)
    print("strict network: %d unique fights from pages of UFC debutants since %s; cutoffs %s..%s" % (
        strict.n_fights, grad_from, strict.cuts[0], strict.cuts[-1]), flush=True)

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
        me_sid = sid(r["href"])
        for j, (d, q, on, f) in enumerate(ub):
            ft = snapshot_feats(rows, d, dob, exrows[p], net, promo_q)
            ft.update(strict.feats(p, me_sid, rows, d))
            if j == 0:
                deb = dict(ft, date=d.isoformat(), fid=f.fid)
            snaps.append([d.isoformat(), f.fid, j] + [ft[k] for k in SNAP_KEYS])
        cur = snapshot_feats(rows, today + dt.timedelta(days=1), dob, exrows[p], net, promo_q)
        cur.update(strict.feats(p, me_sid, rows, today + dt.timedelta(days=1)))
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
    roster_slugs = set(json.load(open(os.path.join(DERIVED, "fighters.json")))["fighters"])
    cover["roster"] = len(roster_slugs)
    cover["roster_resolved"] = sum(1 for sl in roster_slugs if out.get(sl, {}).get("status") == "ok")
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
            "net_elo": "Elo over every fight in the Sherdog network (K 32, start 1500), as of the bout date. The "
                       "network is the union of every cached page, and which pages are cached depends on who "
                       "reached the UFC later: kept for reference, the models use net_elo_h",
            "net_elo_h / opp_wpct_h / opp_known_h": "strict walk-forward versions (class StrictNetwork): a bout "
                       "in year Y uses only pages of UFC debutants with first UFC bout in [graduates_from, Jan 1 Y) "
                       "(a complete set, chosen by facts known before Y) plus the fighter's own rows (one-sided "
                       "Elo walk when his page is not in that network); opponents' win share uses their record "
                       "before the fight date in the same network (>= 3 known fights)",
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
        "network": {"fights": len(net_fights), "nodes": len(R), "strict_fights": strict.n_fights,
                    "strict_cutoffs": [c.isoformat() for c in strict.cuts]},
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


class ClusterBoot:
    """Bootstrap that resamples whole clusters (here: fight dates, i.e. cards) with replacement."""

    def __init__(self, groups, B=2000, seed=0):
        import numpy as np
        g = np.asarray([str(x) for x in groups])
        u, inv = np.unique(g, return_inverse=True)
        self.inv, self.G = inv, len(u)
        rng = np.random.default_rng(seed)
        S = rng.integers(0, self.G, size=(B, self.G))
        self.W = np.vstack([np.bincount(S[b], minlength=self.G) for b in range(B)]).astype(float)
        self.cnt = np.bincount(inv, minlength=self.G).astype(float)

    def means(self, v):
        import numpy as np
        sums = np.bincount(self.inv, weights=np.asarray(v, float), minlength=self.G)
        return (self.W @ sums) / (self.W @ self.cnt)


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

    def loss_grad(self, Zidx, Z, beta, target, until=None):
        """Mean log loss over the bouts in `target` (fid -> 1 if A won) and its exact gradient w.r.t. the seed
        coefficients beta (debut rating = 1500 + Z . beta), by forward-mode differentiation through every Elo
        update (each rating carries d rating / d beta)."""
        import numpy as np
        nk = Z.shape[1]
        R = list(self.R0)
        N = list(self.N0)
        dR = {}
        for k, z in zip(Zidx, Z):
            if self.N0[k] == 0:
                R[k] = 1500.0 + float(z @ beta)
                dR[k] = z.copy()
        zero = np.zeros(nk)
        K, bn, bo = self.K, self.boost_n, self.boost
        c = math.log(10) / 400.0
        L, G, n = 0.0, np.zeros(nk), 0
        for ia, ib, sa, fid, d in self.tail:
            if until is not None and d >= until:
                break
            ra, rb = R[ia], R[ib]
            ea = 1.0 / (1.0 + 10.0 ** ((rb - ra) / 400.0))
            ga, gb = dR.get(ia), dR.get(ib)
            dd = None if (ga is None and gb is None) else (ga if ga is not None else zero) - (gb if gb is not None else zero)
            y = target.get(fid)
            if y is not None:
                e = min(max(ea, 1e-6), 1 - 1e-6)
                L -= y * math.log(e) + (1 - y) * math.log(1 - e)
                n += 1
                if dd is not None:
                    G += (ea - y) * c * dd
            if sa is not None:
                ka = K * bo if N[ia] < bn else K
                kb = K * bo if N[ib] < bn else K
                R[ia] = ra + ka * (sa - ea)
                R[ib] = rb - kb * (sa - ea)
                if dd is not None:
                    dea = (ea * (1 - ea) * c) * dd
                    dR[ia] = (ga if ga is not None else zero) - ka * dea
                    dR[ib] = (gb if gb is not None else zero) + kb * dea
            N[ia] += 1
            N[ib] += 1
        return L / max(n, 1), G / max(n, 1)

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


def side_pre(snap, n_prior, mode="strict"):
    """Per-side pre-UFC feature vector (dict) from a preufc snapshot; None when the fighter is unresolved.
    mode "strict" (default) takes the net Elo and opponents' records from the time-honest network
    (StrictNetwork); "full" takes them from the union of every cached page (reference only)."""
    if snap is None:
        return None
    if mode == "strict" and "net_elo_h" in snap:
        snap = dict(snap, net_elo=snap["net_elo_h"], opp_wpct=snap["opp_wpct_h"])
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
# ablation sets: the fighter's own record only (no network, no promotion quality), and record + promotion
PRE_RECORD = ["pre_wpct", "pre_logn", "pre_fin", "pre_ko", "pre_sub", "pre_finl", "pre_kol", "pre_subl",
              "pre_streak", "pre_l5", "pre_yrs", "pre_agedeb", "pre_dwcs", "pre_tuf"]
PRE_RECORD_PROMO = PRE_RECORD + ["pre_feed", "pre_feedmax", "pre_grad", "pre_oppufc"]
SEED_RECORD = ["pre_wpct", "pre_logn", "pre_fin", "pre_finl", "pre_streak", "pre_dwcs", "pre_agedeb"]


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


def build_frame(fights, people, ufc, elo_pre, snaps, from_date, mode="strict"):
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
            sp = side_pre(snaps.get((people[p]["slug"], f.fid)), u["n"], mode)
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

    def __init__(self, base, pre, C=1.0, tau=None, add_missing=False, cap=None):
        self.base, self.pre, self.C, self.tau, self.add_missing = list(base), list(pre), C, tau, add_missing
        self.cap = cap          # pre-UFC block only for sides with <= cap prior UFC bouts (None: every side)

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
        if self.cap is not None:
            w = w * (df["n" + tag].to_numpy(float) <= self.cap)
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
                 subsample_freq=1, colsample_bytree=0.7, reg_lambda=5.0, verbose=-1, n_jobs=1)
        p.update(self.params)
        self.m = lgb.LGBMClassifier(**p)
        self.m.fit(X, y)
        return self

    def predict(self, df):
        p1 = self.m.predict_proba(self._X(df))[:, 1]
        p2 = self.m.predict_proba(self._X(df, swap=True))[:, 1]
        return 0.5 * (p1 + 1 - p2)


def american_p(a):
    a = float(a)
    return 100.0 / (a + 100.0) if a > 0 else -a / (-a + 100.0)


def load_market(fights, people):
    """Closing no-vig probability for A from nlbair/ufc-data (BFO closing-range midpoints; CC BY 4.0), cached
    by tools/market.py in data/raw/odds/nlbair_odds.csv. Ranges wider than 0.20 in implied probability are
    dropped (they can hold stale or in-play prices: the tools/market.py cleaning rule). Also the opening line."""
    import pandas as pd
    path = os.path.join(ROOT, "data", "raw", "odds", "nlbair_odds.csv")
    if not os.path.exists(path):
        return {}
    od = pd.read_csv(path)
    byid = {f.fid: f for f in fights}
    out = {}
    for r in od.itertuples(index=False):
        f = byid.get(r.fight_id)
        if f is None or not r.has_odds:
            continue
        try:
            lo1, hi1 = american_p(r.f1_close_low), american_p(r.f1_close_high)
            lo2, hi2 = american_p(r.f2_close_low), american_p(r.f2_close_high)
        except (TypeError, ValueError):
            continue
        if any(map(lambda x: x != x, (lo1, hi1, lo2, hi2))):
            continue
        if abs(lo1 - hi1) > 0.20 or abs(lo2 - hi2) > 0.20:
            continue
        p = r.f1_close_prob_novig
        if p != p:
            continue
        flip = name_sim(r.f1_name, f.names[0]) < name_sim(r.f1_name, f.names[1])
        po = r.f1_open_prob_novig
        out[f.fid] = {"close": 1 - p if flip else p, "open": (1 - po if flip else po) if po == po else None}
    return out


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
            # no missing-data term: before the crawl finished, being resolved tracked future success
            Zrows.append(np.concatenate([z, [0.0]]))
            Zidx.append(E.idx[p])
        Z = np.array(Zrows) if Zrows else np.zeros((0, nk + 1))
        sel = df[(df["date"] >= fit_from) & (df["date"] < fit_to) & df["newc"]]
        fids, yv = sel["fid"].tolist(), sel["y"].to_numpy()
        nfit = max(1, len(fids))

        target = dict(zip(fids, yv.tolist()))

        def obj(beta):
            L, G = E.loss_grad(Zidx, Z, beta, target, until=fit_to)
            return L + float(beta @ beta) / (2 * sigma ** 2 * nfit), G + beta / (sigma ** 2 * nfit)
        th0 = np.zeros(nk + 1)
        r = minimize(obj, th0, jac=True, method="L-BFGS-B", options={"maxiter": 5 if args.quick else 300})
        beta = r.x
        bo = None
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
    Cs = (0.1,) if args.quick else (0.001, 0.003, 0.01, 0.03, 0.1, 0.3, 1.0)
    taus = (2.0,) if args.quick else (1.0, 2.0, 4.0, 8.0, None)
    for C in Cs:
        o = cv_eval(lambda: DiffModel(BASE_KEYS, [], C=C), trainval)
        cvlog.append({"model": "base", "C": C, "cv_ll": oof_ll(o, trainval)})
    for fs_name, fs in (("core", PRE_CORE), ("all", PRE_KEYS)):
        for C in Cs[:6]:
            for tau in taus:
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
    gpar = {"n_estimators": 20} if args.quick else {}
    for fs_name, keys in (("gbm_base", BASE_KEYS), ("gbm_base+pre", BASE_KEYS + PRE_CORE)):
        o = cv_eval(lambda: GBMDiff(keys, gpar), trainval)
        best[fs_name] = {"model": fs_name, "cv_ll": oof_ll(o, trainval)}
    print("CV gbm:", {k: round(v["cv_ll"], 4) for k, v in best.items() if k.startswith("gbm")})

    # 2) seeded Elo: CV per year (fit on [train_from, Y), score newcomer bouts of year Y)
    seed_cv = {}
    seed_cache = {}
    seed_variants = (("seed_age", [], True), ("seed_pre", PRE_CORE, False), ("seed_pre+age", PRE_CORE, True))
    if args.quick:
        seed_variants = seed_variants[2:3]
    for nm, keys, use_age in seed_variants:
        ps, ys = [], []
        for Y in CV_YEARS:
            sf = fit_seed(keys, use_age, dt.date(Y, 1, 1))
            pre_, _ = seeded_pre(sf)
            seed_cache[(nm, Y)] = (sf, pre_)
            va = trainval[trainval["year"] == Y]
            ps.extend(pre_[f][2] for f in va["fid"])
            ys.extend(va["y"])
        seed_cv[nm] = ll(np.array(ps), np.array(ys))
        print("seed CV", nm, round(seed_cv[nm], 4), "%.0f s" % (time.time() - t0), flush=True)
        print("   betas by year:", {Y: [round(float(x), 1) for x in seed_cache[(nm, Y)][0]["beta"]] for Y in CV_YEARS},
              flush=True)
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
    g0 = GBMDiff(BASE_KEYS, gpar).fit(trainval)
    g1 = GBMDiff(BASE_KEYS + PRE_CORE, gpar).fit(trainval)
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
    B_ = 100 if args.quick else 2000
    cb = ClusterBoot(test["date"].tolist(), B_, 20261106)

    def boot(p):
        p = np.clip(p, 1e-6, 1 - 1e-6)
        lls = -(yt * np.log(p) + (1 - yt) * np.log(1 - p))
        br = (p - yt) ** 2
        ac = ((p > 0.5) == (yt > 0.5)).astype(float)
        out = {}
        for k, v in (("log_loss", lls), ("brier", br), ("accuracy", ac)):
            bs = cb.means(v)
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
            bs = cb.means(dlt)
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

    # ---------------- market benchmark: does the pre-UFC record add anything to the closing line?
    mk = load_market(fights, people)
    newc["p_mkt"] = newc["fid"].map(lambda f: mk.get(f, {}).get("close", np.nan))
    for t in "AB":
        newc["lmkt_" + t] = np.nan
    lm = np.log(np.clip(newc["p_mkt"], 1e-4, 1 - 1e-4) / (1 - np.clip(newc["p_mkt"], 1e-4, 1 - 1e-4)))
    newc["lmkt_A"] = lm / 2.0          # side split so that A - B = market logit
    newc["lmkt_B"] = -lm / 2.0
    has = newc["p_mkt"].notna()
    tv_m = newc[has & (newc["date"] < TEST_FROM)]
    te_m = newc[has & (newc["date"] >= TEST_FROM)]
    market = {"coverage": {"train_newcomer_bouts_with_close": int(len(tv_m)),
                           "train_newcomer_bouts": int(len(trainval)),
                           "test_newcomer_bouts_with_close": int(len(te_m)), "test_newcomer_bouts": int(len(test))}}
    mbest = {}
    for nm, fsx in (("mkt_cal", []), ("mkt+pre_core", PRE_CORE), ("mkt+base", BASE_KEYS),
                    ("mkt+base+pre_core", BASE_KEYS + PRE_CORE)):
        basek = ["lmkt"] + ([k for k in fsx if k in BASE_KEYS])
        prek = [k for k in fsx if k not in BASE_KEYS]
        for C in Cs:
            for tau in (taus if prek else (None,)):
                o = cv_eval(lambda: DiffModel(basek, prek, C=C, tau=tau), tv_m)
                v = oof_ll(o, tv_m)
                if nm not in mbest or v < mbest[nm]["cv_ll"]:
                    mbest[nm] = {"C": C, "tau": tau, "cv_ll": v, "base": basek, "pre": prek}
    ytm = te_m["y"].to_numpy()
    mp = {"market_close": te_m["p_mkt"].to_numpy()}
    for nm, b in mbest.items():
        mp[nm] = DiffModel(b["base"], b["pre"], C=b["C"], tau=b["tau"]).fit(tv_m).predict(te_m)
    mp["base+pre (no market)"] = m_bp.predict(te_m)
    mp["base (no market)"] = m_base.predict(te_m)
    cbm = ClusterBoot(te_m["date"].tolist(), B_, 11)
    lmk = {}
    for nm, p in mp.items():
        p = np.clip(p, 1e-6, 1 - 1e-6)
        lmk[nm] = -(ytm * np.log(p) + (1 - ytm) * np.log(1 - p))
    market["test"] = {}
    for nm, v in lmk.items():
        bs = cbm.means(v)
        market["test"][nm] = {"log_loss": round(float(v.mean()), 4),
                              "ci95": [round(float(np.percentile(bs, 2.5)), 4), round(float(np.percentile(bs, 97.5)), 4)],
                              "accuracy": round(float(np.mean((mp[nm] > 0.5) == (ytm > 0.5))), 4)}
    for nm in mp:
        if nm == "market_close":
            continue
        dlt = lmk[nm] - lmk["market_close"]
        bs = cbm.means(dlt)
        market["test"][nm]["delta_vs_market [mean, lo, hi, P(<0)]"] = [
            round(float(dlt.mean()), 4), round(float(np.percentile(bs, 2.5)), 4),
            round(float(np.percentile(bs, 97.5)), 4), round(float((bs < 0).mean()), 3)]
    dlt = lmk["mkt+pre_core"] - lmk["mkt_cal"]
    bs = cbm.means(dlt)
    market["test"]["delta mkt+pre_core - mkt_cal"] = [round(float(dlt.mean()), 4),
                                                       round(float(np.percentile(bs, 2.5)), 4),
                                                       round(float(np.percentile(bs, 97.5)), 4),
                                                       round(float((bs < 0).mean()), 3)]
    market["cv"] = {k: {kk: vv for kk, vv in v.items()} for k, v in mbest.items()}
    print("market:", json.dumps(market["test"], default=str), flush=True)

    # ---------------- method (how): KO / SUB / DEC for newcomer bouts
    meth = method_eval(df_all, train_from)
    side_fin = side_finish_eval(df_all, args)

    # ---------------- audit: leakage sensitivity and ablations (hyperparameters by CV on 2015-2023 only)
    audit = run_audit(args, fights, people, ufc, elo_pre, snaps, train_from, df, newc, trainval, test, pick, fs,
                      best, cv_eval, oof_ll, fit_seed, seeded_pre, side_pre_deb=deb, first_fid=first_fid,
                      tested=tested, E=E, yt=yt, cb=cb, lls_by=lls_by, preds_test=preds_test, Cs=Cs, taus=taus)

    # ---------------- out-of-sample predictions for every newcomer bout 2019+ (CV years oof, 2024+ final)
    predictions = {}
    oof_bp = cv_eval(lambda: DiffModel(BASE_KEYS, fs, C=pick["C"], tau=pick["tau"]), trainval)
    oof_b = cv_eval(lambda: DiffModel(BASE_KEYS, [], C=best["base"]["C"]), trainval)
    seedY = {Y: seed_cache[("seed_pre+age", Y)][1] for Y in CV_YEARS}
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
                   "train mean when unresolved (no missing-data flag: resolution order could leak), faded by "
                   "exp(-n_UFC/tau)",
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
        "market": market,
        "side_finish": side_fin,
        "audit": audit,
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


def _boot_delta(cb, a, b):
    import numpy as np
    d = a - b
    bs = cb.means(d)
    return [round(float(d.mean()), 4), round(float(np.percentile(bs, 2.5)), 4), round(float(np.percentile(bs, 97.5)), 4),
            round(float((bs < 0).mean()), 3)]


def _lls(p, y):
    import numpy as np
    p = np.clip(np.asarray(p, float), 1e-6, 1 - 1e-6)
    return -(y * np.log(p) + (1 - y) * np.log(1 - p))


def run_audit(args, fights, people, ufc, elo_pre, snaps, train_from, df, newc, trainval, test, pick, fs, best,
              cv_eval, oof_ll, fit_seed, seeded_pre, side_pre_deb, first_fid, tested, E, yt, cb, lls_by, preds_test,
              Cs, taus):
    """Checks on the main result, each scored once on 2024+ with settings chosen by CV inside 2015-2023:
    1. full-network reference (net Elo / opponents' records from every cached page: who-reached-the-UFC-later
       leaks into the network) against the strict network the models use;
    2. ablations: own record only, record + promotion quality, pre-UFC block on newcomer sides only;
    3. seeded Elo from the own record only;
    4. stacking on tools/ml.py's out-of-fold ML and stack probabilities (backtest bouts with a 1-3 fight side)."""
    import numpy as np
    import pandas as pd
    out = {"note": "the strict network (StrictNetwork) is the default; the earlier run of this tool scored 2024+ "
                   "with the full network, so these 2024+ numbers are a second look at the held-out years"}
    t0 = time.time()
    # 1. full network reference with the chosen settings
    df_full_all = build_frame(fights, people, ufc, elo_pre, snaps, train_from, mode="full")
    df_full = df_full_all[df_full_all["decisive"]]
    nf = df_full[df_full["newc"]]
    tv_f, te_f = nf[nf["date"] < TEST_FROM], nf[nf["date"] >= TEST_FROM]
    assert list(te_f["fid"]) == list(test["fid"])
    p_full = DiffModel(BASE_KEYS, fs, C=pick["C"], tau=pick["tau"]).fit(tv_f).predict(te_f)
    sens = {"base+pre strict (main)": round(float(lls_by["base+pre"].mean()), 4),
            "base+pre full network": round(float(_lls(p_full, yt).mean()), 4),
            "full - strict": _boot_delta(cb, _lls(p_full, yt), lls_by["base+pre"])}
    out["full_network_reference"] = sens
    # 2. ablations, CV-chosen on trainval
    abl = {}
    grid_C = [c for c in Cs if c in (0.003, 0.01, 0.03, 0.1)] or list(Cs)
    grid_t = [t for t in taus if t in (2.0, 4.0, 8.0, None)] or list(taus)
    variants = [("base+pre_record", PRE_RECORD, None), ("base+pre_record+promo", PRE_RECORD_PROMO, None),
                ("base+pre newcomer sides only", fs, 3)]
    for nm, keys, cap in variants:
        bestv = None
        for C in grid_C:
            for tau in grid_t:
                o = cv_eval(lambda: DiffModel(BASE_KEYS, keys, C=C, tau=tau, cap=cap), trainval)
                v = oof_ll(o, trainval)
                if bestv is None or v < bestv[0]:
                    bestv = (v, C, tau)
        p = DiffModel(BASE_KEYS, keys, C=bestv[1], tau=bestv[2], cap=cap).fit(trainval).predict(test)
        l = _lls(p, yt)
        abl[nm] = {"cv_ll": round(bestv[0], 4), "C": bestv[1], "tau": bestv[2], "test_ll": round(float(l.mean()), 4),
                   "minus base": _boot_delta(cb, l, lls_by["base"]),
                   "minus base+pre (main)": _boot_delta(cb, l, lls_by["base+pre"])}
        print("audit", nm, abl[nm], "%.0f s" % (time.time() - t0), flush=True)
    out["ablations"] = abl
    # 3. seeded Elo from the own record only (+ age)
    sf = fit_seed(SEED_RECORD, True, TEST_FROM)
    pre_, _ = seeded_pre(sf)
    p = np.array([pre_[f][2] for f in test["fid"]])
    l = _lls(p, yt)
    out["seed_record+age"] = {"keys": sf["keys"], "beta_elo_points_per_sd": [round(float(x), 2) for x in sf["beta"][:-1]],
                              "test_ll": round(float(l.mean()), 4),
                              "minus elo": _boot_delta(cb, l, lls_by["elo"]),
                              "minus seed_pre+age (main)": _boot_delta(cb, l, lls_by["elo_seed_pre+age"])}
    print("audit seed_record+age", out["seed_record+age"], flush=True)
    # 4. stacking on tools/ml.py out-of-fold predictions
    try:
        out["ml_stack"] = ml_stack_eval(newc, fs, pick, Cs, taus)
    except FileNotFoundError as e:
        out["ml_stack"] = {"error": str(e)}
    print("audit done %.0f s" % (time.time() - t0), flush=True)
    return out


def ml_stack_eval(newc, fs, pick, Cs, taus):
    """Does the pre-UFC block add to tools/ml.py? ml.json holds out-of-fold probabilities for backtest bouts
    2019-2023 (annual expanding refits) and 2024+ test probabilities from models fit on 2010-2023. Stack:
    symmetric logistic on [logit(p_ml)] + faded pre-UFC side differences; C and tau by year-ahead CV inside the
    2019-2023 out-of-fold rows (fit on earlier OOF years, score year Y, Y = 2020..2023); test 2024+ once.
    Rows: backtest bouts (both men had >= 1 prior UFC bout) where one side had 1-3 prior bouts."""
    import numpy as np
    path = os.path.join(DERIVED, "ml.json")
    M = json.load(open(path))["fights"]
    d = newc[newc["fid"].isin(M.keys())].copy()
    res = {"rows": {}}
    for src in ("ml", "stack", "elo"):
        d["p_" + src] = d["fid"].map(lambda f: M[f].get(src))
    d["set"] = d["fid"].map(lambda f: M[f]["set"])
    chk = d["fid"].map(lambda f: M[f]["y"]).to_numpy(float)
    assert np.allclose(chk, d["y"].to_numpy()), "ml.json orientation differs"
    oof = d[(d["set"] == "oof") & (d["date"] < TEST_FROM)].copy()
    te = d[(d["set"] == "test") & (d["date"] >= TEST_FROM)].copy()
    res["rows"] = {"oof_2019_2023": int(len(oof)), "test_2024plus": int(len(te))}
    yt = te["y"].to_numpy()
    cb = ClusterBoot(te["date"].tolist(), 2000, 21)
    years = [2020, 2021, 2022, 2023]
    for src in ("ml", "stack"):
        for frame in (oof, te):
            lg = np.log(np.clip(frame["p_" + src], 1e-4, 1 - 1e-4) / (1 - np.clip(frame["p_" + src], 1e-4, 1 - 1e-4)))
            frame["l" + src + "_A"] = lg / 2.0
            frame["l" + src + "_B"] = -lg / 2.0
        r = {}
        cands = {}
        for nm, prek in (("cal", []), ("+pre", fs)):
            bestv = None
            for C in Cs:
                for tau in (taus if prek else (None,)):
                    oo = []
                    for Y in years:
                        trn = oof[oof["date"] < dt.date(Y, 1, 1)]
                        va = oof[oof["year"] == Y]
                        m = DiffModel(["l" + src], prek, C=C, tau=tau).fit(trn)
                        oo.append((_lls(m.predict(va), va["y"].to_numpy()).sum(), len(va)))
                    v = sum(a for a, _ in oo) / sum(n for _, n in oo)
                    if bestv is None or v < bestv[0]:
                        bestv = (v, C, tau)
            m = DiffModel(["l" + src], prek, C=bestv[1], tau=bestv[2]).fit(oof)
            cands[nm] = m.predict(te)
            r[nm] = {"cv_ll": round(bestv[0], 4), "C": bestv[1], "tau": bestv[2],
                     "test_ll": round(float(_lls(cands[nm], yt).mean()), 4)}
            if prek:
                r[nm]["coef"] = m.coefs()
        raw = _lls(te["p_" + src].to_numpy(), yt)
        r["raw_test_ll"] = round(float(raw.mean()), 4)
        r["+pre minus cal"] = _boot_delta(cb, _lls(cands["+pre"], yt), _lls(cands["cal"], yt))
        r["+pre minus raw"] = _boot_delta(cb, _lls(cands["+pre"], yt), raw)
        res[src] = r
        print("ml stack", src, {k: v for k, v in r.items() if k != "coef"}, flush=True)
    return res


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
    cbx = ClusterBoot(d.loc[te, "date"].tolist(), 2000, 7)
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
        bs = cbx.means(lv)
        res[nm] = {"cv_ll": round(best[0], 4), "C": best[1], "test_ll": round(float(lv.mean()), 4),
                   "ci95": [round(float(np.percentile(bs, 2.5)), 4), round(float(np.percentile(bs, 97.5)), 4)]}
        if wp:
            res[nm]["coef_pre (KO,SUB,DEC rows; last 6 = pre_ko pre_sub pre_kol pre_subl pre_fin pre_finl)"] = \
                np.round(m.coef_[:, -6:], 3).tolist()
    l0 = -np.log(np.clip(P["ufc_only"][np.arange(len(yt)), yt], 1e-9, 1))
    l1 = -np.log(np.clip(P["ufc+pre"][np.arange(len(yt)), yt], 1e-9, 1))
    dl = l1 - l0
    bs = cbx.means(dl)
    res["delta_ll (ufc+pre - ufc_only)"] = [round(float(dl.mean()), 4), round(float(np.percentile(bs, 2.5)), 4),
                                            round(float(np.percentile(bs, 97.5)), 4), round(float((bs < 0).mean()), 3)]
    # finish vs decision (binary) calibration of the + pre model
    pf = P["ufc+pre"][:, 0] + P["ufc+pre"][:, 1]
    yf = (yt < 2).astype(float)
    res["finish_binary"] = {"ufc_only_ll": round(ll(P["ufc_only"][:, 0] + P["ufc_only"][:, 1], yf), 4),
                            "ufc+pre_ll": round(ll(pf, yf), 4), "base_rate_ll": round(ll(np.full(len(yf), base_rate[:2].sum()), yf), 4)}
    print("method:", json.dumps({k: v for k, v in res.items() if not k.startswith("coef")}, default=str))
    return res


def side_finish_eval(df_all, args):
    """Per-side finish models for newcomer sides (0-3 prior UFC bouts): P(win by KO), P(win by SUB),
    P(lose by KO) per bout, with and without the pre-UFC record. Engine use: power / sub-threat / chin
    multipliers for newcomers. Train [train_from, 2024), CV years for C, test 2024+ once."""
    import numpy as np
    import pandas as pd
    from sklearn.linear_model import LogisticRegression
    d = df_all[df_all["winner"].isin(["A", "B"])].copy()
    rows = []
    for t, o in (("A", "B"), ("B", "A")):
        sub = d[d["n" + t] <= 3]
        won = sub["winner"] == t
        r = pd.DataFrame({
            "date": sub["date"], "year": sub["year"], "division": sub["division"], "rounds": sub["rounds"],
            "n": sub["n" + t], "res": sub["res_" + t],
            "ko_win": (won & sub["cat"].eq("ko")).astype(int), "sub_win": (won & sub["cat"].eq("sub")).astype(int),
            "ko_loss": (~won & sub["cat"].eq("ko")).astype(int),
            "uko": sub["uko_" + t], "usub": sub["usub_" + t], "ukol": sub["ukol_" + t], "usubl": sub["usubl_" + t],
            "o_uko": sub["uko_" + o], "o_usub": sub["usub_" + o], "o_ukol": sub["ukol_" + o],
            "o_usubl": sub["usubl_" + o], "o_n": sub["n" + o],
            "pre_ko": sub["pre_ko_" + t], "pre_sub": sub["pre_sub_" + t], "pre_kol": sub["pre_kol_" + t],
            "pre_subl": sub["pre_subl_" + t], "pre_logn": sub["pre_logn_" + t],
            "o_pre_ko": sub["pre_ko_" + o], "o_pre_sub": sub["pre_sub_" + o], "o_pre_kol": sub["pre_kol_" + o],
            "o_pre_subl": sub["pre_subl_" + o]})
        rows.append(r)
    S = pd.concat(rows, ignore_index=True)
    divs = sorted(S["division"].unique())
    tr = (S["date"] < TEST_FROM).to_numpy()
    te = ~tr
    pre_cols = {"ko_win": ["pre_ko", "o_pre_kol"], "sub_win": ["pre_sub", "o_pre_subl"],
                "ko_loss": ["pre_kol", "o_pre_ko"]}
    ufc_cols = {"ko_win": ["uko", "o_ukol"], "sub_win": ["usub", "o_usubl"], "ko_loss": ["ukol", "o_uko"]}
    mu = {c: float(np.nanmean(S.loc[tr, c])) for c in ["pre_ko", "pre_sub", "pre_kol", "pre_subl",
                                                       "o_pre_ko", "o_pre_sub", "o_pre_kol", "o_pre_subl"]}

    def X(dd, target, with_pre):
        cols = [(dd["division"] == dv).astype(float).to_numpy() for dv in divs]
        cols.append((dd["rounds"] == 5).astype(float).to_numpy())
        for c in ufc_cols[target]:
            cols.append(np.log(dd[c].to_numpy(float)))
        if with_pre:
            for c in pre_cols[target]:
                v = dd[c].to_numpy(float)
                v = np.where(np.isnan(v), mu[c], v)
                cols.append(np.log(v / mu[c]) * np.exp(-(dd["o_n" if c.startswith("o_") else "n"].to_numpy(float)) / 2.0))
        return np.vstack(cols).T

    out = {"n_train_sides": int(tr.sum()), "n_test_sides": int(te.sum()),
           "sides_resolved_test": int(S.loc[te, "res"].sum())}
    cbs = ClusterBoot(S.loc[te, "date"].tolist(), 2000 if not args.quick else 100, 5)
    for target in ("ko_win", "sub_win", "ko_loss"):
        y = S[target].to_numpy()
        res = {"train_rate": round(float(y[tr].mean()), 4), "test_rate": round(float(y[te].mean()), 4)}
        P = {}
        for nm, wp in (("ufc_only", False), ("ufc+pre", True)):
            best = None
            for C in (0.1, 0.3, 1.0, 3.0):
                lls = []
                for Y in CV_YEARS:
                    a = tr & (S["date"] < dt.date(Y, 1, 1)).to_numpy()
                    b = tr & (S["year"] == Y).to_numpy()
                    if a.sum() < 100 or b.sum() == 0:
                        continue
                    m = LogisticRegression(C=C, max_iter=3000).fit(X(S[a], target, wp), y[a])
                    lls.append((ll(m.predict_proba(X(S[b], target, wp))[:, 1], y[b]), b.sum()))
                cvl = sum(l * n for l, n in lls) / sum(n for _, n in lls)
                if best is None or cvl < best[0]:
                    best = (cvl, C)
            m = LogisticRegression(C=best[1], max_iter=3000).fit(X(S[tr], target, wp), y[tr])
            P[nm] = m.predict_proba(X(S[te], target, wp))[:, 1]
            res[nm] = {"cv_ll": round(best[0], 5), "C": best[1], "test_ll": round(ll(P[nm], y[te]), 5)}
            if wp:
                k = len(pre_cols[target])
                res[nm]["coef_log_ratio (own, opponent), at n=0"] = [round(float(c), 3) for c in m.coef_[0][-k:]]
        lv0 = -(y[te] * np.log(P["ufc_only"]) + (1 - y[te]) * np.log(1 - P["ufc_only"]))
        lv1 = -(y[te] * np.log(P["ufc+pre"]) + (1 - y[te]) * np.log(1 - P["ufc+pre"]))
        dl = lv1 - lv0
        bs = cbs.means(dl)
        res["delta_ll [mean, lo, hi, P(<0)]"] = [round(float(dl.mean()), 5), round(float(np.percentile(bs, 2.5)), 5),
                                                 round(float(np.percentile(bs, 97.5)), 5), round(float((bs < 0).mean()), 3)]
        # calibration of the pre-UFC signal: test-side rate by tercile of the own pre-UFC rate (resolved sides)
        c0 = pre_cols[target][0]
        sel = te & S["res"].eq(1).to_numpy()
        if sel.sum() > 30:
            v = S.loc[sel, c0].to_numpy(float)
            qs = np.quantile(v, [1 / 3, 2 / 3])
            grp = np.digitize(v, qs)
            res["test_rate_by_pre_tercile"] = [
                {"tercile": int(g) + 1, "n": int((grp == g).sum()), "pre_rate_mean": round(float(v[grp == g].mean()), 3),
                 "ufc_rate": round(float(y[sel][grp == g].mean()), 4),
                 "pred_ufc_only": round(float(P["ufc_only"][S.loc[te, "res"].eq(1).to_numpy()][grp == g].mean()), 4),
                 "pred_ufc+pre": round(float(P["ufc+pre"][S.loc[te, "res"].eq(1).to_numpy()][grp == g].mean()), 4)}
                for g in range(3)]
        out[target] = res
    out["mu_pre"] = {k: round(v, 4) for k, v in mu.items()}
    print("side finish:", json.dumps({k: (v if not isinstance(v, dict) else
                                          {kk: vv for kk, vv in v.items() if kk != "test_rate_by_pre_tercile"})
                                      for k, v in out.items()}, default=str), flush=True)
    return out


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



# ------------------------------------------------------------------ report: markdown tables from preufc.json
def report(args):
    path = os.path.join(DERIVED, "preufc.json")
    J = json.load(open(path))
    m, ev = J["meta"], J.get("eval", {})
    out = []
    P = out.append

    def f4(x):
        return "%.4f" % x if isinstance(x, (int, float)) else str(x)

    def ci(v):
        return "%.4f [%.4f, %.4f]" % (v[0], v[1], v[2])
    cov = m["coverage"]
    P("### Coverage (Sherdog resolution)\n")
    P("| Item | Count |\n|---|---|")
    P("| Targets (roster + every fighter with 0-3 prior UFC bouts in a bout since %s) | %d |" %
      (m["graduates_from"], cov["targets"]))
    P("| Resolved to a verified Sherdog page | %d (%.1f%%) |" % (cov["resolved"], 100 * cov["resolved"] / cov["targets"]))
    P("| Unresolved | %d |" % cov.get("unresolved", 0))
    P("| ufcstats bouts of resolved fighters found in their Sherdog pro history | %d of %d (%.2f%%) |" %
      (cov["ufc_bouts_matched"], cov["ufc_bouts"], 100 * cov["ufc_bouts_matched"] / cov["ufc_bouts"]))
    P("| Date of birth on both sources / within 1 day | %d / %d (%.1f%%) |" %
      (cov["dob_both"], cov["dob_agree"], 100 * cov["dob_agree"] / max(1, cov["dob_both"])))
    if "roster" in cov:
        P("| Roster fighters (fighters.json) resolved | %d of %d |" % (cov["roster_resolved"], cov["roster"]))
    P("")
    if ev:
        c = ev["coverage"]
        P("| Eval split | Newcomer bouts | Newcomer sides | with Sherdog record | Debut sides | with Sherdog record |")
        P("|---|---|---|---|---|---|")
        for k in ("train", "test"):
            x = c[k]
            P("| %s | %d | %d | %d (%.1f%%) | %d | %d (%.1f%%) |" % (
                k, x["fights"], x["newcomer_sides"], x["newcomer_sides_with_sherdog"],
                100 * x["newcomer_sides_with_sherdog"] / max(1, x["newcomer_sides"]), x["debut_sides"],
                x["debut_sides_with_sherdog"], 100 * x["debut_sides_with_sherdog"] / max(1, x["debut_sides"])))
        P("")
        T = ev["test"]
        P("### Winner, 2024+ newcomer bouts (held out, scored once)\n")
        P("| Model | Log loss [95%% CI] | Brier | Accuracy | ECE |")
        P("|---|---|---|---|---|")
        for k, v in T["metrics_ci95"].items():
            P("| %s | %s | %.4f | %.3f | %.4f |" % (k, ci(v["log_loss"]), v["brier"][0], v["accuracy"][0],
                                                 T["calibration"][k]["ece"]))
        P("\n### Paired log-loss differences (negative = better), event-cluster bootstrap\n")
        P("| Comparison | Mean | 95% CI | P(better) |\n|---|---|---|---|")
        for k, v in T["delta_log_loss_ci95 [mean, lo, hi, P(<0)]"].items():
            if k.endswith(" - elo") or k.endswith(" - base"):
                P("| %s | %+.4f | [%+.4f, %+.4f] | %.2f |" % (k, v[0], v[1], v[2], v[3]))
        P("\n### Subgroups (test log loss)\n")
        keys = list(T["metrics_ci95"].keys())
        P("| Group | n | " + " | ".join(keys) + " |")
        P("|---|---|" + "---|" * len(keys))
        for g, v in T["subgroups_log_loss"].items():
            P("| %s | %d | " % (g, v["n"]) + " | ".join(f4(v[k]) for k in keys) + " |")
        P("\n### All 2024+ decisive bouts (does seeding hurt anyone?)\n")
        A = T["all_2024plus_bouts"]
        P("| Set | Model | n | Log loss | Brier | Accuracy |\n|---|---|---|---|---|---|")
        for k, v in A.items():
            if k == "n":
                continue
            if k.startswith("backtest_rule"):
                for kk, vv in v.items():
                    if kk != "n":
                        P("| both >= 1 prior UFC bout (backtest rule) | %s | %d | %.4f | %.4f | %.3f |" %
                          (kk, vv["n"], vv["log_loss"], vv["brier"], vv["accuracy"]))
            else:
                P("| all | %s | %d | %.4f | %.4f | %.3f |" % (k, v["n"], v["log_loss"], v["brier"], v["accuracy"]))
        P("\n### Calibration (test, 10 bins): base+pre and seeded Elo\n")
        for k in ("base+pre", "elo_seed_pre+age", "elo"):
            if k in T["calibration"]:
                P("%s: " % k + ", ".join("%.1f-%.1f n=%d pred %.3f obs %.3f" % (b["lo"], b["hi"], b["n"], b["pred"], b["obs"])
                                         for b in T["calibration"][k]["bins"]))
                P("")
        M = ev["models"]
        P("\n### Seeded Elo debut coefficients (Elo points per SD; fit on train only)\n")
        for nm, sm in M["seeded_elo"].items():
            P("%s: " % nm + ", ".join("%s %+.1f" % (k, b) for k, b in zip(sm["keys"], sm["beta_elo_points_per_sd"])
                                      if k != "missing"))
            P("")
        P("\n### base+pre logistic coefficients (per SD of the side difference; C=%s, tau=%s)\n" %
          (M["base+pre"]["C"], M["base+pre"]["tau"]))
        P(", ".join("%s %+.3f" % kv for kv in M["base+pre"]["coef"].items()))
        P("\n### CV (time-ordered, 2019-2023) log loss of the chosen settings\n")
        for k, v in ev["cv"]["best"].items():
            P("- %s: %.4f %s" % (k, v["cv_ll"], {kk: vv for kk, vv in v.items() if kk in ("C", "tau")}))
        P("- seeded Elo CV: " + ", ".join("%s %.4f" % kv for kv in ev["cv"]["seeded_elo_cv_ll"].items()))
        mk = ev.get("market")
        if mk:
            P("\n### Market benchmark (newcomer bouts with a clean BFO closing line)\n")
            P("Coverage: %s\n" % mk["coverage"])
            P("| Model | Log loss [95% CI] | Accuracy | Delta vs close [95% CI] |\n|---|---|---|---|")
            for k, v in mk["test"].items():
                if not isinstance(v, dict):
                    continue
                dd = v.get("delta_vs_market [mean, lo, hi, P(<0)]")
                P("| %s | %.4f [%.4f, %.4f] | %.3f | %s |" % (k, v["log_loss"], v["ci95"][0], v["ci95"][1], v["accuracy"],
                                                         "%+.4f [%+.4f, %+.4f]" % tuple(dd[:3]) if dd else "-"))
            d2 = mk["test"]["delta mkt+pre_core - mkt_cal"]
            P("\nmkt+pre_core minus mkt_cal: %+.4f [%+.4f, %+.4f], P(better) %.2f" % tuple(d2))
        me = ev.get("method")
        if me:
            P("\n### Method (KO / SUB / DEC), newcomer bouts\n")
            P("train shares KO/SUB/DEC %s; test n %d; base-rate log loss %.4f" % (me["train_shares"], me["n_test"],
                                                                               me["test_ll_base_rate"]))
            for k in ("ufc_only", "ufc+pre"):
                P("- %s: test log loss %.4f [%.4f, %.4f] (CV %.4f, C %s)" % (k, me[k]["test_ll"], me[k]["ci95"][0],
                                                                         me[k]["ci95"][1], me[k]["cv_ll"], me[k]["C"]))
            P("- delta (ufc+pre - ufc_only): %+.4f [%+.4f, %+.4f], P(better) %.2f" % tuple(me["delta_ll (ufc+pre - ufc_only)"]))
            P("- finish vs decision log loss: %s" % me["finish_binary"])
        sf = ev.get("side_finish")
        if sf:
            P("\n### Per-side finish models, newcomer sides\n")
            P("| Target | train rate | test rate | UFC-only test LL | + pre-UFC test LL | Delta [95% CI] | P(better) | pre coef (own, opp) |")
            P("|---|---|---|---|---|---|---|---|")
            for t in ("ko_win", "sub_win", "ko_loss"):
                x = sf[t]
                d_ = x["delta_ll [mean, lo, hi, P(<0)]"]
                P("| %s | %.3f | %.3f | %.5f | %.5f | %+.5f [%+.5f, %+.5f] | %.2f | %s |" % (
                    t, x["train_rate"], x["test_rate"], x["ufc_only"]["test_ll"], x["ufc+pre"]["test_ll"], d_[0], d_[1],
                    d_[2], d_[3], x["ufc+pre"].get("coef_log_ratio (own, opponent), at n=0")))
            for t in ("ko_win", "sub_win", "ko_loss"):
                if "test_rate_by_pre_tercile" in sf[t]:
                    P("\n%s by tercile of own pre-UFC rate (test, resolved sides): " % t + "; ".join(
                        "T%d n=%d pre %.3f -> UFC %.3f (pred UFC-only %.3f, +pre %.3f)" % (
                            g["tercile"], g["n"], g["pre_rate_mean"], g["ufc_rate"], g["pred_ufc_only"], g["pred_ufc+pre"])
                        for g in sf[t]["test_rate_by_pre_tercile"]))
    P("\n### Top feeder promotions (graduates since %s)\n" % m["graduates_from"])
    P("| Promotion | UFC graduates | their first-3 UFC bouts | win rate (shrunk) |\n|---|---|---|---|")
    for k, v in list(m["promotions"].items())[:25]:
        P("| %s | %d | %d | %.3f |" % (k, v["graduates"], v["grad_bouts"], v["grad_win"]))
    print("\n".join(out))


# ------------------------------------------------------------------ main
def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("cmd", choices=["crawl", "build", "eval", "all", "report"])
    ap.add_argument("--since", default="2019-01-01", help="newcomer window start (bouts with <= 3 prior UFC fights)")
    ap.add_argument("--extra-since", default="2015-01-01",
                    help="widen the newcomer window and the train window (default 2015-01-01, the published run)")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--offline", action="store_true")
    ap.add_argument("--retry", action="store_true", help="retry unresolved targets")
    ap.add_argument("--quick", action="store_true", help="eval: small grids (debugging only)")
    args = ap.parse_args()
    if args.cmd == "crawl":
        crawl(args)
    elif args.cmd in ("build", "all"):
        build(args)
        if args.cmd == "all":
            evaluate(args)
    elif args.cmd == "eval":
        evaluate(args)
    elif args.cmd == "report":
        report(args)


if __name__ == "__main__":
    main()
