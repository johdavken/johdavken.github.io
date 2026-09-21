/* The line as Slate lists it: a pure function of a state-bridge snapshot.
 *
 * Layers in recipe order (A, B, C...), each with the ROLE its physical
 * position gives it - outside, subskin, core, inside - and its hoppers with
 * the ids the line's naming mode gives them. Nothing here is drawn or
 * stored; the recipe section and the run-down summary read it. The shape
 * of `layers[].{id, role, hoppers[].{index, id}}` is what station-rundown's
 * projectEntries reads, so the summary hands this model over as it is.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynSlateLine = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* Derived from the layer's position in the physical stack, never
   * tabulated per line. Index 0 is the OUTSIDE of the bubble. An even
   * layer count has no single middle, so it gets no "core" - the two
   * central layers are the innermost subskins. */
  function roleForStackIndex(index, layerCount) {
    if (layerCount === 1) return "single";
    if (index === 0) return "outside";
    if (index === layerCount - 1) return "inside";
    const middle = (layerCount - 1) / 2;
    if (Number.isInteger(middle) && index === middle) return "core";
    return index < middle ? "subskin-outside" : "subskin-inside";
  }

  const ROLE_LABEL = Object.freeze({
    single: "Layer",
    outside: "Outside",
    "subskin-outside": "Outside subskin",
    core: "Core",
    "subskin-inside": "Inside subskin",
    inside: "Inside"
  });

  /* The colour token each role takes (recipe.css): both subskins share
   * one, as Station's layer bank does. */
  const ROLE_TONE = Object.freeze({
    single: "single",
    outside: "outside",
    "subskin-outside": "subskin",
    core: "core",
    "subskin-inside": "subskin",
    inside: "inside"
  });

  function roleLabel(role) {
    return ROLE_LABEL[role] || "Layer";
  }

  function roleTone(role) {
    return ROLE_TONE[role] || "single";
  }

  /* Mirrors line-identity's hopperPositionLabel: "main-plus-five" names
   * the first hopper Main and the rest 1-5, everything else is 1-based. */
  function hopperPositionLabel(index, namingMode) {
    if (namingMode === "main-plus-five" || namingMode === "main") {
      return index === 0 ? "Main" : String(index);
    }
    return String(index + 1);
  }

  function hopperId(layerName, index, namingMode) {
    const position = hopperPositionLabel(index, namingMode);
    return `${layerName}${position === "Main" ? "M" : position}`;
  }

  function positiveInteger(value) {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : null;
  }

  /**
   * @param {object} snapshot  a state-bridge snapshot (or a demo's)
   * @returns {object|null}   { line, layers, hopperCount } or null when the
   *          snapshot describes no layers
   */
  function buildLineModel(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.layers) || snapshot.layers.length === 0) return null;
    const line = snapshot.line || {};
    const layerCount = snapshot.layers.length;
    const layerAPosition = line.layerAPosition === "inside" || line.layerAPosition === "outside" ? line.layerAPosition : null;
    const orientationKnown = layerCount === 1 || layerAPosition !== null;
    const reversed = layerAPosition === "inside";
    const namingMode = typeof line.hopperNamingMode === "string" ? line.hopperNamingMode : "standard";
    const counts = Array.isArray(line.hopperCounts) ? line.hopperCounts : null;

    const layers = snapshot.layers.map((layer, recipeIndex) => {
      const name = String((layer && layer.name) || String.fromCharCode(65 + recipeIndex));
      const stackIndex = reversed ? layerCount - 1 - recipeIndex : recipeIndex;
      const role = roleForStackIndex(stackIndex, layerCount);
      const present = Array.isArray(layer && layer.hoppers) ? layer.hoppers.length : 0;
      // The line's count caps the session's slots; never more than the
      // snapshot actually carries.
      const declared = counts ? positiveInteger(counts[recipeIndex]) : null;
      const hopperCount = declared ? Math.min(declared, present) : present;
      return {
        id: name,
        recipeIndex,
        stackIndex,
        role,
        roleLabel: roleLabel(role),
        tone: roleTone(role),
        hopperCount,
        hoppers: Array.from({ length: hopperCount }, (_, index) => ({
          id: hopperId(name, index, namingMode),
          layer: name,
          index,
          positionLabel: hopperPositionLabel(index, namingMode)
        }))
      };
    });

    return {
      line: {
        lineNumber: Number.isInteger(line.lineNumber) ? line.lineNumber : null,
        displayName: line.displayName ? String(line.displayName) : null,
        layerCount,
        layerAPosition,
        orientationKnown,
        hopperNamingMode: namingMode,
        linked: !!line.linked
      },
      layers,
      hopperCount: layers.reduce((sum, layer) => sum + layer.hopperCount, 0)
    };
  }

  /* What the header and subtitle call the line. */
  function lineTitle(model) {
    if (!model) return "No line";
    if (model.line.displayName) return model.line.displayName;
    if (model.line.lineNumber !== null) return `Line ${model.line.lineNumber}`;
    return "This device";
  }

  return Object.freeze({
    ROLE_LABEL, ROLE_TONE,
    roleForStackIndex, roleLabel, roleTone, hopperPositionLabel, hopperId,
    buildLineModel, lineTitle
  });
});
