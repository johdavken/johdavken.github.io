/* Station line model - the machine described as data, before any pixels.
 *
 * WHAT THIS OWNS
 *
 * One job: turn "which line is this" into a complete, ordered description of
 * the equipment Station has to draw. Layer count, which physical side each
 * layer sits on, how many hoppers hang off each layer, which pieces of
 * equipment are repeated per layer, and which are shared by the whole line.
 *
 * WHAT THIS DOES NOT OWN
 *
 * No DOM, no coordinates, no styling, no recipe values, no run-down numbers,
 * no sync state. It is a pure function of a line configuration, so the whole
 * thing is testable in node and the renderer stays a mechanical walk over its
 * output. This is the same split attention-center.js uses: derive a stable
 * structure from facts the app already owns, and let a thin layer paint it.
 *
 * WHERE THE FACTS COME FROM
 *
 * Nothing here is a second source of truth. Layer count, Layer A's physical
 * side, hopper naming mode and the display name all come from
 * PolynLineIdentity.getLineConfiguration(), which is already the one place
 * those line facts are written down. Layer NAMES come from
 * PolynWorkspaceConfigurationPayloads.expectedLayerNames(), and hopper count
 * defaults to its HOPPERS_PER_LAYER. Both dependencies are optional and
 * injectable so tests can run the model in isolation, but in the browser
 * Station reads exactly what the existing floor UI reads.
 *
 * A caller may also hand in a literal config object (the demo lines do this)
 * rather than a line number. That path exists so the rendering contract can
 * be exercised for shapes no real line has yet - it is not a way to invent a
 * different truth for a line that does exist.
 *
 * WHICH BLENDER
 *
 * Two blenders stand on the floor: the batch mixer most lines run, and the
 * TSM gravimetric blender some run in its place. Which a line has follows
 * from the line catalog's hopper manufacturer (line-identity's
 * hopperManufacturer: Plast-Control on every line unless a Line
 * Configuration says TSM); a literal config may name the blender outright.
 * A TSM bank's loaders are short drums, all one size; the layout draws
 * them so, and stands the line's downcomer under the blender.
 */
