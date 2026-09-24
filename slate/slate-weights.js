/* The Weights section: every hopper's receiver weight, Smart Hoppers, and
 * the line's shared Weight Profiles.
 *
 * WHAT IT SHOWS
 *
 * The line's layers as the Recipe shows them, one row per hopper: its
 * badge, its resin (read-only here - the Recipe owns assignments), and a
 * field for the receiver weight in pounds. With Smart Hoppers on, each row
 * also carries the geometry the line measures (usable height in inches on
 * a cylindrical line, usable volume in gallons on a volume line) and the
 * weight the application computed from it and the resin's measured bulk
 * density - or why it computed none. The bar holds the Smart Hoppers
 * switch and, on a cylindrical line, the circumference every hopper
 * shares. Under the layers, the workspace's saved Weight Profiles: the
 * Recipe Book's list and detail, over the other bridge.
 *
 * WHERE IT WRITES
 *
 * Through two seams and nowhere else: slate-weight-actions.js dispatches
 * the four commands (weight, geometry, circumference, the switch);
 * slate-profile-actions.js asks the weight-profiles bridge for the
 * profile actions. Nothing is computed here - Smart Hoppers' figure is
 * the application's, read off the snapshot - and nothing is stored.
 *
 * THE FIELDS
 *
 * The rules are Station's Weights face: focus opens a draft, Enter or blur
 * commits it, Escape restores the line's value; an unchanged draft sends
 * nothing; blank clears (0); a refusal keeps the draft and shows the
 * application's words. A publish never writes into the field being
 * edited: when the line's value moves under an open draft, the row says
 * so and the draft stands. A change of shape - the switch flipped, the
 * line's measure changed - rebuilds the rows; anything else is patched.
 */
