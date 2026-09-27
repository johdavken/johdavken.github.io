/* The line rate estimate - the output a blown-film line makes from the
 * film it is running: layflat width, gauge, line speed and the product's
 * density, as the job traveler states them.
 *
 * WHAT THIS IS
 *
 * The arithmetic and the answers behind Slate's Line Rate calculator,
 * restated here as an application module so any presentation can run it
 * without a copy of the formula. The tube collapsed flat is two plies, so
 * the film the line extrudes is twice the layflat:
 *
 *   lb/hr = layflat (in) x 2 x gauge (mil) / 1000 x speed (ft/min) x 12 x 60 x density (lb/in3)
 *
 * with density converted from g/cm3 (1 g/cm3 = 0.0361273 lb/in3).
 *
 * WHAT IT REMEMBERS, AND WHERE
 *
 * The operator's last answers, device-local under one key, as the
 * changeover wizard keeps its own: a convenience, restored into the
 * prompts next time. Nothing here is job state: the line rate itself is
 * the application's, set through its own setLineRate. No RT Sync, no
 * Supabase, no network.
 *
 * The blend average is a courtesy: the recipe's resins weighted by blend
 * and layer share, from the catalog's polymer densities, offered beside
 * the density prompt so the traveler's figure can be checked against it.
 * Blends add by volume, so it is the weighted harmonic mean, and it is
 * all or nothing: one resin without a density leaves no average (the same
 * rule as product-density.js, which Formulas uses).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynLineRateEstimate = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const STORAGE_KEY = "resinTimer.lineRateCalculator.v0.01";
  const DEFAULT_ANSWERS = Object.freeze({ layflat: "", mil: "", lineSpeed: "", density: "" });
  const FIELDS = Object.freeze(Object.keys(DEFAULT_ANSWERS));
  /* 1 g/cm3 in lb/in3. */
  const LB_PER_IN3_PER_G_CM3 = 0.0361273;
  const PLIES = 2;

  function storageFrom(environment) {
    try {
      const storage = environment && environment.localStorage;
      return storage && typeof storage.getItem === "function" ? storage : null;
    } catch (error) {
      return null;
    }
  }

  function readAnswers(storage) {
    if (!storage) return Object.assign({}, DEFAULT_ANSWERS);
    try {
      const saved = JSON.parse(storage.getItem(STORAGE_KEY) || "null");
      const out = Object.assign({}, DEFAULT_ANSWERS);
      if (saved && typeof saved === "object") for (const field of FIELDS) if (field in saved) out[field] = String(saved[field] == null ? "" : saved[field]);
      return out;
    } catch (error) {
      return Object.assign({}, DEFAULT_ANSWERS);
    }
  }

  function saveAnswers(storage, answers) {
    if (!storage || typeof storage.setItem !== "function") return false;
    const out = {};
    for (const field of FIELDS) out[field] = String(answers && answers[field] != null ? answers[field] : "");
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(out));
      return true;
    } catch (error) {
      return false;
    }
  }

  /** One answer, checked at its prompt: every one a number greater than zero. */
  function validateAnswer(field, raw) {
    if (!FIELDS.includes(field)) return { ok: false, message: "Unknown field." };
    const value = Number(raw);
    if (String(raw == null ? "" : raw).trim() === "" || !Number.isFinite(value) || value <= 0) {
      return { ok: false, message: "Enter a value greater than zero." };
    }
    return { ok: true, message: "" };
  }

  /**
   * The line rate the answers make, or null when they do not make one.
   * @returns {{ lbPerHour: number, widthIn: number, lbPerHourRounded: number }|null}
   */
  function estimate(answers) {
    const a = answers || {};
    const layflat = Number(a.layflat);
    const mil = Number(a.mil);
    const lineSpeed = Number(a.lineSpeed);
    const density = Number(a.density);
    if (![layflat, mil, lineSpeed, density].every(Number.isFinite) || layflat <= 0 || mil <= 0 || lineSpeed <= 0 || density <= 0) return null;
    const widthIn = layflat * PLIES;
    const cubicInchesPerHour = widthIn * (mil / 1000) * lineSpeed * 12 * 60;
    const lbPerHour = cubicInchesPerHour * density * LB_PER_IN3_PER_G_CM3;
    if (!Number.isFinite(lbPerHour)) return null;
    return { lbPerHour, widthIn, lbPerHourRounded: Math.round(lbPerHour) };
  }

  /* The items that weigh anything: a blend in a layer with a share. */
  function weighted(items) {
    return (Array.isArray(items) ? items : []).filter(item => {
      const share = Number(item && item.share);
      const pct = Number(item && item.pct);
      return Number.isFinite(share) && Number.isFinite(pct) && share > 0 && pct > 0;
    });
  }

  function hasDensity(item) {
    const density = Number(item && item.density);
    return item && item.density !== null && Number.isFinite(density) && density > 0;
  }

  /**
   * The recipe's density: each hopper weighted by its blend within its
   * layer and the layer's share of the film, the weighted harmonic mean -
   * volumes add, densities do not. None when a weighted hopper's resin has
   * no density in the catalog: an average that leaves a resin out is not
   * the recipe's.
   * @param {Array<{share: number, pct: number, density: number|null, code?: string}>} items
   * @returns {number|null}
   */
  function blendDensity(items) {
    const list = weighted(items);
    if (!list.length || !list.every(hasDensity)) return null;
    let weight = 0;
    let volume = 0;
    for (const item of list) {
      const w = (Number(item.share) / 100) * (Number(item.pct) / 100);
      weight += w;
      volume += w / Number(item.density);
    }
    return weight / volume;
  }

  /** The resins, once each in recipe order, that leave no average. */
  function missingDensities(items) {
    const missing = [];
    for (const item of weighted(items)) {
      const code = String((item && item.code) || "");
      if (!hasDensity(item) && code && !missing.includes(code)) missing.push(code);
    }
    return missing;
  }

  /** "0.923" - three places, as densities are written. */
  function formatDensity(value) {
    return Number.isFinite(value) ? value.toFixed(3) : "";
  }

  function accept(storage, answers) {
    return saveAnswers(storage, answers);
  }

  return Object.freeze({ STORAGE_KEY, DEFAULT_ANSWERS, FIELDS, LB_PER_IN3_PER_G_CM3, PLIES, storageFrom, readAnswers, saveAnswers, validateAnswer, estimate, blendDensity, missingDensities, formatDensity, accept });
});
