(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynRecipeScanSchema = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // Mirrors supabase/functions/recipe-scan/schema.ts field-for-field. This is
  // a deliberate, documented duplication (browser vs. Deno Edge Function
  // runtimes), not a shared module - the Edge Function's copy is the actual
  // security boundary; this one is used by the future review screen to apply
  // the same allowlist/flagging rules, and to pre-check an image client-side
  // before upload.
  //
  // Covers Job Traveler and Dosing Screen, matching the Edge Function's two
  // sanitize functions - Heat Sheet isn't wired up yet.

  const VALID_LAYER_COUNTS = [1, 3, 5];
  const MAX_LAYERS = 5;
  const MAX_COMPONENTS_PER_LAYER = 6;
  const MAX_NAME_LENGTH = 100;
  const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
  const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
  const HOPPER_DESIGNATIONS = ["H1", "H2", "H3", "H4", "H5", "H6"];
  const PERCENTAGE_TOLERANCE = 0.5;

  const POSITIONS_BY_LAYER_COUNT = {
    1: ["single"],
    3: ["inside", "core", "outside"],
    5: ["inside", "inside_subskin", "core", "outside_subskin", "outside"]
  };

  function isPlainObject(v) { return typeof v === "object" && v !== null && !Array.isArray(v); }
  function isFiniteNumber(v) { return typeof v === "number" && Number.isFinite(v); }

  function sanitizePercentage(v) {
    if (v === null || v === undefined) return { ok: true, value: null };
    if (isFiniteNumber(v) && v >= 0 && v <= 100) return { ok: true, value: v };
    return { ok: false, value: null };
  }
  function sanitizeConfidence(v) {
    if (v === null || v === undefined) return { ok: true, value: null };
    if (isFiniteNumber(v) && v >= 0 && v <= 1) return { ok: true, value: v };
    return { ok: false, value: null };
  }
  function sanitizeString(v, maxLength) {
    if (v === null || v === undefined) return { ok: true, value: null };
    if (typeof v === "string" && v.length <= maxLength) return { ok: true, value: v };
    return { ok: false, value: null };
  }
  function sanitizeHopperDesignation(v) {
    if (v === null || v === undefined) return { ok: true, value: null };
    if (typeof v === "string" && HOPPER_DESIGNATIONS.includes(v)) return { ok: true, value: v };
    return { ok: false, value: null };
  }

  function totalStatus(values, expected, tolerance) {
    expected = expected === undefined ? 100 : expected;
    tolerance = tolerance === undefined ? PERCENTAGE_TOLERANCE : tolerance;
    if (values.length === 0) return "empty";
    if (values.some(v => v === null)) return "incomplete";
    const sum = values.reduce((total, v) => total + v, 0);
    return Math.abs(sum - expected) <= tolerance ? "ok" : "invalid";
  }

  function sanitizeComponent(raw, errors, path) {
    if (!isPlainObject(raw)) { errors.push(`${path}: component must be an object`); return null; }
    const resinCode = sanitizeString(raw.resin_code, MAX_NAME_LENGTH);
    if (!resinCode.ok) errors.push(`${path}.resin_code: must be a string of at most ${MAX_NAME_LENGTH} characters, or null`);
    const resinCodeConfidence = sanitizeConfidence(raw.resin_code_confidence);
    if (!resinCodeConfidence.ok) errors.push(`${path}.resin_code_confidence: must be 0-1, or null`);
    const percentage = sanitizePercentage(raw.percentage);
    if (!percentage.ok) errors.push(`${path}.percentage: must be 0-100, or null`);
    const percentageConfidence = sanitizeConfidence(raw.percentage_confidence);
    if (!percentageConfidence.ok) errors.push(`${path}.percentage_confidence: must be 0-1, or null`);
    const hopperDesignation = sanitizeHopperDesignation(raw.hopper_designation);
    if (!hopperDesignation.ok) errors.push(`${path}.hopper_designation: must be one of H1-H6, or null`);
    const hopperDesignationConfidence = sanitizeConfidence(raw.hopper_designation_confidence);
    if (!hopperDesignationConfidence.ok) errors.push(`${path}.hopper_designation_confidence: must be 0-1, or null`);

    return {
      resin_code: resinCode.value,
      resin_code_confidence: resinCodeConfidence.value,
      percentage: percentage.value,
      percentage_confidence: percentageConfidence.value,
      hopper_designation: hopperDesignation.value,
      hopper_designation_confidence: hopperDesignationConfidence.value
    };
  }

  function sanitizeLayer(raw, expectedPositions, errors, index) {
    const path = `recipe.layers[${index}]`;
    if (!isPlainObject(raw)) { errors.push(`${path}: layer must be an object`); return null; }

    let position = null;
    if (raw.position !== null && raw.position !== undefined) {
      if (typeof raw.position === "string" && expectedPositions.includes(raw.position)) position = raw.position;
      else errors.push(`${path}.position: must be one of ${expectedPositions.join(", ")}, or null`);
    }
    const positionConfidence = sanitizeConfidence(raw.position_confidence);
    if (!positionConfidence.ok) errors.push(`${path}.position_confidence: must be 0-1, or null`);

    const layerPercentage = sanitizePercentage(raw.layer_percentage);
    if (!layerPercentage.ok) errors.push(`${path}.layer_percentage: must be 0-100, or null`);
    const layerPercentageConfidence = sanitizeConfidence(raw.layer_percentage_confidence);
    if (!layerPercentageConfidence.ok) errors.push(`${path}.layer_percentage_confidence: must be 0-1, or null`);

    const rawComponents = Array.isArray(raw.components) ? raw.components : null;
    if (!rawComponents) errors.push(`${path}.components: must be an array`);
    else if (rawComponents.length === 0) errors.push(`${path}.components: at least one component is required`);
    else if (rawComponents.length > MAX_COMPONENTS_PER_LAYER) errors.push(`${path}.components: at most ${MAX_COMPONENTS_PER_LAYER} components allowed`);

    const components = (rawComponents || [])
      .slice(0, 20)
      .map((component, componentIndex) => sanitizeComponent(component, errors, `${path}.components[${componentIndex}]`))
      .filter(component => component !== null);

    return {
      position, position_confidence: positionConfidence.value,
      layer_percentage: layerPercentage.value, layer_percentage_confidence: layerPercentageConfidence.value,
      components,
      component_percentage_total_status: totalStatus(components.map(c => c.percentage))
    };
  }

  function sanitizeRecipeScanResult(raw) {
    const errors = [];
    if (!isPlainObject(raw)) {
      return { ok: false, errors: ["response must be an object"], value: null };
    }

    const recipe = isPlainObject(raw.recipe) ? raw.recipe : null;
    if (!recipe) return { ok: false, errors: ["recipe: must be an object"], value: null };

    const name = sanitizeString(recipe.name, MAX_NAME_LENGTH);
    if (!name.ok) errors.push(`recipe.name: must be a string of at most ${MAX_NAME_LENGTH} characters, or null`);

    const rawLayers = Array.isArray(recipe.layers) ? recipe.layers : null;
    if (!rawLayers) return { ok: false, errors: ["recipe.layers: must be an array"], value: null };
    if (rawLayers.length === 0) return { ok: false, errors: ["recipe.layers: at least one layer is required"], value: null };
    if (rawLayers.length > MAX_LAYERS) return { ok: false, errors: [`recipe.layers: at most ${MAX_LAYERS} layers allowed`], value: null };

    if (!VALID_LAYER_COUNTS.includes(rawLayers.length)) {
      return {
        ok: false,
        errors: [`recipe.layers: detected ${rawLayers.length} layers, which doesn't match a valid line configuration (1, 3, or 5)`],
        value: null
      };
    }

    const expectedPositions = POSITIONS_BY_LAYER_COUNT[rawLayers.length];
    const layers = rawLayers.map((layer, index) => sanitizeLayer(layer, expectedPositions, errors, index));

    if (errors.length > 0) return { ok: false, errors, value: null };

    return {
      ok: true,
      errors: [],
      value: {
        recipe: {
          name: name.value,
          layers,
          layer_count: layers.length,
          layer_percentage_total_status: totalStatus(layers.map(l => l.layer_percentage))
        }
      }
    };
  }

  // --- Dosing Screen: layers identified by row order (never by reading the
  // letter as authoritative), components always exactly 6 slots (nulls for
  // unused, never omitted) so array position maps reliably to hopper number.
  // See schema.ts's header for why this isn't just a relaxed Job Traveler.

  const DOSING_SCREEN_COMPONENTS_PER_LAYER = 6;
  const LAYER_LETTERS = ["A", "B", "C", "D", "E"];

  function sanitizeLayerLetter(v) {
    if (v === null || v === undefined) return { ok: true, value: null };
    if (typeof v === "string" && LAYER_LETTERS.includes(v)) return { ok: true, value: v };
    return { ok: false, value: null };
  }

  function sanitizeDosingScreenComponent(raw, errors, path) {
    if (!isPlainObject(raw)) { errors.push(`${path}: component must be an object`); return null; }
    const resinCode = sanitizeString(raw.resin_code, MAX_NAME_LENGTH);
    if (!resinCode.ok) errors.push(`${path}.resin_code: must be a string of at most ${MAX_NAME_LENGTH} characters, or null`);
    const resinCodeConfidence = sanitizeConfidence(raw.resin_code_confidence);
    if (!resinCodeConfidence.ok) errors.push(`${path}.resin_code_confidence: must be 0-1, or null`);
    const percentage = sanitizePercentage(raw.percentage);
    if (!percentage.ok) errors.push(`${path}.percentage: must be 0-100, or null`);
    const percentageConfidence = sanitizeConfidence(raw.percentage_confidence);
    if (!percentageConfidence.ok) errors.push(`${path}.percentage_confidence: must be 0-1, or null`);

    return {
      resin_code: resinCode.value,
      resin_code_confidence: resinCodeConfidence.value,
      percentage: percentage.value,
      percentage_confidence: percentageConfidence.value
    };
  }

  function sanitizeDosingScreenLayer(raw, errors, index) {
    const path = `recipe.layers[${index}]`;
    if (!isPlainObject(raw)) { errors.push(`${path}: layer must be an object`); return null; }

    const layerLetter = sanitizeLayerLetter(raw.layer_letter);
    if (!layerLetter.ok) errors.push(`${path}.layer_letter: must be one of A-E, or null`);
    const layerLetterConfidence = sanitizeConfidence(raw.layer_letter_confidence);
    if (!layerLetterConfidence.ok) errors.push(`${path}.layer_letter_confidence: must be 0-1, or null`);

    const layerPercentage = sanitizePercentage(raw.layer_percentage);
    if (!layerPercentage.ok) errors.push(`${path}.layer_percentage: must be 0-100, or null`);
    const layerPercentageConfidence = sanitizeConfidence(raw.layer_percentage_confidence);
    if (!layerPercentageConfidence.ok) errors.push(`${path}.layer_percentage_confidence: must be 0-1, or null`);

    const rawComponents = Array.isArray(raw.components) ? raw.components : null;
    if (!rawComponents || rawComponents.length !== DOSING_SCREEN_COMPONENTS_PER_LAYER) {
      errors.push(`${path}.components: must be an array of exactly ${DOSING_SCREEN_COMPONENTS_PER_LAYER} entries (empty slots included), so position maps reliably to hopper number`);
    }
    const components = (rawComponents || [])
      .slice(0, DOSING_SCREEN_COMPONENTS_PER_LAYER)
      .map((component, componentIndex) => sanitizeDosingScreenComponent(component, errors, `${path}.components[${componentIndex}]`))
      .filter(component => component !== null);

    return {
      layer_letter: layerLetter.value, layer_letter_confidence: layerLetterConfidence.value,
      layer_percentage: layerPercentage.value, layer_percentage_confidence: layerPercentageConfidence.value,
      components,
      component_percentage_total_status: totalStatus(components.map(c => c.percentage))
    };
  }

  function sanitizeDosingScreenScanResult(raw) {
    const errors = [];
    if (!isPlainObject(raw)) {
      return { ok: false, errors: ["response must be an object"], value: null };
    }

    const recipe = isPlainObject(raw.recipe) ? raw.recipe : null;
    if (!recipe) return { ok: false, errors: ["recipe: must be an object"], value: null };

    const name = sanitizeString(recipe.name, MAX_NAME_LENGTH);
    if (!name.ok) errors.push(`recipe.name: must be a string of at most ${MAX_NAME_LENGTH} characters, or null`);

    const rawLayers = Array.isArray(recipe.layers) ? recipe.layers : null;
    if (!rawLayers) return { ok: false, errors: ["recipe.layers: must be an array"], value: null };
    if (rawLayers.length === 0) return { ok: false, errors: ["recipe.layers: at least one layer is required"], value: null };
    if (rawLayers.length > MAX_LAYERS) return { ok: false, errors: [`recipe.layers: at most ${MAX_LAYERS} layers allowed`], value: null };

    if (!VALID_LAYER_COUNTS.includes(rawLayers.length)) {
      return {
        ok: false,
        errors: [`recipe.layers: detected ${rawLayers.length} layers, which doesn't match a valid line configuration (1, 3, or 5)`],
        value: null
      };
    }

    const layers = rawLayers.map((layer, index) => sanitizeDosingScreenLayer(layer, errors, index));

    if (errors.length > 0) return { ok: false, errors, value: null };

    return {
      ok: true,
      errors: [],
      value: {
        recipe: {
          name: name.value,
          layers,
          layer_count: layers.length,
          layer_percentage_total_status: totalStatus(layers.map(l => l.layer_percentage))
        }
      }
    };
  }

  function matchesImageSignature(bytes, type) {
    if (type === "image/jpeg") {
      return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    }
    if (type === "image/png") {
      const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
      return bytes.length >= signature.length && signature.every((byte, i) => bytes[i] === byte);
    }
    if (type === "image/webp") {
      return bytes.length >= 12
        && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
        && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
    }
    return false;
  }

  function validateImage(bytes, declaredType, byteLength) {
    if (!ALLOWED_IMAGE_TYPES.includes(declaredType)) return { ok: false, error: "unsupported_image_type" };
    if (byteLength <= 0) return { ok: false, error: "empty_image" };
    if (byteLength > MAX_IMAGE_BYTES) return { ok: false, error: "image_too_large" };
    if (!matchesImageSignature(bytes, declaredType)) return { ok: false, error: "image_signature_mismatch" };
    return { ok: true, error: null };
  }

  return {
    VALID_LAYER_COUNTS,
    MAX_LAYERS,
    MAX_COMPONENTS_PER_LAYER,
    MAX_NAME_LENGTH,
    MAX_IMAGE_BYTES,
    ALLOWED_IMAGE_TYPES,
    HOPPER_DESIGNATIONS,
    DOSING_SCREEN_COMPONENTS_PER_LAYER,
    totalStatus,
    sanitizeRecipeScanResult,
    sanitizeDosingScreenScanResult,
    validateImage
  };
});
