/* Which state Slate shows, and what kind of change a new publish is.
 *
 * resolveSource() turns a state-bridge snapshot - or, when no producer is
 * connected, the demo snapshot - into the one object every Slate surface
 * reads: the line model, runtime state by slot, layer state by name, the
 * job. classifyChange() then says whether a new resolution needs the
 * sections rebuilt ("structural"), patched in place ("values") or left
 * alone ("none"). Pure, so the policy is tested rather than inferred.
 *
 * Demo is a fallback for "no application", never for a hard line: a
 * connected bridge is always the source, and a demo is never writable.
 */
(function (root, factory) {
  const line = typeof require === "function"
    ? require("./slate-line.js")
    : (root && root.PolynSlateLine);
  const api = factory(line);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynSlateSource = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (lineModule) {
  "use strict";

  function finite(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  /* Runtime state by slot ("A:0"): what the recipe rows and the run-down
   * read. The receiver weight that counts is the EFFECTIVE one - the
   * entered weight, or Smart Hoppers' computed one when it stands in. */
  function hopperStateFrom(snapshot) {
    const state = {};
    if (!snapshot || !Array.isArray(snapshot.layers)) return state;
    for (const layer of snapshot.layers) {
      const name = String((layer && layer.name) || "");
      for (const hopper of (Array.isArray(layer && layer.hoppers) ? layer.hoppers : [])) {
        const index = Number(hopper && hopper.index);
        if (!Number.isInteger(index)) continue;
        state[`${name}:${index}`] = {
          track: !!(hopper && hopper.track),
          pumpOff: !!(hopper && hopper.pumpOff),
          resinName: hopper && hopper.resinName ? String(hopper.resinName) : "",
          pct: finite(hopper && hopper.pct),
          effectiveWeight: finite(hopper && hopper.effectiveWeight)
        };
      }
    }
    return state;
  }

  function layerStateFrom(snapshot) {
    const state = {};
    if (!snapshot || !Array.isArray(snapshot.layers)) return state;
    for (const layer of snapshot.layers) {
      state[String((layer && layer.name) || "")] = { layerPct: finite(layer && layer.layerPct) };
    }
    return state;
  }

  function jobStateFrom(snapshot) {
    const job = (snapshot && snapshot.job) || {};
    const rate = finite(job.lineRate);
    return {
      lineRate: rate > 0 ? rate : 0,
      changeoverTime: typeof job.changeoverTime === "string" ? job.changeoverTime : "",
      changeoverSetAt: Number.isFinite(job.changeoverSetAt) ? job.changeoverSetAt : null,
      prodResinLb: job.prodResinLb === undefined ? "" : job.prodResinLb,
      scrapResinLb: job.scrapResinLb === undefined ? "" : job.scrapResinLb
    };
  }

  /**
   * @param {object} input
   * @param {object|null} input.snapshot   the bridge's snapshot, or null
   * @param {object} [input.demo]          PolynSlateDemo (or anything with snapshot())
   * @param {number} [input.now]
   */
  function resolveSource(input) {
    const settings = input || {};
    const live = !!settings.snapshot;
    const snapshot = live
      ? settings.snapshot
      : (settings.demo && typeof settings.demo.snapshot === "function" ? settings.demo.snapshot(settings.now) : null);
    const model = lineModule.buildLineModel(snapshot);
    return {
      kind: live ? "live" : "demo",
      live,
      revision: live && Number.isInteger(snapshot.revision) ? snapshot.revision : null,
      snapshot,
      line: model,
      hopperState: hopperStateFrom(snapshot),
      layerState: layerStateFrom(snapshot),
      job: jobStateFrom(snapshot),
      label: live ? "Live" : "Demo",
      detail: live
        ? (model && model.line.linked ? "The application's linked line." : "The application's own session; no line is linked.")
        : "No application is connected to the state bridge."
    };
  }

  /* --------------------------------------------------------------------
   *   What kind of change a new resolution is
   * ------------------------------------------------------------------ */

  function structureKey(resolved) {
    if (!resolved) return null;
    const model = resolved.line;
    return JSON.stringify({
      kind: resolved.kind,
      line: model ? model.line : null,
      layers: model ? model.layers.map(layer => ({ id: layer.id, role: layer.role, hopperCount: layer.hopperCount })) : null
    });
  }

  function valuesKey(resolved) {
    return JSON.stringify({
      hopperState: resolved.hopperState || {},
      layerState: resolved.layerState || {},
      job: resolved.job || null
    });
  }

  function classifyChange(before, after) {
    if (!after || !before) return "structural";
    if (structureKey(before) !== structureKey(after)) return "structural";
    return valuesKey(before) === valuesKey(after) ? "none" : "values";
  }

  return Object.freeze({ hopperStateFrom, layerStateFrom, jobStateFrom, resolveSource, structureKey, valuesKey, classifyChange });
});
