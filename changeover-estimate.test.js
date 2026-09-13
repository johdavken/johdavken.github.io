"use strict";

/* changeover-estimate.js: the application's changeover calculator as a
 * module. Pinned to app.js's inline wizard line for line - the formulas,
 * the records, the keys - so the floor UI's calculator and Station's
 * cannot drift apart; then driven as the wizard is driven, against a fake
 * storage, for what an accepted calculation leaves behind and when it goes.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const calc = require("./changeover-estimate.js");

const app = fs.readFileSync("app.js", "utf8");
const source = fs.readFileSync("changeover-estimate.js", "utf8");

/* The same cases changeover-wizard.test.js runs against its own restatement
 * of the wizard's arithmetic. */
const CASES = [
  [{ lineSpeed: 100, footagePerRoll: 1000, numberUp: 4, bothWinders: false, hours: 2, minutes: 15, rollsLeft: 18 }, { rollsPerSet: 4, futureSets: 4, remainingMinutes: 175 }],
  [{ lineSpeed: 100, footagePerRoll: 1000, numberUp: 4, bothWinders: true, hours: 0, minutes: 30, rollsLeft: 401 }, { rollsPerSet: 8, futureSets: 50, remainingMinutes: 530 }]
];

function fakeStorage(initial) {
  const map = new Map(Object.entries(initial || {}));
  return {
    map,
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: key => { map.delete(key); }
  };
}

function appFunction(name) {
  const start = app.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `app.js has ${name}`);
  const next = app.indexOf("\n    function ", start + 1);
  return app.slice(start, next === -1 ? undefined : next);
}

/* ----------------------------------------------------------------------
 *   Pinned to app.js
 * -------------------------------------------------------------------- */

test("the storage keys are the application's own, character for character", () => {
  const answers = /const LS_CHANGEOVER_WIZARD_KEY = "([^"]+)";/.exec(app);
  const estimate = /const LS_PRODUCTION_ESTIMATE_KEY = "([^"]+)";/.exec(app);
  assert.ok(answers && estimate, "app.js names both keys");
  assert.equal(calc.STORAGE_KEYS.answers, answers[1]);
  assert.equal(calc.STORAGE_KEYS.estimate, estimate[1]);
});

