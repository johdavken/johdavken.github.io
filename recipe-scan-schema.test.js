"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { sanitizeRecipeScanResult, sanitizeDosingScreenScanResult, sanitizeHeatSheetScanResult, validateImage, totalStatus, DOSING_SCREEN_COMPONENTS_PER_LAYER, MAX_LOT_LENGTH } = require("./recipe-scan-schema.js");

function validComponent(overrides = {}) {
  return {
    resin_code: "MS0440", resin_code_confidence: 0.9,
    percentage: 79, percentage_confidence: 0.9,
    hopper_designation: null, hopper_designation_confidence: null,
    ...overrides
  };
}

function validLayer(position, overrides = {}) {
  return {
    position, position_confidence: 0.9,
    layer_percentage: 20, layer_percentage_confidence: 0.8,
    components: [validComponent({ percentage: 79 }), validComponent({ resin_code: "MS1307", percentage: 21 })],
    ...overrides
  };
}

function threeLayerRecipe(overrides = {}) {
  return {
    recipe: {
      name: null,
      layers: [validLayer("inside"), validLayer("core"), validLayer("outside")]
    },
    ...overrides
  };
}

// --- success cases ----------------------------------------------------

test("accepts a well-formed 3-layer result matching a real line configuration", () => {
  const result = sanitizeRecipeScanResult(threeLayerRecipe());
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
  assert.equal(result.value.recipe.layer_count, 3);
  assert.deepEqual(result.value.recipe.layers.map(l => l.position), ["inside", "core", "outside"]);
});

