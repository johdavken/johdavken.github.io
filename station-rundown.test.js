"use strict";

/* The run-down projection (station/station-rundown.js): the application's
 * own formula, applied per hopper, and the timeline geometry over it.
 * Pure throughout: every test hands in a clock and reads a value back.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const rundown = require("./station/station-rundown.js");
const lineModel = require("./station/station-line-model.js");
const source = require("./station/station-source.js");
const scheduling = require("./scheduling.js");

const { MINUTE, HOUR } = rundown;
// A fixed clock, local time, a few seconds past the minute so tick
// alignment has something to round.
const NOW = new Date(2026, 8, 12, 14, 3, 20).getTime();

function hopper(overrides) {
  return Object.assign({ track: true, pumpOff: false, effectiveWeight: 400, pct: 60, layerPct: 30, lineRate: 1200 }, overrides);
}

/* ----------------------------------------------------------------------
 *   The formula
 * -------------------------------------------------------------------- */

test("a known weight, output and percentages give the application's own runtime", () => {
  // 1200 lb/hr x 30% layer x 60% hopper = 216 lb/hr; 400 lb / 216 = 1.8519 h.
  const r = rundown.hopperRundown(hopper(), { now: NOW });
  assert.equal(r.tracked, true);
  assert.equal(r.reason, null);
  assert.equal(r.rate, 216);
  assert.ok(Math.abs(r.durationMs - (400 / 216) * HOUR) < 1);
  assert.ok(Math.abs(r.emptyAt - (NOW + (400 / 216) * HOUR)) < 1);
  assert.ok(Math.abs(r.remainingMs - r.durationMs) < 1);
  assert.equal(r.past, false);
  assert.equal(rundown.consumptionRate(1200, 30, 60), 216);
});

test("the formula is the one app.js applies in validateAndCompute - layer share included", () => {
  // Pinned at source level: the timeline restates the application's inline
  // math, so if that math moves, this fails and names it.
  const app = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
  const compute = app.slice(app.indexOf("function validateAndCompute("), app.indexOf("function refreshTimelinePresentation("));
  assert.match(compute, /const layerRate = state\.lineRate \* \(clampNum\(L\.layerPct\)\/div\);/);
  assert.match(compute, /const hopperRate = layerRate \* \(clampNum\(h\.pct\)\/div\);/);
  assert.match(compute, /minutesToEmpty = \(weight \/ hopperRate\) \* 60;/);
  assert.match(compute, /const weight = effectiveHopperWeight\(h\);/);
  // And the same numbers come out of the module's function.
  const lineRate = 850, layerPct = 40, pct = 25, weight = 300;
  const appRate = lineRate * (layerPct / 100) * (pct / 100);
  const appMinutes = (weight / appRate) * 60;
  const r = rundown.hopperRundown({ track: true, effectiveWeight: weight, pct, layerPct, lineRate }, { now: NOW });
  assert.equal(r.rate, appRate);
  assert.ok(Math.abs(r.durationMs / MINUTE - appMinutes) < 1e-9);
});

test("an untracked hopper has no estimate and says why", () => {
  const r = rundown.hopperRundown(hopper({ track: false }), { now: NOW });
  assert.equal(r.tracked, false);
  assert.equal(r.reason, "not-tracked");
  assert.equal(r.emptyAt, null);
  assert.equal(r.rate, null);
});

