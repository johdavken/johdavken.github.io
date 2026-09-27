/* The plant's crew rotation: which days each crew works, and whether it
 * is days or nights.
 *
 * Four crews, A to D, work 12-hour shifts - days 8 AM to 8 PM, nights
 * 8 PM to 8 AM, plant local time - on a 2-2-3 pattern that repeats every
 * 14 days. Crew A works the days in A_ON (offsets from ANCHOR, a Monday
 * A worked nights); crew D works the same days, C and B the other seven.
 * Days and nights swap every 28 days, on a Wednesday: A and C together,
 * B and D the other way, so each day one crew starts at 8 AM and one at
 * 8 PM.
 *
 * Read from crew A's own calendar (21 shifts, Sep 28 - Nov 5 2026) and
 * checked against HR's mandatory-meeting texts from March to September
 * 2026, which name the crew starting days (7 AM) and the crew coming off
 * nights (8 AM) - every one matches. If the plant changes its rotation,
 * this file is the one to change.
 *
 * Pure: no document, no storage, no clock of its own. Times are the
 * device's local time, which on the floor is plant time.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynWorkRotation = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const CREWS = Object.freeze(["A", "B", "C", "D"]);
  /* A Monday crew A worked a night shift; offsets count from it. */
  const ANCHOR = Object.freeze({ year: 2026, month: 9, day: 28 });
  const CYCLE = 14;
  /* The days crew A (and D) work, as offsets into the 14-day cycle. */
  const A_ON = Object.freeze([0, 1, 4, 5, 6, 9, 10]);
  /* Days and nights swap every 28 days; A's night block holding ANCHOR
   * began 5 days before it, on a Wednesday. */
  const SWAP = 28;
  const SWAP_OFFSET = 5;
  const DAY_START = 8;
  const NIGHT_START = 20;
  const SHIFT_HOURS = 12;
  const MS_PER_DAY = 24 * 60 * 60 * 1000;

  const CREW_RULES = Object.freeze({
    A: Object.freeze({ onWithA: true, sameTypeAsA: true }),
    B: Object.freeze({ onWithA: false, sameTypeAsA: false }),
    C: Object.freeze({ onWithA: false, sameTypeAsA: true }),
    D: Object.freeze({ onWithA: true, sameTypeAsA: false })
  });

  function mod(n, m) {
    return ((n % m) + m) % m;
  }

  function normalizeCrew(crew) {
    const letter = String(crew || "").trim().toUpperCase();
    return CREWS.includes(letter) ? letter : null;
  }

  /* Whole days from ANCHOR to a local calendar date, DST-proof. */
  function offsetOf(year, month, day) {
    return Math.round((Date.UTC(year, month - 1, day) - Date.UTC(ANCHOR.year, ANCHOR.month - 1, ANCHOR.day)) / MS_PER_DAY);
  }

  function dateKey(year, month, day) {
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  /* What crew A does on the day at this offset. */
  function crewAOn(offset) {
    const on = A_ON.includes(mod(offset, CYCLE));
    const night = mod(Math.floor((offset + SWAP_OFFSET) / SWAP), 2) === 0;
    return { on, kind: night ? "night" : "day" };
  }

  /**
   * The shift a crew works on a local calendar date, or null.
   * @returns {{crew, date, kind: "day"|"night", start: Date, end: Date}|null}
   */
  function shiftOn(crew, year, month, day) {
    const letter = normalizeCrew(crew);
    if (!letter) return null;
    const rule = CREW_RULES[letter];
    const a = crewAOn(offsetOf(year, month, day));
    if (a.on !== rule.onWithA) return null;
    const kind = rule.sameTypeAsA ? a.kind : (a.kind === "night" ? "day" : "night");
    const startHour = kind === "day" ? DAY_START : NIGHT_START;
    const start = new Date(year, month - 1, day, startHour, 0, 0, 0);
    const end = new Date(year, month - 1, day, startHour + SHIFT_HOURS, 0, 0, 0);
    return { crew: letter, date: dateKey(year, month, day), kind, start, end };
  }

  /**
   * Every shift of a crew that overlaps [fromMs, toMs), earliest first.
   */
  function shiftsBetween(crew, fromMs, toMs) {
    if (!normalizeCrew(crew) || !Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) return [];
    const shifts = [];
    // Start a day early: last night's shift may still be running.
    const first = new Date(fromMs);
    const cursor = new Date(first.getFullYear(), first.getMonth(), first.getDate() - 1);
    while (cursor.getTime() < toMs) {
      const shift = shiftOn(crew, cursor.getFullYear(), cursor.getMonth() + 1, cursor.getDate());
      if (shift && shift.end.getTime() > fromMs && shift.start.getTime() < toMs) shifts.push(shift);
      cursor.setDate(cursor.getDate() + 1);
    }
    return shifts;
  }

  /** The next shift starting after `atMs`, looking up to 15 days ahead. */
  function nextShift(crew, atMs) {
    return shiftsBetween(crew, atMs, atMs + 15 * MS_PER_DAY).find(shift => shift.start.getTime() > atMs) || null;
  }

  /** "8 AM" / "8 PM". */
  function startLabel(shift) {
    return shift && shift.kind === "day" ? "8 AM" : "8 PM";
  }

  return Object.freeze({
    CREWS, ANCHOR, CYCLE, A_ON, SWAP, SHIFT_HOURS,
    normalizeCrew, offsetOf, dateKey, shiftOn, shiftsBetween, nextShift, startLabel
  });
});
