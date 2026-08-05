(function (root, factory) {
  const dependency = typeof require === "function" ? require("./workspace-configuration-payloads.js") : (root && root.PolynWorkspaceConfigurationPayloads);
  const api = factory(dependency);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynRecipeScanMapping = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (payloads) {
  "use strict";

  // Converts a sanitized recipe-scan result (see recipe-scan-schema.js) into a
  // payload shaped for PolynWorkspaceConfigurationPayloads.applyRecipePayload,
  // so scanning reuses the exact same guarded apply/validate/merge pathway as
  // loading a cloud recipe - no parallel mutation logic.

  const HOPPERS_PER_LAYER = 6;

  // Left-to-right printed order, inside->outside. The Edge Function derives
  // each scanned layer's position from column order (not header text), so
  // scanRecipe.layers is already in this order - orientation only decides
  // which physical end printed layer 1 corresponds to.
  const POSITION_ORDER = {
    1: ["single"],
    3: ["inside", "core", "outside"],
    5: ["inside", "inside_subskin", "core", "outside_subskin", "outside"]
  };

  function expectedPositionsForLetters(lineType, orientation) {
    const order = POSITION_ORDER[Number(lineType)];
    if (!order) return null;
    return orientation === "outside" ? order.slice().reverse() : order.slice();
  }

  // Places components into the 6 hopper slots: components with a unique,
  // legible hopper_designation claim that exact slot first; everything else
  // (no designation, or a designation two+ components both claimed) fills
  // the remaining slots in printed order. Matches the "reduce, don't replace,
  // the manual drag step" design.
  function fillHoppers(components) {
    const slots = new Array(HOPPERS_PER_LAYER).fill(null);
    const designationCounts = new Map();
    components.forEach(component => {
      if (component.hopper_designation) {
        designationCounts.set(component.hopper_designation, (designationCounts.get(component.hopper_designation) || 0) + 1);
      }
    });

    const queue = [];
    components.forEach(component => {
      const designation = component.hopper_designation;
      const isUnique = designation && designationCounts.get(designation) === 1;
      const index = isUnique ? Number(designation.slice(1)) - 1 : -1;
      if (isUnique && index >= 0 && index < HOPPERS_PER_LAYER && !slots[index]) {
        slots[index] = component;
      } else {
        queue.push(component);
      }
    });

    let cursor = 0;
    queue.forEach(component => {
      while (cursor < HOPPERS_PER_LAYER && slots[cursor]) cursor++;
      if (cursor < HOPPERS_PER_LAYER) slots[cursor] = component;
    });

    return slots.map(component => ({
      resin_name: component ? (component.resin_code || null) : null,
      pct: component ? (component.percentage == null ? 0 : component.percentage) : 0,
      // Review-screen hint only - applyRecipePayload ignores unknown hopper
      // fields. True when a real component landed here but its percentage
      // couldn't be read, so the 0% above is a placeholder, not a real read.
      percentage_estimated: !!component && component.percentage == null
    }));
  }

  function buildRecipePayloadFromScan(scanRecipe, options) {
    const lineType = Number(options && options.lineType);
    const names = payloads.expectedLayerNames(lineType);
    if (!names) return { ok: false, reason: "invalid_line_type", message: "Unknown line configuration." };
    if (!scanRecipe || scanRecipe.layer_count !== lineType) {
      return { ok: false, reason: "layer_count_mismatch", message: "Wrong layer configuration for active line" };
    }

    const orientation = options && options.orientation;
    const orderedLayers = orientation === "outside" ? scanRecipe.layers.slice().reverse() : scanRecipe.layers.slice();

    const layers = names.map((name, index) => {
      const scannedLayer = orderedLayers[index];
      const hoppers = fillHoppers(scannedLayer.components || []);
      hoppers[0].pct = 100 - hoppers.slice(1).reduce((total, hopper) => total + hopper.pct, 0);
      return {
        name,
        layer_pct: scannedLayer.layer_percentage == null ? 0 : scannedLayer.layer_percentage,
        // Review-screen hint only - applyRecipePayload ignores unknown layer fields.
        layer_pct_estimated: scannedLayer.layer_percentage == null,
        hoppers
      };
    });

    return {
      ok: true,
      payload: {
        schema_version: payloads.SCHEMA_VERSION,
        line_type: lineType,
        hopper_naming_mode: (options && options.hopperNamingMode) === "main" ? "main" : "standard",
        layers
      }
    };
  }

  return { expectedPositionsForLetters, buildRecipePayloadFromScan };
});
