/* The Station run-down timeline: a thin horizontal axis across the foot of
 * the workspace, Now at its left edge, each tracked hopper marked where it
 * is expected to run empty, the changeover as a boundary through it.
 *
 * WHAT IT IS
 *
 * A renderer over station-rundown.js. Everything drawn is that module's
 * answer to "given what the application holds right now, and the clock,
 * where does each hopper land"; this file measures the width, hands the
 * inputs over, and writes the answer to the DOM. It holds no estimate of
 * its own, decrements nothing, and never writes back: a marker is a
 * button that opens a detail, not a control on the job. Tracking - what
 * puts a hopper on the axis and takes it off - is the drawn hopper's own
 * control (station-hopper-controls.js), and arrives here through the
 * bridge as any other change does.
 *
 * WHAT IT HOLDS
 *
 * Presentation state only:
 *
 *   window      6 or 12 hours - a scale, not a fact about the job. Chosen
 *               on the timeline itself: the 6H | 12H selector under the
 *               Now clock
 *   reset       what the boot file last said of a tracking reset - offered
 *               or not, why not, and how many hoppers it would touch - and
 *               whether the RESET word under the selector is armed. The
 *               one control here that acts on the job: every hopper
 *               untracked and its pump marked running, as the floor UI's
 *               Reset tracking (one resetTracking command, through the
 *               boot file's callback - this module dispatches nothing).
 *               Easy to do by accident and slow to undo by hand, so it is
 *               two clicks in place (station-armed.js): the first ARMS
 *               the word, which turns the warning colour and waits; the
 *               second confirms. A pause, a click anywhere else, Escape
 *               or the focus leaving all disarm it. It stands in the Now
 *               column, under the scale, because this row is where the
 *               tracking it resets is explained
 *   observed    slot -> { weight, at }: when this screen last saw each
 *               tracked hopper's weight change, which anchors its estimate
 *               so the marker moves with the clock (see station-rundown.js
 *               on why the application itself has no such timestamp)
 *   detail      which marker's detail is showing, and whether it is pinned
 *               by a click or only following the pointer or focus
 *
 * THE CLOCK
 *
 * Real time, coarsely: one pass every twenty seconds moves every marker
 * and the Now clock. Nothing is animated between passes - a marker moves
 * about a pixel a minute at the six-hour scale, and a pass is a handful of
 * nodes. The pass is a self-rescheduling timeout rather than an interval
 * so a hidden tab's throttled timer never queues up a burst, and the page
 * becoming visible or focused runs one pass at once, so a laptop opened
 * after an hour's sleep never shows the hour-old picture.
 */
