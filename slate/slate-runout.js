/* A hopper that ran out early: the correction to its stored weight.
 *
 * After its pump goes off a tracked hopper is expected to feed the line
 * for exactly its run-down - effective weight / consumption (station-
 * rundown.js's formula, the application's own) - and to empty at the
 * changeover. When it runs dry sooner, the time it actually fed, from the
 * moment the pump went off to the moment it ran out, measures what the
 * hopper really held:
 *
 *   corrected = stored x (fed / expected)
 *
 * which holds however the rate was built - line output, layer share,
 * blend - so long as those did not change during the run-down. Only an
 * early run-out is corrected: running late is the operator's margin.
 *
 * With Smart Hoppers computing the hopper's weight, the entered weight is
 * not the one used, so the correction goes to the hopper's measure - its
 * usable height or usable volume - which the computed weight follows in
 * proportion. No margin is taken: the operator's blend change before the
 * changeover is the margin already.
 *
 * Pure: no document, no bridge, no clock. slate-timeline.js asks and
 * confirms; slate-weight-actions.js sends the one command.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynSlateRunout = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const MINUTE = 60 * 1000;
  /* Less short than this is not "early": a clock read to the minute. */
  const EARLY_MIN_MS = MINUTE;
  /* Several hoppers short by about the same share point at the line, not
   * the hoppers: this many, within this much of one another. */
  const SHARED_MIN = 3;
  const SHARED_SPREAD = 0.1;

  function round1(value) {
    return Math.round(value * 10) / 10;
  }

  function positive(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : 0;
  }

  /**
   * @param {object} input
   * @param {object} input.entry       the run-down entry (station-rundown.js): durationMs
   * @param {object} input.runtime     the hopper's state (slate-source.js): weight, smartWeight, usableHeight, usableGallons
   * @param {object|null} input.measure  the line's Smart Hoppers measure (slate-weight-actions.js measureFor), when on
   * @param {number} input.pumpedOffAt epoch ms
   * @param {number} input.ranOutAt    epoch ms
   * @returns {{ ok: boolean, reason: string|null, fedMs, expectedMs, shortMs, ratio, target: "weight"|"geometry"|null, dimension, field, unit, from, to }}
   */
  function correctionFor(input) {
    const settings = input || {};
    const entry = settings.entry || {};
    const runtime = settings.runtime || {};
    const out = { ok: false, reason: null, fedMs: null, expectedMs: null, shortMs: null, ratio: null, target: null, dimension: null, field: null, unit: null, from: null, to: null };
    const expectedMs = positive(entry.durationMs);
    if (!expectedMs) { out.reason = "no-estimate"; return out; }
    out.expectedMs = expectedMs;
    const pumpedOffAt = Number(settings.pumpedOffAt);
    const ranOutAt = Number(settings.ranOutAt);
    if (!Number.isFinite(pumpedOffAt) || !Number.isFinite(ranOutAt)) { out.reason = "no-times"; return out; }
    const fedMs = ranOutAt - pumpedOffAt;
    if (fedMs <= 0) { out.reason = "before-pump-off"; return out; }
    out.fedMs = fedMs;
    out.shortMs = expectedMs - fedMs;
    out.ratio = fedMs / expectedMs;
    if (out.shortMs < EARLY_MIN_MS) { out.reason = "not-early"; return out; }

    const measure = settings.measure || null;
    const smart = !!(runtime.smartWeight && positive(runtime.smartWeight.value) && measure && measure.field);
    if (smart) {
      const from = positive(runtime[measure.field]);
      if (!from) { out.reason = "no-measure"; return out; }
      Object.assign(out, { target: "geometry", dimension: measure.dimension, field: measure.field, unit: measure.unit, from, to: round1(from * out.ratio) });
    } else {
      const from = positive(runtime.weight);
      if (!from) { out.reason = "no-weight"; return out; }
      Object.assign(out, { target: "weight", unit: "lb", from, to: round1(from * out.ratio) });
    }
    if (!(out.to > 0)) { out.reason = "too-short"; return out; }
    out.ok = true;
    return out;
  }

  /** Why there is nothing to correct, in words. */
  function reasonText(reason) {
    switch (reason) {
      case "no-estimate": return "This hopper had no run-down estimate to compare with.";
      case "no-times": return "Enter when the pump went off and when the hopper ran out.";
      case "before-pump-off": return "It ran out before its pump went off: check the two times.";
      case "not-early": return "It fed as long as expected or longer: there is nothing to correct.";
      case "no-measure": return "Smart Hoppers has no measure entered for this hopper to correct.";
      case "no-weight": return "This hopper has no stored weight to correct.";
      case "too-short": return "That would leave no weight at all: check the two times.";
      default: return "";
    }
  }

  /**
   * Whether this run's corrections point at the line instead: at least
   * SHARED_MIN hoppers short by about the same share (their ratios within
   * SHARED_SPREAD of their median). Returns the median share short, or null.
   */
  function sharedShortfall(ratios) {
    const list = (Array.isArray(ratios) ? ratios : []).filter(value => Number.isFinite(value) && value > 0 && value < 1).sort((a, b) => a - b);
    if (list.length < SHARED_MIN) return null;
    const middle = list[Math.floor(list.length / 2)];
    const near = list.filter(value => Math.abs(value - middle) <= SHARED_SPREAD);
    return near.length >= SHARED_MIN ? 1 - middle : null;
  }

  return Object.freeze({ MINUTE, EARLY_MIN_MS, SHARED_MIN, SHARED_SPREAD, correctionFor, reasonText, sharedShortfall });
});