test("zero or missing output, zero blend, zero layer share, zero or missing weight: no estimate, the actual reason, never NaN or Infinity", () => {
  const cases = [
    [{ lineRate: 0 }, "no-output"],
    [{ lineRate: undefined }, "invalid"],
    [{ lineRate: null }, "invalid"],
    [{ layerPct: 0 }, "no-share"],
    [{ pct: 0 }, "no-blend"],
    [{ effectiveWeight: 0 }, "no-weight"],
    [{ effectiveWeight: undefined }, "invalid"],
    [{ effectiveWeight: NaN }, "invalid"],
    [{ lineRate: Infinity }, "invalid"],
    [{ pct: -5 }, "invalid"],
    [{ lineRate: "850" }, "invalid"]
  ];
  for (const [overrides, reason] of cases) {
    const r = rundown.hopperRundown(hopper(overrides), { now: NOW });
    assert.equal(r.reason, reason, `${JSON.stringify(overrides)} gave ${r.reason}`);
    assert.equal(r.emptyAt, null);
    assert.equal(r.remainingMs, null);
    assert.equal(r.durationMs, null);
    for (const value of Object.values(r)) {
      assert.ok(!(typeof value === "number" && !Number.isFinite(value)), `${JSON.stringify(overrides)} produced ${value}`);
    }
    assert.ok(rundown.reasonLabel(reason));
  }
  assert.equal(rundown.reasonLabel("no-weight"), "No weight");
  assert.equal(rundown.reasonLabel("no-output"), "No output");
  assert.equal(rundown.reasonLabel("no-blend"), "No blend");
  assert.equal(rundown.reasonLabel("whatever"), "Unknown");
});

test("a tracked hopper with no weight still reports its consumption rate, so the detail can show what it would use", () => {
  const r = rundown.hopperRundown(hopper({ effectiveWeight: 0 }), { now: NOW });
  assert.equal(r.reason, "no-weight");
  assert.equal(r.rate, 216);
});

test("pump-off keeps the estimate and carries the flag - the application's 'done', not 'not feeding'", () => {
  const on = rundown.hopperRundown(hopper(), { now: NOW });
  const off = rundown.hopperRundown(hopper({ pumpOff: true }), { now: NOW });
  assert.equal(off.pumpOff, true);
  assert.equal(off.reason, null);
  assert.equal(off.emptyAt, on.emptyAt);
  // And the application really does keep the figures on a pumped-off row:
  // it marks the row done and hides it by default, it does not zero it.
  const app = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
  assert.match(app, /const viewFlat = state\.showPumpOffTracked \? flat : flat\.filter\(x=>!x\.pumpOff\);/);
  assert.match(app, /row\.className = "resultRow" \+ \(h\.pumpOff \? " done" : ""\)/);
});

test("output, blend and weight changes move the estimate as the formula says", () => {
  const base = rundown.hopperRundown(hopper(), { now: NOW });
  const faster = rundown.hopperRundown(hopper({ lineRate: 2400 }), { now: NOW });
  assert.ok(Math.abs(faster.durationMs * 2 - base.durationMs) < 1, "doubling output halves the time");
  const richer = rundown.hopperRundown(hopper({ pct: 30 }), { now: NOW });
  assert.ok(Math.abs(richer.durationMs - base.durationMs * 2) < 1, "halving the blend doubles the time");
  const heavier = rundown.hopperRundown(hopper({ effectiveWeight: 800 }), { now: NOW });
  assert.ok(Math.abs(heavier.durationMs - base.durationMs * 2) < 1, "doubling the weight doubles the time");
});

test("the estimate is anchored at observedAt and counts down with the clock; without one it is the application's duration from now", () => {
  const observedAt = NOW - 30 * MINUTE;
  const anchored = rundown.hopperRundown(hopper({ observedAt }), { now: NOW });
  const fresh = rundown.hopperRundown(hopper(), { now: NOW });
  assert.equal(anchored.durationMs, fresh.durationMs);
  assert.ok(Math.abs((fresh.emptyAt - anchored.emptyAt) - 30 * MINUTE) < 1, "the anchor moved the empty time back by the elapsed half hour");
  assert.ok(Math.abs((fresh.remainingMs - anchored.remainingMs) - 30 * MINUTE) < 1);
  // Clock advances: the same anchor, less remaining.
  const later = rundown.hopperRundown(hopper({ observedAt }), { now: NOW + 10 * MINUTE });
  assert.equal(later.emptyAt, anchored.emptyAt, "the empty instant is fixed by the anchor");
  assert.ok(Math.abs((anchored.remainingMs - later.remainingMs) - 10 * MINUTE) < 1);
  // Past the estimate: still a timestamp, flagged.
  const past = rundown.hopperRundown(hopper({ observedAt: NOW - 3 * HOUR }), { now: NOW });
  assert.equal(past.past, true);
  assert.ok(past.remainingMs < 0);
  assert.ok(Number.isFinite(past.emptyAt));
});

