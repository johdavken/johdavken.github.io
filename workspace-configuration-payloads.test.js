const test = require("node:test");
const assert = require("node:assert/strict");
const payloads = require("./workspace-configuration-payloads.js");

function stateFixture(lineType = 3){
  const names = payloads.expectedLayerNames(lineType);
  const layerPercentages = lineType === 3 ? [34, 33, 33] : [100];
  return {
    lineType,
    hopperNamingLine9: "standard",
    lineRate: 900,
    theme: "dark",
    layers: names.map((name, layerIndex)=>({
      name,
      layerPct: layerPercentages[layerIndex] || 0,
      hoppers: Array.from({ length: 6 }, (_, hopperIndex)=>({
        pct: hopperIndex === 0 ? 80 : hopperIndex === 1 ? 20 : 0,
        weight: layerIndex * 100 + hopperIndex + 1,
        resinName: hopperIndex === 0 ? `RESIN-${name}` : hopperIndex === 1 ? "SLIP" : "",
        track: hopperIndex === 0,
        pumpOff: hopperIndex === 1
      }))
    }))
  };
}

test("Receiver Weight Profiles include only physical layout and detached weights", () => {
  const state = stateFixture();
  const profile = payloads.createReceiverWeightProfile(state);
  assert.deepEqual(Object.keys(profile), ["schema_version", "line_type", "hopper_naming_mode", "hoppers_per_layer", "layers"]);
  assert.deepEqual(profile.layers[0].receiver_weights_lb, [1, 2, 3, 4, 5, 6]);
  state.layers[0].hoppers[0].weight = 999;
  assert.equal(profile.layers[0].receiver_weights_lb[0], 1);
  assert.equal(profile.layers[0].resinName, undefined);
});

test("Receiver Weight Profile validation rejects bad versions and malformed physical layouts", () => {
  const profile = payloads.createReceiverWeightProfile(stateFixture());
  profile.schema_version = 2;
  profile.layers[0].receiver_weights_lb.pop();
  const result = payloads.validateReceiverWeightProfile(profile);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /schema version/i);
  assert.match(result.errors.join(" "), /exactly 6 receiver weights/i);
});

test("Receiver Weight Profiles include Smart Hoppers geometry (usable height, circumference, packing factor) alongside receiver_weights_lb - same physical-equipment category, so it travels with the profile the same way", () => {
  const state = stateFixture();
  state.layers[0].hoppers[0].usableHeight = 24;
  state.layers[0].hoppers[0].circumference = 40;
  state.layers[0].hoppers[0].packingFactor = 0.6;
  const profile = payloads.createReceiverWeightProfile(state);
  assert.equal(profile.layers[0].usable_heights_in[0], 24);
  assert.equal(profile.layers[0].circumferences_in[0], 40);
  assert.equal(profile.layers[0].packing_factors[0], 0.6);
  // A hopper that never had Smart Hoppers geometry set still gets a real
  // (default) packing factor - it's meaningless without height/circumference
  // anyway, but this keeps every hopper's packing factor consistent once a
  // profile with the field at all is loaded on another device.
  assert.equal(profile.layers[0].packing_factors[1], 0.63);
  assert.equal(profile.layers[0].usable_heights_in[1], 0);
});

test("Receiver Weight Profile validation still accepts profiles saved before Smart Hoppers existed (no geometry arrays at all)", () => {
  const profile = payloads.createReceiverWeightProfile(stateFixture());
  delete profile.layers[0].usable_heights_in;
  delete profile.layers[0].circumferences_in;
  delete profile.layers[0].packing_factors;
  assert.equal(payloads.validateReceiverWeightProfile(profile).valid, true);
});

test("Receiver Weight Profile validation rejects malformed geometry when present, rather than silently ignoring it", () => {
  const shortArray = payloads.createReceiverWeightProfile(stateFixture());
  shortArray.layers[0].usable_heights_in.pop();
  let result = payloads.validateReceiverWeightProfile(shortArray);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /usable heights must contain exactly 6/i);

  const negativeCircumference = payloads.createReceiverWeightProfile(stateFixture());
  negativeCircumference.layers[0].circumferences_in[0] = -5;
  result = payloads.validateReceiverWeightProfile(negativeCircumference);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /circumference must be a finite value of 0 or greater/i);

  const badPackingFactor = payloads.createReceiverWeightProfile(stateFixture());
  badPackingFactor.layers[0].packing_factors[0] = 0.9;
  result = payloads.validateReceiverWeightProfile(badPackingFactor);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /packing factor must be between 0.58 and 0.68/i);
});

