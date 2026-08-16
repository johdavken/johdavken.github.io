const test = require("node:test");
const assert = require("node:assert/strict");
const {
  findExactResin,
  findResinSuggestions,
  formatResinResult,
  getResinNames
} = require("./resin-lookup.js");

test("shares one complete, case-insensitively unique resin-name list", () => {
  const names = getResinNames();
  assert.equal(names.length, 135);
  assert.equal(new Set(names.map(name => name.toUpperCase())).size, names.length);
  for (const code of ["MS1230", "MS1255", "MS5006", "MS5009", "MS6000", "A2000"]){
    assert.ok(names.includes(code));
    assert.equal(findExactResin(code).resin_code, code);
  }
});

test("finds MS0440 by exact code", () => {
  const resin = findExactResin("MS0440");
  assert.equal(resin.resin_code, "MS0440");
  assert.deepEqual(formatResinResult(resin), {
    density: "0.926 g/cm³",
    bulkDensity: "Unknown"
  });
});

test("exact lookup ignores case and surrounding spaces", () => {
  assert.equal(findExactResin("ms0440").resin_code, "MS0440");
  assert.equal(findExactResin("  MS0440 ").resin_code, "MS0440");
});

test("does not confuse similar exact resin codes", () => {
  assert.equal(findExactResin("MS0700").resin_code, "MS0700");
  assert.equal(findExactResin("MS0700B").resin_code, "MS0700B");
});

test("shows Unknown for unavailable and zero source densities", () => {
  assert.equal(formatResinResult(findExactResin("ccwhite04")).density, "Unknown");
  assert.equal(formatResinResult(findExactResin("MSE Trial")).density, "Unknown");
});

test("returns Unknown fields for a code that does not exist", () => {
  assert.equal(findExactResin("DOES-NOT-EXIST"), null);
  assert.deepEqual(formatResinResult(null), { density: "Unknown", bulkDensity: "Unknown" });
});

test("suggests partial and exact codes, exact matches first", () => {
  const similar = findResinSuggestions("MS0700");
  assert.deepEqual(similar.slice(0, 2).map(resin => resin.resin_code), ["MS0700", "MS0700B"]);
});

test("suggestions no longer match by description - resins are searched by code only now that description is not stored", () => {
  assert.deepEqual(findResinSuggestions("density hexene"), []);
});