test("the defaults, the estimate and the production record restate the wizard's lines", () => {
  // The answers' defaults, as the wizard seeds them.
  const defaults = /const changeoverWizardDefaults = \{([^}]+)\};/.exec(app);
  assert.ok(defaults);
  const parsed = Function(`return {${defaults[1]}};`)();
  assert.deepEqual(calc.DEFAULT_ANSWERS, parsed);
  // The estimate's arithmetic, line for line.
  const wizard = appFunction("changeoverWizardEstimate");
  for (const line of [
    "const currentSetMinutesRemaining = Number(",
    "const winderCount = ",
    "const rollsPerSet = numberUp * winderCount;",
    "const fullSetMinutes = footagePerRoll / lineSpeed;",
    "const rollsAfterCurrentSet = Math.max(0, rollsLeft - rollsPerSet);",
    "const futureSets = Math.ceil(rollsAfterCurrentSet / rollsPerSet);",
    "const remainingMinutes = currentSetMinutesRemaining + futureSets * fullSetMinutes;",
    "|| lineSpeed <= 0 || footagePerRoll <= 0 || numberUp < 1 || rollsLeft < 0 || currentSetMinutesRemaining < 0) return null;"
  ]) {
    assert.ok(wizard.includes(line), `app.js's wizard has: ${line}`);
    assert.ok(source.includes(line), `the module has: ${line}`);
  }
  // The production record, as built, read and re-derived.
  const build = appFunction("buildProductionEstimateFromWizardAnswers");
  const read = appFunction("readProductionEstimate");
  const current = appFunction("calculateCurrentProductionEstimate");
  const persist = appFunction("persistProductionEstimate");
  for (const [body, line] of [
    [build, "const rollsPerSet = numberUp * (bothWinders ? 2 : 1);"],
    [build, "const minutesPerSet = footagePerRoll / lineSpeed;"],
    [build, "const futureSets = Math.ceil(Math.max(0, rollsLeft - rollsPerSet) / rollsPerSet);"],
    [build, "const totalMinutesRemaining = currentSetMinutesRemaining + futureSets * minutesPerSet;"],
    [build, "if (!Number.isFinite(totalMinutesRemaining) || totalMinutesRemaining <= 0) return null;"],
    [read, "|| lineSpeed <= 0 || footagePerRoll <= 0 || numberUp < 1 || rollsLeft < 0 || currentSetMinutesRemaining < 0 || startedAt <= 0){"],
    [current, "const elapsedMinutes = Math.max(0, (at - estimate.startedAt) / 60000);".replace("(at - ", "(now - ")],
    [current, "const remainingMinutes = Math.max(0, estimate.totalMinutesRemaining - elapsedMinutes);"],
    [current, "if (remainingMinutes <= 0) return null;"],
    [current, "const remainingRolls = Math.max(0, Math.ceil((remainingMinutes / estimate.minutesPerSet) * estimate.rollsPerSet));"],
    [current, "if (remainingRolls <= 0) return null;"],
    [current, "const sets = Math.max(1, Math.ceil(remainingRolls / estimate.rollsPerSet));"],
    [persist, "|| payload.startedAt <= 0 || payload.lineSpeed <= 0 || payload.footagePerRoll <= 0 || payload.numberUp < 1 || payload.rollsLeft < 0 || payload.currentSetMinutesRemaining < 0){"]
  ]) {
    assert.ok(body.includes(line), `app.js has: ${line}`);
    // The module reads the clock through `at` where app.js reads `now`;
    // every other line is the same text.
    assert.ok(source.includes(line.replace("(now - ", "(at - ")), `the module has: ${line}`);
  }
  // The wording of the running estimate.
  assert.match(app, /`Est\. \$\{current\.sets\} \$\{current\.sets === 1 \? "set" : "sets"\} · \$\{current\.remainingRolls\} \$\{current\.remainingRolls === 1 \? "roll" : "rolls"\} remaining`/);
  assert.equal(calc.formatProductionEstimate({ sets: 3, remainingRolls: 11 }), "Est. 3 sets · 11 rolls remaining");
  assert.equal(calc.formatProductionEstimate({ sets: 1, remainingRolls: 1 }), "Est. 1 set · 1 roll remaining");
});

test("the floor UI's wizard is untouched: app.js keeps its inline calculator and index.html its dialog", () => {
  const html = fs.readFileSync("index.html", "utf8");
  assert.match(html, /<dialog id="changeoverWizardDialog"/);
  assert.match(app, /function changeoverWizardEstimate\(\)/);
  assert.match(app, /function renderChangeoverWizard\(\)/);
  assert.doesNotMatch(app, /PolynChangeoverEstimate/, "app.js does not yet delegate; that is a separate step");
});

/* ----------------------------------------------------------------------
 *   The arithmetic
 * -------------------------------------------------------------------- */

test("the estimate counts partial final sets and supports one or two winders, multi-hour sets and hundreds of rolls", () => {
  const NOW = new Date(2026, 8, 12, 14, 0).getTime();
  for (const [answers, expected] of CASES) {
    const result = calc.estimate(answers, NOW);
    assert.deepEqual({ rollsPerSet: result.rollsPerSet, futureSets: result.futureSets, remainingMinutes: result.remainingMinutes }, expected);
    assert.equal(result.estimatedAt, NOW + expected.remainingMinutes * 60000);
  }
  for (let numberUp = 1; numberUp <= 10; numberUp++) {
    assert.equal(calc.estimate({ lineSpeed: 1, footagePerRoll: 1, numberUp, bothWinders: false, hours: 0, minutes: 0, rollsLeft: numberUp }, NOW).futureSets, 0);
  }
  // The typed answers arrive as the field's strings, as the wizard keeps them.
  assert.equal(calc.estimate({ lineSpeed: "100", footagePerRoll: "1000", numberUp: 4, bothWinders: false, hours: 2, minutes: 15, rollsLeft: "18" }, NOW).remainingMinutes, 175);
});