test("applying a Receiver Weight Profile with geometry writes usableHeight/circumference/packingFactor onto the matching hoppers", () => {
  const state = stateFixture();
  const profile = payloads.createReceiverWeightProfile(stateFixture());
  profile.layers[0].usable_heights_in[0] = 30;
  profile.layers[0].circumferences_in[0] = 45;
  profile.layers[0].packing_factors[0] = 0.65;
  assert.equal(payloads.applyReceiverWeightProfile(state, profile).ok, true);
  assert.equal(state.layers[0].hoppers[0].usableHeight, 30);
  assert.equal(state.layers[0].hoppers[0].circumference, 45);
  assert.equal(state.layers[0].hoppers[0].packingFactor, 0.65);
});

test("applying an old Receiver Weight Profile (no geometry arrays) leaves this device's already-configured Smart Hopper geometry untouched, rather than resetting it to 0", () => {
  const state = stateFixture();
  state.layers[0].hoppers[0].usableHeight = 22;
  state.layers[0].hoppers[0].circumference = 38;
  state.layers[0].hoppers[0].packingFactor = 0.6;
  const oldProfile = payloads.createReceiverWeightProfile(stateFixture());
  delete oldProfile.layers[0].usable_heights_in;
  delete oldProfile.layers[0].circumferences_in;
  delete oldProfile.layers[0].packing_factors;
  oldProfile.layers[0].receiver_weights_lb[0] = 500;
  assert.equal(payloads.applyReceiverWeightProfile(state, oldProfile).ok, true);
  assert.equal(state.layers[0].hoppers[0].weight, 500, "the weight itself still applies");
  assert.equal(state.layers[0].hoppers[0].usableHeight, 22, "geometry untouched, not reset to 0");
  assert.equal(state.layers[0].hoppers[0].circumference, 38);
  assert.equal(state.layers[0].hoppers[0].packingFactor, 0.6);
});

test("applying a Receiver Weight Profile changes weights only and is atomic", () => {
  const state = stateFixture();
  const profile = payloads.createReceiverWeightProfile(stateFixture());
  profile.layers[0].receiver_weights_lb[0] = 250;
  const before = JSON.parse(JSON.stringify(state));
  assert.equal(payloads.applyReceiverWeightProfile(state, profile).ok, true);
  assert.equal(state.layers[0].hoppers[0].weight, 250);
  assert.equal(state.layers[0].hoppers[0].resinName, before.layers[0].hoppers[0].resinName);
  assert.equal(state.layers[0].hoppers[0].pct, before.layers[0].hoppers[0].pct);
  assert.equal(state.layers[0].hoppers[0].track, before.layers[0].hoppers[0].track);
  assert.equal(state.layers[0].hoppers[0].pumpOff, before.layers[0].hoppers[0].pumpOff);

  const incompatible = payloads.createReceiverWeightProfile(stateFixture(1));
  const snapshot = JSON.stringify(state);
  assert.equal(payloads.applyReceiverWeightProfile(state, incompatible).ok, false);
  assert.equal(JSON.stringify(state), snapshot);

  const malformed = payloads.createReceiverWeightProfile(stateFixture());
  malformed.layers[0].receiver_weights_lb[2] = -1;
  assert.equal(payloads.applyReceiverWeightProfile(state, malformed).ok, false);
  assert.equal(JSON.stringify(state), snapshot);
});

test("Recipe payloads exclude equipment and runtime state and normalize blank resin names", () => {
  const state = stateFixture();
  state.layers[0].hoppers[2].resinName = "   ";
  const recipe = payloads.createRecipePayload(state);
  assert.deepEqual(Object.keys(recipe), ["schema_version", "line_type", "hopper_naming_mode", "layers"]);
  assert.deepEqual(Object.keys(recipe.layers[0].hoppers[0]), ["resin_name", "pct"]);
  assert.equal(recipe.layers[0].hoppers[2].resin_name, null);
  state.layers[0].hoppers[0].resinName = "CHANGED";
  assert.equal(recipe.layers[0].hoppers[0].resin_name, "RESIN-A");
});

test("Recipe validation uses existing H1 and percentage-total rules", () => {
  const recipe = payloads.createRecipePayload(stateFixture());
  assert.equal(payloads.validateRecipePayload(recipe).valid, true);
  recipe.layers[0].hoppers[0].pct = 70;
  recipe.layers[0].hoppers[2].pct = 30;
  const result = payloads.validateRecipePayload(recipe);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /hopper 1 percentage must match/i);
  assert.match(result.errors.join(" "), /hopper percentages must total 100/i);
});

