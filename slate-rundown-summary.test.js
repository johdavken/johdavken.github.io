"use strict";

/* slate-rundown-summary.js: the right pane's stand-in for the timeline -
 * what the run-down says next, on the application's own arithmetic. */

const test = require("node:test");
const assert = require("node:assert/strict");

const { makeDocument, makeTimers } = require("./tools/slate-test/fake-dom.js");
const summaryModule = require("./slate/slate-rundown-summary.js");
const rundown = require("./station/station-rundown.js");
const source = require("./slate/slate-source.js");
const demo = require("./slate/slate-demo.js");

const HOUR = 3600 * 1000;
const NOW = new Date(2026, 8, 21, 8, 0, 0).getTime();

function resolvedAt(now, mutate) {
  const snap = demo.snapshot(now);
  snap.revision = 1;
  if (mutate) mutate(snap);
  return source.resolveSource({ snapshot: snap });
}

function boot(options) {
  const settings = options || {};
  const doc = makeDocument();
  const timers = makeTimers();
  const ticks = [];
  let now = settings.now || NOW;
  const view = summaryModule.create(doc, {
    now: () => now,
    timers,
    tickMs: settings.tickMs,
    onTick: marks => ticks.push(marks),
    visibility: doc
  });
  return { doc, timers, ticks, view, setNow: value => { now = value; } };
}

/* ----------------------------------------------------------------------
 *   summarize (pure)
 * -------------------------------------------------------------------- */

test("summarize picks the earliest mark that is not already pumped off as next, lists the rest, and counts", () => {
  const entries = [
    { key: "A:0", id: "A1", layer: "A", resin: "X", markAt: NOW + 3 * HOUR, markKind: "pump-off", pumpOff: false, late: false, overdue: false },
    { key: "A:1", id: "A2", layer: "A", resin: "Y", markAt: NOW + HOUR, markKind: "pump-off", pumpOff: false, late: true, overdue: true },
    { key: "B:0", id: "B1", layer: "B", resin: "Z", markAt: NOW + 0.5 * HOUR, markKind: "pump-off", pumpOff: true, late: false, overdue: false },
    { key: "C:0", id: "C1", layer: "C", resin: "W", markAt: null, reason: "no-weight", pumpOff: false }
  ];
  const model = { layers: [{ id: "A", roleLabel: "Inside", hoppers: [] }, { id: "B", roleLabel: "Core", hoppers: [] }, { id: "C", roleLabel: "Outside", hoppers: [] }] };
  const result = summaryModule.summarize(entries, { at: NOW + 4 * HOUR, stale: false }, NOW, model);
  assert.equal(result.tracked, 4);
  assert.equal(result.overdue, 1);
  assert.equal(result.pumpedOff, 1);
  assert.equal(result.next.id, "A2");
  assert.equal(result.next.roleLabel, "Inside");
  assert.equal(result.next.kind, "pump-off");
  assert.equal(result.next.untilMs, HOUR);
  assert.deepEqual(result.upcoming.map(item => item.id), ["A1"]);
  assert.deepEqual(result.unavailable.map(item => [item.id, item.reason]), [["C1", "no-weight"]]);
  assert.equal(summaryModule.wording(result.next), `A2 (Layer A · Inside) pump off by ${rundown.formatClock(NOW + HOUR)}`);
  assert.equal(summaryModule.wording({ id: "B1", layer: "B", roleLabel: "", kind: "empty", at: NOW }), `B1 (Layer B) empty at ${rundown.formatClock(NOW)}`);
  const none = summaryModule.summarize([], null, NOW, null);
  assert.equal(none.tracked, 0);
  assert.equal(none.next, null);
  assert.equal(summaryModule.wording(null), "");
});

/* ----------------------------------------------------------------------
 *   The pane
 * -------------------------------------------------------------------- */

test("with nothing tracked the pane says so; with the demo job it names the next hopper and the counts", () => {
  const { view } = boot();
  view.update(resolvedAt(NOW, snap => { for (const layer of snap.layers) for (const hopper of layer.hoppers) hopper.track = false; }));
  assert.equal(view.element.querySelector(".slate-summary__next").textContent, summaryModule.NONE_TRACKED);
  assert.ok(view.element.classList.contains("is-idle"));
  assert.equal(view.element.querySelectorAll(".slate-summary__item").length, 0);

  const summary = view.update(resolvedAt(NOW));
  assert.ok(!view.element.classList.contains("is-idle"));
  assert.equal(summary.tracked, 5);
  assert.ok(summary.next, "the demo job has no next");
  assert.match(view.element.querySelector(".slate-summary__next").textContent, /^[A-C]\d \(Layer [A-C] · \w+\) (pump off by|empty at) /);
  assert.match(view.element.querySelector(".slate-summary__when").textContent, /^(now|in )/);
  assert.match(view.element.querySelector(".slate-summary__counts").textContent, /^5 tracked/);
  assert.match(view.element.querySelector(".slate-summary__counts").textContent, /1 pumped off/);
  // The list is the rest, by time, with the ones without an estimate after.
  const items = view.element.querySelectorAll(".slate-summary__item");
  assert.ok(items.length >= 1 && items.length <= summaryModule.UPCOMING + 5);
  assert.notEqual(items.map(item => item.getAttribute("data-hopper")).indexOf(summary.upcoming[0].id), -1);
});