(function (root, factory) {
  const rundown = typeof require === "function"
    ? require("./station-rundown.js")
    : (root && root.PolynStationRundown);
  const armed = typeof require === "function"
    ? require("./station-armed.js")
    : (root && root.PolynStationArmed);
  const api = factory(rundown, armed);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynStationRundownTimeline = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (rundownModule, armedModule) {
  "use strict";

  const TICK_MS = 20 * 1000;
  /* The reset's word on the row, and its name to a reader and on hover. */
  const RESET_TEXT = "Reset";
  const RESET_LABEL = "Reset Tracking";
  /* What the layout works with when the track has not been laid out yet
   * (a first render before the stylesheet, or a test document). */
  const FALLBACK_WIDTH = 1000;
  /* Past this many entries the right-hand column folds the rest into one
   * "+N" chip, so several far-off hoppers never grow a side panel. */
  const SIDE_LIMIT = 4;
  const DETAIL_ID = "station-rundown-detail";
  /* Half a tick label's width: a label whose centre is this close to the
   * changeover's box would show from under it. */
  const LABEL_HALF_PX = 28;

  function element(doc, name, className, attributes) {
    const node = doc.createElement(name);
    if (className) node.setAttribute("class", className);
    if (attributes) {
      for (const key of Object.keys(attributes)) node.setAttribute(key, attributes[key]);
    }
    return node;
  }

  function text(doc, name, className, value, attributes) {
    const node = element(doc, name, className, attributes);
    node.textContent = value;
    return node;
  }

  function clearChildren(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function show(node, on) {
    if (on) node.removeAttribute("hidden");
    else node.setAttribute("hidden", "");
  }

  function percent(fraction) {
    return `${(Math.max(0, Math.min(1, fraction)) * 100).toFixed(3)}%`;
  }

  /* The one inline declaration a positioned node carries: its place along
   * the axis as a custom property the stylesheet spends. */
  function placeAt(node, fraction) {
    node.setAttribute("style", `--station-rundown-x: ${percent(fraction)};`);
  }

  /* What a marker says in words, for its label and its detail: with a
   * changeover, the pump-off point; without one, the run-empty estimate
   * (station-rundown.js: WHERE THE MARKER STANDS). */
  function describe(entry, rundown) {
    if (entry.reason) return `${entry.id}: ${rundown.reasonLabel(entry.reason)}`;
    if (entry.markKind === "pump-off") {
      const by = rundown.formatClock(entry.pumpOffBy);
      if (entry.pumpOff) return `${entry.id}: pump off, empty in ${rundown.formatRemaining(entry.remainingMs)}`;
      if (entry.late) return `${entry.id}: late - pump off by ${by} to run empty by the changeover`;
      return `${entry.id}: pump off in ${rundown.formatRemaining(entry.untilMs)}, by ${by}, to run empty by the changeover`;
    }
    const when = rundown.formatClock(entry.emptyAt);
    if (entry.past) return `${entry.id}: estimated empty since ${when}`;
    return `${entry.id}: empty in ${rundown.formatRemaining(entry.remainingMs)}, at ${when}${entry.pumpOff ? ", pump off" : ""}`;
  }

  /* A hopper's run-down facts in one line, for a group's listing: the
   * pump-off point (or the empty-at estimate, when there is no
   * changeover), the empty-at estimate, the run-down duration. */
  function memberFacts(entry, rundown) {
    const facts = [];
    if (entry.markKind === "pump-off") {
      facts.push(entry.pumpOff ? "pump off" : `pump off by ${rundown.formatClock(entry.pumpOffBy)}${entry.late ? " · late" : ""}`);
    }
    facts.push(`empty ${rundown.formatClock(entry.emptyAt)}`);
    if (Number.isFinite(entry.durationMs)) facts.push(`${rundown.formatRemaining(entry.durationMs)} run-down`);
    return facts.join(" · ");
  }

  /* What a collapsed group says: how many, when, and who. */
  function describeGroup(group, rundown) {
    const first = group.entries[0];
    const when = first.markKind === "pump-off"
      ? (first.late ? "past their pump-off point" : `pumping off by ${rundown.formatClock(first.pumpOffBy)}`)
      : `empty by ${rundown.formatClock(first.emptyAt)}`;
    return `${group.entries.length} hoppers ${when}: ${group.entries.map(e => e.id).join(", ")}`;
  }

  /**
   * Build the timeline.
   *
   * @param {Document} doc
   * @param {object} [options]
   * @param {object}   [options.rundown]   station-rundown.js, when not global
   * @param {function} [options.now]       () => epoch ms; Date.now by default
   * @param {object}   [options.timers]    { setTimeout, clearTimeout }
   * @param {object}   [options.view]      the window: visibility/focus events
   *        and ResizeObserver; the global one by default, none in tests
   * @param {number}   [options.window]    6 or 12; 6 by default
   * @param {function} [options.onWindow]  told the hours when the operator
   *        chooses a scale on the selector (not on setWindow)
   * @param {number}   [options.tickMs]
   * @param {function} [options.onTick]    told after every clock pass, so a
   *        sibling readout (the header's changeover) can follow the clock
   *        without a clock of its own
   * @param {function} [options.onResetTracking]  RESET's confirming click
   * @param {number}   [options.armDuration]  ms an armed RESET waits
   */
  function create(doc, options) {
    const settings = options || {};
    const rundown = settings.rundown || rundownModule;
    const now = typeof settings.now === "function" ? settings.now : () => Date.now();
    const timers = settings.timers || { setTimeout: root_setTimeout, clearTimeout: root_clearTimeout };
    const view = settings.view === undefined ? (typeof globalThis !== "undefined" ? globalThis : null) : settings.view;
    const tickMs = Number.isFinite(settings.tickMs) && settings.tickMs >= 1000 ? settings.tickMs : TICK_MS;
    const onTick = typeof settings.onTick === "function" ? settings.onTick : null;
    const onWindow = typeof settings.onWindow === "function" ? settings.onWindow : () => {};
    const onResetTracking = typeof settings.onResetTracking === "function" ? settings.onResetTracking : () => {};

    const state = {
      window: rundown.WINDOWS.includes(settings.window) ? settings.window : rundown.DEFAULT_WINDOW,
      inputs: null,        // { model, hopperState, layerState, job }
      observed: {},        // slot -> { weight, at }
      detail: null,        // { key, pinned }
      timer: null,
      reset: { available: false, reason: "", count: 0 },
      layout: null,        // the last layout, for inspection
      entries: [],
      width: 0
    };

    /* ---- Structure, built once ---- */

    const rootEl = element(doc, "div", "station-rundown", { "data-window": String(state.window), "aria-label": "Run-down timeline" });

    const nowEl = element(doc, "div", "station-rundown__now");
    nowEl.appendChild(text(doc, "span", "station-rundown__now-label", "Now"));
    const clockEl = text(doc, "span", "station-rundown__now-clock", "");
    nowEl.appendChild(clockEl);
    /* The scale, under the clock: two segments, one pressed. Part of the
     * Now anchor because that is what it scales from - the window always
     * begins at Now - and because the anchor's column is the one place on
     * the row that is not the axis. Choosing a scale redraws the row at
     * the new window and nothing else: no job state, no command. */
    const rangeEl = element(doc, "div", "station-rundown__range", { role: "group", "aria-label": "Timeline range" });
    const rangeButtons = {};
    for (const hours of rundown.WINDOWS) {
      const button = text(doc, "button", "station-rundown__range-option", `${hours}H`, {
        type: "button", "data-window": String(hours), "aria-pressed": String(hours === state.window),
        title: `Show the next ${hours} hours`
      });
      rangeButtons[hours] = button;
      rangeEl.appendChild(button);
    }
    /* The scale and the reset share one narrow stack at the column's
     * edge, so the word is centred under the segments. */
    const toolsEl = element(doc, "div", "station-rundown__tools");
    toolsEl.appendChild(rangeEl);
    const resetButton = text(doc, "button", "station-rundown__reset", RESET_TEXT, {
      type: "button", "data-action": "reset-tracking", "aria-label": RESET_LABEL, title: RESET_LABEL
    });
    toolsEl.appendChild(resetButton);
    nowEl.appendChild(toolsEl);
    rootEl.appendChild(nowEl);

    /* ---- Reset: armed, then confirmed ---- */

    const arming = armedModule ? armedModule.create({
      doc, controls: { reset: resetButton }, onChange: () => drawReset(),
      setTimeout: timers && timers.setTimeout, clearTimeout: timers && timers.clearTimeout, armDuration: settings.armDuration
    }) : { arm: () => false, disarm: () => false, armed: () => null };

    /* The word stays RESET, armed or not: the arm is said by the colour
     * and the pulse (rundown.css), and by the title and the name a reader
     * is given. */
    function drawReset() {
      const reset = state.reset;
      const count = reset.count;
      const hoppers = `${count} hopper${count === 1 ? "" : "s"}`;
      const isArmed = arming.armed() === "reset";
      resetButton.disabled = !reset.available || count === 0;
      resetButton.classList.toggle("is-armed", isArmed);
      if (isArmed) resetButton.setAttribute("data-armed", "true");
      else resetButton.removeAttribute("data-armed");
      resetButton.setAttribute("aria-label", isArmed ? `Confirm: reset tracking for ${hoppers}` : RESET_LABEL);
      resetButton.setAttribute("title", isArmed
        ? `Click again to reset tracking · ${hoppers} untracked, pumps marked running`
        : (!reset.available
          ? `${RESET_LABEL} is not available: ${reset.reason || "no application is connected to Station commands."}`
          : (count === 0 ? `${RESET_LABEL} · nothing is tracked` : `${RESET_LABEL} · ${hoppers}`)));
    }

    resetButton.addEventListener("click", () => {
      if (resetButton.disabled) return;
      if (arming.armed() !== "reset") { arming.arm("reset"); return; }
      arming.disarm();
      onResetTracking();
    });
    drawReset();

    const track = element(doc, "div", "station-rundown__track");
    const zone = element(doc, "div", "station-rundown__zone", { hidden: "" });
    const ticksEl = element(doc, "div", "station-rundown__ticks", { "aria-hidden": "true" });
    const axis = element(doc, "div", "station-rundown__axis", { "aria-hidden": "true" });
    const nowLine = element(doc, "div", "station-rundown__now-line", { "aria-hidden": "true" });
    const changeoverEl = element(doc, "div", "station-rundown__changeover", { hidden: "" });
    const markers = element(doc, "div", "station-rundown__markers", { role: "list" });
    const hint = element(doc, "p", "station-rundown__hint", { hidden: "" });
    const detail = element(doc, "div", "station-rundown__detail", { id: DETAIL_ID, role: "tooltip", hidden: "" });
    // In the track, so its place along the axis is the same property a
    // marker's is.
    track.append(zone, ticksEl, axis, nowLine, changeoverEl, markers, hint, detail);
    rootEl.appendChild(track);

    const side = element(doc, "div", "station-rundown__side", { role: "list" });
    rootEl.appendChild(side);

    /* ---- Observation anchors ---- */

    /* Bring the anchors into line with what is tracked now: a hopper newly
     * tracked, or whose weight moved, is observed now; one no longer
     * tracked is forgotten, so tracking it again starts fresh. */
    function observe(inputs, at) {
      const next = {};
      const model = inputs && inputs.model;
      const hopperState = (inputs && inputs.hopperState) || {};
      if (model && Array.isArray(model.layers)) {
        for (const layer of model.layers) {
          for (const hopper of layer.hoppers) {
            const key = `${layer.id}:${hopper.index}`;
            const runtime = hopperState[key];
            if (!runtime || !runtime.track) continue;
            const weight = Number.isFinite(runtime.effectiveWeight) ? runtime.effectiveWeight : 0;
            const previous = state.observed[key];
            next[key] = previous && previous.weight === weight ? previous : { weight, at };
          }
        }
      }
      state.observed = next;
    }

    function observedAt() {
      const out = {};
      for (const key of Object.keys(state.observed)) out[key] = state.observed[key].at;
      return out;
    }

    /* ---- Rendering ---- */

    function measuredWidth() {
      const width = typeof track.clientWidth === "number" ? track.clientWidth : 0;
      return width > 0 ? width : FALLBACK_WIDTH;
    }

    function entryByKey(key) {
      return state.entries.find(entry => entry.key === key) || null;
    }

    function render() {
      const t = now();
      const inputs = state.inputs;
      const changeover = inputs ? rundown.resolveChangeover(inputs.job, { now: t }) : { at: null, stale: false };
      /* The changeover goes into the projection as the boundary the line
       * is drawn at: each hopper's marker then stands at its pump-off
       * point, and one that has reached Now is late (station-rundown.js).
       * A stale deadline draws no line and bounds nothing: the markers
       * stand at their run-empty estimates. */
      const entries = inputs ? rundown.projectEntries({
        model: inputs.model, hopperState: inputs.hopperState, layerState: inputs.layerState,
        job: inputs.job, observed: observedAt()
      }, { now: t, changeoverAt: changeover.at !== null && !changeover.stale ? changeover.at : null }) : [];
      state.width = measuredWidth();
      const layout = rundown.layout({
        entries, changeover, now: t, windowMs: state.window * rundown.HOUR, width: state.width
      });
      state.entries = entries;
      state.layout = layout;

      const focusedKey = focusedMarkerKey();

      clockEl.textContent = rundown.formatClock(t);
      rootEl.setAttribute("data-window", String(state.window));
      for (const hours of rundown.WINDOWS) {
        rangeButtons[hours].setAttribute("aria-pressed", String(hours === state.window));
      }
      renderTicks(layout.ticks, changeoverLabelSpan(layout.changeover));
      renderChangeover(layout.changeover);
      renderMarkers(layout.markers, layout.groups);
      renderSide(layout);
      renderHint(entries, inputs);
      renderDetail();

      if (focusedKey) restoreFocus(focusedKey);
    }

    function renderTicks(plan, covered) {
      clearChildren(ticksEl);
      for (const mark of plan.marks) {
        const tick = element(doc, "span", `station-rundown__tick is-${mark.kind}`);
        placeAt(tick, mark.fraction);
        ticksEl.appendChild(tick);
        const x = mark.fraction * state.width;
        const underLabel = !!covered && x >= covered[0] - LABEL_HALF_PX && x <= covered[1] + LABEL_HALF_PX;
        if (mark.label && !underLabel) {
          const label = text(doc, "span", "station-rundown__tick-label", mark.label);
          placeAt(label, mark.fraction);
          ticksEl.appendChild(label);
        }
      }
    }

    /* The changeover's words sit in one opaque box on the axis's upper
     * band - to the right of the line, or to its left when the line is
     * near the track's end - and the tick labels that box would cover are
     * left out rather than half shown (see renderTicks). */
    const CHANGEOVER_LABEL_PX = 210;

    function changeoverLabelSpan(co) {
      if (!co || !co.inWindow || co.stale) return null;
      const x = co.fraction * state.width;
      const flipped = x + CHANGEOVER_LABEL_PX > state.width;
      return flipped ? [x - CHANGEOVER_LABEL_PX, x] : [x, x + CHANGEOVER_LABEL_PX];
    }

    function renderChangeover(co) {
      const drawn = !!co && co.inWindow && !co.stale;
      show(zone, drawn);
      show(changeoverEl, drawn);
      clearChildren(changeoverEl);
      changeoverEl.classList.remove("is-end");
      if (!drawn) return;
      placeAt(zone, co.fraction);
      placeAt(changeoverEl, co.fraction);
      const span = changeoverLabelSpan(co);
      if (span && span[0] < co.fraction * state.width) changeoverEl.classList.add("is-end");
      const label = element(doc, "span", "station-rundown__changeover-label");
      label.appendChild(text(doc, "span", "station-rundown__changeover-name", "Line changeover"));
      label.appendChild(text(doc, "span", "station-rundown__changeover-time", rundown.formatClock(co.at)));
      label.appendChild(text(doc, "span", "station-rundown__changeover-rel", `in ${rundown.formatRemaining(co.remainingMs)}`));
      changeoverEl.appendChild(label);
      changeoverEl.setAttribute("title", `Line changeover at ${rundown.formatClock(co.at)}, in ${rundown.formatRemaining(co.remainingMs)}`);
    }

    /* One marker per hopper: its stem and dot at its exact instant, in its
     * layer's colour, and the label the layout gave it - its id, "N
     * hoppers" for the first of a collapsed group, or none for the rest of
     * one (station-rundown.js: LABELS NEVER OVERLAP). Everything else a
     * marker knows is in the detail. */
    function marker(item, group) {
      const entry = item.entry;
      const button = element(doc, "button", "station-rundown__marker", {
        type: "button",
        role: "listitem",
        "data-key": entry.key,
        "data-hopper": entry.id,
        "data-layer": entry.layer,
        "data-layer-role": entry.role,
        "data-lane": String(item.lane),
        "data-group": String(item.group),
        "aria-label": group && group.collapsed ? `${describe(entry, rundown)}; ${describeGroup(group, rundown)}` : describe(entry, rundown)
      });
      if (item.past) button.classList.add("is-past");
      if (item.late) button.classList.add("is-late");
      if (entry.pumpOff) button.classList.add("is-pump-off");
      if (group && group.collapsed) button.classList.add(item.label ? "is-group" : "is-grouped");
      placeAt(button, item.fraction);
      button.appendChild(element(doc, "span", "station-rundown__stem", { "aria-hidden": "true" }));
      button.appendChild(element(doc, "span", "station-rundown__dot", { "aria-hidden": "true" }));
      if (item.label) {
        const label = element(doc, "span", "station-rundown__label");
        label.appendChild(text(doc, "span", group && group.collapsed ? "station-rundown__group" : "station-rundown__id", item.label));
        button.appendChild(label);
      }
      return button;
    }

    function renderMarkers(items, groups) {
      clearChildren(markers);
      const byId = new Map((groups || []).map(g => [g.id, g]));
      for (const item of items) markers.appendChild(marker(item, byId.get(item.group)));
    }

    /* The right-hand column: hoppers past the window's edge, soonest
     * first, then tracked hoppers with no estimate, each a chip that opens
     * the same detail a marker does. A changeover past the edge is stated
     * here too, as text - it is a boundary, not a hopper. */
    function chip(entry, kind) {
      const button = element(doc, "button", `station-rundown__chip is-${kind}`, {
        type: "button",
        role: "listitem",
        "data-key": entry.key,
        "data-hopper": entry.id,
        "data-layer": entry.layer,
        "data-layer-role": entry.role,
        "aria-label": describe(entry, rundown)
      });
      if (entry.pumpOff) button.classList.add("is-pump-off");
      button.appendChild(text(doc, "span", "station-rundown__id", entry.id));
      button.appendChild(text(doc, "span", "station-rundown__chip-sep", kind === "beyond" ? "→" : "·"));
      button.appendChild(text(doc, "span", kind === "beyond" ? "station-rundown__time" : "station-rundown__reason",
        kind === "beyond" ? rundown.formatRemaining(entry.untilMs !== null && entry.untilMs !== undefined ? entry.untilMs : entry.remainingMs) : rundown.reasonLabel(entry.reason)));
      return button;
    }

    function renderSide(layout) {
      clearChildren(side);
      const items = [];
      for (const entry of layout.beyond) items.push({ entry, kind: "beyond" });
      for (const entry of layout.unavailable) items.push({ entry, kind: "unavailable" });
      const co = layout.changeover;
      const coBeyond = !!co && !co.inWindow && !co.past && !co.stale;
      const visible = items.slice(0, items.length > SIDE_LIMIT ? SIDE_LIMIT - 1 : SIDE_LIMIT);
      for (const item of visible) side.appendChild(chip(item.entry, item.kind));
      const rest = items.slice(visible.length);
      if (rest.length) {
        const more = text(doc, "button", "station-rundown__chip is-more", `+${rest.length}`, {
          type: "button", role: "listitem",
          "data-more": rest.map(item => item.entry.key).join(" "),
          "aria-label": `${rest.length} more: ${rest.map(item => describe(item.entry, rundown)).join("; ")}`,
          title: rest.map(item => describe(item.entry, rundown)).join("\n")
        });
        side.appendChild(more);
      }
      if (coBeyond) {
        side.appendChild(text(doc, "span", "station-rundown__chip is-changeover",
          `Changeover → ${rundown.formatRemaining(co.remainingMs)}`, {
            role: "listitem", title: `Line changeover at ${rundown.formatClock(co.at)}`
          }));
      }
      if (co && co.stale) {
        side.appendChild(text(doc, "span", "station-rundown__chip is-stale", "Changeover needs confirming", {
          role: "listitem", title: "The changeover time was set long enough ago that it may be yesterday's. Confirm or update it."
        }));
      }
      show(side, side.children.length > 0);
    }

    function renderHint(entries, inputs) {
      const tracked = entries.length;
      let message = "";
      if (!inputs || !inputs.model) message = "No line to project.";
      else if (tracked === 0) message = "No tracked hoppers — click a hopper's body to track it.";
      hint.textContent = message;
      show(hint, !!message);
    }

    /* ---- Detail ---- */

    function detailRow(term, value, className) {
      const row = element(doc, "div", "station-rundown__row");
      row.appendChild(text(doc, "dt", "station-rundown__term", term));
      row.appendChild(text(doc, "dd", `station-rundown__value${className ? ` ${className}` : ""}`, value));
      return row;
    }

    function renderDetail() {
      clearChildren(detail);
      const entry = state.detail ? entryByKey(state.detail.key) : null;
      if (!entry) {
        state.detail = null;
        show(detail, false);
        detail.removeAttribute("style");
        for (const el of rootEl.querySelectorAll("[aria-describedby]")) el.removeAttribute("aria-describedby");
        return;
      }
      /* A member of a collapsed group opens the group: every hopper in
       * it, each with its own facts, the hovered one first. */
      const group = state.layout && state.layout.groups
        ? state.layout.groups.find(g => g.collapsed && g.entries.some(e => e.key === entry.key)) || null
        : null;
      if (group) {
        const head = element(doc, "div", "station-rundown__detail-head", { "data-layer-role": entry.role });
        head.appendChild(text(doc, "span", "station-rundown__group", `${group.entries.length} hoppers`));
        head.appendChild(text(doc, "span", "station-rundown__detail-resin",
          entry.markKind === "pump-off" ? (entry.late ? "past their pump-off point" : `pump off by ${rundown.formatClock(entry.pumpOffBy)}`) : `empty by ${rundown.formatClock(entry.emptyAt)}`));
        detail.appendChild(head);
        const members = element(doc, "ul", "station-rundown__members");
        const ordered = [entry].concat(group.entries.filter(e => e.key !== entry.key));
        for (const member of ordered) {
          const row = element(doc, "li", "station-rundown__member", { "data-layer-role": member.role, "data-key": member.key });
          if (member.pumpOff) row.classList.add("is-pump-off");
          if (member.late && !member.pumpOff) row.classList.add("is-late");
          row.appendChild(text(doc, "span", "station-rundown__id", member.id));
          row.appendChild(text(doc, "span", "station-rundown__member-resin", member.resin || "No resin"));
          row.appendChild(text(doc, "span", "station-rundown__member-facts", memberFacts(member, rundown)));
          members.appendChild(row);
        }
        detail.appendChild(members);
        const item = state.layout.markers.find(m => m.entry.key === entry.key);
        const fraction = item ? item.fraction : 1;
        placeAt(detail, fraction);
        detail.classList.toggle("is-end", fraction > 0.75);
        detail.classList.toggle("is-pinned", !!state.detail.pinned);
        show(detail, true);
        for (const el of rootEl.querySelectorAll("[aria-describedby]")) el.removeAttribute("aria-describedby");
        for (const el of rootEl.querySelectorAll(`[data-key='${entry.key}']`)) el.setAttribute("aria-describedby", DETAIL_ID);
        return;
      }
      const head = element(doc, "div", "station-rundown__detail-head", { "data-layer-role": entry.role });
      head.appendChild(text(doc, "span", "station-rundown__id", entry.id));
      head.appendChild(text(doc, "span", "station-rundown__detail-resin", entry.resin || "No resin"));
      detail.appendChild(head);
      const list = element(doc, "dl", "station-rundown__list");
      list.appendChild(detailRow("Layer", entry.layer));
      list.appendChild(detailRow("Weight", entry.weight > 0 ? `${entry.weight.toLocaleString([], { maximumFractionDigits: 1 })} lb` : "—", entry.weight > 0 ? "" : "is-missing"));
      list.appendChild(detailRow("Blend", entry.pct > 0 ? `${entry.pct}% of layer ${entry.layer} (${entry.layerPct}%)` : "—", entry.pct > 0 ? "" : "is-missing"));
      list.appendChild(detailRow("Consumption", entry.rate !== null ? rundown.formatRate(entry.rate) : "—", entry.rate !== null ? "" : "is-missing"));
      if (entry.reason) {
        list.appendChild(detailRow("Estimate", rundown.reasonLabel(entry.reason), "is-missing"));
      } else {
        if (entry.markKind === "pump-off") {
          const late = entry.late && !entry.pumpOff;
          list.appendChild(detailRow("Pump off by",
            `${rundown.formatClock(entry.pumpOffBy)}${late ? " · late" : entry.pumpOff ? "" : ` · in ${rundown.formatRemaining(entry.untilMs)}`}`,
            late ? "is-late" : ""));
        }
        list.appendChild(detailRow("Time remaining", entry.past ? "Estimated empty" : rundown.formatRemaining(entry.remainingMs), entry.past ? "is-past" : ""));
        list.appendChild(detailRow("Empty at", rundown.formatClock(entry.emptyAt), entry.past ? "is-past" : ""));
        if (Number.isFinite(entry.durationMs)) list.appendChild(detailRow("Run-down", rundown.formatRemaining(entry.durationMs)));
      }
      if (entry.pumpOff) list.appendChild(detailRow("Pump", "Pump off", "is-pump-off"));
      detail.appendChild(list);

      // Anchored to the marker's own place on the axis; a chip anchors to
      // the column's edge. The stylesheet keeps it inside the timeline.
      const item = state.layout ? state.layout.markers.find(m => m.entry.key === entry.key) : null;
      const fraction = item ? item.fraction : 1;
      placeAt(detail, fraction);
      detail.classList.toggle("is-end", fraction > 0.75);
      detail.classList.toggle("is-pinned", !!state.detail.pinned);
      show(detail, true);
      for (const el of rootEl.querySelectorAll("[aria-describedby]")) el.removeAttribute("aria-describedby");
      for (const el of rootEl.querySelectorAll(`[data-key='${entry.key}']`)) el.setAttribute("aria-describedby", DETAIL_ID);
    }

    function showDetail(key, pinned) {
      if (!key || !entryByKey(key)) return;
      if (state.detail && state.detail.pinned && !pinned && state.detail.key !== key) return;
      state.detail = { key, pinned: !!pinned || (state.detail && state.detail.key === key && state.detail.pinned) };
      renderDetail();
    }

    function hideDetail(force) {
      if (!state.detail) return;
      if (state.detail.pinned && !force) return;
      state.detail = null;
      renderDetail();
    }

    function keyOf(target) {
      const el = target && target.closest ? target.closest("[data-key]") : null;
      return el ? el.getAttribute("data-key") : null;
    }

    function focusedMarkerKey() {
      const active = doc.activeElement;
      if (!active || !rootEl.contains(active)) return null;
      return keyOf(active);
    }

    function restoreFocus(key) {
      const next = rootEl.querySelector(`[data-key='${key}']`);
      if (next && typeof next.focus === "function") next.focus();
    }

    rootEl.addEventListener("click", event => {
      const key = keyOf(event.target);
      if (!key) return;
      if (state.detail && state.detail.key === key && state.detail.pinned) { hideDetail(true); return; }
      showDetail(key, true);
    });
    rootEl.addEventListener("mouseover", event => { const key = keyOf(event.target); if (key) showDetail(key, false); });
    rootEl.addEventListener("mouseleave", () => hideDetail(false));
    rootEl.addEventListener("focusin", event => { const key = keyOf(event.target); if (key) showDetail(key, false); });
    rootEl.addEventListener("focusout", event => {
      if (keyOf(event.relatedTarget)) return;
      hideDetail(false);
    });
    rootEl.addEventListener("keydown", event => {
      if (event.key !== "Escape" || !state.detail) return;
      hideDetail(true);
      if (typeof event.stopPropagation === "function") event.stopPropagation();
    });

    /* ---- The clock ---- */

    function tick() {
      render();
      if (onTick) onTick();
    }

    function schedule() {
      if (!timers || typeof timers.setTimeout !== "function") return;
      if (state.timer !== null && typeof timers.clearTimeout === "function") timers.clearTimeout(state.timer);
      state.timer = timers.setTimeout(() => {
        state.timer = null;
        tick();
        schedule();
      }, tickMs);
    }

    function wake() {
      tick();
      schedule();
    }

    const listeners = [];
    if (view && typeof view.addEventListener === "function") {
      const onVisible = () => { if (!doc.visibilityState || doc.visibilityState === "visible") wake(); };
      const viewDoc = view.document || doc;
      if (viewDoc && typeof viewDoc.addEventListener === "function") {
        viewDoc.addEventListener("visibilitychange", onVisible);
        listeners.push(() => viewDoc.removeEventListener("visibilitychange", onVisible));
      }
      view.addEventListener("focus", wake);
      view.addEventListener("pageshow", wake);
      listeners.push(() => view.removeEventListener("focus", wake));
      listeners.push(() => view.removeEventListener("pageshow", wake));
    }

    let observer = null;
    if (view && typeof view.ResizeObserver === "function") {
      observer = new view.ResizeObserver(() => {
        if (measuredWidth() !== state.width) render();
      });
      observer.observe(track);
    }

    /* ---- The surface ---- */

    /**
     * @param {object} inputs  { model, hopperState, layerState, job, live,
     *        reset? }; reset = { available, reason, count } is what the
     *        RESET word shows (left as it was when absent)
     */
    function update(inputs) {
      state.inputs = inputs || null;
      const reset = inputs && inputs.reset && typeof inputs.reset === "object" ? inputs.reset : null;
      if (reset) {
        state.reset = {
          available: !!reset.available,
          reason: typeof reset.reason === "string" ? reset.reason : "",
          count: Number.isInteger(reset.count) && reset.count > 0 ? reset.count : 0
        };
      }
      // A reset that stopped being possible while armed is not armed.
      if (arming.armed() === "reset" && (!state.reset.available || state.reset.count === 0)) arming.disarm();
      else drawReset();
      observe(state.inputs, now());
      render();
    }

    function setWindow(hours) {
      if (!rundown.WINDOWS.includes(hours) || hours === state.window) return false;
      state.window = hours;
      render();
      return true;
    }

    rangeEl.addEventListener("click", event => {
      const button = event.target && event.target.closest ? event.target.closest("[data-window]") : null;
      if (!button) return;
      const hours = Number(button.getAttribute("data-window"));
      if (setWindow(hours)) onWindow(hours);
    });

    function destroy() {
      if (state.timer !== null && timers && typeof timers.clearTimeout === "function") timers.clearTimeout(state.timer);
      state.timer = null;
      for (const off of listeners) off();
      if (observer) observer.disconnect();
    }

    schedule();

    return {
      element: rootEl,
      update,
      tick,
      wake,
      setWindow,
      resetButton,
      isArmed: () => arming.armed() === "reset",
      disarm: () => arming.disarm(),
      getReset: () => Object.assign({}, state.reset),
      getWindow: () => state.window,
      getLayout: () => state.layout,
      getEntries: () => state.entries.slice(),
      /* The drawn hoppers' operational marks - tracked, late, overdue by
       * slot - from the same projection the markers are drawn from, so
       * the stage and the axis can never disagree about a hopper. */
      getMarks: () => rundown.hopperMarks(state.entries),
      getObserved: () => Object.assign({}, observedAt()),
      getDetail: () => (state.detail ? Object.assign({}, state.detail) : null),
      destroy
    };
  }

  function root_setTimeout(fn, ms) { return setTimeout(fn, ms); }
  function root_clearTimeout(id) { return clearTimeout(id); }

  return Object.freeze({ TICK_MS, SIDE_LIMIT, DETAIL_ID, RESET_TEXT, RESET_LABEL, create });
});
