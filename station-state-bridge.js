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
   *   notes, saved configurations, scanned lots - real data, but nothing in
   *     Station reads them yet. They can be added when something needs them;
   *     a snapshot that carries everything is not a narrow bridge.
   *   the NEXT recipe's hookup sources - only `current` crosses, because only
   *     the current recipe is shown.
   *
   * @param {object} state                 The application state object.
   * @param {object} [options]
   * @param {object} [options.lineConfiguration]   PolynLineIdentity's resolved
   *        configuration for the connected line, or null when unlinked.
   * @param {function} [options.resolveHopperWeight]  The application's own
   *        effective-weight function (Smart Hoppers included). Defaults to the
   *        operator's entered weight, which is what a caller that has not
   *        extracted Smart Hoppers can honestly supply.
   */
  function project(state, options) {
    if (!state || typeof state !== "object") return null;
    const settings = options || {};
    const configuration = settings.lineConfiguration || null;
    const resolveWeight = typeof settings.resolveHopperWeight === "function"
      ? settings.resolveHopperWeight
      : hopper => finite(hopper && hopper.weight);

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
        changeoverTime: state.changeoverTime ? String(state.changeoverTime) : ""
      },
      /* Hookup source labels for the CURRENT recipe, keyed by physical slot
       * exactly as hookup-sources.js keys them ("<layer>:<index>"), and
       * carried in that module's own {resin, source} shape so Station can
       * resolve them with sourceForPosition() rather than reading the entry
       * raw. The resin is part of the record, not decoration: it is what lets
       * that helper refuse a label whose resin has since changed. */
      sources: currentSources(state),
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
          // What the run-down formula would actually use. Separate from
          // `weight` on purpose: they differ whenever Smart Hoppers resolves a
          // value, and collapsing them would hide which one Station is showing.
          effectiveWeight: finite(resolveWeight(hopper)),
          track: !!(hopper && hopper.track),
          pumpOff: !!(hopper && hopper.pumpOff)
        }))
      }))
    };
  }

  function currentSources(state) {
    const store = state && state.hookupSources && state.hookupSources.current;
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
