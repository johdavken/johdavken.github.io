"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  parseChangeoverDate,
  calendarDayOffset,
  formatTime,
  formatTimelineStart
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

test("timeline start labels distinguish previous-day timing from a late action", () => {
  const deadline = new Date(2026, 6, 30, 0, 15);
  const startBy = new Date(2026, 6, 29, 23, 45);

  const upcoming = formatTimelineStart(startBy, deadline, new Date(2026, 6, 29, 23, 30));
  assert.equal(upcoming.late, false);
  assert.match(upcoming.text, /\(-1d\)$/);

  const overdue = formatTimelineStart(startBy, deadline, new Date(2026, 6, 29, 23, 50));
  assert.equal(overdue.late, true);
  assert.match(overdue.text, /\(-1d\)$/);
  assert.doesNotMatch(overdue.text, /Late/i);
});
