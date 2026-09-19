"use strict";

/* pressure-conversion.js: psi and bar, one exact factor both ways.
 *
 * The module is the single place the factor lives; the Station Pressure
 * converter reads it and computes nothing. These tests pin the factor,
 * the round trip, what is refused and how, the two display roundings and
 * the gauge ladder.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const calc = require("./pressure-conversion.js");

test("one factor, both ways: a psi is 6894.757293168 Pa over a bar's 100 000, and the reciprocal is derived, not restated", () => {
  assert.equal(calc.PSI_PER_BAR, 14.503773773);
  assert.equal(calc.BAR_PER_PSI, 1 / 14.503773773);
  assert.ok(Math.abs(calc.psiToBar(1) - 0.0689475729) < 1e-9);
  assert.ok(Math.abs(calc.barToPsi(1) - 14.503773773) < 1e-12);
  assert.ok(Math.abs(calc.psiToBar(14.503773773) - 1) < 1e-12);
  // The round trip is exact to the float.
  for (const psi of [0, 0.5, 15, 100, 2500, 999999]) {
    assert.ok(Math.abs(calc.barToPsi(calc.psiToBar(psi)) - psi) < 1e-9, `${psi} psi round trip`);
  }
  assert.deepEqual(calc.UNITS.map(u => u.key), ["psi", "bar"]);
  assert.deepEqual(calc.UNITS.map(u => u.label), ["PSI", "bar"]);
  assert.ok(Object.isFrozen(calc.UNITS));
});

test("convert: an entry in either unit gives both; typed strings parse as an operator types them; the unit is said back", () => {
  const fromPsi = calc.convert({ value: "100", from: "psi" });
  assert.equal(fromPsi.valid, true);
  assert.deepEqual(fromPsi.errors, []);
  assert.equal(fromPsi.from, "psi");
  assert.equal(fromPsi.psi, 100);
  assert.ok(Math.abs(fromPsi.bar - 6.89475729) < 1e-8);
  const fromBar = calc.convert({ value: 7, from: "bar" });
  assert.equal(fromBar.valid, true);
  assert.equal(fromBar.bar, 7);
  assert.ok(Math.abs(fromBar.psi - 101.526416411) < 1e-8);
  // Leading decimal, a thousands comma, surrounding space.
  assert.equal(calc.convert({ value: ".5", from: "bar" }).bar, 0.5);
  assert.equal(calc.convert({ value: " 1,500 ", from: "psi" }).psi, 1500);
  // Zero is a reading.
  const zero = calc.convert({ value: "0", from: "psi" });
  assert.equal(zero.valid, true);
  assert.equal(zero.bar, 0);
});

test("convert refuses what it cannot draw, one message naming the unit: a blank, a word, a negative, an entry over the ceiling, an unknown unit", () => {
  const blank = calc.convert({ value: "", from: "psi" });
  assert.equal(blank.valid, false);
  assert.deepEqual(blank.errors, ["Pressure in PSI must be a number."]);
  assert.deepEqual(calc.convert({ value: "abc", from: "bar" }).errors, ["Pressure in bar must be a number."]);
  assert.deepEqual(calc.convert({ value: "-3", from: "psi" }).errors, ["Pressure in PSI cannot be negative."]);
  assert.deepEqual(calc.convert({ value: "1000001", from: "bar" }).errors, ["Pressure in bar must be 1,000,000 or less."]);
  assert.equal(calc.convert({ value: "1000000", from: "bar" }).valid, true, "the ceiling itself is allowed");
  assert.deepEqual(calc.convert({ value: "1", from: "kpa" }).errors, ["The unit must be psi or bar."]);
  assert.deepEqual(calc.convert().errors, ["The unit must be psi or bar."]);
  assert.equal(calc.convert({ value: Infinity, from: "psi" }).valid, false);
  assert.equal(calc.MAX_ENTRY, 1000000);
});

test("display: psi in tenths and bar in hundredths, each one place finer under one so a small pressure is not shown as nought; a non-number is a dash", () => {
  assert.equal(calc.formatPsi(100), "100.0");
  assert.equal(calc.formatPsi(14.503773773), "14.5");
  assert.equal(calc.formatPsi(0.5), "0.50");
  assert.equal(calc.formatPsi(0), "0.0");
  assert.equal(calc.formatBar(6.89475729), "6.89");
  assert.equal(calc.formatBar(0.0689475729), "0.069");
  assert.equal(calc.formatBar(0), "0.00");
  assert.equal(calc.formatBar(1), "1.00");
  assert.equal(calc.format(100, "psi"), "100.0");
  assert.equal(calc.format(100, "bar"), "100.00");
  assert.equal(calc.formatPsi("x"), "—");
  assert.equal(calc.formatBar(undefined), "—");
});

test("the gauge ladder: the first of 15, 30, 60, 100, 150, 300... at or above the reading, never under 15, unbounded above", () => {
  assert.equal(calc.scaleFor(0), 15);
  assert.equal(calc.scaleFor(-1), 15);
  assert.equal(calc.scaleFor("x"), 15);
  assert.equal(calc.scaleFor(7), 15);
  assert.equal(calc.scaleFor(15), 15);
  assert.equal(calc.scaleFor(15.1), 30);
  assert.equal(calc.scaleFor(45), 60);
  assert.equal(calc.scaleFor(60), 60);
  assert.equal(calc.scaleFor(100), 100);
  assert.equal(calc.scaleFor(101), 150);
  assert.equal(calc.scaleFor(250), 300);
  assert.equal(calc.scaleFor(500), 600);
  assert.equal(calc.scaleFor(1000), 1000);
  assert.equal(calc.scaleFor(2500), 3000);
  assert.equal(calc.scaleFor(6.89), 15);
  assert.equal(calc.scaleFor(999999), 1000000);
  assert.equal(calc.scaleFor(1000001), 1500000);
});

test("the reference strip: common line pressures in psi, each with its bar", () => {
  assert.deepEqual([...calc.REFERENCE_PSI], [15, 30, 60, 100, 250, 500, 1000, 3000]);
  const rows = calc.reference();
  assert.deepEqual(rows.map(r => r.psi), [...calc.REFERENCE_PSI]);
  assert.deepEqual(rows.map(r => calc.formatBar(r.bar)), ["1.03", "2.07", "4.14", "6.89", "17.24", "34.47", "68.95", "206.84"]);
  assert.equal(typeof calc.NOTICE, "string");
  assert.ok(calc.NOTICE.length > 0);
});
