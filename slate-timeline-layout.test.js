"use strict";

/* slate-timeline-layout.js: the vertical timeline's geometry - the window,
 * the ticks, the grouping and the card placement - pinned without a DOM. */

const test = require("node:test");
const assert = require("node:assert/strict");

const layout = require("./slate/slate-timeline-layout.js");
const rundown = require("./station/station-rundown.js");

const MINUTE = rundown.MINUTE;
const HOUR = rundown.HOUR;
/* A fixed instant on the wall clock: 12:34:20 local. */
const NOW = new Date(2026, 8, 21, 12, 34, 20).getTime();

function entry(key, markAt, extra) {
  return Object.assign({ key, id: key.replace(":", ""), tracked: true, pumpOff: false, reason: null, markAt, markKind: "pump-off", late: Number.isFinite(markAt) && markAt < NOW, emptyAt: markAt, durationMs: HOUR }, extra || {});
}

/* ----------------------------------------------------------------------
 *   windowFor
 * -------------------------------------------------------------------- */

test("windowFor fits a usable changeover with a tenth of margin and never under an hour; otherwise a fixed 6 or 12 hours", () => {
  const fit = layout.windowFor({ now: NOW, changeover: { at: NOW + 4 * HOUR, stale: false } });
  assert.equal(fit.mode, "fit");
  assert.equal(fit.windowMs, 4 * HOUR * 1.1);
  assert.equal(fit.endAt, NOW + 4 * HOUR * 1.1);
  const near = layout.windowFor({ now: NOW, changeover: { at: NOW + 10 * MINUTE, stale: false } });
  assert.equal(near.windowMs, HOUR, "a changeover minutes away did not floor at an hour");
  for (const changeover of [null, { at: null, stale: false }, { at: NOW + 4 * HOUR, stale: true }, { at: NOW - MINUTE, stale: false }]) {
    const fixed = layout.windowFor({ now: NOW, changeover });
    assert.equal(fixed.mode, "fixed");
    assert.equal(fixed.windowMs, 6 * HOUR);
    assert.equal(fixed.horizonHours, 6);
  }
  assert.equal(layout.windowFor({ now: NOW, changeover: null, horizonHours: 12 }).windowMs, 12 * HOUR);
  assert.equal(layout.windowFor({ now: NOW, changeover: null, horizonHours: 7 }).windowMs, 6 * HOUR, "an unknown horizon is the default");
  // A usable changeover ignores the horizon.
  assert.equal(layout.windowFor({ now: NOW, changeover: { at: NOW + 4 * HOUR, stale: false }, horizonHours: 12 }).mode, "fit");
});

/* ----------------------------------------------------------------------
 *   verticalTicks
 * -------------------------------------------------------------------- */

test("ticks stand on the wall-clock grid from the first mark on or after now, with kinds and pixel offsets", () => {
  const { plan, marks } = layout.verticalTicks({ now: NOW, windowMs: HOUR, height: 600 });
  assert.equal(plan.minor, 1, "600px over an hour affords a minute");
  assert.equal(plan.label, 5);
  assert.equal(new Date(marks[0].t).getMinutes(), 35);
  assert.equal(new Date(marks[0].t).getSeconds(), 0);
  assert.ok(marks[0].t >= NOW);
  assert.ok(marks.every(mark => mark.y >= 0 && mark.y <= 600));
  assert.equal(marks[0].y, ((marks[0].t - NOW) / HOUR) * 600);
  const kinds = new Set(marks.map(mark => mark.kind));
  assert.deepEqual([...kinds].sort(), ["hour", "major", "minor"]);
  const hourMark = marks.find(mark => mark.kind === "hour");
  assert.equal(new Date(hourMark.t).getMinutes(), 0);
  const half = marks.find(mark => mark.kind === "major");
  assert.equal(new Date(half.t).getMinutes() % 30, 0);
});

