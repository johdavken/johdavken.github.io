/* Slate display preferences.
 *
 * Device-local, like the theme: saved in this browser, never synced, never
 * part of a job. One controller per Slate root, the same shape as
 * slate-theme.js - it validates the stored value, tells interested Slate
 * UI (Settings, the boot) when it changes, and writes nothing else.
 *
 * READ-ONLY
 *
 * RT Sync knows owners and members, and every member may write. Read-only
 * is therefore Slate's own promise: with it on, Slate withholds the
 * command bridge from its controls, so nothing done in Slate can change
 * the line's job. The preference is three-valued. `null` is automatic -
 * read-only whenever a line is linked, writable on the device's own local
 * session. `true`/`false` are the operator's explicit choice either way,
 * and `false` is the default: a fresh device is writable. A record that
 * holds `null` chose automatic and keeps it; only a record without the
 * key reads the default. The EFFECTIVE mode (automatic resolved against
 * the line) is the boot's to compute; this only keeps the preference.
 *
 * TRACKING
 *
 * How Slate offers the per-hopper Track toggle. `automatic`, the default,
 * offers none and has the recipe section track the hoppers whose planned
 * resin goes away itself; `assisted` offers Track on those hoppers (the
 * recipe section's rule); `manual` offers it on every hopper. This keeps
 * the word; what it means is slate-tracking.js's, and the dispatching is
 * the recipe's.
 *
 * LAYERS
 *
 * Where a layer's head - its name, role and share - stands on the Recipe
 * and Weights pages. `grid`, the default, makes every layer a row of
 * self-contained cells, one per hopper, the positions lined up down the
 * page (the Weights page reads it as `top`); `left` keeps the head in a
 * column beside the layer's hoppers, one layer under another; `top` puts
 * it above them and lays the layers side by side, wrapping when there
 * are more than fit. A record saved without a layout reads `grid`; an
 * operator's Left or Top is kept.
 * The boot writes the word onto the Slate root as data-layers and the
 * sheets do the rest: nothing is rebuilt, so an open editor or a drag in
 * flight outlives the switch.
 *
 * LAYER ORDER
 *
 * Which way the same pages list the layers: `forward`, the default, runs
 * A first as the line numbers them; `reversed` runs the last layer first
 * (E, D, C, B, A on a five-layer line). Written onto the root as
 * data-layer-order; each layer card carries its own index for the sheet
 * to turn around. Nothing is rebuilt here either.
 *
 * TIMELINE
 *
 * How the aside shows the run-down: `realtime`, the default, is the clock
 * axis - Now at the top, each tracked hopper a card at its mark; `list`
 * is the same hoppers as rows in time order, without the clock. The
 * Timeline reads the word on every refresh and redraws; its rows are
 * kept and moved, never rebuilt.
 *
 * INPUT
 *
 * Whether Slate draws for a finger or a mouse. `auto`, the default, is
 * touch on a coarse primary pointer or inside the Android app, pointer
 * otherwise; `touch` and `pointer` are the operator's choice either way.
 * This keeps the word; what it resolves to is slate/slate-tier.js's, and
 * the boot writes the result onto the root as data-input.
 *
 * HOST
 *
 * What this device opens when the address names no view: `auto`, the
 * default, is slate-host.js's own rule (Slate on a desktop's window and a
 * tablet's screen, the floor UI on a phone); `slate` and `legacy` are the
 * operator's choice. It lives here, beside the rest, because the Android
 * app has no address bar: a ?view= in the URL lasts one visit, this lasts.
 * slate-host.js reads it before anything of Slate's loads.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynSlateDisplay = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const STORAGE_KEY = "polyn.slate.display.v1";
  const DEFAULTS = Object.freeze({ readOnly: false, tracking: "automatic", layers: "grid", layerOrder: "forward", timeline: "realtime", input: "auto", host: "auto" });
  const KEYS = Object.freeze(Object.keys(DEFAULTS));
  const READ_ONLY_MODES = Object.freeze(["auto", "on", "off"]);
  const TRACKING_MODES = Object.freeze(["automatic", "assisted", "manual"]);
  const LAYER_ORIENTATIONS = Object.freeze(["left", "top", "grid"]);
  const LAYER_ORDERS = Object.freeze(["forward", "reversed"]);
  const TIMELINE_VIEWS = Object.freeze(["realtime", "list"]);
  const INPUT_MODES = Object.freeze(["auto", "touch", "pointer"]);
  const HOST_CHOICES = Object.freeze(["auto", "slate", "legacy"]);

  /* A stored value, or anything else, to a full set of preferences:
   * every key present, unknown keys dropped, a bad value its default. A
   * stored null under readOnly is the automatic choice, kept as such. */
  function normalize(value) {
    const source = value && typeof value === "object" ? value : {};
    return {
      readOnly: typeof source.readOnly === "boolean" ? source.readOnly : (source.readOnly === null && "readOnly" in source ? null : DEFAULTS.readOnly),
      tracking: TRACKING_MODES.includes(source.tracking) ? source.tracking : DEFAULTS.tracking,
      layers: LAYER_ORIENTATIONS.includes(source.layers) ? source.layers : DEFAULTS.layers,
      layerOrder: LAYER_ORDERS.includes(source.layerOrder) ? source.layerOrder : DEFAULTS.layerOrder,
      timeline: TIMELINE_VIEWS.includes(source.timeline) ? source.timeline : DEFAULTS.timeline,
      input: INPUT_MODES.includes(source.input) ? source.input : DEFAULTS.input,
      host: HOST_CHOICES.includes(source.host) ? source.host : DEFAULTS.host
    };
  }

  function read(storage) {
    if (!storage || typeof storage.getItem !== "function") return normalize(null);
    try {
      const raw = storage.getItem(STORAGE_KEY);
      return normalize(raw ? JSON.parse(raw) : null);
    } catch (error) {
      return normalize(null);
    }
  }

  function write(storage, value) {
    if (!storage || typeof storage.setItem !== "function") return false;
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(normalize(value)));
      return true;
    } catch (error) {
      return false;
    }
  }

  /* The preference as a word, and back. */
  function modeOf(readOnly) {
    if (readOnly === true) return "on";
    if (readOnly === false) return "off";
    return "auto";
  }

  function readOnlyOf(mode) {
    if (mode === "on" || mode === true) return true;
    if (mode === "off" || mode === false) return false;
    return null;
  }

  /* A tracking mode, or the default for anything that is not one. */
  function trackingModeOf(value) {
    return TRACKING_MODES.includes(value) ? value : DEFAULTS.tracking;
  }

  /* A layer orientation, or the default for anything that is not one. */
  function layerOrientationOf(value) {
    return LAYER_ORIENTATIONS.includes(value) ? value : DEFAULTS.layers;
  }

  /* A layer order, or the default for anything that is not one. */
  function layerOrderOf(value) {
    return LAYER_ORDERS.includes(value) ? value : DEFAULTS.layerOrder;
  }

  /* A timeline view, or the default for anything that is not one. */
  function timelineViewOf(value) {
    return TIMELINE_VIEWS.includes(value) ? value : DEFAULTS.timeline;
  }

  /* An input mode, or the default for anything that is not one. */
  function inputModeOf(value) {
    return INPUT_MODES.includes(value) ? value : DEFAULTS.input;
  }

  /* A host choice, or the default for anything that is not one. */
  function hostChoiceOf(value) {
    return HOST_CHOICES.includes(value) ? value : DEFAULTS.host;
  }

  /** The effective mode: the preference resolved against the line. */
  function effectiveReadOnly(readOnly, linked) {
    if (typeof readOnly === "boolean") return readOnly;
    return !!linked;
  }

  function create(element, storage) {
    if (!element || typeof element.setAttribute !== "function") return null;
    const listeners = new Set();
    let current = read(storage);

    function apply(next, options) {
      const wanted = normalize(Object.assign({}, current, next));
      const changed = KEYS.some(key => wanted[key] !== current[key]);
      current = wanted;
      if (!options || options.persist !== false) write(storage, current);
      if (changed) {
        for (const listener of [...listeners]) {
          try { listener(Object.freeze(Object.assign({}, current))); } catch (error) { /* one view cannot stop the others */ }
        }
      }
      return current;
    }

    return Object.freeze({
      getReadOnly: () => current.readOnly,
      getReadOnlyMode: () => modeOf(current.readOnly),
      setReadOnly: value => apply({ readOnly: readOnlyOf(value) }).readOnly,
      getTrackingMode: () => current.tracking,
      setTrackingMode: value => apply({ tracking: trackingModeOf(value) }).tracking,
      getLayerOrientation: () => current.layers,
      setLayerOrientation: value => apply({ layers: layerOrientationOf(value) }).layers,
      getLayerOrder: () => current.layerOrder,
      setLayerOrder: value => apply({ layerOrder: layerOrderOf(value) }).layerOrder,
      getTimelineView: () => current.timeline,
      setTimelineView: value => apply({ timeline: timelineViewOf(value) }).timeline,
      getInputMode: () => current.input,
      setInputMode: value => apply({ input: inputModeOf(value) }).input,
      getHostChoice: () => current.host,
      setHostChoice: value => apply({ host: hostChoiceOf(value) }).host,
      subscribe(listener) {
        if (typeof listener !== "function") return () => {};
        listeners.add(listener);
        return () => listeners.delete(listener);
      }
    });
  }

  /* The stored preferences of an environment (a window), read the way
   * initialize does - so slate-host.js can ask what this device opens
   * without touching storage itself. */
  function readFrom(environment) {
    let storage = null;
    try { storage = environment && environment.localStorage; } catch (error) { storage = null; }
    return read(storage);
  }

  function initialize(element, environment) {
    let storage = null;
    try { storage = environment && environment.localStorage; } catch (error) { storage = null; }
    return create(element, storage);
  }

  return Object.freeze({ STORAGE_KEY, DEFAULTS, READ_ONLY_MODES, TRACKING_MODES, LAYER_ORIENTATIONS, LAYER_ORDERS, TIMELINE_VIEWS, INPUT_MODES, HOST_CHOICES, normalize, read, modeOf, readOnlyOf, trackingModeOf, layerOrientationOf, layerOrderOf, timelineViewOf, inputModeOf, hostChoiceOf, effectiveReadOnly, create, readFrom, initialize });
});
