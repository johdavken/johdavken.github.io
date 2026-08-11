"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  parseChangeoverDate,
  calendarDayOffset,
  formatTime,
  formatTimelineStart,
  isChangeoverStale,
  CHANGEOVER_STALE_MS
} = require("./scheduling.js");

test("a just-after-midnight changeover rolls to tomorrow when entered before midnight", () => {
  const now = new Date(2026, 6, 29, 23, 55);
  const deadline = parseChangeoverDate("00:15", now);

  assert.equal(deadline.getFullYear(), 2026);
  assert.equal(deadline.getMonth(), 6);
  assert.equal(deadline.getDate(), 30);
  assert.equal(deadline.getHours(), 0);
  assert.equal(deadline.getMinutes(), 15);
});

test("a late-night changeover stays today when entered just after midnight", () => {
  const now = new Date(2026, 6, 29, 0, 5);
  const deadline = parseChangeoverDate("23:45", now);

  assert.equal(deadline.getDate(), 29);
  assert.equal(deadline.getHours(), 23);
  assert.equal(deadline.getMinutes(), 45);
});

test("a start time before a midnight deadline is labeled previous day", () => {
  const deadline = new Date(2026, 6, 30, 0, 15);
  const startBy = new Date(2026, 6, 29, 23, 45);

  assert.equal(calendarDayOffset(startBy, deadline), -1);
  assert.match(formatTime(startBy, deadline), /\(-1d\)$/);
});

test("a time after a late-night deadline is labeled next day", () => {
  const deadline = new Date(2026, 6, 29, 23, 45);
  const later = new Date(2026, 6, 30, 0, 15);

  assert.equal(calendarDayOffset(later, deadline), 1);
  assert.match(formatTime(later, deadline), /\(\+1d\)$/);
});

test("same-day times have no day suffix", () => {
  const deadline = new Date(2026, 6, 29, 23, 45);
  const startBy = new Date(2026, 6, 29, 22, 15);

  assert.equal(calendarDayOffset(startBy, deadline), 0);
  assert.doesNotMatch(formatTime(startBy, deadline), /\([+-]\d+d\)$/);
});

test("time formatting defaults to 12-hour and supports 24-hour display", () => {
  const afternoon = new Date(2026, 6, 29, 13, 5);

  assert.match(formatTime(afternoon), /1:05\s*PM/i);
  assert.equal(formatTime(afternoon, null, "24"), "13:05");
});

test("timeline start labels use readable late and changeover-day wording", () => {
  const deadline = new Date(2026, 6, 30, 0, 15);
  const startBy = new Date(2026, 6, 29, 23, 45);

  const upcoming = formatTimelineStart(startBy, deadline, new Date(2026, 6, 29, 23, 30));
  assert.equal(upcoming.late, false);
  assert.match(upcoming.text, /Day before$/);

  const overdue = formatTimelineStart(startBy, deadline, new Date(2026, 6, 30, 23, 50));
  assert.equal(overdue.late, true);
  assert.match(overdue.text, /1 day late$/);
  assert.doesNotMatch(overdue.text, /\(-1d\)/);
});

test("a future entry transitions from upcoming to late purely as the supplied clock advances - the same date/deadline, only 'now' changes, matching the Timeline ticker's own refresh call", () => {
  const deadline = new Date(2026, 6, 29, 22, 0);
  const startBy = new Date(2026, 6, 29, 20, 0);

  const wellBefore = formatTimelineStart(startBy, deadline, new Date(2026, 6, 29, 18, 0));
  assert.equal(wellBefore.late, false);

  const justBefore = formatTimelineStart(startBy, deadline, new Date(2026, 6, 29, 19, 59));
  assert.equal(justBefore.late, false);

  const justAfter = formatTimelineStart(startBy, deadline, new Date(2026, 6, 29, 20, 1));
  assert.equal(justAfter.late, true);
  assert.match(justAfter.text, /· late$/);

  const muchLater = formatTimelineStart(startBy, deadline, new Date(2026, 6, 30, 21, 0));
  assert.equal(muchLater.late, true);
  assert.match(muchLater.text, /1 day late$/);
});

test("a changeover time with no recorded set-at is never flagged stale", () => {
  assert.equal(isChangeoverStale(null), false);
  assert.equal(isChangeoverStale(undefined), false);
});

test("a changeover time edited within a normal shift is not stale", () => {
  const setAt = new Date(2026, 6, 29, 6, 0).getTime();
  const now = new Date(2026, 6, 29, 18, 0); // 12h later
  assert.equal(isChangeoverStale(setAt, now), false);
});

test("a changeover time left untouched for about a day is flagged stale", () => {
  const setAt = new Date(2026, 6, 28, 6, 0).getTime();
  const now = new Date(2026, 6, 29, 6, 1); // just over 24h later
  assert.equal(isChangeoverStale(setAt, now), true);
});

test("staleness threshold is comfortably inside a day but past a single shift", () => {
  const setAt = new Date(2026, 6, 29, 0, 0).getTime();
  const justUnder = new Date(setAt + CHANGEOVER_STALE_MS - 60000);
  const justOver = new Date(setAt + CHANGEOVER_STALE_MS + 60000);
  assert.equal(isChangeoverStale(setAt, justUnder), false);
  assert.equal(isChangeoverStale(setAt, justOver), true);
});