test("a bad observedAt is ignored rather than trusted", () => {
  for (const observedAt of [NaN, "yesterday", null, undefined]) {
    const r = rundown.hopperRundown(hopper({ observedAt }), { now: NOW });
    assert.ok(Math.abs(r.emptyAt - (NOW + r.durationMs)) < 1);
  }
});

/* ----------------------------------------------------------------------
 *   The line
 * -------------------------------------------------------------------- */

const CONFIG = { lineNumber: 9, displayName: "Line 9", layerCount: 3, layerAPosition: "outside", hopperNamingMode: "standard" };

function snapshot(overrides) {
  const base = {
    line: Object.assign({ linked: true }, CONFIG),
    job: { lineRate: 1200, gauge: 0, changeoverTime: "", changeoverSetAt: null },
    sources: { current: {}, next: {} },
    layers: ["A", "B", "C"].map((name, i) => ({
      name, layerPct: i === 1 ? 40 : 30,
      hoppers: Array.from({ length: 6 }, (_, index) => ({
        index,
        pct: index === 0 ? 60 : index === 1 ? 30 : index === 2 ? 10 : 0,
        resinName: index < 3 ? `R-${name}${index}` : "",
        weight: index < 2 ? 400 : 0, effectiveWeight: index < 2 ? 400 : 0,
        usableHeight: 30,
        track: name === "B" && index < 3,
        pumpOff: false
      }))
    }))
  };
  return typeof overrides === "function" ? (overrides(base), base) : base;
}

function lineInputs(snap) {
  const resolved = source.resolveSource({ snapshot: snap, demoLines: null, demoId: "", mode: "auto" });
  const model = lineModel.buildLineModel(resolved.modelInput);
  return { model, hopperState: resolved.hopperState, layerState: resolved.layerState, job: resolved.job };
}

test("projectEntries lists exactly the tracked hoppers, in physical order, with identity, layer, resin and inputs", () => {
  const entries = rundown.projectEntries(lineInputs(snapshot()), { now: NOW });
  assert.deepEqual(entries.map(e => e.key), ["B:0", "B:1", "B:2"]);
  assert.deepEqual(entries.map(e => e.id), ["B1", "B2", "B3"]);
  assert.deepEqual(entries.map(e => e.reason), [null, null, "no-weight"]);
  const b1 = entries[0];
  assert.equal(b1.layer, "B");
  assert.equal(b1.role, "core");
  assert.equal(b1.resin, "R-B0");
  assert.equal(b1.weight, 400);
  assert.equal(b1.pct, 60);
  assert.equal(b1.layerPct, 40);
  assert.equal(b1.lineRate, 1200);
  assert.equal(b1.rate, 1200 * 0.4 * 0.6);
});

test("tracking on and off is membership: a hopper appears when tracked and is gone when not", () => {
  const off = rundown.projectEntries(lineInputs(snapshot(s => { s.layers[1].hoppers[0].track = false; })), { now: NOW });
  assert.deepEqual(off.map(e => e.key), ["B:1", "B:2"]);
  const on = rundown.projectEntries(lineInputs(snapshot(s => { s.layers[0].hoppers[0].track = true; })), { now: NOW });
  assert.deepEqual(on.map(e => e.key), ["A:0", "B:0", "B:1", "B:2"]);
});

test("a tracked hopper with no resin is still projected - the application computes it regardless", () => {
  const entries = rundown.projectEntries(lineInputs(snapshot(s => { s.layers[1].hoppers[0].resinName = ""; })), { now: NOW });
  assert.equal(entries[0].resin, "");
  assert.equal(entries[0].reason, null);
});

test("the observed anchors are read per slot and the missing ones default to now", () => {
  const inputs = Object.assign(lineInputs(snapshot()), { observed: { "B:0": NOW - HOUR } });
  const entries = rundown.projectEntries(inputs, { now: NOW });
  const b1 = entries[0], b2 = entries[1];
  assert.ok(Math.abs((b2.emptyAt - b2.durationMs) - NOW) < 1);
  assert.ok(Math.abs((b1.emptyAt - b1.durationMs) - (NOW - HOUR)) < 1);
});

