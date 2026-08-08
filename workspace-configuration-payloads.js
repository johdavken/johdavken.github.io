(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynWorkspaceConfigurationPayloads = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const SCHEMA_VERSION = 1;
  const HOPPERS_PER_LAYER = 6;
  const DEFAULT_PACKING_FACTOR = 0.63; // must match app.js's own DEFAULT_PACKING_FACTOR
  const LINE_LAYERS = Object.freeze({ 1: ["A"], 3: ["A", "B", "C"], 5: ["A", "B", "C", "D", "E"] });

  function expectedLayerNames(lineType){ return LINE_LAYERS[Number(lineType)] || null; }
  function clone(value){ return JSON.parse(JSON.stringify(value)); }
  function finiteInRange(value, minimum, maximum = Infinity){ return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum; }
  function normalizeResinName(value){
    if (value == null) return null;
    if (typeof value !== "string") return undefined;
    const name = value.trim();
    return name || null;
  }
  function hopperOnePercentage(hoppers){
    return 100 - hoppers.slice(1).reduce((total, hopper)=>total + hopper.pct, 0);
  }
  function sameNames(layers, names){
    return Array.isArray(layers) && layers.length === names.length
      && names.every((name, index)=>layers[index]?.name === name);
  }
  function validationResult(errors){ return { valid: errors.length === 0, errors }; }
  function validateHeader(payload, errors){
    if (!payload || typeof payload !== "object" || Array.isArray(payload)){
      errors.push("Payload must be an object.");
      return null;
    }
    if (payload.schema_version !== SCHEMA_VERSION) errors.push(`Unsupported payload schema version. Expected ${SCHEMA_VERSION}.`);
    const names = expectedLayerNames(payload.line_type);
    if (!Number.isInteger(payload.line_type) || !names) errors.push("Line type must be the number 1, 3, or 5.");
    if (!["standard", "main"].includes(payload.hopper_naming_mode)) errors.push("Hopper naming mode must be standard or main.");
    return names;
  }

  function createReceiverWeightProfile(state){
    const names = expectedLayerNames(state?.lineType) || [];
    return {
      schema_version: SCHEMA_VERSION,
      line_type: state?.lineType,
      hopper_naming_mode: state?.hopperNamingLine9 === "main" ? "main" : "standard",
      hoppers_per_layer: HOPPERS_PER_LAYER,
      layers: names.map(name=>{
        const layer = state?.layers?.find(item=>item?.name === name);
        return {
          name,
          receiver_weights_lb: Array.from({ length: HOPPERS_PER_LAYER }, (_, index)=>layer?.hoppers?.[index]?.weight),
          // Smart Hoppers geometry - same physical-equipment category as
          // receiver_weights_lb above, so it travels with the profile the
          // same way. Optional on read (see validate/apply below) so
          // profiles saved before this existed keep loading unchanged.
          usable_heights_in: Array.from({ length: HOPPERS_PER_LAYER }, (_, index)=>layer?.hoppers?.[index]?.usableHeight ?? 0),
          circumferences_in: Array.from({ length: HOPPERS_PER_LAYER }, (_, index)=>layer?.hoppers?.[index]?.circumference ?? 0),
          packing_factors: Array.from({ length: HOPPERS_PER_LAYER }, (_, index)=>layer?.hoppers?.[index]?.packingFactor ?? DEFAULT_PACKING_FACTOR)
        };
      })
    };
  }

  function validateReceiverWeightProfile(payload){
    const errors = [];
    const names = validateHeader(payload, errors);
    if (!names) return validationResult(errors);
    if (payload.hoppers_per_layer !== HOPPERS_PER_LAYER) errors.push(`Profiles must define ${HOPPERS_PER_LAYER} hoppers per layer.`);
    if (!sameNames(payload.layers, names)) errors.push(`Layers must be exactly ${names.join(", ")}.`);
    if (Array.isArray(payload.layers)) payload.layers.forEach(layer=>{
      if (!Array.isArray(layer?.receiver_weights_lb) || layer.receiver_weights_lb.length !== HOPPERS_PER_LAYER){
        errors.push(`Layer ${layer?.name || "?"} must contain exactly ${HOPPERS_PER_LAYER} receiver weights.`);
        return;
      }
      layer.receiver_weights_lb.forEach((weight, index)=>{
        if (!finiteInRange(weight, 0)) errors.push(`Layer ${layer.name} hopper ${index + 1} weight must be a finite value of 0 or greater.`);
      });
      // Each geometry array is optional (absent entirely = a profile saved
      // before Smart Hoppers existed) but if present must be fully valid -
      // partial/malformed arrays are rejected rather than silently ignored.
      if (layer?.usable_heights_in !== undefined){
        if (!Array.isArray(layer.usable_heights_in) || layer.usable_heights_in.length !== HOPPERS_PER_LAYER){
          errors.push(`Layer ${layer.name} usable heights must contain exactly ${HOPPERS_PER_LAYER} values.`);
        } else {
          layer.usable_heights_in.forEach((value, index)=>{
            if (!finiteInRange(value, 0)) errors.push(`Layer ${layer.name} hopper ${index + 1} usable height must be a finite value of 0 or greater.`);
          });
        }
      }
      if (layer?.circumferences_in !== undefined){
        if (!Array.isArray(layer.circumferences_in) || layer.circumferences_in.length !== HOPPERS_PER_LAYER){
          errors.push(`Layer ${layer.name} circumferences must contain exactly ${HOPPERS_PER_LAYER} values.`);
        } else {
          layer.circumferences_in.forEach((value, index)=>{
            if (!finiteInRange(value, 0)) errors.push(`Layer ${layer.name} hopper ${index + 1} circumference must be a finite value of 0 or greater.`);
          });
        }
      }
      if (layer?.packing_factors !== undefined){
        if (!Array.isArray(layer.packing_factors) || layer.packing_factors.length !== HOPPERS_PER_LAYER){
          errors.push(`Layer ${layer.name} packing factors must contain exactly ${HOPPERS_PER_LAYER} values.`);
        } else {
          layer.packing_factors.forEach((value, index)=>{
            if (!finiteInRange(value, 0.58, 0.68)) errors.push(`Layer ${layer.name} hopper ${index + 1} packing factor must be between 0.58 and 0.68.`);
          });
        }
      }
    });
    return validationResult(errors);
  }

  function applyReceiverWeightProfile(state, payload){
    const result = validateReceiverWeightProfile(payload);
    if (!result.valid) return { ok: false, errors: result.errors };
    if (!state || typeof state !== "object" || Array.isArray(state)) {
      return { ok: false, errors: ["Application state must be an object."] };
    }
    const names = expectedLayerNames(payload.line_type);
    if (Number(state?.lineType) !== payload.line_type || !sameNames(state?.layers, names)
        || state.layers.some(layer=>!Array.isArray(layer.hoppers) || layer.hoppers.length !== HOPPERS_PER_LAYER)) {
      return { ok: false, errors: ["Receiver Weight Profile is incompatible with the current line type or physical layer layout."] };
    }
    payload.layers.forEach((profileLayer, layerIndex)=>{
      profileLayer.receiver_weights_lb.forEach((weight, hopperIndex)=>{ state.layers[layerIndex].hoppers[hopperIndex].weight = weight; });
      // Absent (not just falsy) means an old profile predating Smart
      // Hoppers - leave whatever is already configured locally untouched
      // rather than resetting it to 0.
      if (Array.isArray(profileLayer.usable_heights_in)){
        profileLayer.usable_heights_in.forEach((value, hopperIndex)=>{ state.layers[layerIndex].hoppers[hopperIndex].usableHeight = value; });
      }
      if (Array.isArray(profileLayer.circumferences_in)){
        profileLayer.circumferences_in.forEach((value, hopperIndex)=>{ state.layers[layerIndex].hoppers[hopperIndex].circumference = value; });
      }
      if (Array.isArray(profileLayer.packing_factors)){
        profileLayer.packing_factors.forEach((value, hopperIndex)=>{ state.layers[layerIndex].hoppers[hopperIndex].packingFactor = value; });
      }
    });
    return { ok: true, lineTypeChanged: false };
  }

  function createRecipePayload(state){
    const names = expectedLayerNames(state?.lineType) || [];
    return {
      schema_version: SCHEMA_VERSION,
      line_type: state?.lineType,
      hopper_naming_mode: state?.hopperNamingLine9 === "main" ? "main" : "standard",
      layers: names.map(name=>{
        const layer = state?.layers?.find(item=>item?.name === name);
        return {
          name,
          layer_pct: layer?.layerPct,
          hoppers: Array.from({ length: HOPPERS_PER_LAYER }, (_, index)=>({
            resin_name: normalizeResinName(layer?.hoppers?.[index]?.resinName),
            pct: layer?.hoppers?.[index]?.pct
          }))
        };
      })
    };
  }

  function validateRecipePayload(payload){
    const errors = [];
    const names = validateHeader(payload, errors);
    if (!names) return validationResult(errors);
    if (!sameNames(payload.layers, names)) errors.push(`Layers must be exactly ${names.join(", ")}.`);
    const layerPercentages = [];
    if (Array.isArray(payload.layers)) payload.layers.forEach(layer=>{
      if (!finiteInRange(layer?.layer_pct, 0, 100)) errors.push(`Layer ${layer?.name || "?"} percentage must be between 0 and 100.`);
      else layerPercentages.push(layer.layer_pct);
      if (!Array.isArray(layer?.hoppers) || layer.hoppers.length !== HOPPERS_PER_LAYER){
        errors.push(`Layer ${layer?.name || "?"} must contain exactly ${HOPPERS_PER_LAYER} hopper assignments.`);
        return;
      }
      layer.hoppers.forEach((hopper, index)=>{
        const resinName = normalizeResinName(hopper?.resin_name);
        if (resinName === undefined || (resinName && resinName.length > 100)) errors.push(`Layer ${layer.name} hopper ${index + 1} resin name must be blank or at most 100 characters.`);
        if (!finiteInRange(hopper?.pct, 0, 100)) errors.push(`Layer ${layer.name} hopper ${index + 1} percentage must be between 0 and 100.`);
      });
      if (layer.hoppers.every(hopper=>finiteInRange(hopper?.pct, 0, 100))){
        const secondaryTotal = layer.hoppers.slice(1).reduce((total, hopper)=>total + hopper.pct, 0);
        const total = layer.hoppers.reduce((sum, hopper)=>sum + hopper.pct, 0);
        if (secondaryTotal > 100.0001) errors.push(`Layer ${layer.name} hopper percentages 2–6 cannot exceed 100%.`);
        if (Math.abs(total - 100) > 0.0001) errors.push(`Layer ${layer.name} hopper percentages must total 100%.`);
        if (Math.abs(layer.hoppers[0].pct - (100 - secondaryTotal)) > 0.0001) errors.push(`Layer ${layer.name} hopper 1 percentage must match the automatic remainder.`);
      }
    });
    if (layerPercentages.length === names.length && Math.abs(layerPercentages.reduce((sum, value)=>sum + value, 0) - 100) > 0.0001) errors.push("Layer percentages must total 100%.");
    return validationResult(errors);
  }

  function applyRecipePayload(state, payload){
    const result = validateRecipePayload(payload);
    if (!result.valid) return { ok: false, errors: result.errors };
    if (!state || typeof state !== "object" || Array.isArray(state)) {
      return { ok: false, errors: ["Application state must be an object."] };
    }
    const names = expectedLayerNames(payload.line_type);
    const previous = new Map((Array.isArray(state?.layers) ? state.layers : []).map(layer=>[layer.name, layer]));
    const targetLayers = payload.layers.map(layer=>{
      const previousLayer = previous.get(layer.name);
      return {
        name: layer.name,
        layerPct: layer.layer_pct,
        hoppers: layer.hoppers.map((hopper, index)=>{
          const physical = previousLayer?.hoppers?.[index];
          return {
            pct: hopper.pct,
            resinName: normalizeResinName(hopper.resin_name) || "",
            // Matches the app's ensureLayers() defaults when a recipe adds a layer.
            // A recipe never carries physical-equipment values - weight, and now
            // Smart Hoppers' usableHeight/circumference/packingFactor, always come
            // from the hopper already in state, never from the recipe payload.
            weight: physical?.weight ?? 0,
            track: !!physical?.track,
            pumpOff: !!physical?.pumpOff,
            usableHeight: physical?.usableHeight ?? 0,
            circumference: physical?.circumference ?? 0,
            packingFactor: physical?.packingFactor ?? DEFAULT_PACKING_FACTOR
          };
        })
      };
    });
    targetLayers.forEach(layer=>{ layer.hoppers[0].pct = hopperOnePercentage(layer.hoppers); });
    const lineTypeChanged = Number(state.lineType) !== Number(payload.line_type);
    state.lineType = payload.line_type;
    state.hopperNamingLine9 = payload.hopper_naming_mode;
    state.layers = targetLayers;
    return { ok: true, lineTypeChanged, layers: clone(targetLayers) };
  }

  return {
    SCHEMA_VERSION,
    HOPPERS_PER_LAYER,
    expectedLayerNames,
    createReceiverWeightProfile,
    validateReceiverWeightProfile,
    applyReceiverWeightProfile,
    createRecipePayload,
    validateRecipePayload,
    applyRecipePayload
  };
});
