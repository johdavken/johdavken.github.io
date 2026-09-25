/* Station state bridge - a one-way window from the running application onto
 * a narrow, frozen copy of its state.
 *
 * WHY A BRIDGE RATHER THAN AN EXPORT
 *
 * app.js keeps `state` inside its own IIFE and never exports it. Handing that
 * object out would be the fastest way to get a second UI writing to it, which
 * is exactly the failure this project is trying to avoid - one underlying
 * recipe state interpreted by different UIs, never two UIs racing on one
 * mutable object. So nothing is exported. The application registers a reader;
 * consumers get a deep-cloned, deeply frozen projection and no way back.
 *
 * THE TWO FACES
 *
 * Producer (app.js, once):     connect({ read }) -> { publish, disconnect }
 * Consumer (Station, anyone):  getSnapshot(), subscribe(fn), isConnected()
 *
 * `publish` and `disconnect` exist ONLY on the handle connect() returns, so
 * holding a reference to this module does not let you write to it. A second
 * connect() while a producer is active throws rather than silently taking
 * over, so a consumer cannot displace the application as the source of truth.
 *
 * WHY THE BRIDGE CLONES WHAT IT IS GIVEN
 *
 * `read()` is supposed to return a freshly built plain object. If it ever
 * returned the live state object instead - a refactor away, at any time -
 * freezing that in place would silently break the running application. So the
 * bridge does not trust its producer: it deep-clones before it freezes. That
 * makes "a snapshot cannot mutate application state" a property of this file
 * rather than a promise about a call site somewhere else.
 *
 * COST
 *
 * publish() increments an integer and schedules one coalesced notification.
 * Nothing is cloned unless a consumer actually asks. That is what makes it
 * safe to call from saveSession(), which runs at keystroke rate.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynStationStateBridge = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* --------------------------------------------------------------------
   *   Cloning and freezing
   * ------------------------------------------------------------------ */

  /* JSON round-trip, matching active-job.js and cloud-sync.js. The snapshot
   * is JSON-safe by construction (numbers, strings, booleans, null), so this
   * is a complete copy rather than a lossy one - and anything that is NOT
   * JSON-safe has no business crossing this boundary in the first place. */
  function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function deepFreeze(value) {
    if (!value || typeof value !== "object") return value;
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
    return value;
  }

  /* --------------------------------------------------------------------
   *   Projection
   * ------------------------------------------------------------------ */

  const NUMBER_FIELDS = ["lineRate", "gauge"];

  function finite(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  /* A stored pounds value crosses as the application holds it: a finite
   * number as itself, a non-empty string (an entry mid-typing, or one with
   * a thousands separator) as that string, anything else as 0. */
  function finiteOrString(value) {
    if (typeof value === "string") return value.trim() ? value : 0;
    return finite(value);
  }

  function projectLots(raw) {
    const out = {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
    for (const key of Object.keys(raw)) {
      const value = raw[key];
      if (key && typeof value === "string" && value.trim()) out[key] = value;
    }
    return out;
  }

  function nullableInteger(value) {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : null;
  }

  /**
   * Build the narrow Station view of an application state object.
   *
   * Pure: it reads, it never writes, and it returns a brand-new plain object
   * every call. Exported separately from the bridge so it can be tested
   * without any producer/consumer wiring at all.
   *
   * WHAT IS DELIBERATELY LEFT OUT, and why this list matters:
   *
   *   appearance/display preferences (theme, density, timeFormat, surfaceStyle,
   *     mobileTileStyle, recipeLayerOrientation, alarm sound/vibrate, the
   *     mobile*Only flags, blocksOpen) - per-device presentation. Station has
   *     its own presentation layer and must not inherit the floor UI's.
   *   identity and transport (device id, workspace id, access tokens, sync
   *     status, the outbox) - Station is a view, not a second sync client.
   *   admin/auth state - never crosses a UI boundary.
   *   notes, saved configurations - real data, but nothing in Station reads
   *     them yet. They can be added when something needs them; a snapshot
   *     that carries everything is not a narrow bridge. (Scanned lots were on
   *     this list until the Handbook's Resin Totals needed them; see `lots`.)
   *   the undo/redo stacks themselves - only whether each recipe (Current, Next)
   *     HAS something to undo or redo crosses (see `history`). A stack is a
   *     copy of past state; handing it out would be handing out a second
   *     recipe model.
   *
   * WHAT THE NEXT RECIPE LOOKS LIKE HERE
   *
   * `nextRecipe` is the planned recipe as the application itself reads it
   * when it needs the effective plan - the caller passes the same normalized
   * payload it uses for that (`options.plannedRecipe`), which reflects the
   * operator's working copy and not merely the last committed one. It is
   * projected as recipe fields only: a plan has no receiver weights, no
   * tracking, no pump state and no geometry, so none of those appear on its
   * hoppers - by construction, not by omission. It is null when there is no
   * plan at all.
   *
   * @param {object} state                 The application state object.
   * @param {object} [options]
   * @param {object} [options.lineConfiguration]   PolynLineIdentity's resolved
   *        configuration for the connected line, or null when unlinked.
   * @param {function} [options.resolveHopperWeight]  The application's own
   *        effective-weight function (Smart Hoppers included). Defaults to the
   *        operator's entered weight, which is what a caller that has not
   *        extracted Smart Hoppers can honestly supply.
   * @param {object|null} [options.plannedRecipe]  The effective planned recipe
   *        as a normalized recipe payload (PolynNextRecipe.normalize's shape),
   *        or null for "nothing planned". When the option is absent the stored
   *        `state.nextRecipe` is read instead, which is the last committed
   *        plan - one save behind an open working copy.
   * @param {object} [options.history]  Undo/redo availability per recipe
   *        recipe: { current: { canUndo, canRedo }, next: { ... } }. Booleans
   *        only; absent means nothing to undo or redo.
   * @param {string|null} [options.smartHopperGeometryMode]  How the connected
   *        line measures its hoppers for Smart Hoppers - "cylindrical"
   *        (usable height and a shared circumference) or "volume" (usable
   *        gallons) - as the application's own resolver answers it. Absent
   *        or anything else projects as null: Smart Hoppers unavailable,
   *        never guessed from a line number here.
   * @param {function} [options.resolveSmartHopper]  The application's own
   *        Smart Hoppers computation for one hopper: null when nothing can
   *        be computed, else { value, bulkDensity, resin: { resin_code } }.
   *        Projected per hopper as `smartWeight` so Station can say WHY the
   *        effective weight is what it is. Absent means nothing is computed.
   */
  function project(state, options) {
    if (!state || typeof state !== "object") return null;
    const settings = options || {};
    const configuration = settings.lineConfiguration || null;
    const resolveWeight = typeof settings.resolveHopperWeight === "function"
      ? settings.resolveHopperWeight
      : hopper => finite(hopper && hopper.weight);
    const plannedRecipe = settings.plannedRecipe !== undefined ? settings.plannedRecipe : state.nextRecipe;
    const resolveSmart = typeof settings.resolveSmartHopper === "function" ? settings.resolveSmartHopper : () => null;
    const geometryMode = settings.smartHopperGeometryMode === "cylindrical" || settings.smartHopperGeometryMode === "volume"
      ? settings.smartHopperGeometryMode
      : null;

    // state.lineType is the live layer count of the running session - it is
    // enforced to match the connected line when there is one, and remains the
    // operator's own choice when there is not. The line configuration supplies
    // the physical facts the session does not carry.
    const layerCount = nullableInteger(state.lineType);

    const layers = Array.isArray(state.layers) ? state.layers : [];

    return {
      line: {
        lineNumber: configuration ? nullableInteger(configuration.lineNumber) : null,
        displayName: configuration && configuration.displayName ? String(configuration.displayName) : null,
        layerCount,
        layerAPosition: configuration && (configuration.layerAPosition === "inside" || configuration.layerAPosition === "outside")
          ? configuration.layerAPosition
          : null,
        hopperNamingMode: configuration && configuration.hopperNamingMode ? String(configuration.hopperNamingMode) : "standard",
        hopperGeometry: configuration && configuration.hopperGeometry ? String(configuration.hopperGeometry) : null,
        // Who made the hopper system - "plast-control" on most lines, "tsm"
        // where a TSM gravimetric blender stands; Station draws the machine
        // from this. Null when no line is linked or the line does not say.
        hopperManufacturer: configuration && configuration.hopperManufacturer ? String(configuration.hopperManufacturer) : null,
        // Hoppers per layer, in recipe order, as the line is configured -
        // most layers six, the core of several lines four. Null when no
        // line is linked or the linked line does not say: the session's
        // own layers (six slots each) are then the only fact there is.
        hopperCounts: configuration && Array.isArray(configuration.hopperCounts)
          ? configuration.hopperCounts.map(nullableInteger)
          : null,
        // False means "no line is linked, so these facts are the session's own
        // rather than the plant's" - a distinction Station has to be able to
        // show rather than quietly present as authoritative.
        linked: !!configuration
      },
      job: {
        lineRate: finite(state.lineRate),
        gauge: finite(state.gauge),
        // A plain string exactly as stored; parsing belongs to scheduling.js,
        // not to a transport boundary.
        changeoverTime: state.changeoverTime ? String(state.changeoverTime) : "",
        // When that clock time was last set on this device, as epoch
        // milliseconds - what scheduling.isChangeoverStale reads to decide
        // whether a deadline is still today's. Null when none is set.
        changeoverSetAt: state.changeoverTime && Number.isFinite(Number(state.changeoverSetAt))
          ? Number(state.changeoverSetAt)
          : null,
        /* The job's production and scrap pounds, as entered - what Resin
         * Totals splits across the recipe. Job facts, beside output and
         * changeover: they describe the run, not the recipe or the
         * equipment. Carried as the application stores them (a number, or
         * the entered string); resin-totals.js reads both the same way. */
        prodResinLb: finiteOrString(state.prodResinLb),
        scrapResinLb: finiteOrString(state.scrapResinLb)
      },
      /* Scanned lots: resin code -> lot, keyed exactly as the application
       * keys them (keyName: trimmed, upper-cased), string values only. Read
       * by Resin Totals to show the lot beside each material; no other
       * Station surface reads them. Empty when nothing was scanned. */
      lots: projectLots(state.resinLots),
      /* Hookup source labels for each recipe (Current, Next), keyed by physical
       * slot exactly as hookup-sources.js keys them ("<layer>:<index>"), and
       * carried in that module's own {resin, source} shape so Station can
       * resolve them with sourceForPosition() rather than reading the entry
       * raw. The resin is part of the record, not decoration: it is what lets
       * that helper refuse a label whose resin has since changed. Sources are
       * operational job state, not recipe state, which is why they sit beside
       * the two recipes rather than inside them. */
      sources: {
        current: sourcesFor(state, "current"),
        next: sourcesFor(state, "next")
      },
      nextRecipe: projectPlannedRecipe(plannedRecipe),
      history: projectHistory(settings.history),
      /* Smart Hoppers, as the application has it: whether THIS device has
       * the switch on (a local display preference, saved with the session
       * and never synced), how the connected line measures its hoppers
       * (null = no identified line, so the feature is unavailable), and
       * the line's one shared circumference in inches (an equipment value
       * that does sync; 0 = not entered). The per-hopper result of the
       * computation is on each hopper as `smartWeight`. */
      smartHoppers: {
        enabled: !!state.smartHoppersEnabled,
        geometryMode,
        circumference: finite(state.hopperCircumference)
      },
      /* The pump-off alarm, as this device has it: the floor UI's "Alarm
       * when pump-off is due" switch (a local preference, saved with the
       * session, never synced). */
      alarm: {
        enabled: !!state.mobileTimelineAlarm
      },
      layers: layers.map(layer => ({
        name: String((layer && layer.name) || ""),
        layerPct: finite(layer && layer.layerPct),
        hoppers: (Array.isArray(layer && layer.hoppers) ? layer.hoppers : []).map((hopper, index) => ({
          index,
          pct: finite(hopper && hopper.pct),
          resinName: hopper && hopper.resinName ? String(hopper.resinName) : "",
          // The operator's entered receiver weight - physical equipment value.
          weight: finite(hopper && hopper.weight),
          /* Usable height from the Receiver Weight Profile, in inches. Physical
           * equipment, the same category as `weight` - it describes the vessel,
           * not what is in it. Station draws hopper bodies to scale from it; a
           * volume-geometry line has no height and reports 0, which the drawing
           * reads as "use the default". */
          usableHeight: finite(hopper && hopper.usableHeight),
          /* Usable volume in gallons - the volume-geometry lines' measure,
           * the same category as usableHeight. 0 means "not entered". It
           * does not shape the drawing. */
          usableGallons: finite(hopper && hopper.usableGallons),
          // What the run-down formula would actually use. Separate from
          // `weight` on purpose: they differ whenever Smart Hoppers resolves a
          // value, and collapsing them would hide which one Station is showing.
          effectiveWeight: finite(resolveWeight(hopper)),
          /* Why it is that: the Smart Hoppers computation for this hopper
           * when there is one - the computed pounds, the bulk density it
           * used (lb/ft³) and the catalog resin code it came from - or
           * null when the entered weight stands. */
          smartWeight: projectSmartWeight(resolveSmart(hopper)),
          track: !!(hopper && hopper.track),
          pumpOff: !!(hopper && hopper.pumpOff),
          /* When the pump went off (epoch ms), while it is off and the
           * application knows; null otherwise. Runtime state, as pumpOff. */
          pumpOffAt: hopper && hopper.pumpOff && Number(hopper.pumpOffAt) > 0 ? Number(hopper.pumpOffAt) : null
        }))
      }))
    };
  }

  /* One hopper's Smart Hoppers result, or null. The application answers
   * { value, resin, bulkDensity } or null; only the three facts Station
   * reads cross, and a result without a positive finite value is no
   * result. */
  function projectSmartWeight(result) {
    if (!result || typeof result !== "object") return null;
    const value = Number(result.value);
    if (!Number.isFinite(value) || value <= 0) return null;
    return {
      value,
      bulkDensity: finite(result.bulkDensity),
      resinCode: result.resin && result.resin.resin_code ? String(result.resin.resin_code) : ""
    };
  }

  /* The planned recipe's layers, from a normalized recipe payload. Recipe
   * fields only - see the note on project(). A payload with no layers is no
   * plan. */
  function projectPlannedRecipe(payload) {
    if (!payload || typeof payload !== "object" || !Array.isArray(payload.layers)) return null;
    return {
      layers: payload.layers.map(layer => ({
        name: String((layer && layer.name) || ""),
        layerPct: finite(layer && layer.layer_pct),
        hoppers: (Array.isArray(layer && layer.hoppers) ? layer.hoppers : []).map((hopper, index) => ({
          index,
          pct: finite(hopper && hopper.pct),
          resinName: hopper && hopper.resin_name ? String(hopper.resin_name) : ""
        }))
      }))
    };
  }

  /* Whether each recipe has anything to undo or redo. Informational:
   * two booleans per recipe, never the entries themselves. */
  function projectHistory(history) {
    const of = recipe => {
      const entry = history && history[recipe];
      return {
        canUndo: !!(entry && entry.canUndo),
        canRedo: !!(entry && entry.canRedo)
      };
    };
    return { current: of("current"), next: of("next") };
  }

  function sourcesFor(state, recipe) {
    const store = state && state.hookupSources && state.hookupSources[recipe];
    if (!store || typeof store !== "object" || Array.isArray(store)) return {};
    const out = {};
    for (const key of Object.keys(store)) {
      const entry = store[key];
      if (!entry || typeof entry !== "object") continue;
      out[key] = {
        resin: entry.resin ? String(entry.resin) : "",
        source: entry.source ? String(entry.source) : ""
      };
    }
    return out;
  }

  /* --------------------------------------------------------------------
   *   The bridge
   * ------------------------------------------------------------------ */

  function defaultScheduler(run) {
    if (typeof queueMicrotask === "function") queueMicrotask(run);
    else Promise.resolve().then(run);
  }

  function createBridge(options) {
    const schedule = (options && options.scheduler) || defaultScheduler;

    let producer = null;      // the registered read function, or null
    let revision = 0;
    let cachedSnapshot = null;
    let cachedRevision = -1;
    let notifyQueued = false;
    const subscribers = new Set();

    function isConnected() {
      return producer !== null;
    }

    /* Built at most once per revision. A consumer that calls this ten times
     * between two publishes pays for one clone, and every one of those calls
     * gets the identical frozen object - so identity comparison is a valid
     * "did anything change" test for a consumer that wants one. */
    function getSnapshot() {
      if (!producer) return null;
      if (cachedRevision === revision) return cachedSnapshot;

      let raw;
      try {
        raw = producer();
      } catch (error) {
        // A failing reader must not take the application down with it. The
        // consumer sees "no snapshot", which is the same thing it sees when
        // nothing is connected, and which it already knows how to render.
        cachedSnapshot = null;
        cachedRevision = revision;
        return null;
      }

      if (!raw || typeof raw !== "object") {
        cachedSnapshot = null;
        cachedRevision = revision;
        return null;
      }

      let copy;
      try {
        copy = cloneJson(raw);
      } catch (error) {
        cachedSnapshot = null;
        cachedRevision = revision;
        return null;
      }

      copy.revision = revision;
      cachedSnapshot = deepFreeze(copy);
      cachedRevision = revision;
      return cachedSnapshot;
    }

    function flush() {
      notifyQueued = false;
      if (!subscribers.size) return;
      const snapshot = getSnapshot();
      // Iterate a copy: a subscriber is allowed to unsubscribe itself, or
      // another one, from inside its own callback.
      for (const subscriber of [...subscribers]) {
        if (!subscribers.has(subscriber)) continue;
        try {
          subscriber(snapshot);
        } catch (error) {
          // One broken consumer must not stop the others being told, and must
          // never propagate back into the application that called publish().
        }
      }
    }

    function queueNotification() {
      if (notifyQueued) return;
      notifyQueued = true;
      schedule(flush);
    }

    function subscribe(listener) {
      if (typeof listener !== "function") return () => {};
      subscribers.add(listener);
      let live = true;
      return function unsubscribe() {
        if (!live) return;
        live = false;
        subscribers.delete(listener);
      };
    }

    /**
     * Register the application as the source. Returns the ONLY handle that can
     * publish or disconnect - which is what makes this module read-only to
     * everyone who merely imports it.
     */
    function connect(source) {
      if (producer) {
        throw new Error("station-state-bridge: a producer is already connected; disconnect it first");
      }
      const read = source && source.read;
      if (typeof read !== "function") {
        throw new TypeError("station-state-bridge: connect({ read }) requires a read function");
      }

      producer = read;
      revision += 1;
      cachedRevision = -1;
      let active = true;
      queueNotification();

      return Object.freeze({
        /* Say that the committed state moved. Cheap on purpose: an integer and
         * at most one queued notification per tick, however many times it is
         * called in that tick. */
        publish() {
          if (!active) return false;
          revision += 1;
          queueNotification();
          return true;
        },
        disconnect() {
          if (!active) return false;
          active = false;
          producer = null;
          revision += 1;
          cachedSnapshot = null;
          cachedRevision = -1;
          queueNotification();
          return true;
        },
        isActive() { return active; }
      });
    }

    return Object.freeze({
      connect,
      getSnapshot,
      subscribe,
      isConnected,
      getRevision() { return revision; },
      project
    });
  }

  const shared = createBridge();

  return Object.freeze({
    connect: shared.connect,
    getSnapshot: shared.getSnapshot,
    subscribe: shared.subscribe,
    isConnected: shared.isConnected,
    getRevision: shared.getRevision,
    project,
    // A fresh, isolated bridge. Tests use it so they never share the shared
    // instance; production has exactly one source and uses the shared one.
    create: createBridge
  });
});
