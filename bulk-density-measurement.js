(function(root, factory){
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynBulkDensityMeasurement = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function(){
  "use strict";

  const WATER_CALIBRATION_LB = 32;
  const WATER_DENSITY_LB_FT3 = 62.43;
  const POLYMER_DENSITY_MIN = 0.001;
  const POLYMER_DENSITY_MAX = 10;
  const DATABASE_BULK_DENSITY_MIN = 1;
  const DATABASE_BULK_DENSITY_MAX = 100;
  const IMPLAUSIBLY_LOW_PACKING_FACTOR = 0.2;

  function numeric(value){
    if (typeof value === "number") return value;
    if (typeof value !== "string" || !value.trim()) return Number.NaN;
    return Number(value);
  }

  function calculate({ resinWeightLb, polymerDensityGCm3 } = {}){
    const errors = [];
    const warnings = [];
    const resinWeight = numeric(resinWeightLb);
    const polymerMissing = polymerDensityGCm3 === null
      || polymerDensityGCm3 === undefined
      || String(polymerDensityGCm3).trim() === "";
    const polymerDensity = polymerMissing ? null : numeric(polymerDensityGCm3);

    if (!Number.isFinite(resinWeight) || resinWeight <= 0){
      errors.push("Measured resin weight must be a finite number greater than zero.");
    }
    if (!polymerMissing && (!Number.isFinite(polymerDensity)
        || polymerDensity < POLYMER_DENSITY_MIN
        || polymerDensity > POLYMER_DENSITY_MAX)){
      errors.push(`Polymer density must be between ${POLYMER_DENSITY_MIN} and ${POLYMER_DENSITY_MAX} g/cm³.`);
    }
    if (errors.length) return { valid:false, errors, warnings, resinWeightLb:resinWeight, polymerDensityGCm3:polymerDensity };

    // The calibrated container volume is the volume occupied by 32 lb of
    // water. Since water is approximately 1.0 g/cm³, the resin/water weight
    // ratio is also the measured bulk density in g/cm³ for that same volume.
    const bulkDensityGCm3 = resinWeight / WATER_CALIBRATION_LB;
    const bulkDensityLbFt3 = bulkDensityGCm3 * WATER_DENSITY_LB_FT3;
    const packingFactor = polymerDensity === null ? null : bulkDensityGCm3 / polymerDensity;
    const databaseAllowed = bulkDensityLbFt3 >= DATABASE_BULK_DENSITY_MIN
      && bulkDensityLbFt3 <= DATABASE_BULK_DENSITY_MAX;

    if (!databaseAllowed){
      warnings.push(`Measured bulk density is outside the Resin Database range of ${DATABASE_BULK_DENSITY_MIN}–${DATABASE_BULK_DENSITY_MAX} lb/ft³.`);
    }
    if (packingFactor !== null && packingFactor > 1){
      warnings.push("Packing factor is greater than 1.0; check the net weights and polymer density.");
    }else if (packingFactor !== null && packingFactor < IMPLAUSIBLY_LOW_PACKING_FACTOR){
      warnings.push("Packing factor is implausibly low; check the fill level and net weights.");
    }

    return {
      valid:true,
      errors,
      warnings,
      resinWeightLb:resinWeight,
      polymerDensityGCm3:polymerDensity,
      bulkDensityLbFt3,
      bulkDensityGCm3,
      packingFactor,
      databaseAllowed
    };
  }

  return {
    WATER_CALIBRATION_LB,
    WATER_DENSITY_LB_FT3,
    POLYMER_DENSITY_MIN,
    POLYMER_DENSITY_MAX,
    DATABASE_BULK_DENSITY_MIN,
    DATABASE_BULK_DENSITY_MAX,
    IMPLAUSIBLY_LOW_PACKING_FACTOR,
    calculate
  };
});
