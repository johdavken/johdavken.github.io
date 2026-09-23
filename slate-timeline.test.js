"use strict";

/* slate-timeline.js: the right pane's vertical timeline - the projection
 * (the application's own arithmetic), the anchors, the clock, the cards
 * down the axis, and Pump off / Back on through the tracking seam. */

const test = require("node:test");
const assert = require("node:assert/strict");

const { makeDocument, makeTimers, makeCommands, click } = require("./tools/slate-test/fake-dom.js");
const timelineModule = require("./slate/slate-timeline.js");
const layout = require("./slate/slate-timeline-layout.js");
const tracking = require("./slate/slate-tracking.js");
const rundown = require("./station/station-rundown.js");
const source = require("./slate/slate-source.js");
const demo = require("./slate/slate-demo.js");

const HOUR = 3600 * 1000;
const MINUTE = 60 * 1000;
const NOW = new Date(2026, 8, 21, 8, 0, 0).getTime();

function hhmm(t) {
  const date = new Date(t);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function resolvedAt(now, mutate) {
  const snap = demo.snapshot(now);
  snap.revision = 1;
  if (mutate) mutate(snap);
  return source.resolveSource({ snapshot: snap });
}

/* The demo job with a changeover a set number of hours out, set just now. */
function withChangeover(now, hours, mutate) {
  return resolvedAt(now, snap => {
    snap.job.changeoverTime = hhmm(now + hours * HOUR);
    snap.job.changeoverSetAt = now;
    if (mutate) mutate(snap);
  });
}

function boot(options) {
  const settings = options || {};
  const doc = makeDocument();
  const timers = makeTimers();
  const ticks = [];
  const said = [];
  const committed = [];
  let now = settings.now || NOW;
  let readOnly = !!settings.readOnly;
  let trackingMode = settings.trackingMode || "assisted";
  let timelineView = settings.timelineView || "realtime";
  const commands = settings.commands === null ? null : (settings.commands || makeCommands({ capabilities: ["setPumpOff", "setHopperTracking", "resetTracking"] }));
  const view = timelineModule.create(doc, {
    now: () => now,
    timers,
    tickMs: settings.tickMs,
    onTick: marks => ticks.push(marks),
    visibility: doc,
    view: settings.view,
    commands: () => commands,
    readOnly: () => readOnly,
    trackingMode: () => trackingMode,
    timelineView: () => timelineView,
    onCommitted: result => committed.push(result),
    say: message => said.push(message),
    tier: settings.tier,
    openWeights: settings.openWeights
  });
  doc.body.appendChild(view.element);
  const axis = view.element.querySelector(".slate-timeline__axis");
  if (settings.height) axis._rect = { left: 0, top: 0, width: 276, height: settings.height };
  return { doc, timers, ticks, said, committed, commands, view, axis, setNow: value => { now = value; }, setReadOnly: value => { readOnly = value; }, setTrackingMode: value => { trackingMode = value; }, setTimelineView: value => { timelineView = value; } };
}

const q = (view, selector) => view.element.querySelector(selector);
const qa = (view, selector) => view.element.querySelectorAll(selector);
const topOf = node => Number(String(node.style.top).replace("px", ""));

/* ----------------------------------------------------------------------
 *   Pure words
 * -------------------------------------------------------------------- */

test("cardHeight sums the stylesheet's pieces; the words for facts, counts and the changeover line", () => {
  const single = { members: [{}] };
  assert.equal(timelineModule.cardHeight(single), timelineModule.CARD_PAD + timelineModule.CARD_HEAD + timelineModule.MEMBER_ROW + timelineModule.CARD_FACTS);
  assert.equal(timelineModule.cardHeight({ members: [{}, {}, {}] }), timelineModule.CARD_PAD + timelineModule.CARD_HEAD + 3 * timelineModule.MEMBER_ROW);
  assert.equal(timelineModule.cardHeight({ members: [{}], pinned: true }), timelineModule.CARD_PAD + timelineModule.CARD_HEAD + timelineModule.MEMBER_ROW);
  assert.equal(timelineModule.facts({ weight: 400.4, durationMs: 3 * HOUR + 10 * MINUTE }), "400 lb · 3h 10m run-down");
  assert.equal(timelineModule.facts({ weight: 0, durationMs: null }), "");
  assert.equal(timelineModule.countsFor([{ overdue: true }, { pumpOff: true }, {}]), "3 tracked · 1 overdue · 1 off");
  assert.equal(timelineModule.countsFor([]), "0 tracked");
  assert.equal(timelineModule.changeoverText({ at: null, stale: false }, NOW), "Changeover not set");
  assert.match(timelineModule.changeoverText({ at: NOW + 2 * HOUR, stale: false }, NOW), /^Changeover .+ · in 2h 00m$/);
  assert.match(timelineModule.changeoverText({ at: NOW + 2 * HOUR, stale: true }, NOW), /^Confirm changeover · /);
  assert.match(timelineModule.changeoverText({ at: NOW - MINUTE, stale: false }, NOW), /passed$/);
});

/* ----------------------------------------------------------------------
 *   The projection (the summary's tests, kept)
 * -------------------------------------------------------------------- */

test("the projection is the application's own: entries match station-rundown over the same inputs, and the marks are the recipe's", () => {
  const { view } = boot();
  const resolved = resolvedAt(NOW);
  view.update(resolved);
  const changeover = rundown.resolveChangeover(resolved.job, { now: NOW });
  const expected = rundown.projectEntries({ model: resolved.line, hopperState: resolved.hopperState, layerState: resolved.layerState, job: resolved.job, observed: view.observed() }, { now: NOW, changeoverAt: changeover.at });
  assert.deepEqual(view.entries().map(entry => [entry.key, entry.markAt, entry.overdue]), expected.map(entry => [entry.key, entry.markAt, entry.overdue]));
  assert.deepEqual(view.marks(), rundown.hopperMarks(expected));
  assert.deepEqual(Object.keys(view.marks()).sort(), ["A:0", "A:1", "B:0", "B:1", "C:1"]);
});

test("weights are anchored when first seen and re-anchored only when they move", () => {
  const { view, setNow } = boot();
  view.update(resolvedAt(NOW));
  assert.equal(view.observed()["A:0"], NOW);
  setNow(NOW + 10 * MINUTE);
  view.update(resolvedAt(NOW, snap => { snap.job.lineRate = 900; }));
  assert.equal(view.observed()["A:0"], NOW, "an unrelated change re-anchored the weight");
  view.update(resolvedAt(NOW, snap => { snap.layers[0].hoppers[0].effectiveWeight = 350; }));
  assert.equal(view.observed()["A:0"], NOW + 10 * MINUTE, "a moved weight was not re-anchored");
  assert.equal(view.observed()["A:1"], NOW);
  view.update(resolvedAt(NOW, snap => { snap.layers[0].hoppers[0].track = false; }));
  assert.equal(view.observed()["A:0"], undefined, "an untracked hopper kept its anchor");
});

test("a stale changeover is flagged, not planned by, and the axis falls back to the fixed horizon", () => {
  const { view } = boot();
  const stale = resolvedAt(NOW, snap => { snap.job.changeoverSetAt = NOW - 5 * 24 * HOUR; });
  assert.equal(rundown.resolveChangeover(stale.job, { now: NOW }).stale, true, "the fixture is not stale by the application's rule");
  view.update(stale);
  assert.equal(q(view, ".slate-timeline__notice").textContent, timelineModule.STALE_CHANGEOVER);
  assert.ok(!q(view, ".slate-timeline__notice").hasAttribute("hidden"));
  assert.ok(view.element.classList.contains("is-stale"));
  assert.ok(view.entries().every(entry => entry.pumpOffBy === null || entry.pumpOffBy === undefined), "a stale changeover was planned by");
  assert.equal(view.element.getAttribute("data-mode"), "fixed");
  assert.match(q(view, ".slate-timeline__changeover-line").textContent, /^Confirm changeover/);
  assert.ok(q(view, ".slate-timeline__changeover").hasAttribute("hidden"));
  assert.ok(!q(view, ".slate-timeline__scale").hasAttribute("hidden"));
});

/* ----------------------------------------------------------------------
 *   The axis
 * -------------------------------------------------------------------- */

test("with nothing tracked or no line the pane says so; with a job the head carries the clock, the changeover and the counts", () => {
  const { view } = boot();
  view.update(null);
  assert.equal(q(view, ".slate-timeline__notice").textContent, timelineModule.NO_LINE);
  assert.ok(view.element.classList.contains("is-idle"));
  const untracked = () => resolvedAt(NOW, snap => { for (const layer of snap.layers) for (const hopper of layer.hoppers) hopper.track = false; });
  view.update(untracked());
  assert.equal(q(view, ".slate-timeline__notice").textContent, timelineModule.NONE_TRACKED);
  assert.ok(view.element.classList.contains("is-idle"));
  // Under Automatic tracking there is no Track to turn on; the notice says what happens instead.
  const automatic = boot({ trackingMode: "automatic" });
  automatic.view.update(untracked());
  assert.equal(q(automatic.view, ".slate-timeline__notice").textContent, timelineModule.NONE_TRACKED_AUTOMATIC);
  assert.match(timelineModule.NONE_TRACKED_AUTOMATIC, /tracked automatically/);
  // The mode moving in Settings changes the line on refresh, before any tick.
  automatic.setTrackingMode("manual");
  automatic.view.refresh();
  assert.equal(q(automatic.view, ".slate-timeline__notice").textContent, timelineModule.NONE_TRACKED);
  automatic.setTrackingMode("automatic");
  automatic.view.refresh();
  assert.equal(q(automatic.view, ".slate-timeline__notice").textContent, timelineModule.NONE_TRACKED_AUTOMATIC);
  assert.doesNotMatch(timelineModule.NONE_TRACKED_AUTOMATIC, /Turn on Track/);
  assert.equal(qa(view, ".slate-timeline__member").length, 0);
  assert.equal(q(view, ".slate-timeline__counts").textContent, "");

  view.update(withChangeover(NOW, 4));
  assert.ok(!view.element.classList.contains("is-idle"));
  assert.ok(q(view, ".slate-timeline__notice").hasAttribute("hidden"));
  assert.equal(q(view, ".slate-timeline__clock").textContent, rundown.formatClock(NOW));
  assert.match(q(view, ".slate-timeline__changeover-line").textContent, /^Changeover .+ · in 4h 00m$/);
  assert.match(q(view, ".slate-timeline__counts").textContent, /^5 tracked/);
  assert.match(q(view, ".slate-timeline__counts").textContent, /1 off$/);
});

test("a usable changeover fits the axis: the mark stands at its instant, the scale hides, every tracked hopper is a member somewhere", () => {
  const { view, axis } = boot({ height: 700 });
  const placed = view.update(withChangeover(NOW, 4));
  assert.equal(view.element.getAttribute("data-mode"), "fit");
  const window = view.getWindow();
  assert.equal(window.windowMs, 4 * HOUR * 1.1);
  assert.ok(q(view, ".slate-timeline__scale").hasAttribute("hidden"));
  const mark = q(view, ".slate-timeline__changeover");
  assert.ok(!mark.hasAttribute("hidden"));
  const span = 700 - timelineModule.TOP_INSET - timelineModule.CHANGEOVER_INSET;
  assert.ok(Math.abs(topOf(mark) - (timelineModule.TOP_INSET + span / 1.1)) < 0.2, `changeover at ${mark.style.top}`);
  assert.equal(topOf(q(view, ".slate-timeline__now")), timelineModule.TOP_INSET);
  assert.ok(qa(view, ".slate-timeline__tick").length > 5);
  assert.ok(qa(view, ".slate-timeline__tick-label").length >= 3);

  // Every tracked hopper: on a card, pinned, or in the foot.
  const members = qa(view, ".slate-timeline__member");
  assert.deepEqual(members.map(member => member.getAttribute("data-key")).sort(), ["A:0", "A:1", "B:0", "B:1", "C:1"]);
  assert.equal(qa(view, "[data-slate-control='pump']").length, 5);
  const off = q(view, ".slate-timeline__done .slate-timeline__member");
  assert.ok(off, "the pumped-off hopper is not in the foot");
  assert.equal(off.getAttribute("data-key"), "B:1");
  assert.equal(off.querySelector(".slate-timeline__member-at").textContent, "Off");
  // The foot is its rows alone: no heading over them.
  assert.equal(q(view, ".slate-timeline__done-title"), null);
  assert.equal(q(view, ".slate-timeline__done").firstChild.getAttribute("class"), "slate-timeline__done-list");
  assert.equal(off.querySelector(".slate-toggle__label").textContent, "Back on");
  assert.equal(off.querySelector("[data-slate-control]").getAttribute("aria-pressed"), "true");
  // Cards: each event's dot at the instant, the card at its placed y.
  for (const card of placed.cards) {
    const el = q(view, `.slate-timeline__event[data-group='${card.group.members.map(m => m.key).join("+")}']`);
    assert.ok(el, "an event has no element");
    assert.equal(topOf(el) + topOf(el.querySelector(".slate-timeline__dot")), Math.round(card.y0 * 10) / 10);
    assert.equal(topOf(el) + topOf(el.querySelector(".slate-timeline__card")), Math.round(card.y * 10) / 10);
    assert.equal(el.querySelector(".slate-timeline__card").classList.contains("is-group"), card.group.members.length > 1);
    assert.match(el.querySelector(".slate-timeline__when").textContent, card.group.members.length > 1 ? /^\d+ hoppers · (in |now)/ : /^pump off by .+ · (in |now)/);
  }
  assert.ok(axis._rect.height === 700);
});

test("without a measured axis the fallback height places the cards; a taller axis moves them", () => {
  const short = boot();
  short.view.update(withChangeover(NOW, 4));
  const tall = boot({ height: 1000 });
  tall.view.update(withChangeover(NOW, 4));
  const key = short.view.placed().cards[short.view.placed().cards.length - 1].group.members.map(m => m.key).join("+");
  const a = topOf(q(short.view, `.slate-timeline__event[data-group='${key}']`));
  const b = topOf(q(tall.view, `.slate-timeline__event[data-group='${key}']`));
  assert.ok(b > a, `the taller axis did not spread the cards (${a} vs ${b})`);
  assert.equal(short.view.placed().span, timelineModule.FALLBACK_HEIGHT - timelineModule.TOP_INSET - timelineModule.CHANGEOVER_INSET);
});

test("without a changeover the axis is a fixed horizon: 6H by default, 12H on the switch, later hoppers as chips; the words say empty at", () => {
  // Track only A1 with a small run-down and B1 with a long one.
  const { view } = boot({ height: 700 });
  const long = resolvedAt(NOW, snap => {
    snap.job.changeoverTime = "";
    snap.job.changeoverSetAt = null;
    snap.job.lineRate = 100;
    for (const layer of snap.layers) for (const hopper of layer.hoppers) { hopper.track = false; hopper.pumpOff = false; }
    snap.layers[0].hoppers[0].track = true;   // A1: 400 lb at 100 × 0.25 × 0.6 = 15 lb/hr → ~26 h
    snap.layers[1].hoppers[0].track = true;   // B1: 620 lb at 100 × 0.5 × 0.7 = 35 lb/hr → ~17 h
    snap.layers[0].hoppers[0].effectiveWeight = 30; // A1 → 2 h
  });
  view.update(long);
  assert.equal(view.element.getAttribute("data-mode"), "fixed");
  assert.equal(view.getWindow().windowMs, 6 * HOUR);
  assert.match(q(view, ".slate-timeline__changeover-line").textContent, /not set/);
  assert.ok(q(view, ".slate-timeline__changeover").hasAttribute("hidden"));
  assert.equal(qa(view, ".slate-timeline__event").length, 1);
  assert.match(q(view, ".slate-timeline__event .slate-timeline__when").textContent, /^empty at /);
  const later = qa(view, ".slate-timeline__chip.is-later");
  assert.equal(later.length, 1);
  assert.match(later[0].textContent, /^B1 → 17h/);
  assert.equal(qa(view, "[data-slate-control='pump']").length, 1, "a chip is not a card: no toggle beyond the horizon");

  click(q(view, "[data-window='12']"));
  assert.equal(view.getWindow().windowMs, 12 * HOUR);
  assert.equal(q(view, "[data-window='12']").getAttribute("aria-pressed"), "true");
  assert.equal(q(view, "[data-window='6']").getAttribute("aria-pressed"), "false");
  assert.equal(qa(view, ".slate-timeline__chip.is-later").length, 1, "17h is still beyond 12h");
  assert.equal(view.setWindow(9), 12, "an unknown horizon was taken");
});

test("what is late pins under Now in one block, most late first; what has no estimate is a chip", () => {
  const { view } = boot({ height: 700 });
  // A changeover in 30 minutes: every run-down is longer, so every mark is behind Now.
  view.update(withChangeover(NOW, 0.5, snap => { snap.layers[2].hoppers[1].effectiveWeight = 0; }));
  assert.ok(view.element.classList.contains("is-overdue"));
  const pinned = q(view, ".slate-timeline__pinned");
  assert.ok(!pinned.hasAttribute("hidden"));
  assert.equal(topOf(pinned), timelineModule.TOP_INSET + timelineModule.GAP);
  const keys = pinned.querySelectorAll(".slate-timeline__member").map(member => member.getAttribute("data-key"));
  assert.ok(keys.length >= 2);
  const marks = keys.map(key => view.entries().find(entry => entry.key === key).markAt);
  assert.deepEqual(marks, marks.slice().sort((a, b) => a - b), "the pinned block is not most-late first");
  assert.match(pinned.querySelector(".slate-timeline__when").textContent, /late for pump-off$/);
  assert.ok(pinned.querySelectorAll(".slate-timeline__member").every(member => member.classList.contains("is-overdue")));
  assert.equal(qa(view, ".slate-timeline__event").length, 0);
  const chip = q(view, ".slate-timeline__chip.is-unavailable");
  assert.equal(chip.textContent, "C2 · No weight");
  assert.match(q(view, ".slate-timeline__counts").textContent, /overdue/);
  // The first card starts under the pinned block.
  const placed = view.placed();
  assert.equal(placed.floor, placed.pinned.y + placed.pinned.height + timelineModule.GAP);
});

test("hoppers within five minutes share a card that lists each with its own time", () => {
  const { view } = boot({ height: 700 });
  // Two hoppers with the same run-down: the same pump-off point.
  view.update(withChangeover(NOW, 6, snap => {
    for (const layer of snap.layers) for (const hopper of layer.hoppers) { hopper.track = false; hopper.pumpOff = false; }
    const a = snap.layers[0].hoppers[0];
    const b = snap.layers[0].hoppers[1];
    a.track = true; b.track = true;
    a.pct = 50; b.pct = 50; a.effectiveWeight = 200; b.effectiveWeight = 200;
  }));
  const events = qa(view, ".slate-timeline__event");
  assert.equal(events.length, 1);
  const card = events[0].querySelector(".slate-timeline__card");
  assert.ok(card.classList.contains("is-group"));
  assert.match(card.querySelector(".slate-timeline__when").textContent, /^2 hoppers · in /);
  assert.deepEqual(card.querySelectorAll(".slate-timeline__member").map(member => member.getAttribute("data-hopper")), ["A1", "A2"]);
  assert.ok(card.querySelectorAll(".slate-timeline__member-at").every(at => /\d/.test(at.textContent)));
  assert.ok(card.querySelector(".slate-timeline__facts").hasAttribute("hidden"), "a group card shows a single's facts");
});

/* ----------------------------------------------------------------------
 *   Pump off / Back on
 * -------------------------------------------------------------------- */

test("Pump off dispatches one setPumpOff addressed to Current and tells the boot; Back on sends the pump running again", () => {
  const { view, commands, committed } = boot({ height: 700 });
  view.update(withChangeover(NOW, 4));
  const button = q(view, ".slate-timeline__member[data-key='A:0'] [data-slate-control='pump']");
  assert.equal(button.getAttribute("data-able"), "true");
  assert.match(button.getAttribute("title"), /^Pump running — click to mark the pump off$/);
  click(button);
  assert.deepEqual(commands.calls, [{ command: "setPumpOff", args: { recipe: "current", layer: "A", index: 0, pumpOff: true } }]);
  assert.equal(committed.length, 1);

  const back = q(view, ".slate-timeline__done [data-slate-control='pump']");
  assert.match(back.getAttribute("title"), /^Pump off — click to mark the pump running$/);
  click(back);
  assert.deepEqual(commands.calls[1], { command: "setPumpOff", args: { recipe: "current", layer: "B", index: 1, pumpOff: false } });
  assert.equal(committed.length, 2);
});

test("a refusal is said and nothing is told; read-only, no bridge and a missing capability withhold the toggle with the reason", () => {
  const refusing = makeCommands({ capabilities: ["setPumpOff"], answer: () => ({ ok: false, code: "refused", message: "Not now." }) });
  const { view, said, committed } = boot({ commands: refusing, height: 700 });
  view.update(withChangeover(NOW, 4));
  click(q(view, ".slate-timeline__member[data-key='A:0'] [data-slate-control='pump']"));
  assert.deepEqual(said, ["Not now."]);
  assert.equal(committed.length, 0);

  const ro = boot({ readOnly: true, height: 700 });
  ro.view.update(withChangeover(NOW, 4));
  assert.ok(ro.view.element.classList.contains("is-readonly"));
  const button = q(ro.view, ".slate-timeline__member[data-key='A:0'] [data-slate-control='pump']");
  assert.equal(button.getAttribute("data-able"), "false");
  assert.equal(button.getAttribute("title"), `Pump running — ${tracking.READ_ONLY_REASON}`);
  click(button);
  assert.deepEqual(ro.commands.calls, []);
  assert.match(ro.said[0], /read-only/);
  ro.setReadOnly(false);
  ro.view.refresh();
  assert.equal(button.getAttribute("data-able"), "true");

  const none = boot({ commands: null, height: 700 });
  none.view.update(withChangeover(NOW, 4));
  assert.match(q(none.view, "[data-slate-control='pump']").getAttribute("title"), /no application is connected/);

  const partial = boot({ commands: makeCommands({ capabilities: ["setHopperTracking"] }), height: 700 });
  partial.view.update(withChangeover(NOW, 4));
  assert.match(q(partial.view, "[data-slate-control='pump']").getAttribute("title"), /does not offer pump-off/);
});

/* ----------------------------------------------------------------------
 *   The clock
 * -------------------------------------------------------------------- */

test("the clock ticks on the injected timers, tells the boot with the marks, walks the countdown, keeps focus, and wakes on visibility", () => {
  const { doc, view, timers, ticks, setNow } = boot({ tickMs: 20000, height: 700 });
  view.update(withChangeover(NOW, 10));
  assert.equal(timers.pending(), 1);
  const before = q(view, ".slate-timeline__event .slate-timeline__when").textContent;
  const button = q(view, ".slate-timeline__member[data-key='A:0'] [data-slate-control='pump']");
  button.focus();
  setNow(NOW + 30 * MINUTE);
  assert.equal(timers.advance(20000), 1);
  assert.equal(ticks.length, 1);
  assert.deepEqual(Object.keys(ticks[0]).sort(), ["A:0", "A:1", "B:0", "B:1", "C:1"]);
  assert.notEqual(q(view, ".slate-timeline__event .slate-timeline__when").textContent, before, "the remaining time did not walk");
  assert.ok(doc.activeElement === button, "a tick took the focus");
  assert.ok(q(view, ".slate-timeline__member[data-key='A:0'] [data-slate-control='pump']") === button, "a tick rebuilt the row");
  assert.equal(timers.pending(), 1, "the clock did not reschedule itself");

  for (const handler of doc.listeners.visibilitychange || []) handler();
  assert.equal(timers.pending(), 1, "a wake left two clocks running");
  view.destroy();
  assert.equal(timers.pending(), 0);
  assert.equal((doc.listeners.visibilitychange || []).length, 0, "destroy left the visibility listener behind");
});

test("the default tick is twenty seconds, a throwing listener does not stop the clock, and a resize observer re-measures", () => {
  assert.equal(timelineModule.TICK_MS, 20000);
  const doc = makeDocument();
  const timers = makeTimers();
  const view = timelineModule.create(doc, { now: () => NOW, timers, onTick: () => { throw new Error("boom"); } });
  view.update(withChangeover(NOW, 4));
  assert.doesNotThrow(() => timers.advance(20000));
  assert.equal(timers.pending(), 1);

  const observed = [];
  let callback = null;
  const fakeView = { ResizeObserver: class { constructor(fn) { callback = fn; } observe(node) { observed.push(node); } disconnect() { observed.length = 0; } } };
  const sized = boot({ view: fakeView, height: 600 });
  sized.view.update(withChangeover(NOW, 4));
  assert.equal(observed.length, 1);
  assert.equal(sized.view.placed().span, 600 - timelineModule.TOP_INSET - timelineModule.CHANGEOVER_INSET);
  sized.axis._rect.height = 900;
  callback();
  assert.equal(sized.view.placed().span, 900 - timelineModule.TOP_INSET - timelineModule.CHANGEOVER_INSET);
  sized.view.destroy();
  assert.equal(observed.length, 0);
});

test("a publish that untracks a hopper drops its row and its event; grouping follows the new marks", () => {
  const { view } = boot({ height: 700 });
  view.update(withChangeover(NOW, 4));
  assert.ok(q(view, ".slate-timeline__member[data-key='A:0']"));
  view.update(withChangeover(NOW, 4, snap => { snap.layers[0].hoppers[0].track = false; }));
  assert.equal(q(view, ".slate-timeline__member[data-key='A:0']"), null);
  assert.equal(qa(view, "[data-slate-control='pump']").length, 4);
  assert.ok(qa(view, ".slate-timeline__event").every(el => !el.getAttribute("data-group").includes("A:0")));
  assert.deepEqual(Object.keys(view.marks()).sort(), ["A:1", "B:0", "B:1", "C:1"]);
  assert.equal(layout.groupEvents(view.entries(), { now: NOW, windowMs: view.getWindow().windowMs }).groups.length, qa(view, ".slate-timeline__event").length);
});

test("event boxes stand in time order in the document, whatever order they were first drawn in; no tick label runs into the changeover line", () => {
  const { view } = boot({ height: 700 });
  view.update(withChangeover(NOW, 6, snap => {
    for (const layer of snap.layers) for (const hopper of layer.hoppers) { hopper.track = false; hopper.pumpOff = false; }
    snap.layers[0].hoppers[0].track = true;   // A1, the long run-down: the earlier pump-off point
    snap.layers[2].hoppers[1].track = true;   // C2, the short one: later
  }));
  const order = () => qa(view, ".slate-timeline__event").map(el => el.getAttribute("data-group"));
  assert.deepEqual(order(), ["A:0", "C:1"]);
  // A heavier C2 now runs down longer than A1: its pump-off point moves ahead.
  view.update(withChangeover(NOW, 6, snap => {
    for (const layer of snap.layers) for (const hopper of layer.hoppers) { hopper.track = false; hopper.pumpOff = false; }
    snap.layers[0].hoppers[0].track = true;
    snap.layers[2].hoppers[1].track = true;
    snap.layers[2].hoppers[1].effectiveWeight = 180; // 4.2 h at 42.5 lb/hr: pump off 1.8 h out, before A1's 2.9 h
  }));
  assert.deepEqual(order(), ["C:1", "A:0"]);
  const changeoverTop = topOf(q(view, ".slate-timeline__changeover"));
  for (const label of qa(view, ".slate-timeline__tick-label")) {
    assert.ok(Math.abs(topOf(label.parentNode) - changeoverTop) >= layout.LABEL_EDGE_PX, "a tick label runs into the changeover line");
  }
});

/* ----------------------------------------------------------------------
 *   The list view
 * -------------------------------------------------------------------- */

test("the list view lists every tracked hopper as a row in time order - late first, no estimate last - with its clock and countdown; no axis, cards, chips or horizon; pumped off stays in the foot", () => {
  const { view, setTimelineView } = boot({ height: 700, timelineView: "list" });
  view.update(withChangeover(NOW, 4, snap => {
    // A1 tracked with no weight: no estimate. C2 tracked normally.
    snap.layers[0].hoppers[0].weight = 0;
    snap.layers[0].hoppers[0].effectiveWeight = 0;
  }));
  assert.equal(view.element.getAttribute("data-view"), "list");
  assert.ok(q(view, ".slate-timeline__axis").hasAttribute("hidden"));
  assert.ok(q(view, ".slate-timeline__scale").hasAttribute("hidden"));
  assert.ok(q(view, ".slate-timeline__chips").hasAttribute("hidden"));
  assert.ok(!q(view, ".slate-timeline__list").hasAttribute("hidden"));
  assert.equal(qa(view, ".slate-timeline__event").length, 0);
  assert.equal(view.placed(), null);
  // The head still speaks.
  assert.match(q(view, ".slate-timeline__changeover-line").textContent, /^Changeover /);
  assert.match(q(view, ".slate-timeline__counts").textContent, /5 tracked/);

  const rows = qa(view, ".slate-timeline__list .slate-timeline__member");
  const keys = rows.map(row => row.getAttribute("data-key"));
  // Every tracked, not-off hopper is a row; the pumped-off one is in the foot.
  assert.deepEqual([...keys].sort(), ["A:0", "A:1", "B:0", "C:1"]);
  assert.equal(q(view, ".slate-timeline__done .slate-timeline__member").getAttribute("data-key"), "B:1");
  // Time order: the timed rows by their mark, the one without an estimate last.
  const entries = view.entries();
  const markOf = key => entries.find(entry => entry.key === key).markAt;
  const timed = keys.filter(key => Number.isFinite(markOf(key)));
  assert.deepEqual(timed, [...timed].sort((a, b) => markOf(a) - markOf(b)));
  assert.equal(keys[keys.length - 1], "A:0");
  const at = key => q(view, `.slate-timeline__list .slate-timeline__member[data-key='${key}'] .slate-timeline__member-at`).textContent;
  assert.equal(at("A:0"), rundown.reasonLabel(entries.find(entry => entry.key === "A:0").reason));
  for (const key of timed) {
    const late = markOf(key) < NOW;
    assert.match(at(key), late ? /^\d+:\d\d [AP]M · late$/ : /^\d+:\d\d [AP]M · in \d+/, `${key}: ${at(key)}`);
    assert.equal(q(view, `.slate-timeline__list .slate-timeline__member[data-key='${key}']`).classList.contains("is-overdue"), late);
  }
  assert.match(q(view, ".slate-timeline__list .slate-timeline__member[data-key='B:0']").getAttribute("title"), /^B1 pump off by /);
  assert.match(q(view, ".slate-timeline__list .slate-timeline__member[data-key='A:0']").getAttribute("title"), /^A1: /);
  assert.equal(qa(view, "[data-slate-control='pump']").length, 5);

  // Back to realtime on refresh: the cards return, the rows are the same
  // elements, the titles go. The hopper without an estimate is a chip on
  // the axis, not a row, so it alone is built afresh on the way back.
  const before = new Map(qa(view, ".slate-timeline__member").map(row => [row.getAttribute("data-key"), row]));
  setTimelineView("realtime");
  view.refresh();
  assert.equal(view.element.getAttribute("data-view"), "realtime");
  assert.ok(!q(view, ".slate-timeline__axis").hasAttribute("hidden"));
  assert.ok(q(view, ".slate-timeline__list").hasAttribute("hidden"));
  assert.ok(qa(view, ".slate-timeline__event").length > 0);
  assert.ok(view.placed());
  assert.equal(q(view, ".slate-timeline__member[data-key='A:0']"), null);
  assert.equal(q(view, ".slate-timeline__chip.is-unavailable").getAttribute("data-key"), "A:0");
  for (const row of qa(view, ".slate-timeline__member")) {
    assert.ok(before.get(row.getAttribute("data-key")) === row, `${row.getAttribute("data-key")} was rebuilt`);
    assert.equal(row.getAttribute("title"), null);
  }
  // And back again: the same rows, in the list.
  setTimelineView("list");
  view.refresh();
  assert.equal(qa(view, ".slate-timeline__list .slate-timeline__member").length, 4);
  for (const row of qa(view, ".slate-timeline__member")) if (row.getAttribute("data-key") !== "A:0") assert.ok(before.get(row.getAttribute("data-key")) === row);
  // A refresh with the view unchanged redraws nothing.
  const order = qa(view, ".slate-timeline__list .slate-timeline__member").map(row => row.getAttribute("data-key"));
  view.refresh();
  assert.deepEqual(qa(view, ".slate-timeline__list .slate-timeline__member").map(row => row.getAttribute("data-key")), order);
});

test("in the list view Pump off dispatches from a row as it does from a card, the row moves to the foot, and a tick walks the countdowns without moving a focused row", () => {
  const { view, commands, committed, timers, setNow, doc } = boot({ height: 700, timelineView: "list", tickMs: 1000 });
  view.update(withChangeover(NOW, 4));
  const button = q(view, ".slate-timeline__list .slate-timeline__member[data-key='A:0'] [data-slate-control='pump']");
  assert.equal(button.getAttribute("data-able"), "true");
  click(button);
  assert.deepEqual(commands.calls, [{ command: "setPumpOff", args: { recipe: "current", layer: "A", index: 0, pumpOff: true } }]);
  assert.equal(committed.length, 1);
  view.update(withChangeover(NOW, 4, snap => { snap.layers[0].hoppers[0].pumpOff = true; }));
  assert.equal(qa(view, ".slate-timeline__done .slate-timeline__member").map(row => row.getAttribute("data-key")).includes("A:0"), true);
  assert.equal(q(view, ".slate-timeline__list .slate-timeline__member[data-key='A:0']"), null);
  // Off, the row no longer carries the mark it had in the list.
  assert.equal(q(view, ".slate-timeline__done .slate-timeline__member[data-key='A:0']").getAttribute("title"), null);

  const focusMe = q(view, ".slate-timeline__list .slate-timeline__member[data-key='B:0'] [data-slate-control='pump']");
  focusMe.focus();
  const first = q(view, ".slate-timeline__list .slate-timeline__member");
  const wasAt = q(view, ".slate-timeline__list .slate-timeline__member[data-key='B:0'] .slate-timeline__member-at").textContent;
  setNow(NOW + 10 * MINUTE);
  timers.advance(1000);
  assert.ok(q(view, ".slate-timeline__list .slate-timeline__member") === first, "the tick re-appended the rows");
  assert.notEqual(q(view, ".slate-timeline__list .slate-timeline__member[data-key='B:0'] .slate-timeline__member-at").textContent, wasAt);
  assert.ok(doc.activeElement === focusMe);
});

test("a hurried double tap on Pump off is one tap: a finger's second tap on the same pill within 400 ms is spent, a later one goes - and a mouse's second click always goes", () => {
  const { view, commands } = boot({ height: 700 });
  view.update(withChangeover(NOW, 4));
  const first = q(view, ".slate-timeline__member[data-key='A:0'] [data-slate-control='pump']");
  click(first, { timeStamp: 1000, pointerType: "touch" });
  click(first, { timeStamp: 1200, pointerType: "touch" });
  assert.equal(commands.calls.length, 1, "the double tap sent off and on again");
  click(first, { timeStamp: 1700, pointerType: "touch" });
  assert.equal(commands.calls.length, 2, "a deliberate second tap was swallowed");

  const mouse = boot({ height: 700 });
  mouse.view.update(withChangeover(NOW, 4));
  const pill = q(mouse.view, ".slate-timeline__member[data-key='A:0'] [data-slate-control='pump']");
  click(pill, { timeStamp: 1000, pointerType: "mouse" });
  click(pill, { timeStamp: 1100, pointerType: "mouse" });
  assert.equal(mouse.commands.calls.length, 2, "a mouse's quick second click was swallowed");
});

test("on a phone a hopper's No weight chip opens Weights; elsewhere, and for any other reason, a chip is only words", () => {
  const opened = [];
  const noWeight = snap => { snap.layers[2].hoppers[1].effectiveWeight = 0; };
  const phone = boot({ height: 700, tier: () => ({ input: "touch", width: "phone" }), openWeights: () => opened.push("weights") });
  phone.view.update(withChangeover(NOW, 2, noWeight));
  const chip = q(phone.view, ".slate-timeline__chip.is-unavailable");
  assert.equal(chip.textContent, "C2 · No weight");
  assert.ok(chip.hasAttribute("data-slate-weights"));
  click(chip);
  assert.deepEqual(opened, ["weights"]);
  const tablet = boot({ height: 700, tier: () => ({ input: "touch", width: "narrow" }), openWeights: () => opened.push("tablet") });
  tablet.view.update(withChangeover(NOW, 2, noWeight));
  click(q(tablet.view, ".slate-timeline__chip.is-unavailable"));
  assert.deepEqual(opened, ["weights"], "a chip off a phone opened Weights");
  // Another reason names no page.
  const other = boot({ height: 700, tier: () => ({ input: "touch", width: "phone" }), openWeights: () => opened.push("other") });
  other.view.update(withChangeover(NOW, 2, snap => { snap.job.lineRate = 0; }));
  const chips = qa(other.view, ".slate-timeline__chip.is-unavailable");
  assert.ok(chips.length > 0);
  assert.ok(chips.every(one => !one.hasAttribute("data-slate-weights")));
});

test("the pump-off alarm's switch is offered only where the application says how it stands and offers the command; a tap asks for the opposite, read-only or not", () => {
  const commands = makeCommands({ capabilities: ["setPumpOff", "setHopperTracking", "resetTracking", "setTimelineAlarm"] });
  const { view, committed } = boot({ height: 700, commands, readOnly: true });
  const button = q(view, ".slate-timeline__alarm");
  view.update(withChangeover(NOW, 2));
  assert.ok(button.hasAttribute("hidden"), "offered with no word from the application");
  view.update(withChangeover(NOW, 2, snap => { snap.alarm = { enabled: false }; }));
  assert.ok(!button.hasAttribute("hidden"));
  assert.equal(button.getAttribute("role"), "switch");
  assert.equal(button.getAttribute("aria-checked"), "false");
  click(button);
  assert.deepEqual(commands.calls, [{ command: "setTimelineAlarm", args: { enabled: true } }], "read-only held back the device's own alarm");
  assert.equal(committed.length, 1);
  view.update(withChangeover(NOW, 2, snap => { snap.alarm = { enabled: true }; }));
  assert.equal(button.getAttribute("aria-checked"), "true");
  click(button);
  assert.deepEqual(commands.calls[1], { command: "setTimelineAlarm", args: { enabled: false } });
  // Without the command, no switch.
  const old = boot({ height: 700 });
  old.view.update(withChangeover(NOW, 2, snap => { snap.alarm = { enabled: true }; }));
  assert.ok(q(old.view, ".slate-timeline__alarm").hasAttribute("hidden"));
});
