(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynCalculators = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function estimateBulkDensity(polymerDensity, packingFactor = 0.63, gCm3ToLbFt3 = 62.43) {
    const density = Number(polymerDensity);
    const factor = Number(packingFactor);
    const conversion = Number(gCm3ToLbFt3);
    if (
      !Number.isFinite(density) || density < 0 ||
      !Number.isFinite(factor) || factor < 0 ||
      !Number.isFinite(conversion) || conversion < 0
    ) {
      return NaN;
    }
    return density * conversion * factor;
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

  function calculateHopperVolumeWeight(gallons, bulkDensity) {
    const gal = Number(gallons);
    const densityLbFt3 = Number(bulkDensity);
    if (
      !Number.isFinite(gal) || gal < 0 ||
      !Number.isFinite(densityLbFt3) || densityLbFt3 < 0
    ) {
      return NaN;
    }

    const volumeFt3 = gal * 0.133681;
    return volumeFt3 * densityLbFt3;
  }

  return { estimateBulkDensity, calculateHopperWeight, calculateHopperVolumeWeight };
});
