(function(root, factory){
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynBulkDensityMeasurement = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function(){
  "use strict";

  const DEFAULT_WATER_CALIBRATION_LB = 32;
  const WATER_CALIBRATION_STORAGE_KEY = "resinTools.bulkDensity.waterCalibration.v1";
  // Kept as a public alias for callers that used the original fixed
  // calibration constant. The calculator now accepts any positive
  // calibration weight instead of using this value as a fixed container.
  const WATER_CALIBRATION_LB = DEFAULT_WATER_CALIBRATION_LB;
  const WATER_DENSITY_LB_FT3 = 62.428;
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

  function readStoredWaterCalibration(storage){
    try{
      const value = numeric(storage?.getItem(WATER_CALIBRATION_STORAGE_KEY));
      if (Number.isFinite(value) && value > 0) return value;
    }catch(_error){
      // Local storage can be unavailable in private or embedded browsers.
    }
    return DEFAULT_WATER_CALIBRATION_LB;
  }

  function persistWaterCalibration(value, storage){
    const calibration = numeric(value);
    if (!Number.isFinite(calibration) || calibration <= 0) return false;
    try{
      storage?.setItem(WATER_CALIBRATION_STORAGE_KEY, String(calibration));
      return true;
    }catch(_error){
      return false;
    }
  }

  function calculate({
    waterCalibrationLb = DEFAULT_WATER_CALIBRATION_LB,
    resinWeightLb,
    polymerDensityGCm3
  } = {}){
    const errors = [];
    const warnings = [];
    const waterCalibration = numeric(waterCalibrationLb);
    const resinWeight = numeric(resinWeightLb);
    const polymerMissing = polymerDensityGCm3 === null
      || polymerDensityGCm3 === undefined
      || String(polymerDensityGCm3).trim() === "";
    const polymerDensity = polymerMissing ? null : numeric(polymerDensityGCm3);

    if (!Number.isFinite(waterCalibration) || waterCalibration <= 0){
      errors.push("Water calibration must be a finite number greater than zero.");
    }
    if (!Number.isFinite(resinWeight) || resinWeight <= 0){
      errors.push("Resin net weight must be a finite number greater than zero.");
    }
    if (!polymerMissing && (!Number.isFinite(polymerDensity)
        || polymerDensity < POLYMER_DENSITY_MIN
        || polymerDensity > POLYMER_DENSITY_MAX)){
      errors.push(`Polymer density must be between ${POLYMER_DENSITY_MIN} and ${POLYMER_DENSITY_MAX} g/cm³.`);
    }
    if (errors.length) return {
      valid:false,
      errors,
      warnings,
      waterCalibrationLb:waterCalibration,
      resinWeightLb:resinWeight,
      polymerDensityGCm3:polymerDensity
    };

    // The weight ratio establishes the resin density directly. No bucket
    // size or container volume needs to be known or inferred.
    const bulkDensityLbFt3 = (resinWeight / waterCalibration) * WATER_DENSITY_LB_FT3;
    const bulkDensityGCm3 = bulkDensityLbFt3 / WATER_DENSITY_LB_FT3;
    const solidDensityLbFt3 = polymerDensity === null ? null : polymerDensity * WATER_DENSITY_LB_FT3;
    const packingFactor = solidDensityLbFt3 === null ? null : bulkDensityLbFt3 / solidDensityLbFt3;
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
      waterCalibrationLb:waterCalibration,
      resinWeightLb:resinWeight,
      polymerDensityGCm3:polymerDensity,
      bulkDensityLbFt3,
      bulkDensityGCm3,
      solidDensityLbFt3,
      packingFactor,
      databaseAllowed
    };
  }

  return {
    DEFAULT_WATER_CALIBRATION_LB,
    WATER_CALIBRATION_STORAGE_KEY,
    WATER_CALIBRATION_LB,
    WATER_DENSITY_LB_FT3,
    POLYMER_DENSITY_MIN,
    POLYMER_DENSITY_MAX,
    DATABASE_BULK_DENSITY_MIN,
    DATABASE_BULK_DENSITY_MAX,
    IMPLAUSIBLY_LOW_PACKING_FACTOR,
    readStoredWaterCalibration,
    persistWaterCalibration,
    calculate
  };
});