(function (root, factory) {
  const deps = {
    lineIdentity: typeof require === "function" ? safeRequire("../line-identity.js") : (root && root.PolynLineIdentity),
    payloads: typeof require === "function" ? safeRequire("../workspace-configuration-payloads.js") : (root && root.PolynWorkspaceConfigurationPayloads)
  };
  function safeRequire(id) { try { return require(id); } catch (error) { return null; } }
  const api = factory(deps);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynStationLineModel = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (defaults) {
  "use strict";

  /* --------------------------------------------------------------------
   *   Layer roles
   * ------------------------------------------------------------------ */

  /* Derived from the layer's position in the physical stack, never tabulated
   * per line. A 3-layer line and a 5-layer line are the same rule applied to
   * different counts, which is the whole reason Station can accept a layer
   * count it has never seen before instead of gaining a fourth hard-coded
   * case. Index 0 is the OUTSIDE of the bubble.
   *
   * An even layer count has no single middle, so it gets no "core" - the two
   * central layers are the innermost subskins. That is a deliberate absence:
   * inventing a core on one of them would be a guess about a machine nobody
   * has described to us yet. */
  function roleForStackIndex(index, layerCount) {
    if (layerCount === 1) return "single";
    if (index === 0) return "outside";
    if (index === layerCount - 1) return "inside";
    const middle = (layerCount - 1) / 2;
    if (Number.isInteger(middle) && index === middle) return "core";
    return index < middle ? "subskin-outside" : "subskin-inside";
  }

  const ROLE_LABEL = Object.freeze({
    single: "Layer",
    outside: "Outside",
    "subskin-outside": "Outside subskin",
    core: "Core",
    "subskin-inside": "Inside subskin",
    inside: "Inside"
  });

  function roleLabel(role) {
    return ROLE_LABEL[role] || "Layer";
  }

  /* --------------------------------------------------------------------
   *   Blenders
   * ------------------------------------------------------------------ */

  const BLENDERS = Object.freeze(["batch", "tsm"]);
  /* The blender each hopper manufacturer stands on the line: the batch
   * mixer under Plast-Control's hoppers, the TSM gravimetric blender under
   * TSM's. The words are line-identity's HOPPER_MANUFACTURERS. */
  const BLENDER_BY_MANUFACTURER = Object.freeze({ "plast-control": "batch", tsm: "tsm" });

  function blenderFor(source) {
    const declared = source && (source.blender ?? source.blender_model);
    if (BLENDERS.includes(declared)) return declared;
    const manufacturer = source && (source.hopperManufacturer ?? source.hopper_manufacturer);
    return BLENDER_BY_MANUFACTURER[typeof manufacturer === "string" ? manufacturer.trim().toLowerCase() : ""] || "batch";
  }

  /* --------------------------------------------------------------------
   *   Equipment
   * ------------------------------------------------------------------ */

  /* Equipment repeated once per layer. Station draws one of each of these
   * inside every layer module. */
  const LAYER_EQUIPMENT = Object.freeze([
    Object.freeze({ role: "hopper-bank", label: "Hopper bank" }),
    Object.freeze({ role: "dosing", label: "Dosing / feed" }),
    Object.freeze({ role: "extruder", label: "Extruder" }),
    // Each extruder has its own melt pipe to its own port on the die. The die
    // is shared; the route to it is not, which is why this belongs here and
    // not in SHARED_EQUIPMENT.
    Object.freeze({ role: "feed-path", label: "Feed to die" })
  ]);

  /* Equipment the whole line shares, in film-path order from die to winder.
   * Listed once, never per layer: a 5-layer line has five extruders and
   * exactly one die, and duplicating the die per layer is the mistake this
   * list exists to make impossible. */
  const SHARED_EQUIPMENT = Object.freeze([
    Object.freeze({ role: "die", label: "Die" }),
    Object.freeze({ role: "air-ring", label: "Air ring" }),
    Object.freeze({ role: "bubble", label: "Bubble" }),
    Object.freeze({ role: "cage", label: "Cage" }),
    Object.freeze({ role: "tower", label: "Tower" }),
    Object.freeze({ role: "collapsing-frame", label: "Collapsing frame" }),
    Object.freeze({ role: "nip", label: "Nip" }),
    Object.freeze({ role: "idlers", label: "Idlers" }),
    Object.freeze({ role: "film-path", label: "Film web" }),
    Object.freeze({ role: "winders", label: "Winders" })
  ]);

  /* --------------------------------------------------------------------
   *   Naming
   * ------------------------------------------------------------------ */

  /* Layer names are the recipe's names (A, B, C...), asked of the payload
   * module first so Station and a saved Recipe can never disagree about what
   * the layers of a 3- or 5-layer line are called. The generated fallback
   * covers only counts the payload module does not define, which today means
   * shapes no recipe can be saved for anyway. */
  function layerNames(layerCount, payloads) {
    const known = payloads && typeof payloads.expectedLayerNames === "function"
      ? payloads.expectedLayerNames(layerCount)
      : null;
    if (Array.isArray(known) && known.length === layerCount) return known.slice();
    return Array.from({ length: layerCount }, (_, index) => String.fromCharCode(65 + index));
  }

  /* Mirrors line-identity's hopperPositionLabel: "main-plus-five" names the
   * first hopper Main and the rest 1-5, everything else is 1-based. Station
   * re-derives the label rather than importing the syncState-shaped helper,
   * because the model is handed a resolved naming MODE, not a sync state. */
  function hopperPositionLabel(index, namingMode) {
    if (namingMode === "main-plus-five" || namingMode === "main") {
      return index === 0 ? "Main" : String(index);
    }
    return String(index + 1);
  }

  function hopperId(layerName, index, namingMode) {
    const position = hopperPositionLabel(index, namingMode);
    return `${layerName}${position === "Main" ? "M" : position}`;
  }

  /* --------------------------------------------------------------------
   *   Configuration normalization
   * ------------------------------------------------------------------ */

  const DEFAULT_HOPPER_COUNT = 6;

  function defaultHopperCount(payloads) {
    const declared = payloads && payloads.HOPPERS_PER_LAYER;
    return Number.isInteger(declared) && declared > 0 ? declared : DEFAULT_HOPPER_COUNT;
  }

  function positiveInteger(value) {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : null;
  }

  /* Accepts either a line number (resolved through PolynLineIdentity) or a
   * literal config object. Returns null when the shape cannot be described
   * honestly - an unmapped line, or a config with no usable layer count - so
   * the renderer draws an explicit "not configured" state instead of an
   * invented machine. */
  function normalizeConfig(input, options) {
    const lineIdentity = options && "lineIdentity" in options ? options.lineIdentity : defaults.lineIdentity;
    const payloads = options && "payloads" in options ? options.payloads : defaults.payloads;

    let source = input;
    if (typeof input === "number" || typeof input === "string") {
      source = lineIdentity && typeof lineIdentity.getLineConfiguration === "function"
        ? lineIdentity.getLineConfiguration(input)
        : null;
    }
    if (!source || typeof source !== "object") return null;

    const layerCount = positiveInteger(source.layerCount ?? source.layer_count);
    if (!layerCount) return null;

    const lineNumber = positiveInteger(source.lineNumber ?? source.line_number);
    const rawPosition = source.layerAPosition ?? source.layer_a_position ?? null;
    // A single-layer line has no inside/outside decision to make, exactly as
    // line-identity treats it. Anything else keeps only a recognized side.
    const layerAPosition = layerCount === 1
      ? null
      : (rawPosition === "inside" || rawPosition === "outside" ? rawPosition : null);

    // The line catalog's per-layer counts (line-identity's hopperCounts),
    // in recipe order, when the line carries them: applied by index below,
    // in six-slot banks as the application lays its layers out.
    const counts = source.hopperCounts ?? source.hopper_counts;
    const hopperCounts = Array.isArray(counts) && counts.length === layerCount
      ? counts.map(count => positiveInteger(count)) : null;
    return {
      lineNumber,
      displayName: String(source.displayName || source.display_name || (lineNumber ? `Line ${lineNumber}` : "Unassigned line")),
      layerCount,
      layerAPosition,
      hopperNamingMode: source.hopperNamingMode ?? source.hopper_naming_mode ?? "standard",
      hopperGeometry: source.hopperGeometry ?? source.hopper_geometry ?? null,
      blender: blenderFor(source),
      layers: Array.isArray(source.layers) ? source.layers : null,
      hopperCounts,
      defaultHopperCount: positiveInteger(source.hopperCount ?? source.hoppersPerLayer) || defaultHopperCount(payloads),
      // The slots a layer's bank is built to, when the line says: the
      // application's layers are six-slot whatever a layer's hopper count,
      // so a four-hopper core is drawn in a six-wide bank. Absent, a
      // layer's slots are its hoppers - a literal config keeps its widths
      // - unless the line carries per-layer counts, which the application
      // lays out in its own six slots.
      defaultSlotCount: positiveInteger(source.slotCount ?? source.hopperSlots) || (hopperCounts ? defaultHopperCount(payloads) : null),
      payloads
    };
  }

  /* --------------------------------------------------------------------
   *   The model
   * ------------------------------------------------------------------ */

  /**
   * Build the full Station model for a line.
   *
   * @param {number|object} input  A line number, or a literal line config.
   * @param {object} [options]     { lineIdentity, payloads } overrides, for tests.
   * @returns {object|null}        The model, or null when the line cannot be described.
   *
   * Layer ORDER in the returned model is the recipe's: layers[0] is A,
   * then B, C... whichever side of the bubble each sits on. The letters are
   * the operator's identifiers, and a bank drawn left of another because it
   * is physically further out reads as the wrong line on a line where A is
   * the inside. Where each layer physically sits is carried on the layer
   * instead: `stackIndex` (0 is the outside of the bubble - the recipe's
   * order reversed when Layer A is the inside, the same derivation
   * line-identity's layerOrderRows makes, applied to the whole stack) and
   * the `role` derived from it. Nothing draws from the physical order;
   * everything labels from it.
   */
  function buildLineModel(input, options) {
    const config = normalizeConfig(input, options);
    if (!config) return null;

    const names = layerNames(config.layerCount, config.payloads);
    // Recipe order is A, B, C... Physical order runs outside -> inside. They
    // are the same when Layer A is the outside, and reversed when it is the
    // inside. With no known orientation we read the recipe order as the
    // physical one and say so via `orientationKnown`, rather than silently
    // picking a side. Either way the layers are LISTED in recipe order; the
    // physical position is a fact on each layer, not the list's order.
    const orientationKnown = config.layerCount === 1 || config.layerAPosition !== null;
    const reversed = config.layerAPosition === "inside";
    const stackIndexOf = recipeIndex => (reversed ? config.layerCount - 1 - recipeIndex : recipeIndex);

    const byName = new Map();
    if (config.layers) {
      for (const layer of config.layers) {
        const id = layer && (layer.id || layer.name);
        if (id) byName.set(String(id), layer);
      }
    }

    const layers = names.map((name, recipeIndex) => {
      const declared = byName.get(name) || null;
      const hopperCount = positiveInteger(declared && (declared.hopperCount ?? declared.hoppers_per_layer))
        || (config.hopperCounts && config.hopperCounts[recipeIndex])
        || config.defaultHopperCount;
      // Never fewer slots than hoppers: a hopper always has a slot to stand in.
      const slotCount = Math.max(hopperCount, positiveInteger(declared && declared.slotCount) || config.defaultSlotCount || 0);
      const stackIndex = stackIndexOf(recipeIndex);
      const role = roleForStackIndex(stackIndex, config.layerCount);
      return {
        id: name,
        stackIndex,
        recipeIndex,
        role,
        roleLabel: roleLabel(role),
        hopperCount,
        slotCount,
        // The blender this layer's bank feeds.
        blender: config.blender,
        equipment: LAYER_EQUIPMENT.map(item => ({ ...item, layer: name })),
        hoppers: Array.from({ length: hopperCount }, (_, index) => ({
          id: hopperId(name, index, config.hopperNamingMode),
          layer: name,
          index,
          positionLabel: hopperPositionLabel(index, config.hopperNamingMode)
        }))
      };
    });

    return {
      line: {
        lineNumber: config.lineNumber,
        displayName: config.displayName,
        layerCount: config.layerCount,
        layerAPosition: config.layerAPosition,
        orientationKnown,
        singleLayer: config.layerCount === 1,
        hopperNamingMode: config.hopperNamingMode,
        hopperGeometry: config.hopperGeometry,
        blender: config.blender
      },
      layers,
      shared: SHARED_EQUIPMENT.map(item => ({ ...item })),
      // Flat index, so a later inspector can resolve a clicked
      // data-hopper="A1" without walking the stack.
      hopperIndex: layers.reduce((all, layer) => {
        layer.hoppers.forEach(hopper => { all[hopper.id] = hopper; });
        return all;
      }, {})
    };
  }

  function totalHopperCount(model) {
    if (!model) return 0;
    return model.layers.reduce((total, layer) => total + layer.hopperCount, 0);
  }

  return {
    LAYER_EQUIPMENT,
    SHARED_EQUIPMENT,
    DEFAULT_HOPPER_COUNT,
    BLENDERS,
    BLENDER_BY_MANUFACTURER,
    blenderFor,
    roleForStackIndex,
    roleLabel,
    layerNames,
    hopperPositionLabel,
    hopperId,
    normalizeConfig,
    buildLineModel,
    totalHopperCount
  };
});