test("answers that do not add up give no estimate, never NaN or an invented time", () => {
  const NOW = 1000;
  assert.equal(calc.estimate({}, NOW), null);
  assert.equal(calc.estimate({ lineSpeed: "", footagePerRoll: "1000", numberUp: 1, bothWinders: true, hours: 0, minutes: 0, rollsLeft: "10" }, NOW), null);
  assert.equal(calc.estimate({ lineSpeed: "0", footagePerRoll: "1000", numberUp: 1, bothWinders: true, hours: 0, minutes: 0, rollsLeft: "10" }, NOW), null);
  assert.equal(calc.estimate({ lineSpeed: "100", footagePerRoll: "1000", numberUp: 0, bothWinders: true, hours: 0, minutes: 0, rollsLeft: "10" }, NOW), null);
  assert.equal(calc.estimate({ lineSpeed: "100", footagePerRoll: "1000", numberUp: 1, bothWinders: true, hours: 0, minutes: 0, rollsLeft: "-1" }, NOW), null);
  assert.equal(calc.estimate({ lineSpeed: "abc", footagePerRoll: "1000", numberUp: 1, bothWinders: true, hours: 0, minutes: 0, rollsLeft: "10" }, NOW), null);
});

test("each answer is checked as the wizard checks it at its step, with the wizard's own words", () => {
  assert.deepEqual(calc.validateAnswer("lineSpeed", "0"), { ok: false, message: "Enter a value greater than zero." });
  assert.deepEqual(calc.validateAnswer("footagePerRoll", ""), { ok: false, message: "Enter a value greater than zero." });
  assert.deepEqual(calc.validateAnswer("lineSpeed", "120"), { ok: true, message: "" });
  assert.deepEqual(calc.validateAnswer("rollsLeft", "-1"), { ok: false, message: "Enter zero or more rolls." });
  assert.deepEqual(calc.validateAnswer("rollsLeft", "0"), { ok: true, message: "" });
  assert.equal(calc.validateAnswer("numberUp", 11).ok, false);
  assert.equal(calc.validateAnswer("numberUp", 10).ok, true);
  assert.equal(calc.validateAnswer("hours", 25).ok, false);
  assert.equal(calc.validateAnswer("hours", 24).ok, true);
  assert.equal(calc.validateAnswer("minutes", 60).ok, false);
  assert.equal(calc.validateAnswer("minutes", 59).ok, true);
  assert.equal(calc.validateAnswer("bothWinders", "yes").ok, false);
  assert.equal(calc.validateAnswer("bothWinders", true).ok, true);
  assert.match(app, /"Enter zero or more rolls\." : "Enter a value greater than zero\."/);
});

test("clockValue is the HH:MM the wizard hands the changeover field", () => {
  assert.equal(calc.clockValue(new Date(2026, 8, 12, 3, 7).getTime()), "03:07");
  assert.equal(calc.clockValue(new Date(2026, 8, 12, 13, 33).getTime()), "13:33");
  assert.equal(calc.clockValue(NaN), "");
  assert.match(app, /String\(date\.getHours\(\)\)\.padStart\(2,"0"\)\}:\$\{String\(date\.getMinutes\(\)\)\.padStart\(2,"0"\)/);
});

/* ----------------------------------------------------------------------
 *   The records
 * -------------------------------------------------------------------- */

