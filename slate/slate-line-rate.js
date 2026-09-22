/* The line rate calculator: the output the line makes from the film it
 * is running, as a popover under the Line rate card.
 *
 * Four prompts, one at a time - the layflat width, the gauge, the line
 * speed, the product's density from the job traveler - then the estimate,
 * with "Use 574 lb/hr" or "Adjust answers". The arithmetic, the checks
 * and the remembered answers are line-rate-estimate.js's, the
 * application's own module; the walking and drawing are slate-wizard.js's.
 *
 * The density prompt offers the recipe's blend average beside the
 * traveler's figure: each hopper's polymer density from the catalog,
 * weighted by its blend and its layer's share. The average is a check,
 * never the answer - the field starts on the last figure entered, or on
 * the average when there is none.
 *
 * It dispatches nothing. Use hands the rounded pounds per hour to
 * `apply`, the card's own setLineRate path (slate-stat-cards.js).
 */
(function (root, factory) {
  const pick = (name, file) => (typeof require === "function" ? require(file) : (root && root[name]));
  const api = factory(pick("PolynSlateWizard", "./slate-wizard.js"));
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynSlateLineRate = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (wizardModule) {
  "use strict";

  const TITLE = "Line rate calculator";
  const OPEN_LABEL = "Calculate the line rate";
  const UNAVAILABLE = "The line rate calculator is not available on this page.";
  const NO_ESTIMATE = "Those answers do not add up to a line rate. Start again.";
  const USED = rate => `Line rate set to ${rate} lb/hr.`;
  const NO_BLEND = "No blend average: the recipe's resins have no densities in the catalog.";

  const STEPS = Object.freeze([
    Object.freeze({ field: "layflat", kind: "number", question: "What’s the layflat width?", unit: "in" }),
    Object.freeze({ field: "mil", kind: "number", question: "What’s the gauge?", unit: "mil" }),
    Object.freeze({ field: "lineSpeed", kind: "number", question: "What’s the line speed?", unit: "ft/min" }),
    Object.freeze({ field: "density", kind: "number", question: "What’s the product density on the traveler?", unit: "g/cc" })
  ]);
  const ESTIMATE_STEP = STEPS.length;

  function normalizeCode(value) {
    return String(value == null ? "" : value).trim().replace(/\s+/g, " ").toUpperCase();
  }

  /**
   * The recipe's hoppers as the estimate's blend items: each hopper's
   * blend and its layer's share, with its resin's density from the catalog
   * (null where the catalog has none or the resin is unknown).
   * @param {object} resolved   the source with hopperState / layerState
   * @param {Array} catalog     the resin catalog (resin_code, density_g_cm3)
   */
  function blendItems(resolved, catalog) {
    const hoppers = (resolved && resolved.hopperState) || {};
    const layers = (resolved && resolved.layerState) || {};
    const densities = new Map();
    for (const resin of Array.isArray(catalog) ? catalog : []) {
      const code = normalizeCode(resin && (resin.resin_code || resin.code));
      const density = Number(resin && (resin.density_g_cm3 != null ? resin.density_g_cm3 : resin.density));
      if (code && Number.isFinite(density) && density > 0) densities.set(code, density);
    }
    const items = [];
    for (const key of Object.keys(hoppers)) {
      const hopper = hoppers[key] || {};
      const layerId = key.split(":")[0];
      const layer = layers[layerId] || {};
      const code = normalizeCode(hopper.resinName);
      if (!code) continue;
      items.push({ share: Number(layer.layerPct) || 0, pct: Number(hopper.pct) || 0, density: densities.has(code) ? densities.get(code) : null });
    }
    return items;
  }

  /** "40 in layflat • 2 mil • 150 ft/min • 0.920 g/cc" */
  function summaryText(answers) {
    return `${Number(answers.layflat)} in layflat • ${Number(answers.mil)} mil • ${Number(answers.lineSpeed)} ft/min • ${Number(answers.density).toFixed(3)} g/cc`;
  }

  /**
   * @param {Document} doc
   * @param {object} options
   * @param {object|null} options.estimate    line-rate-estimate.js (PolynLineRateEstimate), or null
   * @param {object|null} [options.storage]
   * @param {function} options.apply          (lbPerHour) -> the card's result for setLineRate
   * @param {function} [options.blendDensity] () -> the recipe's blend average, or null
   * @param {function} [options.able]
   * @param {function} [options.say]
   * @param {function} [options.onChange]
   * @param {Element} [options.anchor]
   * @param {object} [options.view]
   */
  function create(doc, options) {
    const settings = options || {};
    const calc = settings.estimate || null;
    const storage = settings.storage || null;
    const apply = typeof settings.apply === "function" ? settings.apply : () => ({ ok: false, code: "unavailable", message: UNAVAILABLE });
    const blendDensity = typeof settings.blendDensity === "function" ? settings.blendDensity : () => null;
    const format = value => (calc ? calc.formatDensity(value) : String(value));

    const steps = STEPS.map(step => (step.field !== "density" ? step : Object.assign({}, step, {
      hint: () => { const blend = blendDensity(); return Number.isFinite(blend) ? `Blend average from the recipe: ${format(blend)} g/cc` : NO_BLEND; },
      suggest: () => { const blend = blendDensity(); return Number.isFinite(blend) ? format(blend) : ""; }
    })));

    return wizardModule.create(doc, {
      title: TITLE,
      ready: !!calc,
      unavailable: UNAVAILABLE,
      noEstimate: NO_ESTIMATE,
      steps,
      read: () => (calc ? calc.readAnswers(storage) : {}),
      save: answers => { if (calc) calc.saveAnswers(storage, answers); },
      validate: (field, raw) => (calc ? calc.validateAnswer(field, raw) : { ok: true, message: "" }),
      estimate: answers => (calc ? calc.estimate(answers) : null),
      page: (result, answers) => {
        const rate = result.lbPerHourRounded.toLocaleString("en-US");
        return { title: "Estimated line rate", headline: `${rate} lb/hr`, lead: `${result.widthIn} in of film at ${Number(answers.mil)} mil`, summary: summaryText(answers), useLabel: `Use ${rate} lb/hr`, useTitle: `Set the line rate to ${rate} lb/hr`, said: USED(rate) };
      },
      apply: result => apply(result.lbPerHourRounded),
      accept: answers => { if (calc) calc.accept(storage, answers); },
      able: settings.able,
      say: settings.say,
      onChange: settings.onChange,
      anchor: settings.anchor,
      view: settings.view
    });
  }

  return Object.freeze({ TITLE, OPEN_LABEL, UNAVAILABLE, NO_ESTIMATE, NO_BLEND, STEPS, ESTIMATE_STEP, glyph: wizardModule.glyph, blendItems, summaryText, create });
});
