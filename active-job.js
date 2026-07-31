(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ResinIQActiveJob = api;
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
    "hopperNamingLine9"
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
      hopperNamingLine9: state.hopperNamingLine9
    });
  }

  function canonicalActiveJob(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "";
    const ordered = {};
    ACTIVE_JOB_FIELDS.forEach(field => {
      if (field in payload) ordered[field] = payload[field];
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
        String(hopper?.resinName || "").trim() || hopper?.track || hopper?.pumpOff
      ))
    );
  }

  return {
    ACTIVE_JOB_FIELDS,
    snapshotActiveJob,
    canonicalActiveJob,
    activeJobsEqual,
    hasMeaningfulActiveJob
  };
});
