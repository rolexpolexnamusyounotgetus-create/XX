#!/usr/bin/env node
/* VAULT AUDIT 1 (auditor only): the props pool (src/ml/propspool.js, data/derived/props.json, production parameters fit 2021-2025)
   on the 2026 vault fights that have method props, next to S2 with the same winner.

     node tools/vault_audit1/props_vault.js [--vault <dir>]

   Props source. The per-book prop prices (data/raw/odds/bfo_props_full.csv) stop at 2025-12-14; the vault holds tools/market.py's
   consensus method6 / p_dec (market_vault.json, BestFightOdds pre-fight props). PropsPool accepts a de-vigged consensus
   ({ m6, gd, n_books }). Equivalence check (printed and stored): on 2024-25 fights the pool's own consensus built from the raw
   per-book prices (PP.bookFamilies + PP.consensus) is compared with market.json's method6 / p_dec for the same fights.
   Packages (same winner = W_close, the power de-vig close, as in research/model_props.md):
     S2@close         PP.compose(pA = close, S2's method | winner, S2's round shapes)   (S2 = ml2_vault cells, fit < 2024)
     props_pool@close pool.predict({ pA: close, model: S2 cells, props: consensus, params: "production" })
   Output: <vault>/audit1/props_vault.json {fights: {id: {cells: {"S2@close": [...], "props_pool@close": [...]}}}, meta: check}. */
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");
const args = process.argv.slice(2);
const vi = args.indexOf("--vault");
const VAULT = vi >= 0 ? args[vi + 1] : "/tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/scratchpad/vault";
const AUD = path.join(VAULT, "audit1");
const J = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const PP = require(path.join(ROOT, "src/ml/propspool.js"));
const PJ = J(path.join(ROOT, "data/derived/props.json"));
const pool = PP.create(PJ.model);
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z]/g, "");
// ---------------- equivalence check on 2024-25 (raw per-book consensus vs market.json method6 / p_dec)
const MKD = J(path.join(ROOT, "data/derived/market.json")).fights;
const BTD = J(path.join(ROOT, "data/derived/backtest_dev.json")).fights.filter((f) => f.date >= "2024-01-01" && f.date < "2026-01-01");
const csv = fs.readFileSync(path.join(ROOT, "data/raw/odds/bfo_props_full.csv"), "utf8").trim().split("\n");
const hdr = csv[0].split(",");
const byMu = new Map();
for (const line of csv.slice(1)) {
  const c = line.split(","), r = {};
  hdr.forEach((h, i) => { r[h] = c[i]; });
  for (const k of hdr) if (!["mu", "date", "event", "book", "t1", "t2"].includes(k)) r[k] = r[k] === "" || r[k] == null ? null : +r[k];
  if (!byMu.has(r.mu)) byMu.set(r.mu, []);
  byMu.get(r.mu).push(r);
}
const dm6 = [], dgd = [];
for (const f of BTD) {
  const m = MKD[f.id];
  if (!m || !m.method6 || !m.bfo) continue;
  const rows = byMu.get(String(m.bfo.matchup));
  if (!rows || !rows.length) continue;
  const a = norm(f.A.name), t1 = norm(rows[0].t1), t2 = norm(rows[0].t2);
  const sw = a === t1 ? false : (a === t2 ? true : null);
  if (sw === null) continue;
  const K = f.rounds === 5 ? 5 : 3, fams = {};
  for (const r of rows) fams[r.book] = PP.bookFamilies(r, K, sw, PJ.model.over_max);
  const cons = PP.consensus(fams, PJ.model.outlier_max_dev);
  if (cons.m6) dm6.push(Math.max(...cons.m6.map((v, i) => Math.abs(v - m.method6[i]))));
  if (typeof cons.gd === "number" && typeof m.p_dec === "number") dgd.push(Math.abs(cons.gd - m.p_dec));
}
const q = (v, p) => { const s = v.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const check = { n_m6: dm6.length, m6_max_abs_median: q(dm6, 0.5), m6_max_abs_p90: q(dm6, 0.9), m6_max_abs_max: Math.max(...dm6),
  n_gd: dgd.length, gd_abs_median: q(dgd, 0.5), gd_abs_p90: q(dgd, 0.9), gd_abs_max: Math.max(...dgd) };
console.log("equivalence (2024-25, raw per-book consensus vs market.json): " + JSON.stringify(check));
// ---------------- vault
const BT = J(path.join(VAULT, "backtest_vault.json")).fights;
const MK = J(path.join(VAULT, "market_vault.json")).fights;
const ML2 = J(path.join(AUD, "ml2_vault.json")).fights;
function toModel(c, R) { return { A: { ko: c.slice(0, R), sub: c.slice(R, 2 * R), dec: c[4 * R] }, B: { ko: c.slice(2 * R, 3 * R), sub: c.slice(3 * R, 4 * R), dec: c[4 * R + 1] }, draw: c[4 * R + 2] }; }
function compact(c23, R) { return [].concat(c23.slice(0, R), c23.slice(5, 5 + R), c23.slice(10, 10 + R), c23.slice(15, 15 + R), [c23[20], c23[21], c23[22]]).map((v) => +v.toFixed(7)); }
const out = {};
let nProps = 0, nNo = 0;
for (const f of BT) {
  const m = MK[f.id] || {}, s2 = ((ML2[f.id] || {}).cells || {})["S2"];
  const pA = typeof m.p_power_close === "number" ? m.p_power_close : null;
  if (!s2 || pA === null) continue;
  const R = f.rounds === 5 ? 5 : 3, mdl = toModel(s2, R);
  const fc = PP.fromCells(mdl);
  const base = PP.compose(pA, fc.M, fc.R, R, PJ.model.draw_c);
  const e = { cells: { "S2@close": compact(base, R) } };
  if (Array.isArray(m.method6) && m.method6.length === 6) {
    const props = { m6: m.method6, n_books: { m6: m.method_books || 1 } };
    // gd (goes-the-distance) is not used by the CV-chosen spec (round and decision terms were rejected), so it is not passed
    const r = pool.predict({ pA, rounds: R, model: mdl, props, params: "production" });
    e.cells["props_pool@close"] = compact(r.cells, R);
    e.source = r.source;
    nProps++;
  } else nNo++;
  out[f.id] = e;
}
fs.writeFileSync(path.join(AUD, "props_vault.json"), JSON.stringify({ meta: { tool: "tools/vault_audit1/props_vault.js", check, n_with_props: nProps,
  n_without_props: nNo, params: "production (props.json model.params_production)", built: new Date().toISOString() }, fights: out }));
console.log("props_vault: " + nProps + " vault fights with method props, " + nNo + " without");
