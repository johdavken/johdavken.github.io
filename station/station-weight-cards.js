/* Station weight cards - the hopper cluster's third face: the physical
 * hoppers' receiver weights and, with Smart Hoppers on, the geometry each
 * weight is computed from - edited in the cluster's own footprint, one
 * card per layer, from the machine utility rail.
 *
 * WHAT IT IS
 *
 * The write seam for the receiver weights on the stage, as
 * station-focus-editor.js (compact variant) is the write seam for the
 * blends on Blend Edit's cards. A card lists the layer's hoppers as the
 * blend card does - the id, the resin as the running job has it - and
 * carries for each a weight field (lb) and, when the switch is on and the
 * line says which measure it takes, a geometry field (usable height in
 * inches on a cylindrical line, usable volume in gallons on a volume
 * line) with the computed weight under it, or quietly why there is none.
 * On a cylindrical line the card's foot carries the one circumference
 * every hopper shares. Each field's commit is ONE command through the
 * bridge the card was handed - setHopperWeight, setHopperGeometry,
 * setHopperCircumference - addressed to the Current recipe (physical
 * hoppers belong to the line, not to a recipe: the contract refuses any
 * other); the answer goes to the boot file (onCommitted), which runs the
 * publish policy over it, so what the card then shows is what the
 * application holds.
 *
 * The switch itself - Smart Hoppers on or off - is not on a card. It is
 * a fact about this desktop (the application keeps it device-local and
 * never syncs it), and it acts on every hopper at once, so it stands on
 * the rail beside the machine with the other operations over the whole
 * machine; the rail hands the click to the boot file, which asks this
 * module (toggleSmart) - the one setSmartHoppers on the same bridge.
 *
 * FIELD RULES - the Handbook's Weights page's, verbatim
 *
 *   focus     opens a draft from the canonical value
 *   Enter     commits; focus stays in the field
 *   blur      commits once
 *   Escape    drops the draft and is spent in the field (stopPropagation),
 *             so the stage's own Escape - leave the mode - never sees it;
 *             with no draft it leaves the field
 *   blank     is 0 (a cleared weight, a cleared measure)
 *   unchanged is nothing to send
 *   refusal   keeps the draft, marks the field aria-invalid, says why in
 *             the card's note
 *   update()  never writes the field being typed in; if its canonical
 *             value moved underneath the operator the field is marked
 *             and the note says so, and nothing is applied until they
 *             commit or cancel
 *
 * WHAT IT HOLDS
 *
 * Presentation state only: which field is being typed in and what it
 * started from, and which is mid-commit. Every value shown comes from
 * the resolved state the boot file hands it (hopperState, smartHoppers);
 * nothing is computed here - the computed weight is the application's
 * (smartHopperComputation in app.js), projected through the state
 * bridge as `smartWeight` - and no weight, geometry or switch state is
 * kept once the card is rebuilt.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynStationWeightCards = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* The commands a card, and the rail's switch, ride on. */
  const COMMAND = Object.freeze({
    weight: "setHopperWeight",
    geometry: "setHopperGeometry",
    circumference: "setHopperCircumference",
    smart: "setSmartHoppers"
  });
  const KIND = Object.freeze({ weight: "weight", geometry: "geometry", circumference: "circumference" });
  /* The measure a line takes, by its geometry mode: which field, which
   * unit, which dimension the command names. */
  const MEASURE = Object.freeze({
    cylindrical: Object.freeze({ dimension: "height", unit: "in", unitWord: "inches", noun: "usable height", field: "usableHeight" }),
    volume: Object.freeze({ dimension: "volume", unit: "gal", unitWord: "gallons", noun: "usable volume", field: "usableGallons" })
  });
  const SMART_ON_TEXT = "Weights are computed from each hopper's geometry and its resin's measured bulk density; the entered weight stands where nothing can be computed.";
  const SMART_OFF_TEXT = "Weights are the entered receiver weights.";
  const SMART_UNAVAILABLE_TEXT = "Connect this desktop to an identified line to use Smart Hoppers.";

  function element(doc, name, className, attributes) {
    const node = doc.createElement(name);
    if (className) node.setAttribute("class", className);
    if (attributes) {
      for (const key of Object.keys(attributes)) {
        const value = attributes[key];
        if (value === null || value === undefined) continue;
        node.setAttribute(key, String(value));
      }
    }
    return node;
  }

  function text(doc, name, className, content, attributes) {
    const node = element(doc, name, className, attributes);
    node.textContent = content;
    return node;
  }

  function formatPounds(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.round(number).toLocaleString("en-US") : "—";
  }

  /* A value as a field shows it: the number as entered, blank for none. */
  function fieldText(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? String(number) : "";
  }

  function capitalize(words) {
    return words ? words.charAt(0).toUpperCase() + words.slice(1) : words;
  }

  /* ---- Reading the source ---- */

  /* Smart Hoppers as the source carries it; at rest when it carries none
   * (a demo line, an older producer). `geometryMode` null means this
   * desktop is not on an identified line: no measure, no switch. */
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

  /* ---- The bridge's offer ---- */

  function usable(commands) {
    return !!(commands && typeof commands.isAvailable === "function" && commands.isAvailable() &&
      typeof commands.dispatch === "function" && typeof commands.capabilities === "function");
  }

  function offers(commands, name) {
    if (!usable(commands)) return false;
    const offered = commands.capabilities();
    return Array.isArray(offered) && offered.includes(name);
  }

  /* Which of the card's commands the bridge offers. Physical hoppers are
   * the line's, so only the Current recipe is ever asked. */
  function abilities(commands, recipe) {
    const able = {};
    for (const kind of Object.keys(COMMAND)) able[kind] = recipe === "current" && offers(commands, COMMAND[kind]);
    return Object.freeze(able);
  }

  function reason(commands, recipe, kind) {
    const connected = !!(commands && typeof commands.isAvailable === "function" && commands.isAvailable());
    if (!connected) return "no application is connected to Station commands.";
    if (recipe !== "current") return "receiver weights and hopper geometry belong to the physical hoppers, not to a recipe.";
    const what = kind === "smart" ? "the Smart Hoppers switch" : (kind === "circumference" ? "the shared circumference" : (kind === "geometry" ? "hopper geometry" : "receiver weights"));
    return `the application does not offer ${what} from Station.`;
  }

  /* Whether the rail's switch may act: the command on offer, and a line
   * that says which measure it takes. */
  function canToggleSmart(commands, smart) {
    return offers(commands, COMMAND.smart) && !!(smart && smart.geometryMode);
  }

  function smartReason(commands, smart) {
    if (!offers(commands, COMMAND.smart)) return reason(commands, "current", "smart");
    if (!smart || !smart.geometryMode) return SMART_UNAVAILABLE_TEXT;
    return "";
  }

  function unavailable(message) {
    return Object.freeze({ ok: false, code: "unavailable", message });
  }

  /**
   * Smart Hoppers on or off: one setSmartHoppers stating the state wanted
   * - the opposite of what the source carries. The answer is the
   * contract's, returned untouched.
   */
  function toggleSmart(commands, smart) {
    if (!commands || typeof commands.dispatch !== "function") {
      return unavailable("No application is connected to Station commands.");
    }
    if (!smart || !smart.geometryMode) return unavailable(SMART_UNAVAILABLE_TEXT);
    return commands.dispatch(COMMAND.smart, { enabled: !smart.enabled });
  }

  /* ---- The card ---- */

  /* Which controls a card is built with: the fields change with the
   * switch and the line's measure, so a change rebuilds the rows. */
  function shapeOf(smart) {
    return smart.enabled && measureFor(smart) ? `smart:${smart.geometryMode}` : "off";
  }

  /**
   * Build one layer's weight card.
   *
   * @param {Document} doc
   * @param {object} options
   * @param {object}   options.layer        the line model's layer: { id, hoppers: [{ id, index }] }
   * @param {object}   options.hopperState  station-source's runtime shape, keyed "<layer>:<index>"
   * @param {object}   [options.smartHoppers] the resolved smartHoppers block
   * @param {object|null} options.commands  the command bridge the boot file hands over, or null
   * @param {string}   options.recipe       "current" - the only recipe physical hoppers answer to
   * @param {function} [options.onEditing]  (record|null) as the operator enters and leaves a field
   * @param {function} [options.onCommitted] (result) after a command changed something
   * @returns {{ element, update, note, able, layer }|null}
   */
  function create(doc, options) {
    const settings = options || {};
    const layer = settings.layer;
    if (!layer || !Array.isArray(layer.hoppers)) return null;
    const commands = settings.commands || null;
    const recipe = settings.recipe === "current" || settings.recipe === "next" ? settings.recipe : null;
    const able = abilities(commands, recipe);
    const onEditing = typeof settings.onEditing === "function" ? settings.onEditing : () => {};
    const onCommitted = typeof settings.onCommitted === "function" ? settings.onCommitted : () => {};

    const state = {
      hopperState: settings.hopperState && typeof settings.hopperState === "object" ? settings.hopperState : {},
      smart: smartFrom({ smartHoppers: settings.smartHoppers }),
      shape: null,
      editing: null,     // { key, kind, base }
      committing: null   // { key, kind }
    };
    const fields = new Map();
    let circumferenceInput = null;

    const editable = Object.keys(able).filter(kind => kind !== "smart" && able[kind]);
    const mode = editable.length === 0 ? "read-only" : "editing";
    const rootEl = element(doc, "div", "station-weight-card", {
      "data-layer": layer.id,
      "data-role": "weights-card",
      "data-mode": mode,
      "aria-label": `Layer ${layer.id} weights`,
      title: mode === "read-only" ? `Read-only: ${reason(commands, recipe, "weight")}` : null
    });
    const list = element(doc, "ol", "station-weight-card__list", { "aria-label": `Layer ${layer.id} hopper weights` });
    const foot = element(doc, "div", "station-weight-card__foot");
    const note = text(doc, "p", "station-weight-card__note", "", { "aria-live": "polite" });
    rootEl.appendChild(list);
    rootEl.appendChild(foot);
    rootEl.appendChild(note);

    function say(message, kind) {
      note.textContent = message || "";
      if (message && kind) note.setAttribute("data-kind", kind);
      else note.removeAttribute("data-kind");
    }

    /* ---- Reading ---- */

    function runtimeOf(key) {
      return state.hopperState[key] || {};
    }

    function weightOf(key) {
      const value = Number(runtimeOf(key).weight);
      return Number.isFinite(value) && value > 0 ? value : 0;
    }

    function geometryOf(key) {
      const m = measureFor(state.smart);
      const value = m ? Number(runtimeOf(key)[m.field]) : 0;
      return Number.isFinite(value) && value > 0 ? value : 0;
    }

    function smartWeightOf(key) {
      const raw = runtimeOf(key).smartWeight;
      return raw && typeof raw === "object" && Number.isFinite(raw.value) && raw.value > 0 ? raw : null;
    }

    function valueOf(key, kind) {
      if (kind === KIND.geometry) return geometryOf(key);
      if (kind === KIND.circumference) return state.smart.circumference;
      return weightOf(key);
    }

    function inputFor(key, kind) {
      if (kind === KIND.circumference) return circumferenceInput;
      const field = fields.get(key);
      if (!field) return null;
      return kind === KIND.geometry ? field.geometryInput : field.input;
    }

    function nounFor(key, kind) {
      const field = fields.get(key);
      const id = field ? field.id : key;
      if (kind === KIND.circumference) return "the shared circumference";
      const m = measureFor(state.smart);
      if (kind === KIND.geometry) return `${id}'s ${m ? m.noun : "geometry"}`;
      return `${id}'s weight`;
    }

    function unitFor(kind) {
      if (kind === KIND.weight) return "lb";
      const m = measureFor(state.smart);
      return m ? m.unit : "";
    }

    function editingIs(key, kind) {
      return !!(state.editing && state.editing.key === key && state.editing.kind === kind);
    }

    function committingIs(key, kind) {
      return !!(state.committing && state.committing.key === key && state.committing.kind === kind);
    }

    function editingRecord(key, kind, input) {
      const field = kind === KIND.circumference ? null : fields.get(key);
      return {
        layer: layer.id,
        index: field ? field.index : null,
        hopper: field ? field.id : null,
        slot: kind,
        mode: "typing",
        draft: input.value,
        baseValue: state.editing ? state.editing.base : fieldText(valueOf(key, kind))
      };
    }

    /* ---- Writing ---- */

    function send(command, args) {
      const request = command === COMMAND.circumference ? Object.assign({}, args) : Object.assign({ recipe }, args);
      const result = commands && typeof commands.dispatch === "function"
        ? commands.dispatch(command, request)
        : unavailable("No application is connected to Station commands.");
      return result || { ok: false, code: "failed", message: "The application did not answer." };
    }

    function requestFor(key, kind, value) {
      if (kind === KIND.circumference) return { command: COMMAND.circumference, args: { circumference: value } };
      const field = fields.get(key);
      const m = measureFor(state.smart);
      if (kind === KIND.geometry) {
        return { command: COMMAND.geometry, args: { layer: layer.id, index: field.index, dimension: m ? m.dimension : "height", value } };
      }
      return { command: COMMAND.weight, args: { layer: layer.id, index: field.index, weight: value } };
    }

    function commitField(key, kind) {
      const input = inputFor(key, kind);
      if (!input || input.readOnly) return null;
      const draft = String(input.value || "").trim();
      const resting = fieldText(valueOf(key, kind));
      if (draft === resting) {
        input.removeAttribute("aria-invalid");
        return null;
      }
      const request = requestFor(key, kind, draft === "" ? 0 : draft);
      const result = send(request.command, request.args);
      if (!result.ok) {
        input.setAttribute("aria-invalid", "true");
        say(result.message || `${capitalize(nounFor(key, kind))} could not be set.`, "error");
        return result;
      }
      input.removeAttribute("aria-invalid");
      input.classList.remove("is-changed-underneath");
      if (result.changed) {
        state.committing = { key, kind };
        say("");
        try { onCommitted(result); } finally { state.committing = null; }
        // Whether or not a publish came back through update(), the field
        // now shows the line's value and the draft starts from it.
        const input2 = inputFor(key, kind);
        if (input2) {
          input2.value = fieldText(valueOf(key, kind));
          if (editingIs(key, kind)) state.editing.base = input2.value;
        }
      } else {
        input.value = resting;
      }
      return result;
    }

    function cancelField(key, kind) {
      const input = inputFor(key, kind);
      if (!input) return;
      const base = editingIs(key, kind) ? state.editing.base : fieldText(valueOf(key, kind));
      const hadDraft = String(input.value || "").trim() !== base;
      input.value = fieldText(valueOf(key, kind));
      if (editingIs(key, kind)) state.editing.base = input.value;
      input.removeAttribute("aria-invalid");
      input.classList.remove("is-changed-underneath");
      if (!hadDraft && typeof input.blur === "function") input.blur();
    }

    function wireField(input, key, kind) {
      input.addEventListener("focus", () => {
        if (input.readOnly) return;
        state.editing = { key, kind, base: fieldText(valueOf(key, kind)) };
        input.classList.remove("is-changed-underneath");
        onEditing(editingRecord(key, kind, input));
      });
      input.addEventListener("input", () => {
        input.removeAttribute("aria-invalid");
        if (editingIs(key, kind)) onEditing(editingRecord(key, kind, input));
      });
      input.addEventListener("keydown", event => {
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
          commitField(key, kind);
          state.editing = null;
          input.classList.remove("is-changed-underneath");
          onEditing(null);
        }
      });
    }

    /* ---- Building ---- */

    function clear(node) {
      while (node.firstChild) node.removeChild(node.firstChild);
    }

    function build() {
      clear(list);
      clear(foot);
      fields.clear();
      circumferenceInput = null;
      state.editing = null;
      const m = measureFor(state.smart);
      const geometryOn = state.smart.enabled && !!m;
      state.shape = shapeOf(state.smart);
      rootEl.setAttribute("data-shape", state.shape);

      for (const hopper of layer.hoppers) {
        const key = `${layer.id}:${hopper.index}`;
        const item = element(doc, "li", "station-weight-card__item", {
          "data-layer": layer.id, "data-hopper": hopper.id, "data-hopper-index": hopper.index
        });
        item.appendChild(text(doc, "span", "station-weight-card__badge", hopper.id));
        const resin = text(doc, "span", "station-weight-card__resin", "");
        item.appendChild(resin);
        const wrap = element(doc, "span", "station-weight-card__field-wrap");
        const input = element(doc, "input", "station-weight-card__field", {
          type: "text", inputmode: "decimal", autocomplete: "off", spellcheck: "false", placeholder: "0",
          "data-layer": layer.id, "data-index": hopper.index, "data-key": key, "data-kind": KIND.weight,
          "aria-label": `${hopper.id} receiver weight, pounds`
        });
        wrap.appendChild(input);
        wrap.appendChild(text(doc, "span", "station-weight-card__unit", "lb"));
        item.appendChild(wrap);
        let geometryInput = null;
        let computed = null;
        if (geometryOn) {
          const geometryWrap = element(doc, "span", "station-weight-card__field-wrap station-weight-card__geometry");
          geometryInput = element(doc, "input", "station-weight-card__geometry-field", {
            type: "text", inputmode: "decimal", autocomplete: "off", spellcheck: "false", placeholder: "0",
            "data-layer": layer.id, "data-index": hopper.index, "data-key": key, "data-kind": KIND.geometry,
            "aria-label": `${hopper.id} ${m.noun}, ${m.unitWord}`
          });
          geometryWrap.appendChild(geometryInput);
          geometryWrap.appendChild(text(doc, "span", "station-weight-card__unit", m.unit));
          item.appendChild(geometryWrap);
          computed = element(doc, "span", "station-weight-card__computed", { "data-key": key });
          item.appendChild(computed);
        }
        list.appendChild(item);
        fields.set(key, { input, geometryInput, computed, resin, item, index: hopper.index, id: hopper.id });
        wireField(input, key, KIND.weight);
        if (geometryInput) wireField(geometryInput, key, KIND.geometry);
      }

      /* The one circumference every hopper on a cylindrical line shares:
       * on the card's foot, said to be shared, edited from any card. */
      if (geometryOn && state.smart.geometryMode === "cylindrical") {
        const label = element(doc, "label", "station-weight-card__circumference");
        label.appendChild(text(doc, "span", "station-weight-card__circumference-label", "Circumference"));
        circumferenceInput = element(doc, "input", "station-weight-card__circumference-field", {
          type: "text", inputmode: "decimal", autocomplete: "off", spellcheck: "false", placeholder: "0",
          "data-kind": KIND.circumference, "aria-label": "Hopper circumference, inches, shared by every hopper on the line"
        });
        label.appendChild(circumferenceInput);
        label.appendChild(text(doc, "span", "station-weight-card__unit", "in"));
        foot.appendChild(label);
        foot.appendChild(text(doc, "span", "station-weight-card__shared", "shared by every hopper", {
          title: "One circumference for the line: every hopper's computed weight uses it."
        }));
        wireField(circumferenceInput, KIND.circumference, KIND.circumference);
      }
      draw();
    }

    /* ---- Drawing what the source says ---- */

    function patchField(input, key, kind, can) {
      const canonical = fieldText(valueOf(key, kind));
      if (!editingIs(key, kind)) {
        if (input.value !== canonical) input.value = canonical;
        input.classList.remove("is-changed-underneath");
      } else if (committingIs(key, kind)) {
        input.value = canonical;
        state.editing.base = canonical;
        input.classList.remove("is-changed-underneath");
      } else if (canonical !== state.editing.base) {
        if (!input.classList.contains("is-changed-underneath")) {
          input.classList.add("is-changed-underneath");
          const shown = kind === KIND.weight ? formatPounds(canonical) : (canonical || "0");
          say(`${capitalize(nounFor(key, kind))} is now ${shown} ${unitFor(kind)} in the application; what you are entering has not been applied.`, "warning");
        }
      }
      input.readOnly = !can;
      input.setAttribute("aria-disabled", can ? "false" : "true");
      if (can) input.removeAttribute("readonly");
      else input.setAttribute("readonly", "");
    }

    function drawComputed(field, key, m) {
      const computed = smartWeightOf(key);
      const runtime = runtimeOf(key);
      field.item.classList.toggle("is-smart", !!computed);
      if (computed) {
        field.computed.textContent = `✓ ${formatPounds(computed.value)} lb`;
        field.computed.setAttribute("data-kind", "computed");
        field.computed.setAttribute("title", `Computed from ${field.id}'s ${m ? m.noun : "geometry"}${computed.resinCode ? ` and ${computed.resinCode}'s bulk density` : ""}${computed.bulkDensity ? ` (${computed.bulkDensity} lb/ft³)` : ""}. Used for the run-down instead of the entered weight.`);
        return;
      }
      const why = !runtime.resinName ? "no resin"
        : !geometryOf(key) ? `no ${m ? m.noun.replace("usable ", "") : "geometry"}`
          : "no bulk density";
      field.computed.textContent = why;
      field.computed.setAttribute("data-kind", "hint");
      field.computed.setAttribute("title", `Nothing is computed for ${field.id}: ${why}. The entered weight stands.`);
    }

    function draw() {
      const m = measureFor(state.smart);
      for (const [key, field] of fields) {
        const runtime = runtimeOf(key);
        const code = runtime.resinName ? String(runtime.resinName) : "";
        field.resin.textContent = code || "—";
        field.resin.classList.toggle("is-placeholder", !code);
        field.resin.setAttribute("title", code ? `${field.id} runs ${code}` : `${field.id} has no resin assigned`);
        patchField(field.input, key, KIND.weight, able.weight);
        if (field.geometryInput) patchField(field.geometryInput, key, KIND.geometry, able.geometry);
        if (field.computed) drawComputed(field, key, m);
      }
      if (circumferenceInput) patchField(circumferenceInput, KIND.circumference, KIND.circumference, able.circumference);
    }

    /**
     * Tell the card the source moved. The fields it has are patched in
     * place around whatever is being typed; a change of shape - the
     * switch, the line's measure - rebuilds them.
     */
    function update(next) {
      const n = next || {};
      if (n.hopperState && typeof n.hopperState === "object") state.hopperState = n.hopperState;
      if (n.smartHoppers !== undefined) state.smart = smartFrom({ smartHoppers: n.smartHoppers });
      if (shapeOf(state.smart) !== state.shape) build();
      else draw();
    }

    build();

    return {
      element: rootEl,
      layer: layer.id,
      able,
      note: say,
      update,
      commit: () => { if (state.editing) commitField(state.editing.key, state.editing.kind); }
    };
  }

  return Object.freeze({
    COMMAND, KIND, MEASURE, SMART_ON_TEXT, SMART_OFF_TEXT, SMART_UNAVAILABLE_TEXT,
    formatPounds, fieldText, smartFrom, measureFor, abilities, reason, canToggleSmart, smartReason, toggleSmart, shapeOf, create
  });
});