test("projectEntries never touches its inputs and copes with no model", () => {
  const inputs = lineInputs(snapshot());
  const before = JSON.stringify(inputs);
  rundown.projectEntries(inputs, { now: NOW });
  assert.equal(JSON.stringify(inputs), before);
  assert.deepEqual(rundown.projectEntries({ model: null }), []);
  assert.deepEqual(rundown.projectEntries(null), []);
});

/* ----------------------------------------------------------------------
 *   Changeover
 * -------------------------------------------------------------------- */

test("the changeover is resolved through scheduling.js's own parser, from the job's clock time", () => {
  const job = { lineRate: 1, changeoverTime: "15:30", changeoverSetAt: NOW };
  const resolved = rundown.resolveChangeover(job, { now: NOW });
  assert.equal(resolved.at, scheduling.parseChangeoverDate("15:30", new Date(NOW)).getTime());
  assert.equal(resolved.stale, false);
  // Already passed today: tomorrow, as the application reads it.
  const rolled = rundown.resolveChangeover({ changeoverTime: "13:00", changeoverSetAt: NOW }, { now: NOW });
  assert.ok(rolled.at > NOW);
  assert.equal(new Date(rolled.at).getDate(), new Date(NOW).getDate() + 1);
  // Unset, or unparseable, is no changeover.
  assert.deepEqual(rundown.resolveChangeover({ changeoverTime: "" }, { now: NOW }), { at: null, stale: false });
  assert.deepEqual(rundown.resolveChangeover({ changeoverTime: "soon" }, { now: NOW }), { at: null, stale: false });
  assert.deepEqual(rundown.resolveChangeover(null, { now: NOW }), { at: null, stale: false });
});

test("a changeover set too long ago is flagged stale, by scheduling's own rule", () => {
  const stale = rundown.resolveChangeover({ changeoverTime: "15:30", changeoverSetAt: NOW - scheduling.CHANGEOVER_STALE_MS - 1 }, { now: NOW });
  assert.equal(stale.stale, true);
  assert.ok(Number.isFinite(stale.at));
  const fresh = rundown.resolveChangeover({ changeoverTime: "15:30", changeoverSetAt: NOW - HOUR }, { now: NOW });
  assert.equal(fresh.stale, false);
  const unknown = rundown.resolveChangeover({ changeoverTime: "15:30", changeoverSetAt: null }, { now: NOW });
  assert.equal(unknown.stale, false);
});

/* ----------------------------------------------------------------------
 *   Ticks
 * -------------------------------------------------------------------- */

test("six hours across a 1100px stage: five-minute ticks, half-hour labels, hour marks", () => {
  const { plan, marks } = rundown.ticks({ now: NOW, windowMs: 6 * HOUR, width: 1100 });
  assert.deepEqual(plan, { minor: 5, major: 30, hour: 60, label: 30 });
  // The first mark is the next five-minute boundary on the wall clock.
  assert.equal(new Date(marks[0].t).getMinutes(), 5);
  assert.equal(new Date(marks[0].t).getSeconds(), 0);
  assert.equal(marks.length, 72);
  assert.equal(marks.filter(m => m.kind === "hour").length, 6);
  assert.equal(marks.filter(m => m.kind === "major").length, 6);
  // Twelve half-hour marks lie in the window; the last (20:00) is within
  // 30px of the track's end and keeps its tick but not its label.
  assert.equal(marks.filter(m => m.label).length, 11);
  assert.equal(marks.filter(m => m.kind !== "minor").length, 12);
  for (const mark of marks) {
    assert.ok(mark.fraction > 0 && mark.fraction <= 1);
    assert.equal(mark.fraction, (mark.t - NOW) / (6 * HOUR));
  }
  const labelled = marks.filter(m => m.label);
  assert.ok(labelled.every(m => new Date(m.t).getMinutes() % 30 === 0));
});

