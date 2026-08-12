// Pure validation/allowlisting for a recipe scan's AI response. No I/O, no
// Supabase/OpenAI calls here - only used by index.ts after the provider call
// returns, and by its own tests.
//
// Two source types, two separate sanitize functions rather than one relaxed
// in place - see the Dosing Screen section below for why. Heat Sheet isn't
// wired up yet (its button is disabled in the UI).
//
// Two different kinds of problems, handled differently:
//  - Malformed/untrustworthy AI output (wrong type, out-of-domain value,
//    excessive counts, a layer count that doesn't match any real line
//    configuration) -> the whole response is rejected (ok: false); the
//    operator retakes/retries rather than being shown bad data.
//  - Expected uncertainty (nulls, low confidence, a percentage total that's
//    "incomplete" because some contributing value is null) -> not an error.
//    It's returned as part of the sanitized draft so the review screen can
//    flag it for the operator.

export const VALID_LAYER_COUNTS = [1, 3, 5] as const;
export const MAX_LAYERS = 5;
export const MAX_COMPONENTS_PER_LAYER = 6; // matches hopper capacity (H1-H6)
export const MAX_NAME_LENGTH = 100;
// Generous headroom over the plausible examples this feature was designed
// against (typically 10-20 characters) - a defensive cap only, never a
// format constraint. See sanitizeHeatSheetComponent for why this exists at
// all: lot numbers are handwritten and read imperfectly on purpose.
export const MAX_LOT_LENGTH = 40;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

// Universal film-order position names, independent of which physical letter
// (A-E) they end up mapped to - that mapping happens client-side, after the
// operator answers the orientation prompt. The AI never sees or reasons
// about A-E letters at all; Job Traveler forms don't print them.
const POSITIONS_BY_LAYER_COUNT: Record<number, readonly string[]> = {
  1: ["single"],
  3: ["inside", "core", "outside"],
  5: ["inside", "inside_subskin", "core", "outside_subskin", "outside"]
};

const HOPPER_DESIGNATIONS = ["H1", "H2", "H3", "H4", "H5", "H6"] as const;
const PERCENTAGE_TOLERANCE = 0.5;

export type TotalStatus = "ok" | "incomplete" | "invalid" | "empty";

export interface SanitizeResult {
  ok: boolean;
  errors: string[];
  value: Record<string, unknown> | null;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

// A null/undefined input is always ok - it means "uncertain", not "invalid".
// Only a present-but-out-of-range/wrong-type value is rejected.
function sanitizePercentage(v: unknown): { ok: boolean; value: number | null } {
  if (v === null || v === undefined) return { ok: true, value: null };
  if (isFiniteNumber(v) && v >= 0 && v <= 100) return { ok: true, value: v };
  return { ok: false, value: null };
}

function sanitizeConfidence(v: unknown): { ok: boolean; value: number | null } {
  if (v === null || v === undefined) return { ok: true, value: null };
  if (isFiniteNumber(v) && v >= 0 && v <= 1) return { ok: true, value: v };
  return { ok: false, value: null };
}

function sanitizeString(v: unknown, maxLength: number): { ok: boolean; value: string | null } {
  if (v === null || v === undefined) return { ok: true, value: null };
  if (typeof v === "string" && v.length <= maxLength) return { ok: true, value: v };
  return { ok: false, value: null };
}

function sanitizeHopperDesignation(v: unknown): { ok: boolean; value: string | null } {
  if (v === null || v === undefined) return { ok: true, value: null };
  if (typeof v === "string" && (HOPPER_DESIGNATIONS as readonly string[]).includes(v)) return { ok: true, value: v };
  return { ok: false, value: null };
}

// Only "invalid" when every value is present and the sum misses tolerance.
// Any null among them means "can't tell yet" (incomplete), not "wrong".
export function totalStatus(values: Array<number | null>, expected = 100, tolerance = PERCENTAGE_TOLERANCE): TotalStatus {
  if (values.length === 0) return "empty";
  if (values.some((v) => v === null)) return "incomplete";
  const sum = values.reduce((total: number, v) => total + (v as number), 0);
  return Math.abs(sum - expected) <= tolerance ? "ok" : "invalid";
}

function sanitizeComponent(raw: unknown, errors: string[], path: string) {
  if (!isPlainObject(raw)) {
    errors.push(`${path}: component must be an object`);
    return null;
  }
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
    // Handwritten hopper plan the operator wrote next to this resin (H1-H6,
    // "M" normalized to H1, bare numbers normalized to H1-H6) - null when
    // no such note is present or it isn't legible. Reducing the operator's
    // manual drag-to-hopper work, never a guess.
    hopper_designation: hopperDesignation.value,
    hopper_designation_confidence: hopperDesignationConfidence.value
  };
}

