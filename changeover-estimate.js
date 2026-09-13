/* The changeover estimate - the application's "Determine Changeover Time"
 * calculator as a module: its answers, its arithmetic, and the running
 * production estimate that acceptance leaves behind.
 *
 * WHAT THIS IS
 *
 * The same calculation app.js runs inline in its guided wizard
 * (changeoverWizardEstimate, buildProductionEstimateFromWizardAnswers,
 * readProductionEstimate, calculateCurrentProductionEstimate and their
 * neighbours), restated here so a second presentation - Station's
 * Changeover Calculator - can run it without reaching into app.js's
 * closure. Every formula is the application's own, line for line, and
 * changeover-estimate.test.js pins this file to those lines in app.js so
 * the two cannot drift apart. The floor UI keeps its inline copy for now;
 * making app.js call this module is a later, separate step.
 *
 * WHAT IT REMEMBERS, AND WHERE
 *
 * Device-local, as the wizard's answers always were. Two records, under
 * the SAME localStorage keys the application uses, so the desktop console
 * and the floor UI on one browser share one set of answers and one running
 * estimate rather than each keeping their own:
 *
 *   answers   the operator's last answers (line speed, footage per roll,
 *             number up, both winders, time left on the current set, rolls
 *             left) - a convenience, restored into the form next time
 *   estimate  the production estimate an accepted calculation started: what
 *             was accepted and when, from which "Est. N sets - M rolls
 *             remaining" is re-derived from the clock. It counts down from
 *             its own timestamp, never from a decrementing counter, so a
 *             page opened after an hour's sleep reads right at once; once
 *             the changeover point has passed it is gone.
 *
 * Nothing here is job state: the changeover deadline itself is the
 * application's, set through the application's own path (the floor UI's
 * #changeoverTime field; Station's setChangeover command). This module
 * only says what time to ask for. No RT Sync, no Supabase, no network.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynChangeoverEstimate = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* The application's keys (app.js: LS_CHANGEOVER_WIZARD_KEY and
   * LS_PRODUCTION_ESTIMATE_KEY). Shared on purpose - see the header. */
  const STORAGE_KEYS = Object.freeze({
    answers: "resinTimer.changeoverWizard.v0.01",
    estimate: "resinTimer.productionEstimate.v0.01"
  });

  /* The answers as the wizard keeps them: the typed fields as strings (the
   * field's own value, so what was typed comes back as typed), the choices
   * as numbers and a boolean. */
  const DEFAULT_ANSWERS = Object.freeze({
    lineSpeed: "", footagePerRoll: "", numberUp: 1, bothWinders: true, hours: 0, minutes: 0, rollsLeft: ""
  });

  /* The choice ranges the wizard offers: 1-10 up, 0-24 hours, 0-59 minutes. */
  const NUMBER_UP_MAX = 10;
  const HOURS_MAX = 24;
  const MINUTES_MAX = 59;

  /* --------------------------------------------------------------------
   *   Storage
   * ------------------------------------------------------------------ */

  /** The environment's localStorage, or null where there is none. */
  function storageFrom(environment) {
    try {
      const storage = environment && environment.localStorage;
      return storage && typeof storage.getItem === "function" ? storage : null;
    } catch (error) {
      return null;
    }
  }

  function readJson(storage, key) {
    if (!storage) return null;
    try {
      return JSON.parse(storage.getItem(key) || "null");
    } catch (error) {
      return null;
    }
  }

  function writeJson(storage, key, value) {
    if (!storage) return false;
    try {
      storage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      return false;
    }
  }

  function remove(storage, key) {
    if (!storage) return;
    try { storage.removeItem(key); } catch (error) { /* nothing to clear */ }
  }

  /* --------------------------------------------------------------------
   *   Answers
   * ------------------------------------------------------------------ */

  /** The saved answers over the defaults, as the wizard restores them. */
  function readAnswers(storage) {
    const saved = readJson(storage, STORAGE_KEYS.answers);
    return saved && typeof saved === "object" ? Object.assign({}, DEFAULT_ANSWERS, saved) : Object.assign({}, DEFAULT_ANSWERS);
  }

  function saveAnswers(storage, answers) {
    return writeJson(storage, STORAGE_KEYS.answers, Object.assign({}, DEFAULT_ANSWERS, answers || {}));
  }

  /**
   * One answer, checked as the wizard checks it at its step: line speed
   * and footage must be greater than zero, rolls left zero or more, and
   * the choices within their ranges. The message is the wizard's own.
   *
   * @returns {{ok: boolean, message: string}}
   */
  function validateAnswer(field, raw) {
    const value = Number(raw);
    switch (field) {
      case "lineSpeed":
      case "footagePerRoll":
        return Number.isFinite(value) && value > 0 && String(raw).trim() !== ""
          ? { ok: true, message: "" }
          : { ok: false, message: "Enter a value greater than zero." };
      case "rollsLeft":
        return Number.isFinite(value) && value >= 0 && String(raw).trim() !== ""
          ? { ok: true, message: "" }
          : { ok: false, message: "Enter zero or more rolls." };
      case "numberUp":
        return Number.isInteger(value) && value >= 1 && value <= NUMBER_UP_MAX
          ? { ok: true, message: "" }
          : { ok: false, message: `Choose 1 to ${NUMBER_UP_MAX} up.` };
      case "hours":
        return Number.isInteger(value) && value >= 0 && value <= HOURS_MAX
          ? { ok: true, message: "" }
          : { ok: false, message: `Hours must be 0 to ${HOURS_MAX}.` };
      case "minutes":
        return Number.isInteger(value) && value >= 0 && value <= MINUTES_MAX
          ? { ok: true, message: "" }
          : { ok: false, message: `Minutes must be 0 to ${MINUTES_MAX}.` };
      case "bothWinders":
        return typeof raw === "boolean" ? { ok: true, message: "" } : { ok: false, message: "Choose one or both winders." };
      default:
        return { ok: false, message: "Unknown field." };
    }
  }

  /* --------------------------------------------------------------------
   *   The estimate (app.js: changeoverWizardEstimate)
   * ------------------------------------------------------------------ */

  /**
   * The estimated changeover from a set of answers, or null when they do
   * not add up to one. `estimatedAt` is an instant (epoch ms); the wizard's
   * Date is the same value.
   *
   * @param {object} answers
   * @param {number} [now]  epoch ms; Date.now() by default
   */
  function estimate(answers, now) {
    const a = answers || {};
    const at = Number.isFinite(now) ? now : Date.now();
    const lineSpeed = Number(a.lineSpeed);
    const footagePerRoll = Number(a.footagePerRoll);
    const numberUp = Number(a.numberUp);
    const rollsLeft = Number(a.rollsLeft);
    const currentSetMinutesRemaining = Number(a.hours) * 60 + Number(a.minutes);
    const winderCount = a.bothWinders ? 2 : 1;
    if (![lineSpeed,footagePerRoll,numberUp,rollsLeft,currentSetMinutesRemaining].every(Number.isFinite) || lineSpeed <= 0 || footagePerRoll <= 0 || numberUp < 1 || rollsLeft < 0 || currentSetMinutesRemaining < 0) return null;
    const rollsPerSet = numberUp * winderCount;
    const fullSetMinutes = footagePerRoll / lineSpeed;
    const rollsAfterCurrentSet = Math.max(0, rollsLeft - rollsPerSet);
    const futureSets = Math.ceil(rollsAfterCurrentSet / rollsPerSet);
    const remainingMinutes = currentSetMinutesRemaining + futureSets * fullSetMinutes;
    const estimatedDate = new Date(at + remainingMinutes * 60000);
    if (!Number.isFinite(remainingMinutes) || Number.isNaN(estimatedDate.getTime())) return null;
    return { rollsPerSet, futureSets, remainingMinutes, estimatedAt: estimatedDate.getTime() };
  }

  /** "HH:MM" of an instant - the value the wizard hands the changeover field. */
  function clockValue(at) {
    const date = new Date(at);
    if (Number.isNaN(date.getTime())) return "";
    return `${String(date.getHours()).padStart(2,"0")}:${String(date.getMinutes()).padStart(2,"0")}`;
  }

  /* --------------------------------------------------------------------
   *   The running production estimate
   *   (app.js: buildProductionEstimateFromWizardAnswers, persist/read/
   *   clearProductionEstimate, calculateCurrentProductionEstimate)
   * ------------------------------------------------------------------ */

  /** The record an accepted calculation starts, or null. */
  function buildProductionEstimate(answers, now) {
    const a = answers || {};
    const lineSpeed = Number(a.lineSpeed);
    const footagePerRoll = Number(a.footagePerRoll);
    const numberUp = Number(a.numberUp);
    const rollsLeft = Number(a.rollsLeft);
    const currentSetMinutesRemaining = Number(a.hours) * 60 + Number(a.minutes);
    const bothWinders = !!a.bothWinders;
    if (![lineSpeed, footagePerRoll, numberUp, rollsLeft, currentSetMinutesRemaining].every(Number.isFinite)
        || lineSpeed <= 0 || footagePerRoll <= 0 || numberUp < 1 || rollsLeft < 0 || currentSetMinutesRemaining < 0){
      return null;
    }
    const rollsPerSet = numberUp * (bothWinders ? 2 : 1);
    const minutesPerSet = footagePerRoll / lineSpeed;
    const futureSets = Math.ceil(Math.max(0, rollsLeft - rollsPerSet) / rollsPerSet);
    const totalMinutesRemaining = currentSetMinutesRemaining + futureSets * minutesPerSet;
    if (!Number.isFinite(totalMinutesRemaining) || totalMinutesRemaining <= 0) return null;
    return {
      startedAt: Number.isFinite(now) ? now : Date.now(),
      lineSpeed,
      footagePerRoll,
      numberUp,
      bothWinders,
      rollsLeft,
      currentSetMinutesRemaining,
      rollsPerSet,
      minutesPerSet,
      totalMinutesRemaining
    };
  }

  function clearProductionEstimate(storage) {
    remove(storage, STORAGE_KEYS.estimate);
  }

  /** The saved record, re-derived; an unusable one is cleared and null. */
  function readProductionEstimate(storage) {
    if (!storage) return null;
    let saved;
    try {
      saved = JSON.parse(storage.getItem(STORAGE_KEYS.estimate) || "null");
    } catch (_error) {
      clearProductionEstimate(storage);
      return null;
    }
    if (!saved || typeof saved !== "object") return null;
    const lineSpeed = Number(saved.lineSpeed);
    const footagePerRoll = Number(saved.footagePerRoll);
    const numberUp = Number(saved.numberUp);
    const rollsLeft = Number(saved.rollsLeft);
    const currentSetMinutesRemaining = Number(saved.currentSetMinutesRemaining);
    const startedAt = Number(saved.startedAt);
    if (![lineSpeed, footagePerRoll, numberUp, rollsLeft, currentSetMinutesRemaining, startedAt].every(Number.isFinite)
        || lineSpeed <= 0 || footagePerRoll <= 0 || numberUp < 1 || rollsLeft < 0 || currentSetMinutesRemaining < 0 || startedAt <= 0){
      clearProductionEstimate(storage);
      return null;
    }
    const bothWinders = !!saved.bothWinders;
    const rollsPerSet = numberUp * (bothWinders ? 2 : 1);
    const minutesPerSet = footagePerRoll / lineSpeed;
    const futureSets = Math.ceil(Math.max(0, rollsLeft - rollsPerSet) / rollsPerSet);
    const totalMinutesRemaining = currentSetMinutesRemaining + futureSets * minutesPerSet;
    if (!Number.isFinite(totalMinutesRemaining) || totalMinutesRemaining <= 0){
      clearProductionEstimate(storage);
      return null;
    }
    return {
      startedAt,
      lineSpeed,
      footagePerRoll,
      numberUp,
      bothWinders,
      rollsLeft,
      currentSetMinutesRemaining,
      rollsPerSet,
      minutesPerSet,
      totalMinutesRemaining
    };
  }

  /** Where the record stands at `now`: sets and rolls still to run, or null once the changeover point has passed. */
  function currentProductionEstimate(estimate, now) {
    if (!estimate || typeof estimate !== "object") return null;
    const at = Number.isFinite(now) ? now : Date.now();
    const elapsedMinutes = Math.max(0, (at - estimate.startedAt) / 60000);
    const remainingMinutes = Math.max(0, estimate.totalMinutesRemaining - elapsedMinutes);
    if (remainingMinutes <= 0) return null;
    const remainingRolls = Math.max(0, Math.ceil((remainingMinutes / estimate.minutesPerSet) * estimate.rollsPerSet));
    if (remainingRolls <= 0) return null;
    const sets = Math.max(1, Math.ceil(remainingRolls / estimate.rollsPerSet));
    return { sets, remainingRolls, remainingMinutes };
  }

  function persistProductionEstimate(storage, estimate) {
    if (!estimate || typeof estimate !== "object") return false;
    const payload = {
      startedAt: Number(estimate.startedAt),
      lineSpeed: Number(estimate.lineSpeed),
      footagePerRoll: Number(estimate.footagePerRoll),
      numberUp: Number(estimate.numberUp),
      bothWinders: !!estimate.bothWinders,
      rollsLeft: Number(estimate.rollsLeft),
      currentSetMinutesRemaining: Number(estimate.currentSetMinutesRemaining)
    };
    if (![payload.startedAt, payload.lineSpeed, payload.footagePerRoll, payload.numberUp, payload.rollsLeft, payload.currentSetMinutesRemaining].every(Number.isFinite)
        || payload.startedAt <= 0 || payload.lineSpeed <= 0 || payload.footagePerRoll <= 0 || payload.numberUp < 1 || payload.rollsLeft < 0 || payload.currentSetMinutesRemaining < 0){
      return false;
    }
    return writeJson(storage, STORAGE_KEYS.estimate, payload);
  }

  /** "Est. 3 sets · 11 rolls remaining" - the application's own wording. */
  function formatProductionEstimate(current) {
    if (!current) return "";
    return `Est. ${current.sets} ${current.sets === 1 ? "set" : "sets"} · ${current.remainingRolls} ${current.remainingRolls === 1 ? "roll" : "rolls"} remaining`;
  }

  /**
   * Accept an estimate, as the wizard's "Use" does: the running production
   * estimate is replaced by one started now from these answers - or
   * cleared, when the answers no longer make one - and the answers are
   * saved. The changeover deadline itself is the caller's to set.
   *
   * @returns {{estimate: object|null, persisted: boolean}}
   */
  function accept(storage, answers, now) {
    saveAnswers(storage, answers);
    const production = buildProductionEstimate(answers, now);
    if (production) {
      const persisted = persistProductionEstimate(storage, production);
      return { estimate: production, persisted };
    }
    clearProductionEstimate(storage);
    return { estimate: null, persisted: false };
  }

  return Object.freeze({
    STORAGE_KEYS,
    DEFAULT_ANSWERS,
    NUMBER_UP_MAX,
    HOURS_MAX,
    MINUTES_MAX,
    storageFrom,
    readAnswers,
    saveAnswers,
    validateAnswer,
    estimate,
    clockValue,
    buildProductionEstimate,
    readProductionEstimate,
    currentProductionEstimate,
    persistProductionEstimate,
    clearProductionEstimate,
    formatProductionEstimate,
    accept
  });
});
