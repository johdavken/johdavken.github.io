/* Station command contract - what a Station write request IS, before anything
 * is written.
 *
 * WHY THIS FILE EXISTS ON ITS OWN
 *
 * The state bridge (station-state-bridge.js) is a one-way view: the
 * application publishes, Station reads. Editing needs the other direction,
 * and the first question is not "how do we write" but "what is a valid
 * request". That question has one answer, and it is answered here, once, in
 * a module with no DOM, no state and no side effects - so the application
 * can validate a request before it touches anything, Station can build one
 * and read the answer, and both are testing the same rules in Node.
 *
 * WHAT IT DEFINES
 *
 *   COMMANDS       the vocabulary: twelve names, nothing else is a command
 *   ARGUMENTS      which arguments each command takes
 *   normalize*     one normalizer per argument, in the terms the application
 *                  already uses (its own resin-name trimming, its own
 *                  hookup-source rules, its own sync-gate limits)
 *   normalizeArguments(command, args)
 *                  the whole request checked and rebuilt - the only thing an
 *                  executor should ever be handed
 *   success / failure
 *                  the two result shapes, frozen, never thrown
 *   ERROR_CODES    the error vocabulary, declared in full now even though
 *                  most of it can only be produced by an executor that does
 *                  not exist yet
 *
 * WHAT IT DOES NOT DO
 *
 * Execute. There is no state here to execute against, and nothing in this
 * file knows what a layer holds. A request that passes this file is well
 * formed; whether it is POSSIBLE (does that layer exist, is that hopper H1,
 * would the blend exceed 100) is the executor's question, asked against
 * live state, and answered with the same result shapes.
 *
 * ADDRESSING
 *
 * Every command names its recipe - "current" or "next" - explicitly and
 * without a default. Station must never inherit which recipe the hidden
 * Recipe editor happens to be showing. Layers are named as the recipe names
 * them ("A".."E") and hoppers by physical index (0..5), the same
 * "<layer>:<index>" the hookup-source store and the state bridge use. A
 * command that names two positions - moveHopper - names the one it acts
 * on as every other command does (layer, index) and the other as
 * toLayer, toIndex: hopper-rearrangement.js's own source and target.
 */
