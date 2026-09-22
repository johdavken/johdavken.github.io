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
 * session - and is the default, so a preview joined to a running line is
 * safe before anyone has opened Settings. `true`/`false` are the
 * operator's explicit choice either way. The EFFECTIVE mode (automatic
 * resolved against the line) is the boot's to compute; this only keeps
 * the preference.
 *
 * TRACKING
 *
 * How Slate offers the per-hopper Track toggle. `assisted`, the default,
 * offers it where a planned resin goes away (the recipe section's rule);
 * `manual` offers it on every hopper; `automatic` offers none and has the
 * recipe section track those hoppers itself. This keeps the word; what it
 * means is slate-tracking.js's, and the dispatching is the recipe's.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynSlateDisplay = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const STORAGE_KEY = "polyn.slate.display.v1";
  const DEFAULTS = Object.freeze({ readOnly: null, tracking: "assisted" });
  const KEYS = Object.freeze(Object.keys(DEFAULTS));
  const READ_ONLY_MODES = Object.freeze(["auto", "on", "off"]);
  const TRACKING_MODES = Object.freeze(["automatic", "assisted", "manual"]);

  /* A stored value, or anything else, to a full set of preferences:
   * every key present, unknown keys dropped, a bad value its default. */
  function normalize(value) {
    const source = value && typeof value === "object" ? value : {};
    return {
      readOnly: typeof source.readOnly === "boolean" ? source.readOnly : DEFAULTS.readOnly,
      tracking: TRACKING_MODES.includes(source.tracking) ? source.tracking : DEFAULTS.tracking
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
      subscribe(listener) {
        if (typeof listener !== "function") return () => {};
        listeners.add(listener);
        return () => listeners.delete(listener);
      }
    });
  }

  function initialize(element, environment) {
    let storage = null;
    try { storage = environment && environment.localStorage; } catch (error) { storage = null; }
    return create(element, storage);
  }

  return Object.freeze({ STORAGE_KEY, DEFAULTS, READ_ONLY_MODES, TRACKING_MODES, normalize, read, modeOf, readOnlyOf, trackingModeOf, effectiveReadOnly, create, initialize });
});
