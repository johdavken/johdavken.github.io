/* The Recipe section: the running recipe and the planned one, layer by
 * layer, down the page.
 *
 * Two tabs, one per recipe. Current carries the job's runtime state - the
 * tracking toggle, the receiver weight, the reset (pump-off is the
 * timeline's, where the run-down is read) - and
 * Next carries none of it: a plan is resin and blend only. Everything
 * else is the same on both: a layer's name, role and share in a column
 * at the left, its hoppers as rows beside it, and every value editable in
 * place - the resin through the catalog search, the blend and the share
 * as numbers, an assignment moved by dragging its badge onto another row.
 * With a plan, a row whose resin changes at the changeover carries a
 * band on either tab, and on Current only those rows (and any already
 * tracked or pumped off) offer Track: a resin that continues has no
 * run-down to follow. The bar holds the Compare switch (the other
 * recipe's value under each row that moves), the plan's two moves on the
 * Next tab, and Print.
 *
 * The section dispatches nothing itself. Its seams - slate-tracking.js,
 * slate-recipe-actions.js, slate-plan-actions.js - are handed the command
 * bridge the boot gives this section, and the boot is told of every
 * committed change (onCommitted) so the bridge's echo can be recognised
 * as the operator's own.
 *
 * A values publish patches rows in place and never touches an open
 * editor: the operator's own echo takes the value; another device's
 * change is marked on the row and said; a structural publish abandons the
 * edit and says so. Rows are never re-created for a value, so an armed
 * reset, a focused editor or a drag in flight keeps its element.
 */
