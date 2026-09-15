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

  /* Two resin names are the same resin when they differ only by case or
   * by surrounding whitespace - the recipe grid's own rule (app.js,
   * normName). "" and null are the same nothing. */
  function normalizeResin(name) {
    return String(name || "").trim().toLowerCase();
  }

  function sameResin(a, b) {
    return normalizeResin(a) === normalizeResin(b);
  }

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
    // The plan beside the job, slot for slot, so each running hopper can
    // say whether promoting the plan would change what is in it.
    const next = nextHopperStateFrom(snapshot);
    const planned = planFrom(snapshot).planned;
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
          // The receiver weight the operator entered - the Weights page's
          // value, the one a Receiver Weight Profile stores - in pounds.
          // 0 means "not entered". Distinct from effectiveWeight, which
          // Smart Hoppers may derive from geometry instead.
          weight: Number.isFinite(hopper.weight) && hopper.weight > 0 ? hopper.weight : 0,
          // Receiver Weight Profile height, in inches. 0 means "not profiled".
          usableHeight: Number.isFinite(hopper.usableHeight) ? hopper.usableHeight : 0,
          // Usable volume in gallons - a volume line's measure. 0 means
          // "not entered". Never shapes the drawing.
          usableGallons: Number.isFinite(hopper.usableGallons) && hopper.usableGallons > 0 ? hopper.usableGallons : 0,
          // Why effectiveWeight is what it is: the application's Smart
          // Hoppers result for this hopper - the computed pounds, the
          // bulk density used and the catalog code it came from - or null
          // when the entered weight stands.
          smartWeight: smartWeightFrom(hopper.smartWeight),
          // Resolved through hookup-sources' own helper, which refuses a label
          // whose resin has since changed - reading entry.source raw would
          // show a stale silo against a resin that is no longer in that hopper.
          source: hookups && typeof hookups.sourceForPosition === "function"
            ? hookups.sourceForPosition(sources, key, hopper.resinName || "")
            : "",
          /* The PLANNED recipe's resin for this slot, beside the running
           * one, and whether promoting the plan would change it: "" and
           * false when nothing is planned. Current -> none counts as a
           * change - the hopper will be emptied. The drawing marks the
           * receiver from nextDiffers (station-machine-parts.js); the
           * cards say the name (otherResins, below). */
          nextResinName: planned && next[key] ? next[key].resinName : "",
          nextDiffers: planned && !sameResin(hopper.resinName || "", next[key] ? next[key].resinName : "")
        };
      }
    }
    return bySlot;
  }

  /* The OTHER recipe's resin beside each hopper of a face - for the
   * Current face ("current") the plan's, for the Next face ("next") the
   * running job's - keyed by slot: { resin, differs }, differs by the
   * same rule the drawing uses. Null when nothing is planned: with no
   * plan there is no other recipe to show. */
  function otherResins(resolved, face) {
    const r = resolved || {};
    if (!r.plan || !r.plan.planned) return null;
    const shown = face === "next" ? r.nextHopperState || {} : r.hopperState || {};
    const other = face === "next" ? r.hopperState || {} : r.nextHopperState || {};
    const out = {};
    for (const key of new Set([...Object.keys(shown), ...Object.keys(other)])) {
      const mine = shown[key] ? shown[key].resinName || "" : "";
      const theirs = other[key] ? other[key].resinName || "" : "";
      out[key] = { resin: theirs, differs: !sameResin(mine, theirs) };
    }
    return out;
  }

  /* The PLANNED recipe's hopper state - the Next Recipe as the bridge
   * projects it (`nextRecipe`, recipe fields only) - keyed by slot exactly
   * as the running job's is, so the same editor can be turned to either.
   * A plan has no tracking, no pump state, no weight and no geometry: those
   * keys are absent here by construction, not zeroed, so nothing reading
   * this map can mistake a plan for a job. Empty when nothing is planned.
   * The labels are the plan's own (`sources.next`). */
  function nextHopperStateFrom(snapshot) {
    const bySlot = {};
    const plan = snapshot && snapshot.nextRecipe && typeof snapshot.nextRecipe === "object" ? snapshot.nextRecipe : null;
    if (!plan || !Array.isArray(plan.layers)) return bySlot;
    const sources = snapshot.sources && typeof snapshot.sources === "object" && snapshot.sources.next
      && typeof snapshot.sources.next === "object"
      ? snapshot.sources.next
      : {};
    for (const layer of plan.layers) {
      if (!layer || !Array.isArray(layer.hoppers)) continue;
      for (const hopper of layer.hoppers) {
        if (!hopper) continue;
        const key = `${layer.name}:${hopper.index}`;
        bySlot[key] = {
          assigned: !!hopper.resinName,
          resinName: hopper.resinName || "",
          pct: Number.isFinite(hopper.pct) ? hopper.pct : 0,
          source: hookups && typeof hookups.sourceForPosition === "function"
            ? hookups.sourceForPosition(sources, key, hopper.resinName || "")
            : ""
        };
      }
    }
    return bySlot;
  }

  /* The planned recipe's layer shares, keyed as layerStateFrom keys the
   * running job's. Empty when nothing is planned. */
  function nextLayerStateFrom(snapshot) {
    const byLayer = {};
    const plan = snapshot && snapshot.nextRecipe && typeof snapshot.nextRecipe === "object" ? snapshot.nextRecipe : null;
    if (!plan || !Array.isArray(plan.layers)) return byLayer;
    for (const layer of plan.layers) {
      if (!layer || !layer.name) continue;
      byLayer[layer.name] = { layerPct: Number.isFinite(layer.layerPct) ? layer.layerPct : 0 };
    }
    return byLayer;
  }

  /* Whether the application holds a plan at all. */
  function planFrom(snapshot) {
    return { planned: !!(snapshot && snapshot.nextRecipe && typeof snapshot.nextRecipe === "object" && Array.isArray(snapshot.nextRecipe.layers)) };
  }

  function smartWeightFrom(raw) {
    if (!raw || typeof raw !== "object") return null;
    const value = Number(raw.value);
    if (!Number.isFinite(value) || value <= 0) return null;
    return {
      value,
      bulkDensity: Number.isFinite(raw.bulkDensity) && raw.bulkDensity > 0 ? raw.bulkDensity : 0,
      resinCode: typeof raw.resinCode === "string" ? raw.resinCode : ""
    };
  }

  /* Smart Hoppers as the bridge carries it: this device's switch, how the
   * line measures its hoppers ("cylindrical" | "volume" | null = not on an
   * identified line, so unavailable), and the line's shared circumference
   * in inches (0 = not entered). The demo fixture carries none of it: a
   * demo line is not connected to anything that could compute. */
  function smartHoppersFrom(snapshot) {
    const raw = snapshot && snapshot.smartHoppers && typeof snapshot.smartHoppers === "object" ? snapshot.smartHoppers : {};
    return {
      enabled: raw.enabled === true,
      geometryMode: raw.geometryMode === "cylindrical" || raw.geometryMode === "volume" ? raw.geometryMode : null,
      circumference: Number.isFinite(raw.circumference) && raw.circumference > 0 ? raw.circumference : 0
    };
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
      changeoverSetAt: Number.isFinite(job.changeoverSetAt) ? job.changeoverSetAt : null,
      /* Production and scrap pounds as the bridge carries them (a number,
       * or the entered string) - passed through untouched, because
       * resin-totals.js reads them with the application's own clampNum
       * and a second reading here would be a second interpretation. */
      prodResinLb: pounds(job.prodResinLb),
      scrapResinLb: pounds(job.scrapResinLb),
      /* Scanned lots by resin key, as the bridge projects them. Job state:
       * a lot belongs to the run, not to the recipe. */
      lots: lotsFrom(snapshot)
    };
  }

  function pounds(value) {
    if (typeof value === "string") return value;
    return Number.isFinite(value) ? value : 0;
  }

  function lotsFrom(snapshot) {
    const raw = snapshot && snapshot.lots && typeof snapshot.lots === "object" && !Array.isArray(snapshot.lots)
      ? snapshot.lots
      : {};
    const out = {};
    for (const key of Object.keys(raw)) if (typeof raw[key] === "string") out[key] = raw[key];
    return out;
  }

  /* The recipe as Resin Totals reads it: layers in recipe order, each with
   * its share and its hoppers' resin and blend. Recipe fields only - the
   * same three resin-totals.js reads off the application's own state - kept
   * in the snapshot's order because the totals' display names and the
   * order of equal rows follow first appearance. Nothing here is a second
   * copy of hopperState: it is the same values, in the shape the shared
   * calculation takes. */
  function recipeFrom(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.layers)) return { layers: [] };
    return {
      layers: snapshot.layers.filter(Boolean).map(layer => ({
        name: String(layer.name || ""),
        layerPct: Number.isFinite(layer.layerPct) ? layer.layerPct : 0,
        hoppers: (Array.isArray(layer.hoppers) ? layer.hoppers : []).filter(Boolean).map(hopper => ({
          pct: Number.isFinite(hopper.pct) ? hopper.pct : 0,
          resinName: hopper.resinName ? String(hopper.resinName) : ""
        }))
      }))
    };
  }

  /* The live snapshot rendered as a line configuration the model understands.
   * Layer count comes from the snapshot's own layers, so the machine on
   * screen is shaped by the running job rather than by anything Station
   * decided for itself. Each layer's SLOTS are the snapshot's hoppers (the
   * application's six); the hoppers drawn in them are the line's configured
   * count when the linked line says (four on some cores), never more than
   * the slots that exist, and every slot when it does not. */
  function configFromSnapshot(snapshot) {
    if (!snapshot || !snapshot.line) return null;
    const layers = Array.isArray(snapshot.layers) ? snapshot.layers : [];
    const layerCount = snapshot.line.layerCount || layers.length || null;
    if (!layerCount) return null;
    const configured = Array.isArray(snapshot.line.hopperCounts) ? snapshot.line.hopperCounts : null;
    const hopperCountFor = (layer, index) => {
      const slots = layer.hoppers.length;
      const declared = configured ? Number(configured[index]) : NaN;
      return Number.isInteger(declared) && declared > 0 ? Math.min(declared, slots) : slots;
    };
    return {
      lineNumber: snapshot.line.lineNumber,
      displayName: snapshot.line.displayName
        || (snapshot.line.lineNumber ? `Line ${snapshot.line.lineNumber}` : "Unlinked line"),
      layerCount,
      layerAPosition: snapshot.line.layerAPosition,
      hopperNamingMode: snapshot.line.hopperNamingMode,
      hopperGeometry: snapshot.line.hopperGeometry,
      layers: layers.map((layer, index) => ({ id: layer.name, slotCount: layer.hoppers.length, hopperCount: hopperCountFor(layer, index) }))
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
   * @returns {{kind, modelInput, label, detail, hopperState, layerState, nextHopperState, nextLayerState, plan, job, live}}
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
        /* The plan beside the job, through the same two readings; the
         * Next face turns the editor to these. */
        nextHopperState: nextHopperStateFrom(snapshot),
        nextLayerState: nextLayerStateFrom(snapshot),
        plan: planFrom(snapshot),
        job: jobStateFrom(snapshot),
        recipe: recipeFrom(snapshot),
        smartHoppers: smartHoppersFrom(snapshot),
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
      // A demo line plans nothing, either: every hopper's nextDiffers is
      // false and nextResinName "".
      nextHopperState: nextHopperStateFrom(demoSnapshot),
      nextLayerState: nextLayerStateFrom(demoSnapshot),
      plan: planFrom(demoSnapshot),
      // A demo line runs no job: no output, no changeover, as no tracking.
      job: jobStateFrom(demoSnapshot),
      recipe: recipeFrom(demoSnapshot),
      smartHoppers: smartHoppersFrom(demoSnapshot),
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
   *                 a usable volume or a computed Smart Hoppers weight,
   *                 the Smart Hoppers switch or circumference, the line's
   *                 output or changeover, the job's production,
   *                 scrap or scanned lots, or anything in the planned
   *                 recipe. The mounted stage and
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
    return JSON.stringify({
      hopperState: resolved.hopperState || {}, layerState: resolved.layerState || {},
      nextHopperState: resolved.nextHopperState || {}, nextLayerState: resolved.nextLayerState || {},
      job: resolved.job || null, smartHoppers: resolved.smartHoppers || null
    });
  }

  function classifyChange(before, after) {
    if (!after || !before) return "structural";
    if (structureKey(before) !== structureKey(after)) return "structural";
    return valuesKey(before) === valuesKey(after) ? "none" : "values";
  }

  return { MODE_AUTO, MODE_DEMO, normalizeResin, sameResin, hopperStateFrom, layerStateFrom, nextHopperStateFrom, nextLayerStateFrom, otherResins, planFrom, jobStateFrom, recipeFrom, smartHoppersFrom, configFromSnapshot, resolveSource, classifyChange };
});
