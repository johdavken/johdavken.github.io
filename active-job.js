(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynActiveJob = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const ACTIVE_JOB_FIELDS = Object.freeze([
    "version",
    "lineRate",
    "lineType",
    "gauge",
    "changeoverTime",
    "offsets",
    "layers",
    // Resin code -> scanned lot number, for Current. Job-specific, never
    // part of a recipe definition (see next-recipe.js/workspace-
    // configuration-payloads.js, neither of which knows this field exists),
    // so it travels through the active job the same way layers does, rather
    // than needing a synchronization path of its own.
    "resinLots",
    // The planned recipe for the coming changeover. Listed here, and only
    // here, is what makes it share safely: canonicalActiveJob iterates this
    // list, so the existing no-op guard compares the plan too - an edit to it
    // produces exactly one debounced upload, and re-saving an unchanged plan
    // produces none. No new channel, subscription or write path is involved.
    //
    // Deliberately left at active-job version 0.17: this is an additive,
    // optional field, so a client running older code still accepts the
    // payload. Such a client does not understand the plan and would drop it
    // when it next writes - the plan is lost, but the running recipe is never
    // corrupted. Bumping the version instead would make older clients reject
    // the whole payload, which is strictly worse.
    "nextRecipe",
    // Same idea as resinLots above, for the Next page's own scanned lots.
    "nextRecipeLots",
    "prodResinLb",
    "scrapResinLb",
    "hopperNamingLine9",
    "hopperCircumference"
  ]);

  function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function snapshotActiveJob(state, version) {
    return cloneJson({
      version,
      lineRate: state.lineRate,
      lineType: state.lineType,
      gauge: state.gauge,
      changeoverTime: state.changeoverTime,
      offsets: state.offsets,
      layers: state.layers,
      resinLots: state.resinLots ?? {},
      nextRecipe: state.nextRecipe ?? null,
      nextRecipeLots: state.nextRecipeLots ?? {},
      prodResinLb: state.prodResinLb,
      scrapResinLb: state.scrapResinLb,
      hopperNamingLine9: state.hopperNamingLine9,
      hopperCircumference: state.hopperCircumference
    });
  }

  // JSON.stringify preserves insertion order for object properties. Active
  // jobs can arrive from the server or be reconstructed by several client
  // paths, so nested layer/hopper objects may carry the same values in a
  // different key order. Sort every object recursively while preserving
  // array order: arrays are semantic (layer/hopper position), object key
  // order is not.
  function canonicalJsonValue(value) {
    if (Array.isArray(value)) return value.map(canonicalJsonValue);
    if (value && typeof value === "object") {
      const ordered = {};
      Object.keys(value).sort().forEach(key => {
        ordered[key] = canonicalJsonValue(value[key]);
      });
      return ordered;
    }
    return value;
  }

  function canonicalActiveJob(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "";
    const ordered = {};
    ACTIVE_JOB_FIELDS.forEach(field => {
      if (field in payload) ordered[field] = canonicalJsonValue(payload[field]);
    });
    return JSON.stringify(ordered);
  }

  function activeJobsEqual(left, right) {
    return canonicalActiveJob(left) === canonicalActiveJob(right);
  }

  function hasMeaningfulActiveJob(payload) {
    if (!payload || typeof payload !== "object") return false;
    if (Number(payload.lineRate) > 0 || Number(payload.gauge) > 0 || payload.changeoverTime) return true;
    return Array.isArray(payload.layers) && payload.layers.some(layer =>
      Number(layer?.layerPct) > 0 || (Array.isArray(layer?.hoppers) && layer.hoppers.some(hopper =>
        Number(hopper?.weight) > 0 || Number(hopper?.pct) > 0 && hopper?.resinName ||
        String(hopper?.resinName || "").trim() || hopper?.track || hopper?.pumpOff ||
        Number(hopper?.usableHeight) > 0 || Number(hopper?.circumference) > 0 || Number(hopper?.usableGallons) > 0
      ))
    );
  }

  return {
    ACTIVE_JOB_FIELDS,
    canonicalJsonValue,
    snapshotActiveJob,
    canonicalActiveJob,
    activeJobsEqual,
    hasMeaningfulActiveJob
  };
});
