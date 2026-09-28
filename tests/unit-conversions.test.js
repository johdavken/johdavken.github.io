"use strict";

/* unit-conversions.js: the floor's unit conversions. Pressure is the
 * pressure module's own convert() and format(); every other quantity is
 * an exact factor (temperature an exact affine), rounded only on display. */

const test = require("node:test");
const assert = require("node:assert/strict");

const pressure = require("../pressure-conversion.js");
const conv = require("../unit-conversions.js");

const read = (quantity, value, from) => conv.convert({ quantity, value, from });

test("the quantities, in the order the panel lists them, each led by its base unit", () => {
  assert.deepEqual(conv.QUANTITIES.map(one => one.key), ["pressure", "temperature", "thickness", "width", "length", "weight", "rate"]);
  assert.deepEqual(conv.QUANTITIES.map(one => one.units.map(unit => unit.label)), [
    ["PSI", "bar"], ["°F", "°C"], ["mil", "µm", "ga"], ["in", "mm"], ["ft", "m"], ["lb", "kg"], ["lb/hr", "kg/hr"]
  ]);
  assert.ok(Object.isFrozen(conv.QUANTITIES) && conv.QUANTITIES.every(one => Object.isFrozen(one) && Object.isFrozen(one.units)));
});

test("pressure is the pressure module's own: the same values, the same rounding, the same refusals", () => {
  const ours = read("pressure", "120", "psi");
  const theirs = pressure.convert({ value: "120", from: "psi" });
  assert.deepEqual(ours.values, { psi: theirs.psi, bar: theirs.bar });
  assert.equal(conv.format(ours.values.bar, "pressure", "bar"), pressure.format(theirs.bar, "bar"));
  assert.equal(conv.format(pressure.psiToBar(1), "pressure", "bar"), "0.069");
  assert.deepEqual(read("pressure", "-3", "psi").errors, ["Pressure in PSI cannot be negative."]);
  assert.deepEqual(read("pressure", "2000000", "bar").errors, pressure.convert({ value: "2000000", from: "bar" }).errors);
});

test("the exact factors: inch 25.4 mm, foot 0.3048 m, pound 0.45359237 kg, mil 25.4 µm, gauge a hundredth of a mil", () => {
  assert.equal(read("width", "1", "in").values.mm, 25.4);
  assert.ok(Math.abs(read("width", "25.4", "mm").values.in - 1) < 1e-12);
  assert.ok(Math.abs(read("length", "1", "ft").values.m - 0.3048) < 1e-12);
  assert.ok(Math.abs(read("weight", "1", "lb").values.kg - 0.45359237) < 1e-12);
  assert.ok(Math.abs(read("rate", "1000", "lbhr").values.kghr - 453.59237) < 1e-9);
  const film = read("thickness", "2", "mil").values;
  assert.equal(film.mil, 2);
  assert.ok(Math.abs(film.um - 50.8) < 1e-9);
  assert.ok(Math.abs(film.gauge - 200) < 1e-9);
  assert.ok(Math.abs(read("thickness", "80", "gauge").values.mil - 0.8) < 1e-12);
  // The typed unit is the figure as typed, never a round trip.
  assert.equal(read("weight", "310", "lb").values.lb, 310);
});

test("temperature is affine, signed, and floored at absolute zero", () => {
  assert.equal(read("temperature", "32", "f").values.c, 0);
  assert.equal(read("temperature", "100", "c").values.f, 212);
  assert.equal(read("temperature", "-40", "c").values.f, -40);
  assert.equal(conv.format(read("temperature", "400", "f").values.c, "temperature", "c"), "204.4");
  assert.equal(read("temperature", "-459.67", "f").valid, true);
  assert.deepEqual(read("temperature", "-500", "f").errors, ["That is below absolute zero."]);
  assert.deepEqual(read("temperature", "-274", "c").errors, ["That is below absolute zero."]);
});

