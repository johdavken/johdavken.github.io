"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { sanitizeRecipeScanResult, validateImage, totalStatus } = require("./recipe-scan-schema.js");

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
