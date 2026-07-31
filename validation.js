(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ResinIQValidation = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const SUPPORTED_ACTIVE_JOB_VERSIONS = Object.freeze(["0.17"]);

  function parseNumber(value) {
    const text = String(value ?? "").trim();
    if (text === "") return { valid: true, value: 0 };

    const number = Number(text.replace(/,/g, ""));
    if (!Number.isFinite(number)) {
      return { valid: false, message: "Enter a valid number." };
    }
    return { valid: true, value: number };
  }

  function validateNumber(value, { min = 0, max = Infinity, label = "Value" } = {}) {
    const parsed = parseNumber(value);
    if (!parsed.valid) return parsed;
    if (parsed.value < min) {
      return { valid: false, message: `${label} cannot be less than ${min}.` };
    }
    if (parsed.value > max) {
      return { valid: false, message: `${label} cannot be greater than ${max}.` };
    }
    return parsed;
  }

  function validatePercentage(value, label = "Percentage") {
    return validateNumber(value, { min: 0, max: 100, label });
  }

  function validateHopperPercentages(percentages) {
    if (!Array.isArray(percentages)) {
      return { valid: false, message: "Hopper percentages are missing." };
    }

    const values = [];
    for (const percentage of percentages) {
      const result = validatePercentage(percentage, "Hopper percentage");
      if (!result.valid) return result;
      values.push(result.value);
    }

    const total = values.reduce((sum, value) => sum + value, 0);
    if (total > 100) {
      return {
        valid: false,
        total,
        message: "Hopper percentages 2–6 cannot total more than 100%."
      };
    }
    return { valid: true, total, values };
  }

  function validateConfigPayload(payload, { requireTotals = true } = {}) {
    const errors = [];
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return { valid: false, errors: ["Configuration payload must be an object."] };
    }

    const lineType = Number(payload.lineType);
    if (![1, 3, 5].includes(lineType)) {
      errors.push("Line type must be 1, 3, or 5.");
    }

    const numericFields = [
      ["lineRate", "Line rate"],
      ["gauge", "Gauge"],
      ["prodResinLb", "Production resin"],
      ["scrapResinLb", "Scrap resin"]
    ];
    for (const [key, label] of numericFields) {
      if (!(key in payload)) continue;
      const result = validateNumber(payload[key], { min: 0, label });
      if (!result.valid) errors.push(result.message);
    }

    if (payload.changeoverTime != null) {
      if (typeof payload.changeoverTime !== "string") {
        errors.push("Changeover time must be text.");
      } else if (payload.changeoverTime && !/^([01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(payload.changeoverTime)) {
        errors.push("Changeover time must be a valid 24-hour time.");
      }
    }
    if (payload.offsets != null && (typeof payload.offsets !== "object" || Array.isArray(payload.offsets))) {
      errors.push("Offsets must be an object.");
    }

    const expectedNames = lineType === 1
      ? ["A"]
      : lineType === 5
        ? ["A", "B", "C", "D", "E"]
        : lineType === 3
          ? ["A", "B", "C"]
          : [];

    if (!Array.isArray(payload.layers)) {
      errors.push("Layers must be an array.");
    } else {
      const layerPercentages = [];
      for (const name of expectedNames) {
        const matches = payload.layers.filter(layer => layer && layer.name === name);
        if (matches.length !== 1) {
          errors.push(`Layer ${name} must appear exactly once.`);
          continue;
        }

        const layer = matches[0];
        const layerResult = validatePercentage(layer.layerPct, `Layer ${name} percentage`);
        if (!layerResult.valid) errors.push(layerResult.message);
        else layerPercentages.push(layerResult.value);

        if (!Array.isArray(layer.hoppers) || layer.hoppers.length < 6) {
          errors.push(`Layer ${name} must contain six hoppers.`);
          continue;
        }

        const allPercentages = [];
        const secondaryPercentages = [];
        layer.hoppers.slice(0, 6).forEach((hopper, index) => {
          const label = `${name}${index + 1}`;
          if (!hopper || typeof hopper !== "object" || Array.isArray(hopper)) {
            errors.push(`Hopper ${label} must be an object.`);
            return;
          }

          const pctResult = validatePercentage(hopper.pct, `Hopper ${label} percentage`);
          if (!pctResult.valid) errors.push(pctResult.message);
          else allPercentages.push(pctResult.value);
          if (index > 0) secondaryPercentages.push(hopper.pct);

          const weightResult = validateNumber(hopper.weight, { min: 0, label: `Hopper ${label} weight` });
          if (!weightResult.valid) errors.push(weightResult.message);
          if (hopper.resinName != null && typeof hopper.resinName !== "string") {
            errors.push(`Hopper ${label} resin name must be text.`);
          } else if (typeof hopper.resinName === "string" && hopper.resinName.length > 100) {
            errors.push(`Hopper ${label} resin name is too long.`);
          }
          if (hopper.track != null && typeof hopper.track !== "boolean") {
            errors.push(`Hopper ${label} tracking state must be true or false.`);
          }
          if (hopper.pumpOff != null && typeof hopper.pumpOff !== "boolean") {
            errors.push(`Hopper ${label} pump-off state must be true or false.`);
          }
        });

        const totalResult = validateHopperPercentages(secondaryPercentages);
        if (!totalResult.valid && !errors.includes(totalResult.message)) {
          errors.push(`Layer ${name}: ${totalResult.message}`);
        }
        if (allPercentages.length === 6) {
          const hopperTotal = allPercentages.reduce((sum, value) => sum + value, 0);
          if ((requireTotals && Math.abs(hopperTotal - 100) > 0.0001) || (!requireTotals && hopperTotal > 100.0001)) {
            errors.push(requireTotals
              ? `Layer ${name} hopper percentages must total 100%.`
              : `Layer ${name} hopper percentages cannot exceed 100%.`);
          }
        }

        if (payload.offsets && typeof payload.offsets === "object" && !Array.isArray(payload.offsets)) {
          const offsetResult = validateNumber(payload.offsets[name], {
            min: 0,
            label: `Layer ${name} offset`
          });
          if (!offsetResult.valid) errors.push(offsetResult.message);
        }
      }
      if (layerPercentages.length === expectedNames.length) {
        const layerTotal = layerPercentages.reduce((sum, value) => sum + value, 0);
        if ((requireTotals && Math.abs(layerTotal - 100) > 0.0001) || (!requireTotals && layerTotal > 100.0001)) {
          errors.push(requireTotals ? "Layer percentages must total 100%." : "Layer percentages cannot exceed 100%.");
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  function validateActiveJobPayload(payload) {
    const result = validateConfigPayload(payload, { requireTotals: false });
    const errors = [...result.errors];
    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
      if (typeof payload.version !== "string" || !SUPPORTED_ACTIVE_JOB_VERSIONS.includes(payload.version)) {
        errors.push(`Active-job version must be one of: ${SUPPORTED_ACTIVE_JOB_VERSIONS.join(", ")}.`);
      }
      if (payload.hopperNamingLine9 != null && !["standard", "main"].includes(payload.hopperNamingLine9)) {
        errors.push("Hopper naming mode must be standard or main.");
      }
      if (JSON.stringify(payload).length > 131072) {
        errors.push("Active job is too large to synchronize.");
      }
    }
    return { valid: errors.length === 0, errors };
  }

  return {
    parseNumber,
    validateNumber,
    validatePercentage,
    validateHopperPercentages,
    validateConfigPayload,
    validateActiveJobPayload,
    SUPPORTED_ACTIVE_JOB_VERSIONS
  };
});
