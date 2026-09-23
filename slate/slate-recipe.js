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
 * band on either tab. How Current offers Track is the tracking MODE's
 * (slate-display.js keeps the preference, slate-tracking.js the rules):
 * Assisted, the default, offers it only on those rows (and any already
 * tracked or pumped off) - a resin that continues has no run-down to
 * follow; Manual offers it on every row; Automatic offers none and has
 * this section track those hoppers itself, one deferred batch after a
 * publish or a mode change, only ever turning tracking on, and never
 * while Slate is read-only or without a live bridge. The bar holds the
 * Compare switch (the other recipe's value under each row that moves),
 * the plan's two moves on the Next tab, Bulk edit, and Print.
 *
 * Bulk edit is the tab as a form: every resin and blend cell a field at
 * once (slate-recipe-form.js), nothing on the line until Apply, and
 * Apply ONE setHopperAssignments carrying only what changed (the diff is
 * slate-recipe-draft.js's). While it is open the other edits - cells,
 * shares, drag, the layer menu, the plan's moves, Save, Reset - are
 * withheld, so a change is either in the draft or on the line, never
 * both; Track stays, being the job's and not the recipe's. Under the
 * form a hopper id picks its row (Shift for a run, a layer's name for
 * the layer) and the foot's fill strip writes one resin and/or blend
 * into every picked row's field - the draft again, one Apply. Cancel
 * arms while there are changes. Another device's value under a drafted row
 * marks it and rebases its diff; a structural publish abandons the form.
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
    pick("PolynSlateBookActions", "./slate-book-actions.js"),
    pick("PolynSlateRecipeDraft", "./slate-recipe-draft.js"),
    pick("PolynSlateRecipeForm", "./slate-recipe-form.js")
  );
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynSlateRecipe = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (trackingModule, lineModule, sourceModule, actionsModule, planModule, searchModule, dragModule, menuModule, printModule, bookModule, draftModule, formModule) {
  "use strict";

  /* A press outside, by the shared rule - a finger closes on a still
   * release, a mouse on the press - and the Back key's stack
   * (slate-dismiss.js). */
  function dismissal(target, inside, close) {
    const shared = typeof require === "function" ? require("./slate-dismiss.js") : (typeof globalThis !== "undefined" ? globalThis.PolynSlateDismiss : null);
    return shared && typeof shared.outside === "function" ? shared.outside(target, inside, close) : Object.freeze({ start() {}, stop() {}, isOn: () => false });
  }

  const RECIPES = Object.freeze(["current", "next"]);
  /* What the Scan menu offers, in the application's own words for them
   * (recipe-scan-ui.js source types). */
  const SCAN_KINDS = Object.freeze([["job_traveler", "Job traveler"], ["dosing_screen", "Dosing screen"]]);
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
  const BULK_LABEL = "Bulk edit";
  const BULK_APPLY_LABEL = "Apply";
  const BULK_CANCEL_LABEL = "Cancel";
  const BULK_BUSY = "Apply or cancel the bulk edit first.";
  const BULK_NO_ROWS = "Nothing is planned to edit.";
  const BULK_ABANDONED = "The line changed on another device; the bulk edit you had open was not applied.";
  const BULK_READ_ONLY = "Slate became read-only; the bulk edit was closed and nothing was applied.";
  const BULK_NO_BRIDGE = "The application stopped offering the bulk edit; it was closed and nothing was applied.";
  const BULK_SWITCH = "Apply or cancel the bulk edit before switching tabs.";
  const BULK_HINT = "Click a hopper id to select rows and fill them at once.";
  const FILL_LABEL = "Fill";
  const FILL_NOTHING = "Enter a resin or a blend to fill into the selected hoppers.";
  const FILL_NONE = "Nothing to fill: the selected hoppers already hold that, or only hopper 1 was selected for a blend.";
  const selectedLabel = count => (count === 1 ? "1 selected" : `${count} selected`);
  const discardLabel = count => (count === 1 ? "Discard 1 change" : `Discard ${count} changes`);
  const discardedNote = count => (count === 1 ? "The bulk edit was closed; 1 change was not applied." : `The bulk edit was closed; ${count} changes were not applied.`);

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
   * @param {function} [ctx.trackingMode] () -> "automatic"|"assisted"|"manual" (automatic by default)
   * @param {function} [ctx.resins]      () -> the resin catalog
   * @param {object} [ctx.timers]        { setTimeout, clearTimeout }
   * @param {object} [ctx.print]         a printer (slate-print.js's create) - built here by default
   * @param {object|function} [ctx.recipes]  the recipes bridge (or () -> it), for "Save as recipe"
   * @param {function} [ctx.validate]    the application's validateHopperPercentages, for the bulk edit's totals
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
    const trackingMode = typeof settings.trackingMode === "function" ? settings.trackingMode : () => trackingModule.DEFAULT_MODE;
    const modeNow = () => trackingModule.modeOf(trackingMode());
    const commands = () => commandsFor(current);
    const recipesFor = typeof settings.recipes === "function" ? settings.recipes : () => settings.recipes || null;
    const validate = typeof settings.validate === "function" ? settings.validate : null;
    // Drawn for a finger (slate/slate-tier.js, via the boot): editors keep
    // the keyboard's hide key from cancelling or committing, and nothing
    // pops the keyboard unasked.
    const touch = () => {
      try { return typeof settings.tier === "function" && settings.tier().input === "touch"; } catch (error) { return false; }
    };
    const view = doc.defaultView || null;

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

    const bulkButton = text(doc, "button", "slate-switch slate-recipe__bulk", BULK_LABEL, { type: "button", "aria-pressed": "false", "data-slate-bulk": "", "data-able": "false" });
    bar.appendChild(bulkButton);

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

    // Scan: in Print's place under a finger (recipe-edit.css shows one or
    // the other). A job traveler or a dosing screen photographed into the
    // tab on screen, through the application's own scan flow.
    const scanBox = element(doc, "div", "slate-scan");
    const scanTrigger = text(doc, "button", "slate-scan__trigger", "Scan", { type: "button", "aria-haspopup": "menu", "aria-expanded": "false" });
    const scanMenu = element(doc, "div", "slate-scan__menu", { role: "menu", hidden: "" });
    const scanItems = new Map();
    for (const [kind, label] of SCAN_KINDS) {
      const item = text(doc, "button", "slate-scan__item", label, { type: "button", role: "menuitem", "data-scan": kind, "aria-disabled": "true" });
      scanItems.set(kind, item);
      scanMenu.appendChild(item);
    }
    scanBox.appendChild(scanTrigger);
    scanBox.appendChild(scanMenu);
    bar.appendChild(scanBox);
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
    // The bulk edit: the body drafted, its form, and the armed Cancel.
    let form = null;
    // Automatic tracking: the one pending batch, whether one is running,
    // and the refusals not to ask again (key -> the pair refused).
    let autoTimer = null;
    let autoRunning = false;
    const declined = new Map();

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
      const body = { recipe: id, el, columns, layersEl, rows: new Map(), heads: new Map(), menus: [], drag: null, empty: null, reset: null, save: null, entry: null, foot: null, bulk: null };
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
        body.foot = planStrip;
      } else {
        const foot = element(doc, "div", "slate-recipe__foot");
        const reset = text(doc, "button", "slate-recipe__reset", RESET_LABEL, { type: "button", "data-able": "false" });
        foot.appendChild(body.save);
        foot.appendChild(reset);
        el.appendChild(foot);
        body.reset = reset;
        body.foot = foot;
      }
      // The bulk edit's foot, in the normal foot's place while a form is
      // open: what would change, the application's answer, Cancel, Apply.
      const bulk = element(doc, "div", "slate-recipe__foot slate-recipe__bulk-foot", { hidden: "" });
      // The fill strip, shown while rows are picked: a resin and/or a
      // blend for all of them, each blank meaning no change there.
      const fill = element(doc, "div", "slate-recipe__fill", { hidden: "" });
      const fillCount = text(doc, "span", "slate-recipe__fill-count", "");
      const fillBox = element(doc, "div", "slate-recipe__fill-field");
      const fillResin = element(doc, "input", "slate-recipe__fill-resin", { type: "text", autocomplete: "off", spellcheck: "false", autocapitalize: "characters", enterkeyhint: "done", maxlength: String(searchModule.CODE_MAX), "aria-label": "Resin to fill into the selected hoppers", placeholder: "Resin (no change)", "data-slate-fill-field": "resin" });
      fillBox.appendChild(fillResin);
      const fillPct = element(doc, "input", "slate-recipe__fill-pct", { type: "text", inputmode: "decimal", enterkeyhint: "done", autocomplete: "off", "aria-label": "Blend to fill into the selected hoppers", placeholder: "Blend (no change)", "data-slate-fill-field": "pct" });
      const fillButton = text(doc, "button", "slate-recipe__plan-action", FILL_LABEL, { type: "button", "data-slate-fill": "fill" });
      const fillClear = text(doc, "button", "slate-recipe__plan-action slate-recipe__plan-action--quiet", "Clear selection", { type: "button", "data-slate-fill": "clear" });
      for (const node of [fillCount, fillBox, fillPct, fillButton, fillClear]) fill.appendChild(node);
      searchModule.attach(doc, fillResin, { resins, host: fillBox, id: `slate-fill-${id}` });
      bulk.appendChild(fill);
      const summary = text(doc, "p", "slate-recipe__bulk-summary", "", { role: "status" });
      const hint = text(doc, "span", "slate-recipe__bulk-hint", BULK_HINT);
      const bulkNote = element(doc, "p", "slate-recipe__bulk-note", { role: "status", hidden: "" });
      const bulkCancel = text(doc, "button", "slate-recipe__plan-action slate-recipe__plan-action--quiet", BULK_CANCEL_LABEL, { type: "button", "data-slate-bulk-do": "cancel" });
      const bulkApply = text(doc, "button", "slate-recipe__plan-action slate-recipe__plan-action--promote", BULK_APPLY_LABEL, { type: "button", "data-slate-bulk-do": "apply", "data-able": "false" });
      for (const node of [summary, hint, bulkNote, bulkCancel, bulkApply]) bulk.appendChild(node);
      el.appendChild(bulk);
      body.bulk = { el: bulk, summary, hint, note: bulkNote, cancel: bulkCancel, apply: bulkApply, fill: { el: fill, count: fillCount, resin: fillResin, pct: fillPct, button: fillButton, clear: fillClear } };
      // The name entry under the foot, built once so a publish never
      // takes the operator's typing.
      const entry = element(doc, "div", "slate-recipe__save-entry", { hidden: "" });
      const label = text(doc, "span", "slate-recipe__save-label", SAVE_ENTRY_LABEL[id]);
      const name = element(doc, "input", "slate-recipe__save-name", { type: "text", "aria-label": "Recipe name", maxlength: "120", autocomplete: "off", enterkeyhint: "done" });
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
          able: () => !form && actionsModule.abilities(commands(), guard()).move,
          values: row => {
            const entry = body.rows.get(`${row.getAttribute("data-layer")}:${row.getAttribute("data-index")}`);
            const last = entry && entry.last ? entry.last : {};
            return { id: row.getAttribute("data-hopper") || "", resin: last.resin || "", pct: last.pct || "" };
          },
          onDrop: ({ from, to }) => settle(actionsModule.move(commands(), id, from, to)),
          timers
        });
      }
      rootEl.appendChild(el);
      return body;
    }

    const bodies = { current: makeBody("current"), next: makeBody("next") };
    show(bodies.next.el, false);

    // The application's scanner, handed in by the boot: { able(), start(kind, recipe) }.
    const scanner = settings.scan && typeof settings.scan.start === "function" ? settings.scan : null;
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
      const entry = { row, idCell: id, cells: { resin, pct }, toggles: null, mark: null, other: null, note: null, last: null, layer: layer.id, index: hopper.index, hopper: hopper.id };
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
      const keepResin = skip === "resin" || skip === "all";
      const keepPct = skip === "pct" || skip === "all";
      if (!keepResin && last.resin !== cells.resin) entry.cells.resin.textContent = cells.resin;
      if (!keepPct && last.pct !== cells.pct) entry.cells.pct.textContent = cells.pct;
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
        able: () => { const able = actionsModule.abilities(commands(), guard()); return { copy: !form && able.copyLayer, clear: !form && able.clearLayer }; },
        reason: action => (form ? BULK_BUSY : actionsModule.reason(commands(), action === "copy" ? "copyLayer" : "clearLayer", guard())),
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
      model.layers.forEach((layer, i) => {
        const block = element(doc, "div", "slate-layer", { "data-layer": layer.id, "data-role": layer.role, "data-tone": layer.tone, "data-recipe": body.recipe });
        // Its place in the line's order, for the sheet to run the layers
        // the other way (the Layer order preference).
        block.style.setProperty("--slate-layer-i", String(i));
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
      });
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
          const drafting = !!(form && form.recipe === body.recipe);
          const editingHere = drafting ? "all" : (editing && editing.recipe === body.recipe && editing.key === key ? editing.slot : null);
          const before = entry.last || {};
          const changed = paintRow(entry, cells, editingHere);
          if (drafting) {
            // The field keeps what was typed; the diff moves to the new value.
            if (!own && (before.resinName !== cells.resinName || before.pctValue !== cells.pctValue)) form.view.rebase(key, state.hoppers[key]);
            continue;
          }
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
    // changeover, on either tab: that carries the row's band and, with
    // the tracking mode, decides whether Track is offered (the rule is
    // slate-tracking.js's offersToggle). The Compare switch adds the
    // lines that say what the other recipe holds; the blend alone moving
    // is a line, no band.
    function paintCompare() {
      rootEl.classList.toggle("is-comparing", compare);
      const mode = modeNow();
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
            const offered = trackingModule.offersToggle(mode, {
              planned: !!other, resinDiffers: !!(other && other.resinDiffers), assigned: !!last.assigned, track: !!last.track, pumpOff: !!last.pumpOff
            });
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
      // An open form outlives neither read-only nor the command it needs.
      if (form && !able.assign) discardForm(options.readOnly ? BULK_READ_ONLY : BULK_NO_BRIDGE);
      const busy = !!form;
      const held = control => (busy ? BULK_BUSY : actionsModule.reason(bridge, control, options));

      for (const id of RECIPES) {
        const body = bodies[id];
        for (const entry of body.rows.values()) {
          entry.cells.resin.setAttribute("data-able", able.resin && !busy ? "true" : "false");
          entry.cells.resin.setAttribute("title", able.resin && !busy ? "Change the resin" : `Cannot change here: ${held("resin")}`);
          const derived = entry.index === 0;
          entry.cells.pct.setAttribute("data-able", able.blend && !derived && !busy ? "true" : "false");
          if (!derived) entry.cells.pct.setAttribute("title", able.blend && !busy ? "Change the blend" : `Cannot change here: ${held("blend")}`);
          const movable = able.move && !busy && !entry.row.classList.contains("is-empty");
          entry.row.classList.toggle("is-movable", movable);
          // The badge a finger may lift (recipe-edit.css holds the page still under it).
          if (movable) entry.idCell.setAttribute("data-movable", "");
          else entry.idCell.removeAttribute("data-movable");
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
          head.share.setAttribute("data-able", able.share && !busy ? "true" : "false");
          head.share.setAttribute("title", able.share && !busy ? "Change the layer's share" : `Cannot change here: ${held("share")}`);
          if (head.menu) head.menu.refresh();
        }
        if (body.reset) {
          body.reset.setAttribute("data-able", track.reset && !busy ? "true" : "false");
          body.reset.setAttribute("title", track.reset && !busy ? "Clear tracking and pump-off on every hopper" : `Unavailable: ${busy ? BULK_BUSY : trackingModule.reason(bridge, "reset", options)}`);
        }
      }

      const book = bookModule ? bookModule.can(recipesFor(), { readOnly: options.readOnly, planned }) : { saveCurrent: false, saveNext: false };
      for (const id of RECIPES) {
        const control = id === "next" ? "saveNext" : "saveCurrent";
        const button = bodies[id].save;
        button.setAttribute("data-able", book[control] && !busy ? "true" : "false");
        button.setAttribute("title", book[control] && !busy ? "Save this recipe to the line's Recipe Book" : `Save as recipe is unavailable: ${busy ? BULK_BUSY : (bookModule ? bookModule.reason(recipesFor(), control, { readOnly: options.readOnly, planned }) : "no application is connected to Slate's saved recipes.")}`);
      }
      if (saving && !book[saving.recipe === "next" ? "saveNext" : "saveCurrent"]) closeSave();

      const planButtons = [copyButton, promoteButton].concat(bodies.next.empty ? Array.from(bodies.next.empty.querySelectorAll("[data-slate-plan]")) : []);
      for (const button of planButtons) {
        const action = button.getAttribute("data-slate-plan");
        button.setAttribute("data-able", plan[action] && !busy ? "true" : "false");
        button.setAttribute("title", plan[action] && !busy ? planModule.LABEL[action] : `${planModule.LABEL[action]} is unavailable: ${busy ? BULK_BUSY : planModule.reason(bridge, action, { readOnly: options.readOnly, planned })}`);
      }

      // Bulk edit: the command, not read-only, and rows on the shown tab.
      const rows = bodies[recipe].rows.size > 0;
      const bulkAble = able.assign && rows;
      bulkButton.setAttribute("data-able", bulkAble ? "true" : "false");
      bulkButton.setAttribute("aria-pressed", form ? "true" : "false");
      bulkButton.setAttribute("title", form
        ? "Close the bulk edit (Cancel)"
        : (bulkAble ? "Edit every hopper on this tab, then apply once" : `Bulk edit is unavailable: ${able.assign ? BULK_NO_ROWS : actionsModule.reason(bridge, "assign", options)}`));
      if (form) paintForm();

      compareSwitch.setAttribute("data-able", planned ? "true" : "false");
      compareSwitch.setAttribute("title", planned ? "Show the other recipe under each hopper" : "Nothing is planned to compare against");
      if (!planned && compare) setCompare(false);

      for (const [which, item] of printItems) {
        const can = !!printer && !!printModule && printModule.available(which, current);
        item.setAttribute("aria-disabled", can ? "false" : "true");
        item.setAttribute("title", can ? "" : (which === "current" ? "Nothing is assigned to print" : "Nothing is planned to print"));
      }

      paintScan(able, bridge, options);
    }

    /* ---- Automatic tracking (Current only) ---- */

    // The rows Automatic wants tracked now: the plan swaps or empties
    // their resin and they are not tracked yet - less any the application
    // refused for the same pair, until the plan or the mode moves.
    function wantedRows() {
      const changes = sourceModule.compareFor(current, "current");
      if (!changes) return [];
      const mode = modeNow();
      const rows = [];
      for (const [key, entry] of bodies.current.rows) {
        const other = changes.hoppers[key];
        const last = entry.last || {};
        if (!trackingModule.wantsTracking(mode, { planned: !!other, resinDiffers: !!(other && other.resinDiffers), assigned: !!last.assigned, track: !!last.track })) continue;
        const signature = `${last.resinName}|${other.resin}`;
        if (declined.get(key) === signature) continue;
        rows.push({ key, layer: entry.layer, index: entry.index, signature });
      }
      return rows;
    }

    // The batch, on the tick after the publish that called for it, so no
    // command runs inside the bridge's own publish. Everything is asked
    // again here: the mode, the bridge and the plan may all have moved
    // since the batch was scheduled. The boot is told once, of the last
    // change, so its own-revision matches the flush the bridge coalesces
    // the batch into; the operator hears the first refusal once.
    function autoTrack() {
      autoTimer = null;
      if (autoRunning || modeNow() !== "automatic") return;
      const bridge = commands();
      if (!trackingModule.abilities(bridge, guard()).tracking) return;
      const rows = wantedRows();
      if (!rows.length) return;
      autoRunning = true;
      try {
        const results = trackingModule.trackMany(bridge, rows);
        let last = null;
        let failure = null;
        results.forEach((result, i) => {
          if (result && result.ok && result.changed) last = result;
          else if (result && !result.ok) {
            declined.set(rows[i].key, rows[i].signature);
            if (!failure) failure = result;
          }
        });
        if (last) onCommitted(last);
        if (failure) say(`Automatic tracking: ${failure.message || "the application refused the change."}`);
      } finally {
        autoRunning = false;
      }
    }

    function scheduleAutoTrack() {
      if (autoRunning || autoTimer !== null || modeNow() !== "automatic") return;
      autoTimer = timers.setTimeout(autoTrack, 0);
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
      if (target.wrap && target.wrap.parentNode) target.wrap.parentNode.removeChild(target.wrap);
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
        touch: touch(),
        view,
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
      if (form) { say(`Cannot change the ${SLOT_LABEL[target.slot]} here: ${BULK_BUSY}`); return null; }
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
      input.addEventListener("blur", () => { if (editing === target && !target.cancelling) commit(); });
      // An abandoned Cancel press (no click followed) is forgotten when the
      // field is taken again, so its blur commits as before.
      input.addEventListener("focus", () => { target.cancelling = false; });
      host.insertBefore(input, target.button.nextSibling);
      // Under a finger Escape is out of reach, and a blur commits: Cancel is
      // a button whose press keeps the field's focus, so it wins over the blur.
      // The field and its Cancel stand together, before the field has focus
      // (moving a focused field would blur it, and the blur commits).
      if (touch()) {
        const wrap = element(doc, "div", "slate-editor-field");
        const cancel = text(doc, "button", "slate-editor-cancel", "×", { type: "button", "aria-label": "Cancel", title: "Cancel", "data-slate-cancel": "" });
        const hold = event => { target.cancelling = true; if (event && typeof event.preventDefault === "function") event.preventDefault(); };
        cancel.addEventListener("pointerdown", hold);
        cancel.addEventListener("mousedown", hold);
        cancel.addEventListener("click", () => { if (editing === target) closeEditor(); });
        host.insertBefore(wrap, input);
        wrap.appendChild(input);
        wrap.appendChild(cancel);
        target.wrap = wrap;
      }
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
      closeScan();
    }

    function setRecipe(id) {
      if (!RECIPES.includes(id)) return recipe;
      if (id !== recipe) {
        if (form && form.view.changes().length > 0) { say(BULK_SWITCH); return recipe; }
        closeForm();
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

    const printCloser = dismissal(doc, node => printBox.contains(node), () => closePrint());
    function openPrint() {
      if (printOpen) return;
      printOpen = true;
      show(printMenu, true);
      printTrigger.setAttribute("aria-expanded", "true");
      printBox.classList.add("is-open");
      printCloser.start();
    }
    function closePrint() {
      if (!printOpen) return;
      printOpen = false;
      show(printMenu, false);
      printTrigger.setAttribute("aria-expanded", "false");
      printBox.classList.remove("is-open");
      printCloser.stop();
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

    /* ---- Scan ---- */

    // Why a scan cannot start now, or "" when it can: the scan writes the
    // recipe, so it needs what an edit needs, and the application needs a
    // connected line to read the photo.
    function scanReason(able, bridge, options) {
      if (!scanner) return "not on this page";
      if (!able.assign) return actionsModule.reason(bridge, "assign", options);
      let ready = null;
      try { ready = typeof scanner.able === "function" ? scanner.able() : { ok: true }; } catch (error) { ready = { ok: false, reason: "the scanner did not answer" }; }
      return ready && ready.ok ? "" : ((ready && ready.reason) || "not available");
    }

    // The items say whether a scan can start. Painted with the other
    // abilities and again as the menu opens - a line connected since the
    // last publish is known at once.
    function paintScan(able, bridge, options) {
      const commandsNow = bridge === undefined ? commands() : bridge;
      const guardNow = options === undefined ? guard() : options;
      const ableNow = able === undefined ? actionsModule.abilities(commandsNow, guardNow) : able;
      const why = scanReason(ableNow, commandsNow, guardNow);
      for (const item of scanItems.values()) {
        item.setAttribute("aria-disabled", why ? "true" : "false");
        item.setAttribute("title", why ? `Scanning is unavailable: ${why}` : `Into the ${recipe === "next" ? "Next" : "Current"} recipe`);
      }
    }

    let scanOpen = false;
    const scanCloser = dismissal(doc, node => scanBox.contains(node), () => closeScan());
    function openScan() {
      if (scanOpen) return;
      scanOpen = true;
      paintScan();
      show(scanMenu, true);
      scanTrigger.setAttribute("aria-expanded", "true");
      scanBox.classList.add("is-open");
      scanCloser.start();
    }
    function closeScan() {
      if (!scanOpen) return;
      scanOpen = false;
      show(scanMenu, false);
      scanTrigger.setAttribute("aria-expanded", "false");
      scanBox.classList.remove("is-open");
      scanCloser.stop();
    }
    scanTrigger.addEventListener("click", () => { if (scanOpen) closeScan(); else openScan(); });
    scanMenu.addEventListener("click", event => {
      const target = event && event.target;
      const item = target && typeof target.closest === "function" ? target.closest("[data-scan]") : null;
      if (!item) return;
      if (item.getAttribute("aria-disabled") === "true") { say(item.getAttribute("title") || "Scanning is unavailable."); return; }
      closeScan();
      // The tab on screen is the recipe the scan is for; the application
      // asks for the photo, reads it, and shows its review before anything
      // changes.
      scanner.start(item.getAttribute("data-scan"), recipe);
    });

    /* ---- Bulk edit ---- */

    function disarmCancelOn(open) {
      if (open.armTimer !== null) { timers.clearTimeout(open.armTimer); open.armTimer = null; }
      open.body.bulk.cancel.removeAttribute("data-armed");
      open.body.bulk.cancel.textContent = BULK_CANCEL_LABEL;
    }

    function disarmCancel() {
      if (form) disarmCancelOn(form);
    }

    // The foot follows the draft: the count, the layers that would be
    // refused, and whether Apply may be pressed.
    function paintForm() {
      if (!form) return;
      const body = form.body;
      const changes = form.view.changes();
      const problems = form.view.problems();
      const totals = form.view.totals().filter(total => !total.ok);
      body.bulk.summary.textContent = draftModule.summary(changes);
      for (const [layerId, head] of body.heads) {
        const bad = totals.find(total => total.layer === layerId);
        head.note.textContent = bad ? bad.message : "";
        show(head.note, !!bad);
        head.head.classList.toggle("is-over", !!bad);
      }
      const able = changes.length > 0 && problems.length === 0 && totals.length === 0;
      body.bulk.apply.setAttribute("data-able", able ? "true" : "false");
      body.bulk.apply.setAttribute("title", able ? "Apply every change as one" : (changes.length === 0 ? "Nothing changes yet" : (problems[0] ? problems[0].message : totals[0].message)));
      if (form.armTimer !== null && changes.length === 0) disarmCancel();
    }

    function setBulkNote(message) {
      if (!form) return;
      form.body.bulk.note.textContent = message || "";
      show(form.body.bulk.note, !!message);
    }

    // The strip follows the selection; the hint stands while nothing is picked.
    function paintFill() {
      if (!form) return;
      const count = form.view.picked().length;
      const strip = form.body.bulk.fill;
      show(strip.el, count > 0);
      show(form.body.bulk.hint, count === 0);
      strip.count.textContent = selectedLabel(count);
    }

    function resetFill(body) {
      body.bulk.fill.resin.value = "";
      body.bulk.fill.pct.value = "";
      body.bulk.fill.pct.removeAttribute("aria-invalid");
      show(body.bulk.fill.el, false);
    }

    function doFill() {
      if (!form) return;
      const strip = form.body.bulk.fill;
      const values = { resin: strip.resin.value, pct: strip.pct.value };
      if (String(values.resin).trim() === "" && String(values.pct).trim() === "") { say(FILL_NOTHING); return; }
      const problem = String(values.pct).trim() === "" ? null : draftModule.pctProblem(values.pct);
      if (problem) { strip.pct.setAttribute("aria-invalid", "true"); say(problem); return; }
      strip.pct.removeAttribute("aria-invalid");
      if (!form.view.fill(values)) say(FILL_NONE);
    }

    function openForm() {
      if (form) { discardOrArm(); return; }
      if (bulkButton.getAttribute("data-able") !== "true") { say(bulkButton.getAttribute("title") || "Bulk edit is unavailable."); return; }
      const body = bodies[recipe];
      const model = current && current.line;
      if (!model || !body.rows.size) { say(BULK_NO_ROWS); return; }
      closeEditor();
      closeSave();
      if (body.drag) body.drag.cancel();
      disarm();
      disarmPromote();
      closeMenus();
      const state = sourceModule.stateFor(current, body.recipe);
      const formView = formModule.create(doc, body, {
        base: draftModule.baseFrom(state, model),
        model,
        resins,
        sameResin: sourceModule.sameResin,
        validate,
        onChange: () => paintForm(),
        onLast: () => { if (typeof body.bulk.apply.focus === "function") body.bulk.apply.focus(); },
        onPick: () => paintFill(),
        touch: touch(),
        view
      });
      form = { recipe: body.recipe, body, view: formView, armTimer: null };
      resetFill(body);
      show(body.bulk.hint, true);
      show(body.foot, false);
      show(body.bulk.el, true);
      setBulkNote("");
      applyAbilities();
      // A finger taps the field it wants; focusing one would pop the
      // keyboard over the form's own foot.
      if (!touch()) formView.focusFirst();
    }

    // The form goes; the cells show the canonical value again, as
    // closeEditor's do, since a publish under the form left them alone.
    function closeForm() {
      if (!form) return;
      const open = form;
      form = null;
      disarmCancelOn(open);
      open.view.destroy();
      for (const entry of open.body.rows.values()) {
        const last = entry.last || {};
        entry.cells.resin.textContent = last.resin || EMPTY;
        entry.cells.pct.textContent = last.pct || EMPTY;
      }
      for (const head of open.body.heads.values()) { head.note.textContent = ""; show(head.note, false); head.head.classList.remove("is-over"); }
      show(open.body.bulk.el, false);
      resetFill(open.body);
      open.body.bulk.note.textContent = "";
      show(open.body.bulk.note, false);
      const planned = !!(current && current.plan && current.plan.planned);
      show(open.body.foot, open.body.recipe !== "next" || planned);
      applyAbilities();
      if (typeof bulkButton.focus === "function") bulkButton.focus();
    }

    /** Close and say what was lost, when something was. */
    function discardForm(message) {
      if (!form) return;
      const count = form.view.changes().length;
      closeForm();
      if (message) say(message);
      else if (count > 0) say(discardedNote(count));
    }

    function abandonForm(own) {
      if (!form) return;
      closeForm();
      if (!own) say(BULK_ABANDONED);
    }

    // Cancel: at once with nothing to lose; armed for a moment otherwise.
    function discardOrArm() {
      if (!form) return;
      const count = form.view.changes().length;
      if (count === 0) { closeForm(); return; }
      if (form.body.bulk.cancel.hasAttribute("data-armed")) { discardForm(); return; }
      form.body.bulk.cancel.setAttribute("data-armed", "");
      form.body.bulk.cancel.textContent = discardLabel(count);
      form.armTimer = timers.setTimeout(() => { if (form) { form.armTimer = null; disarmCancel(); } }, RESET_ARM_MS);
    }

    function applyForm() {
      if (!form) return null;
      const open = form;
      const body = open.body;
      if (body.bulk.apply.getAttribute("data-able") !== "true") { say(body.bulk.apply.getAttribute("title") || "Nothing to apply."); return null; }
      const bridge = commands();
      if (!actionsModule.abilities(bridge, guard()).assign) { setBulkNote(`Cannot apply: ${actionsModule.reason(bridge, "assign", guard())}`); return null; }
      const changes = open.view.changes();
      disarmCancel();
      const result = actionsModule.applyAssignments(bridge, body.recipe, changes);
      if (result && result.ok) {
        closeForm();
        if (result.changed) { onCommitted(result); say(draftModule.applied(changes)); }
        return result;
      }
      setBulkNote((result && result.message) || "The application refused the change.");
      return result;
    }

    bulkButton.addEventListener("click", () => openForm());
    for (const id of RECIPES) {
      bodies[id].bulk.el.addEventListener("click", event => {
        const target = event && event.target;
        const button = target && typeof target.closest === "function" ? target.closest("[data-slate-bulk-do]") : null;
        if (!button || !form || form.recipe !== id) return;
        if (button.getAttribute("data-slate-bulk-do") === "apply") applyForm();
        else discardOrArm();
      });
      bodies[id].bulk.fill.el.addEventListener("click", event => {
        const target = event && event.target;
        const button = target && typeof target.closest === "function" ? target.closest("[data-slate-fill]") : null;
        if (!button || !form || form.recipe !== id) return;
        if (button.getAttribute("data-slate-fill") === "fill") doFill();
        else form.view.clearPicked();
      });
      // Enter in either strip field fills (an Enter the open list spent
      // never gets here).
      bodies[id].bulk.fill.el.addEventListener("keydown", event => {
        if (!event || event.key !== "Enter" || !form || form.recipe !== id) return;
        const target = event.target;
        if (!target || !target.hasAttribute || !target.hasAttribute("data-slate-fill-field")) return;
        if (typeof event.preventDefault === "function") event.preventDefault();
        doFill();
      });
    }

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
        if (form && form.recipe === id) {
          const idCell = target.closest(".slate-hopper__id");
          if (idCell && body.layersEl.contains(idCell)) {
            const picked = idCell.closest(".slate-hopper");
            form.view.pick(`${picked.getAttribute("data-layer")}:${picked.getAttribute("data-index")}`, { range: !!event.shiftKey });
            return;
          }
          const name = target.closest(".slate-layer__name");
          if (name && body.layersEl.contains(name)) {
            form.view.pickLayer(name.closest(".slate-layer").getAttribute("data-layer"));
            return;
          }
        }
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
      if (form) { discardOrArm(); if (typeof event.stopPropagation === "function") event.stopPropagation(); return; }
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
        abandonForm(!!options.own);
        abandonEdit(!!options.own);
        for (const id of RECIPES) if (bodies[id].drag) bodies[id].drag.cancel();
        disarm();
        disarmPromote();
        closeMenus();
        declined.clear();
        for (const id of RECIPES) rebuild(bodies[id], resolved);
      } else if (kind === "values") {
        for (const id of RECIPES) patch(bodies[id], resolved, !!options.own);
      }
      applyAbilities();
      paintCompare();
      applyMarks(marks);
      scheduleAutoTrack();
    }

    // A preference moved (read-only, the tracking mode): every control
    // re-reads its ability, Track is offered afresh, and Automatic - if
    // that is what moved, or what read-only now allows - tracks at once.
    // A refusal is forgotten here: the operator's own change is a fair
    // moment to ask again.
    function refresh() {
      declined.clear();
      applyAbilities();
      paintCompare();
      scheduleAutoTrack();
    }

    function onHide() {
      discardForm();
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
      refresh,
      applyMarks,
      setRecipe,
      getRecipe: () => recipe,
      setCompare,
      getCompare: () => compare,
      body: id => (bodies[id] ? bodies[id].el : null),
      rowCount: id => bodies[id || recipe].rows.size,
      editing: () => (editing ? { slot: editing.slot, recipe: editing.recipe, layer: editing.layer, index: editing.index } : null),
      saving: () => (saving ? { recipe: saving.recipe, existing: saving.existing, busy: saving.busy } : null),
      bulk: () => (form ? { recipe: form.recipe, changes: form.view.changes().length, armed: form.body.bulk.cancel.hasAttribute("data-armed"), picked: form.view.picked() } : null),
      onHide
    });
  }

  return Object.freeze({
    RECIPES, RECIPE_LABEL, RESET_LABEL, RESET_ARMED_LABEL, RESET_ARM_MS, PROMOTE_ARMED_LABEL, SAVE_LABEL, SAVE_ENTRY_LABEL, EMPTY, NO_PLAN, CHANGED_UNDERNEATH, ABANDONED,
    BULK_LABEL, BULK_BUSY, BULK_NO_ROWS, BULK_ABANDONED, BULK_READ_ONLY, BULK_NO_BRIDGE, BULK_SWITCH, BULK_HINT, FILL_NOTHING, FILL_NONE, discardLabel, discardedNote, selectedLabel,
    formatPct, formatWeight, cellsFor, subtitleFor, create
  });
});
