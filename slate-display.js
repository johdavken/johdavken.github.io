/* Slate display preferences.
 *
 * Device-local, like the theme: saved in this browser, never synced, never
 * part of a job. One controller per Slate root, the same shape as
 * slate-theme.js - it validates the stored value, tells interested Slate
 * UI (Settings, the boot) when it changes, and writes nothing else.
 *
 * READ-ONLY (retired)
 *
 * Slate once kept a read-only preference here (on, off, or automatic -
 * read-only whenever a line was linked). It is gone: Slate is always
 * writable where the bridge allows. A record saved with a `readOnly` key
 * reads as an unknown key and is dropped on the next write, so a device
 * that chose On or Automatic is not left locked.
 *
 * BACKGROUND
 *
 * A soft picture behind Slate, as a translucent window shows the
 * wallpaper behind it: `none`, the default, or one of seven pictures
 * (slate/images/backgrounds, drawn by tools/slate-backgrounds) - smoke,
 * ember, tide, aurora and dunes belong to no theme; hearth is made for
 * Gruvbox and horizon for Retro 82, though any theme may wear them. The boot writes the word onto the root as
 * data-background and components/background.css lays the picture over the
 * page, faintly, with every press passing through it.
 *
 * HANDLING
 *
 * How a hopper's card moves while it is dragged (components/recipe-edit.css):
 * `lift`, the default, raises it off the page and swells the cell it would
 * land on; `tilt` lifts it and leans it the way it is carried; `float`
 * bobs it; `glow` keeps it flat and breathes its edge; `glass` frosts it;
 * `stamp` (made for Gruvbox) is flat with a hard offset shadow; `neon`
 * (made for Retro 82) lights its edge and lays scan lines over it; `still`
 * does none of it. Written
 * onto the root as data-drag-motion. A reduced-motion device gets still
 * whatever is chosen.
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
 * LAYOUT
 *
 * One choice for both the Recipe and the Weights pages. Both are the Grid
 * - every layer's hoppers as self-contained cells, positions lined up -
 * and this says where a layer's head stands. `grid`, the default, puts it
 * at the start of the layer's row, one row under another, the cells
 * sharing the width. `grid-top` puts it on top: every layer a column, its
 * cells stacked under its head at a fixed width, the columns centred. The
 * boot writes the Grid onto the root as data-layers / data-weights-layers
 * and the head's place as data-grid-heads; the sheets do the rest and
 * nothing is rebuilt, so an open editor or a drag in flight outlives the
 * switch. A phone keeps its own layout whatever is chosen.
 *
 * The Left and Top layouts were once chosen here too, per page (the
 * retired `layers` and `weightsLayers` keys). A record holding them reads
 * as unknown keys, dropped on the next write, and opens on the Grid.
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
 * INPUT (retired)
 *
 * Whether Slate draws for a finger or a mouse was once a choice here too
 * (`auto`, `touch` or `pointer`). It is always automatic now - touch on a
 * coarse primary pointer or inside the Android app, pointer otherwise
 * (slate/slate-tier.js) - and a record holding the old `input` key reads
 * it as unknown and drops it on the next write.
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
  const DEFAULTS = Object.freeze({ background: "none", handling: "lift", tracking: "automatic", layout: "grid", layerOrder: "forward", timeline: "realtime", host: "auto" });
  const KEYS = Object.freeze(Object.keys(DEFAULTS));
  const BACKGROUNDS = Object.freeze(["none", "smoke", "ember", "tide", "aurora", "dunes", "hearth", "horizon"]);
  const HANDLINGS = Object.freeze(["lift", "tilt", "float", "glow", "glass", "stamp", "neon", "still"]);
  const TRACKING_MODES = Object.freeze(["automatic", "assisted", "manual"]);
  const LAYOUTS = Object.freeze(["grid", "grid-top"]);
  const LAYER_ORDERS = Object.freeze(["forward", "reversed"]);
  const TIMELINE_VIEWS = Object.freeze(["realtime", "list"]);
  const HOST_CHOICES = Object.freeze(["auto", "slate", "legacy"]);

  /* A stored value, or anything else, to a full set of preferences:
   * every key present, unknown keys dropped, a bad value its default. */
  function normalize(value) {
    const source = value && typeof value === "object" ? value : {};
    return {
      background: BACKGROUNDS.includes(source.background) ? source.background : DEFAULTS.background,
      handling: HANDLINGS.includes(source.handling) ? source.handling : DEFAULTS.handling,
      tracking: TRACKING_MODES.includes(source.tracking) ? source.tracking : DEFAULTS.tracking,
      layout: LAYOUTS.includes(source.layout) ? source.layout : DEFAULTS.layout,
      layerOrder: LAYER_ORDERS.includes(source.layerOrder) ? source.layerOrder : DEFAULTS.layerOrder,
      timeline: TIMELINE_VIEWS.includes(source.timeline) ? source.timeline : DEFAULTS.timeline,
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

  /* A background, or the default for anything that is not one. */
  function backgroundOf(value) {
    return BACKGROUNDS.includes(value) ? value : DEFAULTS.background;
  }

  /* A handling, or the default for anything that is not one. */
  function handlingOf(value) {
    return HANDLINGS.includes(value) ? value : DEFAULTS.handling;
  }

  /* A tracking mode, or the default for anything that is not one. */
  function trackingModeOf(value) {
    return TRACKING_MODES.includes(value) ? value : DEFAULTS.tracking;
  }

  /* A layout, or the default for anything that is not one. */
  function layoutOf(value) {
    return LAYOUTS.includes(value) ? value : DEFAULTS.layout;
  }

  /* A layer order, or the default for anything that is not one. */
  function layerOrderOf(value) {
    return LAYER_ORDERS.includes(value) ? value : DEFAULTS.layerOrder;
  }

  /* A timeline view, or the default for anything that is not one. */
  function timelineViewOf(value) {
    return TIMELINE_VIEWS.includes(value) ? value : DEFAULTS.timeline;
  }

  /* A host choice, or the default for anything that is not one. */
  function hostChoiceOf(value) {
    return HOST_CHOICES.includes(value) ? value : DEFAULTS.host;
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
      getBackground: () => current.background,
      setBackground: value => apply({ background: backgroundOf(value) }).background,
      getHandling: () => current.handling,
      setHandling: value => apply({ handling: handlingOf(value) }).handling,
      getTrackingMode: () => current.tracking,
      setTrackingMode: value => apply({ tracking: trackingModeOf(value) }).tracking,
      getLayout: () => current.layout,
      setLayout: value => apply({ layout: layoutOf(value) }).layout,
      getLayerOrder: () => current.layerOrder,
      setLayerOrder: value => apply({ layerOrder: layerOrderOf(value) }).layerOrder,
      getTimelineView: () => current.timeline,
      setTimelineView: value => apply({ timeline: timelineViewOf(value) }).timeline,
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

  return Object.freeze({ STORAGE_KEY, DEFAULTS, BACKGROUNDS, HANDLINGS, TRACKING_MODES, LAYOUTS, LAYER_ORDERS, TIMELINE_VIEWS, HOST_CHOICES, normalize, read, backgroundOf, handlingOf, trackingModeOf, layoutOf, layerOrderOf, timelineViewOf, hostChoiceOf, create, readFrom, initialize });
});
