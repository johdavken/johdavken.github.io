const test = require("node:test");
const assert = require("node:assert/strict");
const {
  findExactResin,
  findResinSuggestions,
  formatResinResult,
  getDescriptionInformation,
  noDescriptionInformation
} = require("./resin-lookup.js");

test("finds MS0440 by exact code", () => {
  const resin = findExactResin("MS0440");
  assert.equal(resin.code, "MS0440");
  assert.deepEqual(formatResinResult(resin), {
    description: "Med. Density Hexene",
    density: "0.926 g/cm³"
  });
});

test("exact lookup ignores case and surrounding spaces", () => {
  assert.equal(findExactResin("ms0440").code, "MS0440");
  assert.equal(findExactResin("  MS0440 ").code, "MS0440");
});

test("does not confuse similar exact resin codes", () => {
  assert.equal(findExactResin("MS0700").description, "MI/MN HDPE");
  assert.equal(findExactResin("MS0700B").description, "Blending HDPE");
});

test("shows Unknown for missing descriptions", () => {
  assert.equal(formatResinResult(findExactResin("MS0120")).description, "Unknown");
});

test("shows Unknown for unavailable and zero source densities", () => {
  assert.equal(formatResinResult(findExactResin("ccwhite04")).density, "Unknown");
  assert.equal(formatResinResult(findExactResin("MSE Trial")).density, "Unknown");
});

test("returns Unknown fields for a code that does not exist", () => {
  assert.equal(findExactResin("DOES-NOT-EXIST"), null);
  assert.deepEqual(formatResinResult(null), { description: "Unknown", density: "Unknown" });
});

test("suggests partial codes and descriptions with exact matches first", () => {
  const similar = findResinSuggestions("MS0700");
  assert.deepEqual(similar.slice(0, 2).map(resin => resin.code), ["MS0700", "MS0700B"]);
  assert.ok(findResinSuggestions("density hexene").some(resin => resin.code === "MS0440"));
});

test("finds material information by exact description without regard to case", () => {
  assert.match(getDescriptionInformation("anti block"), /prevent film layers from sticking/i);
  assert.match(getDescriptionInformation("SLIP"), /surface friction/i);
});

test("finds material information using recognizable description keywords", () => {
  assert.match(getDescriptionInformation("5% Oleamide Slip"), /surface friction/i);
  assert.match(getDescriptionInformation("Clarity LDPE"), /flexible/i);
  assert.match(getDescriptionInformation("MI\/MN HDPE"), /stiffer/i);
  assert.match(getDescriptionInformation("6% EVA"), /sealing performance/i);
});

test("does not confuse LLDPE information with LDPE information", () => {
  assert.match(getDescriptionInformation("Clear LLDPE"), /puncture resistance/i);
});

test("uses the fallback when no material information matches", () => {
  assert.equal(getDescriptionInformation("Med. Density Hexene"), noDescriptionInformation);
  assert.equal(getDescriptionInformation(null), noDescriptionInformation);
});
