/* Which state Station is looking at, and what that means for the render.
 *
 * Station can be driven from two places: the running application, through the
 * read-only state bridge, or the built-in demo configurations. This module is
 * the one place that decides which, so the decision is a pure function with
 * tests rather than a branch buried in the boot file.
 *
 * THE RULE THAT MATTERS
 *
 * Demo data is a fallback for "no application is connected". It is NOT a
 * fallback for "the application is connected but its line is hard to
 * describe". A connected line that cannot be drawn must read as a line that
 * cannot be drawn - showing plausible demo hoppers in its place would put
 * invented numbers on screen under a live label, which is the single worst
 * thing this console could do on a production floor.
 */
(function (root, factory) {
  const hookups = typeof require === "function"
    ? (function () { try { return require("../hookup-sources.js"); } catch (error) { return null; } })()
    : (root && root.PolynHookupSources);
  const api = factory(hookups);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynStationSource = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (hookups) {
  "use strict";

  const MODE_AUTO = "auto";
  const MODE_DEMO = "demo";

  /* Runtime hopper state, keyed by physical slot rather than by label.
   * "A:0" survives a hopper naming mode change; "A1"/"AM" does not, and the
   * existing Timeline code matches on position for exactly this reason.
   *
   * This is the one shape the machine reads, and BOTH sources fill it: the
   * live bridge snapshot, and the demo fixture. That is deliberate - the
   * machine has no idea which it is looking at, so demo mode exercises exactly
   * the code path live mode uses rather than a parallel one. */
  function hopperStateFrom(snapshot) {
    const bySlot = {};
    if (!snapshot || !Array.isArray(snapshot.layers)) return bySlot;
    // The CURRENT recipe's labels: this is the running job's hopper state.
    // The bridge carries `sources.next` beside them for the planned recipe.
    const sources = snapshot.sources && typeof snapshot.sources === "object" && snapshot.sources.current
      && typeof snapshot.sources.current === "object"
      ? snapshot.sources.current
      : {};
    for (const layer of snapshot.layers) {
      if (!layer || !Array.isArray(layer.hoppers)) continue;
      for (const hopper of layer.hoppers) {
        const key = `${layer.name}:${hopper.index}`;
        bySlot[key] = {
          track: !!hopper.track,
          pumpOff: !!hopper.pumpOff,
          assigned: !!hopper.resinName,
          resinName: hopper.resinName || "",
          pct: Number.isFinite(hopper.pct) ? hopper.pct : 0,
          // The weight the run-down formula uses - the bridge's own resolved
          // value, Smart Hoppers included - in pounds. 0 means "no weight",
          // which is what the application reads it as too.
          effectiveWeight: Number.isFinite(hopper.effectiveWeight) && hopper.effectiveWeight > 0 ? hopper.effectiveWeight : 0,
          // Receiver Weight Profile height, in inches. 0 means "not profiled".
          usableHeight: Number.isFinite(hopper.usableHeight) ? hopper.usableHeight : 0,
          // Resolved through hookup-sources' own helper, which refuses a label
          // whose resin has since changed - reading entry.source raw would
          // show a stale silo against a resin that is no longer in that hopper.
          source: hookups && typeof hookups.sourceForPosition === "function"
            ? hookups.sourceForPosition(sources, key, hopper.resinName || "")
            : ""
        };
      }
    }
    return bySlot;
  }

  /* Per-layer state: the layer's share of the film structure. Same keying
   * principle - by layer name, which is what the recipe uses. */
  function layerStateFrom(snapshot) {
    const byLayer = {};
    if (!snapshot || !Array.isArray(snapshot.layers)) return byLayer;
    for (const layer of snapshot.layers) {
      if (!layer || !layer.name) continue;
      byLayer[layer.name] = { layerPct: Number.isFinite(layer.layerPct) ? layer.layerPct : 0 };
    }
    return byLayer;
  }

  /* The running job's own values: the line's output and the changeover
   * deadline as the application stores them (a clock time, and when it was
   * set), carried exactly - resolving the clock time to an instant is the
   * run-down projection's job, at the moment it projects. Zero output and an
   * empty time are what the application means by "not set". */
  function jobStateFrom(snapshot) {
    const job = snapshot && snapshot.job && typeof snapshot.job === "object" ? snapshot.job : {};
    return {
      lineRate: Number.isFinite(job.lineRate) && job.lineRate > 0 ? job.lineRate : 0,
      changeoverTime: typeof job.changeoverTime === "string" ? job.changeoverTime : "",
      changeoverSetAt: Number.isFinite(job.changeoverSetAt) ? job.changeoverSetAt : null
    };
  }

  /* The live snapshot rendered as a line configuration the model understands.
   * Layer count and per-layer hopper counts come from the snapshot's own
   * layers, so the machine on screen is shaped by the running job rather than
   * by anything Station decided for itself. */
  function configFromSnapshot(snapshot) {
    if (!snapshot || !snapshot.line) return null;
    const layers = Array.isArray(snapshot.layers) ? snapshot.layers : [];
    const layerCount = snapshot.line.layerCount || layers.length || null;
    if (!layerCount) return null;
    return {
      lineNumber: snapshot.line.lineNumber,
      displayName: snapshot.line.displayName
        || (snapshot.line.lineNumber ? `Line ${snapshot.line.lineNumber}` : "Unlinked line"),
      layerCount,
      layerAPosition: snapshot.line.layerAPosition,
      hopperNamingMode: snapshot.line.hopperNamingMode,
      hopperGeometry: snapshot.line.hopperGeometry,
      layers: layers.map(layer => ({ id: layer.name, hopperCount: layer.hoppers.length }))
    };
  }

  /**
   * Decide what Station should render right now.
   *
   * @param {object} input
   * @param {object|null} input.snapshot   The bridge's current snapshot, or null.
   * @param {object} input.demoLines       PolynStationDemoLines.
   * @param {string} input.demoId          Which demo entry is selected.
   * @param {string} [input.mode]          "auto" (default) or "demo" to pin
   *        demo data even while the application is connected - the dev mode.
   * @returns {{kind, modelInput, label, detail, hopperState, layerState, job, live}}
   */
  function resolveSource(input) {
    const settings = input || {};
    const mode = settings.mode === MODE_DEMO ? MODE_DEMO : MODE_AUTO;
    const snapshot = settings.snapshot || null;
    const demoLines = settings.demoLines || null;

    const useLive = mode === MODE_AUTO && !!snapshot;

    if (useLive) {
      return {
        kind: "live",
        live: true,
        modelInput: configFromSnapshot(snapshot),
        hopperState: hopperStateFrom(snapshot),
        layerState: layerStateFrom(snapshot),
        job: jobStateFrom(snapshot),
        revision: typeof snapshot.revision === "number" ? snapshot.revision : null,
        label: snapshot.line && snapshot.line.linked ? "Live" : "Live (no line linked)",
        detail: snapshot.line && snapshot.line.linked
          ? "Reading the connected line's active job."
          : "Reading this session's own state; no RT Sync line is linked."
      };
    }

    const demo = demoLines && typeof demoLines.demoById === "function"
      ? demoLines.demoById(settings.demoId)
      : null;
    const demoSnapshot = demo && demoLines && typeof demoLines.demoSnapshotFor === "function"
      ? demoLines.demoSnapshotFor(demo)
      : null;

    return {
      kind: "demo",
      live: false,
      modelInput: demo && demoLines ? demoLines.modelInputFor(demo) : null,
      /* Demo fixture, built into the SAME snapshot shape the bridge produces
       * and then read through the SAME two functions above. It is fixture data
       * for a development harness, not a second state store - the machine
       * cannot tell the difference, which is the point: demo mode exercises
       * the live code path.
       *
       * There is still no tracking or pump-off in it. Those are runtime job
       * state, and a demo line is not running a job. */
      hopperState: demoSnapshot ? hopperStateFrom(demoSnapshot) : {},
      layerState: demoSnapshot ? layerStateFrom(demoSnapshot) : {},
      // A demo line runs no job: no output, no changeover, as no tracking.
      job: jobStateFrom(demoSnapshot),
      revision: null,
      label: mode === MODE_DEMO ? "Demo (pinned)" : "Demo",
      detail: mode === MODE_DEMO
        ? "Demo data is pinned; the application state bridge is being ignored."
        : "No application is connected to the state bridge."
    };
  }

  /* --------------------------------------------------------------------
   *   What kind of change a new resolution is
   * ------------------------------------------------------------------
   * The bridge publishes on every committed change. Station used to redraw
   * everything on each one, which rebuilt the stage - and with it the
   * focused editor, its open search and its keyboard focus - for a weight
   * edit on a phone. The boot file now asks this first:
   *
   *   "structural"  the drawing's structure changed: which source is in
   *                 play, the line's layers or hopper counts or naming, a
   *                 hopper's profile height (which changes the layout).
   *                 The stage must be rendered again.
   *   "values"      only runtime values moved: resin, blend, tracking,
   *                 pump state, source, layer share, a receiver weight,
   *                 the line's output or changeover. The mounted stage and
   *                 the editor are patched in place (a hopper whose drawing
   *                 reads nothing new is left alone), and the run-down
   *                 timeline re-projects.
   *   "none"        nothing the drawing reads changed (a publish that only
   *                 moved the revision, or a value outside the machine).
   *
   * Pure, over two resolved objects, so the policy is tested rather than
   * inferred from what happens to a render. */

  function structureKey(resolved) {
    if (!resolved) return null;
    const heights = {};
    const hopperState = resolved.hopperState || {};
    for (const key of Object.keys(hopperState)) heights[key] = Number(hopperState[key] && hopperState[key].usableHeight) || 0;
    return JSON.stringify({ kind: resolved.kind, modelInput: resolved.modelInput === undefined ? null : resolved.modelInput, heights });
  }

  function valuesKey(resolved) {
    return JSON.stringify({ hopperState: resolved.hopperState || {}, layerState: resolved.layerState || {}, job: resolved.job || null });
  }

  function classifyChange(before, after) {
    if (!after || !before) return "structural";
    if (structureKey(before) !== structureKey(after)) return "structural";
    return valuesKey(before) === valuesKey(after) ? "none" : "values";
  }

  return { MODE_AUTO, MODE_DEMO, hopperStateFrom, layerStateFrom, jobStateFrom, configFromSnapshot, resolveSource, classifyChange };
});
