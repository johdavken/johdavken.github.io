"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  TENSION_BANDS,
  NOTICE,
  findTensionBand,
  calculate,
  formatTension,
  formatPli
} = require("./winding-tension.js");

// Every row here is an observed output of the tool this calculator
// reproduces, asserted after display rounding rather than at full float
// precision - 2.3 mil at 106 in is 34.98 lb internally and reads 35.0.
const OBSERVED = [
  { mil: 0.5, width: 100, ups: 1, pli: "0.175", target: "17.5", min: "15.0", max: "20.0", taper: "50%",      wind: "Surface Wind Only" },
  { mil: 1,   width: 100, ups: 1, pli: "0.2",   target: "20.0", min: "20.0", max: "40.0", taper: "30 – 50%", wind: "Surface Wind or Center/Surface" },
  { mil: 2.3, width: 106, ups: 1, pli: "0.33",  target: "35.0", min: "21.2", max: "42.4", taper: "30 – 50%", wind: "Surface Wind or Center/Surface" },
  { mil: 2.3, width: 106, ups: 2, pli: "0.33",  target: "70.0", min: "42.4", max: "84.8", taper: "30 – 50%", wind: "Surface Wind or Center/Surface" },
  { mil: 3,   width: 100, ups: 1, pli: "0.4",   target: "40.0", min: "20.0", max: "40.0", taper: "30 – 50%", wind: "Surface Wind or Center/Surface" },
  { mil: 4,   width: 100, ups: 1, pli: "0.6",   target: "60.0", min: "40.0", max: "80.0", taper: "20 – 40%", wind: "Surface Wind or Center/Surface" },
  { mil: 5,   width: 100, ups: 1, pli: "0.8",   target: "80.0", min: "40.0", max: "80.0", taper: "20 – 40%", wind: "Surface Wind or Center/Surface" },
  { mil: 8,   width: 100, ups: 1, pli: "0.84",  target: "84.0", min: "80.0", max: "100.0", taper: "20%",     wind: "Surface Wind or Center/Surface" }
];

for (const row of OBSERVED){
  test(`${row.mil} mil at ${row.width} in x ${row.ups} up reproduces the observed result`, () => {
    const result = calculate({ filmThicknessMil: row.mil, rollWidthIn: row.width, ups: row.ups });
    assert.equal(result.valid, true);
    assert.equal(formatPli(result.pli), row.pli);
    assert.equal(formatTension(result.target), row.target);
    assert.equal(formatTension(result.min), row.min);
    assert.equal(formatTension(result.max), row.max);
    assert.equal(result.taper, row.taper);
    assert.equal(result.wind, row.wind);
  });
}

test("the band table is continuous through its published breakpoints", () => {
  // Each band's high PLI is the next band's low, so the interpolated curve
  // has no step at a band edge.
  for (let i = 0; i < TENSION_BANDS.length - 1; i += 1){
    assert.equal(TENSION_BANDS[i].hi, TENSION_BANDS[i + 1].lo);
    assert.equal(TENSION_BANDS[i].t1, TENSION_BANDS[i + 1].t0);
  }
  const breakpoints = [[0, 0.15], [1, 0.2], [3, 0.4], [5, 0.8], [20, 1]];
  for (const [mil, pli] of breakpoints){
    const band = findTensionBand(mil);
    const value = band.lo + ((mil - band.t0) / (band.t1 - band.t0)) * (band.hi - band.lo);
    assert.ok(Math.abs(Math.min(value, band.hi) - pli) < 1e-12, `${mil} mil should be ${pli} PLI`);
  }
});

test("band edges resolve to the first matching band: 1 and 3 mil are band 1, 5 mil is band 2", () => {
  assert.equal(TENSION_BANDS.indexOf(findTensionBand(0.999)), 0);
  assert.equal(TENSION_BANDS.indexOf(findTensionBand(1)), 1);
  assert.equal(TENSION_BANDS.indexOf(findTensionBand(3)), 1);
  assert.equal(TENSION_BANDS.indexOf(findTensionBand(3.001)), 2);
  assert.equal(TENSION_BANDS.indexOf(findTensionBand(5)), 2);
  assert.equal(TENSION_BANDS.indexOf(findTensionBand(5.001)), 3);
});

