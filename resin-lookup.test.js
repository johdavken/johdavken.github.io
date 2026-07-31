const test = require("node:test");
const assert = require("node:assert/strict");
const {
  findExactResin,
  findResinSuggestions,
  formatResinResult,
  getDescriptionInformation,
  getDescriptionDetails,
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
  assert.equal(getDescriptionInformation("Elastomer"), noDescriptionInformation);
  assert.equal(getDescriptionInformation(null), noDescriptionInformation);
});

test("finds color-additive information in descriptions and resin codes", () => {
  assert.match(getDescriptionInformation("Boot Film Blue", "ccblue02"), /visual identity/i);
  assert.match(getDescriptionInformation(null, "CCBLACK08"), /titanium dioxide/i);
  assert.match(getDescriptionInformation("Reef Red", "ccred03"), /UV protection/i);
});

test("finds specific polyethylene and additive information", () => {
  assert.match(getDescriptionInformation("Med. Density Hexene", "MS0440"), /hexene as the comonomer/i);
  assert.match(getDescriptionInformation("Butene", "MS1100"), /general-purpose blown film/i);
  assert.match(getDescriptionInformation("Metallocene", "MS1201"), /uniform polymer structure/i);
  assert.match(getDescriptionInformation("UVI", "A0100"), /outdoor service life/i);
  assert.match(getDescriptionInformation("CLR10227", "A1010"), /volatile corrosion inhibitor/i);
});

test("uses resin codes for specific information when descriptions are missing", () => {
  assert.match(getDescriptionInformation(null, "A1901"), /anti-pinkening/i);
  assert.match(getDescriptionInformation(null, "A0450"), /processing aid/i);
  assert.match(getDescriptionInformation(null, "A0605"), /static electricity/i);
});

test("looks up A0502 and A0503 as calcium carbonate grades", () => {
  for (const code of ["A0502", "A0503"]){
    const resin = findExactResin(code);
    assert.equal(resin.description, "Calcium Carbonate");
    assert.equal(formatResinResult(resin).density, "Unknown");
    assert.match(getDescriptionInformation(resin.description, resin.code), /increases stiffness and opacity/i);
  }
});

test("returns typical uses only for material entries that provide them", () => {
  const hexene = getDescriptionDetails("Hexene", "MS0400");
  assert.match(hexene.typicalUses, /industrial liners/i);

  const unknown = getDescriptionDetails("Elastomer", "MS5000");
  assert.equal(unknown.information, noDescriptionInformation);
  assert.equal(unknown.typicalUses, null);
});