test("labels keep at least the minimum gap, never sit within the edge, and open up on a long window", () => {
  const short = layout.verticalTicks({ now: NOW, windowMs: HOUR, height: 600, minLabelGapPx: 28, edgePx: 10 });
  const labelled = short.marks.filter(mark => mark.label);
  assert.ok(labelled.length > 3);
  for (let index = 1; index < labelled.length; index += 1) assert.ok(labelled[index].y - labelled[index - 1].y >= 28);
  assert.ok(labelled.every(mark => mark.y >= 10 && mark.y <= 590), "a label sits in the edge");
  assert.ok(labelled.every(mark => /\d/.test(mark.label)));

  const long = layout.verticalTicks({ now: NOW, windowMs: 12 * HOUR, height: 600 });
  assert.equal(long.plan.minor, 10, "12h on 600px: ten-minute minors");
  assert.equal(long.plan.label, 60, "12h on 600px: hourly labels");
  const hours = long.marks.filter(mark => mark.label);
  assert.ok(hours.every(mark => new Date(mark.t).getMinutes() === 0));
  assert.ok(hours.length >= 11);

  const none = layout.verticalTicks({ now: NOW, windowMs: 6 * HOUR, height: 0 });
  assert.ok(none.marks.length > 0);
  assert.ok(none.marks.every(mark => mark.y === 0));
});

/* ----------------------------------------------------------------------
 *   groupEvents
 * -------------------------------------------------------------------- */

test("events within five minutes of a group's earliest member share a card; the split is by the earliest, not by neighbours", () => {
  const entries = [entry("A:0", NOW + 60 * MINUTE), entry("A:1", NOW + 64 * MINUTE), entry("A:2", NOW + 68 * MINUTE), entry("B:0", NOW + 120 * MINUTE)];
  const out = layout.groupEvents(entries, { now: NOW, windowMs: 6 * HOUR });
  assert.deepEqual(out.groups.map(group => group.members.map(member => member.key)), [["A:0", "A:1"], ["A:2"], ["B:0"]]);
  assert.equal(out.groups[0].at, NOW + 60 * MINUTE);
  assert.equal(out.groups[0].fraction, 1 / 6);
  assert.equal(out.groups[0].kind, "pump-off");
  assert.equal(out.groups[0].id, "A:0");
  assert.equal(out.overdue, null);
  assert.deepEqual(out.later, []);
  // Order is by mark, ties by key, whatever the physical order.
  const shuffled = layout.groupEvents([entry("C:1", NOW + HOUR), entry("A:1", NOW + HOUR), entry("B:0", NOW + 30 * MINUTE)], { now: NOW, windowMs: 6 * HOUR });
  assert.deepEqual(shuffled.groups.map(group => group.members.map(member => member.key)), [["B:0"], ["A:1", "C:1"]]);
  // A group's kind and lateness come from its members.
  const empties = layout.groupEvents([entry("A:0", NOW + HOUR, { markKind: "empty" })], { now: NOW, windowMs: 6 * HOUR });
  assert.equal(empties.groups[0].kind, "empty");
});

test("pumped off, unestimated, overdue and beyond-the-horizon entries each go to their own list", () => {
  const entries = [
    entry("A:0", NOW - 20 * MINUTE),
    entry("A:1", NOW - 5 * MINUTE),
    entry("A:2", NOW + HOUR, { pumpOff: true }),
    entry("B:0", null, { reason: "no-weight", markKind: null }),
    entry("B:1", NOW + 7 * HOUR),
    entry("B:2", NOW + 2 * HOUR),
    entry("C:0", NOW + HOUR, { tracked: false }),
    entry("C:1", NOW - 40 * MINUTE, { pumpOff: true })
  ];
  const out = layout.groupEvents(entries, { now: NOW, windowMs: 6 * HOUR });
  assert.deepEqual(out.overdue.members.map(member => member.key), ["A:0", "A:1"], "most overdue first");
  assert.equal(out.overdue.kind, "pump-off");
  assert.deepEqual(out.groups.map(group => group.id), ["B:2"]);
  assert.deepEqual(out.later.map(member => member.key), ["B:1"]);
  assert.deepEqual(out.unavailable.map(member => member.key), ["B:0"]);
  assert.deepEqual(out.done.map(member => member.key), ["C:1", "A:2"], "done by mark, then key");
  assert.equal(layout.groupEvents([], { now: NOW }).overdue, null);
  assert.deepEqual(layout.groupEvents(null, { now: NOW }).groups, []);
});

/* ----------------------------------------------------------------------
 *   placeCards
 * -------------------------------------------------------------------- */

const cardHeight = group => 30 + group.members.length * 20;

function groupsAt(minutes) {
  return layout.groupEvents(minutes.map((m, index) => entry(`A:${index}`, NOW + m * MINUTE)), { now: NOW, windowMs: 6 * HOUR }).groups;
}