test("twelve hours across the same width opens to ten-minute ticks and hourly labels; a wider stage gets half-hour labels back", () => {
  const narrow = rundown.ticks({ now: NOW, windowMs: 12 * HOUR, width: 1000 });
  assert.deepEqual(narrow.plan, { minor: 10, major: 30, hour: 60, label: 60 });
  assert.equal(narrow.marks.filter(m => m.label).length, 11, "twelve hour marks, the last too close to the edge for a label");
  assert.ok(narrow.marks.every(m => new Date(m.t).getMinutes() % 10 === 0));
  const wide = rundown.ticks({ now: NOW, windowMs: 12 * HOUR, width: 1800 });
  assert.deepEqual(wide.plan, { minor: 5, major: 30, hour: 60, label: 30 });
  assert.equal(wide.marks.filter(m => m.label).length, 23);
});

test("labels never crowd: their spacing stays at or above the minimum whatever the width", () => {
  for (const width of [600, 800, 1000, 1160, 1440, 1920]) {
    for (const hours of rundown.WINDOWS) {
      const { plan } = rundown.ticks({ now: NOW, windowMs: hours * HOUR, width });
      const pxPerMinute = width / (hours * 60);
      assert.ok(plan.label * pxPerMinute >= 56 || plan.label === 180, `${hours}H at ${width}px labels every ${plan.label}m`);
      assert.ok(plan.minor * pxPerMinute >= 10 || plan.minor === 30, `${hours}H at ${width}px ticks every ${plan.minor}m`);
    }
  }
});

test("a label within 30px of either edge is left off its tick, so nothing runs into the Now anchor or off the track", () => {
  // 14:03:20 -> the 14:30 mark is 26.7 minutes in: at 200px wide that is
  // 14.8px, inside the margin; at 1100px it is 81px, clear of it.
  const cramped = rundown.ticks({ now: NOW, windowMs: 6 * HOUR, width: 200 }).marks;
  const first = cramped.find(m => new Date(m.t).getMinutes() === 30 && new Date(m.t).getHours() === 14);
  assert.equal(first.label, "");
  assert.equal(first.kind, "major");
  const roomy = rundown.ticks({ now: NOW, windowMs: 6 * HOUR, width: 1100 }).marks;
  assert.notEqual(roomy.find(m => m.t === first.t).label, "");
  assert.equal(rundown.LABEL_EDGE_PX, 30);
});

test("ticks slide with the clock: a minute later, the same wall-clock marks sit further left", () => {
  const a = rundown.ticks({ now: NOW, windowMs: 6 * HOUR, width: 1100 }).marks;
  const b = rundown.ticks({ now: NOW + MINUTE, windowMs: 6 * HOUR, width: 1100 }).marks;
  assert.equal(a[0].t, b[0].t);
  assert.ok(b[0].fraction < a[0].fraction);
});

/* ----------------------------------------------------------------------
 *   Layout
 * -------------------------------------------------------------------- */

function entry(key, emptyAt, extra) {
  return Object.assign({ key, id: key.replace(":", ""), layer: key[0], role: "core", tracked: true, pumpOff: false, reason: null, rate: 10, emptyAt, remainingMs: emptyAt - NOW, past: emptyAt < NOW }, extra);
}

test("Now is zero, a marker sits at its fraction of the window in 6H and in 12H, and the changeover the same", () => {
  const entries = [entry("A:0", NOW + 2 * HOUR)];
  const six = rundown.layout({ entries, now: NOW, windowMs: 6 * HOUR, width: 1200, changeover: { at: NOW + 3 * HOUR, stale: false } });
  assert.equal(six.markers.length, 1);
  assert.ok(Math.abs(six.markers[0].fraction - 2 / 6) < 1e-9);
  assert.equal(six.markers[0].lane, 0);
  assert.equal(six.markers[0].past, false);
  assert.ok(Math.abs(six.changeover.fraction - 0.5) < 1e-9);
  assert.equal(six.changeover.inWindow, true);
  assert.equal(six.changeover.remainingMs, 3 * HOUR);
  const twelve = rundown.layout({ entries, now: NOW, windowMs: 12 * HOUR, width: 1200, changeover: { at: NOW + 3 * HOUR, stale: false } });
  assert.ok(Math.abs(twelve.markers[0].fraction - 2 / 12) < 1e-9);
  assert.ok(Math.abs(twelve.changeover.fraction - 0.25) < 1e-9);
  // Now itself is the origin.
  const atNow = rundown.layout({ entries: [entry("A:0", NOW)], now: NOW, windowMs: 6 * HOUR, width: 1200 });
  assert.equal(atNow.markers[0].fraction, 0);
});