(function (root, factory) {
  const line = typeof require === "function"
    ? require("./slate-line.js")
    : (root && root.PolynSlateLine);
  const actions = typeof require === "function"
    ? require("./slate-weight-actions.js")
    : (root && root.PolynSlateWeightActions);
  const profileActions = typeof require === "function"
    ? require("./slate-profile-actions.js")
    : (root && root.PolynSlateProfileActions);
  const api = factory(line, actions, profileActions);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynSlateWeights = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (lineModule, actionsModule, profilesModule) {
  "use strict";

  const TITLE = "Weights";
  const EMPTY = "—";
  const SELECT_HINT = "Select a profile to load it, update it from the line's current weights, or manage it.";
  const NOTHING_CHANGES = "nothing would change";
  const ABANDONED = "The line changed; your unapplied entry was dropped.";
  const NO_LINE = "No line to weigh.";
  const KIND = actionsModule.KIND;

  function element(doc, name, className, attributes) {
    const node = doc.createElement(name);
    if (className) node.setAttribute("class", className);
    if (attributes) for (const key of Object.keys(attributes)) node.setAttribute(key, String(attributes[key]));
    return node;
  }

  function text(doc, name, className, value, attributes) {
    const node = element(doc, name, className, attributes);
    node.textContent = value;
    return node;
  }

  function show(node, on) {
    if (on) node.removeAttribute("hidden");
    else node.setAttribute("hidden", "");
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function capitalize(words) {
    return words ? words.charAt(0).toUpperCase() + words.slice(1) : words;
  }

  function formatWhen(iso) {
    if (!iso) return "";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    try {
      return date.toLocaleDateString([], { month: "short", day: "numeric" });
    } catch (error) {
      return date.toISOString().slice(0, 10);
    }
  }

  /* ----------------------------------------------------------------------
   *   Words, pure
   * -------------------------------------------------------------------- */

  /** The bar's line: the line, its hoppers, the switch's state, the source. */
  function subtitleFor(resolved, smart) {
    const model = resolved && resolved.line;
    if (!model) return NO_LINE;
    const state = !smart || !smart.geometryMode ? "Smart Hoppers unavailable" : (smart.enabled ? "Smart Hoppers on" : "Smart Hoppers off");
    return `${lineModule.lineTitle(model)} · ${model.hopperCount} hopper${model.hopperCount === 1 ? "" : "s"} · ${state} · ${resolved.label || ""}`.replace(/ · $/, "");
  }

  /** What the switch's line says. */
  function smartText(smart) {
    if (!smart || !smart.geometryMode) return actionsModule.SMART_UNAVAILABLE_TEXT;
    return smart.enabled ? actionsModule.SMART_ON_TEXT : actionsModule.SMART_OFF_TEXT;
  }

  /** Why nothing is computed for a hopper, in Station's words. */
  function computedHint(runtime, smart, measure) {
    const state = runtime || {};
    if (!state.resinName) return "no resin";
    const geometry = measure ? Number(state[measure.field]) : 0;
    if (!(geometry > 0)) return `no ${measure ? measure.noun.replace("usable ", "") : "geometry"}`;
    if (measure && measure.dimension === "height" && !(smart && smart.circumference > 0)) return "no circumference";
    return "no bulk density";
  }

  /** One line per profile row: its layers, when it was updated, geometry. */
  function rowMeta(profile) {
    const layers = Array.isArray(profile.layers) ? profile.layers.length : 0;
    const parts = [`${layers} layer${layers === 1 ? "" : "s"}`];
    const when = formatWhen(profile.updatedAt);
    if (when) parts.push(when);
    if (profile.hasGeometry) parts.push("geometry");
    return parts.join(" · ");
  }

  /** What the list says when it has nothing to list. */
  function emptyText(book, connected) {
    if (!connected) return "No application is connected to Slate: weight profiles are not available here.";
    if (!book || !book.assigned) return "This device is not on a production line. Connect it through RT Sync to see the line's weight profiles.";
    if (book.refreshing && !book.count) return "Reading the line's weight profiles…";
    return "No weight profiles are saved for this line yet. Save current weights adds the line's receiver weights.";
  }

  function profilesSubtitle(book, connected) {
    if (!connected) return "Not connected";
    if (!book || !book.assigned) return "No line";
    const name = (book.workspace && book.workspace.displayName) || "Connected line";
    return `${name} · ${book.count} saved`;
  }

  /**
   * Whether a profile fits the line, by the rules the application applies
   * before it touches anything: the line type and the layer names. Pure.
   */
  function compatibility(profile, model) {
    if (!profile) return { ok: false, message: "" };
    if (!model || !model.line || !Array.isArray(model.layers)) {
      return { ok: false, message: "No line is shown, so this profile cannot be loaded here." };
    }
    const lineType = Number(profile.lineType) || 0;
    const layerCount = Number(model.line.layerCount) || 0;
    if (lineType !== layerCount) {
      return { ok: false, message: `This profile is for a ${lineType}-layer line; this line runs ${layerCount}. It cannot be loaded here.` };
    }
    const saved = (Array.isArray(profile.layers) ? profile.layers : []).map(layer => String(layer.name || "")).sort();
    const shown = model.layers.map(layer => String(layer.id)).sort();
    if (saved.join(",") !== shown.join(",")) {
      return { ok: false, message: `This profile's layers (${saved.join(", ") || "none"}) are not this line's (${shown.join(", ")}). It cannot be loaded here.` };
    }
    return { ok: true, message: "" };
  }

  /**
   * What loading a profile would change: the saved weight against each
   * hopper's ENTERED weight (a profile carries entered weights), over the
   * hoppers the line has. Null without a line.
   */
  function previewFor(profile, resolved) {
    const model = resolved && resolved.line;
    if (!profile || !model) return null;
    const hoppers = resolved.hopperState || {};
    let changed = 0;
    let total = 0;
    for (const layer of model.layers) {
      const saved = (Array.isArray(profile.layers) ? profile.layers : []).find(one => String(one.name) === String(layer.id));
      const weights = saved && Array.isArray(saved.weights) ? saved.weights : [];
      for (let index = 0; index < layer.hopperCount; index += 1) {
        total += 1;
        const next = Number(weights[index]);
        const current = hoppers[`${layer.id}:${index}`] ? Number(hoppers[`${layer.id}:${index}`].weight) : 0;
        if ((Number.isFinite(next) && next > 0 ? next : 0) !== (Number.isFinite(current) && current > 0 ? current : 0)) changed += 1;
      }
    }
    return { changed, total, text: changed === 0 ? NOTHING_CHANGES : `${changed} of ${total} hopper weight${total === 1 ? "" : "s"} change${changed === 1 ? "s" : ""}` };
  }

  /* ----------------------------------------------------------------------
   *   The section
   * -------------------------------------------------------------------- */

  /**
   * @param {Document} doc
   * @param {object} ctx
   * @param {function} ctx.commands         () -> the command bridge, or null
   * @param {object|null} ctx.weightProfiles  the weight-profiles bridge
   * @param {function} [ctx.readOnly]
   * @param {function} [ctx.onCommitted]
   * @param {function} [ctx.say]
   */
  function create(doc, ctx) {
    const settings = ctx || {};
    const commandsFor = typeof settings.commands === "function" ? settings.commands : () => null;
    const profiles = settings.weightProfiles || null;
    const readOnly = typeof settings.readOnly === "function" ? settings.readOnly : () => false;
    const onCommitted = typeof settings.onCommitted === "function" ? settings.onCommitted : () => {};
    const say = typeof settings.say === "function" ? settings.say : () => {};
    const guard = () => ({ readOnly: !!readOnly() });
    const commands = () => commandsFor();

    const rootEl = element(doc, "div", "slate-weights", { "data-shape": "off" });

    /* ---- The bar: subtitle, the switch, the circumference ---- */
    const bar = element(doc, "div", "slate-section__bar");
    const subtitle = text(doc, "p", "slate-section__subtitle", "");
    bar.appendChild(subtitle);
    const circumferenceWrap = element(doc, "label", "slate-weights__circumference", { hidden: "" });
    circumferenceWrap.appendChild(text(doc, "span", "slate-weights__circumference-label", "Circumference"));
    const circumferenceInput = element(doc, "input", "slate-weights__field", {
      type: "text", inputmode: "decimal", autocomplete: "off", spellcheck: "false", placeholder: "0",
      "data-kind": KIND.circumference, "data-key": "circumference", "aria-label": "Hopper circumference, inches, shared by every hopper on the line"
    });
    circumferenceWrap.appendChild(circumferenceInput);
    circumferenceWrap.appendChild(text(doc, "span", "slate-weights__unit", "in"));
    circumferenceWrap.appendChild(text(doc, "span", "slate-weights__shared", "shared by every hopper"));
    bar.appendChild(circumferenceWrap);
    const smartSwitch = text(doc, "button", "slate-switch slate-weights__smart", "Smart Hoppers", { type: "button", role: "switch", "aria-checked": "false", "data-slate-smart": "", "data-able": "false" });
    bar.appendChild(smartSwitch);
    rootEl.appendChild(bar);

    const smartLine = text(doc, "p", "slate-weights__smart-text", "");
    rootEl.appendChild(smartLine);
    const note = element(doc, "p", "slate-weights__note", { role: "status", hidden: "" });
    rootEl.appendChild(note);

    // No heading row over the layers: each field carries its unit and its
    // full name as its label, and the row of labels only repeated them.
    const layersEl = element(doc, "div", "slate-weights__layers");
    rootEl.appendChild(layersEl);
    // A phone leaves out the hoppers empty in both recipes (weights.css);
    // this brings them back - a weight is the equipment's, empty or not.
    const showEmpty = text(doc, "button", "slate-weights__show-empty", "", { type: "button", hidden: "", "aria-pressed": "false" });
    rootEl.appendChild(showEmpty);
    showEmpty.addEventListener("click", () => { state.showEmpty = !state.showEmpty; paintRows(true); });
    const emptyLine = text(doc, "p", "slate-weights__empty", NO_LINE, { hidden: "" });
    rootEl.appendChild(emptyLine);

    /* ---- The profiles: the Book's vocabulary over the other bridge ---- */
    const book = element(doc, "div", "slate-book slate-weights__profiles");
    const bookBar = element(doc, "div", "slate-section__bar");
    bookBar.appendChild(text(doc, "h2", "slate-weights__profiles-title", "Weight Profiles"));
    const bookSubtitle = text(doc, "p", "slate-section__subtitle", "");
    bookBar.appendChild(bookSubtitle);
    const barButtons = {};
    for (const [action, label, className] of [["save", "Save current weights", "slate-book__action--primary"], ["refresh", "Refresh", "slate-book__action--quiet"]]) {
      const button = text(doc, "button", `slate-book__action ${className}`.trim(), label, { type: "button", "data-book-action": action, "data-able": "false" });
      barButtons[action] = button;
      bookBar.appendChild(button);
    }
    book.appendChild(bookBar);
    const entry = element(doc, "div", "slate-book__entry", { hidden: "" });
    const entryLabel = text(doc, "span", "slate-book__entry-label", "");
    const nameInput = element(doc, "input", "slate-book__name", { type: "text", "aria-label": "Profile name", maxlength: "120", autocomplete: "off", enterkeyhint: "done" });
    const entryConfirm = text(doc, "button", "slate-book__action slate-book__action--primary", "Save", { type: "button", "data-book-action": "confirm-entry" });
    const entryReplace = text(doc, "button", "slate-book__action", "Replace existing", { type: "button", "data-book-action": "replace", hidden: "" });
    const entryCancel = text(doc, "button", "slate-book__action slate-book__action--quiet", "Cancel", { type: "button", "data-book-action": "cancel-entry" });
    for (const node of [entryLabel, nameInput, entryConfirm, entryReplace, entryCancel]) entry.appendChild(node);
    book.appendChild(entry);
    const bookNote = element(doc, "p", "slate-book__note", { role: "status", hidden: "" });
    book.appendChild(bookNote);
    const bookColumns = element(doc, "div", "slate-book__columns");
    const list = element(doc, "ol", "slate-book__list", { "aria-label": "Saved weight profiles" });
    const detail = element(doc, "div", "slate-book__detail", { "aria-live": "polite" });
    bookColumns.appendChild(list);
    bookColumns.appendChild(detail);
    book.appendChild(bookColumns);
    rootEl.appendChild(book);

    const state = {
      resolved: null, smart: actionsModule.smartFrom(null), shape: null, measure: null, built: false,
      editing: null, committing: null, rows: new Map(), showEmpty: false,
      book: null, selectedId: null, entry: null, confirm: null, moreOpen: false, pending: null, duplicate: null
    };

    /* ---- Reading ---- */

    const runtimeOf = key => (state.resolved && state.resolved.hopperState && state.resolved.hopperState[key]) || {};
    const smartMeasure = () => (state.shape && state.shape !== "off" ? state.measure : null);

    function valueOf(key, kind) {
      if (kind === KIND.circumference) return state.smart.circumference;
      const runtime = runtimeOf(key);
      if (kind === KIND.geometry) { const m = smartMeasure(); return m ? runtime[m.field] : 0; }
      return runtime.weight;
    }

    function inputFor(key, kind) {
      if (kind === KIND.circumference) return circumferenceInput;
      const row = state.rows.get(key);
      if (!row) return null;
      return kind === KIND.geometry ? row.geometryInput : row.weightInput;
    }

    function nounFor(key, kind) {
      if (kind === KIND.circumference) return "the hopper circumference";
      const row = state.rows.get(key);
      const id = row ? row.id : key;
      const m = smartMeasure();
      return kind === KIND.geometry ? `${id}'s ${m ? m.noun : "geometry"}` : `${id}'s weight`;
    }

    function unitFor(kind) {
      if (kind === KIND.weight) return "lb";
      if (kind === KIND.circumference) return "in";
      const m = smartMeasure();
      return m ? m.unit : "";
    }

    const editingIs = (key, kind) => !!(state.editing && state.editing.key === key && state.editing.kind === kind);
    const committingIs = (key, kind) => !!(state.committing && state.committing.key === key && state.committing.kind === kind);

    /* ---- Notes ---- */

    function setNote(kind, message) {
      note.textContent = message || "";
      note.classList.toggle("is-error", kind === "error");
      note.classList.toggle("is-ok", kind === "ok");
      show(note, !!message);
    }

    function setRowNote(key, message) {
      const row = state.rows.get(key);
      if (!row) return;
      row.note.textContent = message || "";
      show(row.note, !!message);
    }

    function noteFor(key, kind, message) {
      if (kind === KIND.circumference) setNote("error", message);
      else setRowNote(key, message);
    }

    /* ---- The fields ---- */

    function requestFor(key, kind, value) {
      const bridge = commands();
      if (kind === KIND.circumference) return actionsModule.setCircumference(bridge, value);
      const row = state.rows.get(key);
      if (kind === KIND.geometry) {
        const m = smartMeasure();
        return actionsModule.setGeometry(bridge, row.layer, row.index, m ? m.dimension : "height", value);
      }
      return actionsModule.setWeight(bridge, row.layer, row.index, value);
    }

    function commitField(key, kind) {
      const input = inputFor(key, kind);
      if (!input) return null;
      const draft = String(input.value || "").trim();
      const resting = actionsModule.fieldText(valueOf(key, kind));
      if (draft === resting) {
        input.removeAttribute("aria-invalid");
        return null;
      }
      const able = actionsModule.abilities(commands(), guard());
      if (!able[kind]) {
        input.setAttribute("aria-invalid", "true");
        noteFor(key, kind, `${capitalize(nounFor(key, kind))} cannot be changed here: ${actionsModule.reason(commands(), kind, guard())}`);
        return { ok: false, code: "unavailable", message: actionsModule.reason(commands(), kind, guard()) };
      }
      const result = requestFor(key, kind, draft === "" ? 0 : draft);
      if (!result || !result.ok) {
        input.setAttribute("aria-invalid", "true");
        noteFor(key, kind, (result && result.message) || `${capitalize(nounFor(key, kind))} could not be set.`);
        return result;
      }
      input.removeAttribute("aria-invalid");
      input.classList.remove("is-changed-underneath");
      noteFor(key, kind, "");
      if (result.changed) {
        state.committing = { key, kind };
        try { onCommitted(result); } finally { state.committing = null; }
        // Whether or not a publish came back through update(), the field
        // now shows the line's value and the draft starts from it.
        const after = inputFor(key, kind);
        if (after) {
          after.value = actionsModule.fieldText(valueOf(key, kind));
          if (editingIs(key, kind)) state.editing.base = after.value;
        }
      } else {
        input.value = resting;
      }
      return result;
    }

    function cancelField(key, kind) {
      const input = inputFor(key, kind);
      if (!input) return;
      const base = editingIs(key, kind) ? state.editing.base : actionsModule.fieldText(valueOf(key, kind));
      const hadDraft = String(input.value || "").trim() !== base;
      input.value = actionsModule.fieldText(valueOf(key, kind));
      if (editingIs(key, kind)) state.editing.base = input.value;
      input.removeAttribute("aria-invalid");
      input.classList.remove("is-changed-underneath");
      noteFor(key, kind, "");
      if (!hadDraft && typeof input.blur === "function") input.blur();
    }

    function markEditing(key, on) {
      const row = state.rows.get(key);
      if (row) row.row.classList.toggle("is-editing", on);
    }

    function wireField(input, key, kind) {
      // Revert, beside the field while it is edited - shown only under a
      // finger (weights.css), where Escape is out of reach and a blur
      // commits. Its press keeps the field's focus; if a blur comes anyway,
      // it reverts rather than commits.
      let reverting = false;
      const revert = text(doc, "button", "slate-weights__revert", "Revert", { type: "button", hidden: "", "data-slate-revert": kind });
      const hold = event => { reverting = true; if (event && typeof event.preventDefault === "function") event.preventDefault(); };
      revert.addEventListener("pointerdown", hold);
      revert.addEventListener("mousedown", hold);
      revert.addEventListener("click", () => {
        if (editingIs(key, kind)) {
          cancelField(key, kind);
          if (typeof input.blur === "function") input.blur();
          if (editingIs(key, kind)) { state.editing = null; markEditing(key, false); revert.setAttribute("hidden", ""); }
        }
        reverting = false;
      });
      if (input.parentNode) input.parentNode.appendChild(revert);
      // A locked field says why on a tap: its title is a mouse's only.
      input.addEventListener("click", () => {
        if (input.hasAttribute("readonly") && input.getAttribute("title")) say(input.getAttribute("title"));
      });
      input.addEventListener("focus", () => {
        if (input.hasAttribute("readonly")) return;
        state.editing = { key, kind, base: actionsModule.fieldText(valueOf(key, kind)) };
        input.classList.remove("is-changed-underneath");
        markEditing(key, true);
        revert.removeAttribute("hidden");
      });
      input.addEventListener("input", () => {
        input.removeAttribute("aria-invalid");
      });
      input.addEventListener("keydown", event => {
        if (!event) return;
        if (event.key === "Enter") {
          if (typeof event.preventDefault === "function") event.preventDefault();
          commitField(key, kind);
        } else if (event.key === "Escape") {
          if (typeof event.stopPropagation === "function") event.stopPropagation();
          if (typeof event.preventDefault === "function") event.preventDefault();
          cancelField(key, kind);
        }
      });
      input.addEventListener("blur", () => {
        if (editingIs(key, kind)) {
          if (reverting) cancelField(key, kind);
          else commitField(key, kind);
          state.editing = null;
          input.classList.remove("is-changed-underneath");
          markEditing(key, false);
        }
        revert.setAttribute("hidden", "");
      });
    }

    /* A publish: the field shows the line's value unless it is being
     * edited; then a moved value is said, never written. */
    function patchField(input, key, kind, own) {
      const canonical = actionsModule.fieldText(valueOf(key, kind));
      if (!editingIs(key, kind)) {
        if (input.value !== canonical) input.value = canonical;
        input.classList.remove("is-changed-underneath");
      } else if (committingIs(key, kind)) {
        input.value = canonical;
        state.editing.base = canonical;
        input.classList.remove("is-changed-underneath");
      } else if (canonical !== state.editing.base && !own) {
        if (!input.classList.contains("is-changed-underneath")) {
          input.classList.add("is-changed-underneath");
          const shown = kind === KIND.weight ? actionsModule.formatPounds(canonical) : (canonical || "0");
          noteFor(key, kind, `${capitalize(nounFor(key, kind))} is now ${shown} ${unitFor(kind)} in the application; what you are entering has not been applied.`);
        }
      }
    }

    /* The draft is dropped without a commit: the rows are being rebuilt,
     * or the section is leaving. */
    function abandonEdit(own) {
      const editing = state.editing;
      if (!editing) return;
      const input = inputFor(editing.key, editing.kind);
      const hadDraft = !!input && String(input.value || "").trim() !== editing.base;
      state.editing = null;
      markEditing(editing.key, false);
      if (input) {
        input.value = actionsModule.fieldText(valueOf(editing.key, editing.kind));
        input.removeAttribute("aria-invalid");
        input.classList.remove("is-changed-underneath");
        if (typeof input.blur === "function") input.blur();
      }
      noteFor(editing.key, editing.kind, "");
      if (hadDraft && !own) say(ABANDONED);
    }

    /* ---- Building the rows ---- */

    function buildRow(layer, hopper) {
      const key = `${layer.id}:${hopper.index}`;
      const m = smartMeasure();
      const row = element(doc, "div", "slate-weights__row", { "data-layer": layer.id, "data-index": String(hopper.index), "data-hopper": hopper.id, "data-key": key });
      // Its position in the layer: its column in the Grid layout.
      row.style.setProperty("--slate-hopper-slot", String(hopper.index));
      row.appendChild(text(doc, "span", "slate-weights__id", hopper.id));
      const resin = text(doc, "span", "slate-weights__resin", EMPTY);
      row.appendChild(resin);
      const weightWrap = element(doc, "span", "slate-weights__wrap");
      const weightInput = element(doc, "input", "slate-weights__field", {
        type: "text", inputmode: "decimal", autocomplete: "off", spellcheck: "false", placeholder: "0",
        "data-kind": KIND.weight, "data-key": key, "data-layer": layer.id, "data-index": String(hopper.index),
        "aria-label": `${hopper.id} receiver weight, pounds`
      });
      weightWrap.appendChild(weightInput);
      weightWrap.appendChild(text(doc, "span", "slate-weights__unit", "lb"));
      row.appendChild(weightWrap);
      wireField(weightInput, key, KIND.weight);
      let geometryInput = null;
      let computed = null;
      if (m) {
        const geometryWrap = element(doc, "span", "slate-weights__wrap slate-weights__geometry");
        geometryInput = element(doc, "input", "slate-weights__field", {
          type: "text", inputmode: "decimal", autocomplete: "off", spellcheck: "false", placeholder: "0",
          "data-kind": KIND.geometry, "data-key": key, "data-layer": layer.id, "data-index": String(hopper.index),
          "aria-label": `${hopper.id} ${m.noun}, ${m.unitWord}`
        });
        geometryWrap.appendChild(geometryInput);
        geometryWrap.appendChild(text(doc, "span", "slate-weights__unit", m.unit));
        row.appendChild(geometryWrap);
        wireField(geometryInput, key, KIND.geometry);
        computed = text(doc, "span", "slate-weights__computed", "", { "data-kind": "hint" });
        row.appendChild(computed);
      }
      const rowNote = element(doc, "p", "slate-weights__row-note", { role: "status", hidden: "" });
      row.appendChild(rowNote);
      state.rows.set(key, { row, resin, weightInput, geometryInput, computed, note: rowNote, id: hopper.id, layer: layer.id, index: hopper.index });
      return row;
    }

    function buildLayers() {
      clear(layersEl);
      state.rows.clear();
      const model = state.resolved && state.resolved.line;
      show(emptyLine, !model);
      if (!model) return;
      // How many hopper positions every layer's row has in the Grid
      // layout (components/weights.css), as the Recipe counts them.
      const positions = model.layers.reduce((most, layer) => layer.hoppers.reduce((deepest, hopper) => Math.max(deepest, hopper.index + 1), most), 1);
      layersEl.style.setProperty("--slate-hopper-rows", String(positions));
      model.layers.forEach((layer, i) => {
        const card = element(doc, "div", "slate-weights__layer", { "data-layer": layer.id, "data-role": layer.role, "data-tone": layer.tone });
        card.style.setProperty("--slate-layer-i", String(i));
        const head = element(doc, "div", "slate-weights__head");
        head.appendChild(text(doc, "span", "slate-weights__layer-name", `Layer ${layer.id}`));
        head.appendChild(text(doc, "span", "slate-weights__layer-role", layer.roleLabel));
        card.appendChild(head);
        const rows = element(doc, "div", "slate-weights__rows");
        for (const hopper of layer.hoppers) rows.appendChild(buildRow(layer, hopper));
        card.appendChild(rows);
        layersEl.appendChild(card);
      });
      state.built = true;
    }

    /* ---- Painting what the source says ---- */

    function paintComputed(entry, key) {
      if (!entry.computed) return;
      const runtime = runtimeOf(key);
      const smart = runtime.smartWeight;
      const m = smartMeasure();
      entry.row.classList.toggle("is-smart", !!smart);
      if (smart) {
        entry.computed.textContent = `✓ ${actionsModule.formatPounds(smart.value)} lb`;
        entry.computed.setAttribute("data-kind", "computed");
        entry.computed.setAttribute("title", `Computed from ${entry.id}'s ${m ? m.noun : "geometry"}${smart.resinCode ? ` and ${smart.resinCode}'s bulk density` : ""}${smart.bulkDensity ? ` (${smart.bulkDensity} lb/ft³)` : ""}. Used for the run-down instead of the entered weight.`);
        return;
      }
      const why = computedHint(runtime, state.smart, m);
      entry.computed.textContent = why;
      entry.computed.setAttribute("data-kind", "hint");
      entry.computed.setAttribute("title", `Nothing is computed for ${entry.id}: ${why}. The entered weight stands.`);
    }

    function paintRows(own) {
      const planned = !!(state.resolved && state.resolved.plan && state.resolved.plan.planned);
      const nextOf = key => (planned && state.resolved.nextHopperState && state.resolved.nextHopperState[key]) || {};
      let vacant = 0;
      for (const [key, entry] of state.rows) {
        const runtime = runtimeOf(key);
        const assigned = !!(runtime.resinName && String(runtime.resinName).trim());
        const unused = !assigned && !String(nextOf(key).resinName || "").trim();
        if (unused) vacant += 1;
        // Never a row being typed in.
        entry.row.classList.toggle("is-vacant", unused && !state.showEmpty && !(state.editing && state.editing.key === key));
        const resinText = assigned ? String(runtime.resinName) : EMPTY;
        if (entry.resin.textContent !== resinText) entry.resin.textContent = resinText;
        entry.resin.classList.toggle("is-placeholder", !assigned);
        entry.row.classList.toggle("is-empty", !assigned);
        patchField(entry.weightInput, key, KIND.weight, own);
        if (entry.geometryInput) patchField(entry.geometryInput, key, KIND.geometry, own);
        paintComputed(entry, key);
      }
      patchField(circumferenceInput, "circumference", KIND.circumference, own);
      show(showEmpty, vacant > 0);
      showEmpty.textContent = state.showEmpty ? "Hide empty hoppers" : `Show empty hoppers (${vacant})`;
      showEmpty.setAttribute("aria-pressed", state.showEmpty ? "true" : "false");
    }

    function applyAbilities() {
      const able = actionsModule.abilities(commands(), guard());
      rootEl.classList.toggle("is-readonly", !!readOnly());
      const fields = [[circumferenceInput, KIND.circumference]];
      for (const entry of state.rows.values()) {
        fields.push([entry.weightInput, KIND.weight]);
        if (entry.geometryInput) fields.push([entry.geometryInput, KIND.geometry]);
      }
      for (const [input, kind] of fields) {
        const can = !!able[kind];
        input.setAttribute("aria-disabled", can ? "false" : "true");
        if (can) input.removeAttribute("readonly");
        else input.setAttribute("readonly", "");
        input.setAttribute("title", can ? "" : `Cannot be changed here: ${actionsModule.reason(commands(), kind, guard())}`);
      }
      const canSmart = actionsModule.canToggleSmart(commands(), state.smart, guard());
      smartSwitch.setAttribute("data-able", canSmart ? "true" : "false");
      smartSwitch.setAttribute("title", canSmart
        ? (state.smart.enabled ? "Smart Hoppers on — click to turn off on this device" : "Smart Hoppers off — click to turn on on this device")
        : `Smart Hoppers cannot be changed here: ${actionsModule.smartReason(commands(), state.smart, guard())}`);
    }

    function paintChrome() {
      rootEl.setAttribute("data-shape", state.shape || "off");
      subtitle.textContent = subtitleFor(state.resolved, state.smart);
      smartLine.textContent = smartText(state.smart);
      smartSwitch.setAttribute("aria-checked", state.smart.enabled ? "true" : "false");
      show(circumferenceWrap, state.shape === "smart:cylindrical");
    }

    /* ---- The switch ---- */

    function toggleSmart() {
      if (smartSwitch.getAttribute("data-able") !== "true") {
        say(`Smart Hoppers cannot be changed here: ${actionsModule.smartReason(commands(), state.smart, guard())}`);
        return null;
      }
      const result = actionsModule.setSmart(commands(), !state.smart.enabled);
      if (result && result.ok) {
        setNote("", "");
        if (result.changed) onCommitted(result);
      } else {
        setNote("error", (result && result.message) || "The application refused the change.");
      }
      return result;
    }

    /* ---- Profiles ---- */

    const connected = () => profilesModule.connected(profiles);
    const able = () => profilesModule.can(profiles, guard());
    const why = control => profilesModule.reason(profiles, control, guard());
    const selected = () => profilesModule.findById(state.book, state.selectedId);

    function setBookNote(kind, message) {
      bookNote.textContent = message || "";
      bookNote.classList.toggle("is-error", kind === "error");
      bookNote.classList.toggle("is-ok", kind === "ok");
      show(bookNote, !!message);
    }

    async function ask(action, run) {
      if (state.pending) return null;
      state.pending = action;
      setBookNote("", "");
      paintProfiles();
      let result;
      try {
        result = await run();
      } finally {
        state.pending = null;
      }
      paintProfiles();
      return result || { ok: false, code: "failed", message: profilesModule.WORDING.noAnswer };
    }

    function openEntry(mode, id) {
      const profile = id ? profilesModule.findById(state.book, id) : null;
      state.entry = { mode, id: id || null };
      state.duplicate = null;
      state.confirm = null;
      state.moreOpen = false;
      if (mode === "save") entryLabel.textContent = "Save the line's current weights as";
      else if (mode === "rename") entryLabel.textContent = `Rename “${profile ? profile.name : ""}” to`;
      else entryLabel.textContent = `Duplicate “${profile ? profile.name : ""}” as`;
      entryConfirm.textContent = mode === "save" ? "Save" : (mode === "rename" ? "Rename" : "Duplicate");
      nameInput.value = mode === "rename" ? (profile ? profile.name : "") : (mode === "duplicate" && profile ? `${profile.name} copy` : "");
      nameInput.removeAttribute("aria-invalid");
      show(entryReplace, false);
      show(entry, true);
      paintProfiles();
      if (typeof nameInput.focus === "function") nameInput.focus();
      if (typeof nameInput.select === "function") nameInput.select();
    }

    function closeEntry() {
      state.entry = null;
      state.duplicate = null;
      nameInput.value = "";
      nameInput.removeAttribute("aria-invalid");
      show(entryReplace, false);
      show(entry, false);
    }

    async function confirmEntry() {
      const current = state.entry;
      if (!current) return;
      const name = profilesModule.cleanName(nameInput.value);
      if (!name) { nameInput.setAttribute("aria-invalid", "true"); setBookNote("error", profilesModule.WORDING.nameNeeded); return; }
      let result;
      if (current.mode === "save") result = await ask("save", () => profilesModule.save(profiles, name));
      else if (current.mode === "rename") result = await ask("rename", () => profilesModule.rename(profiles, current.id, name));
      else result = await ask("duplicate", () => profilesModule.duplicate(profiles, current.id, name));
      if (!result || state.entry !== current) return;
      if (result.ok) {
        const wording = current.mode === "save" ? profilesModule.WORDING.saved : (current.mode === "rename" ? profilesModule.WORDING.renamed : profilesModule.WORDING.duplicated);
        if (result.id) state.selectedId = result.id;
        closeEntry();
        setBookNote("ok", wording(name));
        paintProfiles();
        return;
      }
      nameInput.setAttribute("aria-invalid", "true");
      if (result.code === "duplicate_name" && result.existing) {
        state.duplicate = result.existing;
        state.selectedId = result.existing.id;
        show(entryReplace, true);
        setBookNote("error", profilesModule.WORDING.duplicateOffer(result.existing.name));
      } else if (result.code === "duplicate_name") {
        setBookNote("error", profilesModule.WORDING.duplicateOther);
      } else {
        setBookNote("error", result.message || "The application refused the change.");
      }
      paintProfiles();
    }

    async function replaceExisting() {
      const existing = state.duplicate;
      if (!existing) return;
      const result = await ask("replace", () => profilesModule.replace(profiles, existing.id));
      if (!result) return;
      if (result.ok) {
        closeEntry();
        state.selectedId = existing.id;
        setBookNote("ok", profilesModule.WORDING.replaced(existing.name));
      } else {
        setBookNote("error", result.message || "The profile could not be replaced.");
      }
      paintProfiles();
    }

    function openConfirm(kind, id) {
      state.confirm = { kind, id };
      state.moreOpen = false;
      paintDetail();
    }

    async function confirmAction() {
      const confirm = state.confirm;
      const profile = selected();
      if (!confirm || !profile || confirm.id !== profile.id) return;
      let result;
      if (confirm.kind === "load") result = await ask("load", () => profilesModule.load(profiles, profile.id));
      else if (confirm.kind === "update") result = await ask("update", () => profilesModule.replace(profiles, profile.id));
      else result = await ask("remove", () => profilesModule.remove(profiles, profile.id));
      if (!result) return;
      const still = state.selectedId === profile.id;
      if (state.confirm === confirm) state.confirm = null;
      if (result.ok) {
        if (confirm.kind === "load") setBookNote("ok", profilesModule.WORDING.loaded(profile.name));
        else if (confirm.kind === "update") setBookNote("ok", profilesModule.WORDING.updated(profile.name));
        else { setBookNote("ok", profilesModule.WORDING.deleted(profile.name)); if (still) state.selectedId = null; }
      } else {
        const fallback = confirm.kind === "load" ? profilesModule.WORDING.loadFailed : (confirm.kind === "update" ? profilesModule.WORDING.updateFailed : profilesModule.WORDING.deleteFailed);
        setBookNote("error", result.message || fallback);
        if (result.code === "not_found" && still) state.selectedId = null;
      }
      paintProfiles();
    }

    async function refreshBook() {
      const result = await ask("refresh", () => profilesModule.refreshBook(profiles));
      if (result && !result.ok) { setBookNote("error", result.message || "The line's profiles could not be refreshed."); paintProfiles(); }
    }

    function withhold(button, control) {
      const can = able()[control];
      button.setAttribute("data-able", can ? "true" : "false");
      button.setAttribute("title", can ? "" : `Unavailable: ${why(control)}`);
      if (state.pending) button.setAttribute("disabled", "");
      else button.removeAttribute("disabled");
    }

    function actionButton(label, action, className, extra) {
      const button = text(doc, "button", `slate-book__action ${className || ""}`.trim(), label, Object.assign({ type: "button", "data-book-action": action }, extra || {}));
      if (state.pending) button.setAttribute("disabled", "");
      return button;
    }

    function paintBookBar() {
      bookSubtitle.textContent = profilesSubtitle(state.book, connected());
      withhold(barButtons.save, "save");
      withhold(barButtons.refresh, "refresh");
      const refreshing = !!(state.book && state.book.refreshing);
      barButtons.refresh.classList.toggle("is-busy", refreshing);
      barButtons.refresh.textContent = refreshing ? "Refreshing…" : "Refresh";
      if (refreshing) barButtons.refresh.setAttribute("disabled", "");
      for (const button of [entryConfirm, entryReplace, entryCancel]) {
        if (state.pending) button.setAttribute("disabled", "");
        else button.removeAttribute("disabled");
      }
    }

    function paintList() {
      clear(list);
      const items = connected() && state.book && Array.isArray(state.book.profiles) ? state.book.profiles : [];
      if (items.length === 0) {
        list.appendChild(text(doc, "li", "slate-book__empty", emptyText(state.book, connected())));
        return;
      }
      for (const profile of items) {
        const item = element(doc, "li", "slate-book__item");
        const row = element(doc, "button", "slate-book__row", { type: "button", "data-profile": profile.id, "aria-pressed": profile.id === state.selectedId ? "true" : "false" });
        row.appendChild(text(doc, "span", "slate-book__row-name", profile.name));
        row.appendChild(text(doc, "span", "slate-book__row-meta", rowMeta(profile)));
        item.appendChild(row);
        list.appendChild(item);
      }
    }

    function toneFor(layerName, index, count) {
      const model = state.resolved && state.resolved.line;
      const known = model ? model.layers.find(layer => layer.id === layerName) : null;
      if (known) return known.tone;
      return lineModule.roleTone(lineModule.roleForStackIndex(index, count));
    }

    function paintDetail() {
      clear(detail);
      const profile = selected();
      if (!profile) {
        detail.appendChild(text(doc, "p", "slate-book__hint", SELECT_HINT));
        return;
      }
      const model = state.resolved && state.resolved.line;
      const compat = compatibility(profile, model);
      detail.appendChild(text(doc, "h2", "slate-book__detail-name", profile.name));
      detail.appendChild(text(doc, "p", "slate-weights__detail-meta", rowMeta(profile)));
      if (!compat.ok) detail.appendChild(text(doc, "p", "slate-book__compat", compat.message, { "data-kind": "incompatible" }));

      const buttons = element(doc, "div", "slate-book__actions");
      const load = actionButton("Load", "load", state.confirm ? "" : "slate-book__action--primary");
      const update = actionButton("Update", "update", "");
      const more = actionButton("More…", "more", "slate-book__action--quiet", { "aria-expanded": state.moreOpen ? "true" : "false" });
      for (const [button, control] of [[load, "load"], [update, "update"]]) withhold(button, control);
      buttons.appendChild(load);
      buttons.appendChild(update);
      buttons.appendChild(more);
      detail.appendChild(buttons);

      const overflow = element(doc, "div", "slate-book__overflow", state.moreOpen ? {} : { hidden: "" });
      for (const [label, action, control, className] of [["Rename", "rename", "rename", ""], ["Duplicate", "duplicate", "duplicate", ""], ["Delete", "delete", "remove", "slate-book__action--danger"]]) {
        const button = actionButton(label, action, className);
        withhold(button, control);
        overflow.appendChild(button);
      }
      detail.appendChild(overflow);

      if (state.confirm && state.confirm.id === profile.id) {
        const box = element(doc, "div", "slate-book__confirm", { role: "group", "data-kind": state.confirm.kind });
        if (state.confirm.kind === "load") {
          box.appendChild(text(doc, "p", "slate-book__confirm-text", `${profile.name}. ${profilesModule.LOAD_TEXT}${profile.hasGeometry ? ` ${profilesModule.GEOMETRY_TEXT}` : ""}`));
          const preview = compat.ok ? previewFor(profile, state.resolved) : null;
          box.appendChild(text(doc, "p", "slate-book__preview", compat.ok ? (preview ? capitalize(preview.text) : "No line to compare with.") : compat.message));
          const go = actionButton("Load Weights", "confirm", "slate-book__action--primary");
          withhold(go, "load");
          if (!compat.ok) { go.setAttribute("disabled", ""); go.setAttribute("title", compat.message); }
          const row = element(doc, "div", "slate-book__confirm-actions");
          row.appendChild(go);
          row.appendChild(actionButton("Cancel", "cancel-confirm", "slate-book__action--quiet"));
          box.appendChild(row);
        } else {
          const wording = state.confirm.kind === "update" ? profilesModule.WORDING.confirmUpdate(profile.name) : profilesModule.WORDING.confirmDelete(profile.name);
          box.appendChild(text(doc, "p", "slate-book__confirm-text", wording));
          const row = element(doc, "div", "slate-book__confirm-actions");
          const go = actionButton(state.confirm.kind === "update" ? "Update" : "Delete", "confirm", state.confirm.kind === "update" ? "slate-book__action--primary" : "slate-book__action--danger");
          withhold(go, state.confirm.kind === "update" ? "update" : "remove");
          row.appendChild(go);
          row.appendChild(actionButton("Cancel", "cancel-confirm", "slate-book__action--quiet"));
          box.appendChild(row);
        }
        detail.appendChild(box);
      }

      // The weights: the profile's own layers, A, B, C...
      const layersEl2 = element(doc, "div", "slate-book__layers");
      const layers = (Array.isArray(profile.layers) ? profile.layers : []).slice().sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
      layers.forEach((layer, index) => {
        const row = element(doc, "div", "slate-book__layer", { "data-layer": layer.name, "data-tone": toneFor(layer.name, index, layers.length) });
        row.appendChild(text(doc, "span", "slate-book__layer-id", layer.name));
        const hoppers = element(doc, "span", "slate-book__hoppers");
        const weights = Array.isArray(layer.weights) ? layer.weights : [];
        const carried = weights.map((weight, i) => ({ index: i, weight: Number(weight) })).filter(one => Number.isFinite(one.weight) && one.weight > 0);
        if (!carried.length) hoppers.appendChild(text(doc, "span", "slate-book__hopper slate-book__hopper--none", "no weights"));
        for (const one of carried) {
          const chip = element(doc, "span", "slate-book__hopper");
          chip.appendChild(text(doc, "span", "slate-book__hopper-id", lineModule.hopperId(layer.name, one.index, profile.hopperNamingMode)));
          chip.appendChild(text(doc, "span", "slate-book__hopper-resin", `${actionsModule.formatPounds(one.weight)} lb`));
          hoppers.appendChild(chip);
        }
        row.appendChild(hoppers);
        layersEl2.appendChild(row);
      });
      detail.appendChild(layersEl2);
    }

    function paintProfiles() {
      paintBookBar();
      paintList();
      paintDetail();
    }

    function updateBook() {
      state.book = profilesModule.bookOf(profiles);
      if (state.selectedId && !selected()) {
        state.selectedId = null;
        state.confirm = null;
        state.moreOpen = false;
        if (state.entry && state.entry.mode !== "save") closeEntry();
      }
      paintProfiles();
    }

    /* ---- Inputs ---- */

    function update(resolved, meta) {
      const options = meta || {};
      const own = !!options.own;
      state.resolved = resolved || null;
      state.smart = actionsModule.smartFrom(resolved);
      state.measure = actionsModule.measureFor(state.smart);
      const shape = actionsModule.shapeOf(state.smart);
      const structural = !state.built || options.kind === "structural" || shape !== state.shape;
      state.shape = shape;
      if (structural) {
        abandonEdit(own);
        buildLayers();
      }
      paintRows(own);
      paintChrome();
      applyAbilities();
      paintProfiles();
    }

    /* A read-only flip: every field re-reads its ability; a draft, an
     * entry or a confirm whose ability is gone closes. */
    function refresh() {
      applyAbilities();
      if (state.editing && !actionsModule.abilities(commands(), guard())[state.editing.kind]) cancelField(state.editing.key, state.editing.kind);
      const can = able();
      if (state.entry && !(state.entry.mode === "save" ? can.save : can[state.entry.mode])) closeEntry();
      if (state.confirm && !can.load && !can.update && !can.remove) state.confirm = null;
      paintProfiles();
    }

    /* ---- Clicks ---- */

    rootEl.addEventListener("click", event => {
      const target = event && event.target;
      if (!target || typeof target.closest !== "function") return;
      if (target.closest("[data-slate-smart]")) { toggleSmart(); return; }
      const row = target.closest("[data-profile]");
      if (row && list.contains(row)) {
        const id = row.getAttribute("data-profile");
        state.selectedId = state.selectedId === id ? null : id;
        state.confirm = null;
        state.moreOpen = false;
        if (state.entry && state.entry.mode !== "save") closeEntry();
        paintList();
        paintDetail();
        return;
      }
      const button = target.closest("[data-book-action]");
      if (!button || !rootEl.contains(button) || button.hasAttribute("disabled")) return;
      const action = button.getAttribute("data-book-action");
      const control = { save: "save", refresh: "refresh", load: "load", update: "update", rename: "rename", duplicate: "duplicate", delete: "remove", replace: "replace" }[action];
      if (control && button.getAttribute("data-able") === "false") { say(`${button.textContent} is unavailable: ${why(control)}`); return; }
      const profile = selected();
      switch (action) {
        case "save": openEntry("save", null); break;
        case "refresh": refreshBook(); break;
        case "confirm-entry": confirmEntry(); break;
        case "replace": replaceExisting(); break;
        case "cancel-entry": closeEntry(); paintProfiles(); break;
        case "load": if (profile) openConfirm("load", profile.id); break;
        case "update": if (profile) openConfirm("update", profile.id); break;
        case "more": state.moreOpen = !state.moreOpen; paintDetail(); break;
        case "rename": if (profile) openEntry("rename", profile.id); break;
        case "duplicate": if (profile) openEntry("duplicate", profile.id); break;
        case "delete": if (profile) openConfirm("delete", profile.id); break;
        case "confirm": confirmAction(); break;
        case "cancel-confirm": state.confirm = null; paintDetail(); break;
        default: break;
      }
    });

    nameInput.addEventListener("keydown", event => {
      if (!event) return;
      if (event.key === "Enter") { if (typeof event.preventDefault === "function") event.preventDefault(); confirmEntry(); }
      else if (event.key === "Escape") { if (typeof event.stopPropagation === "function") event.stopPropagation(); closeEntry(); paintProfiles(); }
    });
    rootEl.addEventListener("keydown", event => {
      if (!event || event.key !== "Escape") return;
      if (state.confirm || state.moreOpen) { state.confirm = null; state.moreOpen = false; paintDetail(); if (typeof event.stopPropagation === "function") event.stopPropagation(); }
    });

    wireField(circumferenceInput, "circumference", KIND.circumference);
    if (profiles && typeof profiles.subscribe === "function") profiles.subscribe(updateBook);
    updateBook();

    return Object.freeze({
      element: rootEl,
      update,
      refresh,
      updateBook,
      editing: () => state.editing,
      shape: () => state.shape,
      getState: () => ({ selectedId: state.selectedId, entry: state.entry, confirm: state.confirm, pending: state.pending }),
      onHide() {
        abandonEdit(true);
        closeEntry();
        state.confirm = null;
        state.moreOpen = false;
        paintProfiles();
      }
    });
  }

  return Object.freeze({
    TITLE, SELECT_HINT, NOTHING_CHANGES, ABANDONED, NO_LINE,
    formatWhen, subtitleFor, smartText, computedHint, rowMeta, emptyText, profilesSubtitle, compatibility, previewFor, create
  });
});