function sanitizeLayer(raw: unknown, expectedPositions: readonly string[], errors: string[], index: number) {
  const path = `recipe.layers[${index}]`;
  if (!isPlainObject(raw)) {
    errors.push(`${path}: layer must be an object`);
    return null;
  }

  let position: string | null = null;
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
  else if (rawComponents.length > MAX_COMPONENTS_PER_LAYER) {
    errors.push(`${path}.components: at most ${MAX_COMPONENTS_PER_LAYER} components allowed`);
  }
  const components = (rawComponents || [])
    .slice(0, 20) // defensive cap only; the count check above is the real gate
    .map((component, componentIndex) => sanitizeComponent(component, errors, `${path}.components[${componentIndex}]`))
    .filter((component): component is NonNullable<typeof component> => component !== null);

  return {
    position,
    position_confidence: positionConfidence.value,
    layer_percentage: layerPercentage.value,
    layer_percentage_confidence: layerPercentageConfidence.value,
    components,
    component_percentage_total_status: totalStatus(components.map((c) => c.percentage))
  };
}

export function sanitizeRecipeScanResult(raw: unknown): SanitizeResult {
  const errors: string[] = [];
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

  // The scanned layer count must match a real line configuration (1, 3, or
  // 5) - anything else can never be applied, so it's rejected here rather
  // than carried through to a review screen with nowhere to go.
  if (!(VALID_LAYER_COUNTS as readonly number[]).includes(rawLayers.length)) {
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
        layer_percentage_total_status: totalStatus(layers.map((l) => l!.layer_percentage))
      }
    }
  };
}

// --- Dosing Screen (material overview HMI screen or its printout) --------
//
// Meaningfully different from Job Traveler, not just a relaxed variant:
//  - Layers are identified by row order (top to bottom = A to E), exactly
//    like Job Traveler's column order - never by reading the row's letter
//    as if it were authoritative. layer_letter is carried through only as
//    an informational cross-check for the review screen, same reasoning as
//    "identify by position, not header text."
//  - Components map directly to hopper position (component 1 = H1, etc.) on
//    lines where that dosing-controller naming convention is enabled, so
//    there is no hopper_designation concept here at all - and unlike Job
//    Traveler's "omit blank padding rows," every layer must return exactly
//    DOSING_SCREEN_COMPONENTS_PER_LAYER slots (null resin/percentage for an
//    unused one) so array position reliably maps to hopper position.
//  - layer_percentage is structurally never printed on this screen - the
//    schema still carries the field (client-side auto-derives a single
//    missing layer, same as Job Traveler), it just means every layer scan
//    will actually have it null.

export const DOSING_SCREEN_COMPONENTS_PER_LAYER = 6; // matches hopper capacity (H1-H6); always exactly this many, never omitted
const LAYER_LETTERS = ["A", "B", "C", "D", "E"] as const;

function sanitizeLayerLetter(v: unknown): { ok: boolean; value: string | null } {
  if (v === null || v === undefined) return { ok: true, value: null };
  if (typeof v === "string" && (LAYER_LETTERS as readonly string[]).includes(v)) return { ok: true, value: v };
  return { ok: false, value: null };
}