test("a changeover past the window's edge is reported beyond it, not drawn at the edge; a stale one is flagged", () => {
  const beyond = rundown.layout({ entries: [], now: NOW, windowMs: 6 * HOUR, width: 1200, changeover: { at: NOW + 9 * HOUR, stale: false } });
  assert.equal(beyond.changeover.inWindow, false);
  assert.equal(beyond.changeover.fraction, 1);
  const stale = rundown.layout({ entries: [], now: NOW, windowMs: 6 * HOUR, width: 1200, changeover: { at: NOW + 1 * HOUR, stale: true } });
  assert.equal(stale.changeover.stale, true);
  assert.equal(rundown.layout({ entries: [], now: NOW, windowMs: 6 * HOUR, width: 1200, changeover: { at: null } }).changeover, null);
});

test("beyond-window hoppers are listed soonest first; unavailable ones stay in physical order; untracked ones never appear", () => {
  const entries = [
    entry("A:0", NOW + 8 * HOUR),
    entry("B:0", NOW + 3 * HOUR),
    entry("B:1", null, { reason: "no-weight", remainingMs: null }),
    entry("C:0", NOW + 7 * HOUR),
    entry("A:1", null, { reason: "no-output", remainingMs: null }),
    entry("C:1", NOW + HOUR, { tracked: false })
  ];
  const out = rundown.layout({ entries, now: NOW, windowMs: 6 * HOUR, width: 1200 });
  assert.deepEqual(out.markers.map(m => m.entry.key), ["B:0"]);
  assert.deepEqual(out.beyond.map(e => e.key), ["C:0", "A:0"]);
  assert.deepEqual(out.unavailable.map(e => e.key), ["B:1", "A:1"]);
  // The same hopper is in the window at twelve hours.
  const twelve = rundown.layout({ entries, now: NOW, windowMs: 12 * HOUR, width: 1200 });
  assert.deepEqual(twelve.markers.map(m => m.entry.key), ["B:0", "C:0", "A:0"]);
  assert.deepEqual(twelve.beyond, []);
});

test("a past estimate sits on the Now line, flagged, and is still a marker", () => {
  const out = rundown.layout({ entries: [entry("A:0", NOW - 20 * MINUTE)], now: NOW, windowMs: 6 * HOUR, width: 1200 });
  assert.equal(out.markers.length, 1);
  assert.equal(out.markers[0].fraction, 0);
  assert.equal(out.markers[0].past, true);
});