function assertSound(placed, options) {
  const { cards, pinned, floor, ceiling } = placed;
  let previousBottom = pinned ? pinned.y + pinned.height : options.topInset;
  for (const card of cards) {
    assert.ok(card.y >= floor - 1e-9, `card ${card.group.id} above the floor (${card.y} < ${floor})`);
    assert.ok(card.y >= previousBottom - 1e-9, `card ${card.group.id} overlaps the one above`);
    assert.ok(card.y + card.height <= ceiling + 1e-9, `card ${card.group.id} leaves the axis`);
    previousBottom = card.y + card.height + options.gap;
  }
}

test("a card that fits sits exactly at its instant; crowded cards are pushed down, then lifted from the bottom, dots never moving", () => {
  const options = { height: 700, topInset: 20, bottomInset: 40, gap: 6, cardHeight };
  const free = layout.placeCards(groupsAt([60, 180, 300]), options);
  assert.equal(free.span, 640);
  assert.equal(free.floor, 20);
  assert.equal(free.ceiling, 660);
  for (const card of free.cards) {
    assert.equal(card.y, card.y0);
    assert.equal(card.displacement, 0);
    assert.equal(card.y0, 20 + card.group.fraction * 640);
  }
  assertSound(free, options);

  // Three cards ten minutes apart: the second and third are pushed down.
  const pushed = layout.placeCards(groupsAt([60, 70, 80]), options);
  assert.equal(pushed.cards[0].y, pushed.cards[0].y0);
  assert.ok(pushed.cards[1].y > pushed.cards[1].y0);
  assert.equal(pushed.cards[1].y, pushed.cards[0].y + 50 + 6);
  assert.equal(pushed.cards[2].y, pushed.cards[1].y + 50 + 6);
  assert.ok(pushed.cards[2].displacement > 0);
  assertSound(pushed, options);

  // Three cards at the very end: lifted so the last stays on the axis; the
  // first is displaced upward (negative).
  const lifted = layout.placeCards(groupsAt([350, 355.5, 359]), options);
  const last = lifted.cards[lifted.cards.length - 1];
  assert.equal(last.y + last.height, 660);
  assert.ok(lifted.cards[0].displacement < 0);
  assertSound(lifted, options);
});

test("a pinned overdue block takes the top and the cards start under it; when nothing fits, the nearest groups merge, and one group alone is clipped", () => {
  const options = { height: 700, topInset: 20, bottomInset: 40, gap: 6, cardHeight, pinned: { members: [entry("Z:0", NOW - MINUTE), entry("Z:1", NOW - 2 * MINUTE)] } };
  const placed = layout.placeCards(groupsAt([1, 2, 3]), options);
  assert.deepEqual(placed.pinned, { y: 26, height: 70 });
  assert.equal(placed.floor, 26 + 70 + 6);
  assert.equal(placed.cards[0].y, placed.floor, "the first card was not pushed under the pinned block");
  assertSound(placed, options);

  // Twelve single cards on a short axis cannot all fit: neighbours merge until they do
  // (460px of span holds at most six cards of twelve members: 36n + 234 <= 460).
  const short = { height: 500, topInset: 20, bottomInset: 20, gap: 6, cardHeight };
  const many = layout.placeCards(groupsAt([10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120]), short);
  assert.ok(many.cards.length < 12 && many.cards.length >= 5, `${many.cards.length} cards`);
  assert.ok(many.cards.some(card => card.group.merged));
  assert.equal(many.cards.reduce((sum, card) => sum + card.group.members.length, 0), 12, "a member was lost in a merge");
  assertSound(many, short);
  assert.ok(!many.cards.some(card => card.clipped));

  // Even one group cannot fit a tiny axis: it is clipped at the floor.
  const tiny = layout.placeCards(groupsAt([10, 11, 12, 13, 14]), { height: 80, topInset: 10, bottomInset: 10, gap: 4, cardHeight });
  assert.equal(tiny.cards.length, 1);
  assert.equal(tiny.cards[0].clipped, true);
  assert.equal(tiny.cards[0].y, 10);

  // Determinism.
  const a = JSON.stringify(layout.placeCards(groupsAt([5, 7, 90, 91, 200]), short).cards.map(card => [card.group.id, card.y]));
  const b = JSON.stringify(layout.placeCards(groupsAt([5, 7, 90, 91, 200]), short).cards.map(card => [card.group.id, card.y]));
  assert.equal(a, b);
  assert.deepEqual(layout.placeCards([], short).cards, []);
});