function sanitizeDosingScreenComponent(raw: unknown, errors: string[], path: string) {
  if (!isPlainObject(raw)) {
    errors.push(`${path}: component must be an object`);
    return null;
  }
  const resinCode = sanitizeString(raw.resin_code, MAX_NAME_LENGTH);
  if (!resinCode.ok) errors.push(`${path}.resin_code: must be a string of at most ${MAX_NAME_LENGTH} characters, or null`);
  const resinCodeConfidence = sanitizeConfidence(raw.resin_code_confidence);
  if (!resinCodeConfidence.ok) errors.push(`${path}.resin_code_confidence: must be 0-1, or null`);
  // The setpoint value, never the small live/actual reading shown next to it.
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

function sanitizeDosingScreenLayer(raw: unknown, errors: string[], index: number) {
  const path = `recipe.layers[${index}]`;
  if (!isPlainObject(raw)) {
    errors.push(`${path}: layer must be an object`);
    return null;
  }

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
    .filter((component): component is NonNullable<typeof component> => component !== null);

  return {
    layer_letter: layerLetter.value,
    layer_letter_confidence: layerLetterConfidence.value,
    layer_percentage: layerPercentage.value,
    layer_percentage_confidence: layerPercentageConfidence.value,
    components,
    component_percentage_total_status: totalStatus(components.map((c) => c.percentage))
  };
}

export function sanitizeDosingScreenScanResult(raw: unknown): SanitizeResult {
  const errors: string[] = [];
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

  // Same physical-line constraint as Job Traveler - still required even
  // though this source is "less restrictive" in other ways.
  if (!(VALID_LAYER_COUNTS as readonly number[]).includes(rawLayers.length)) {
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
        layer_percentage_total_status: totalStatus(layers.map((l) => l!.layer_percentage))
      }
    }
  };
}

// --- Heat Sheet (printed 'BLENDER / LAYER SETTINGS' form) ----------------
//
// Structurally much closer to Job Traveler than to Dosing Screen:
//  - Layers are identified by block/row order (top to bottom), exactly like
//    Job Traveler's column order - ambiguous without an orientation answer,
//    unlike Dosing Screen's self-labeled rows. Reuses the same sanitizeLayer
//    field shape (position from order, optional hopper_designation, omit an
//    unused hopper entirely rather than padding a slot) - this form doesn't
//    print blank rows for unused hoppers either.
//  - Unlike Job Traveler, operators sometimes label a block with a layer
//    letter (A-E) when filling it out with this tool - carried through as
//    an informational cross-check only, same reasoning and same field as
//    Dosing Screen's layer_letter. Block position remains authoritative.
//  - Only this form's component ever carries lot_number: the physical LOT
//    NUMBERS column exists on the printed heat sheet and nowhere else, so
//    Job Traveler's sanitizeComponent (shared with the general recipe scan)
//    is deliberately left untouched. A dedicated component sanitizer, not a
//    shared one, keeps that boundary explicit rather than growing an unused
//    field onto every other source type's response.

function sanitizeHeatSheetComponent(raw: unknown, errors: string[], path: string) {
  if (!isPlainObject(raw)) {
    errors.push(`${path}: component must be an object`);
    return null;
  }
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
  // Handwritten, in the row aligned with this SILO/resin. Preserved as
  // literally as reasonably possible - never corrected, never inferred from
  // the resin code, never invented when illegible. A partial, honestly
  // uncertain read is preferable to null only when the model is not simply
  // guessing; when it's guessing, null is what it should return, exactly the
  // same convention every other field here already follows.
  const lotNumber = sanitizeString(raw.lot_number, MAX_LOT_LENGTH);
  if (!lotNumber.ok) errors.push(`${path}.lot_number: must be a string of at most ${MAX_LOT_LENGTH} characters, or null`);
  const lotNumberConfidence = sanitizeConfidence(raw.lot_number_confidence);
  if (!lotNumberConfidence.ok) errors.push(`${path}.lot_number_confidence: must be 0-1, or null`);

  return {
    resin_code: resinCode.value,
    resin_code_confidence: resinCodeConfidence.value,
    percentage: percentage.value,
    percentage_confidence: percentageConfidence.value,
    hopper_designation: hopperDesignation.value,
    hopper_designation_confidence: hopperDesignationConfidence.value,
    lot_number: lotNumber.value,
    lot_number_confidence: lotNumberConfidence.value
  };
}