test("the projection is the application's own: entries match station-rundown over the same inputs", () => {
  const { view } = boot();
  const resolved = resolvedAt(NOW);
  view.update(resolved);
  const changeover = rundown.resolveChangeover(resolved.job, { now: NOW });
  const expected = rundown.projectEntries({ model: resolved.line, hopperState: resolved.hopperState, layerState: resolved.layerState, job: resolved.job, observed: view.observed() }, { now: NOW, changeoverAt: changeover.at });
  assert.deepEqual(view.entries().map(entry => [entry.key, entry.markAt, entry.overdue]), expected.map(entry => [entry.key, entry.markAt, entry.overdue]));
  assert.deepEqual(view.marks(), rundown.hopperMarks(expected));
  assert.deepEqual(Object.keys(view.marks()).sort(), ["A:0", "A:1", "B:0", "B:1", "C:1"]);
});

test("a stale changeover is flagged and not planned by", () => {
  const { view } = boot();
  const stale = resolvedAt(NOW, snap => { snap.job.changeoverSetAt = NOW - 5 * 24 * HOUR; });
  const staleByApp = rundown.resolveChangeover(stale.job, { now: NOW }).stale;
  view.update(stale);
  const notice = view.element.querySelector(".slate-summary__notice");
  assert.equal(notice.hasAttribute("hidden"), !staleByApp);
  if (staleByApp) {
    assert.equal(notice.textContent, summaryModule.STALE_CHANGEOVER);
    assert.ok(view.entries().every(entry => entry.pumpOffBy === null || entry.pumpOffBy === undefined), "a stale changeover was planned by");
  }
});

test("weights are anchored when first seen and re-anchored only when they move", () => {
  const { view, setNow } = boot();
  view.update(resolvedAt(NOW));
  const first = view.observed();
  assert.equal(first["A:0"], NOW);
  setNow(NOW + 10 * 60 * 1000);
  view.update(resolvedAt(NOW, snap => { snap.job.lineRate = 900; }));
  assert.equal(view.observed()["A:0"], NOW, "an unrelated change re-anchored the weight");
  view.update(resolvedAt(NOW, snap => { snap.layers[0].hoppers[0].effectiveWeight = 350; }));
  assert.equal(view.observed()["A:0"], NOW + 10 * 60 * 1000, "a moved weight was not re-anchored");
  assert.equal(view.observed()["A:1"], NOW);
  view.update(resolvedAt(NOW, snap => { snap.layers[0].hoppers[0].track = false; }));
  assert.equal(view.observed()["A:0"], undefined, "an untracked hopper kept its anchor");
});

test("the clock ticks on the injected timers, tells the boot with the marks, and wakes on visibility", () => {
  const { doc, view, timers, ticks, setNow } = boot({ tickMs: 20000 });
  // A changeover ten hours out, so the next mark is ahead and its countdown can walk.
  const later = new Date(NOW + 10 * HOUR);
  view.update(resolvedAt(NOW, snap => { snap.job.changeoverTime = `${String(later.getHours()).padStart(2, "0")}:${String(later.getMinutes()).padStart(2, "0")}`; }));
  assert.equal(timers.pending(), 1);
  const before = view.element.querySelector(".slate-summary__when").textContent;
  setNow(NOW + 30 * 60 * 1000);
  assert.equal(timers.advance(20000), 1);
  assert.equal(ticks.length, 1);
  assert.deepEqual(Object.keys(ticks[0]).sort(), ["A:0", "A:1", "B:0", "B:1", "C:1"]);
  assert.notEqual(view.element.querySelector(".slate-summary__when").textContent, before, "the remaining time did not walk");
  assert.equal(timers.pending(), 1, "the clock did not reschedule itself");

  for (const handler of doc.listeners.visibilitychange || []) handler();
  assert.equal(timers.pending(), 1, "a wake left two clocks running");
  assert.equal((doc.listeners.visibilitychange || []).length, 1);
  view.destroy();
  assert.equal(timers.pending(), 0);
  assert.equal((doc.listeners.visibilitychange || []).length, 0, "destroy left the visibility listener behind");
});

test("the default tick is twenty seconds and a throwing listener does not stop the clock", () => {
  assert.equal(summaryModule.TICK_MS, 20000);
  const doc = makeDocument();
  const timers = makeTimers();
  const view = summaryModule.create(doc, { now: () => NOW, timers, onTick: () => { throw new Error("boom"); } });
  view.update(resolvedAt(NOW));
  assert.doesNotThrow(() => timers.advance(20000));
  assert.equal(timers.pending(), 1);
});