test("collision lanes are deterministic: near-identical times take successive lanes, the anchor never moves, and far-apart ones share lane 0", () => {
  const close = [entry("A:0", NOW + HOUR), entry("B:0", NOW + HOUR + MINUTE), entry("C:0", NOW + HOUR + 2 * MINUTE)];
  const out = rundown.layout({ entries: close, now: NOW, windowMs: 6 * HOUR, width: 1200 });
  assert.deepEqual(out.markers.map(m => [m.entry.key, m.lane, m.crowded]), [["A:0", 0, false], ["B:0", 1, false], ["C:0", 2, false]]);
  for (const m of out.markers) assert.equal(m.fraction, (m.entry.emptyAt - NOW) / (6 * HOUR), "the anchor moved");
  // The same again, shuffled in: same answer.
  const shuffled = rundown.layout({ entries: [close[2], close[0], close[1]], now: NOW, windowMs: 6 * HOUR, width: 1200 });
  assert.deepEqual(shuffled.markers.map(m => [m.entry.key, m.lane]), out.markers.map(m => [m.entry.key, m.lane]));
  // Identical instants: key order breaks the tie, deterministically.
  const same = rundown.layout({ entries: [entry("B:0", NOW + HOUR), entry("A:0", NOW + HOUR)], now: NOW, windowMs: 6 * HOUR, width: 1200 });
  assert.deepEqual(same.markers.map(m => [m.entry.key, m.lane]), [["A:0", 0], ["B:0", 1]]);
  // Far apart: all on lane 0.
  const apart = rundown.layout({ entries: [entry("A:0", NOW + HOUR), entry("B:0", NOW + 2 * HOUR), entry("C:0", NOW + 3 * HOUR)], now: NOW, windowMs: 6 * HOUR, width: 1200 });
  assert.deepEqual(apart.markers.map(m => m.lane), [0, 0, 0]);
  // A fourth within the same span is crowded and takes the lane that frees soonest.
  const four = rundown.layout({ entries: close.concat([entry("D:0", NOW + HOUR + 3 * MINUTE)]), now: NOW, windowMs: 6 * HOUR, width: 1200 });
  assert.deepEqual(four.markers[3].lane, 0);
  assert.equal(four.markers[3].crowded, true);
  // Lanes free up once a label's width has passed.
  const px = rundown.LABEL_WIDTH_PX / 1200 * 6 * HOUR;
  const spaced = rundown.layout({ entries: [entry("A:0", NOW + HOUR), entry("B:0", NOW + HOUR + px + 1)], now: NOW, windowMs: 6 * HOUR, width: 1200 });
  assert.deepEqual(spaced.markers.map(m => m.lane), [0, 0]);
});

test("the layout is pure and never invents an entry", () => {
  const entries = [entry("A:0", NOW + HOUR)];
  const before = JSON.stringify(entries);
  rundown.layout({ entries, now: NOW, windowMs: 6 * HOUR, width: 1200 });
  assert.equal(JSON.stringify(entries), before);
  const empty = rundown.layout({ entries: [], now: NOW, windowMs: 6 * HOUR, width: 1200 });
  assert.deepEqual(empty.markers, []);
  assert.deepEqual(empty.beyond, []);
  assert.deepEqual(empty.unavailable, []);
  assert.equal(empty.changeover, null);
});

/* ----------------------------------------------------------------------
 *   Formatting
 * -------------------------------------------------------------------- */

test("durations read as hours and minutes, never negative, never NaN", () => {
  assert.equal(rundown.formatRemaining(2 * HOUR + 14 * MINUTE), "2h 14m");
  assert.equal(rundown.formatRemaining(45 * MINUTE), "45m");
  assert.equal(rundown.formatRemaining(HOUR + 5 * MINUTE), "1h 05m");
  assert.equal(rundown.formatRemaining(20 * 1000), "<1m");
  assert.equal(rundown.formatRemaining(-5 * MINUTE), "0m");
  assert.equal(rundown.formatRemaining(NaN), "—");
  assert.equal(rundown.formatRemaining(null), "—");
  assert.equal(rundown.formatClock(NaN), "—");
  assert.match(rundown.formatClock(NOW), /2:03|14:03/);
  assert.equal(rundown.formatRate(216), "216 lb/hr");
  assert.equal(rundown.formatRate(12.345), "12.3 lb/hr");
  assert.equal(rundown.formatRate(null), "—");
});

test("the module is pure: no DOM, no timers, no storage, no bridge, frozen surface", () => {
  const src = fs.readFileSync(path.join(__dirname, "station/station-rundown.js"), "utf8");
  for (const pattern of [/\bdocument\b/, /\bwindow\b\./, /setTimeout/, /setInterval/, /localStorage/, /PolynStationStateBridge/, /PolynStationCommandBridge/, /\.dispatch\s*\(/]) {
    assert.doesNotMatch(src.replace(/\/\*[\s\S]*?\*\//g, ""), pattern);
  }
  assert.ok(Object.isFrozen(rundown));
  assert.deepEqual([...rundown.WINDOWS], [6, 12]);
});
