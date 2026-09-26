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

test("Scaled fits a usable changeover with a tenth of margin and never under an hour, and stands at the chosen hours when there is none to fit", () => {
  const fit = layout.windowFor({ now: NOW, changeover: { at: NOW + 4 * HOUR, stale: false } });
  assert.equal(fit.mode, "fit");
  assert.equal(fit.scale, layout.SCALED, "Scaled is the scale a Timeline opens on");
  assert.equal(fit.fitted, true);
  assert.equal(fit.windowMs, 4 * HOUR * 1.1);
  assert.equal(fit.endAt, NOW + 4 * HOUR * 1.1);
  const near = layout.windowFor({ now: NOW, changeover: { at: NOW + 10 * MINUTE, stale: false } });
  assert.equal(near.windowMs, HOUR, "a changeover minutes away did not floor at an hour");
  for (const changeover of [null, { at: null, stale: false }, { at: NOW + 4 * HOUR, stale: true }, { at: NOW - MINUTE, stale: false }]) {
    const fixed = layout.windowFor({ now: NOW, changeover });
    assert.equal(fixed.mode, "fixed");
    assert.equal(fixed.scale, layout.SCALED, "Scaled stays the scale it cannot fit");
    assert.equal(fixed.fitted, false);
    assert.equal(fixed.windowMs, 6 * HOUR);
    assert.equal(fixed.hours, 6, "the hours it is standing at are said");
  }
  // Scaled stands at the hours last chosen, not always at six.
  const standing = layout.windowFor({ now: NOW, changeover: null, scale: layout.SCALED, hours: 3 });
  assert.equal(standing.windowMs, 3 * HOUR);
  assert.equal(standing.hours, 3);
});

