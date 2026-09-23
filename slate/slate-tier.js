/* The tier Slate draws in: for a finger or a mouse, wide or narrow.
 *
 * Two words the boot writes onto the Slate root, beside data-layers:
 *
 *   data-input  "touch" | "pointer"  - larger targets, a compact rail, no
 *               keyboard popped unasked; or the desktop sheet as it is.
 *   data-viewport  "wide" | "narrow" - at least WIDE_MIN px of viewport,
 *               or less (the aside becomes a drawer under touch).
 *
 * Every tablet rule in the sheets is scoped to those attributes, never to a
 * media query, so there is ONE decider: this file, answering to the
 * operator's Settings choice (slate-display.js `input`). The pointer tier
 * has no rule of its own - it is the sheet itself - so a desktop is never
 * touched by the tablet work.
 *
 * `tierFor` is pure. `probe` reads the environment it is handed (the
 * window), never a global, and `observe` tells the boot when the pointer or
 * the width class changes (a rotation, a keyboard attached), so the tier
 * follows without a reload and without rebuilding anything.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynSlateTier = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* The narrowest viewport that keeps the aside beside the centre: the
   * width slate-host.js calls a desktop's. */
  const WIDE_MIN = 1100;
  const COARSE = "(pointer: coarse)";
  const WIDE = `(min-width: ${WIDE_MIN}px)`;
  const INPUTS = Object.freeze(["touch", "pointer"]);
  const WIDTHS = Object.freeze(["wide", "narrow"]);

  /**
   * @param {object} facts
   * @param {boolean} facts.coarse      the primary pointer is coarse
   * @param {boolean} facts.native      inside the Android app
   * @param {number}  facts.width       the viewport's width, CSS px
   * @param {string}  [facts.preference] "auto" | "touch" | "pointer"
   * @returns {{input: string, width: string}}
   */
  function tierFor(facts) {
    const settings = facts || {};
    let input;
    if (settings.preference === "touch") input = "touch";
    else if (settings.preference === "pointer") input = "pointer";
    else input = settings.coarse || settings.native ? "touch" : "pointer";
    const width = Number(settings.width);
    // Nothing to measure reads as wide: the desktop's layout, never a
    // drawer the operator did not ask for.
    return { input, width: Number.isFinite(width) && width > 0 && width < WIDE_MIN ? "narrow" : "wide" };
  }

  function matches(view, query) {
    try {
      return !!(view && typeof view.matchMedia === "function" && view.matchMedia(query).matches);
    } catch (error) {
      return false;
    }
  }

  /** The environment's facts, read from the window handed in. */
  function probe(view) {
    let native = false;
    try {
      const capacitor = view && view.Capacitor;
      native = !!(capacitor && typeof capacitor.isNativePlatform === "function" && capacitor.isNativePlatform());
    } catch (error) {
      native = false;
    }
    // A query that cannot be asked leaves the width unknown - wide, by
    // tierFor's rule - never a guessed narrow.
    let width = NaN;
    let wide = null;
    try {
      if (view && typeof view.matchMedia === "function") wide = !!view.matchMedia(WIDE).matches;
    } catch (error) {
      wide = null;
    }
    if (wide !== null) width = wide ? WIDE_MIN : WIDE_MIN - 1;
    else if (view && Number(view.innerWidth) > 0) width = Number(view.innerWidth);
    return { coarse: matches(view, COARSE), native, width };
  }

  /** Call onChange whenever the pointer or the width class changes.
   *  Returns the unsubscribe. */
  function observe(view, onChange) {
    const stops = [];
    if (!view || typeof view.matchMedia !== "function" || typeof onChange !== "function") return () => {};
    for (const query of [COARSE, WIDE]) {
      let list = null;
      try { list = view.matchMedia(query); } catch (error) { list = null; }
      if (!list) continue;
      const listener = () => onChange();
      if (typeof list.addEventListener === "function") {
        list.addEventListener("change", listener);
        stops.push(() => list.removeEventListener("change", listener));
      } else if (typeof list.addListener === "function") {
        list.addListener(listener);
        stops.push(() => list.removeListener(listener));
      }
    }
    return () => { for (const stop of stops.splice(0)) stop(); };
  }

  return Object.freeze({ WIDE_MIN, INPUTS, WIDTHS, tierFor, probe, observe });
});
