/* Station display preferences.
 *
 * The device-local choices about WHAT the stage draws, beside the theme's
 * choice of how it is coloured (station-theme.js). One controller owns one
 * Station root's preferences: it validates the stored values, writes each
 * as a data attribute on the root, and tells interested Station UI
 * (Handbook > Appearance) when one changes. It knows nothing of the
 * layout; the boot file reads it and asks the renderer for the drawing the
 * preference describes.
 *
 * There is one preference so far:
 *
 *   showExtruders   whether each layer's extruder is drawn under its
 *                   blender. Off by default: the extruder is the one piece
 *                   of the train that carries no operator information,
 *                   and without it the blenders - hoppers and mixer - are
 *                   drawn larger in the room it took.
 *
 * Like the theme, this file lives beside the application and is loaded by
 * both pages rather than by the Station host: a Station module may not
 * touch storage (station-isolation.test.js), and this one must.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynStationDisplay = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const STORAGE_KEY = "polyn.station.display.v1";
  const DEFAULTS = Object.freeze({ showExtruders: false });
  const KEYS = Object.freeze(Object.keys(DEFAULTS));
  /* What each preference writes on the root, for the stylesheets and the
   * tests: the attribute's name, and its value for each state. */
  const ATTRIBUTES = Object.freeze({
    showExtruders: Object.freeze({ name: "data-extruders", on: "shown", off: "hidden" })
  });

  /* A stored value, or anything else, to a full set of preferences: every
   * key present, every value a boolean, unknown keys dropped. */
  function normalize(value) {
    const source = value && typeof value === "object" ? value : {};
    const out = {};
    for (const key of KEYS) out[key] = typeof source[key] === "boolean" ? source[key] : DEFAULTS[key];
    return out;
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

  function create(element, storage) {
    if (!element || typeof element.setAttribute !== "function") return null;
    const listeners = new Set();
    let current = read(storage);

    function stamp() {
      for (const key of KEYS) {
        const attribute = ATTRIBUTES[key];
        element.setAttribute(attribute.name, current[key] ? attribute.on : attribute.off);
      }
    }

    function apply(next, options) {
      const wanted = normalize(Object.assign({}, current, next));
      const changed = KEYS.some(key => wanted[key] !== current[key]);
      current = wanted;
      stamp();
      if (!options || options.persist !== false) write(storage, current);
      if (changed) {
        for (const listener of [...listeners]) {
          try { listener(Object.freeze(Object.assign({}, current))); } catch (error) { /* one view cannot stop the others */ }
        }
      }
      return current.showExtruders;
    }

    // Restore before any component is created, as the theme does.
    apply({}, { persist: false });

    return Object.freeze({
      getShowExtruders: () => current.showExtruders,
      setShowExtruders: value => apply({ showExtruders: !!value }),
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

  return Object.freeze({ STORAGE_KEY, DEFAULTS, ATTRIBUTES, normalize, read, create, initialize });
});
