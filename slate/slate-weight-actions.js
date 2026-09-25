/* The Weights section's seam to the application: a hopper's receiver
 * weight and geometry, the line's shared circumference, and this
 * device's Smart Hoppers switch.
 *
 * Slate's Weights section builds the fields; this is the one file that
 * hands them to the command bridge, as small as the seam it is. It never
 * reads the bridge global - it dispatches on the bridge it is handed -
 * and slate-isolation.test.js names it as one of the five files that may
 * say `.dispatch(`. Weights and geometry belong to the physical hoppers,
 * so every positional command goes to the Current recipe; the contract
 * refuses any other.
 *
 * Nothing is computed here: Smart Hoppers' computed weight is the
 * application's (app.js smartHopperComputation), read off the snapshot.
 * The words are the floor UI's, shared with Station's Weights face.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynSlateWeightActions = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const COMMAND = Object.freeze({
    weight: "setHopperWeight",
    weights: "setHopperWeights",
    geometry: "setHopperGeometry",
    geometries: "setHopperGeometries",
    circumference: "setHopperCircumference",
    smart: "setSmartHoppers"
  });
  const KIND = Object.freeze({ weight: "weight", geometry: "geometry", circumference: "circumference" });
  const RECIPE = "current";

  /* The measure a line takes, by its geometry mode: which field, which
   * unit, which dimension the command names. */
  const MEASURE = Object.freeze({
    cylindrical: Object.freeze({ dimension: "height", unit: "in", unitWord: "inches", noun: "usable height", field: "usableHeight" }),
    volume: Object.freeze({ dimension: "volume", unit: "gal", unitWord: "gallons", noun: "usable volume", field: "usableGallons" })
  });
  const SMART_ON_TEXT = "Weights are computed from each hopper's geometry and its resin's measured bulk density; the entered weight stands where nothing can be computed.";
  const SMART_OFF_TEXT = "Weights are the entered receiver weights.";
  const SMART_UNAVAILABLE_TEXT = "Connect this desktop to an identified line to use Smart Hoppers.";

  /* Slate's read-only promise (slate-display.js): with it on, nothing is
   * offered, whatever the bridge would answer. */
  const READ_ONLY_REASON = "Slate is read-only on this line. Turn Read-only off in Settings to make changes.";
  const NO_BRIDGE = "No application is connected to Slate commands.";

  /* ---- Reading ---- */

  /* Smart Hoppers as the resolved state carries it (slate-source.js
   * smartHoppersFrom); at rest when it carries none. */
  function smartFrom(resolved) {
    const raw = resolved && resolved.smartHoppers && typeof resolved.smartHoppers === "object" ? resolved.smartHoppers : {};
    return Object.freeze({
      enabled: raw.enabled === true,
      geometryMode: raw.geometryMode === "cylindrical" || raw.geometryMode === "volume" ? raw.geometryMode : null,
      circumference: Number.isFinite(raw.circumference) && raw.circumference > 0 ? raw.circumference : 0
    });
  }

  function measureFor(smart) {
    return smart && smart.geometryMode ? MEASURE[smart.geometryMode] : null;
  }

  /* The shape of the section: which fields a row carries. A change of
   * shape rebuilds the rows; anything else is patched in place. */
  function shapeOf(smart) {
    return smart && smart.enabled && smart.geometryMode ? `smart:${smart.geometryMode}` : "off";
  }

  /* A value as a field shows it: the number as entered, blank for none. */
  function fieldText(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? String(number) : "";
  }

  function formatPounds(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.round(number).toLocaleString("en-US") : "—";
  }

  /* ---- Abilities ---- */

  function connected(commands) {
    return !!(commands && typeof commands.isAvailable === "function" && commands.isAvailable());
  }

  function offered(commands) {
    const usable = connected(commands) && typeof commands.dispatch === "function" && typeof commands.capabilities === "function";
    const list = usable ? commands.capabilities() : [];
    return Array.isArray(list) ? list : [];
  }

  /* Which controls the bridge offers. Read-only withholds everything. */
  function abilities(commands, options) {
    const readOnly = !!(options && options.readOnly);
    const list = readOnly ? [] : offered(commands);
    const able = {};
    for (const key of Object.keys(COMMAND)) able[key] = list.includes(COMMAND[key]);
    return Object.freeze(able);
  }

  function reason(commands, control, options) {
    if (options && options.readOnly) return READ_ONLY_REASON;
    if (!connected(commands)) return "no application is connected to Slate commands.";
    return `the application does not offer ${COMMAND[control] || "this"} from Slate.`;
  }

  /* The switch needs the command and an identified line (a geometry mode). */
  function canToggleSmart(commands, smart, options) {
    return abilities(commands, options).smart && !!(smart && smart.geometryMode);
  }

  function smartReason(commands, smart, options) {
    if (options && options.readOnly) return READ_ONLY_REASON;
    if (!connected(commands)) return "no application is connected to Slate commands.";
    if (!abilities(commands, options).smart) return `the application does not offer ${COMMAND.smart} from Slate.`;
    if (!(smart && smart.geometryMode)) return SMART_UNAVAILABLE_TEXT;
    return "";
  }

  /* ---- Writing ---- */

  function unavailable(message) {
    return Object.freeze({ ok: false, code: "unavailable", message: message || NO_BRIDGE });
  }

  function send(commands, command, args) {
    if (!commands || typeof commands.dispatch !== "function") return unavailable();
    return commands.dispatch(command, args);
  }

  /* A hopper's receiver weight, in pounds as typed; the contract
   * normalises the text and refuses what it cannot read. 0 clears. */
  function setWeight(commands, layer, index, weight) {
    return send(commands, COMMAND.weight, { recipe: RECIPE, layer, index, weight });
  }

  /* A hopper's usable height (inches) or usable volume (gallons), by the
   * dimension the line measures. 0 clears. */
  function setGeometry(commands, layer, index, dimension, value) {
    return send(commands, COMMAND.geometry, { recipe: RECIPE, layer, index, dimension, value });
  }

  /* The bulk edit's Apply: several hoppers' weights in ONE request,
   * [{ layer, index, weight }] with each weight as typed (blank is 0). */
  function setWeights(commands, entries) {
    return send(commands, COMMAND.weights, { recipe: RECIPE, weights: entries });
  }

  /* The bulk edit's geometry, the same way: [{ layer, index, dimension, value }]. */
  function setGeometries(commands, entries) {
    return send(commands, COMMAND.geometries, { recipe: RECIPE, geometries: entries });
  }

  /* The line's shared circumference, in inches; no position, no recipe. */
  function setCircumference(commands, circumference) {
    return send(commands, COMMAND.circumference, { circumference });
  }

  /* This device's Smart Hoppers switch. */
  function setSmart(commands, enabled) {
    return send(commands, COMMAND.smart, { enabled: !!enabled });
  }

  return Object.freeze({
    COMMAND, KIND, RECIPE, MEASURE, SMART_ON_TEXT, SMART_OFF_TEXT, SMART_UNAVAILABLE_TEXT, READ_ONLY_REASON, NO_BRIDGE,
    smartFrom, measureFor, shapeOf, fieldText, formatPounds,
    abilities, reason, canToggleSmart, smartReason,
    setWeight, setWeights, setGeometry, setGeometries, setCircumference, setSmart
  });
});