test("accepts a 1-layer result using the 'single' position", () => {
  const result = sanitizeRecipeScanResult({
    recipe: { name: null, layers: [validLayer("single", { layer_percentage: 100 })] }
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.recipe.layer_count, 1);
});

test("accepts a 5-layer result using the full inside->outside position sequence", () => {
  const positions = ["inside", "inside_subskin", "core", "outside_subskin", "outside"];
  const result = sanitizeRecipeScanResult({
    recipe: { name: null, layers: positions.map(p => validLayer(p)) }
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.recipe.layers.map(l => l.position), positions);
});

// --- layer count must match a real line configuration ------------------

test("rejects a layer count that isn't 1, 3, or 5 - it could never be applied to any line", () => {
  const result = sanitizeRecipeScanResult({
    recipe: { name: null, layers: [validLayer("inside"), validLayer("core")] } // 2 layers
  });
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /doesn't match a valid line configuration/);
});

test("rejects more than 5 layers and rejects zero layers", () => {
  const tooMany = sanitizeRecipeScanResult({
    recipe: { name: null, layers: Array.from({ length: 6 }, () => validLayer("inside")) }
  });
  assert.equal(tooMany.ok, false);

  const none = sanitizeRecipeScanResult({ recipe: { name: null, layers: [] } });
  assert.equal(none.ok, false);
});

test("a position must match the set expected for the actual layer count returned", () => {
  // 3 layers, but using a 5-layer-only position name
  const result = sanitizeRecipeScanResult({
    recipe: { name: null, layers: [validLayer("inside_subskin"), validLayer("core"), validLayer("outside")] }
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /position/);
});

// --- components: omission, caps, null-vs-invalid ------------------------

test("does not require padding components up to 6 - the printed form's zero-rows are omitted, not returned", () => {
  const result = sanitizeRecipeScanResult(threeLayerRecipe());
  assert.equal(result.ok, true);
  assert.equal(result.value.recipe.layers[0].components.length, 2);
});

test("rejects a layer with zero components and rejects more than 6", () => {
  const empty = sanitizeRecipeScanResult({
    recipe: { name: null, layers: [validLayer("inside", { components: [] }), validLayer("core"), validLayer("outside")] }
  });
  assert.equal(empty.ok, false);

  const tooMany = sanitizeRecipeScanResult({
    recipe: {
      name: null,
      layers: [validLayer("inside", { components: Array.from({ length: 7 }, () => validComponent()) }), validLayer("core"), validLayer("outside")]
    }
  });
  assert.equal(tooMany.ok, false);
});

test("null percentage/resin_code/confidence are accepted as uncertainty, not rejected", () => {
  const result = sanitizeRecipeScanResult({
    recipe: {
      name: null,
      layers: [
        validLayer("inside", { components: [validComponent({ resin_code: null, percentage: null, resin_code_confidence: null, percentage_confidence: null })] }),
        validLayer("core"), validLayer("outside")
      ]
    }
  });
  assert.equal(result.ok, true);
});

test("rejects an out-of-range percentage or confidence rather than silently clamping it", () => {
  const badPct = sanitizeRecipeScanResult({
    recipe: { name: null, layers: [validLayer("inside", { components: [validComponent({ percentage: 150 })] }), validLayer("core"), validLayer("outside")] }
  });
  assert.equal(badPct.ok, false);

  const badConfidence = sanitizeRecipeScanResult({
    recipe: { name: null, layers: [validLayer("inside", { components: [validComponent({ percentage_confidence: 1.5 })] }), validLayer("core"), validLayer("outside")] }
  });
  assert.equal(badConfidence.ok, false);
});

// --- handwritten hopper designation --------------------------------------

test("accepts a valid hopper_designation (H1-H6) on a component", () => {
  const result = sanitizeRecipeScanResult({
    recipe: {
      name: null,
      layers: [
        validLayer("inside", { components: [validComponent({ hopper_designation: "H3", hopper_designation_confidence: 0.7 })] }),
        validLayer("core"), validLayer("outside")
      ]
    }
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.recipe.layers[0].components[0].hopper_designation, "H3");
});

test("rejects a hopper_designation outside H1-H6 - normalization to that form is the Edge Function prompt's job, not this validator's to guess", () => {
  const result = sanitizeRecipeScanResult({
    recipe: {
      name: null,
      layers: [
        validLayer("inside", { components: [validComponent({ hopper_designation: "M" })] }),
        validLayer("core"), validLayer("outside")
      ]
    }
  });
  assert.equal(result.ok, false);
});

test("hopper_designation is null by default and that's valid - most components won't have one", () => {
  const result = sanitizeRecipeScanResult(threeLayerRecipe());
  assert.equal(result.ok, true);
  assert.equal(result.value.recipe.layers[0].components[0].hopper_designation, null);
});

// --- percentage totals: informational, not rejection ---------------------

test("totalStatus: empty, incomplete (any null), invalid (complete but off), ok (within tolerance)", () => {
  assert.equal(totalStatus([]), "empty");
  assert.equal(totalStatus([50, null, 50]), "incomplete");
  assert.equal(totalStatus([50, 30]), "invalid");
  assert.equal(totalStatus([60, 40]), "ok");
  assert.equal(totalStatus([60.2, 39.9]), "ok", "small floating point slack must be tolerated");
});

test("a layer whose components don't sum to 100 is still accepted, but flagged incomplete/invalid rather than rejected", () => {
  const result = sanitizeRecipeScanResult({
    recipe: {
      name: null,
      layers: [
        validLayer("inside", { components: [validComponent({ percentage: 50 }), validComponent({ percentage: 30 })] }), // sums to 80
        validLayer("core"), validLayer("outside")
      ]
    }
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.recipe.layers[0].component_percentage_total_status, "invalid");
});

test("a layer_percentage total across layers reflects incomplete when any layer's percentage is null", () => {
  const result = sanitizeRecipeScanResult({
    recipe: {
      name: null,
      layers: [validLayer("inside", { layer_percentage: null }), validLayer("core"), validLayer("outside")]
    }
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.recipe.layer_percentage_total_status, "incomplete");
});

// --- unknown/extra properties: stripped, not fatal ------------------------

test("strips unknown properties instead of failing the whole request (provider envelope quirks shouldn't be fatal)", () => {
  const result = sanitizeRecipeScanResult({
    unexpected_envelope_field: "provider metadata",
    recipe: {
      name: null,
      layers: [validLayer("inside", { some_extra_field: "ignored" }), validLayer("core"), validLayer("outside")],
      extra: true
    }
  });
  assert.equal(result.ok, true);
  assert.equal("unexpected_envelope_field" in result.value, false);
  assert.equal("some_extra_field" in result.value.recipe.layers[0], false);
});

test("rejects a non-object response and a missing/non-array layers field", () => {
  assert.equal(sanitizeRecipeScanResult(null).ok, false);
  assert.equal(sanitizeRecipeScanResult("oops").ok, false);
  assert.equal(sanitizeRecipeScanResult({ recipe: { name: null } }).ok, false);
});

// --- validateImage ---------------------------------------------------------

function bytesFrom(...values) { return new Uint8Array(values); }

test("validateImage accepts correctly signed jpeg/png/webp", () => {
  const jpeg = bytesFrom(0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0);
  assert.equal(validateImage(jpeg, "image/jpeg", jpeg.length).ok, true);

  const png = bytesFrom(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0);
  assert.equal(validateImage(png, "image/png", png.length).ok, true);

  const webp = bytesFrom(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50);
  assert.equal(validateImage(webp, "image/webp", webp.length).ok, true);
});

test("validateImage rejects a declared type whose signature doesn't match the bytes", () => {
  const notActuallyPng = bytesFrom(0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0);
  const result = validateImage(notActuallyPng, "image/png", notActuallyPng.length);
  assert.equal(result.ok, false);
  assert.equal(result.error, "image_signature_mismatch");
});

test("validateImage rejects an unsupported declared MIME type, an empty file, and a file over 10 MiB", () => {
  const pdfBytes = bytesFrom(0x25, 0x50, 0x44, 0x46);
  assert.equal(validateImage(pdfBytes, "application/pdf", pdfBytes.length).error, "unsupported_image_type");
  assert.equal(validateImage(new Uint8Array(0), "image/png", 0).error, "empty_image");
  const png = bytesFrom(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  assert.equal(validateImage(png, "image/png", 10 * 1024 * 1024 + 1).error, "image_too_large");
});

// --- sanitizeDosingScreenScanResult ----------------------------------------
//
// Meaningfully different from Job Traveler, not a relaxed variant of it:
// layers identify by row order (letter is informational only), and every
// layer must return exactly DOSING_SCREEN_COMPONENTS_PER_LAYER slots (nulls
// for unused ones, never omitted) so array position maps to hopper position.

function dosingComponent(overrides = {}) {
  return { resin_code: "MS0440", resin_code_confidence: 0.9, percentage: 71, percentage_confidence: 0.9, ...overrides };
}
function emptyDosingComponent() {
  return { resin_code: null, resin_code_confidence: null, percentage: null, percentage_confidence: null };
}
function dosingComponents(...populated) {
  const slots = Array.from({ length: DOSING_SCREEN_COMPONENTS_PER_LAYER }, () => emptyDosingComponent());
  populated.forEach((component, index) => { slots[index] = component; });
  return slots;
}
function dosingLayer(letter, overrides = {}) {
  return {
    layer_letter: letter, layer_letter_confidence: 0.9,
    layer_percentage: null, layer_percentage_confidence: null,
    components: dosingComponents(dosingComponent(), dosingComponent({ resin_code: "MS1307", percentage: 21 })),
    ...overrides
  };
}
function threeLayerDosingRecipe(overrides = {}) {
  return { recipe: { name: null, layers: [dosingLayer("A"), dosingLayer("B"), dosingLayer("C")] }, ...overrides };
}

test("dosing screen: accepts a well-formed 3-layer result with letters read directly, layer_percentage null (structurally absent from this source)", () => {
  const result = sanitizeDosingScreenScanResult(threeLayerDosingRecipe());
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
  assert.equal(result.value.recipe.layer_count, 3);
  assert.deepEqual(result.value.recipe.layers.map(l => l.layer_letter), ["A", "B", "C"]);
  assert.equal(result.value.recipe.layers[0].layer_percentage, null);
  assert.equal(result.value.recipe.layer_percentage_total_status, "incomplete");
});

test("dosing screen: layer_letter is informational only - null is accepted, not required", () => {
  const result = sanitizeDosingScreenScanResult({
    recipe: { name: null, layers: [dosingLayer(null), dosingLayer("B"), dosingLayer("C")] }
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.recipe.layers[0].layer_letter, null);
});

test("dosing screen: rejects a layer_letter outside A-E", () => {
  const result = sanitizeDosingScreenScanResult({
    recipe: { name: null, layers: [dosingLayer("F"), dosingLayer("B"), dosingLayer("C")] }
  });
  assert.equal(result.ok, false);
});

test("dosing screen: layer count must still match a real line configuration (1, 3, or 5), same physical constraint as Job Traveler", () => {
  const result = sanitizeDosingScreenScanResult({
    recipe: { name: null, layers: [dosingLayer("A"), dosingLayer("B")] } // 2 layers
  });
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /doesn't match a valid line configuration/);
});

test("dosing screen: components must be exactly DOSING_SCREEN_COMPONENTS_PER_LAYER slots - fewer is rejected, unlike Job Traveler's omit-blanks rule", () => {
  const tooFew = sanitizeDosingScreenScanResult({
    recipe: { name: null, layers: [dosingLayer("A", { components: [dosingComponent(), dosingComponent()] }), dosingLayer("B"), dosingLayer("C")] }
  });
  assert.equal(tooFew.ok, false);
  assert.match(tooFew.errors.join(" "), /exactly 6 entries/);
});

test("dosing screen: components must be exactly DOSING_SCREEN_COMPONENTS_PER_LAYER slots - more is also rejected", () => {
  const tooMany = sanitizeDosingScreenScanResult({
    recipe: { name: null, layers: [dosingLayer("A", { components: Array.from({ length: 7 }, () => dosingComponent()) }), dosingLayer("B"), dosingLayer("C")] }
  });
  assert.equal(tooMany.ok, false);
});

test("dosing screen: an empty (unused) hopper slot is a valid entry, not an error", () => {
  const result = sanitizeDosingScreenScanResult(threeLayerDosingRecipe());
  assert.equal(result.ok, true);
  assert.equal(result.value.recipe.layers[0].components.length, DOSING_SCREEN_COMPONENTS_PER_LAYER);
  assert.equal(result.value.recipe.layers[0].components[2].resin_code, null);
});

test("dosing screen: components carry no hopper_designation field at all - position alone determines hopper", () => {
  const result = sanitizeDosingScreenScanResult(threeLayerDosingRecipe());
  assert.equal(result.ok, true);
  assert.equal("hopper_designation" in result.value.recipe.layers[0].components[0], false);
});

test("dosing screen: rejects an out-of-range percentage or confidence rather than silently clamping it", () => {
  const badPct = sanitizeDosingScreenScanResult({
    recipe: { name: null, layers: [dosingLayer("A", { components: dosingComponents(dosingComponent({ percentage: 150 })) }), dosingLayer("B"), dosingLayer("C")] }
  });
  assert.equal(badPct.ok, false);
});

test("dosing screen: strips unknown properties instead of failing the whole request", () => {
  const result = sanitizeDosingScreenScanResult({
    unexpected_envelope_field: "provider metadata",
    recipe: { name: null, layers: [dosingLayer("A", { some_extra_field: "ignored" }), dosingLayer("B"), dosingLayer("C")] }
  });
  assert.equal(result.ok, true);
  assert.equal("unexpected_envelope_field" in result.value, false);
  assert.equal("some_extra_field" in result.value.recipe.layers[0], false);
});

test("dosing screen: rejects a non-object response and a missing/non-array layers field", () => {
  assert.equal(sanitizeDosingScreenScanResult(null).ok, false);
  assert.equal(sanitizeDosingScreenScanResult("oops").ok, false);
  assert.equal(sanitizeDosingScreenScanResult({ recipe: { name: null } }).ok, false);
});

// --- sanitizeHeatSheetScanResult ---------------------------------------
//
// Structurally close to Job Traveler (position from block order, optional
// hopper_designation, an unused hopper simply omitted rather than padded),
// plus an optional layer_letter cross-check field like Dosing Screen's,
// since operators sometimes label a block when filling one out with this
// tool.

function heatSheetLayer(position, overrides = {}) {
  return {
    position, position_confidence: 0.9,
    layer_letter: null, layer_letter_confidence: null,
    layer_percentage: 20, layer_percentage_confidence: 0.8,
    components: [validComponent({ percentage: 71 }), validComponent({ resin_code: "MS1307", percentage: 21 })],
    ...overrides
  };
}
function threeLayerHeatSheetRecipe(overrides = {}) {
  return {
    recipe: { name: null, layers: [heatSheetLayer("inside"), heatSheetLayer("core"), heatSheetLayer("outside")] },
    ...overrides
  };
}

test("heat sheet: accepts a well-formed 3-layer result, position derived from block order same as Job Traveler", () => {
  const result = sanitizeHeatSheetScanResult(threeLayerHeatSheetRecipe());
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
  assert.equal(result.value.recipe.layer_count, 3);
  assert.deepEqual(result.value.recipe.layers.map(l => l.position), ["inside", "core", "outside"]);
});

test("heat sheet: layer_letter is informational only - null is accepted, not required", () => {
  const result = sanitizeHeatSheetScanResult(threeLayerHeatSheetRecipe());
  assert.equal(result.ok, true);
  assert.equal(result.value.recipe.layers[0].layer_letter, null);
});

test("heat sheet: accepts a legible layer_letter label and rejects one outside A-E", () => {
  const labeled = sanitizeHeatSheetScanResult({
    recipe: { name: null, layers: [heatSheetLayer("inside", { layer_letter: "A", layer_letter_confidence: 0.8 }), heatSheetLayer("core"), heatSheetLayer("outside")] }
  });
  assert.equal(labeled.ok, true);
  assert.equal(labeled.value.recipe.layers[0].layer_letter, "A");

  const invalid = sanitizeHeatSheetScanResult({
    recipe: { name: null, layers: [heatSheetLayer("inside", { layer_letter: "F" }), heatSheetLayer("core"), heatSheetLayer("outside")] }
  });
  assert.equal(invalid.ok, false);
});

test("heat sheet: layer count must match a real line configuration (1, 3, or 5)", () => {
  const result = sanitizeHeatSheetScanResult({
    recipe: { name: null, layers: [heatSheetLayer("inside"), heatSheetLayer("core")] } // 2 layers
  });
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /doesn't match a valid line configuration/);
});

test("heat sheet: does not require padding components up to 6 - an unused hopper isn't written on this form at all", () => {
  const result = sanitizeHeatSheetScanResult(threeLayerHeatSheetRecipe());
  assert.equal(result.ok, true);
  assert.equal(result.value.recipe.layers[0].components.length, 2);
});

test("heat sheet: rejects a layer with zero components and rejects more than 6", () => {
  const empty = sanitizeHeatSheetScanResult({
    recipe: { name: null, layers: [heatSheetLayer("inside", { components: [] }), heatSheetLayer("core"), heatSheetLayer("outside")] }
  });
  assert.equal(empty.ok, false);

  const tooMany = sanitizeHeatSheetScanResult({
    recipe: {
      name: null,
      layers: [heatSheetLayer("inside", { components: Array.from({ length: 7 }, () => validComponent()) }), heatSheetLayer("core"), heatSheetLayer("outside")]
    }
  });
  assert.equal(tooMany.ok, false);
});

test("heat sheet: accepts an optional hand-written hopper_designation on a component, same as Job Traveler", () => {
  const result = sanitizeHeatSheetScanResult({
    recipe: {
      name: null,
      layers: [
        heatSheetLayer("inside", { components: [validComponent({ hopper_designation: "H3", hopper_designation_confidence: 0.7 })] }),
        heatSheetLayer("core"), heatSheetLayer("outside")
      ]
    }
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.recipe.layers[0].components[0].hopper_designation, "H3");
});

test("heat sheet: a layer's own percentage is independent of whether its components sum to 100 - flagged, not rejected", () => {
  const result = sanitizeHeatSheetScanResult({
    recipe: {
      name: null,
      layers: [
        heatSheetLayer("inside", { components: [validComponent({ percentage: 50 }), validComponent({ percentage: 30 })] }), // sums to 80
        heatSheetLayer("core"), heatSheetLayer("outside")
      ]
    }
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.recipe.layers[0].component_percentage_total_status, "invalid");
});

test("heat sheet: strips unknown properties instead of failing the whole request", () => {
  const result = sanitizeHeatSheetScanResult({
    unexpected_envelope_field: "provider metadata",
    recipe: { name: null, layers: [heatSheetLayer("inside", { some_extra_field: "ignored" }), heatSheetLayer("core"), heatSheetLayer("outside")] }
  });
  assert.equal(result.ok, true);
  assert.equal("unexpected_envelope_field" in result.value, false);
  assert.equal("some_extra_field" in result.value.recipe.layers[0], false);
});

// --- Heat Sheet: lot_number - only this source ever has one, since the
// physical LOT NUMBERS column exists only on the printed heat sheet.

function heatSheetComponent(overrides = {}) {
  return {
    resin_code: "MS0440", resin_code_confidence: 0.9,
    percentage: 79, percentage_confidence: 0.9,
    hopper_designation: null, hopper_designation_confidence: null,
    lot_number: "ECUX2760-1015A", lot_number_confidence: 0.7,
    ...overrides
  };
}

test("heat sheet: accepts a well-formed lot number and its confidence", () => {
  const result = sanitizeHeatSheetScanResult({
    recipe: { name: null, layers: [
      heatSheetLayer("inside", { components: [heatSheetComponent()] }),
      heatSheetLayer("core"), heatSheetLayer("outside")
    ] }
  });
  assert.equal(result.ok, true);
  const component = result.value.recipe.layers[0].components[0];
  assert.equal(component.lot_number, "ECUX2760-1015A");
  assert.equal(component.lot_number_confidence, 0.7);
});

test("heat sheet: accepts a missing or explicitly null lot number - most components will have none read", () => {
  for (const overrides of [
    { lot_number: undefined, lot_number_confidence: undefined },
    { lot_number: null, lot_number_confidence: null }
  ]) {
    const result = sanitizeHeatSheetScanResult({
      recipe: { name: null, layers: [
        heatSheetLayer("inside", { components: [heatSheetComponent(overrides)] }),
        heatSheetLayer("core"), heatSheetLayer("outside")
      ] }
    });
    assert.equal(result.ok, true);
    assert.equal(result.value.recipe.layers[0].components[0].lot_number, null);
  }
});

test("heat sheet: a partially-legible lot number is accepted as-is, exactly as read - never padded, never rejected for looking incomplete", () => {
  const result = sanitizeHeatSheetScanResult({
    recipe: { name: null, layers: [
      heatSheetLayer("inside", { components: [heatSheetComponent({ lot_number: "ECUX27", lot_number_confidence: 0.3 })] }),
      heatSheetLayer("core"), heatSheetLayer("outside")
    ] }
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.recipe.layers[0].components[0].lot_number, "ECUX27");
});

test("heat sheet: rejects a lot number over the defensive length cap and an out-of-range confidence", () => {
  const tooLong = sanitizeHeatSheetScanResult({
    recipe: { name: null, layers: [
      heatSheetLayer("inside", { components: [heatSheetComponent({ lot_number: "X".repeat(MAX_LOT_LENGTH + 1) })] }),
      heatSheetLayer("core"), heatSheetLayer("outside")
    ] }
  });
  assert.equal(tooLong.ok, false);

  const badConfidence = sanitizeHeatSheetScanResult({
    recipe: { name: null, layers: [
      heatSheetLayer("inside", { components: [heatSheetComponent({ lot_number_confidence: 1.5 })] }),
      heatSheetLayer("core"), heatSheetLayer("outside")
    ] }
  });
  assert.equal(badConfidence.ok, false);
});

test("heat sheet: lot numbers stay associated with the resin code on their own row, not any other row in the layer", () => {
  const result = sanitizeHeatSheetScanResult({
    recipe: { name: null, layers: [
      heatSheetLayer("inside", { components: [
        heatSheetComponent({ resin_code: "MS0440", percentage: 60, lot_number: "LOT-A" }),
        heatSheetComponent({ resin_code: "MS1307", percentage: 40, lot_number: "LOT-B" })
      ] }),
      heatSheetLayer("core"), heatSheetLayer("outside")
    ] }
  });
  assert.equal(result.ok, true);
  const [first, second] = result.value.recipe.layers[0].components;
  assert.equal(first.resin_code, "MS0440");
  assert.equal(first.lot_number, "LOT-A");
  assert.equal(second.resin_code, "MS1307");
  assert.equal(second.lot_number, "LOT-B");
});

test("Job Traveler's shared sanitizeRecipeScanResult never gains a lot_number field - only Heat Sheet has one", () => {
  const result = sanitizeRecipeScanResult(threeLayerRecipe());
  assert.equal(result.ok, true);
  assert.equal("lot_number" in result.value.recipe.layers[0].components[0], false);
});

test("heat sheet: rejects a non-object response and a missing/non-array layers field", () => {
  assert.equal(sanitizeHeatSheetScanResult(null).ok, false);
  assert.equal(sanitizeHeatSheetScanResult("oops").ok, false);
  assert.equal(sanitizeHeatSheetScanResult({ recipe: { name: null } }).ok, false);
});
