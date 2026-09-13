"use strict";

/* resin-totals.js is the application's Resin Totals arithmetic, moved out of
 * app.js's renderResinCalculator so that the floor UI and the Station
 * Operator Handbook run one function. These tests hold it to the code it
 * replaced - a verbatim transcription of that loop is the oracle here - and
 * pin that app.js now calls the module rather than keeping a copy.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const totals = require("./resin-totals.js");
const app = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");

/* ----------------------------------------------------------------------
 *   The oracle: the application's loop as it stood before the move
 * -------------------------------------------------------------------- */

// app.js, renderResinCalculator, before resin-totals.js existed - copied,
// not paraphrased, with the helpers it closed over.
function legacyClampNum(x){
  if (x === null || x === undefined) return 0;
  const s = String(x).trim();
  if (s === "") return 0;
  const cleaned = s.replace(/,/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}
function legacyNormName(s){ return String(s || "").trim().replace(/\\s+/g, " "); }
function legacyKeyName(s){ return legacyNormName(s).toUpperCase(); }
function legacyFmtLb(n){ return Number.isFinite(n) ? String(Math.floor(n)) : "—"; }

function legacyResinTotals(state){
  const prod = legacyClampNum(state.prodResinLb);
  const scrap = legacyClampNum(state.scrapResinLb);
  const total = prod + scrap;
  const div = 100;
  const buckets = new Map();
  state.layers.forEach((L)=>{
    const layerFrac = legacyClampNum(L.layerPct) / div;
    L.hoppers.forEach((h)=>{
      const name = legacyNormName(h.resinName);
      if (!name) return;
      const hopperFrac = legacyClampNum(h.pct) / div;
      if (hopperFrac <= 0) return;
      const lbs = total * layerFrac * hopperFrac;
      if (!Number.isFinite(lbs) || lbs <= 0) return;
      const k = legacyKeyName(name);
      if (!buckets.has(k)) buckets.set(k, { displayName: name, lbs: 0 });
      buckets.get(k).lbs += lbs;
    });
  });
  const rows = Array.from(buckets.values()).sort((a,b)=>b.lbs - a.lbs);
  return {
    prod, scrap, total,
    rows: rows.map(r => ({ displayName: r.displayName, lbs: r.lbs, lot: state.resinLots?.[legacyKeyName(r.displayName)] || "" }))
  };
}

/* ----------------------------------------------------------------------
 *   Fixtures
 * -------------------------------------------------------------------- */

/* A realistic three-layer job: the same resin in several hoppers and
 * layers (MS1201 in A, B and C; CCWhite04 in A and C, once spelled in
 * lower case), seven distinct codes, a blank hopper, a zero-percent
 * hopper with a name, and one scanned lot. */
function threeLayerJob(overrides) {
  return Object.assign({
    prodResinLb: 10926,
    scrapResinLb: 0,
    resinLots: { "A0450": "LOT-77A" },
    layers: [
      { name: "A", layerPct: 25, hoppers: [
        { pct: 70, resinName: "MS1201" }, { pct: 20, resinName: "CCWhite04" }, { pct: 10, resinName: "A0450" },
        { pct: 0, resinName: "SLIP-9" }, { pct: 0, resinName: "" }, { pct: 0, resinName: "" }
      ] },
      { name: "B", layerPct: 50, hoppers: [
        { pct: 60, resinName: "MS1201" }, { pct: 25, resinName: "MS0120" }, { pct: 10, resinName: "LL3003" },
        { pct: 5, resinName: "AB1000" }, { pct: 0, resinName: "" }, { pct: 0, resinName: "" }
      ] },
      { name: "C", layerPct: 25, hoppers: [
        { pct: 55, resinName: "MS1201" }, { pct: 30, resinName: " ccwhite04 " }, { pct: 10, resinName: "A0450" },
        { pct: 5, resinName: "PP4170" }, { pct: 0, resinName: "" }, { pct: 0, resinName: "" }
      ] }
    ]
  }, overrides);
}

function sameAsLegacy(state) {
  const expected = legacyResinTotals(state);
  const actual = totals.compute({ prodResinLb: state.prodResinLb, scrapResinLb: state.scrapResinLb, layers: state.layers, lots: state.resinLots });
  assert.equal(actual.prod, expected.prod);
  assert.equal(actual.scrap, expected.scrap);
  assert.equal(actual.total, expected.total);
  assert.deepEqual(
    actual.rows.map(r => ({ displayName: r.displayName, lbs: r.lbs, lot: r.lot })),
    expected.rows,
    "rows, order, pounds and lots match the application's own loop"
  );
  // ...and what each row would be printed as, whole pounds, truncated.
  assert.deepEqual(actual.rows.map(r => String(totals.wholePounds(r.lbs))), expected.rows.map(r => legacyFmtLb(r.lbs)));
  assert.equal(String(totals.wholePounds(actual.total)), legacyFmtLb(expected.total));
  return actual;
}

/* ----------------------------------------------------------------------
 *   Parity with the application
 * -------------------------------------------------------------------- */

test("a multi-layer, multi-material job with zero scrap totals exactly as the application's loop did", () => {
  const result = sameAsLegacy(threeLayerJob());
  assert.equal(result.total, 10926);
  assert.equal(result.rows.length, 7, "seven distinct codes; SLIP-9 at 0% and blanks are not materials");
  assert.equal(result.rows[0].displayName, "MS1201", "the resin used in three layers leads");
  // MS1201: 10926 * (0.25*0.70 + 0.50*0.60 + 0.25*0.55) = 10926 * 0.6125
  assert.ok(Math.abs(result.rows[0].lbs - 10926 * 0.6125) < 1e-9);
  // Every pound is accounted for when the recipe sums to 100 everywhere.
  const sum = result.rows.reduce((acc, row) => acc + row.lbs, 0);
  assert.ok(Math.abs(sum - 10926) < 1e-9);
});

test("the same resin spelled in different case and spacing is one material under the first-seen spelling", () => {
  const result = sameAsLegacy(threeLayerJob());
  const white = result.rows.find(row => row.key === "CCWHITE04");
  assert.ok(white);
  assert.equal(white.displayName, "CCWhite04", "the first spelling met is the one shown");
  assert.ok(Math.abs(white.lbs - 10926 * (0.25 * 0.20 + 0.25 * 0.30)) < 1e-9, "both hoppers' pounds are in the one row");
  assert.equal(result.rows.filter(row => /ccwhite04/i.test(row.displayName)).length, 1);
});

test("nonzero scrap adds to the total and is split the same way", () => {
  const result = sameAsLegacy(threeLayerJob({ scrapResinLb: 1200 }));
  assert.equal(result.prod, 10926);
  assert.equal(result.scrap, 1200);
  assert.equal(result.total, 12126);
  assert.ok(Math.abs(result.rows[0].lbs - 12126 * 0.6125) < 1e-9);
});

test("pounds entered as strings, with thousands separators, read as the application reads them", () => {
  const result = sameAsLegacy(threeLayerJob({ prodResinLb: "10,926", scrapResinLb: " 1,200 " }));
  assert.equal(result.total, 12126);
  assert.equal(sameAsLegacy(threeLayerJob({ prodResinLb: "abc", scrapResinLb: null })).total, 0);
  assert.equal(sameAsLegacy(threeLayerJob({ prodResinLb: undefined, scrapResinLb: "" })).total, 0);
});

test("scanned lots attach by the application's own key, and a material without one carries an empty lot", () => {
  const result = sameAsLegacy(threeLayerJob({ resinLots: { "A0450": "LOT-77A", "MS1201": "H-2201-B" } }));
  assert.equal(result.rows.find(row => row.key === "MS1201").lot, "H-2201-B");
  assert.equal(result.rows.find(row => row.key === "A0450").lot, "LOT-77A");
  assert.equal(result.rows.find(row => row.key === "MS0120").lot, "");
  // No lots at all: every row's lot is the empty string, never undefined.
  for (const row of sameAsLegacy(threeLayerJob({ resinLots: {} })).rows) assert.equal(row.lot, "");
  for (const row of sameAsLegacy(threeLayerJob({ resinLots: undefined })).rows) assert.equal(row.lot, "");
  // A lot only reaches a row by key, exactly as the application looked it up.
  assert.equal(sameAsLegacy(threeLayerJob({ resinLots: { "a0450": "lower-cased key" } })).rows.find(row => row.key === "A0450").lot, "");
});

test("a total of zero yields the summary with no rows; a recipe with no names yields no rows", () => {
  const empty = sameAsLegacy(threeLayerJob({ prodResinLb: 0, scrapResinLb: 0 }));
  assert.equal(empty.total, 0);
  assert.deepEqual(empty.rows, []);
  const unnamed = sameAsLegacy({ prodResinLb: 500, scrapResinLb: 0, layers: [{ layerPct: 100, hoppers: [{ pct: 100, resinName: "" }] }] });
  assert.deepEqual(unnamed.rows, []);
  assert.equal(unnamed.total, 500);
});

test("rows sort by pounds descending, equal pounds in recipe order", () => {
  const state = {
    prodResinLb: 1000, scrapResinLb: 0,
    layers: [{ layerPct: 100, hoppers: [
      { pct: 25, resinName: "SECOND-SEEN" }, { pct: 50, resinName: "BIGGEST" }, { pct: 25, resinName: "THIRD-SEEN" }
    ] }]
  };
  const result = sameAsLegacy(state);
  assert.deepEqual(result.rows.map(row => row.displayName), ["BIGGEST", "SECOND-SEEN", "THIRD-SEEN"]);
});

test("a layer or hopper share the recipe does not use contributes nothing, exactly as before", () => {
  const state = {
    prodResinLb: 1000, scrapResinLb: 0,
    layers: [
      { layerPct: 0, hoppers: [{ pct: 100, resinName: "UNUSED-LAYER" }] },
      { layerPct: 100, hoppers: [{ pct: -5, resinName: "NEGATIVE" }, { pct: "abc", resinName: "NAN" }, { pct: 100, resinName: "REAL" }] }
    ]
  };
  const result = sameAsLegacy(state);
  assert.deepEqual(result.rows.map(row => row.displayName), ["REAL"]);
  assert.equal(result.rows[0].lbs, 1000);
});

test("wholePounds truncates as the application's fmtLb does, and says null for a non-number", () => {
  assert.equal(totals.wholePounds(534.6), 534);
  assert.equal(totals.wholePounds(534.999), 534);
  assert.equal(totals.wholePounds(0), 0);
  assert.equal(totals.wholePounds(NaN), null);
  assert.equal(totals.wholePounds(undefined), null);
  assert.equal(String(totals.wholePounds(534.6)), legacyFmtLb(534.6));
});

test("it tolerates the shapes it may be handed - missing layers, holes, frozen bridge objects - and never mutates them", () => {
  assert.deepEqual(totals.compute(null), { prod: 0, scrap: 0, total: 0, rows: [] });
  assert.deepEqual(totals.compute({}).rows, []);
  assert.deepEqual(totals.compute({ prodResinLb: 5, layers: [null, { hoppers: [null] }, { layerPct: 100 }] }).rows, []);
  const frozen = Object.freeze({
    prodResinLb: 100, scrapResinLb: 0, lots: Object.freeze({ "R": "L1" }),
    layers: Object.freeze([Object.freeze({ layerPct: 100, hoppers: Object.freeze([Object.freeze({ pct: 100, resinName: "R" })]) })])
  });
  const result = totals.compute(frozen);
  assert.deepEqual(result.rows, [{ key: "R", displayName: "R", lbs: 100, lot: "L1" }]);
  assert.ok(!Object.isFrozen(result) && !Object.isFrozen(result.rows[0]), "fresh objects come back");
});

/* ----------------------------------------------------------------------
 *   The application uses the module - there is no second copy
 * -------------------------------------------------------------------- */

test("app.js's Resin Totals calls resin-totals.js and keeps no loop of its own", () => {
  const fn = app.slice(app.indexOf("function renderResinCalculator()"), app.indexOf("document.addEventListener(\"visibilitychange\""));
  assert.match(fn, /window\.PolynResinTotals\.compute\(\{/);
  assert.match(fn, /prodResinLb: state\.prodResinLb,\s*scrapResinLb: state\.scrapResinLb,\s*layers: state\.layers,\s*lots: state\.resinLots/);
  assert.doesNotMatch(fn, /totals\.set\(|layerFrac|hopperFrac/, "the aggregation loop is gone from app.js");
  // The lot beside a row is the one the module attached, not a second lookup.
  assert.match(fn, /const lot = r\.lot \|\| "";/);
  assert.doesNotMatch(fn, /state\.resinLots\?\.\[/);
  // Production, scrap and total are still the application's own three
  // numbers, read the way they always were, ahead of the call.
  assert.match(fn, /const prod = clampNum\(state\.prodResinLb\);\s*const scrap = clampNum\(state\.scrapResinLb\);\s*const total = prod \+ scrap;/);
});

test("the module's helpers are the application's, character for character", () => {
  for (const name of ["clampNum", "normName", "keyName"]) {
    const inApp = app.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n(?=\\s*function |\\s*//)`))[0].trim();
    const inModule = fs.readFileSync(path.join(__dirname, "resin-totals.js"), "utf8")
      .match(new RegExp(`function ${name}\\([\\s\\S]*?\\n(?=\\s*function |\\s*/\\*)`))[0].trim();
    assert.equal(inModule.replace(/\s+/g, " "), inApp.replace(/\s+/g, " "), `${name} differs between app.js and resin-totals.js`);
  }
  assert.equal(totals.keyName("  ms1201 "), "MS1201");
  assert.equal(totals.normName(null), "");
});

test("index.html and the Station harness load the module before what reads it", () => {
  const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
  assert.ok(html.indexOf('src="resin-totals.js?') > -1 && html.indexOf('src="resin-totals.js?') < html.indexOf('src="app.js?'));
  const harness = fs.readFileSync(path.join(__dirname, "station", "station.html"), "utf8");
  assert.ok(harness.indexOf('src="../resin-totals.js?') > -1 && harness.indexOf('src="../resin-totals.js?') < harness.indexOf('src="station-resin-totals.js?'));
});