test("answers are restored over the defaults, saved as typed, and survive a storage that throws", () => {
  const storage = fakeStorage();
  assert.deepEqual(calc.readAnswers(storage), calc.DEFAULT_ANSWERS);
  assert.equal(calc.saveAnswers(storage, { lineSpeed: "120", numberUp: 3 }), true);
  assert.deepEqual(JSON.parse(storage.map.get(calc.STORAGE_KEYS.answers)),
    { lineSpeed: "120", footagePerRoll: "", numberUp: 3, bothWinders: true, hours: 0, minutes: 0, rollsLeft: "" });
  assert.deepEqual(calc.readAnswers(storage).lineSpeed, "120");
  // What the floor UI's wizard saved on this device is what comes back here.
  const fromWizard = fakeStorage({ [calc.STORAGE_KEYS.answers]: JSON.stringify({ lineSpeed: "90", footagePerRoll: "1500", numberUp: 2, bothWinders: false, hours: 1, minutes: 5, rollsLeft: "40" }) });
  assert.deepEqual(calc.readAnswers(fromWizard), { lineSpeed: "90", footagePerRoll: "1500", numberUp: 2, bothWinders: false, hours: 1, minutes: 5, rollsLeft: "40" });
  // Garbage is defaults; a throwing storage is defaults and a false save.
  assert.deepEqual(calc.readAnswers(fakeStorage({ [calc.STORAGE_KEYS.answers]: "{not json" })), calc.DEFAULT_ANSWERS);
  const throwing = { getItem() { throw new Error("no"); }, setItem() { throw new Error("no"); }, removeItem() { throw new Error("no"); } };
  assert.deepEqual(calc.readAnswers(throwing), calc.DEFAULT_ANSWERS);
  assert.equal(calc.saveAnswers(throwing, { lineSpeed: "1" }), false);
  assert.deepEqual(calc.readAnswers(null), calc.DEFAULT_ANSWERS);
  assert.equal(calc.storageFrom({ localStorage: storage }), storage);
  assert.equal(calc.storageFrom({}), null);
  assert.equal(calc.storageFrom({ get localStorage() { throw new Error("denied"); } }), null);
});

test("accepting starts a production record from the answers, now; it counts down from its timestamp and vanishes past the changeover point", () => {
  const storage = fakeStorage();
  const NOW = new Date(2026, 8, 12, 14, 0).getTime();
  const answers = { lineSpeed: "100", footagePerRoll: "1000", numberUp: 4, bothWinders: false, hours: 2, minutes: 15, rollsLeft: "18" };
  const accepted = calc.accept(storage, answers, NOW);
  assert.equal(accepted.persisted, true);
  assert.equal(accepted.estimate.totalMinutesRemaining, 175);
  assert.deepEqual(JSON.parse(storage.map.get(calc.STORAGE_KEYS.estimate)),
    { startedAt: NOW, lineSpeed: 100, footagePerRoll: 1000, numberUp: 4, bothWinders: false, rollsLeft: 18, currentSetMinutesRemaining: 135 });
  // The answers were saved too, as the wizard saves them on advancing.
  assert.equal(calc.readAnswers(storage).rollsLeft, "18");
  const record = calc.readProductionEstimate(storage);
  assert.equal(record.startedAt, NOW);
  // Rolls are re-derived from the time left at the set's rate - the
  // application's reading, not the rolls-left answer counted down.
  assert.deepEqual(calc.currentProductionEstimate(record, NOW), { sets: Math.ceil(70 / 4), remainingRolls: Math.ceil((175 / 10) * 4), remainingMinutes: 175 });
  // An hour on: re-derived from the clock, not decremented.
  const later = calc.currentProductionEstimate(record, NOW + 60 * 60000);
  assert.equal(later.remainingMinutes, 115);
  assert.equal(later.remainingRolls, Math.ceil((115 / 10) * 4));
  assert.equal(later.sets, Math.ceil(later.remainingRolls / 4));
  // Past the changeover point there is nothing to say.
  assert.equal(calc.currentProductionEstimate(record, NOW + 176 * 60000), null);
  assert.equal(calc.currentProductionEstimate(record, NOW + 175 * 60000), null);
  // Never negative, never zero.
  for (let m = 0; m <= 200; m += 5) {
    const c = calc.currentProductionEstimate(record, NOW + m * 60000);
    if (c) { assert.ok(c.sets >= 1); assert.ok(c.remainingRolls >= 1); assert.ok(c.remainingMinutes > 0); }
  }
});

