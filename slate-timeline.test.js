"use strict";

/* slate-timeline.js: the right pane's vertical timeline - the projection
 * (the application's own arithmetic), the anchors, the clock, the cards
 * down the axis, and Pump off / Back on through the tracking seam. */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

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
    openWeights: settings.openWeights,
    weightProfiles: settings.weightProfiles,
    lastWeightProfile: settings.lastWeightProfile
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

test("a usable changeover fits the axis: the mark stands at its instant, Scaled is lit, every tracked hopper is a member somewhere", () => {
  const { view, axis } = boot({ height: 700 });
  const placed = view.update(withChangeover(NOW, 4));
  assert.equal(view.element.getAttribute("data-mode"), "fit");
  const window = view.getWindow();
  assert.equal(window.windowMs, 4 * HOUR * 1.1);
  // The scale stays on offer, with Scaled lit and no hours echoed - it is
  // fitting a changeover, not standing at a span.
  assert.ok(!q(view, ".slate-timeline__scale-row").hasAttribute("hidden"));
  assert.equal(q(view, "[data-window='scaled']").getAttribute("aria-pressed"), "true");
  assert.equal(qa(view, "[data-standing]").length, 0);
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
  // Only the "ran out early" panel, hidden until asked for, stands ahead of the rows.
  const footChildren = q(view, ".slate-timeline__done").children;
  assert.deepEqual(footChildren.map(node => node.getAttribute("class")), ["slate-timeline__correct", "slate-timeline__done-list"]);
  assert.ok(footChildren[0].hasAttribute("hidden"));
  assert.equal(off.querySelector(".slate-toggle__label").textContent, "Back on");
  assert.equal(off.querySelector("[data-slate-control]").getAttribute("aria-pressed"), "true");
  // Cards: each event's dot at the instant, the card at its placed y.
  for (const card of placed.cards) {
    const el = q(view, `.slate-timeline__event[data-group='${card.group.members.map(m => m.key).join("+")}']`);
    assert.ok(el, "an event has no element");
    assert.equal(topOf(el) + topOf(el.querySelector(".slate-timeline__dot")), Math.round(card.y0 * 10) / 10);
    assert.equal(topOf(el) + topOf(el.querySelector(".slate-timeline__card")), Math.round(card.y * 10) / 10);
    assert.equal(el.querySelector(".slate-timeline__card").classList.contains("is-group"), card.group.members.length > 1);
    // The head says only when (the words are its title): the minute, or a group's span.
    const when = el.querySelector(".slate-timeline__when");
    assert.match(when.textContent, /^\d{1,2}:\d{2}(–\d{1,2}:\d{2})?( [AP]M)? · (in |now)/);
    assert.match(when.getAttribute("title"), card.group.members.length > 1 ? /^pump off (by |)\S/ : /^pump off by \d/);
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
  // Without a changeover a card marks when the hopper runs empty, and says so in a word.
  assert.match(q(view, ".slate-timeline__event .slate-timeline__when").textContent, /^empty \d/);
  assert.match(q(view, ".slate-timeline__event .slate-timeline__when").getAttribute("title"), /^empty (at )?\d/);
  const later = qa(view, ".slate-timeline__chip.is-later");
  assert.equal(later.length, 1);
  assert.match(later[0].textContent, /^B1 → 17h/);
  assert.equal(qa(view, "[data-slate-control='pump']").length, 1, "a chip is not a card: no toggle beyond the horizon");

  // Scaled with no changeover to fit stands at six hours and says so.
  assert.equal(q(view, "[data-window='scaled']").getAttribute("aria-pressed"), "true");
  assert.equal(q(view, "[data-window='6']").getAttribute("data-standing"), "true");
  assert.equal(q(view, "[data-window='12']").getAttribute("data-standing"), null);

  click(q(view, "[data-window='12']"));
  assert.equal(view.getWindow().windowMs, 12 * HOUR);
  assert.equal(q(view, "[data-window='12']").getAttribute("aria-pressed"), "true");
  assert.equal(q(view, "[data-window='6']").getAttribute("aria-pressed"), "false");
  assert.equal(q(view, "[data-window='scaled']").getAttribute("aria-pressed"), "false");
  assert.equal(qa(view, "[data-standing]").length, 0, "a chosen span echoes nothing");
  assert.equal(view.element.getAttribute("data-scale"), "12");
  assert.equal(qa(view, ".slate-timeline__chip.is-later").length, 1, "17h is still beyond 12h");
  assert.equal(view.setWindow(9), 12, "an unknown scale was taken");
  assert.equal(view.setWindow("3"), 3, "the control's own attribute reads as a scale");
  assert.equal(view.getWindow().windowMs, 3 * HOUR);
  // Back to Scaled: with no changeover it stands at the last hours chosen.
  assert.equal(view.setWindow("scaled"), "scaled");
  assert.equal(view.getWindow().windowMs, 3 * HOUR);
  assert.equal(view.getWindow().fitted, false);
  assert.equal(q(view, "[data-window='3']").getAttribute("data-standing"), "true");
});

test("the scale offers three spans and Scaled; a chosen span is obeyed while the changeover is a mark on it or beyond its end", () => {
  const { view } = boot({ height: 700 });
  view.update(withChangeover(NOW, 4));
  const options = qa(view, "[data-window]");
  assert.deepEqual(options.map(option => option.getAttribute("data-window")), ["3", "6", "12", "scaled"]);
  assert.deepEqual(options.map(option => option.textContent), ["3H", "6H", "12H", "Scaled"]);
  assert.ok(q(view, "[data-window='scaled'] .slate-timeline__range-glyph"), "Scaled has its mark");
  assert.equal(view.element.getAttribute("data-scale"), "scaled");

  // 12H over a changeover four hours out: the axis is twelve hours and the
  // changeover a mark a third of the way down it, not the axis's end.
  click(q(view, "[data-window='12']"));
  assert.equal(view.element.getAttribute("data-mode"), "fixed");
  assert.equal(view.getWindow().windowMs, 12 * HOUR);
  const mark = q(view, ".slate-timeline__changeover");
  assert.ok(!mark.hasAttribute("hidden"), "the changeover is still on a fixed axis");
  const span = 700 - timelineModule.TOP_INSET - timelineModule.BOTTOM_INSET;
  assert.ok(Math.abs(topOf(mark) - (timelineModule.TOP_INSET + span / 3)) < 0.2, `changeover at ${mark.style.top}`);
  // Among the cards its time stands in the clock's gutter, wordless; the
  // word is the mark's title, and the head line above says it in full.
  const label = q(view, ".slate-timeline__changeover-label").textContent;
  assert.match(label, /^\d{1,2}:\d{2}/, `the changeover label is not a clock (${label})`);
  assert.doesNotMatch(label, /Changeover/);
  assert.match(mark.getAttribute("title"), /^Changeover \d/);

  // 3H: the changeover is past the end of the axis, so it is not on it.
  click(q(view, "[data-window='3']"));
  assert.equal(view.getWindow().windowMs, 3 * HOUR);
  assert.ok(q(view, ".slate-timeline__changeover").hasAttribute("hidden"), "a changeover beyond the axis was drawn on it");
  assert.ok(qa(view, ".slate-timeline__event").length > 0, "the cards due within three hours still stand");

  // And Scaled fits it again - the axis ends there, so the word comes back.
  click(q(view, "[data-window='scaled']"));
  assert.equal(view.element.getAttribute("data-mode"), "fit");
  assert.equal(view.getWindow().windowMs, 4 * HOUR * 1.1);
  assert.equal(view.scale(), "scaled");
  assert.match(q(view, ".slate-timeline__changeover-label").textContent, /^Changeover \d/);
});

test("a chosen span is shown whole: a card near its end is lifted to fit rather than stretching the axis, and every dot keeps its instant", () => {
  const { view, axis } = boot({ height: 700 });
  // A1 empty in about 20 minutes, B1 in about 2h 50m - the last mark at
  // 95% of a three-hour axis, where room for its card below it would ask
  // for an axis many times the pane's.
  view.update(resolvedAt(NOW, snap => {
    snap.job.changeoverTime = "";
    snap.job.changeoverSetAt = null;
    snap.job.lineRate = 100;
    for (const layer of snap.layers) for (const hopper of layer.hoppers) { hopper.track = false; hopper.pumpOff = false; }
    snap.layers[0].hoppers[0].track = true;   // A1: 15 lb/hr
    snap.layers[0].hoppers[0].effectiveWeight = 5;
    snap.layers[1].hoppers[0].track = true;   // B1: 35 lb/hr
    snap.layers[1].hoppers[0].effectiveWeight = 100;
  }));
  click(q(view, "[data-window='3']"));
  const placed = view.placed();
  const last = placed.cards[placed.cards.length - 1];
  assert.ok(last.group.fraction > 0.9, `the last card is not near the end (${last.group.fraction})`);
  assert.equal(axis.style.minHeight || "", "", "a chosen span grew the axis");
  assert.ok(!view.element.classList.contains("is-scrolling"));
  assert.ok(placed.cards.every(card => !card.group.merged && !card.clipped), "a card merged on a chosen span");
  assert.ok(last.displacement < 0, "the last card was not lifted to fit");
  for (const card of placed.cards) assert.ok(Math.abs(card.y0 - (timelineModule.TOP_INSET + card.group.fraction * placed.span)) < 1e-6, "a dot left its instant");
  // Scaled has no changeover to fit here, so it stands at three hours -
  // the hours last chosen - and the axis stays as it is.
  click(q(view, "[data-window='scaled']"));
  assert.equal(view.element.getAttribute("data-mode"), "fixed");
  assert.equal(view.getWindow().windowMs, 3 * HOUR);
  assert.equal(q(view, "[data-window='3']").getAttribute("data-standing"), "true");
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
  // A group's head says its minutes - one clock, or the span - not a count; the rows show that.
  // A group's head says its minutes - one clock, or the span - not a count; the rows show that.
  assert.match(card.querySelector(".slate-timeline__when").textContent, /^\d{1,2}:\d{2}(–\d{1,2}:\d{2})?( [AP]M)? · in /);
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
  // The axis and its window: a grown axis keeps its height while the window changes.
  assert.equal(observed.length, 2);
  assert.ok(observed.includes(sized.axis) && observed.some(node => node.getAttribute("class") === "slate-timeline__viewport"));
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
  assert.ok(q(view, ".slate-timeline__scale-row").hasAttribute("hidden"));
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
    // The list's titles go; only a group's rows keep one - their own clock, which the head gives as a span.
    const inGroup = !!row.closest(".slate-timeline__card.is-group");
    if (inGroup) assert.match(row.getAttribute("title"), /^[A-Z]\d+ (pump off by|empty at) \d/);
    else assert.equal(row.getAttribute("title"), null);
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

test("under a finger a row says what goes into its hopper next where the plan changes it, and its pill says Pump off; with a mouse the row and the pill are as they were", () => {
  const plan = snap => {
    snap.nextRecipe = { layers: snap.layers.map(layer => ({ name: layer.name, layerPct: layer.layerPct, hoppers: layer.hoppers.map(h => ({ index: h.index, pct: h.pct, resinName: h.resinName })) })) };
    snap.nextRecipe.layers[0].hoppers[0].resinName = "ZZ9";
  };
  const touch = boot({ height: 700, tier: () => ({ input: "touch", width: "phone" }) });
  touch.view.update(withChangeover(NOW, 5, plan));
  const rows = qa(touch.view, ".slate-timeline__member");
  const a1 = rows.find(one => one.getAttribute("data-key") === "A:0");
  assert.ok(a1, "A1 is not on the timeline");
  const next = a1.querySelector(".slate-timeline__member-next");
  assert.ok(!next.hasAttribute("hidden"));
  assert.equal(next.textContent, "→ ZZ9");
  const others = rows.filter(one => one !== a1).map(one => one.querySelector(".slate-timeline__member-next"));
  assert.ok(others.every(one => one.hasAttribute("hidden")), "a hopper the plan keeps named a next resin");
  const running = rows.find(one => !one.classList.contains("is-off"));
  assert.equal(running.querySelector(".slate-toggle__label").textContent, "Pump off");
  const mouse = boot({ height: 700 });
  mouse.view.update(withChangeover(NOW, 5, plan));
  const mouseRow = qa(mouse.view, ".slate-timeline__member").find(one => !one.classList.contains("is-off"));
  assert.equal(mouseRow.querySelector(".slate-toggle__label").textContent, "Off");
  // The sheet shows the next resin on a phone alone: a tablet's aside is
  // too narrow for it beside the resin and the time.
  const css = fs.readFileSync(path.join(__dirname, "slate", "styles", "components", "timeline.css"), "utf8");
  assert.match(css, /\.slate-root\[data-input="touch"\]\[data-viewport="phone"\] \.slate-timeline__member-next:not\(\[hidden\]\) \{\n  display: inline;/);
  assert.doesNotMatch(css, /\.slate-root\[data-input="touch"\] \.slate-timeline__member-next/);
});

test("on a phone the late block stands above the Now line and the scale starts under it, so nothing lies over the changeover however many are late; the axis takes the height all of it needs; elsewhere the late block pins under Now as before", () => {
  const late = snap => { for (const layer of snap.layers) for (const hopper of layer.hoppers) hopper.track = !!hopper.resinName; };
  const topOfPx = node => Number(String(node.style.top).replace("px", ""));
  const phone = boot({ height: 300, tier: () => ({ input: "touch", width: "phone" }) });
  phone.view.update(withChangeover(NOW, 1, late));
  const q = selector => phone.view.element.querySelector(selector);
  const pinned = q(".slate-timeline__pinned");
  assert.ok(!pinned.hasAttribute("hidden"), "nothing is late in this job");
  const pinnedBottom = topOfPx(pinned) + timelineModule.cardHeight(Object.assign({ pinned: true }, { members: q(".slate-timeline__pinned").querySelectorAll(".slate-timeline__member") }));
  const nowTop = topOfPx(q(".slate-timeline__now"));
  assert.ok(nowTop >= pinnedBottom, `Now (${nowTop}) runs through the late block (to ${pinnedBottom})`);
  const changeover = q(".slate-timeline__changeover");
  if (!changeover.hasAttribute("hidden")) assert.ok(topOfPx(changeover) > nowTop, "the changeover stands above Now");
  const placed = phone.view.placed();
  for (const card of placed.cards) assert.ok(card.y >= nowTop, "a card stands above Now");
  if (!changeover.hasAttribute("hidden")) {
    const last = placed.cards[placed.cards.length - 1];
    if (last) assert.ok(last.y + last.height <= topOfPx(changeover) + 1, `the last card (to ${last.y + last.height}) runs over the changeover (${topOfPx(changeover)})`);
  }
  const need = Number(String(q(".slate-timeline__axis").style.minHeight).replace("px", ""));
  assert.ok(need >= nowTop + placed.cards.reduce((sum, card) => sum + card.height, 0), "the axis is shorter than its cards");
  // Elsewhere: pinned under Now, the axis the pane's.
  const tablet = boot({ height: 300, tier: () => ({ input: "touch", width: "narrow" }) });
  tablet.view.update(withChangeover(NOW, 1, late));
  const tq = selector => tablet.view.element.querySelector(selector);
  assert.equal(tq(".slate-timeline__axis").style.minHeight || "", "", "a tablet's axis grew");
  assert.equal(topOfPx(tq(".slate-timeline__now")), timelineModule.TOP_INSET);
  assert.ok(topOfPx(tq(".slate-timeline__pinned")) > timelineModule.TOP_INSET);
});

/* ----------------------------------------------------------------------
 *   A short window: the axis grows and scrolls rather than merge
 * -------------------------------------------------------------------- */

test("on a desktop a window too short for the cards grows the axis past it - the Timeline scrolls - so no card merges; a tall window fits as before; a phone keeps its page", () => {
  const short = boot({ height: 200 });
  short.view.update(withChangeover(NOW, 4));
  const placed = short.view.placed();
  assert.ok(placed.cards.length > 0);
  assert.ok(placed.cards.every(card => !card.group.merged && !card.clipped), "a card merged on a short window");
  const grown = Number(String(short.axis.style.minHeight).replace("px", ""));
  assert.ok(grown > 200, "the axis did not grow past its window");
  assert.ok(short.view.element.classList.contains("is-scrolling"));
  assert.ok(short.axis.parentNode.getAttribute("class") === "slate-timeline__viewport", "the axis has no window to scroll in");
  // Every dot at its instant on the grown scale.
  for (const card of placed.cards) assert.ok(Math.abs(card.y0 - (timelineModule.TOP_INSET + card.group.fraction * placed.span)) < 1e-6);

  const tall = boot({ height: 1200 });
  tall.view.update(withChangeover(NOW, 4));
  assert.equal(tall.axis.style.minHeight || "", "", "a tall window's axis grew");
  assert.ok(!tall.view.element.classList.contains("is-scrolling"));
  assert.equal(tall.view.placed().span, 1200 - timelineModule.TOP_INSET - timelineModule.CHANGEOVER_INSET);

  // The list view hides the window with the axis.
  short.setTimelineView("list");
  short.view.refresh();
  assert.ok(short.axis.parentNode.hasAttribute("hidden"));
});

test("the sheet: the axis's window scrolls on a desktop or a tablet, and on a phone is only as tall as the axis, the page scrolling", () => {
  const css = require("node:fs").readFileSync(require("node:path").join(__dirname, "slate/styles/components/timeline.css"), "utf8");
  assert.match(css, /\n\.slate-timeline__viewport \{[^}]*min-height: 0;[^}]*overflow-y: auto;/);
  assert.match(css, /\.slate-timeline__axis \{\s*position: relative;\s*flex: 1 0 auto;/);
  assert.match(css, /\.slate-root\[data-input="touch"\]\[data-viewport="phone"\] \.slate-timeline__viewport \{\s*flex: none;\s*overflow: visible;/);
});

test("no scrollbar: the window marks the edge where more continues - below at the top, both midway, above at the end - and the sheet fades that edge and gives the clock's labels their room", () => {
  const { view } = boot({ height: 200 });
  view.update(withChangeover(NOW, 4));
  const viewport = q(view, ".slate-timeline__viewport");
  const scrollTo = top => { viewport.scrollTop = top; viewport.dispatchEvent({ type: "scroll", target: viewport }); };
  viewport.clientHeight = 200;
  viewport.scrollHeight = 600;
  scrollTo(0);
  assert.ok(!viewport.hasAttribute("data-more-above") && viewport.hasAttribute("data-more-below"));
  scrollTo(200);
  assert.ok(viewport.hasAttribute("data-more-above") && viewport.hasAttribute("data-more-below"));
  scrollTo(400);
  assert.ok(viewport.hasAttribute("data-more-above") && !viewport.hasAttribute("data-more-below"));
  viewport.scrollHeight = 200;
  scrollTo(0);
  assert.ok(!viewport.hasAttribute("data-more-above") && !viewport.hasAttribute("data-more-below"), "a window with nothing hidden fades an edge");

  const css = require("node:fs").readFileSync(require("node:path").join(__dirname, "slate/styles/components/timeline.css"), "utf8");
  assert.match(css, /\n\.slate-timeline__viewport \{[^}]*margin-left: calc\(-1 \* var\(--slate-space-3\)\);\s*padding-left: var\(--slate-space-3\);[^}]*scrollbar-width: none;/);
  // The cards' right border is kept off the clip.
  assert.match(css, /\n\.slate-timeline__viewport \{[^}]*margin-right: calc\(-1 \* var\(--slate-space-1\)\);\s*padding-right: var\(--slate-space-1\);/);
  assert.match(css, /\.slate-timeline__viewport::-webkit-scrollbar \{\s*display: none;/);
  assert.match(css, /\.slate-timeline__viewport\[data-more-below\] \{\s*mask-image:/);
  assert.match(css, /\.slate-timeline__viewport\[data-more-above\] \{\s*mask-image:/);
  assert.match(css, /\.slate-timeline__viewport\[data-more-above\]\[data-more-below\] \{\s*mask-image:/);
  assert.match(css, /\.slate-timeline__done \{[^}]*scrollbar-width: none;/);
  // The foot's pills are kept off its clip, as the cards are off the axis window's.
  assert.match(css, /\.slate-timeline__done \{[^}]*margin-right: calc\(-1 \* var\(--slate-space-1\)\);\s*padding-right: var\(--slate-space-1\);/);
  assert.match(css, /\.slate-timeline__done::-webkit-scrollbar \{\s*display: none;/);
});

test("each card's leader curves from its own dot to the card's top corner, every one with the same handles, so no two cross; the axis line is drawn over them and the dots over it", () => {
  const M = timelineModule;
  const parse = d => d.match(/-?\d+(\.\d+)?/g).map(Number);
  const [mx, my, c1x, c1y, c2x, c2y, ex, ey] = parse(M.leaderFor(100, 180).d);
  assert.deepEqual([mx, my], [M.DOT_X, 100], "a leader does not leave its dot");
  assert.deepEqual([ex, ey], [M.CARD_LEFT, 180 + M.LEADER_INTO], "a leader does not reach its card's corner");
  // Leaving and entering to the right: the handles level with each end, the same for every leader.
  assert.equal(c1y, 100);
  assert.equal(c2y, ey);
  assert.equal(c1x - M.DOT_X, M.CARD_LEFT - c2x);

  const { view } = boot({ height: 200 });
  view.update(withChangeover(NOW, 4));
  const events = qa(view, ".slate-timeline__event");
  assert.ok(events.length >= 2);
  assert.equal(qa(view, ".slate-timeline__stem").length, 0, "the stem on the axis is still drawn");
  const bezierY = (p, t) => { const u = 1 - t; return u * u * u * p[1] + 3 * u * u * t * p[3] + 3 * u * t * t * p[5] + t * t * t * p[7]; };
  const curves = events.map(el => {
    const base = topOf(el);
    const path = el.querySelector(".slate-timeline__leader-path");
    const p = parse(path.getAttribute("d"));
    assert.equal(p[1], topOf(el.querySelector(".slate-timeline__dot")), "a leader does not start at its dot");
    return { base, p };
  });
  // Sampled along their length, each leader stays below the one before it.
  for (let i = 1; i < curves.length; i += 1) {
    for (let t = 0; t <= 1.0001; t += 0.05) {
      assert.ok(curves[i].base + bezierY(curves[i].p, t) > curves[i - 1].base + bezierY(curves[i - 1].p, t), `two leaders cross at t=${t.toFixed(2)}`);
    }
  }

  const css = require("node:fs").readFileSync(require("node:path").join(__dirname, "slate/styles/components/timeline.css"), "utf8");
  const rule = selector => { const at = css.indexOf(`${selector} {`); assert.ok(at > -1, `no rule for ${selector}`); return css.slice(at, css.indexOf("}", at)); };
  const dot = rule(".slate-timeline__dot");
  assert.equal(Number(dot.match(/left: (\d+)px/)[1]) + Number(dot.match(/width: (\d+)px/)[1]) / 2, M.DOT_X);
  assert.match(rule(".slate-timeline__card"), new RegExp(`left: ${M.CARD_LEFT}px;`));
  assert.match(rule(".slate-timeline__pinned"), new RegExp(`left: ${M.CARD_LEFT}px;`));
  // The line over the leaders, the dots over the line.
  assert.match(rule(".slate-timeline__rail"), /z-index: 1;/);
  assert.match(dot, /z-index: 2;/);
});


test("a group's head says its minutes - one clock when they share one, the span otherwise - so its rows drop their clock for the resin; each row's own clock is its title", () => {
  const { view } = boot({ height: 1200 });
  view.update(withChangeover(NOW, 4));
  const group = qa(view, ".slate-timeline__card.is-group")[0];
  assert.ok(group, "the demo has no group");
  const head = group.querySelector(".slate-timeline__when").textContent;
  assert.match(head, /^(\S+( [AP]M)?|\S+–\S+( [AP]M)?) · in /);
  assert.doesNotMatch(head, /hoppers|pump off/);
  assert.match(group.querySelector(".slate-timeline__when").getAttribute("title"), /^pump off (by )?\d/);
  for (const row of group.querySelectorAll(".slate-timeline__member")) assert.match(row.getAttribute("title"), /pump off by \d/);
  const css = require("node:fs").readFileSync(require("node:path").join(__dirname, "slate/styles/components/timeline.css"), "utf8");
  assert.match(css, /\.slate-timeline__card:not\(\.is-pinned\) \.slate-timeline__member-at \{\s*display: none;/);
  assert.doesNotMatch(css, /:not\(\.is-group\):not\(\.is-pinned\) \.slate-timeline__member-at/);
});

/* ----------------------------------------------------------------------
 *   Ran out early: correct the stored weight
 * -------------------------------------------------------------------- */

/* B2 (B:1) is pumped off in the demo: 260 lb at 85 lb/hr (850 x 50% x 20%). */
const pumpedAt = (minutesAgo, mutate) => withChangeover(NOW, 4, snap => {
  snap.layers[1].hoppers[1].pumpOffAt = NOW - minutesAgo * 60 * 1000;
  if (mutate) mutate(snap);
});

function makeProfileBridge(options) {
  const settings = options || {};
  const requests = [];
  return {
    requests,
    isConnected: () => true,
    capabilities: () => ["saveCurrentWeights", "replaceWeightProfile", "loadWeightProfile", "renameWeightProfile", "duplicateWeightProfile", "deleteWeightProfile", "refresh"],
    getBook: () => ({ assigned: true, workspace: { id: "ws-1", displayName: "Line 5" }, refreshing: false, profiles: [{ id: "p1", name: "Standard", layers: [] }, { id: "p2", name: "Heavy", layers: [] }], count: 2 }),
    subscribe: () => () => {},
    async request(action, args) { requests.push({ action, args }); return settings.answer || { ok: true }; }
  };
}

const ALL_WEIGHTS = ["setPumpOff", "setHopperTracking", "resetTracking", "setHopperWeight", "setHopperGeometry"];

test("Ran out on a pumped-off row opens the correction with the recorded pump-off time and now; it previews the stored weight the run-down measured; opening and cancelling change nothing", () => {
  const commands = makeCommands({ capabilities: ALL_WEIGHTS });
  const { view } = boot({ height: 1200, commands });
  view.update(pumpedAt(60));
  const row = q(view, ".slate-timeline__done .slate-timeline__member[data-key='B:1']");
  assert.ok(row, "B2 is not in the foot");
  const ranOut = row.querySelector("[data-slate-ranout]");
  assert.equal(ranOut.textContent, "Ran out", "an ellipsis reads as text cut off in the narrow row");
  // Only the foot offers it: the sheet hides it on a running hopper's row.
  const css = require("node:fs").readFileSync(require("node:path").join(__dirname, "slate/styles/components/timeline.css"), "utf8");
  assert.match(css, /\n\.slate-timeline__ranout \{\s*display: none;/);
  assert.match(css, /\n\.slate-timeline__done \.slate-timeline__ranout \{\s*display: inline-block;/);
  click(ranOut);
  const panel = q(view, ".slate-timeline__correct");
  assert.ok(!panel.hasAttribute("hidden"));
  assert.equal(q(view, "[data-slate-runout='off']").value, "07:00", "not the recorded pump-off time");
  assert.equal(q(view, "[data-slate-runout='out']").value, "08:00", "not now");
  // Fed 1h of an expected 3h 04m at 85 lb/hr: 85 lb, exactly what it fed.
  const correction = view.correction();
  assert.equal(correction.ok, true);
  assert.equal(correction.target, "weight");
  assert.equal(correction.from, 260);
  assert.equal(correction.to, 85);
  assert.match(q(view, ".slate-timeline__correct-change").textContent, /Receiver weight: 260 lb → 85 lb/);
  assert.match(q(view, ".slate-timeline__correct-fed").textContent, /^Fed 1h 00m of an expected 3h 0\dm \(67% short\)\.$/);
  assert.equal(commands.calls.length, 0, "opening the correction sent something");
  click(q(view, "[data-slate-runout='cancel']"));
  assert.ok(panel.hasAttribute("hidden"));
  assert.equal(commands.calls.length, 0, "cancelling sent something");
});

test("Apply sends ONE setHopperWeight with the corrected weight and, when a profile is chosen - the last one loaded, by default - updates it; the times can be corrected first", async () => {
  const commands = makeCommands({ capabilities: ALL_WEIGHTS });
  const weightProfiles = makeProfileBridge();
  const { view, said, committed } = boot({ height: 1200, commands, weightProfiles, lastWeightProfile: () => "p2" });
  view.update(pumpedAt(60));
  click(q(view, ".slate-timeline__done [data-slate-ranout='B:1']"));
  const select = q(view, "[data-slate-runout='profile']");
  assert.equal(select.value, "p2", "the last loaded profile is not offered");
  assert.deepEqual(select.querySelectorAll("option").map(option => option.getAttribute("value")), ["", "p1", "p2"]);
  // It went off at 6:30, not as recorded: 1h 30m fed at 85 lb/hr is 127.5 lb.
  const off = q(view, "[data-slate-runout='off']");
  off.value = "06:30";
  off.dispatchEvent({ type: "input", target: off });
  assert.equal(view.correction().to, 127.5);
  click(q(view, "[data-slate-runout='apply']"));
  assert.equal(commands.calls.length, 0, "the first press applied without asking");
  click(q(view, "[data-slate-runout='apply']"));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(commands.calls, [{ command: "setHopperWeight", args: { recipe: "current", layer: "B", index: 1, weight: 127.5 } }]);
  assert.equal(committed.length, 1);
  assert.deepEqual(weightProfiles.requests, [{ action: "replaceWeightProfile", args: { id: "p2" } }]);
  assert.ok(q(view, ".slate-timeline__correct").hasAttribute("hidden"));
  assert.match(said[said.length - 1], /^B2: receiver weight is now 127\.5 lb\. “Heavy” was updated/);
});

test("with Smart Hoppers computing B2's weight the correction goes to its usable height, one setHopperGeometry; not early, read-only or refused say so and change nothing", async () => {
  const smart = snap => {
    snap.smartHoppers = { enabled: true, geometryMode: "cylindrical", circumference: 30 };
    const b2 = snap.layers[1].hoppers[1];
    b2.usableHeight = 48;
    b2.smartWeight = { value: 260, bulkDensity: 44, resinCode: "HD622" };
    b2.effectiveWeight = 260;
  };
  const commands = makeCommands({ capabilities: ALL_WEIGHTS });
  const { view } = boot({ height: 1200, commands });
  view.update(pumpedAt(60, smart));
  click(q(view, ".slate-timeline__done [data-slate-ranout='B:1']"));
  const correction = view.correction();
  assert.equal(correction.target, "geometry");
  assert.equal(correction.from, 48);
  assert.equal(correction.to, 15.7);
  assert.match(q(view, ".slate-timeline__correct-change").textContent, /Usable height \(Smart Hoppers\): 48 in → 15\.7 in/);
  click(q(view, "[data-slate-runout='apply']"));
  click(q(view, "[data-slate-runout='apply']"));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(commands.calls, [{ command: "setHopperGeometry", args: { recipe: "current", layer: "B", index: 1, dimension: "height", value: 15.7 } }]);

  // Not early: it fed longer than expected.
  const late = boot({ height: 1200, commands: makeCommands({ capabilities: ALL_WEIGHTS }) });
  late.view.update(pumpedAt(240));
  click(q(late.view, ".slate-timeline__done [data-slate-ranout='B:1']"));
  assert.equal(late.view.correction().reason, "not-early");
  assert.equal(q(late.view, "[data-slate-runout='apply']").getAttribute("data-able"), "false");
  click(q(late.view, "[data-slate-runout='apply']"));
  assert.equal(late.commands.calls.length, 0);
  assert.match(late.said[late.said.length - 1], /nothing to correct/);

  // Read-only: withheld with the reason.
  const locked = boot({ height: 1200, readOnly: true, commands: makeCommands({ capabilities: ALL_WEIGHTS }) });
  locked.view.update(pumpedAt(60));
  click(q(locked.view, ".slate-timeline__done [data-slate-ranout='B:1']"));
  assert.equal(q(locked.view, "[data-slate-runout='apply']").getAttribute("data-able"), "false");
  assert.match(q(locked.view, "[data-slate-runout='apply']").getAttribute("title"), /read-only/i);

  // A refusal keeps the panel open with the application's words.
  const refusing = boot({ height: 1200, commands: makeCommands({ capabilities: ALL_WEIGHTS, answer: () => ({ ok: false, code: "bad_argument", message: "No such hopper." }) }) });
  refusing.view.update(pumpedAt(60));
  click(q(refusing.view, ".slate-timeline__done [data-slate-ranout='B:1']"));
  click(q(refusing.view, "[data-slate-runout='apply']"));
  click(q(refusing.view, "[data-slate-runout='apply']"));
  assert.ok(!q(refusing.view, ".slate-timeline__correct").hasAttribute("hidden"));
  assert.equal(q(refusing.view, ".slate-timeline__correct-note").textContent, "No such hopper.");
});

test("Ran out asks before it corrects: the first Apply arms Confirm and sends nothing; a changed time, Cancel or the wait stands it down; only Confirm applies", async () => {
  const commands = makeCommands({ capabilities: ALL_WEIGHTS });
  const { view, said, timers } = boot({ height: 1200, commands });
  view.update(pumpedAt(60));
  click(q(view, ".slate-timeline__done [data-slate-ranout='B:1']"));
  const apply = q(view, "[data-slate-runout='apply']");
  assert.equal(apply.textContent, timelineModule.RANOUT_APPLY_LABEL);
  click(apply);
  assert.equal(commands.calls.length, 0, "the first press applied");
  assert.ok(apply.hasAttribute("data-armed"));
  assert.equal(apply.textContent, timelineModule.RANOUT_CONFIRM_LABEL);
  assert.match(said[said.length - 1], /^Press Confirm to apply: .*260 lb → 85 lb/);

  // The wait stands it down.
  timers.advance(timelineModule.RANOUT_ARM_MS);
  assert.ok(!apply.hasAttribute("data-armed"));
  assert.equal(apply.textContent, timelineModule.RANOUT_APPLY_LABEL);
  click(apply);
  assert.equal(commands.calls.length, 0, "a press after the wait applied without asking again");

  // A changed time changes what would be applied: it asks again.
  const out = q(view, "[data-slate-runout='out']");
  out.value = "07:30";
  out.dispatchEvent({ type: "input", target: out });
  assert.ok(!apply.hasAttribute("data-armed"), "a changed time kept Confirm armed");
  click(apply);

  // Cancel stands it down, and reopening starts at Apply.
  click(q(view, "[data-slate-runout='cancel']"));
  click(q(view, ".slate-timeline__done [data-slate-ranout='B:1']"));
  assert.ok(!apply.hasAttribute("data-armed"));
  assert.equal(apply.textContent, timelineModule.RANOUT_APPLY_LABEL);
  assert.equal(commands.calls.length, 0);

  const pending = timers.pending();
  click(apply);
  assert.equal(timers.pending(), pending + 1, "arming set no timer");
  click(apply);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(commands.calls.length, 1);
  assert.equal(commands.calls[0].command, "setHopperWeight");
  assert.equal(timers.pending(), pending, "the arm timer outlived the Confirm");

  const css = require("node:fs").readFileSync(require("node:path").join(__dirname, "slate/styles/components/timeline.css"), "utf8");
  assert.match(css, /\.slate-timeline__correct-button--apply\[data-armed\] \{[^}]*--slate-warning/);
});

test("without a recorded pump-off time the planned one is offered; the correction closes when the hopper goes back on", () => {
  const { view } = boot({ height: 1200, commands: makeCommands({ capabilities: ALL_WEIGHTS }) });
  view.update(withChangeover(NOW, 4));
  click(q(view, ".slate-timeline__done [data-slate-ranout='B:1']"));
  const off = q(view, "[data-slate-runout='off']");
  assert.match(off.getAttribute("title"), /planned pump-off time/);
  view.update(withChangeover(NOW, 4, snap => { snap.layers[1].hoppers[1].pumpOff = false; }));
  assert.ok(q(view, ".slate-timeline__correct").hasAttribute("hidden"), "a correction stayed open for a hopper back on");
  assert.equal(view.correction(), null);
});

test("neighbouring events - the only leaders that can run side by side - alternate colours down the axis: the accent, then the theme's foreground, for the dot, the leader and the card's edge", () => {
  const { view } = boot({ height: 200 });
  view.update(withChangeover(NOW, 4));
  const leads = qa(view, ".slate-timeline__event").map(el => el.getAttribute("data-lead"));
  assert.ok(leads.length >= 2);
  leads.forEach((lead, index) => assert.equal(lead, index % 2 ? "alt" : "main", `event ${index} breaks the alternation`));
  const css = require("node:fs").readFileSync(require("node:path").join(__dirname, "slate/styles/components/timeline.css"), "utf8");
  const rule = selector => { const at = css.indexOf(`${selector} {`); assert.ok(at > -1, `no rule for ${selector}`); return css.slice(at, css.indexOf("}", at)); };
  assert.match(rule(".slate-timeline__event"), /--slate-lead: var\(--slate-accent\);/);
  assert.match(rule('.slate-timeline__event[data-lead="alt"]'), /--slate-lead: var\(--slate-text\);/);
  assert.match(rule(".slate-timeline__dot"), /background: var\(--slate-lead, var\(--slate-accent\)\);/);
  assert.match(rule(".slate-timeline__leader-path"), /stroke: color-mix\(in srgb, var\(--slate-lead, var\(--slate-accent\)\) 45%, transparent\);/);
  assert.match(rule(".slate-timeline__card"), /box-shadow: inset 3px 0 0 var\(--slate-lead, transparent\);/);
});

test("a card's head says only when - no 'pump off by' - so it fits its narrow card; the full words are its title", () => {
  const { view } = boot({ height: 1200 });
  view.update(withChangeover(NOW, 4));
  for (const when of qa(view, ".slate-timeline__events .slate-timeline__when")) {
    assert.doesNotMatch(when.textContent, /pump off/, "the head repeats what the Timeline says");
    assert.match(when.getAttribute("title"), /^pump off (by )?\d.* · (in |now)/);
    assert.ok(when.textContent.length <= 26, `"${when.textContent}" is longer than a card's head holds`);
  }
});

test("on a phone the Timeline leads with what to do next: the next group due - its time large, each hopper with a Pump off that goes the one way every pill goes; what is late comes first", () => {
  const phone = boot({ height: 700, tier: () => ({ input: "touch", width: "phone" }) });
  // A changeover far enough out that nothing is late yet.
  phone.view.update(withChangeover(NOW, 11));
  assert.equal(phone.view.grouped().overdue, null, "the job has something late");
  const next = phone.view.element.querySelector(".slate-timeline__next");
  assert.ok(!next.hasAttribute("hidden"), "a phone's Timeline does not say what is next");
  assert.equal(next.getAttribute("data-kind"), "next");
  assert.equal(next.querySelector(".slate-timeline__next-head").textContent, "Next - turn the pump off");
  assert.match(next.querySelector(".slate-timeline__next-when").textContent, / · in \d/);
  const first = phone.view.grouped().groups[0];
  const rows = next.querySelectorAll(".slate-timeline__next-row");
  assert.deepEqual(rows.map(row => row.getAttribute("data-key")), first.members.slice(0, 4).map(member => member.key));
  const button = rows[0].querySelector(".slate-timeline__next-pump");
  assert.equal(button.getAttribute("data-slate-control"), "pump", "the Next button is not a tracking control");
  assert.equal(button.getAttribute("data-able"), "true");
  click(button);
  assert.equal(phone.commands.calls.length, 1);
  assert.equal(phone.commands.calls[0].command, "setPumpOff");
  assert.equal(phone.commands.calls[0].args.pumpOff, true);
  assert.equal(`${phone.commands.calls[0].args.layer}:${phone.commands.calls[0].args.index}`, first.members[0].key);

  // Late first, in the danger's words.
  const late = boot({ height: 700, tier: () => ({ input: "touch", width: "phone" }) });
  late.view.update(withChangeover(NOW, 1, snap => { for (const layer of snap.layers) for (const hopper of layer.hoppers) hopper.track = !!hopper.resinName; }));
  const lateBlock = late.view.element.querySelector(".slate-timeline__next");
  assert.equal(lateBlock.getAttribute("data-kind"), "late");
  assert.equal(lateBlock.querySelector(".slate-timeline__next-head").textContent, "Late - turn the pump off");
  assert.match(lateBlock.querySelector(".slate-timeline__next-when").textContent, / late$/);
  assert.ok(lateBlock.querySelector(".slate-timeline__next-pump").classList.contains("is-late"));

  // A desktop or a tablet: nothing is drawn, and no control is added.
  for (const tier of [undefined, () => ({ input: "touch", width: "narrow" })]) {
    const other = boot({ height: 700, tier });
    other.view.update(withChangeover(NOW, 5));
    assert.ok(other.view.element.querySelector(".slate-timeline__next").hasAttribute("hidden"));
    assert.equal(other.view.element.querySelectorAll(".slate-timeline__next-pump").length, 0);
  }
});

test("the phone's sheet: Next shows on a phone alone with a thumb's button, and the Timeline card is as tall as what it holds", () => {
  const css = fs.readFileSync(path.join(__dirname, "slate", "styles", "components", "timeline.css"), "utf8");
  assert.match(css, /\n\.slate-timeline__next \{\s*display: none;/);
  assert.match(css, /\.slate-root\[data-input="touch"\]\[data-viewport="phone"\] \.slate-timeline__next:not\(\[hidden\]\) \{\s*display: flex;/);
  const button = css.slice(css.indexOf(".slate-root .slate-timeline__next-pump {"));
  const height = Number(button.match(/min-height: (\d+)px;/)[1]);
  assert.ok(height >= 48, `the Next button is ${height}px: not a thumb's`);
  assert.match(css, /\.slate-root\[data-input="touch"\]\[data-viewport="phone"\] \.slate-panel\.slate-timeline \{\s*min-height: 0;/);
});
