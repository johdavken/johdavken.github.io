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
  function fillHoppers(rawComponents) {
    // A component read at exactly 0% isn't in the blend - drop it rather
    // than placing it as a resin name sitting at 0%, which would misreport
    // an unused hopper as an active one. A null/unread percentage is a
    // different case (a real resin whose percentage just couldn't be read)
    // and still gets placed, marked estimated, same as before.
    const components = rawComponents.filter(component => component.percentage !== 0);
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

  // If exactly one layer's percentage is missing, it's solvable the same way
  // H1's hopper percentage always is: 100 minus the rest. Two or more missing
  // is genuinely unsolvable (not enough knowns for the unknowns) and is left
  // for the operator to fill in on the review screen instead of guessed at.
  // Shared by both source types - Dosing Screen hits the "two or more
  // missing" branch on almost every scan, since it never prints any layer
  // percentage at all.
  function applySingleMissingLayerDerive(layers) {
    const missing = layers.filter(layer => layer.layer_pct_estimated);
    if (missing.length === 1) {
      const knownTotal = layers.filter(layer => !layer.layer_pct_estimated).reduce((total, layer) => total + layer.layer_pct, 0);
      const derived = 100 - knownTotal;
      if (derived >= 0 && derived <= 100) {
        missing[0].layer_pct = derived;
        missing[0].layer_pct_estimated = false;
        missing[0].layer_pct_derived = true;
      }
    }
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
        // Review-screen hints only - applyRecipePayload ignores unknown layer fields.
        layer_pct_estimated: scannedLayer.layer_percentage == null,
        layer_pct_derived: false,
        hoppers
      };
    });

    applySingleMissingLayerDerive(layers);

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

  // Dosing Screen: no orientation (layers are already listed top-to-bottom in
  // physical A-E order by the controller itself, unlike Job Traveler's
  // ambiguous "which end is A"), and no fill algorithm (component position
  // maps directly to hopper position on lines where that dosing naming
  // convention is enabled - the schema guarantees exactly 6 slots per layer,
  // nulls included, so array index is reliably hopper index).
  function mapDosingScreenComponents(components) {
    const slots = (components || []).slice(0, HOPPERS_PER_LAYER);
    while (slots.length < HOPPERS_PER_LAYER) slots.push({ resin_code: null, percentage: null });
    return slots.map(component => ({
      resin_name: component.resin_code || null,
      pct: component.percentage == null ? 0 : component.percentage,
      // A real resin is dosing here but its percentage couldn't be read -
      // distinct from a genuinely empty/unused hopper (both resin and
      // percentage null), which is not "estimated", just empty.
      percentage_estimated: component.resin_code != null && component.percentage == null
    }));
  }

  function buildDosingScreenRecipePayloadFromScan(scanRecipe, options) {
    const lineType = Number(options && options.lineType);
    const names = payloads.expectedLayerNames(lineType);
    if (!names) return { ok: false, reason: "invalid_line_type", message: "Unknown line configuration." };
    if (!scanRecipe || scanRecipe.layer_count !== lineType) {
      return { ok: false, reason: "layer_count_mismatch", message: "Wrong layer configuration for active line" };
    }

    const layers = names.map((name, index) => {
      const scannedLayer = scanRecipe.layers[index];
      const hoppers = mapDosingScreenComponents(scannedLayer.components);
      hoppers[0].pct = 100 - hoppers.slice(1).reduce((total, hopper) => total + hopper.pct, 0);
      return {
        name,
        layer_pct: scannedLayer.layer_percentage == null ? 0 : scannedLayer.layer_percentage,
        layer_pct_estimated: scannedLayer.layer_percentage == null,
        layer_pct_derived: false,
        hoppers
      };
    });

    applySingleMissingLayerDerive(layers);

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

  return { expectedPositionsForLetters, buildRecipePayloadFromScan, buildDosingScreenRecipePayloadFromScan };
});