test("entries are read the way an operator types them and refused in the quantity's words", () => {
  assert.equal(read("weight", ".5", "kg").values.kg, 0.5);
  assert.equal(read("length", "1,000", "ft").values.ft, 1000);
  assert.deepEqual(read("weight", "-1", "lb").errors, ["Weight in lb cannot be negative."]);
  assert.deepEqual(read("width", "abc", "mm").errors, ["Width in mm must be a number."]);
  assert.deepEqual(read("length", "", "ft").errors, ["Length in ft must be a number."]);
  assert.deepEqual(read("rate", "2000000", "kghr").errors, ["Output in kg/hr must be 1,000,000 or less."]);
  assert.deepEqual(read("weight", "1", "stone").errors, ["The unit must be lb or kg."]);
  assert.deepEqual(read("volume", "1", "l").errors, ["That is not a conversion."]);
});

test("format reads each unit in its places, one more under one, and never a negative zero", () => {
  assert.equal(conv.format(140.6135, "weight", "kg"), "140.61");
  assert.equal(conv.format(0.4536, "weight", "kg"), "0.454");
  assert.equal(conv.format(200, "thickness", "gauge"), "200");
  assert.equal(conv.format(0.8, "thickness", "mil"), "0.800");
  assert.equal(conv.format(-0.00001, "temperature", "c"), "0.00");
  assert.equal(conv.format(0, "length", "m"), "0.00");
  assert.equal(conv.format(Number.NaN, "length", "m"), "—");
});

test("pounds per thousand feet: roll weight x rolls per set / (footage / 1,000), or layflat width x mil x 12 / 15", () => {
  assert.equal(conv.CUBIC_INCHES, 12);
  assert.equal(conv.TUBE_DIVISOR, 15);
  assert.equal(conv.CUBIC_INCHES / conv.TUBE_DIVISOR, 0.8);
  assert.deepEqual(Object.keys(conv.PER_THOUSAND), ["rolls", "width"]);
  assert.deepEqual(conv.PER_THOUSAND.rolls.map(field => [field.key, field.unit]), [["rollWeight", "lb"], ["rolls", ""], ["footage", "ft"]]);
  // Footage is typed in feet: 10,000 ft is ten thousands.
  const rolls = conv.poundsPerThousand("rolls", { rollWeight: "500", rolls: "4", footage: "10000" });
  assert.deepEqual(rolls, { valid: true, errors: [], lbPerThousand: 200 });
  assert.equal(conv.poundsPerThousand("rolls", { rollWeight: "1,200", rolls: "1", footage: "500" }).lbPerThousand, 2400);
  assert.ok(Math.abs(conv.poundsPerThousand("width", { width: "48", mil: "1.5" }).lbPerThousand - 57.6) < 1e-12);
  assert.equal(conv.formatPerThousand(57.6), "57.60");
  assert.equal(conv.formatPerThousand(Number.NaN), "—");
});

test("pounds per thousand feet refuses each entry in its own words and never divides by zero", () => {
  assert.deepEqual(conv.poundsPerThousand("rolls", { rollWeight: "500", rolls: "2.5", footage: "0" }).errors,
    ["Rolls per set must be a whole number.", "Footage must be more than zero."]);
  assert.deepEqual(conv.poundsPerThousand("rolls", { rollWeight: "abc", rolls: "1", footage: "5000" }).errors, ["Max roll weight must be a number."]);
  assert.deepEqual(conv.poundsPerThousand("width", { width: "48", mil: "-1" }).errors, ["Thickness must be more than zero."]);
  assert.deepEqual(conv.poundsPerThousand("width", { width: "2000000", mil: "1" }).errors, ["Width (on the roll) must be 1,000,000 or less."]);
  assert.deepEqual(conv.poundsPerThousand("gauge", {}).errors, ["That is not a way to work out pounds per thousand feet."]);
  assert.equal(conv.poundsPerThousand("rolls").valid, false);
});

