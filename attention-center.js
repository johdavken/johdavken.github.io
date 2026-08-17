/* Attention Center - the desktop notification bell's derived store.
 *
 * This module owns NO validation rules. Every input it reads is a fact the
 * application has already computed with its existing logic (percentage
 * totals from validateAndCompute/updateCollapsedSummaries, weight checks
 * from effectiveHopperWeight, sync condition from cloud-sync's own status
 * machine). All this module does is normalize those facts into stable,
 * deduplicated notification entries: id, severity, title, message, section,
 * action.
 *
 * Because derive() is a pure function of the current facts, an entry is
 * removed the instant its underlying condition clears, and re-running it on
 * every render/tick/refresh can never produce a duplicate.
 */
(function(root, factory){
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynAttentionCenter = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function(){
  "use strict";

  const SEVERITY = { error: "error", warning: "warning" };
  // Severity must be readable without color, so every entry carries a word
  // as well as an icon glyph.
  const SEVERITY_LABEL = { error: "Error", warning: "Attention" };
  const SEVERITY_RANK = { error: 0, warning: 1 };

  const SECTION = {
    setup: "Setup",
    recipe: "Recipe",
    // The planned recipe is a separate section, never folded into "Recipe":
    // an unfinished plan is a planning note, not a fault on the running job.
    nextRecipe: "Next Recipe",
    timeline: "Timeline",
    sync: "RT Sync"
  };

  // How long an ordinary "Pending" upload may sit before it stops being an
  // ordinary brief sending state and becomes something the operator should
  // know about. Below this, a pending outbox item raises nothing at all.
  const DEFAULT_PENDING_STALL_MS = 90000;
  // A local-storage write failure is a transient event, not live state -
  // nothing in the application still represents it once it has been
  // reported. Rather than pinning it in the bell forever, it ages out.
  const DEFAULT_TRANSIENT_TTL_MS = 300000;

  function num(value){
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  function text(value){
    return String(value === null || value === undefined ? "" : value).trim();
  }
  function plural(count, one, many){
    return num(count) === 1 ? one : many;
  }
  function fmtPct(value){
    const n = num(value);
    return `${Number(n.toFixed(2))}%`;
  }
  // Accepts an epoch number, a Date, or an ISO string - callers pass
  // whichever their own state already holds (cloud-sync stores ISO strings,
  // recordAttentionStorageError uses Date.now()).
  function timestamp(value){
    if (value === null || value === undefined || value === "") return null;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    const ms = value instanceof Date ? value.getTime() : Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
  }

  function entry(id, severity, title, options){
    const config = options || {};
    return {
      id,
      severity,
      severityLabel: SEVERITY_LABEL[severity] || SEVERITY_LABEL.warning,
      title,
      message: text(config.message),
      section: config.section || SECTION.setup,
      action: config.action ? { id: config.action, label: config.actionLabel || "Open" } : null
    };
  }

  /* ----------------------------------------------------------------------
   *   Rules - one per unresolved condition, each keyed by a stable id
   * -------------------------------------------------------------------- */

  function setupEntries(setup){
    const items = [];
    if (setup.lineRateSet === false){
      items.push(entry("setup.line-rate", SEVERITY.warning, "Line rate is not set", {
        message: "Run-down rates and times calculate as zero until a line rate is entered.",
        section: SECTION.setup,
        action: "review-setup",
        actionLabel: "Review Setup"
      }));
    }
    if (setup.hopperWeightsUnset){
      items.push(entry("setup.weights-unset", SEVERITY.warning, "Receiver hopper weights are not set", {
        message: "Enter receiver weights for accurate run-down timing.",
        section: SECTION.setup,
        action: "open-weights",
        actionLabel: "Open Weights"
      }));
    }else if (num(setup.missingTrackedWeightCount) > 0){
      const count = num(setup.missingTrackedWeightCount);
      items.push(entry("setup.tracked-weights-missing", SEVERITY.warning,
        `${count} tracked ${plural(count, "hopper is", "hoppers are")} missing weight`, {
          message: "Tracked hoppers without a receiver weight are left out of run-down timing.",
          section: SECTION.setup,
          action: "open-weights",
          actionLabel: "Open Weights"
        }));
    }
    return items;
  }

  /* The layers whose hoppers do not total 100%. Accepts either the richer
   * [{name, totalPct}] form the application now supplies, or a plain list of
   * names - the totals are what the grid used to print beside the column, so
   * a caller that only knows the names still gets a correct (if less
   * detailed) entry rather than none at all. */
  function invalidLayers(source){
    if (Array.isArray(source.invalidLayers)){
      return source.invalidLayers
        .filter(layer=>layer && text(layer.name))
        .map(layer=>({ name: text(layer.name), totalPct: layer.totalPct }));
    }
    return (Array.isArray(source.invalidLayerNames) ? source.invalidLayerNames : [])
      .filter(Boolean)
      .map(name=>({ name: text(name), totalPct: null }));
  }
  function layerTotalsSentence(layers){
    const withTotals = layers.filter(layer=>layer.totalPct !== null && layer.totalPct !== undefined);
    if (!withTotals.length) return "";
    return `${withTotals.map(layer=>`Layer ${layer.name} totals ${fmtPct(layer.totalPct)}`).join(" · ")}. `;
  }

  function recipeEntries(recipe){
    const items = [];
    if (recipe.layerTotalValid === false){
      items.push(entry("recipe.layer-total", SEVERITY.warning,
        `Layer percentages total ${fmtPct(recipe.layerTotalPct)}`, {
          message: "Layer splits are expected to total 100%.",
          section: SECTION.recipe,
          action: "open-recipe",
          actionLabel: "Open Recipe"
        }));
    }
    const invalid = invalidLayers(recipe);
    if (invalid.length){
      items.push(entry("recipe.hopper-totals", SEVERITY.warning,
        `Hopper percentages are off in ${plural(invalid.length, "layer", "layers")} ${invalid.map(layer=>layer.name).join(", ")}`, {
          message: `${layerTotalsSentence(invalid)}Each layer's hoppers are expected to total 100%.`,
          section: SECTION.recipe,
          action: "open-recipe",
          actionLabel: "Open Recipe"
        }));
    }
    return items;
  }

  /* The planned recipe for the upcoming changeover. Two things keep this from
   * being noise:
   *
   *   - a plan nobody has started (planned !== true) raises nothing at all, so
   *     operators who never open the Next page never see an entry here;
   *   - an unfinished plan is described as unfinished, not as an error. It is
   *     never a fault on the running job, and it never touches the Recipe
   *     section's own readiness, which describes the current recipe only.
   */
  function nextRecipeEntries(next){
    if (next.planned !== true) return [];
    const items = [];
    if (next.layerTotalValid === false){
      items.push(entry("next-recipe.layer-total", SEVERITY.warning,
        `Next Recipe layer percentages total ${fmtPct(next.layerTotalPct)}`, {
          message: "The planned recipe is not finished. Layer splits are expected to total 100% before it can be loaded.",
          section: SECTION.nextRecipe,
          action: "open-next-recipe",
          actionLabel: "Open Next Recipe"
        }));
    }
    const invalid = invalidLayers(next);
    if (invalid.length){
      items.push(entry("next-recipe.hopper-totals", SEVERITY.warning,
        `Next Recipe hopper percentages are off in ${plural(invalid.length, "layer", "layers")} ${invalid.map(layer=>layer.name).join(", ")}`, {
          message: `${layerTotalsSentence(invalid)}The planned recipe is not finished; each layer's hoppers are expected to total 100% before it can be loaded.`,
          section: SECTION.nextRecipe,
          action: "open-next-recipe",
          actionLabel: "Open Next Recipe"
        }));
    }
    return items;
  }

  function timelineEntries(timeline){
    if (num(timeline.trackedCount) > 0) return [];
    return [entry("timeline.no-tracked", SEVERITY.warning, "No hoppers are tracked", {
      message: "Turn on Track for the hoppers that should appear in the timeline.",
      section: SECTION.timeline,
      action: "track-hoppers",
      actionLabel: "Open Recipe"
    })];
  }

  /* RT Sync raises an item only for a condition that needs the operator.
   * "Syncing", "Connecting", "Synced" and "Local only" never do, and a
   * short-lived "Pending" upload is the ordinary sending state - it is only
   * reported once it is offline-blocked or has visibly stalled. */
  function syncEntries(sync, now, stallMs){
    const status = text(sync.status);
    const pendingCount = num(sync.pendingCount);
    const pendingLabel = `${pendingCount} ${plural(pendingCount, "change is", "changes are")}`;

    if (status === "Error"){
      return [entry("sync.error", SEVERITY.error, "RT Sync failed", {
        message: text(sync.message) || "Synchronization stopped and needs operator action.",
        section: SECTION.sync,
        action: "retry-sync",
        actionLabel: "Retry Sync"
      })];
    }
    if (status === "Conflict"){
      return [entry("sync.conflict", SEVERITY.error, "RT Sync conflict needs resolving", {
        message: text(sync.message) || "Shared and local jobs differ. Synchronization is paused until resolved.",
        section: SECTION.sync,
        action: "retry-sync",
        actionLabel: "Retry Sync"
      })];
    }
    if (status === "Offline" || (pendingCount > 0 && sync.enabled && sync.connected === false)){
      return [entry("sync.offline-pending", SEVERITY.warning,
        pendingCount > 0 ? `${pendingLabel} waiting to sync` : "RT Sync is offline", {
          message: pendingCount > 0
            ? "Changes are safe on this device and will upload when the connection returns."
            : "Resin.Tools stays fully usable; shared updates resume when the connection returns.",
          section: SECTION.sync,
          action: "retry-sync",
          actionLabel: "Retry Sync"
        })];
    }
    const oldest = timestamp(sync.oldestPendingAt);
    if (pendingCount > 0 && oldest !== null && now - oldest >= stallMs){
      return [entry("sync.stalled", SEVERITY.warning, `${pendingLabel} still waiting to sync`, {
        message: "The upload has not completed. Retry RT Sync to reconcile this device.",
        section: SECTION.sync,
        action: "retry-sync",
        actionLabel: "Retry Sync"
      })];
    }
    return [];
  }

  /* Transient local-storage failures. "This browser cannot save local data"
   * is one underlying condition however many individual writes hit it, so
   * every live report collapses into a single entry - two rows with the same
   * title would read as a duplicate. Reports age out because no live
   * application state still represents them. */
  function storageEntries(reports, now, ttlMs){
    const live = (Array.isArray(reports) ? reports : [])
      .filter(report=>{
        if (!text(report && report.message)) return false;
        const at = timestamp(report.at);
        return at === null || now - at < ttlMs;
      })
      .sort((a, b)=>(timestamp(a.at) || 0) - (timestamp(b.at) || 0));
    if (!live.length) return [];

    const distinct = [];
    live.forEach(report=>{
      const detail = text(report.message);
      if (!distinct.includes(detail)) distinct.push(detail);
    });
    const newest = text(live[live.length - 1].message);
    const others = distinct.filter(detail=>detail !== newest).length;
    return [entry("storage.write-failed", SEVERITY.error, "Local data could not be saved", {
      message: others
        ? `${newest} ${others} other local ${plural(others, "write", "writes")} also failed.`
        : newest,
      section: SECTION.setup,
      action: null
    })];
  }

  /* ----------------------------------------------------------------------
   *   Derivation
   * -------------------------------------------------------------------- */

  function derive(facts, options){
    const source = facts || {};
    const config = options || {};
    const now = timestamp(config.now) ?? Date.now();
    const stallMs = Number.isFinite(config.pendingStallMs) ? config.pendingStallMs : DEFAULT_PENDING_STALL_MS;
    const ttlMs = Number.isFinite(config.transientTtlMs) ? config.transientTtlMs : DEFAULT_TRANSIENT_TTL_MS;

    const collected = [
      ...syncEntries(source.sync || {}, now, stallMs),
      ...storageEntries(source.storage, now, ttlMs),
      ...recipeEntries(source.recipe || {}),
      ...nextRecipeEntries(source.nextRecipe || {}),
      ...setupEntries(source.setup || {}),
      ...timelineEntries(source.timeline || {})
    ];

    // Stable id is the identity of a condition, so the same underlying issue
    // reported twice collapses to one entry no matter how it arrived.
    const byId = new Map();
    collected.forEach(item=>{ if (!byId.has(item.id)) byId.set(item.id, item); });
    const items = Array.from(byId.values())
      .sort((a, b)=>SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);

    const errorCount = items.filter(item=>item.severity === SEVERITY.error).length;
    const warningCount = items.length - errorCount;
    return {
      items,
      count: items.length,
      errorCount,
      warningCount,
      severity: errorCount ? SEVERITY.error : (warningCount ? SEVERITY.warning : "none")
    };
  }

  /* The bell's accessible name. Kept here so the wording stays in step with
   * the counts derive() produces. */
  function badgeLabel(summary){
    const count = num(summary && summary.count);
    if (!count) return "Notifications, no items";
    return `Notifications, ${count} ${plural(count, "item", "items")}`;
  }

  return {
    derive,
    badgeLabel,
    SEVERITY,
    SEVERITY_LABEL,
    SECTION,
    DEFAULT_PENDING_STALL_MS,
    DEFAULT_TRANSIENT_TTL_MS
  };
});