(function (root, factory) {
  const pick = (name, file) => (typeof require === "function" ? require(file) : (root && root[name]));
  const api = factory(
    pick("PolynSlateTracking", "./slate-tracking.js"),
    pick("PolynSlateLine", "./slate-line.js"),
    pick("PolynSlateSource", "./slate-source.js"),
    pick("PolynSlateRecipeActions", "./slate-recipe-actions.js"),
    pick("PolynSlatePlanActions", "./slate-plan-actions.js"),
    pick("PolynSlateResinSearch", "./slate-resin-search.js"),
    pick("PolynSlateRecipeDrag", "./slate-recipe-drag.js"),
    pick("PolynSlateLayerMenu", "./slate-layer-menu.js"),
    pick("PolynSlatePrint", "./slate-print.js"),
    pick("PolynSlateBookActions", "./slate-book-actions.js")
  );
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynSlateRecipe = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (trackingModule, lineModule, sourceModule, actionsModule, planModule, searchModule, dragModule, menuModule, printModule, bookModule) {
  "use strict";

  const RECIPES = Object.freeze(["current", "next"]);
  const RECIPE_LABEL = Object.freeze({ current: "Current", next: "Next" });
  const RESET_LABEL = "Reset tracking";
  const RESET_ARMED_LABEL = "Confirm reset";
  const RESET_ARM_MS = 4000;
  const PROMOTE_ARMED_LABEL = "Confirm promote";
  const SAVE_LABEL = "Save as recipe\u2026";
  const SAVE_ENTRY_LABEL = Object.freeze({ current: "Save the running recipe as", next: "Save the planned recipe as" });
  const EMPTY = "—";
  const NO_PLAN = "Nothing is planned yet. Start from the running recipe, then change what the changeover needs.";
  const CHANGED_UNDERNEATH = "changed in the application while you were editing; what you are entering here has not been applied.";
  const ABANDONED = "The line changed on another device; the edit you had open was not applied.";
  const SLOT_LABEL = Object.freeze({ resin: "resin", pct: "blend", share: "share" });

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

  function show(node, on) {
    if (on) node.removeAttribute("hidden");
    else node.setAttribute("hidden", "");
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

  /* The weight cell's title when Smart Hoppers computed the weight shown:
   * where it came from, and the entered weight it stands in for. */
  function smartTitle(state) {
    const smart = state.smartWeight;
    const from = smart.resinCode ? `${smart.resinCode}'s bulk density${smart.bulkDensity ? ` (${smart.bulkDensity} lb/ft³)` : ""}` : "its resin's bulk density";
    return `Computed by Smart Hoppers from the hopper's geometry and ${from}. Entered weight: ${formatWeight(state.weight)}.`;
  }

  /* What a row shows, from a slot's state. Compared field by field on a
   * values change, so only what moved is rewritten. The weight is the
   * EFFECTIVE one; when Smart Hoppers computed it the cell says so. */
  function cellsFor(runtime) {
    const state = runtime || {};
    const assigned = !!(state.resinName && String(state.resinName).trim());
    const smart = assigned && !!(state.smartWeight && state.smartWeight.value > 0);
    return {
      assigned,
      resinName: assigned ? String(state.resinName) : "",
      pctValue: Number(state.pct) || 0,
      resin: assigned ? String(state.resinName) : EMPTY,
      pct: assigned ? formatPct(state.pct) : EMPTY,
      weight: assigned ? formatWeight(state.effectiveWeight) : EMPTY,
      smart,
      weightTitle: smart ? smartTitle(state) : "",
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
   * @param {function} ctx.commands      () -> the command bridge, or null
   * @param {function} [ctx.onCommitted] told of every ok+changed result
   * @param {function} [ctx.say]         a line for the operator
   * @param {function} [ctx.readOnly]    () -> whether Slate is read-only now
   * @param {function} [ctx.resins]      () -> the resin catalog
   * @param {object} [ctx.timers]        { setTimeout, clearTimeout }
   * @param {object} [ctx.print]         a printer (slate-print.js's create) - built here by default
   * @param {object|function} [ctx.recipes]  the recipes bridge (or () -> it), for "Save as recipe"
   */
  function create(doc, ctx) {
    const settings = ctx || {};
    const commandsFor = typeof settings.commands === "function" ? settings.commands : () => null;
    const onCommitted = typeof settings.onCommitted === "function" ? settings.onCommitted : () => {};
    const say = typeof settings.say === "function" ? settings.say : () => {};
    const timers = settings.timers || { setTimeout, clearTimeout };
    const readOnly = typeof settings.readOnly === "function" ? settings.readOnly : () => false;
    const resins = typeof settings.resins === "function" ? settings.resins : () => [];
    const guard = () => ({ readOnly: !!readOnly() });
    const commands = () => commandsFor(current);
    const recipesFor = typeof settings.recipes === "function" ? settings.recipes : () => settings.recipes || null;

    const rootEl = element(doc, "div", "slate-recipe", { "data-recipe": "current" });

    /* ---- The bar ---- */

    const bar = element(doc, "div", "slate-section__bar");
    const subtitle = text(doc, "p", "slate-section__subtitle", "");
    bar.appendChild(subtitle);

    const tabs = element(doc, "div", "slate-tabs", { role: "tablist", "aria-label": "Recipe" });
    const tabButtons = new Map();
    for (const id of RECIPES) {
      const tab = text(doc, "button", "slate-tabs__tab", RECIPE_LABEL[id], { type: "button", role: "tab", "data-recipe": id, "aria-selected": id === "current" ? "true" : "false" });
      tabButtons.set(id, tab);
      tabs.appendChild(tab);
    }
    bar.appendChild(tabs);

    const compareSwitch = text(doc, "button", "slate-switch", "Compare", { type: "button", role: "switch", "aria-checked": "false", "data-slate-compare": "", "data-able": "false" });
    bar.appendChild(compareSwitch);

    // The plan's two moves stand in the Next body's foot (built below), as
    // Current's reset does: read the plan, then act on it at its end.
    const planStrip = element(doc, "div", "slate-recipe__foot slate-recipe__plan");
    const copyButton = text(doc, "button", "slate-recipe__plan-action slate-recipe__plan-action--quiet", planModule.LABEL.copy, { type: "button", "data-slate-plan": "copy", "data-able": "false" });
    const promoteButton = text(doc, "button", "slate-recipe__plan-action slate-recipe__plan-action--promote", planModule.LABEL.promote, { type: "button", "data-slate-plan": "promote", "data-able": "false" });
    planStrip.appendChild(copyButton);
    planStrip.appendChild(promoteButton);

    const printBox = element(doc, "div", "slate-print");
    const printTrigger = text(doc, "button", "slate-print__trigger", "Print", { type: "button", "aria-haspopup": "menu", "aria-expanded": "false" });
    const printMenu = element(doc, "div", "slate-print__menu", { role: "menu", hidden: "" });
    const printItems = new Map();
    for (const which of printModule ? printModule.PAGES : ["current", "next", "both"]) {
      const item = text(doc, "button", "slate-print__item", printModule ? printModule.LABEL[which] : which, { type: "button", role: "menuitem", "data-print": which, "aria-disabled": "true" });
      printItems.set(which, item);
      printMenu.appendChild(item);
    }
    printBox.appendChild(printTrigger);
    printBox.appendChild(printMenu);
    bar.appendChild(printBox);
    rootEl.appendChild(bar);

    let recipe = "current";
    let compare = false;
    let current = null;
    let editing = null;
    let marks = {};
    let armTimer = null;
    let promoteTimer = null;
    let printOpen = false;
    let saving = null;

    /* ---- Results ---- */

    function settle(result) {
      if (!result) return result;
      if (result.ok && result.changed) onCommitted(result);
      else if (!result.ok) say(result.message || "The application refused the change.");
      return result;
    }

    /* ---- The bodies ---- */

    function makeBody(id) {
      const el = element(doc, "div", "slate-recipe__body", { "data-recipe": id });
      const columns = element(doc, "div", "slate-recipe__columns", { "aria-hidden": "true" });
      const headings = id === "current"
        ? [["id", "Hopper"], ["resin", "Resin"], ["pct", "Blend"], ["weight", "Weight"], ["controls", "Tracking"], ["mark", ""]]
        : [["id", "Hopper"], ["resin", "Resin"], ["pct", "Blend"], ["mark", ""]];
      for (const [className, label] of headings) columns.appendChild(text(doc, "span", `slate-recipe__column slate-recipe__column--${className}`, label));
      el.appendChild(columns);
      const layersEl = element(doc, "div", "slate-recipe__layers");
      el.appendChild(layersEl);
      const body = { recipe: id, el, columns, layersEl, rows: new Map(), heads: new Map(), menus: [], drag: null, empty: null, reset: null, save: null, entry: null };
      // "Save as recipe" leads each foot: the quiet way out to the Book.
      body.save = text(doc, "button", "slate-recipe__plan-action slate-recipe__plan-action--quiet slate-recipe__save", SAVE_LABEL, { type: "button", "data-slate-save": id, "data-able": "false" });
      if (id === "next") {
        const empty = element(doc, "div", "slate-recipe__empty", { hidden: "" });
        empty.appendChild(text(doc, "p", "slate-recipe__empty-text", NO_PLAN));
        empty.appendChild(text(doc, "button", "slate-recipe__plan-action", planModule.LABEL.copy, { type: "button", "data-slate-plan": "copy", "data-able": "false" }));
        el.appendChild(empty);
        body.empty = empty;
        planStrip.insertBefore(body.save, planStrip.firstChild);
        el.appendChild(planStrip);
      } else {
        const foot = element(doc, "div", "slate-recipe__foot");
        const reset = text(doc, "button", "slate-recipe__reset", RESET_LABEL, { type: "button", "data-able": "false" });
        foot.appendChild(body.save);
        foot.appendChild(reset);
        el.appendChild(foot);
        body.reset = reset;
      }
      // The name entry under the foot, built once so a publish never
      // takes the operator's typing.
      const entry = element(doc, "div", "slate-recipe__save-entry", { hidden: "" });
      const label = text(doc, "span", "slate-recipe__save-label", SAVE_ENTRY_LABEL[id]);
      const name = element(doc, "input", "slate-recipe__save-name", { type: "text", "aria-label": "Recipe name", maxlength: "120", autocomplete: "off" });
      const confirm = text(doc, "button", "slate-recipe__plan-action slate-recipe__plan-action--promote", "Save", { type: "button", "data-slate-save-do": "save" });
      const replace = text(doc, "button", "slate-recipe__plan-action", "Replace existing", { type: "button", "data-slate-save-do": "replace", hidden: "" });
      const cancel = text(doc, "button", "slate-recipe__plan-action slate-recipe__plan-action--quiet", "Cancel", { type: "button", "data-slate-save-do": "cancel" });
      const note = element(doc, "p", "slate-recipe__save-note", { role: "status", hidden: "" });
      for (const node of [label, name, confirm, replace, cancel, note]) entry.appendChild(node);
      el.appendChild(entry);
      body.entry = { el: entry, name, confirm, replace, cancel, note };
      if (dragModule) {
        body.drag = dragModule.create(doc, {
          list: layersEl,
          mount: rootEl,
          view: doc,
          able: () => actionsModule.abilities(commands(), guard()).move,
          values: row => {
            const entry = body.rows.get(`${row.getAttribute("data-layer")}:${row.getAttribute("data-index")}`);
            const last = entry && entry.last ? entry.last : {};
            return { id: row.getAttribute("data-hopper") || "", resin: last.resin || "", pct: last.pct || "" };
          },
          onDrop: ({ from, to }) => settle(actionsModule.move(commands(), id, from, to))
        });
      }
      rootEl.appendChild(el);
      return body;
    }

    const bodies = { current: makeBody("current"), next: makeBody("next") };
    show(bodies.next.el, false);

    const printer = settings.print && typeof settings.print.print === "function"
      ? settings.print
      : (printModule && typeof printModule.create === "function" ? printModule.create(doc, { mount: rootEl }) : null);

    /* ---- Rows ---- */

    function toggleButton(control, hopper) {
      const button = element(doc, "button", `slate-toggle slate-toggle--${control}`, {
        type: "button", "data-slate-control": control, "data-layer": hopper.layer, "data-index": String(hopper.index), "aria-pressed": "false", "data-able": "false"
      });
      button.appendChild(element(doc, "span", "slate-toggle__dot", { "aria-hidden": "true" }));
      button.appendChild(text(doc, "span", "slate-toggle__label", "Track"));
      return button;
    }

    function buildRow(body, layer, hopper, cells) {
      const row = element(doc, "div", "slate-hopper", { "data-layer": layer.id, "data-index": String(hopper.index), "data-hopper": hopper.id, "data-recipe": body.recipe });
      const id = text(doc, "span", "slate-hopper__id", hopper.id, { "data-slate-handle": "" });
      const resin = text(doc, "button", "slate-hopper__resin", cells.resin, { type: "button", "data-slate-edit": "resin", "data-able": "false", "aria-label": `Resin for ${hopper.id}` });
      const pct = text(doc, "button", "slate-hopper__pct", cells.pct, { type: "button", "data-slate-edit": "pct", "data-able": "false", "aria-label": `Blend for ${hopper.id}` });
      if (hopper.index === 0) {
        pct.setAttribute("data-derived", "");
        pct.setAttribute("title", "Calculated from hoppers 2–6");
      }
      row.appendChild(id);
      row.appendChild(resin);
      row.appendChild(pct);
      const entry = { row, cells: { resin, pct }, toggles: null, mark: null, other: null, note: null, last: null, layer: layer.id, index: hopper.index, hopper: hopper.id };
      if (body.recipe === "current") {
        const weight = text(doc, "span", "slate-hopper__weight", cells.weight);
        const controls = element(doc, "div", "slate-hopper__controls");
        entry.toggles = { tracking: toggleButton("tracking", hopper) };
        controls.appendChild(entry.toggles.tracking);
        entry.cells.weight = weight;
        row.appendChild(weight);
        row.appendChild(controls);
      }
      entry.mark = element(doc, "span", "slate-hopper__mark");
      entry.other = element(doc, "span", "slate-hopper__other", { hidden: "" });
      entry.note = element(doc, "p", "slate-hopper__note", { role: "status", hidden: "" });
      row.appendChild(entry.mark);
      row.appendChild(entry.other);
      row.appendChild(entry.note);
      paintRow(entry, cells, null);
      return entry;
    }

    function paintRow(entry, cells, skip) {
      const last = entry.last || {};
      if (skip !== "resin" && last.resin !== cells.resin) entry.cells.resin.textContent = cells.resin;
      if (skip !== "pct" && last.pct !== cells.pct) entry.cells.pct.textContent = cells.pct;
      if (entry.cells.weight && last.weight !== cells.weight) entry.cells.weight.textContent = cells.weight;
      if (entry.cells.weight && (last.smart !== cells.smart || last.weightTitle !== cells.weightTitle)) {
        entry.cells.weight.classList.toggle("is-smart", cells.smart);
        if (cells.weightTitle) entry.cells.weight.setAttribute("title", cells.weightTitle);
        else entry.cells.weight.removeAttribute("title");
      }
      if (last.assigned !== cells.assigned) {
        entry.row.classList.toggle("is-empty", !cells.assigned);
        if (entry.toggles) {
          for (const button of Object.values(entry.toggles)) {
            if (cells.assigned) button.removeAttribute("disabled");
            else button.setAttribute("disabled", "");
          }
        }
      }
      if (entry.toggles) {
        if (last.track !== cells.track) {
          entry.toggles.tracking.setAttribute("aria-pressed", cells.track ? "true" : "false");
          entry.row.classList.toggle("is-tracked", cells.track);
        }
        // Pump-off is read and set in the timeline; the row only shows it.
        if (last.pumpOff !== cells.pumpOff) entry.row.classList.toggle("is-pump-off", cells.pumpOff);
      }
      const changed = !!entry.last && ["resin", "pct", "weight", "smart", "track", "pumpOff", "assigned"].some(key => last[key] !== cells[key]);
      entry.last = cells;
      return changed;
    }

    function buildHead(body, layer, resolved, share) {
      const head = element(doc, "div", "slate-layer__head");
      head.appendChild(text(doc, "span", "slate-layer__name", `Layer ${layer.id}`));
      head.appendChild(text(doc, "span", "slate-layer__role", layer.roleLabel));
      const shareButton = text(doc, "button", "slate-layer__share", formatPct(share), { type: "button", "data-slate-edit": "share", "data-layer": layer.id, "data-able": "false", "aria-label": `Share for layer ${layer.id}` });
      head.appendChild(shareButton);
      const shareOther = element(doc, "span", "slate-layer__share-other", { hidden: "" });
      head.appendChild(shareOther);
      const note = element(doc, "p", "slate-layer__note", { role: "status", hidden: "" });
      head.appendChild(note);
      const others = resolved.line.layers.map(one => one.id).filter(id => id !== layer.id);
      const menu = menuModule ? menuModule.create(doc, {
        layer: layer.id,
        others,
        timers,
        say,
        able: () => { const able = actionsModule.abilities(commands(), guard()); return { copy: able.copyLayer, clear: able.clearLayer }; },
        reason: action => actionsModule.reason(commands(), action === "copy" ? "copyLayer" : "clearLayer", guard()),
        onCopyTo: toLayer => settle(actionsModule.copyLayer(commands(), body.recipe, layer.id, toLayer)),
        onClear: () => settle(actionsModule.clearLayer(commands(), body.recipe, layer.id))
      }) : null;
      if (menu) { head.appendChild(menu.element); body.menus.push(menu); }
      return { head, share: shareButton, shareOther, note, last: formatPct(share), shareValue: Number(share) || 0, layer: layer.id, menu };
    }

    function clearBody(body) {
      for (const menu of body.menus) menu.close();
      body.menus = [];
      body.rows.clear();
      body.heads.clear();
      while (body.layersEl.firstChild) body.layersEl.removeChild(body.layersEl.firstChild);
    }

    function rebuild(body, resolved) {
      clearBody(body);
      const model = resolved && resolved.line;
      const planned = body.recipe !== "next" || !!(resolved && resolved.plan && resolved.plan.planned);
      if (body.empty) show(body.empty, !!model && !planned);
      if (body.recipe === "next") show(planStrip, !!model && planned);
      show(body.columns, !!model && planned);
      if (!model || !planned) return;
      const state = sourceModule.stateFor(resolved, body.recipe);
      let position = 0;
      for (const layer of model.layers) {
        const block = element(doc, "div", "slate-layer", { "data-layer": layer.id, "data-role": layer.role, "data-tone": layer.tone, "data-recipe": body.recipe });
        const share = state.layers[layer.id] ? state.layers[layer.id].layerPct : 0;
        const head = buildHead(body, layer, resolved, share);
        block.appendChild(head.head);
        body.heads.set(layer.id, head);
        const list = element(doc, "div", "slate-layer__rows");
        for (const hopper of layer.hoppers) {
          const key = `${layer.id}:${hopper.index}`;
          const entry = buildRow(body, layer, hopper, cellsFor(state.hoppers[key]));
          entry.row.classList.add("slate-row-enter");
          entry.row.style.setProperty("--slate-row-i", String(position));
          entry.row.addEventListener("animationend", () => entry.row.classList.remove("slate-row-enter", "is-updated"));
          position += 1;
          body.rows.set(key, entry);
          list.appendChild(entry.row);
        }
        block.appendChild(list);
        body.layersEl.appendChild(block);
      }
    }

    function flash(row) {
      // Restart the flash: the class is removed on animationend, and
      // reading the width between remove and add restarts a running one.
      row.classList.remove("is-updated");
      void row.offsetWidth;
      row.classList.add("is-updated");
    }

    function patch(body, resolved, own) {
      const model = resolved && resolved.line;
      if (!model) return;
      const state = sourceModule.stateFor(resolved, body.recipe);
      for (const layer of model.layers) {
        const head = body.heads.get(layer.id);
        const shareValue = state.layers[layer.id] ? state.layers[layer.id].layerPct : 0;
        if (head) {
          const editingHere = !!(editing && editing.slot === "share" && editing.recipe === body.recipe && editing.layer === layer.id);
          const shareText = formatPct(shareValue);
          if (!editingHere && head.last !== shareText) { head.share.textContent = shareText; head.last = shareText; }
          if (editingHere && !own && head.shareValue !== shareValue) markUnderneath(`Layer ${layer.id}'s share`);
          head.shareValue = shareValue;
          head.last = shareText;
        }
        for (const hopper of layer.hoppers) {
          const key = `${layer.id}:${hopper.index}`;
          const entry = body.rows.get(key);
          if (!entry) continue;
          const cells = cellsFor(state.hoppers[key]);
          const editingHere = editing && editing.recipe === body.recipe && editing.key === key ? editing.slot : null;
          const before = entry.last || {};
          const changed = paintRow(entry, cells, editingHere);
          if (editingHere && !own) {
            const moved = editingHere === "resin" ? before.resinName !== cells.resinName : before.pctValue !== cells.pctValue;
            if (moved) markUnderneath(`${entry.hopper}'s ${SLOT_LABEL[editingHere]}`);
          }
          if (changed && !own && !editingHere) flash(entry.row);
        }
      }
    }

    /* ---- Compare ---- */

    // What the other recipe says under a row, only where something moves:
    // the resin (with its blend) where the resin changes, "empty" where
    // the other side has nothing, the blend alone where only that moves.
    function otherLine(tag, other) {
      if (other.resinDiffers) return `${tag}: ${other.resin ? `${other.resin} · ${formatPct(other.pct)}` : "empty"}`;
      if (other.pctDiffers) return `${tag}: ${formatPct(other.pct)}`;
      return null;
    }

    // With a plan, every row knows whether its resin changes at the
    // changeover, on either tab: that carries the row's band and decides
    // whether Track is offered (only a resin that goes away - swapped or
    // emptied - has a run-down to track; a toggle already on stays, so it
    // can be turned off; a hopper that only fills next has nothing to
    // track). The Compare switch adds the lines that say what the other
    // recipe holds; the blend alone moving is a line, no band.
    function paintCompare() {
      rootEl.classList.toggle("is-comparing", compare);
      for (const id of RECIPES) {
        const body = bodies[id];
        const changes = sourceModule.compareFor(current, id);
        const tag = id === "next" ? "Current" : "Next";
        for (const [key, entry] of body.rows) {
          const other = changes ? changes.hoppers[key] : null;
          const line = compare && other ? otherLine(tag, other) : null;
          entry.row.classList.toggle("is-differs", !!(other && other.resinDiffers));
          if (line) entry.other.textContent = line;
          show(entry.other, !!line);
          if (entry.toggles) {
            const last = entry.last || {};
            const offered = !other || (other.resinDiffers && !!last.assigned) || !!last.track || !!last.pumpOff;
            show(entry.toggles.tracking, offered);
          }
        }
        for (const [layerId, head] of body.heads) {
          const other = changes ? changes.layers[layerId] : null;
          const line = compare && other && other.differs;
          if (line) head.shareOther.textContent = `${tag} ${formatPct(other.share)}`;
          show(head.shareOther, !!line);
        }
      }
    }

    function setCompare(on) {
      const can = !!(current && current.plan && current.plan.planned);
      compare = !!on && can;
      compareSwitch.setAttribute("aria-checked", compare ? "true" : "false");
      paintCompare();
      return compare;
    }

    /* ---- Abilities ---- */

    function applyAbilities() {
      const bridge = commands();
      const options = guard();
      const able = actionsModule.abilities(bridge, options);
      const track = trackingModule.abilities(bridge, options);
      const planned = !!(current && current.plan && current.plan.planned);
      const plan = planModule.can(bridge, { readOnly: options.readOnly, planned });
      rootEl.classList.toggle("is-readonly", !!readOnly());

      for (const id of RECIPES) {
        const body = bodies[id];
        for (const entry of body.rows.values()) {
          entry.cells.resin.setAttribute("data-able", able.resin ? "true" : "false");
          entry.cells.resin.setAttribute("title", able.resin ? "Change the resin" : `Cannot change here: ${actionsModule.reason(bridge, "resin", options)}`);
          const derived = entry.index === 0;
          entry.cells.pct.setAttribute("data-able", able.blend && !derived ? "true" : "false");
          if (!derived) entry.cells.pct.setAttribute("title", able.blend ? "Change the blend" : `Cannot change here: ${actionsModule.reason(bridge, "blend", options)}`);
          entry.row.classList.toggle("is-movable", able.move && !entry.row.classList.contains("is-empty"));
          if (entry.toggles) {
            entry.toggles.tracking.setAttribute("data-able", track.tracking ? "true" : "false");
            for (const control of Object.keys(entry.toggles)) {
              const button = entry.toggles[control];
              const on = button.getAttribute("aria-pressed") === "true";
              const label = trackingModule.stateLabel(control, on);
              button.setAttribute("title", button.getAttribute("data-able") === "true"
                ? `${label} — click to ${trackingModule.actionLabel(control, on)}`
                : `${label} — ${trackingModule.reason(bridge, control, options)}`);
            }
          }
        }
        for (const head of body.heads.values()) {
          head.share.setAttribute("data-able", able.share ? "true" : "false");
          head.share.setAttribute("title", able.share ? "Change the layer's share" : `Cannot change here: ${actionsModule.reason(bridge, "share", options)}`);
          if (head.menu) head.menu.refresh();
        }
        if (body.reset) {
          body.reset.setAttribute("data-able", track.reset ? "true" : "false");
          body.reset.setAttribute("title", track.reset ? "Clear tracking and pump-off on every hopper" : `Unavailable: ${trackingModule.reason(bridge, "reset", options)}`);
        }
      }

      const book = bookModule ? bookModule.can(recipesFor(), { readOnly: options.readOnly, planned }) : { saveCurrent: false, saveNext: false };
      for (const id of RECIPES) {
        const control = id === "next" ? "saveNext" : "saveCurrent";
        const button = bodies[id].save;
        button.setAttribute("data-able", book[control] ? "true" : "false");
        button.setAttribute("title", book[control] ? "Save this recipe to the line's Recipe Book" : `Save as recipe is unavailable: ${bookModule ? bookModule.reason(recipesFor(), control, { readOnly: options.readOnly, planned }) : "no application is connected to Slate's saved recipes."}`);
      }
      if (saving && !book[saving.recipe === "next" ? "saveNext" : "saveCurrent"]) closeSave();

      const planButtons = [copyButton, promoteButton].concat(bodies.next.empty ? Array.from(bodies.next.empty.querySelectorAll("[data-slate-plan]")) : []);
      for (const button of planButtons) {
        const action = button.getAttribute("data-slate-plan");
        button.setAttribute("data-able", plan[action] ? "true" : "false");
        button.setAttribute("title", plan[action] ? planModule.LABEL[action] : `${planModule.LABEL[action]} is unavailable: ${planModule.reason(bridge, action, { readOnly: options.readOnly, planned })}`);
      }

      compareSwitch.setAttribute("data-able", planned ? "true" : "false");
      compareSwitch.setAttribute("title", planned ? "Show the other recipe under each hopper" : "Nothing is planned to compare against");
      if (!planned && compare) setCompare(false);

      for (const [which, item] of printItems) {
        const can = !!printer && !!printModule && printModule.available(which, current);
        item.setAttribute("aria-disabled", can ? "false" : "true");
        item.setAttribute("title", can ? "" : (which === "current" ? "Nothing is assigned to print" : "Nothing is planned to print"));
      }
    }

    /* ---- Marks from the run-down (Current only) ---- */

    function applyMarks(next) {
      marks = next || {};
      for (const [key, entry] of bodies.current.rows) {
        const mark = marks[key] || null;
        const overdue = !!(mark && mark.overdue);
        const late = !!(mark && mark.late && !mark.overdue);
        entry.row.classList.toggle("is-overdue", overdue);
        entry.row.classList.toggle("is-late", late);
        entry.mark.textContent = overdue ? "Overdue" : (late ? "Late" : "");
      }
    }

    /* ---- Editors ---- */

    function noteFor(target) {
      return target.entry ? target.entry.note : target.head.note;
    }

    function setNote(target, message, invalid) {
      const note = noteFor(target);
      note.textContent = message || "";
      show(note, !!message);
      const control = target.control;
      if (control && typeof control.setAttribute === "function") {
        if (invalid) control.setAttribute("aria-invalid", "true");
        else control.removeAttribute("aria-invalid");
      }
    }

    function markUnderneath(what) {
      if (!editing) return;
      const target = editing;
      (target.entry ? target.entry.row : target.head.head).classList.add("is-changed-underneath");
      setNote(target, `${what} ${CHANGED_UNDERNEATH}`, false);
    }

    function closeEditor() {
      if (!editing) return;
      const target = editing;
      editing = null;
      if (target.search && typeof target.search.close === "function") target.search.close();
      if (target.input && target.input.parentNode) target.input.parentNode.removeChild(target.input);
      show(target.button, true);
      const host = target.entry ? target.entry.row : target.head.head;
      host.classList.remove("is-editing", "is-changed-underneath");
      const note = noteFor(target);
      note.textContent = "";
      show(note, false);
      // The cell shows the canonical value again.
      if (target.entry) {
        const last = target.entry.last || {};
        if (target.slot === "resin") target.entry.cells.resin.textContent = last.resin || EMPTY;
        else target.entry.cells.pct.textContent = last.pct || EMPTY;
      } else {
        target.head.share.textContent = target.head.last;
      }
      if (typeof target.button.focus === "function") target.button.focus();
    }

    function abandonEdit(own) {
      if (!editing) return;
      closeEditor();
      if (!own) say(ABANDONED);
    }

    function commitValue(target, value) {
      if (!editing || editing !== target) return null;
      const bridge = commands();
      const able = actionsModule.abilities(bridge, guard());
      const control = target.slot === "pct" ? "blend" : target.slot;
      const slotAble = target.slot === "resin" ? able.resin : (target.slot === "pct" ? able.blend : able.share);
      if (!slotAble) {
        const reason = actionsModule.reason(bridge, control, guard());
        setNote(target, `Cannot change here: ${reason}`, true);
        return { ok: false, code: "unavailable", message: reason };
      }
      let result;
      if (target.slot === "resin") result = actionsModule.setResin(bridge, target.recipe, target.layer, target.index, value);
      else if (target.slot === "pct") result = actionsModule.setBlend(bridge, target.recipe, target.layer, target.index, value);
      else result = actionsModule.setShare(bridge, target.recipe, target.layer, value);
      if (result && result.ok) {
        closeEditor();
        if (result.changed) onCommitted(result);
      } else {
        setNote(target, (result && result.message) || "The application refused the change.", true);
      }
      return result;
    }

    /* The resin search over a row's cell. A refused code reopens the
     * search on that code, with the application's words in the row's note,
     * so the operator can go on from where they were. */
    function openSearch(target, value) {
      target.search = searchModule.open(doc, target.entry.row, {
        value,
        resins,
        id: `slate-resin-${target.recipe}-${target.layer}-${target.index}`,
        label: `Resin for ${target.entry.hopper}`,
        // The search stands in the resin cell, not at the row's end.
        before: target.button.nextSibling,
        onChoose: code => {
          if (!editing || editing !== target) return;
          target.search = null;
          target.control = null;
          if ((code === "" && !target.base) || sourceModule.sameResin(code, target.base)) { closeEditor(); return; }
          const result = commitValue(target, code);
          if (result && !result.ok && editing === target) {
            const message = noteFor(target).textContent;
            openSearch(target, code);
            setNote(target, message, true);
          }
        },
        onCancel: () => { if (editing === target) { target.search = null; target.control = null; closeEditor(); } }
      });
      target.control = target.search.input;
    }

    function openEditor(target) {
      if (editing) closeEditor();
      const bridge = commands();
      const able = actionsModule.abilities(bridge, guard());
      const control = target.slot === "pct" ? "blend" : target.slot;
      const slotAble = target.slot === "resin" ? able.resin : (target.slot === "pct" ? able.blend : able.share);
      if (target.slot === "pct" && target.index === 0) { say("Hopper 1's blend is calculated from hoppers 2–6."); return null; }
      if (!slotAble) { say(`Cannot change the ${SLOT_LABEL[target.slot]} here: ${actionsModule.reason(bridge, control, guard())}`); return null; }
      editing = target;
      const host = target.entry ? target.entry.row : target.head.head;
      host.classList.add("is-editing");
      show(target.button, false);
      if (target.slot === "resin") {
        const last = target.entry.last || {};
        target.base = last.resinName || "";
        openSearch(target, target.base);
        return target;
      }
      const input = element(doc, "input", target.entry ? "slate-hopper__input" : "slate-layer__input", {
        type: "text", inputmode: "decimal", "aria-label": target.entry ? `Blend for ${target.entry.hopper}` : `Share for layer ${target.layer}`
      });
      const baseValue = target.entry ? (target.entry.last ? target.entry.last.pctValue : 0) : target.head.shareValue;
      target.base = baseValue;
      input.value = baseValue > 0 ? String(baseValue) : "";
      target.input = input;
      target.control = input;
      const commit = () => {
        if (!editing || editing !== target) return;
        const raw = String(input.value).trim();
        if (raw === "" || Number(raw.replace(/,/g, "")) === target.base) { closeEditor(); return; }
        commitValue(target, raw);
      };
      input.addEventListener("keydown", event => {
        if (!event) return;
        if (event.key === "Enter") { if (typeof event.preventDefault === "function") event.preventDefault(); commit(); }
        else if (event.key === "Escape") { if (typeof event.stopPropagation === "function") event.stopPropagation(); closeEditor(); }
      });
      input.addEventListener("blur", () => { if (editing === target) commit(); });
      host.insertBefore(input, target.button.nextSibling);
      if (typeof input.focus === "function") input.focus();
      if (typeof input.select === "function") input.select();
      return target;
    }

    function editTargetFrom(button, body) {
      const slot = button.getAttribute("data-slate-edit");
      if (slot === "share") {
        const head = body.heads.get(button.getAttribute("data-layer"));
        return head ? { slot, recipe: body.recipe, layer: head.layer, index: null, key: null, head, button } : null;
      }
      const row = button.closest(".slate-hopper");
      const entry = row ? body.rows.get(`${row.getAttribute("data-layer")}:${row.getAttribute("data-index")}`) : null;
      return entry ? { slot, recipe: body.recipe, layer: entry.layer, index: entry.index, key: `${entry.layer}:${entry.index}`, entry, button } : null;
    }

    /* ---- Tabs, compare, plan, print ---- */

    function closeMenus() {
      for (const id of RECIPES) for (const menu of bodies[id].menus) menu.close();
      closePrint();
    }

    function setRecipe(id) {
      if (!RECIPES.includes(id)) return recipe;
      if (id !== recipe) {
        closeEditor();
        closeSave();
        for (const key of RECIPES) if (bodies[key].drag) bodies[key].drag.cancel();
        disarm();
        disarmPromote();
        closeMenus();
        recipe = id;
        rootEl.setAttribute("data-recipe", recipe);
        for (const [key, tab] of tabButtons) tab.setAttribute("aria-selected", key === recipe ? "true" : "false");
        for (const key of RECIPES) show(bodies[key].el, key === recipe);
      }
      applyAbilities();
      paintCompare();
      return recipe;
    }

    tabs.addEventListener("click", event => {
      const target = event && event.target;
      const tab = target && typeof target.closest === "function" ? target.closest("[data-recipe]") : null;
      if (tab && tabs.contains(tab)) setRecipe(tab.getAttribute("data-recipe"));
    });

    compareSwitch.addEventListener("click", () => {
      if (compareSwitch.getAttribute("data-able") !== "true") { say("Nothing is planned to compare against."); return; }
      setCompare(!compare);
    });

    function disarmPromote() {
      if (promoteTimer !== null) { timers.clearTimeout(promoteTimer); promoteTimer = null; }
      promoteButton.removeAttribute("data-armed");
      promoteButton.textContent = planModule.LABEL.promote;
    }

    function onPlan(button) {
      const action = button.getAttribute("data-slate-plan");
      if (button.getAttribute("data-able") !== "true") { say(button.getAttribute("title") || `${planModule.LABEL[action]} is unavailable.`); return; }
      if (action === "copy") { closeEditor(); settle(planModule.copy(commands())); return; }
      if (!promoteButton.hasAttribute("data-armed")) {
        promoteButton.setAttribute("data-armed", "");
        promoteButton.textContent = PROMOTE_ARMED_LABEL;
        promoteTimer = timers.setTimeout(() => { promoteTimer = null; disarmPromote(); }, RESET_ARM_MS);
        return;
      }
      disarmPromote();
      closeEditor();
      settle(planModule.promote(commands()));
    }

    /* ---- Save as recipe ---- */

    function setSaveNote(body, message, kind) {
      const note = body.entry.note;
      note.textContent = message || "";
      note.classList.toggle("is-error", kind === "error");
      show(note, !!message);
    }

    function openSave(id) {
      const body = bodies[id];
      if (body.save.getAttribute("data-able") !== "true") { say(body.save.getAttribute("title") || "Save as recipe is unavailable."); return; }
      if (saving && saving.recipe !== id) closeSave();
      closeEditor();
      disarm();
      disarmPromote();
      saving = { recipe: id, existing: null, busy: false };
      body.entry.name.value = "";
      body.entry.name.removeAttribute("aria-invalid");
      show(body.entry.replace, false);
      setSaveNote(body, "");
      show(body.entry.el, true);
      if (typeof body.entry.name.focus === "function") body.entry.name.focus();
    }

    function closeSave() {
      if (!saving) return;
      const body = bodies[saving.recipe];
      saving = null;
      body.entry.name.value = "";
      body.entry.name.removeAttribute("aria-invalid");
      show(body.entry.replace, false);
      setSaveNote(body, "");
      show(body.entry.el, false);
    }

    function setSaveBusy(body, busy) {
      for (const button of [body.entry.confirm, body.entry.replace, body.entry.cancel]) {
        if (busy) button.setAttribute("disabled", "");
        else button.removeAttribute("disabled");
      }
    }

    async function commitSave() {
      const open = saving;
      if (!open || open.busy || !bookModule) return;
      const body = bodies[open.recipe];
      const name = bookModule.cleanName(body.entry.name.value);
      if (!name) { body.entry.name.setAttribute("aria-invalid", "true"); setSaveNote(body, bookModule.WORDING.nameNeeded, "error"); return; }
      open.busy = true;
      setSaveBusy(body, true);
      let result;
      try {
        result = await bookModule.save(recipesFor(), open.recipe, name);
      } finally {
        open.busy = false;
        if (saving === open) setSaveBusy(body, false);
      }
      if (saving !== open) return;
      if (result.ok) { closeSave(); say(bookModule.WORDING.saved(name)); return; }
      body.entry.name.setAttribute("aria-invalid", "true");
      if (result.code === "duplicate_name" && result.existing) {
        open.existing = result.existing;
        show(body.entry.replace, true);
        setSaveNote(body, bookModule.WORDING.duplicateOffer(result.existing.name), "error");
      } else if (result.code === "duplicate_name") {
        setSaveNote(body, bookModule.WORDING.duplicateOther, "error");
      } else {
        setSaveNote(body, result.message || "The application refused the change.", "error");
      }
    }

    async function replaceSaved() {
      const open = saving;
      if (!open || open.busy || !open.existing || !bookModule) return;
      const body = bodies[open.recipe];
      open.busy = true;
      setSaveBusy(body, true);
      let result;
      try {
        result = await bookModule.replace(recipesFor(), open.existing.id);
      } finally {
        open.busy = false;
        if (saving === open) setSaveBusy(body, false);
      }
      if (saving !== open) return;
      if (result.ok) { const name = open.existing.name; closeSave(); say(bookModule.WORDING.replaced(name)); return; }
      setSaveNote(body, result.message || "The recipe could not be replaced.", "error");
    }

    // The Book's abilities move on their own publishes (a line joined, a
    // refresh), not only on the state bridge's: follow them.
    const recipes = recipesFor();
    if (recipes && typeof recipes.subscribe === "function") recipes.subscribe(() => applyAbilities());

    for (const id of RECIPES) {
      const body = bodies[id];
      body.save.addEventListener("click", () => openSave(id));
      body.entry.el.addEventListener("click", event => {
        const target = event && event.target;
        const button = target && typeof target.closest === "function" ? target.closest("[data-slate-save-do]") : null;
        if (!button || button.hasAttribute("disabled")) return;
        const what = button.getAttribute("data-slate-save-do");
        if (what === "save") commitSave();
        else if (what === "replace") replaceSaved();
        else closeSave();
      });
      body.entry.name.addEventListener("keydown", event => {
        if (!event) return;
        if (event.key === "Enter") { if (typeof event.preventDefault === "function") event.preventDefault(); commitSave(); }
        else if (event.key === "Escape") { if (typeof event.stopPropagation === "function") event.stopPropagation(); closeSave(); }
      });
    }

    for (const host of [planStrip, bodies.next.empty]) {
      if (!host) continue;
      host.addEventListener("click", event => {
        const target = event && event.target;
        const button = target && typeof target.closest === "function" ? target.closest("[data-slate-plan]") : null;
        if (button) onPlan(button);
      });
    }

    function outsidePrint(event) {
      if (event && event.target && printBox.contains(event.target)) return;
      closePrint();
    }
    function openPrint() {
      if (printOpen) return;
      printOpen = true;
      show(printMenu, true);
      printTrigger.setAttribute("aria-expanded", "true");
      printBox.classList.add("is-open");
      if (typeof doc.addEventListener === "function") doc.addEventListener("pointerdown", outsidePrint, true);
    }
    function closePrint() {
      if (!printOpen) return;
      printOpen = false;
      show(printMenu, false);
      printTrigger.setAttribute("aria-expanded", "false");
      printBox.classList.remove("is-open");
      if (typeof doc.removeEventListener === "function") doc.removeEventListener("pointerdown", outsidePrint, true);
    }
    printTrigger.addEventListener("click", () => { if (printOpen) closePrint(); else openPrint(); });
    printMenu.addEventListener("click", event => {
      const target = event && event.target;
      const item = target && typeof target.closest === "function" ? target.closest("[data-print]") : null;
      if (!item) return;
      const which = item.getAttribute("data-print");
      if (item.getAttribute("aria-disabled") === "true") { say(item.getAttribute("title") || "Nothing to print."); return; }
      closePrint();
      if (!printer) { say("Printing is not available on this page."); return; }
      const result = printer.print(which, current);
      if (!result || !result.ok) say((result && result.message) || "The sheet could not be printed.");
    });

    /* ---- Track (Current body) ---- */

    function disarm() {
      if (armTimer !== null) { timers.clearTimeout(armTimer); armTimer = null; }
      const reset = bodies.current.reset;
      reset.removeAttribute("data-armed");
      reset.textContent = RESET_LABEL;
    }

    bodies.current.reset.addEventListener("click", () => {
      const reset = bodies.current.reset;
      if (reset.getAttribute("data-able") !== "true") {
        say(`Reset is unavailable: ${trackingModule.reason(commands(), "reset", guard())}`);
        return;
      }
      if (!reset.hasAttribute("data-armed")) {
        reset.setAttribute("data-armed", "");
        reset.textContent = RESET_ARMED_LABEL;
        armTimer = timers.setTimeout(() => { armTimer = null; disarm(); }, RESET_ARM_MS);
        return;
      }
      disarm();
      settle(trackingModule.resetTracking(commands()));
    });

    /* ---- Clicks inside a body: toggles and edit cells ---- */

    for (const id of RECIPES) {
      const body = bodies[id];
      body.layersEl.addEventListener("click", event => {
        if (body.drag && body.drag.consumeClick()) return;
        const target = event && event.target;
        if (!target || typeof target.closest !== "function") return;
        const toggle = target.closest("[data-slate-control]");
        if (toggle && body.layersEl.contains(toggle)) {
          if (toggle.hasAttribute("disabled")) return;
          const request = trackingModule.requestFrom(toggle);
          if (!request) return;
          if (!request.able) {
            say(`${trackingModule.stateLabel(request.control, request.on)}: ${trackingModule.reason(commands(), request.control, guard())}`);
            return;
          }
          settle(trackingModule.toggle(commands(), { control: request.control, layer: request.layer, index: request.index, next: !request.on }));
          return;
        }
        const edit = target.closest("[data-slate-edit]");
        if (edit && body.layersEl.contains(edit)) {
          if (editing && editing.button === edit) return;
          const found = editTargetFrom(edit, body);
          if (found) openEditor(found);
        }
      });
    }

    rootEl.addEventListener("keydown", event => {
      if (!event || event.key !== "Escape") return;
      if (editing) { closeEditor(); if (typeof event.stopPropagation === "function") event.stopPropagation(); return; }
      if (saving) { closeSave(); if (typeof event.stopPropagation === "function") event.stopPropagation(); return; }
      if (bodies.current.reset.hasAttribute("data-armed") || promoteButton.hasAttribute("data-armed")) {
        disarm();
        disarmPromote();
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
        abandonEdit(!!options.own);
        for (const id of RECIPES) if (bodies[id].drag) bodies[id].drag.cancel();
        disarm();
        disarmPromote();
        closeMenus();
        for (const id of RECIPES) rebuild(bodies[id], resolved);
      } else if (kind === "values") {
        for (const id of RECIPES) patch(bodies[id], resolved, !!options.own);
      }
      applyAbilities();
      paintCompare();
      applyMarks(marks);
    }

    function onHide() {
      closeEditor();
      closeSave();
      for (const id of RECIPES) if (bodies[id].drag) bodies[id].drag.cancel();
      disarm();
      disarmPromote();
      closeMenus();
    }

    return Object.freeze({
      element: rootEl,
      update,
      refresh: applyAbilities,
      applyMarks,
      setRecipe,
      getRecipe: () => recipe,
      setCompare,
      getCompare: () => compare,
      body: id => (bodies[id] ? bodies[id].el : null),
      rowCount: id => bodies[id || recipe].rows.size,
      editing: () => (editing ? { slot: editing.slot, recipe: editing.recipe, layer: editing.layer, index: editing.index } : null),
      saving: () => (saving ? { recipe: saving.recipe, existing: saving.existing, busy: saving.busy } : null),
      onHide
    });
  }

  return Object.freeze({
    RECIPES, RECIPE_LABEL, RESET_LABEL, RESET_ARMED_LABEL, RESET_ARM_MS, PROMOTE_ARMED_LABEL, SAVE_LABEL, SAVE_ENTRY_LABEL, EMPTY, NO_PLAN, CHANGED_UNDERNEATH, ABANDONED,
    formatPct, formatWeight, cellsFor, subtitleFor, create
  });
});
