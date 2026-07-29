(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ResinIQCalculators = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function estimateBulkDensity(polymerDensity, packingFactor = 0.63) {
    const density = Number(polymerDensity);
    const factor = Number(packingFactor);
    if (!Number.isFinite(density) || density < 0 || !Number.isFinite(factor) || factor < 0) {
      return NaN;
    }
    return density * 62.43 * factor;
  }

  function calculateHopperWeight(circumference, height, bulkDensity) {
    const circumferenceIn = Number(circumference);
    const heightIn = Number(height);
    const densityLbFt3 = Number(bulkDensity);
    if (
      !Number.isFinite(circumferenceIn) || circumferenceIn < 0 ||
      !Number.isFinite(heightIn) || heightIn < 0 ||
      !Number.isFinite(densityLbFt3) || densityLbFt3 < 0
    ) {
      return NaN;
    }

    const radius = circumferenceIn / (2 * Math.PI);
    const volumeIn3 = Math.PI * radius * radius * heightIn;
    const volumeFt3 = volumeIn3 / 1728;
    return volumeFt3 * densityLbFt3;
  }

  return { estimateBulkDensity, calculateHopperWeight };
});
