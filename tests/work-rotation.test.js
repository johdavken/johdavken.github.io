"use strict";

/* work-rotation.js: the plant's four-crew 2-2-3 rotation, pinned to crew
 * A's own calendar and to HR's meeting texts, which name the crew starting
 * days and the crew coming off nights. Plant time is Central. */

process.env.TZ = "America/Chicago";

const test = require("node:test");
const assert = require("node:assert/strict");
const rotation = require("../work-rotation.js");

const on = (crew, iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return rotation.shiftOn(crew, y, m, d);
};

test("crew A's rotation is the one on its calendar: 21 shifts, Sep 28 to Nov 5 2026, nothing extra", () => {
  const nights = ["2026-09-28", "2026-09-29", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-07", "2026-10-08",
    "2026-10-12", "2026-10-13", "2026-10-16", "2026-10-17", "2026-10-18"];
  const days = ["2026-10-21", "2026-10-22", "2026-10-26", "2026-10-27", "2026-10-30", "2026-10-31", "2026-11-01",
    "2026-11-04", "2026-11-05"];
  for (const iso of nights) assert.equal(on("A", iso)?.kind, "night", `A on ${iso}`);
  for (const iso of days) assert.equal(on("A", iso)?.kind, "day", `A on ${iso}`);
  const from = new Date(2026, 8, 26).getTime();
  const to = new Date(2026, 10, 6).getTime();
  const listed = rotation.shiftsBetween("A", from, to).map(shift => shift.date);
  assert.deepEqual(listed, [...nights, ...days].sort());
});

test("every crew's hours match HR's meeting texts: days start at 7 AM meetings, nights come off at 8 AM", () => {
  // [date, crew meeting at 7 AM (starting days), crew meeting at 8 AM (off nights)]
  const texts = [["2026-03-31", "A", "D"], ["2026-04-02", "C", "B"], ["2026-05-07", "A", "D"],
    ["2026-08-18", "D", "A"], ["2026-08-20", "B", "C"], ["2026-09-15", "A", "D"]];
  for (const [iso, starting, leaving] of texts) {
    assert.equal(on(starting, iso)?.kind, "day", `${starting} starts days on ${iso}`);
    const [y, m, d] = iso.split("-").map(Number);
    const eve = new Date(y, m - 1, d - 1);
    const lastNight = rotation.shiftOn(leaving, eve.getFullYear(), eve.getMonth() + 1, eve.getDate());
    assert.equal(lastNight?.kind, "night", `${leaving} comes off nights on ${iso}`);
    assert.equal(lastNight.end.getTime(), new Date(y, m - 1, d, 8).getTime());
  }
});

test("every day of a year, exactly one crew starts at 8 AM and one at 8 PM; each crew works 7 of 14 days", () => {
  const counts = { A: 0, B: 0, C: 0, D: 0 };
  for (let i = 0; i < 364; i += 1) {
    const day = new Date(2026, 8, 28 + i);
    const shifts = rotation.CREWS.map(crew => rotation.shiftOn(crew, day.getFullYear(), day.getMonth() + 1, day.getDate())).filter(Boolean);
    assert.deepEqual(shifts.map(shift => shift.kind).sort(), ["day", "night"], `${day.toDateString()}`);
    for (const shift of shifts) counts[shift.crew] += 1;
  }
  assert.deepEqual(counts, { A: 182, B: 182, C: 182, D: 182 });
});

test("shifts start at 8 local and last 12 hours, across both daylight-saving changes", () => {
  const fallBack = on("A", "2026-11-01"); // day shift on the Sunday clocks go back
  assert.equal(fallBack.start.getHours(), 8);
  assert.equal(fallBack.end.getHours(), 20);
  // A night that spans the spring change is 11 real hours, still 8 PM to 8 AM on the clock.
  const springNight = rotation.CREWS.map(crew => on(crew, "2027-03-13")).find(shift => shift && shift.kind === "night");
  assert.ok(springNight, "someone works the night of Mar 13 2027");
  assert.equal(springNight.start.getHours(), 20);
  assert.equal(springNight.end.getHours(), 8);
  assert.equal(springNight.end.getDate(), 14);
  assert.equal((springNight.end - springNight.start) / 3600e3, 11);
});

test("crew letters are forgiving, anything else has no shifts; a running night shift is found from the morning after", () => {
  assert.equal(rotation.normalizeCrew(" a "), "A");
  assert.equal(rotation.normalizeCrew("E"), null);
  assert.equal(rotation.shiftOn("E", 2026, 9, 28), null);
  assert.deepEqual(rotation.shiftsBetween("", 0, 1e12), []);
  assert.deepEqual(rotation.shiftsBetween("A", 10, 5), []);
  // 3 AM Tuesday Sep 29: Monday's night is still running.
  const running = rotation.shiftsBetween("A", new Date(2026, 8, 29, 3).getTime(), new Date(2026, 8, 29, 4).getTime());
  assert.deepEqual(running.map(shift => shift.date), ["2026-09-28"]);
  const next = rotation.nextShift("A", new Date(2026, 8, 29, 3).getTime());
  assert.equal(next.date, "2026-09-29");
  assert.equal(rotation.startLabel(next), "8 PM");
  assert.equal(rotation.startLabel(on("A", "2026-10-21")), "8 AM");
});