test("exactly 1 mil takes band 1's wind type and taper, not band 0's surface-wind-only advice", () => {
  const justUnder = calculate({ filmThicknessMil: 0.999, rollWidthIn: 100, ups: 1 });
  const exactly = calculate({ filmThicknessMil: 1, rollWidthIn: 100, ups: 1 });
  assert.equal(justUnder.wind, "Surface Wind Only");
  assert.equal(justUnder.taper, "50%");
  assert.equal(exactly.wind, "Surface Wind or Center/Surface");
  assert.equal(exactly.taper, "30 – 50%");
  // The PLI itself is continuous across that edge even though the advice is not.
  assert.ok(Math.abs(exactly.pli - justUnder.pli) < 0.001);
});

test("exactly 5 mil stays in band 2's 0.40-0.80 range rather than opening band 3's", () => {
  const exactly = calculate({ filmThicknessMil: 5, rollWidthIn: 100, ups: 1 });
  const justOver = calculate({ filmThicknessMil: 5.001, rollWidthIn: 100, ups: 1 });
  assert.equal(formatTension(exactly.min), "40.0");
  assert.equal(formatTension(exactly.max), "80.0");
  assert.equal(formatTension(justOver.min), "80.0");
  assert.equal(formatTension(justOver.max), "100.0");
});

test("band 3 is linear through 12 mil - confirmed against the source calculator, not extrapolated from the 8 mil point alone", () => {
  // 8 mil and 12 mil are both observed. Two points on the same line means
  // band 3's slope is measured rather than assumed; what they do NOT pin
  // down is where that line ends, since 12 mil is inside the linear region
  // whatever the terminus is. See the band table's comment.
  const twelve = calculate({ filmThicknessMil: 12, rollWidthIn: 100, ups: 1 });
  assert.equal(formatPli(twelve.pli), "0.893");
  assert.equal(formatTension(twelve.target), "89.3");
  assert.equal(formatTension(twelve.min), "80.0");
  assert.equal(formatTension(twelve.max), "100.0");
  assert.equal(twelve.taper, "20%");
  assert.equal(twelve.wind, "Surface Wind or Center/Surface");

  const slope = (mil, next) => {
    const a = calculate({ filmThicknessMil: mil, rollWidthIn: 1, ups: 1 }).pli;
    const b = calculate({ filmThicknessMil: next, rollWidthIn: 1, ups: 1 }).pli;
    return (b - a) / (next - mil);
  };
  assert.ok(Math.abs(slope(5, 8) - slope(8, 12)) < 1e-12,
    "the 5-8 and 8-12 segments must lie on one line");
});

test("PLI is clamped to 1.00 above 20 mil instead of extrapolating past the top breakpoint", () => {
  assert.equal(calculate({ filmThicknessMil: 20, rollWidthIn: 100, ups: 1 }).pli, 1);
  assert.equal(calculate({ filmThicknessMil: 25, rollWidthIn: 100, ups: 1 }).pli, 1);
  assert.equal(calculate({ filmThicknessMil: 1000, rollWidthIn: 100, ups: 1 }).pli, 1);
  const clamped = calculate({ filmThicknessMil: 40, rollWidthIn: 100, ups: 1 });
  assert.equal(formatTension(clamped.target), "100.0");
  assert.equal(formatTension(clamped.max), "100.0");
});

test("number of ups scales target, min and max together and leaves PLI alone", () => {
  const one = calculate({ filmThicknessMil: 2.3, rollWidthIn: 106, ups: 1 });
  const three = calculate({ filmThicknessMil: 2.3, rollWidthIn: 106, ups: 3 });
  assert.equal(three.pli, one.pli);
  assert.ok(Math.abs(three.target - one.target * 3) < 1e-9);
  assert.ok(Math.abs(three.min - one.min * 3) < 1e-9);
  assert.ok(Math.abs(three.max - one.max * 3) < 1e-9);
});

