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
        Number(hopper?.usableHeight) > 0 || Number(hopper?.circumference) > 0
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
