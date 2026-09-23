/* The tier Slate draws in: for a finger or a mouse; wide, narrow or a phone.
 *
 * Two words the boot writes onto the Slate root, beside data-layers:
 *
 *   data-input  "touch" | "pointer"  - larger targets, a compact rail, no
 *               keyboard popped unasked; or the desktop sheet as it is.
 *   data-viewport  "wide" | "narrow" | "phone" - at least WIDE_MIN px of
 *               viewport, or less (the aside becomes a drawer under touch),
 *               or a phone: a screen whose shorter side is under
 *               PHONE_MAX_SHORT, or a window narrower than that (a bottom
 *               bar, pages, the recipe as a grid of cells). The screen
 *               decides, not the window's height, so a phone turned sideways
 *               stays a phone and a tablet under its browser's bars never
 *               becomes one.
 *
 *   data-orientation  "portrait" | "landscape" - which way the viewport
 *               stands; only a phone's sheets read it (a phone on its side
 *               has a short page to spare).
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
  /* Below this, a phone: the same short side slate-host.js asks of a
   * tablet's screen (TABLET_MIN_SHORT), so the two never disagree. */
  const PHONE_MAX_SHORT = 600;
  const COARSE = "(pointer: coarse)";
  const WIDE = `(min-width: ${WIDE_MIN}px)`;
  const ROOMY = `(min-width: ${PHONE_MAX_SHORT}px)`;
  const LANDSCAPE = "(orientation: landscape)";
  const INPUTS = Object.freeze(["touch", "pointer"]);
  const WIDTHS = Object.freeze(["wide", "narrow", "phone"]);

  /**
   * @param {object} facts
   * @param {boolean} facts.coarse      the primary pointer is coarse
   * @param {boolean} facts.native      inside the Android app
   * @param {number}  facts.width       the viewport's width, CSS px
   * @param {number}  [facts.screenShort] the screen's shorter side, CSS px
   * @param {boolean} [facts.landscape] the viewport is wider than it is tall
   * @param {string}  [facts.preference] "auto" | "touch" | "pointer"
   * @returns {{input: string, width: string, orientation: string}}
   */
  function tierFor(facts) {
    const settings = facts || {};
    let input;
    if (settings.preference === "touch") input = "touch";
    else if (settings.preference === "pointer") input = "pointer";
    else input = settings.coarse || settings.native ? "touch" : "pointer";
    const width = Number(settings.width);
    const short = Number(settings.screenShort);
    // Nothing to measure reads as wide: the desktop's layout, never a
    // drawer or a phone's bar the operator did not ask for.
    const measured = Number.isFinite(width) && width > 0;
    const orientation = settings.landscape === true ? "landscape" : "portrait";
    if ((measured && width < PHONE_MAX_SHORT) || (Number.isFinite(short) && short > 0 && short < PHONE_MAX_SHORT)) return { input, width: "phone", orientation };
    return { input, width: measured && width < WIDE_MIN ? "narrow" : "wide", orientation };
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
    if (wide !== null) width = wide ? WIDE_MIN : (matches(view, ROOMY) ? WIDE_MIN - 1 : PHONE_MAX_SHORT - 1);
    else if (view && Number(view.innerWidth) > 0) width = Number(view.innerWidth);
    let screenShort = NaN;
    try {
      const screen = view && view.screen;
      const sides = screen ? [Number(screen.width), Number(screen.height)] : [];
      if (sides.length === 2 && sides.every(side => Number.isFinite(side) && side > 0)) screenShort = Math.min(sides[0], sides[1]);
    } catch (error) {
      screenShort = NaN;
    }
    return { coarse: matches(view, COARSE), native, width, screenShort, landscape: matches(view, LANDSCAPE) };
  }

  /** Call onChange whenever the pointer or the width class changes.
   *  Returns the unsubscribe. */
  function observe(view, onChange) {
    const stops = [];
    if (!view || typeof view.matchMedia !== "function" || typeof onChange !== "function") return () => {};
    for (const query of [COARSE, WIDE, ROOMY, LANDSCAPE]) {
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

  return Object.freeze({ WIDE_MIN, PHONE_MAX_SHORT, INPUTS, WIDTHS, tierFor, probe, observe });
});