test("applying a Recipe changes only recipe fields and preserves physical/runtime fields", () => {
  const state = stateFixture();
  const recipe = payloads.createRecipePayload(stateFixture());
  recipe.hopper_naming_mode = "main";
  recipe.layers[0].layer_pct = 35;
  recipe.layers[1].layer_pct = 32;
  recipe.layers[2].layer_pct = 33;
  recipe.layers[0].hoppers[1] = { resin_name: "NEW", pct: 25 };
  recipe.layers[0].hoppers[0] = { resin_name: "BASE", pct: 75 };
  const before = JSON.parse(JSON.stringify(state));
  const result = payloads.applyRecipePayload(state, recipe);
  assert.equal(result.ok, true);
  assert.equal(state.hopperNamingLine9, "main");
  assert.equal(state.layers[0].hoppers[1].resinName, "NEW");
  assert.equal(state.layers[0].hoppers[0].pct, 75);
  assert.equal(state.layers[0].hoppers[0].weight, before.layers[0].hoppers[0].weight);
  assert.equal(state.layers[0].hoppers[0].track, before.layers[0].hoppers[0].track);
  assert.equal(state.layers[0].hoppers[0].pumpOff, before.layers[0].hoppers[0].pumpOff);
  assert.equal(state.lineRate, before.lineRate);
  assert.equal(state.theme, before.theme);
});

test("applying a Recipe preserves this hopper's Smart Hoppers geometry (usableHeight/circumference/packingFactor) - a recipe never carries physical-equipment values, same as it already preserves weight/track/pumpOff", () => {
  const state = stateFixture();
  state.layers[0].hoppers[0].usableHeight = 26;
  state.layers[0].hoppers[0].circumference = 42;
  state.layers[0].hoppers[0].packingFactor = 0.61;
  const recipe = payloads.createRecipePayload(stateFixture());
  recipe.layers[0].hoppers[0] = { resin_name: "NEW-RESIN", pct: 80 };
  const result = payloads.applyRecipePayload(state, recipe);
  assert.equal(result.ok, true);
  assert.equal(state.layers[0].hoppers[0].resinName, "NEW-RESIN");
  assert.equal(state.layers[0].hoppers[0].usableHeight, 26);
  assert.equal(state.layers[0].hoppers[0].circumference, 42);
  assert.equal(state.layers[0].hoppers[0].packingFactor, 0.61);
});

test("a Recipe can change line type while preserving matching physical hoppers", () => {
  const state = stateFixture();
  const recipe = payloads.createRecipePayload(stateFixture(1));
  recipe.layers[0].hoppers[0].resin_name = "UNKNOWN-INACTIVE-CODE";
  const before = JSON.parse(JSON.stringify(state));
  const result = payloads.applyRecipePayload(state, recipe);
  assert.equal(result.ok, true);
  assert.equal(result.lineTypeChanged, true);
  assert.equal(state.lineType, 1);
  assert.equal(state.layers.length, 1);
  assert.equal(state.layers[0].hoppers[0].resinName, "UNKNOWN-INACTIVE-CODE");
  assert.equal(state.layers[0].hoppers[0].weight, before.layers[0].hoppers[0].weight);
  assert.equal(state.layers[0].hoppers[0].track, before.layers[0].hoppers[0].track);
  assert.equal(state.layers[0].hoppers[0].pumpOff, before.layers[0].hoppers[0].pumpOff);
});

test("Recipe application recalculates Hopper 1 from hoppers 2–6", () => {
  const state = stateFixture();
  const recipe = payloads.createRecipePayload(stateFixture());
  recipe.layers[0].hoppers[0] = { resin_name: "H1-RESIN", pct: 70 };
  recipe.layers[0].hoppers[1] = { resin_name: "SECONDARY", pct: 30 };
  const result = payloads.applyRecipePayload(state, recipe);
  assert.equal(result.ok, true);
  assert.equal(state.layers[0].hoppers[0].resinName, "H1-RESIN");
  assert.equal(state.layers[0].hoppers[0].pct, 70);
});

test("invalid Recipes are rejected before changing state", () => {
  const state = stateFixture();
  const recipe = payloads.createRecipePayload(stateFixture());
  recipe.schema_version = 9;
  const before = JSON.stringify(state);
  const result = payloads.applyRecipePayload(state, recipe);
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /schema version/i);
  assert.equal(JSON.stringify(state), before);
});

test("malformed Recipe structures and invalid percentages apply nothing", () => {
  const state = stateFixture();
  const malformed = payloads.createRecipePayload(stateFixture());
  malformed.layers.pop();
  const before = JSON.stringify(state);
  assert.equal(payloads.applyRecipePayload(state, malformed).ok, false);
  assert.equal(JSON.stringify(state), before);

  const invalid = payloads.createRecipePayload(stateFixture());
  invalid.layers[0].hoppers[1].pct = 101;
  assert.equal(payloads.applyRecipePayload(state, invalid).ok, false);
  assert.equal(JSON.stringify(state), before);
});