test("ups defaults to 1 when it is not supplied", () => {
  const implicit = calculate({ filmThicknessMil: 4, rollWidthIn: 100 });
  const explicit = calculate({ filmThicknessMil: 4, rollWidthIn: 100, ups: 1 });
  assert.equal(implicit.valid, true);
  assert.equal(implicit.ups, 1);
  assert.deepEqual(implicit.target, explicit.target);
});

test("operator-typed strings are accepted, including a leading decimal point", () => {
  const typed = calculate({ filmThicknessMil: ".5", rollWidthIn: "100", ups: "1" });
  assert.equal(typed.valid, true);
  assert.equal(formatPli(typed.pli), "0.175");
  assert.equal(formatTension(typed.target), "17.5");
  assert.equal(calculate({ filmThicknessMil: " 2.3 ", rollWidthIn: "106", ups: "2" }).valid, true);
});

test("zero, negative, blank and non-numeric inputs are rejected without a result", () => {
  const cases = [
    { filmThicknessMil: 0, rollWidthIn: 100, ups: 1 },
    { filmThicknessMil: -1, rollWidthIn: 100, ups: 1 },
    { filmThicknessMil: "", rollWidthIn: 100, ups: 1 },
    { filmThicknessMil: "abc", rollWidthIn: 100, ups: 1 },
    { filmThicknessMil: 2, rollWidthIn: 0, ups: 1 },
    { filmThicknessMil: 2, rollWidthIn: -100, ups: 1 },
    { filmThicknessMil: 2, rollWidthIn: "", ups: 1 },
    { filmThicknessMil: Infinity, rollWidthIn: 100, ups: 1 }
  ];
  for (const input of cases){
    const result = calculate(input);
    assert.equal(result.valid, false, `${JSON.stringify(input)} should be rejected`);
    assert.ok(result.errors.length > 0);
    assert.equal(result.pli, undefined);
    assert.equal(result.target, undefined);
  }
  assert.equal(calculate().valid, false);
});

test("ups must be a whole number of 1 or more", () => {
  for (const ups of [0, -2, 1.5, "", "two", NaN]){
    const result = calculate({ filmThicknessMil: 2, rollWidthIn: 100, ups });
    assert.equal(result.valid, false, `${String(ups)} ups should be rejected`);
    assert.ok(result.errors.some(message => /ups/i.test(message)));
  }
  assert.equal(calculate({ filmThicknessMil: 2, rollWidthIn: 100, ups: 4 }).valid, true);
});

test("each invalid field reports its own message, so more than one can be wrong at once", () => {
  const result = calculate({ filmThicknessMil: 0, rollWidthIn: 0, ups: 0 });
  assert.equal(result.errors.length, 3);
  assert.ok(result.errors.some(message => /Film thickness/.test(message)));
  assert.ok(result.errors.some(message => /Roll width/.test(message)));
  assert.ok(result.errors.some(message => /ups/i.test(message)));
});

test("formatPli rounds to three decimals and drops trailing zeros, hiding float artifacts", () => {
  assert.equal(formatPli(0.2), "0.2");
  assert.equal(formatPli(0.32999999999999996), "0.33");
  assert.equal(formatPli(0.175), "0.175");
  assert.equal(formatPli(0.8400000000000001), "0.84");
  assert.equal(formatPli(1), "1");
  assert.equal(formatPli("nope"), "—");
});

test("formatTension always shows one decimal place", () => {
  assert.equal(formatTension(34.98), "35.0");
  assert.equal(formatTension(20), "20.0");
  assert.equal(formatTension(15.04), "15.0");
  assert.equal(formatTension("nope"), "—");
});

test("the operator notice is carried by the module, not retyped at the call site", () => {
  assert.equal(NOTICE, "These are the recommended starting points for this product. "
    + "Make the necessary adjustments based on the product being produced.");
});

test("the band table is frozen, so a caller cannot edit the reference values at runtime", () => {
  assert.throws(() => { TENSION_BANDS.push({}); });
  assert.throws(() => { TENSION_BANDS[0].lo = 9; }, TypeError);
});
