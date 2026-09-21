/* The Recipe section: the running recipe, layer by layer, down the page.
 *
 * Each layer is a block with its name, role and share in a column at the
 * left and its hoppers as rows beside it: id, resin, blend, effective
 * weight, and - in Track mode - the tracking and pump-off toggles. The
 * mode switch at the top offers Track, Edit, Compare and Print; in phase 1
 * only Track does anything, and the other three say so.
 *
 * The section dispatches nothing itself. Track's toggles and the reset
 * go through slate-tracking.js on the command bridge the boot hands in,
 * and the boot is told of every committed change (onCommitted) so the
 * bridge's echo can be recognised as the operator's own.
 *
 * A values change patches rows in place; only a structural change
 * rebuilds them. A row is never re-created for a value, so an armed reset
 * or a focused toggle keeps its element under another device's edit.
 */
(function (root, factory) {
  const tracking = typeof require === "function"
    ? require("./slate-tracking.js")
    : (root && root.PolynSlateTracking);
  const line = typeof require === "function"
    ? require("./slate-line.js")
    : (root && root.PolynSlateLine);
  const api = factory(tracking, line);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynSlateRecipe = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (trackingModule, lineModule) {
  "use strict";

  const MODES = Object.freeze(["track", "edit", "compare", "print"]);
  const MODE_LABEL = Object.freeze({ track: "Track", edit: "Edit", compare: "Compare", print: "Print" });
  const STUB = Object.freeze({
    track: "",
    edit: "Edit arrives in phase 2. Resin and blend are edited in Resin.Tools (Legacy) or Station for now.",
    compare: "Compare against the next recipe arrives in phase 2.",
    print: "Print arrives in phase 2. Print the recipe sheet from Resin.Tools (Legacy) for now."
  });
  const RESET_LABEL = "Reset tracking";
  const RESET_ARMED_LABEL = "Confirm reset";
  const RESET_ARM_MS = 4000;
  const EMPTY = "—";

  function element(doc, name, className, attributes) {
    const node = doc.createElement(name);
    if (className) node.setAttribute("class", className);
    if (attributes) for (const key of Object.keys(attributes)) node.setAttribute(key, attributes[key]);
    return node;
  }

  function text(doc, name, className, value, attributes) {
    const node = element(doc, name, className, attributes);
    node.textContent = value;
    return node;
  }

  function formatPct(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return EMPTY;
    return `${Number.isInteger(number) ? number : Math.round(number * 10) / 10}%`;
  }

  function formatWeight(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return EMPTY;
    return `${Number(number.toFixed(1)).toLocaleString("en-US")} lb`;
  }

  /* What a row shows, from a slot's runtime state. Compared field by
   * field on a values change, so only what moved is rewritten. */
  function cellsFor(runtime) {
    const state = runtime || {};
    const assigned = !!(state.resinName && String(state.resinName).trim());
    return {
      assigned,
      resin: assigned ? String(state.resinName) : EMPTY,
      pct: assigned ? formatPct(state.pct) : EMPTY,
      weight: assigned ? formatWeight(state.effectiveWeight) : EMPTY,
      track: !!state.track,
      pumpOff: !!state.pumpOff
    };
  }

  function subtitleFor(resolved) {
    const model = resolved && resolved.line;
    if (!model) return "No recipe to show.";
    const layers = model.line.layerCount === 1 ? "1 layer" : `${model.line.layerCount} layers`;
    const hoppers = model.hopperCount === 1 ? "1 hopper" : `${model.hopperCount} hoppers`;
    return `${lineModule.lineTitle(model)} · ${layers} · ${hoppers} · ${resolved.label}`;
  }

  /**
   * @param {Document} doc
   * @param {object} ctx
   * @param {function} ctx.commands     () -> the command bridge, or null
   * @param {function} [ctx.onCommitted] told of every ok+changed result
   * @param {function} [ctx.say]        a line for the operator (refusals)
   * @param {object} [ctx.timers]       { setTimeout, clearTimeout }
   */
  function create(doc, ctx) {
    const settings = ctx || {};
    const commandsFor = typeof settings.commands === "function" ? settings.commands : () => null;
    const onCommitted = typeof settings.onCommitted === "function" ? settings.onCommitted : () => {};
    const say = typeof settings.say === "function" ? settings.say : () => {};
    const timers = settings.timers || { setTimeout, clearTimeout };
    const readOnly = typeof settings.readOnly === "function" ? settings.readOnly : () => false;
    const guard = () => ({ readOnly: !!readOnly() });

    const rootEl = element(doc, "div", "slate-recipe", { "data-mode": "track" });

    // The bar: what is shown, and the mode switch.
    const bar = element(doc, "div", "slate-section__bar");
    const subtitle = text(doc, "p", "slate-section__subtitle", "");
    bar.appendChild(subtitle);
    const modes = element(doc, "div", "slate-modes", { role: "tablist", "aria-label": "Recipe mode" });
    const tabs = new Map();
    for (const mode of MODES) {
      const tab = text(doc, "button", "slate-modes__tab", MODE_LABEL[mode], {
        type: "button", role: "tab", "data-mode": mode, "aria-selected": mode === "track" ? "true" : "false"
      });
      tabs.set(mode, tab);
      modes.appendChild(tab);
    }
    bar.appendChild(modes);
    rootEl.appendChild(bar);

    const stub = element(doc, "p", "slate-stub", { hidden: "" });
    rootEl.appendChild(stub);

    // The column headings, then the layers.
    const columns = element(doc, "div", "slate-recipe__columns", { "aria-hidden": "true" });
    for (const [className, label] of [["id", "Hopper"], ["resin", "Resin"], ["pct", "Blend"], ["weight", "Weight"], ["controls", "Tracking"], ["mark", ""]]) {
      columns.appendChild(text(doc, "span", `slate-recipe__column slate-recipe__column--${className}`, label));
    }
    rootEl.appendChild(columns);
    const layersEl = element(doc, "div", "slate-recipe__layers");
    rootEl.appendChild(layersEl);

    // The foot: the reset, armed on the first click.
    const foot = element(doc, "div", "slate-recipe__foot");
    const reset = text(doc, "button", "slate-recipe__reset", RESET_LABEL, { type: "button", "data-able": "false" });
    foot.appendChild(reset);
    rootEl.appendChild(foot);

    let mode = "track";
    let current = null;
    const rows = new Map();
    let armTimer = null;
    let marks = {};

    /* ---- Mode ---- */

    function setMode(next) {
      if (!MODES.includes(next)) return mode;
      mode = next;
      rootEl.setAttribute("data-mode", mode);
      for (const [id, tab] of tabs) tab.setAttribute("aria-selected", id === mode ? "true" : "false");
      if (STUB[mode]) {
        stub.textContent = STUB[mode];
        stub.removeAttribute("hidden");
      } else {
        stub.textContent = "";
        stub.setAttribute("hidden", "");
      }
      disarm();
      return mode;
    }

    modes.addEventListener("click", event => {
      const target = event && event.target;
      const tab = target && typeof target.closest === "function" ? target.closest("[data-mode]") : null;
      if (tab) setMode(tab.getAttribute("data-mode"));
    });

    /* ---- Abilities ---- */

    function abilities() {
      return trackingModule.abilities(commandsFor(current), guard());
    }

    function applyAbilities() {
      const able = abilities();
      for (const entry of rows.values()) {
        if (entry.layer) continue;
        entry.toggles.tracking.setAttribute("data-able", able.tracking ? "true" : "false");
        entry.toggles.pump.setAttribute("data-able", able.pump ? "true" : "false");
        for (const control of trackingModule.CONTROLS) {
          const button = entry.toggles[control];
          const on = button.getAttribute("aria-pressed") === "true";
          const label = trackingModule.stateLabel(control, on);
          button.setAttribute("title", button.getAttribute("data-able") === "true"
            ? `${label} — click to ${trackingModule.actionLabel(control, on)}`
            : `${label} — ${trackingModule.reason(commandsFor(current), control, guard())}`);
        }
      }
      reset.setAttribute("data-able", able.reset ? "true" : "false");
      reset.setAttribute("title", able.reset ? "Clear tracking and pump-off on every hopper" : `Unavailable: ${trackingModule.reason(commandsFor(current), "reset", guard())}`);
      rootEl.classList.toggle("is-readonly", !!readOnly());
    }

    /* ---- Rows ---- */

    function toggleButton(control, hopper) {
      const button = element(doc, "button", `slate-toggle slate-toggle--${control}`, {
        type: "button",
        "data-slate-control": control,
        "data-layer": hopper.layer,
        "data-index": String(hopper.index),
        "aria-pressed": "false",
        "data-able": "false"
      });
      const dot = element(doc, "span", "slate-toggle__dot", { "aria-hidden": "true" });
      button.appendChild(dot);
      button.appendChild(text(doc, "span", "slate-toggle__label", control === "tracking" ? "Track" : "Pump off"));
      return button;
    }

    function buildRow(layer, hopper, cells) {
      const row = element(doc, "div", "slate-hopper", {
        "data-layer": layer.id, "data-index": String(hopper.index), "data-hopper": hopper.id
      });
      const id = text(doc, "span", "slate-hopper__id", hopper.id);
      const resin = text(doc, "span", "slate-hopper__resin", cells.resin);
      const pct = text(doc, "span", "slate-hopper__pct", cells.pct);
      const weight = text(doc, "span", "slate-hopper__weight", cells.weight);
      const controls = element(doc, "div", "slate-hopper__controls");
      const toggles = { tracking: toggleButton("tracking", hopper), pump: toggleButton("pump", hopper) };
      controls.appendChild(toggles.tracking);
      controls.appendChild(toggles.pump);
      const mark = element(doc, "span", "slate-hopper__mark");
      for (const cell of [id, resin, pct, weight, controls, mark]) row.appendChild(cell);
      const entry = { row, cells: { resin, pct, weight }, toggles, mark, last: null };
      paintRow(entry, cells);
      return entry;
    }

    function paintRow(entry, cells) {
      const last = entry.last || {};
      if (last.resin !== cells.resin) entry.cells.resin.textContent = cells.resin;
      if (last.pct !== cells.pct) entry.cells.pct.textContent = cells.pct;
      if (last.weight !== cells.weight) entry.cells.weight.textContent = cells.weight;
      if (last.assigned !== cells.assigned) {
        entry.row.classList.toggle("is-empty", !cells.assigned);
        for (const control of trackingModule.CONTROLS) {
          if (cells.assigned) entry.toggles[control].removeAttribute("disabled");
          else entry.toggles[control].setAttribute("disabled", "");
        }
      }
      if (last.track !== cells.track) {
        entry.toggles.tracking.setAttribute("aria-pressed", cells.track ? "true" : "false");
        entry.row.classList.toggle("is-tracked", cells.track);
      }
      if (last.pumpOff !== cells.pumpOff) {
        entry.toggles.pump.setAttribute("aria-pressed", cells.pumpOff ? "true" : "false");
        entry.row.classList.toggle("is-pump-off", cells.pumpOff);
      }
      const changed = !!entry.last && ["resin", "pct", "weight", "track", "pumpOff", "assigned"].some(key => last[key] !== cells[key]);
      entry.last = cells;
      return changed;
    }

    function rebuild(resolved) {
      rows.clear();
      while (layersEl.firstChild) layersEl.removeChild(layersEl.firstChild);
      const model = resolved && resolved.line;
      if (!model) return;
      let position = 0;
      for (const layer of model.layers) {
        const block = element(doc, "div", "slate-layer", { "data-layer": layer.id, "data-role": layer.role, "data-tone": layer.tone });
        const head = element(doc, "div", "slate-layer__head");
        head.appendChild(text(doc, "span", "slate-layer__name", `Layer ${layer.id}`));
        head.appendChild(text(doc, "span", "slate-layer__role", layer.roleLabel));
        const share = resolved.layerState[layer.id] ? resolved.layerState[layer.id].layerPct : 0;
        head.appendChild(text(doc, "span", "slate-layer__share", formatPct(share)));
        block.appendChild(head);
        const list = element(doc, "div", "slate-layer__rows");
        for (const hopper of layer.hoppers) {
          const key = `${layer.id}:${hopper.index}`;
          const entry = buildRow(layer, hopper, cellsFor(resolved.hopperState[key]));
          entry.row.classList.add("slate-row-enter");
          entry.row.style.setProperty("--slate-row-i", String(position));
          entry.row.addEventListener("animationend", () => entry.row.classList.remove("slate-row-enter", "is-updated"));
          position += 1;
          rows.set(key, entry);
          list.appendChild(entry.row);
        }
        block.appendChild(list);
        layersEl.appendChild(block);
        rows.set(`layer:${layer.id}`, { layer: true, share: head.lastChild, last: formatPct(share) });
      }
    }

    function patch(resolved, own) {
      const model = resolved && resolved.line;
      if (!model) return;
      for (const layer of model.layers) {
        const share = formatPct(resolved.layerState[layer.id] ? resolved.layerState[layer.id].layerPct : 0);
        const head = rows.get(`layer:${layer.id}`);
        if (head && head.last !== share) {
          head.share.textContent = share;
          head.last = share;
        }
        for (const hopper of layer.hoppers) {
          const key = `${layer.id}:${hopper.index}`;
          const entry = rows.get(key);
          if (!entry) continue;
          const changed = paintRow(entry, cellsFor(resolved.hopperState[key]));
          if (changed && !own) {
            // Restart the flash: the class is removed on animationend, and
            // reading the width between remove and add restarts a running one.
            entry.row.classList.remove("is-updated");
            void entry.row.offsetWidth;
            entry.row.classList.add("is-updated");
          }
        }
      }
    }

    /* ---- Marks from the run-down ---- */

    function applyMarks(next) {
      marks = next || {};
      for (const [key, entry] of rows) {
        if (entry.layer) continue;
        const mark = marks[key] || null;
        const overdue = !!(mark && mark.overdue);
        const late = !!(mark && mark.late && !mark.overdue);
        entry.row.classList.toggle("is-overdue", overdue);
        entry.row.classList.toggle("is-late", late);
        entry.mark.textContent = overdue ? "Overdue" : (late ? "Late" : "");
      }
    }

    /* ---- Track ---- */

    function disarm() {
      if (armTimer !== null) {
        timers.clearTimeout(armTimer);
        armTimer = null;
      }
      reset.removeAttribute("data-armed");
      reset.textContent = RESET_LABEL;
    }

    function arm() {
      reset.setAttribute("data-armed", "");
      reset.textContent = RESET_ARMED_LABEL;
      armTimer = timers.setTimeout(() => { armTimer = null; disarm(); }, RESET_ARM_MS);
    }

    function settle(result) {
      if (!result) return;
      if (result.ok && result.changed) onCommitted(result);
      else if (!result.ok) say(result.message || "The application refused the change.");
    }

    reset.addEventListener("click", () => {
      if (reset.getAttribute("data-able") !== "true") {
        say(`Reset is unavailable: ${trackingModule.reason(commandsFor(current), "reset", guard())}`);
        return;
      }
      if (!reset.hasAttribute("data-armed")) {
        arm();
        return;
      }
      disarm();
      settle(trackingModule.resetTracking(commandsFor(current)));
    });

    layersEl.addEventListener("click", event => {
      const target = event && event.target;
      const button = target && typeof target.closest === "function" ? target.closest("[data-slate-control]") : null;
      if (!button || !layersEl.contains(button) || button.hasAttribute("disabled")) return;
      const request = trackingModule.requestFrom(button);
      if (!request) return;
      if (!request.able) {
        say(`${trackingModule.stateLabel(request.control, request.on)}: ${trackingModule.reason(commandsFor(current), request.control, guard())}`);
        return;
      }
      settle(trackingModule.toggle(commandsFor(current), { control: request.control, layer: request.layer, index: request.index, next: !request.on }));
    });

    rootEl.addEventListener("keydown", event => {
      if (event && event.key === "Escape" && reset.hasAttribute("data-armed")) {
        disarm();
        if (typeof event.stopPropagation === "function") event.stopPropagation();
      }
    });

    /* ---- Update ---- */

    function update(resolved, meta) {
      const options = meta || {};
      const kind = options.kind || (current ? "values" : "structural");
      current = resolved;
      subtitle.textContent = subtitleFor(resolved);
      if (kind === "structural") {
        disarm();
        rebuild(resolved);
      } else if (kind === "values") {
        patch(resolved, !!options.own);
      }
      applyAbilities();
      applyMarks(marks);
    }

    return Object.freeze({
      element: rootEl,
      update,
      refresh: applyAbilities,
      applyMarks,
      setMode,
      getMode: () => mode,
      rowCount: () => [...rows.values()].filter(entry => !entry.layer).length,
      onHide: disarm
    });
  }

  return Object.freeze({ MODES, MODE_LABEL, STUB, RESET_LABEL, RESET_ARMED_LABEL, RESET_ARM_MS, EMPTY, formatPct, formatWeight, cellsFor, subtitleFor, create });
});