test("accepting again replaces the record rather than stacking one; answers that make none clear it", () => {
  const storage = fakeStorage();
  const NOW = 1_700_000_000_000;
  calc.accept(storage, { lineSpeed: "100", footagePerRoll: "1000", numberUp: 4, bothWinders: false, hours: 2, minutes: 15, rollsLeft: "18" }, NOW);
  calc.accept(storage, { lineSpeed: "200", footagePerRoll: "1000", numberUp: 2, bothWinders: true, hours: 0, minutes: 30, rollsLeft: "8" }, NOW + 1000);
  const record = calc.readProductionEstimate(storage);
  assert.equal(record.startedAt, NOW + 1000);
  assert.equal(record.lineSpeed, 200);
  assert.equal(storage.map.size, 2, "one answers record and one estimate record");
  // A zero-minute answer set makes no record, and clears the old one - as
  // the wizard's Use does.
  const cleared = calc.accept(storage, { lineSpeed: "100", footagePerRoll: "1000", numberUp: 4, bothWinders: true, hours: 0, minutes: 0, rollsLeft: "4" }, NOW + 2000);
  assert.equal(cleared.estimate, null);
  assert.equal(storage.map.has(calc.STORAGE_KEYS.estimate), false);
  assert.equal(calc.readProductionEstimate(storage), null);
});

test("an unusable saved record is discarded without throwing, and a throwing storage reads as none", () => {
  // As app.js reads it: unparseable or unusable records are cleared; a
  // stored "null" (no record) is simply none.
  for (const bad of ["{not json", "[]", JSON.stringify({ startedAt: 0, lineSpeed: 100, footagePerRoll: 1000, numberUp: 4, rollsLeft: 18, currentSetMinutesRemaining: 135 }),
    JSON.stringify({ startedAt: 5, lineSpeed: 100, footagePerRoll: 1000, numberUp: 4, rollsLeft: 0, currentSetMinutesRemaining: 0 })]) {
    const storage = fakeStorage({ [calc.STORAGE_KEYS.estimate]: bad });
    assert.equal(calc.readProductionEstimate(storage), null, bad);
    assert.equal(storage.map.has(calc.STORAGE_KEYS.estimate), false, `${bad} was cleared`);
  }
  assert.equal(calc.readProductionEstimate(fakeStorage({ [calc.STORAGE_KEYS.estimate]: "null" })), null);
  const throwing = { getItem() { throw new Error("no"); }, setItem() { throw new Error("no"); }, removeItem() { throw new Error("no"); } };
  assert.equal(calc.readProductionEstimate(throwing), null);
  assert.equal(calc.persistProductionEstimate(throwing, calc.buildProductionEstimate({ lineSpeed: "1", footagePerRoll: "1", numberUp: 1, bothWinders: true, hours: 1, minutes: 0, rollsLeft: "1" }, 5)), false);
  assert.equal(calc.persistProductionEstimate(fakeStorage(), null), false);
  assert.equal(calc.persistProductionEstimate(fakeStorage(), { startedAt: 0 }), false);
});

test("the module is device-local and inert: no DOM, no network, no sync, no Supabase", () => {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const pattern of [/\bdocument\b/, /\bfetch\s*\(/, /supabase/i, /XMLHttpRequest/, /WebSocket/, /PolynCloudSync/, /setInterval/, /setTimeout/]) {
    assert.doesNotMatch(code, pattern, `changeover-estimate.js matches ${pattern}`);
  }
  // The one mention of localStorage is storageFrom, which reads it off the
  // environment it is handed; nothing else reaches for it.
  assert.equal((code.match(/localStorage/g) || []).length, 1);
  assert.match(code, /environment && environment\.localStorage/);
});