test("a chosen span is obeyed: three, six or twelve hours, whatever the changeover does", () => {
  const changeover = { at: NOW + 4 * HOUR, stale: false };
  for (const hours of layout.HOURS) {
    const fixed = layout.windowFor({ now: NOW, changeover, scale: hours });
    assert.equal(fixed.mode, "fixed", `${hours}H fitted the changeover anyway`);
    assert.equal(fixed.fitted, false);
    assert.equal(fixed.scale, hours);
    assert.equal(fixed.windowMs, hours * HOUR);
    assert.equal(fixed.endAt, NOW + hours * HOUR);
  }
  assert.deepEqual(layout.HOURS.slice(), [3, 6, 12]);
  assert.equal(layout.DEFAULT_HOURS, 6);
  assert.equal(layout.DEFAULT_SCALE, layout.SCALED);
  // Anything that is not on offer is no choice at all.
  for (const value of [undefined, null, 7, "12", 0, NaN, "fit"]) {
    assert.equal(layout.scaleFrom(value), layout.SCALED, `${String(value)} was taken for a scale`);
  }
  for (const value of [undefined, null, 7, "6", 0]) assert.equal(layout.hoursFrom(value), 6, `${String(value)} was taken for hours`);
  assert.equal(layout.windowFor({ now: NOW, changeover: null, scale: 7 }).windowMs, 6 * HOUR, "an unknown scale is the default");
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

/* ----------------------------------------------------------------------
 *   spanNeeded: the axis long enough that nothing merges
 * -------------------------------------------------------------------- */

test("spanNeeded: nothing to place needs no room; cards that fit ask for no more than the window", () => {
  assert.deepEqual(layout.spanNeeded([], { cardHeight, gap: 6, minSpan: 400 }), { span: 400, needed: 0, grows: false, fits: true });
  const roomy = layout.spanNeeded(groupsAt([60, 180, 300]), { cardHeight, gap: 6, minSpan: 600 });
  assert.equal(roomy.span, 600);
  assert.equal(roomy.grows, false);
});

test("spanNeeded: a crowded run grows the axis exactly enough that placeCards merges nothing - only hoppers within five minutes share a card, and every dot stands at its own instant", () => {
  // Eight hoppers pumping off six minutes apart, and three at the same minute; a short window.
  const minutes = [20, 26, 32, 38, 44, 50, 56, 62, 90, 90, 92];
  const groups = groupsAt(minutes);
  assert.equal(groups.length, 9, "the five-minute grouping itself changed");
  const options = { topInset: 18, bottomInset: 28, gap: 6, cardHeight };
  const short = 240;
  const merged = layout.placeCards(groups, Object.assign({ height: short }, options));
  assert.ok(merged.cards.length < groups.length, "the short window did not need merging to begin with");
  const need = layout.spanNeeded(groups, { cardHeight, gap: 6, minSpan: short - 18 - 28 });
  assert.equal(need.grows, true);
  assert.equal(need.fits, true);
  const placed = layout.placeCards(groups, Object.assign({ height: 18 + need.span + 28 }, options));
  assert.equal(placed.cards.length, groups.length, "a grown axis still merged");
  assert.ok(placed.cards.every(card => !card.group.merged && !card.clipped));
  for (const card of placed.cards) assert.ok(Math.abs(card.y0 - (18 + card.group.fraction * need.span)) < 1e-9, "a dot left its instant");
  assertSound(placed, options);
  // And it is the least: a pixel less and the last card no longer fits without a merge.
  const tight = layout.placeCards(groups, Object.assign({ height: 18 + need.span - 1 + 28 }, options));
  assert.ok(tight.cards.length < groups.length || tight.cards.some(card => card.displacement < 0), "the span asked for more than it needs");
});

test("spanNeeded: a chosen span asks only that the cards stack - endRoom off, a card near the end is not allowed to stretch the axis", () => {
  const groups = [
    { fraction: 0.2, members: [entry("A:1", NOW + HOUR)] },
    { fraction: 0.96, members: [entry("B:1", NOW + 2 * HOUR)] }
  ];
  const options = { cardHeight: () => 80, gap: 8, minSpan: 600, maxSpan: 8000 };
  const fitted = layout.spanNeeded(groups, options);
  assert.ok(fitted.span > 1500, `an axis ending at the changeover makes room for the last card (${fitted.span})`);
  const chosen = layout.spanNeeded(groups, Object.assign({ endRoom: false }, options));
  assert.equal(chosen.span, 600, "a chosen span grew for room below the last mark");
  assert.equal(chosen.grows, false);
  // It still grows for cards that cannot stack in the window at all.
  const crowded = [];
  for (let index = 0; index < 10; index += 1) crowded.push({ fraction: index / 20, members: [entry(`H:${index}`, NOW + index * HOUR)] });
  const stacked = layout.spanNeeded(crowded, Object.assign({ endRoom: false }, options));
  assert.equal(stacked.span, 10 * 80 + 9 * 8);
  assert.equal(stacked.grows, true);
});

test("spanNeeded: the pinned block's room counts; a card near the axis's end cannot ask for an endless axis; the cap is kept and says it does not fit", () => {
  const groups = groupsAt([10, 20, 30]);
  const bare = layout.spanNeeded(groups, { cardHeight, gap: 6, minSpan: 0 });
  const pinned = layout.spanNeeded(groups, { cardHeight, gap: 6, minSpan: 0, floorOffset: 200 });
  assert.ok(pinned.needed >= bare.needed && pinned.needed >= 200);
  const nearEnd = layout.spanNeeded([{ fraction: 0.999, members: [{}] }], { cardHeight, gap: 6, minSpan: 0 });
  assert.equal(nearEnd.needed, cardHeight({ members: [{}] }) / layout.MIN_END_ROOM);
  const capped = layout.spanNeeded(groupsAt([10, 16, 22, 28, 34, 40]), { cardHeight, gap: 6, minSpan: 50, maxSpan: 100 });
  assert.equal(capped.span, 100);
  assert.equal(capped.fits, false);
});
