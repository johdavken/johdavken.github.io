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

  /* Resin codes compare the way the application compares them: trimmed,
   * whitespace collapsed, case-insensitive. */
  function normalizeResin(value) {
    return String(value == null ? "" : value).trim().replace(/\s+/g, " ").toUpperCase();
  }

  function sameResin(a, b) {
    return normalizeResin(a) === normalizeResin(b);
  }

  /* The planned recipe by slot, keyed as Current's. Deliberately without
   * track, pump-off or weight: a plan carries none, and a key that is
   * absent cannot be read as false. */
  function nextHopperStateFrom(snapshot) {
    const state = {};
    const plan = snapshot && snapshot.nextRecipe;
    if (!plan || !Array.isArray(plan.layers)) return state;
    for (const layer of plan.layers) {
      const name = String((layer && layer.name) || "");
      for (const hopper of (Array.isArray(layer && layer.hoppers) ? layer.hoppers : [])) {
        const index = Number(hopper && hopper.index);
        if (!Number.isInteger(index)) continue;
        state[`${name}:${index}`] = {
          resinName: hopper && hopper.resinName ? String(hopper.resinName) : "",
          pct: finite(hopper && hopper.pct)
        };
      }
    }
    return state;
  }

  function nextLayerStateFrom(snapshot) {
    const state = {};
    const plan = snapshot && snapshot.nextRecipe;
    if (!plan || !Array.isArray(plan.layers)) return state;
    for (const layer of plan.layers) {
      state[String((layer && layer.name) || "")] = { layerPct: finite(layer && layer.layerPct) };
    }
    return state;
  }

  /* Whether anything is planned at all. */
  function planFrom(snapshot) {
    const plan = snapshot && snapshot.nextRecipe;
    return { planned: !!(plan && Array.isArray(plan.layers) && plan.layers.length > 0) };
  }

  function historyFrom(snapshot) {
    const history = (snapshot && snapshot.history) || {};
    const one = key => ({
      canUndo: !!(history[key] && history[key].canUndo),
      canRedo: !!(history[key] && history[key].canRedo)
    });
    return { current: one("current"), next: one("next") };
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
      nextHopperState: nextHopperStateFrom(snapshot),
      nextLayerState: nextLayerStateFrom(snapshot),
      plan: planFrom(snapshot),
      history: historyFrom(snapshot),
      job: jobStateFrom(snapshot),
      label: live ? "Live" : "Demo",
      detail: live
        ? (model && model.line.linked ? "The application's linked line." : "The application's own session; no line is linked.")
        : "No application is connected to the state bridge."
    };
  }

  /* The runtime and layer state of one recipe, by name. */
  function stateFor(resolved, recipe) {
    if (recipe === "next") {
      return { hoppers: (resolved && resolved.nextHopperState) || {}, layers: (resolved && resolved.nextLayerState) || {} };
    }
    return { hoppers: (resolved && resolved.hopperState) || {}, layers: (resolved && resolved.layerState) || {} };
  }

  /* The OTHER recipe's assignment beside each slot of the recipe shown,
   * for the Compare switch: null when nothing is planned (there is nothing
   * to compare against, either way round). `differs` is true when the
   * resin (compared as the application compares it) or the blend moved. */
  function compareFor(resolved, recipe) {
    if (!resolved || !resolved.plan || !resolved.plan.planned || !resolved.line) return null;
    const shown = stateFor(resolved, recipe);
    const other = stateFor(resolved, recipe === "next" ? "current" : "next");
    const hoppers = {};
    const layers = {};
    for (const layer of resolved.line.layers) {
      const mine = shown.layers[layer.id] ? shown.layers[layer.id].layerPct : 0;
      const theirs = other.layers[layer.id] ? other.layers[layer.id].layerPct : 0;
      layers[layer.id] = { share: theirs, differs: mine !== theirs };
      for (const hopper of layer.hoppers) {
        const key = `${layer.id}:${hopper.index}`;
        const a = shown.hoppers[key] || { resinName: "", pct: 0 };
        const b = other.hoppers[key] || { resinName: "", pct: 0 };
        hoppers[key] = {
          resin: b.resinName || "",
          pct: finite(b.pct),
          differs: !sameResin(a.resinName, b.resinName) || finite(a.pct) !== finite(b.pct)
        };
      }
    }
    return { hoppers, layers };
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
      layers: model ? model.layers.map(layer => ({ id: layer.id, role: layer.role, hopperCount: layer.hopperCount })) : null,
      // A plan appearing or disappearing changes what the Next body holds.
      planned: !!(resolved.plan && resolved.plan.planned)
    });
  }

  function valuesKey(resolved) {
    return JSON.stringify({
      hopperState: resolved.hopperState || {},
      layerState: resolved.layerState || {},
      nextHopperState: resolved.nextHopperState || {},
      nextLayerState: resolved.nextLayerState || {},
      history: resolved.history || null,
      job: resolved.job || null
    });
  }

  function classifyChange(before, after) {
    if (!after || !before) return "structural";
    if (structureKey(before) !== structureKey(after)) return "structural";
    return valuesKey(before) === valuesKey(after) ? "none" : "values";
  }

  return Object.freeze({
    normalizeResin, sameResin, hopperStateFrom, layerStateFrom, nextHopperStateFrom, nextLayerStateFrom, planFrom, historyFrom,
    jobStateFrom, stateFor, compareFor, resolveSource, structureKey, valuesKey, classifyChange
  });
});
