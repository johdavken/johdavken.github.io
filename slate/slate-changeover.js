/* The changeover calculator: the floor UI's "Determine Changeover Time"
 * wizard, as a popover under the Changeover card.
 *
 * The same six prompts in the same order, one at a time - line speed,
 * footage per roll, how many up, both winders, time left on the current
 * set, rolls left - then the estimate, with "Use 5:20 PM" or "Adjust
 * answers". The arithmetic, the checks and the wording are
 * changeover-estimate.js's, the application's own restated; the answers
 * and the running production estimate it leaves behind live under the
 * application's own device-local keys, so this browser's floor UI and
 * Slate share one set of answers. The storage is handed in by the boot;
 * this file never reaches for it.
 *
 * The walking and drawing are slate-wizard.js's. This file says what the
 * prompts are and what Use does: it hands the estimated instant to
 * `apply`, the card's own setChangeover path (slate-stat-cards.js), and
 * only an accepted instant records the answers and starts the estimate,
 * as the wizard's Use does.
 */
(function (root, factory) {
  const pick = (name, file) => (typeof require === "function" ? require(file) : (root && root[name]));
  const api = factory(pick("PolynSlateWizard", "./slate-wizard.js"));
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynSlateChangeover = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (wizardModule) {
  "use strict";

  const TITLE = "Changeover calculator";
  const OPEN_LABEL = "Calculate the changeover";
  const UNAVAILABLE = "The changeover calculator is not available on this page.";
  const NO_ESTIMATE = "Those answers do not add up to a changeover. Start again.";
  const USED = at => `Changeover set to ${at}.`;

  /* The prompts, in the wizard's order. */
  const STEPS = Object.freeze([
    Object.freeze({ field: "lineSpeed", kind: "number", question: "What’s the line speed?", unit: "ft/min" }),
    Object.freeze({ field: "footagePerRoll", kind: "number", question: "What’s the footage per roll?", unit: "ft" }),
    Object.freeze({ field: "numberUp", kind: "choice", question: "How many up?", label: "Rolls per winder" }),
    Object.freeze({ field: "bothWinders", kind: "choice", question: "Using both winders?", label: "Winders in use" }),
    Object.freeze({ field: "time", kind: "time", question: "How long is left on the current set?" }),
    Object.freeze({ field: "rollsLeft", kind: "number", question: "How many rolls are left on the order?", unit: "rolls, including the current set" })
  ]);
  const ESTIMATE_STEP = STEPS.length;

  /** "1 hr 51 min remaining" - the wizard's own line. */
  function remainingText(minutes) {
    const rounded = Math.max(0, Math.round(minutes));
    const hours = Math.floor(rounded / 60);
    return `${hours ? `${hours} hr ` : ""}${rounded % 60} min remaining`;
  }

  /** "12 rolls • 4 rolls/set • 2 future sets" - the wizard's summary. */
  function summaryText(answers, result) {
    return `${answers.rollsLeft} rolls • ${result.rollsPerSet} rolls/set • ${result.futureSets} future sets`;
  }

  /**
   * @param {Document} doc
   * @param {object} options
   * @param {object|null} options.estimate  changeover-estimate.js (PolynChangeoverEstimate), or null
   * @param {object|null} [options.storage] where the answers and estimate live, or null
   * @param {function} [options.now]
   * @param {function} options.apply       (at) -> the card's result for setChangeover
   * @param {function} [options.able]      () -> { ok, reason } for Use
   * @param {function} [options.clock]     (at) -> "5:20 PM"
   * @param {function} [options.say]
   * @param {function} [options.onChange]
   * @param {Element} [options.anchor]
   * @param {object} [options.view]
   */
  function create(doc, options) {
    const settings = options || {};
    const calc = settings.estimate || null;
    const storage = settings.storage || null;
    const now = typeof settings.now === "function" ? settings.now : () => Date.now();
    const clock = typeof settings.clock === "function" ? settings.clock : at => new Date(at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    const apply = typeof settings.apply === "function" ? settings.apply : () => ({ ok: false, code: "unavailable", message: UNAVAILABLE });

    const steps = STEPS.map(step => {
      if (step.field === "numberUp") return Object.assign({}, step, { choices: () => Array.from({ length: calc ? calc.NUMBER_UP_MAX : 10 }, (_, i) => ({ value: i + 1, label: String(i + 1) })) });
      if (step.field === "bothWinders") return Object.assign({}, step, { choices: [{ value: true, label: "Yes" }, { value: false, label: "No" }] });
      if (step.kind === "time") return Object.assign({}, step, { fields: [["hours", "Hours"], ["minutes", "Minutes"]], suffix: "left on the current set" });
      return step;
    });

    return wizardModule.create(doc, {
      title: TITLE,
      ready: !!calc,
      unavailable: UNAVAILABLE,
      noEstimate: NO_ESTIMATE,
      steps,
      read: () => (calc ? calc.readAnswers(storage) : {}),
      save: answers => { if (calc) calc.saveAnswers(storage, answers); },
      validate: (field, raw) => (calc ? calc.validateAnswer(field, raw) : { ok: true, message: "" }),
      estimate: answers => (calc ? calc.estimate(answers, now()) : null),
      page: (result, answers) => {
        const when = clock(result.estimatedAt);
        return { title: "Estimated changeover", headline: when, lead: remainingText(result.remainingMinutes), summary: summaryText(answers, result), useLabel: `Use ${when}`, useTitle: `Set the changeover to ${when}`, said: USED(when) };
      },
      apply: result => apply(result.estimatedAt),
      accept: answers => { if (calc) calc.accept(storage, answers, now()); },
      able: settings.able,
      say: settings.say,
      onChange: settings.onChange,
      anchor: settings.anchor,
      view: settings.view
    });
  }

  return Object.freeze({ TITLE, OPEN_LABEL, UNAVAILABLE, NO_ESTIMATE, STEPS, ESTIMATE_STEP, glyph: wizardModule.glyph, remainingText, summaryText, create });
});