function sanitizeHeatSheetLayer(raw: unknown, expectedPositions: readonly string[], errors: string[], index: number) {
  const path = `recipe.layers[${index}]`;
  if (!isPlainObject(raw)) {
    errors.push(`${path}: layer must be an object`);
    return null;
  }

  let position: string | null = null;
  if (raw.position !== null && raw.position !== undefined) {
    if (typeof raw.position === "string" && expectedPositions.includes(raw.position)) position = raw.position;
    else errors.push(`${path}.position: must be one of ${expectedPositions.join(", ")}, or null`);
  }
  const positionConfidence = sanitizeConfidence(raw.position_confidence);
  if (!positionConfidence.ok) errors.push(`${path}.position_confidence: must be 0-1, or null`);

  const layerLetter = sanitizeLayerLetter(raw.layer_letter);
  if (!layerLetter.ok) errors.push(`${path}.layer_letter: must be one of A-E, or null`);
  const layerLetterConfidence = sanitizeConfidence(raw.layer_letter_confidence);
  if (!layerLetterConfidence.ok) errors.push(`${path}.layer_letter_confidence: must be 0-1, or null`);

  const layerPercentage = sanitizePercentage(raw.layer_percentage);
  if (!layerPercentage.ok) errors.push(`${path}.layer_percentage: must be 0-100, or null`);
  const layerPercentageConfidence = sanitizeConfidence(raw.layer_percentage_confidence);
  if (!layerPercentageConfidence.ok) errors.push(`${path}.layer_percentage_confidence: must be 0-1, or null`);

  const rawComponents = Array.isArray(raw.components) ? raw.components : null;
  if (!rawComponents) errors.push(`${path}.components: must be an array`);
  else if (rawComponents.length === 0) errors.push(`${path}.components: at least one component is required`);
  else if (rawComponents.length > MAX_COMPONENTS_PER_LAYER) {
    errors.push(`${path}.components: at most ${MAX_COMPONENTS_PER_LAYER} components allowed`);
  }
  const components = (rawComponents || [])
    .slice(0, 20) // defensive cap only; the count check above is the real gate
    .map((component, componentIndex) => sanitizeHeatSheetComponent(component, errors, `${path}.components[${componentIndex}]`))
    .filter((component): component is NonNullable<typeof component> => component !== null);

  return {
    position,
    position_confidence: positionConfidence.value,
    layer_letter: layerLetter.value,
    layer_letter_confidence: layerLetterConfidence.value,
    layer_percentage: layerPercentage.value,
    layer_percentage_confidence: layerPercentageConfidence.value,
    components,
    component_percentage_total_status: totalStatus(components.map((c) => c.percentage))
  };
}

export function sanitizeHeatSheetScanResult(raw: unknown): SanitizeResult {
  const errors: string[] = [];
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

  if (!(VALID_LAYER_COUNTS as readonly number[]).includes(rawLayers.length)) {
    return {
      ok: false,
      errors: [`recipe.layers: detected ${rawLayers.length} layers, which doesn't match a valid line configuration (1, 3, or 5)`],
      value: null
    };
  }

  const expectedPositions = POSITIONS_BY_LAYER_COUNT[rawLayers.length];
  const layers = rawLayers.map((layer, index) => sanitizeHeatSheetLayer(layer, expectedPositions, errors, index));

  if (errors.length > 0) return { ok: false, errors, value: null };

  return {
    ok: true,
    errors: [],
    value: {
      recipe: {
        name: name.value,
        layers,
        layer_count: layers.length,
        layer_percentage_total_status: totalStatus(layers.map((l) => l!.layer_percentage))
      }
    }
  };
}

function matchesImageSignature(bytes: Uint8Array, type: string): boolean {
  if (type === "image/jpeg") {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (type === "image/png") {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    return bytes.length >= signature.length && signature.every((byte, i) => bytes[i] === byte);
  }
  if (type === "image/webp") {
    return bytes.length >= 12
      && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 // "RIFF"
      && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50; // "WEBP"
  }
  return false;
}

export interface ImageValidationResult {
  ok: boolean;
  error: "unsupported_image_type" | "image_too_large" | "empty_image" | "image_signature_mismatch" | null;
}

// declaredType is the client-supplied MIME type (Content-Type of the form
// part); bytes/byteLength come from the actually-received file, never
// trusted from a client-supplied field alone - the signature check is what
// makes this a real check rather than a header the client could lie about.
export function validateImage(bytes: Uint8Array, declaredType: string, byteLength: number): ImageValidationResult {
  if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(declaredType)) {
    return { ok: false, error: "unsupported_image_type" };
  }
  if (byteLength <= 0) {
    return { ok: false, error: "empty_image" };
  }
  if (byteLength > MAX_IMAGE_BYTES) {
    return { ok: false, error: "image_too_large" };
  }
  if (!matchesImageSignature(bytes, declaredType)) {
    return { ok: false, error: "image_signature_mismatch" };
  }
  return { ok: true, error: null };
}