test("the film's way takes an optional density: empty is 12 ÷ 15; given, the 15 is 13.84 ÷ density (15.04 at 0.92)", () => {
  assert.equal(conv.LB_PER_IN3_PER_G_CM3, require("../line-rate-estimate.js").LB_PER_IN3_PER_G_CM3, "the density factor differs from the line rate's");
  assert.ok(Math.abs(conv.divisorFor(1) - 13.84) < 0.001);
  assert.ok(Math.abs(conv.divisorFor(0.92) - 15.04) < 0.005);
  assert.deepEqual(conv.poundsPerThousand("width", { width: "48", mil: "1.5", density: "" }), { valid: true, errors: [], lbPerThousand: 57.6, divisor: 15, density: null });
  assert.deepEqual(conv.poundsPerThousand("width", { width: "48", mil: "1.5" }).density, null);
  const dense = conv.poundsPerThousand("width", { width: "48", mil: "1.5", density: "0.95" });
  assert.equal(dense.density, 0.95);
  assert.ok(Math.abs(dense.lbPerThousand - 48 * 1.5 * 12 * 2 * 0.95 * 0.0361273) < 1e-9);
  assert.deepEqual(conv.poundsPerThousand("width", { width: "48", mil: "1.5", density: "0" }).errors, ["Density must be more than zero."]);
  assert.deepEqual(conv.poundsPerThousand("width", { width: "48", mil: "1.5", density: "11" }).errors, ["Density must be 10 or less."]);
  assert.deepEqual(conv.poundsPerThousand("width", { width: "48", mil: "1.5", density: "x" }).errors, ["Density must be a number."]);
});

test("the weighed set's check: the density and gauge a weighed set implies, and how far it reads from the film", () => {
  // Line 8: 72.5 in, 0.395 mil, a set at 24.93 lb/1,000 ft.
  const plain = conv.weighedSetCheck(24.93, { width: "72.5", mil: "0.395", density: null, lbPerThousand: 22.91 });
  assert.ok(Math.abs(plain.impliedDensity - 24.93 / (72.5 * 0.395 * 24 * 0.0361273)) < 1e-12);
  assert.equal(plain.impliedDensity.toFixed(3), "1.004");
  assert.ok(Math.abs(plain.impliedMil - 24.93 * 15 / (72.5 * 12)) < 1e-12, "without a density the gauge uses the floor's 15");
  assert.ok(Math.abs(plain.difference - (24.93 / 22.91 - 1)) < 1e-12);
  assert.equal(plain.plausible, true);
  const dense = conv.weighedSetCheck(24.93, { width: "72.5", mil: "0.395", density: "1.0021" });
  assert.ok(Math.abs(dense.impliedMil - 24.93 * conv.divisorFor(1.0021) / (72.5 * 12)) < 1e-12);
  assert.equal(dense.difference, null, "a difference without the film's figure");
  // Working the film's own figure back gives its own inputs.
  const film = conv.poundsPerThousand("width", { width: "48", mil: "1.5", density: "0.95" });
  const round = conv.weighedSetCheck(film.lbPerThousand, { width: "48", mil: "1.5", density: "0.95", lbPerThousand: film.lbPerThousand });
  assert.ok(Math.abs(round.impliedDensity - 0.95) < 1e-12 && Math.abs(round.impliedMil - 1.5) < 1e-12 && Math.abs(round.difference) < 1e-12);
  // What is missing is null, never guessed; an impossible density is flagged.
  assert.deepEqual(conv.weighedSetCheck(24.93, { width: "72.5" }), { impliedDensity: null, impliedMil: 24.93 * 15 / (72.5 * 12), difference: null, plausible: true });
  assert.deepEqual(conv.weighedSetCheck(null, { width: "72.5", mil: "1" }), { impliedDensity: null, impliedMil: null, difference: null, plausible: true });
  assert.equal(conv.weighedSetCheck(249.3, { width: "72.5", mil: "0.395" }).plausible, false);
  assert.deepEqual(conv.PLAUSIBLE_DENSITY, { min: 0.85, max: 2.5 });
});