(function (root, factory) {
  const hookups = typeof require === "function"
    ? require("./hookup-sources.js")
    : (root && root.PolynHookupSources);
  const api = factory(hookups);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynStationCommandContract = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (hookups) {
  "use strict";

  /* --------------------------------------------------------------------
   *   Vocabulary
   * ------------------------------------------------------------------ */

  const COMMANDS = Object.freeze([
    "setHopperResin",   // { recipe, layer, index, resin }   resin "" clears the resin only
    "setHopperBlend",   // { recipe, layer, index, pct }
    "setLayerShare",    // { recipe, layer, pct }
    "clearHopper",      // { recipe, layer, index }
    "setSource",        // { recipe, layer, index, source } source "" removes the label
    "moveHopper",       // { recipe, layer, index, toLayer, toIndex }
                        //   the assignment (resin, blend) at layer:index moves to
                        //   toLayer:toIndex; an occupied destination swaps back
    "setHopperTracking",// { recipe, layer, index, track }   track true/false
    "setPumpOff",       // { recipe, layer, index, pumpOff } pumpOff true/false
    "undo",             // { recipe }
    "redo",             // { recipe }
    "setLineRate",      // { lineRate }  the line's output in lb/hr; 0 clears it
    "setChangeover"     // { at }        the changeover as an absolute epoch-ms
                        //   timestamp, or null to clear it
  ]);

  /* The two runtime commands. Tracking and pump-off are operational state
   * of the running job - the Timeline's, not the recipe's - and the planned
   * recipe structurally cannot carry them (next-recipe.js: a recipe payload
   * has no track or pumpOff). So these name their recipe like every other
   * command, and the only recipe they may name is "current". Refused here,
   * before any executor sees the request, so a Station view addressing
   * Next can never turn a plan into something that tracks. */
  const RUNTIME_COMMANDS = Object.freeze(["setHopperTracking", "setPumpOff"]);

  /* The two job commands. Line output and the changeover deadline are
   * operational state of the running job as a whole - neither belongs to a
   * recipe, a layer or a hopper - so these name no recipe and no position.
   * The changeover is stated as an absolute instant (epoch milliseconds):
   * the application keeps it as the clock time it already stores and
   * synchronizes, and derives that from the instant; a later producer (the
   * Changeover Calculator) states the same kind of value. */
  const JOB_COMMANDS = Object.freeze(["setLineRate", "setChangeover"]);

  const RECIPES = Object.freeze(["current", "next"]);

  const ARGUMENTS = Object.freeze({
    setHopperResin: Object.freeze(["recipe", "layer", "index", "resin"]),
    setHopperBlend: Object.freeze(["recipe", "layer", "index", "pct"]),
    setLayerShare: Object.freeze(["recipe", "layer", "pct"]),
    clearHopper: Object.freeze(["recipe", "layer", "index"]),
    setSource: Object.freeze(["recipe", "layer", "index", "source"]),
    moveHopper: Object.freeze(["recipe", "layer", "index", "toLayer", "toIndex"]),
    setHopperTracking: Object.freeze(["recipe", "layer", "index", "track"]),
    setPumpOff: Object.freeze(["recipe", "layer", "index", "pumpOff"]),
    undo: Object.freeze(["recipe"]),
    redo: Object.freeze(["recipe"]),
    setLineRate: Object.freeze(["lineRate"]),
    setChangeover: Object.freeze(["at"])
  });

  /* The error vocabulary, complete now. The first three and the last are
   * transport-level; the rest are what an executor says about live state.
   * Declared in full so Station can be written against the whole set before
   * an executor exists. */
  const ERROR_CODES = Object.freeze([
    "unavailable",      // no producer is connected, or it lacks this command
    "rearranging",      // the Recipe editor is in hopper-rearrangement mode
    "busy",             // the application is applying a remote change
    "unknown_command",
    "bad_argument",     // carries `field`
    "unknown_layer",
    "unknown_hopper",   // carries `field`
    "h1_derived",       // H1's percentage is computed, never set
    "out_of_range",     // a finite value outside its range - a percentage past
                        //   0..100, a negative output, a changeover already past
                        //   or too far away to store; carries `field`
    "blend_total",      // H2-H6 would exceed 100; carries `total`
    "no_resin",         // a source needs a resin in the hopper
    "empty_hopper",     // a move needs a resin or a share in the hopper it moves
    "nothing_to_undo",
    "internal"          // the producer threw or answered with something malformed
  ]);

  /* Neutral defaults. The application may pass its own operator-facing
   * wording for any failure it produces; these are what a failure says when
   * nobody had anything better to say. */
  const MESSAGES = Object.freeze({
    unavailable: "Station commands are not available.",
    rearranging: "Hoppers are being rearranged; finish or cancel that first.",
    busy: "A change from another device is being applied; try again.",
    unknown_command: "That is not a Station command.",
    bad_argument: "The request is malformed.",
    unknown_layer: "That layer is not part of the recipe.",
    unknown_hopper: "That hopper is not part of the layer.",
    h1_derived: "Hopper 1's percentage is calculated from hoppers 2-6.",
    out_of_range: "The percentage must be between 0 and 100.",
    blend_total: "Hopper percentages 2-6 cannot total more than 100%.",
    no_resin: "Assign a resin to the hopper before naming its source.",
    empty_hopper: "The hopper has no resin or share to move.",
    nothing_to_undo: "There is nothing to undo.",
    internal: "The command could not be carried out."
  });

  /* The same bounds the application enforces. Six hoppers per layer is the
   * recipe schema's constant; 100 characters is the active-job sync gate's
   * limit on a resin name (validation.js), applied here so a value can
   * never be accepted locally and then refused by sync. */
  const HOPPERS_PER_LAYER = 6;
  const MAX_RESIN_LENGTH = 100;
  const MAX_SOURCE_LENGTH = hookups && Number.isInteger(hookups.MAX_SOURCE_LENGTH) ? hookups.MAX_SOURCE_LENGTH : 24;

  /* --------------------------------------------------------------------
   *   Results
   * ------------------------------------------------------------------ */

  function isPlainObject(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }

  /**
   * A successful result. `snapshot` is expected to be the state bridge's own
   * frozen snapshot at `revision`; this constructor does not clone it, so
   * the caller holds the same object the next bridge notification carries.
   */
  function success(fields) {
    const f = isPlainObject(fields) ? fields : {};
    return Object.freeze({
      ok: true,
      changed: !!f.changed,
      revision: Number.isInteger(f.revision) ? f.revision : null,
      persisted: !!f.persisted,
      snapshot: isPlainObject(f.snapshot) ? f.snapshot : null
    });
  }

  /**
   * A failed result: a value, never a throw. An unknown code becomes
   * "internal" rather than passing through, so the vocabulary stays closed.
   * `field` and `total` are carried only when given.
   */
  function failure(code, extra) {
    const known = ERROR_CODES.includes(code) ? code : "internal";
    const e = isPlainObject(extra) ? extra : {};
    const out = {
      ok: false,
      code: known,
      message: typeof e.message === "string" && e.message ? e.message : MESSAGES[known]
    };
    if (typeof e.field === "string" && e.field) out.field = e.field;
    if (Number.isFinite(e.total)) out.total = e.total;
    return Object.freeze(out);
  }

  /** Whether a value has one of the two result shapes. */
  function isResult(value) {
    if (!isPlainObject(value)) return false;
    if (value.ok === true) {
      return typeof value.changed === "boolean"
        && (value.revision === null || Number.isInteger(value.revision))
        && typeof value.persisted === "boolean"
        && (value.snapshot === null || isPlainObject(value.snapshot));
    }
    if (value.ok === false) {
      return ERROR_CODES.includes(value.code) && typeof value.message === "string";
    }
    return false;
  }

  /* --------------------------------------------------------------------
   *   Argument normalizers
   * ------------------------------------------------------------------
   * Each answers { ok: true, value } or { ok: false, code, message }, and
   * never throws. The codes are the ones an executor would use for the same
   * fault, so the two layers speak one language. */

  function normalizeRecipe(value) {
    if (RECIPES.includes(value)) return { ok: true, value };
    return { ok: false, code: "bad_argument", message: 'The recipe must be "current" or "next".' };
  }

  /* A layer name as the recipe names it: a letter, optionally followed by a
   * few more identifier characters. Whether it exists is the executor's. */
  const LAYER_SHAPE = /^[A-Za-z][A-Za-z0-9_-]{0,15}$/;

  function normalizeLayer(value) {
    const text = typeof value === "string" ? value.trim() : "";
    if (text && LAYER_SHAPE.test(text)) return { ok: true, value: text };
    return { ok: false, code: "bad_argument", message: "The layer must be named." };
  }

  function normalizeIndex(value) {
    const number = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
    if (!Number.isInteger(number)) {
      return { ok: false, code: "bad_argument", message: "The hopper index must be a whole number." };
    }
    if (number < 0 || number >= HOPPERS_PER_LAYER) {
      return { ok: false, code: "unknown_hopper", message: `The hopper index must be 0 to ${HOPPERS_PER_LAYER - 1}.` };
    }
    return { ok: true, value: number };
  }

  /* Finite and 0..100 - the rule validation.validatePercentage applies to
   * every percentage field, without that function's input-field parsing
   * (an empty string is not a percentage here; it is a missing one). */
  function normalizePercentage(value) {
    const number = typeof value === "string" && value.trim() !== "" ? Number(value.replace(/,/g, "")) : value;
    if (typeof number !== "number" || !Number.isFinite(number)) {
      return { ok: false, code: "bad_argument", message: "The percentage must be a number." };
    }
    if (number < 0 || number > 100) {
      return { ok: false, code: "out_of_range", message: MESSAGES.out_of_range };
    }
    return { ok: true, value: number };
  }

  /* The application's own normName: trim and collapse whitespace, nothing
   * else - a resin code is stored as typed, and no catalog check is made,
   * by design. Empty is allowed: it means "no resin". */
  function normalizeResin(value) {
    if (value === null || value === undefined) return { ok: true, value: "" };
    if (typeof value !== "string") {
      return { ok: false, code: "bad_argument", message: "The resin must be text." };
    }
    const text = value.trim().replace(/\s+/g, " ");
    if (text.length > MAX_RESIN_LENGTH) {
      return { ok: false, code: "bad_argument", message: `The resin name is longer than ${MAX_RESIN_LENGTH} characters.` };
    }
    return { ok: true, value: text };
  }

  /* hookup-sources' own rule, applied by that module: uppercase, a small
   * character set, capped. Empty means "remove the label". */
  function normalizeSource(value) {
    if (value === null || value === undefined) return { ok: true, value: "" };
    if (typeof value !== "string") {
      return { ok: false, code: "bad_argument", message: "The source must be text." };
    }
    if (!hookups || typeof hookups.normalizeSource !== "function") {
      return { ok: false, code: "internal", message: "Source labels cannot be normalized here." };
    }
    return { ok: true, value: hookups.normalizeSource(value) };
  }

  /* A runtime flag: on or off, said as a boolean and nothing else. The
   * grid's clock button and the Timeline's I/O toggle flip a boolean on the
   * hopper; a command states the value it wants, so two devices toggling
   * at once land on a state rather than on a parity. */
  function normalizeFlag(value) {
    if (value === true || value === false) return { ok: true, value };
    return { ok: false, code: "bad_argument", message: "The state must be true or false." };
  }

  /* The line's output, in lb/hr: the same rule the application's own Output
   * field applies (validation.validateNumber with min 0) - finite and not
   * negative. Zero is allowed and means "not set", which is how the
   * application reads a zero line rate everywhere it shows one. */
  function normalizeRate(value) {
    const number = typeof value === "string" && value.trim() !== "" ? Number(value.replace(/,/g, "")) : value;
    if (typeof number !== "number" || !Number.isFinite(number)) {
      return { ok: false, code: "bad_argument", message: "The output must be a number of pounds per hour." };
    }
    if (number < 0) {
      return { ok: false, code: "out_of_range", message: "The output cannot be less than 0." };
    }
    return { ok: true, value: number };
  }

  /* An absolute instant as epoch milliseconds, or null to clear. Whether
   * the instant is in the past, or further away than the application can
   * store, is the executor's question: it needs the clock. */
  function normalizeTimestamp(value) {
    if (value === null || value === undefined || value === "") return { ok: true, value: null };
    const number = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
    if (typeof number !== "number" || !Number.isFinite(number) || number <= 0) {
      return { ok: false, code: "bad_argument", message: "The changeover must be a timestamp in milliseconds, or null to clear it." };
    }
    return { ok: true, value: Math.round(number) };
  }

  const NORMALIZERS = Object.freeze({
    recipe: normalizeRecipe,
    layer: normalizeLayer,
    index: normalizeIndex,
    pct: normalizePercentage,
    resin: normalizeResin,
    source: normalizeSource,
    toLayer: normalizeLayer,
    toIndex: normalizeIndex,
    track: normalizeFlag,
    pumpOff: normalizeFlag,
    lineRate: normalizeRate,
    at: normalizeTimestamp
  });

  /**
   * The whole request, checked and rebuilt.
   *
   * Returns { ok: true, command, args } with `args` holding exactly the
   * command's arguments, normalized and frozen - anything else that was
   * passed is dropped, so an executor never sees a field it did not ask
   * for. Or a failure: unknown_command, or the first argument's own code
   * with `field` naming it. Never throws, whatever it is given.
   */
  function normalizeArguments(command, args) {
    if (typeof command !== "string" || !COMMANDS.includes(command)) {
      return failure("unknown_command", { message: `"${String(command)}" is not a Station command.` });
    }
    const given = isPlainObject(args) ? args : {};
    const out = {};
    for (const field of ARGUMENTS[command]) {
      const result = NORMALIZERS[field](given[field]);
      if (!result.ok) return failure(result.code, { field, message: result.message });
      out[field] = result.value;
    }
    if (RUNTIME_COMMANDS.includes(command) && out.recipe !== "current") {
      return failure("bad_argument", { field: "recipe", message: "Tracking and pump-off belong to the running job: the recipe must be \"current\"." });
    }
    return Object.freeze({ ok: true, command, args: Object.freeze(out) });
  }

  return Object.freeze({
    COMMANDS,
    RUNTIME_COMMANDS,
    JOB_COMMANDS,
    RECIPES,
    ARGUMENTS,
    ERROR_CODES,
    MESSAGES,
    HOPPERS_PER_LAYER,
    MAX_RESIN_LENGTH,
    MAX_SOURCE_LENGTH,
    normalizeRecipe,
    normalizeLayer,
    normalizeIndex,
    normalizePercentage,
    normalizeResin,
    normalizeSource,
    normalizeFlag,
    normalizeRate,
    normalizeTimestamp,
    normalizeArguments,
    success,
    failure,
    isResult
  });
});
