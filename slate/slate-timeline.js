/* The right pane: the run-down as a vertical timeline.
 *
 * Now at the top, the changeover near the bottom, every tracked hopper a
 * card at its mark on the axis - the pump-off point when a changeover is
 * set, the estimated empty otherwise. Cards within five minutes share one
 * card; what is already late pins under the Now line; what has no estimate
 * lists beneath the axis; what is pumped off collects at the foot with a
 * way back on. The scale fits the job: the axis stretches to the
 * changeover when there is a usable one, and offers six or twelve hours
 * when there is not.
 *
 * The arithmetic is station-rundown.js's - the projection the application's
 * own formula is pinned to; the geometry is slate-timeline-layout.js's,
 * pure. This module anchors weights (a weight is "observed" when first
 * seen or when it moves - the application keeps no such time), keeps a
 * clock (20 seconds; a run-down is measured in minutes), draws, and hands
 * the operator's Pump off / Back on to slate-tracking.js, one command per
 * click, addressed to Current. It never dispatches itself.
 *
 * Member rows are built once per hopper and MOVED between cards, the
 * pinned block and the foot as the projection changes, so a tick never
 * takes the operator's focus off a button.
 *
 * RAN OUT EARLY. A pumped-off row offers "Ran out": a panel in the foot
 * takes when the pump went off (the application's record, else the planned
 * time) and when the hopper ran dry (now), and shows what that says about
 * the hopper's stored weight - or, with Smart Hoppers computing it, its
 * measure (slate-runout.js). Apply sends that one change through
 * slate-weight-actions.js and, if chosen, updates a weight profile through
 * slate-profile-actions.js; nothing changes before Apply, and Apply asks
 * twice - the first press arms it as Confirm for a few seconds, the second
 * corrects; a changed time, Cancel or the wait disarms it. Several hoppers
 * short by about the same share are said to point at the line's output.
 *
 * The LIST view (the Timeline preference, slate-display.js) is the same
 * rows without the clock: late first, then by mark, then those without
 * an estimate, each row saying its clock and countdown; the pumped-off
 * foot stays. The axis, its cards and the horizon switch are withheld.
 * The rows are the same elements in either view.
 */
(function (root, factory) {
  const pick = (name, file) => (typeof require === "function" ? require(file) : (root && root[name]));
  const api = factory(
    pick("PolynStationRundown", "../station/station-rundown.js"),
    pick("PolynSlateTimelineLayout", "./slate-timeline-layout.js"),
    pick("PolynSlateTracking", "./slate-tracking.js"),
    pick("PolynSlateRunout", "./slate-runout.js"),
    pick("PolynSlateWeightActions", "./slate-weight-actions.js"),
    pick("PolynSlateProfileActions", "./slate-profile-actions.js")
  );
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynSlateTimeline = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (rundownModule, layoutModule, trackingModule, runoutModule, weightActions, profileActions) {
  "use strict";

  const TICK_MS = 20000;
  /* Ran out's Apply: armed as Confirm this long after the first press. */
  const RANOUT_ARM_MS = 4000;
  const RANOUT_APPLY_LABEL = "Apply";
  const RANOUT_CONFIRM_LABEL = "Confirm";
  const FALLBACK_HEIGHT = 640;
  const NONE_TRACKED = "No hoppers tracked. Turn on Track in the recipe.";
  // Under Automatic tracking there is no Track to turn on: the recipe
  // tracks a hopper once a plan changes its resin.
  const NONE_TRACKED_AUTOMATIC = "No hoppers tracked. Plan a Next Recipe; hoppers whose resin changes are tracked automatically.";
  const STALE_CHANGEOVER = "Changeover needs confirming";
  /* On a phone the scale stretches for crowded cards, up to this. */
  const MAX_PHONE_SPAN = 4000;
  /* A desktop's or a tablet's axis grows past its window to keep every
   * card apart (slate-timeline-layout.js spanNeeded), up to this; only a
   * run-down longer still merges, as a last resort. */
  const MAX_SPAN = 8000;
  const ALARM_LABEL = "Alarm when pump-off is due";
  const NO_LINE = "No line to project.";

  /* Geometry the stylesheet mirrors: the axis insets, the gap between
   * cards, and the pieces a card is made of. */
  const TOP_INSET = 18;
  const BOTTOM_INSET = 16;
  const CHANGEOVER_INSET = 28;
  const GAP = 8;
  const CARD_PAD = 12;
  const CARD_HEAD = 18;
  const MEMBER_ROW = 28;
  const CARD_FACTS = 16;
  /* Across the axis (mirrored in timeline.css): the dot's centre on the
   * rail, the cards' left edge past the leaders' lane, and how far into
   * the card's top a leader lands. */
  const DOT_X = 59;
  const CARD_LEFT = 72;
  const LEADER_INTO = 10;
  const SVG_NS = "http://www.w3.org/2000/svg";

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

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function show(node, on) {
    if (on) node.removeAttribute("hidden");
    else node.setAttribute("hidden", "");
  }

  function setText(node, value) {
    if (node.textContent !== value) node.textContent = value;
  }

  function px(value) {
    return `${Math.round(value * 10) / 10}px`;
  }

  /** How tall a card is for a group: the stylesheet's pieces, summed. */
  function cardHeight(group) {
    const members = group && Array.isArray(group.members) ? group.members.length : 0;
    return CARD_PAD + CARD_HEAD + members * MEMBER_ROW + (members === 1 && !group.pinned ? CARD_FACTS : 0);
  }

  /**
   * The leader from a dot at `dotY` to a card whose top is at `cardY`, in
   * the event's own coordinates: an S-curve leaving the dot to the right
   * and entering the card's corner to the right. Every leader has the same
   * handles, so its height at any point is the same blend of its two ends
   * as every other's - dots and cards keep one order, so no two cross, and
   * where one runs along the axis it passes behind the line (timeline.css).
   * @returns {{ d: string, height: number, endY: number }}
   */
  function leaderFor(dotY, cardY) {
    const endY = cardY + LEADER_INTO;
    const handle = CARD_LEFT - DOT_X;
    const r = value => Math.round(value * 100) / 100;
    const d = `M ${DOT_X} ${r(dotY)} C ${DOT_X + handle} ${r(dotY)}, ${CARD_LEFT - handle} ${r(endY)}, ${CARD_LEFT} ${r(endY)}`;
    return { d, height: r(Math.max(dotY, endY) + 2), endY: r(endY) };
  }

  /** "400 lb · 3h 10m run-down" for a single card's second line. */
  function facts(entry) {
    const parts = [];
    if (Number.isFinite(entry.weight) && entry.weight > 0) parts.push(`${Math.round(entry.weight)} lb`);
    if (Number.isFinite(entry.durationMs)) parts.push(`${rundownModule.formatRemaining(entry.durationMs)} run-down`);
    return parts.join(" · ");
  }

  /** The counts line: "5 tracked · 1 overdue · 1 off". */
  function countsFor(entries) {
    const list = Array.isArray(entries) ? entries : [];
    const parts = [`${list.length} tracked`];
    const overdue = list.filter(entry => entry.overdue).length;
    const off = list.filter(entry => entry.pumpOff).length;
    if (overdue > 0) parts.push(`${overdue} overdue`);
    if (off > 0) parts.push(`${off} off`);
    return parts.join(" · ");
  }

  /** The changeover line: what the head says about the deadline. */
  function changeoverText(changeover, now) {
    if (!changeover || !Number.isFinite(changeover.at)) return "Changeover not set";
    if (changeover.stale) return `Confirm changeover · ${rundownModule.formatClock(changeover.at)}`;
    const remaining = changeover.at - now;
    return `Changeover ${rundownModule.formatClock(changeover.at)} · ${remaining < 0 ? "passed" : `in ${rundownModule.formatRemaining(remaining)}`}`;
  }

  /**
   * @param {Document} doc
   * @param {object} [options]
   * @param {function} [options.now]
   * @param {object} [options.timers]      { setTimeout, clearTimeout }
   * @param {number} [options.tickMs]
   * @param {function} [options.onTick]    told the marks on every tick
   * @param {object} [options.visibility]  the document (visibilitychange)
   * @param {object} [options.view]        the window (ResizeObserver)
   * @param {function} [options.commands]  () -> the command bridge, or null
   * @param {function} [options.readOnly]
   * @param {function} [options.trackingMode] () -> "automatic"|"assisted"|"manual"; only the idle notice reads it
   * @param {function} [options.timelineView] () -> "realtime"|"list" (realtime by default)
   * @param {function} [options.onCommitted]
   * @param {function} [options.say]
   */
  function create(doc, options) {
    const settings = options || {};
    const now = typeof settings.now === "function" ? settings.now : () => Date.now();
    const timers = settings.timers || { setTimeout, clearTimeout };
    const tickMs = Number.isFinite(settings.tickMs) && settings.tickMs > 0 ? settings.tickMs : TICK_MS;
    const onTick = typeof settings.onTick === "function" ? settings.onTick : () => {};
    const commands = typeof settings.commands === "function" ? settings.commands : () => null;
    const readOnly = typeof settings.readOnly === "function" ? settings.readOnly : () => false;
    const trackingMode = typeof settings.trackingMode === "function" ? settings.trackingMode : () => trackingModule.DEFAULT_MODE;
    const timelineView = typeof settings.timelineView === "function" ? settings.timelineView : () => "realtime";
    const viewNow = () => (timelineView() === "list" ? "list" : "realtime");
    const onCommitted = typeof settings.onCommitted === "function" ? settings.onCommitted : () => {};
    const say = typeof settings.say === "function" ? settings.say : () => {};
    const guard = () => ({ readOnly: !!readOnly() });
    const profiles = settings.weightProfiles || null;
    const lastProfile = typeof settings.lastWeightProfile === "function" ? settings.lastWeightProfile : () => null;

    /* ---- The frame ---- */

    const rootEl = element(doc, "div", "slate-panel slate-timeline", { "data-mode": "fixed", "data-view": "realtime" });
    const head = element(doc, "div", "slate-timeline__head");
    head.appendChild(text(doc, "h2", "slate-timeline__title", "Timeline"));
    const clock = text(doc, "span", "slate-timeline__clock", "");
    head.appendChild(clock);
    const scale = element(doc, "div", "slate-timeline__scale", { role: "group", "aria-label": "Horizon" });
    const rangeButtons = new Map();
    for (const hours of rundownModule.WINDOWS) {
      const button = text(doc, "button", "slate-timeline__range", `${hours}H`, { type: "button", "data-window": String(hours), "aria-pressed": hours === rundownModule.DEFAULT_WINDOW ? "true" : "false" });
      rangeButtons.set(hours, button);
      scale.appendChild(button);
    }
    head.appendChild(scale);
    rootEl.appendChild(head);
    const changeoverLine = text(doc, "p", "slate-timeline__changeover-line", "");
    rootEl.appendChild(changeoverLine);
    const counts = text(doc, "p", "slate-timeline__counts", "");
    rootEl.appendChild(counts);
    // The pump-off alarm: this device's own sound, vibration and
    // notifications (the application's), switched through the tracking
    // seam. Offered under a finger (timeline.css), where the floor UI
    // offers it too, and only when the application says how it stands.
    const alarmButton = text(doc, "button", "slate-switch slate-timeline__alarm", ALARM_LABEL, { type: "button", role: "switch", "aria-checked": "false", hidden: "" });
    alarmButton.addEventListener("click", () => {
      const on = alarmButton.getAttribute("aria-checked") === "true";
      settle(trackingModule.setAlarm(commands(), !on));
    });
    // What to do next, for the line panel (a phone's; timeline.css shows it
    // there only): what is late, else the next group due - its time large,
    // each hopper with a Pump off a thumb can find. The buttons are the
    // tracking controls the cards carry (data-slate-control), so a press
    // goes the one way every pill goes.
    const nextEl = element(doc, "section", "slate-timeline__next", { "aria-label": "Next", hidden: "" });
    const nextHead = text(doc, "p", "slate-timeline__next-head", "");
    const nextWhen = text(doc, "p", "slate-timeline__next-when", "");
    const nextRowsEl = element(doc, "div", "slate-timeline__next-rows");
    const nextMore = text(doc, "p", "slate-timeline__next-more", "", { hidden: "" });
    for (const node of [nextHead, nextWhen, nextRowsEl, nextMore]) nextEl.appendChild(node);
    rootEl.appendChild(nextEl);
    const nextRows = new Map();
    const notice = element(doc, "p", "slate-timeline__notice", { hidden: "" });
    rootEl.appendChild(notice);

    const axis = element(doc, "div", "slate-timeline__axis");
    const rail = element(doc, "div", "slate-timeline__rail", { "aria-hidden": "true" });
    axis.appendChild(rail);
    const ticksEl = element(doc, "div", "slate-timeline__ticks", { "aria-hidden": "true" });
    axis.appendChild(ticksEl);
    const nowLine = element(doc, "div", "slate-timeline__now");
    nowLine.appendChild(text(doc, "span", "slate-timeline__now-label", "Now"));
    axis.appendChild(nowLine);
    const changeoverMark = element(doc, "div", "slate-timeline__changeover", { hidden: "" });
    const changeoverLabel = text(doc, "span", "slate-timeline__changeover-label", "");
    changeoverMark.appendChild(changeoverLabel);
    axis.appendChild(changeoverMark);
    const pinned = element(doc, "div", "slate-timeline__pinned", { hidden: "" });
    const pinnedCard = element(doc, "div", "slate-timeline__card is-pinned");
    const pinnedWhen = text(doc, "p", "slate-timeline__when", "");
    const pinnedMembers = element(doc, "div", "slate-timeline__members");
    pinnedCard.appendChild(pinnedWhen);
    pinnedCard.appendChild(pinnedMembers);
    pinned.appendChild(pinnedCard);
    axis.appendChild(pinned);
    const eventsEl = element(doc, "div", "slate-timeline__events");
    axis.appendChild(eventsEl);
    // The axis's window: a desktop's or a tablet's axis grows past it when
    // the cards need more room than it shows, and it scrolls.
    const viewport = element(doc, "div", "slate-timeline__viewport");
    viewport.appendChild(axis);
    rootEl.appendChild(viewport);
    // No scrollbar is drawn (timeline.css): the edge where more continues
    // fades instead, marked here as the window scrolls and as it is drawn.
    function paintEdges() {
      const top = Number(viewport.scrollTop) || 0;
      const room = (Number(viewport.scrollHeight) || 0) - (Number(viewport.clientHeight) || 0);
      if (room > 1 && top > 1) viewport.setAttribute("data-more-above", "");
      else viewport.removeAttribute("data-more-above");
      if (room > 1 && top < room - 1) viewport.setAttribute("data-more-below", "");
      else viewport.removeAttribute("data-more-below");
    }
    viewport.addEventListener("scroll", paintEdges);
    // The list view's rows, in the axis's place.
    const listEl = element(doc, "div", "slate-timeline__list", { hidden: "" });
    rootEl.appendChild(listEl);

    const phoneTier = () => {
      try { const tier = typeof settings.tier === "function" ? settings.tier() : null; return !!tier && tier.input === "touch" && tier.width === "phone"; } catch (error) { return false; }
    };
    const touchTier = () => {
      try { const tier = typeof settings.tier === "function" ? settings.tier() : null; return !!tier && tier.input === "touch"; } catch (error) { return false; }
    };
    const chips = element(doc, "div", "slate-timeline__chips", { hidden: "" });
    chips.addEventListener("click", event => {
      const target = event && event.target;
      const chip = target && typeof target.closest === "function" ? target.closest("[data-slate-weights]") : null;
      if (!chip || typeof settings.openWeights !== "function") return;
      const tier = typeof settings.tier === "function" ? settings.tier() : null;
      if (tier && tier.input === "touch" && tier.width === "phone") settings.openWeights();
    });
    rootEl.appendChild(chips);
    // The pumped-off foot: its rows alone, no heading.
    const done = element(doc, "div", "slate-timeline__done", { hidden: "" });
    // Ran out early: the correction, built once, over the rows it is about.
    const correct = element(doc, "div", "slate-timeline__correct", { role: "group", "aria-label": "Ran out early", hidden: "" });
    const correctTitle = text(doc, "p", "slate-timeline__correct-title", "");
    const correctTimes = element(doc, "div", "slate-timeline__correct-times");
    const offLabel = element(doc, "label", "slate-timeline__correct-time");
    offLabel.appendChild(text(doc, "span", "slate-timeline__correct-word", "Pump off"));
    const offInput = element(doc, "input", "slate-timeline__correct-input", { type: "time", "data-slate-runout": "off", "aria-label": "When the pump went off" });
    offLabel.appendChild(offInput);
    const outLabel = element(doc, "label", "slate-timeline__correct-time");
    outLabel.appendChild(text(doc, "span", "slate-timeline__correct-word", "Ran out"));
    const outInput = element(doc, "input", "slate-timeline__correct-input", { type: "time", "data-slate-runout": "out", "aria-label": "When the hopper ran out" });
    outLabel.appendChild(outInput);
    correctTimes.appendChild(offLabel);
    correctTimes.appendChild(outLabel);
    const correctFed = text(doc, "p", "slate-timeline__correct-fed", "");
    const correctChange = text(doc, "p", "slate-timeline__correct-change", "");
    const correctShared = text(doc, "p", "slate-timeline__correct-shared", "", { hidden: "" });
    const profileLabel = element(doc, "label", "slate-timeline__correct-profile");
    profileLabel.appendChild(text(doc, "span", "slate-timeline__correct-word", "Weight profile"));
    const profileSelect = element(doc, "select", "slate-timeline__correct-select", { "data-slate-runout": "profile", "aria-label": "Also update a weight profile" });
    profileLabel.appendChild(profileSelect);
    const correctNote = text(doc, "p", "slate-timeline__correct-note", "", { role: "status", hidden: "" });
    const correctActions = element(doc, "div", "slate-timeline__correct-actions");
    const correctCancel = text(doc, "button", "slate-timeline__correct-button", "Cancel", { type: "button", "data-slate-runout": "cancel" });
    const correctApply = text(doc, "button", "slate-timeline__correct-button slate-timeline__correct-button--apply", RANOUT_APPLY_LABEL, { type: "button", "data-slate-runout": "apply", "data-able": "false" });
    correctActions.appendChild(correctCancel);
    correctActions.appendChild(correctApply);
    for (const node of [correctTitle, correctTimes, correctFed, correctChange, correctShared, profileLabel, correctNote, correctActions]) correct.appendChild(node);
    done.appendChild(correct);
    const doneList = element(doc, "div", "slate-timeline__done-list");
    done.appendChild(doneList);
    rootEl.appendChild(done);
    // The alarm's switch stands at the foot, under what it is about.
    rootEl.appendChild(alarmButton);

    const state = {
      inputs: null,
      observed: {},
      entries: [],
      changeover: { at: null, stale: false },
      window: null,
      grouped: null,
      placed: null,
      horizon: rundownModule.DEFAULT_WINDOW,
      view: "realtime",
      timer: null,
      height: 0,
      rows: new Map(),
      events: new Map(),
      resize: null,
      resolved: null,
      // The open correction, and this session's early ratios (the line's clue).
      correcting: null,
      ratios: []
    };

    /* ---- Anchors and projection (the summary's, kept) ---- */

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

    function project(at) {
      const inputs = state.inputs;
      if (!inputs) { state.entries = []; state.changeover = { at: null, stale: false }; return; }
      state.changeover = rundownModule.resolveChangeover(inputs.job, { now: at });
      state.entries = rundownModule.projectEntries(
        { model: inputs.model, hopperState: inputs.hopperState, layerState: inputs.layerState, job: inputs.job, observed: observedAt() },
        { now: at, changeoverAt: state.changeover.stale ? null : state.changeover.at }
      );
    }

    /* ---- Measuring ---- */

    /* What the axis's window shows: the axis's own height before it grows. */
    function visibleHeight() {
      if (Number.isFinite(viewport.clientHeight) && viewport.clientHeight > 0) return viewport.clientHeight;
      return axis.style.minHeight ? FALLBACK_HEIGHT : measuredHeight();
    }

    function measuredHeight() {
      if (Number.isFinite(axis.clientHeight) && axis.clientHeight > 0) return axis.clientHeight;
      const rect = typeof axis.getBoundingClientRect === "function" ? axis.getBoundingClientRect() : null;
      if (rect && Number.isFinite(rect.height) && rect.height > 0) return rect.height;
      return FALLBACK_HEIGHT;
    }

    /* ---- Rows ---- */

    function row(entry) {
      let built = state.rows.get(entry.key);
      if (built) return built;
      const el = element(doc, "div", "slate-timeline__member", { "data-key": entry.key, "data-hopper": entry.id, "data-layer": entry.layer, "data-role": entry.role });
      const name = element(doc, "span", "slate-timeline__member-name");
      const id = text(doc, "span", "slate-timeline__member-id", entry.id);
      const resin = text(doc, "span", "slate-timeline__member-resin", "");
      name.appendChild(id);
      name.appendChild(resin);
      // What goes into the hopper next, where the plan changes it: on a
      // phone, beside the resin (timeline.css).
      const next = element(doc, "span", "slate-timeline__member-next", { hidden: "" });
      name.appendChild(next);
      const at = text(doc, "span", "slate-timeline__member-at", "");
      // The pill is short - the card is narrow - and its title says the rest.
      const button = element(doc, "button", "slate-toggle slate-toggle--pump slate-timeline__pump", {
        type: "button", "data-slate-control": "pump", "data-layer": entry.layer, "data-index": String(entry.index), "aria-pressed": "false", "data-able": "false", "aria-label": `Pump off ${entry.id}`
      });
      button.appendChild(element(doc, "span", "slate-toggle__dot", { "aria-hidden": "true" }));
      const label = text(doc, "span", "slate-toggle__label", "Off");
      button.appendChild(label);
      // Ran out early - offered on a pumped-off row only (timeline.css).
      // No ellipsis: in a narrow row it reads as text cut off, not a button.
      const ranOut = text(doc, "button", "slate-timeline__ranout", "Ran out", { type: "button", "data-slate-ranout": entry.key, title: `${entry.id} ran out early: correct its stored weight` });
      el.appendChild(name);
      el.appendChild(at);
      el.appendChild(ranOut);
      el.appendChild(button);
      built = { el, id, resin, next, at, button, label, ranOut };
      state.rows.set(entry.key, built);
      return built;
    }

    function paintRow(entry, atText, at) {
      const built = row(entry);
      setText(built.resin, entry.resin || "no resin");
      setText(built.at, atText);
      built.button.setAttribute("aria-pressed", entry.pumpOff ? "true" : "false");
      // Under a finger the pill says what it does ("Pump off"): it stands
      // beside a hopper still running, where "Off" reads as its state.
      setText(built.label, entry.pumpOff ? "Back on" : (touchTier() ? "Pump off" : "Off"));
      const planned = state.inputs && state.inputs.next ? state.inputs.next[entry.key] : null;
      const nextResin = state.inputs && state.inputs.next ? String((planned && planned.resinName) || "").trim() : null;
      const changes = nextResin !== null && nextResin.toUpperCase() !== String(entry.resin || "").trim().toUpperCase();
      if (changes) setText(built.next, `→ ${nextResin || "empty"}`);
      show(built.next, changes);
      built.button.setAttribute("aria-label", entry.pumpOff ? `Mark ${entry.id}'s pump running again` : `Mark ${entry.id}'s pump off`);
      built.el.classList.toggle("is-overdue", !!entry.overdue);
      built.el.classList.toggle("is-off", !!entry.pumpOff);
      return built;
    }

    function place(parent, built) {
      if (built.el.parentNode !== parent) parent.appendChild(built.el);
      else if (built.el !== parent.lastChild) parent.appendChild(built.el);
    }

    function pruneRows(keep) {
      for (const [key, built] of state.rows) {
        if (keep.has(key)) continue;
        if (built.el.parentNode) built.el.parentNode.removeChild(built.el);
        state.rows.delete(key);
      }
    }

    /* ---- Events (cards on the axis) ---- */

    function groupKeyOf(group) {
      return group.members.map(member => member.key).join("+");
    }

    function event(group) {
      const key = groupKeyOf(group);
      let built = state.events.get(key);
      if (built) return built;
      const el = element(doc, "div", "slate-timeline__event", { "data-group": key });
      const dot = element(doc, "span", "slate-timeline__dot", { "aria-hidden": "true" });
      // A line from the dot to its own card: dots and cards stand in the
      // same order, so no two leaders cross, however far a card is pushed.
      const leader = doc.createElementNS(SVG_NS, "svg");
      leader.setAttribute("class", "slate-timeline__leader");
      leader.setAttribute("aria-hidden", "true");
      leader.setAttribute("focusable", "false");
      const leaderPath = doc.createElementNS(SVG_NS, "path");
      leaderPath.setAttribute("class", "slate-timeline__leader-path");
      leader.appendChild(leaderPath);
      const card = element(doc, "div", "slate-timeline__card");
      const when = text(doc, "p", "slate-timeline__when", "");
      const members = element(doc, "div", "slate-timeline__members");
      const factsLine = text(doc, "p", "slate-timeline__facts", "");
      card.appendChild(when);
      card.appendChild(members);
      card.appendChild(factsLine);
      el.appendChild(leader);
      el.appendChild(dot);
      el.appendChild(card);
      built = { el, dot, leader, leaderPath, card, when, members, facts: factsLine, key };
      state.events.set(key, built);
      eventsEl.appendChild(el);
      return built;
    }

    function pruneEvents(keep) {
      for (const [key, built] of state.events) {
        if (keep.has(key)) continue;
        if (built.el.parentNode) built.el.parentNode.removeChild(built.el);
        state.events.delete(key);
      }
    }

    /* A single card: "pump off by 1:12 AM · in 1h 51m". A group's members
     * each carry their clock, so its head is the count and the countdown. */
    /* A card's head, short: its minute - or, for a group, its span - and
     * the countdown. With a changeover every card on the axis is a pump-off
     * (the Timeline says so, and its pills), so the head says only when;
     * without one the cards mark when hoppers run empty, and say "empty".
     * The full words are the head's title (fullWhenText). */
    function whenText(group, at) {
      const until = group.at - at;
      const countdown = until < 0 ? "now" : `in ${rundownModule.formatRemaining(until)}`;
      return `${group.kind === "empty" ? "empty " : ""}${clockOf(group)} · ${countdown}`;
    }

    function fullWhenText(group, at) {
      const until = group.at - at;
      const countdown = until < 0 ? "now" : `in ${rundownModule.formatRemaining(until)}`;
      const clock = clockOf(group);
      const verb = group.kind === "empty" ? (clock.includes("–") ? "empty" : "empty at") : (clock.includes("–") ? "pump off" : "pump off by");
      return `${verb} ${clock} · ${countdown}`;
    }

    /* One clock when a group's minutes share one, the span otherwise - so
     * a group's rows keep their room for the resin. */
    function clockOf(group) {
      if (group.members.length > 1) {
        const marks = group.members.map(member => member.markAt).filter(Number.isFinite);
        const first = rundownModule.formatClock(marks.length ? Math.min(...marks) : group.at);
        const last = rundownModule.formatClock(marks.length ? Math.max(...marks) : group.at);
        return first === last ? first : clockRange(first, last);
      }
      return rundownModule.formatClock(group.at);
    }

    /* "8:17 PM" and "8:18 PM" read as "8:17–8:18 PM": the half of the day
     * said once when both share it. */
    function clockRange(first, last) {
      const meridiem = /\s?([AaPp]\.?[Mm]\.?)$/;
      const a = first.match(meridiem);
      const b = last.match(meridiem);
      if (a && b && a[1].toUpperCase() === b[1].toUpperCase()) return `${first.replace(meridiem, "")}–${last}`;
      return `${first}–${last}`;
    }

    /* ---- Ticks and lines ---- */

    /* The marks down the axis; a label that would run into the changeover
     * line keeps its tick and loses its label. */
    function paintTicks(marks, avoidY, origin) {
      clear(ticksEl);
      const start = Number.isFinite(origin) ? origin : TOP_INSET;
      for (const mark of marks) {
        const tick = element(doc, "div", "slate-timeline__tick", { "data-kind": mark.kind });
        tick.style.top = px(start + mark.y);
        const clear = !Number.isFinite(avoidY) || Math.abs(mark.y - avoidY) >= layoutModule.LABEL_EDGE_PX;
        if (mark.label && clear) tick.appendChild(text(doc, "span", "slate-timeline__tick-label", mark.label));
        ticksEl.appendChild(tick);
      }
    }

    /* ---- Abilities ---- */

    // The idle line: no line, nothing tracked (in the tracking mode's
    // words), or a stale changeover.
    function paintNotice(model, tracked) {
      const noneTracked = trackingMode() === "automatic" ? NONE_TRACKED_AUTOMATIC : NONE_TRACKED;
      const noticeText = !model ? NO_LINE : (tracked === 0 ? noneTracked : (state.changeover.stale ? STALE_CHANGEOVER : ""));
      setText(notice, noticeText);
      show(notice, !!noticeText);
    }

    // A preference moved: the pump toggles re-read their ability, the
    // idle line follows the tracking mode, and a changed view redraws.
    function refresh() {
      paintAlarm();
      if (viewNow() !== state.view) { render(); return; }
      applyAbilities();
      paintNotice(state.inputs && state.inputs.model, state.entries.length);
    }

    /* ---- Next (a phone's) ---- */

    const NEXT_MAX = 4;

    function nextRow(entry) {
      let built = nextRows.get(entry.key);
      if (!built) {
        const el = element(doc, "div", "slate-timeline__next-row", { "data-key": entry.key });
        const name = element(doc, "span", "slate-timeline__next-name");
        const id = text(doc, "span", "slate-timeline__next-id", entry.id);
        const resin = text(doc, "span", "slate-timeline__next-resin", "");
        name.appendChild(id);
        name.appendChild(resin);
        const button = text(doc, "button", "slate-timeline__next-pump", "Pump off", {
          type: "button", "data-slate-control": "pump", "data-layer": entry.layer, "data-index": String(entry.index),
          "aria-pressed": "false", "data-able": "false", "aria-label": `Turn ${entry.id}'s pump off`
        });
        el.appendChild(name);
        el.appendChild(button);
        built = { el, resin, button };
        nextRows.set(entry.key, built);
      }
      setText(built.resin, entry.resin || "no resin");
      return built;
    }

    /* The late, else the next group due, else the next beyond the horizon. */
    function paintNext(at) {
      const grouped = state.grouped;
      let kind = null;
      let members = [];
      if (grouped && grouped.overdue) { kind = "late"; members = grouped.overdue.members; }
      else if (grouped && grouped.groups.length) { kind = "next"; members = grouped.groups[0].members; }
      else if (grouped && grouped.later.length) { kind = "next"; members = [grouped.later[0]]; }
      // A phone's alone: elsewhere the cards are in reach and nothing is drawn.
      if (!phoneTier()) kind = null;
      show(nextEl, !!kind);
      if (!kind) { clear(nextRowsEl); nextRows.clear(); return; }
      const first = members[0];
      const empty = first.markKind === "empty";
      nextEl.setAttribute("data-kind", kind);
      setText(nextHead, kind === "late"
        ? (empty ? "Late - ran empty" : "Late - turn the pump off")
        : (empty ? "Next to run empty" : "Next - turn the pump off"));
      const clockText = rundownModule.formatClock(first.markAt);
      setText(nextWhen, kind === "late"
        ? `${clockText} · ${rundownModule.formatRemaining(at - first.markAt)} late`
        : `${clockText} · in ${rundownModule.formatRemaining(first.markAt - at)}`);
      const shown = members.slice(0, NEXT_MAX);
      const keep = new Set(shown.map(member => member.key));
      for (const [key, built] of nextRows) {
        if (keep.has(key)) continue;
        if (built.el.parentNode) built.el.parentNode.removeChild(built.el);
        nextRows.delete(key);
      }
      shown.forEach((member, index) => {
        const built = nextRow(member);
        built.button.classList.toggle("is-late", kind === "late");
        if (nextRowsEl.children[index] !== built.el) nextRowsEl.insertBefore(built.el, nextRowsEl.children[index] || null);
      });
      const more = members.length - shown.length;
      setText(nextMore, more > 0 ? `and ${more} more below` : "");
      show(nextMore, more > 0);
    }

    function applyAbilities() {
      const bridge = commands();
      const options = guard();
      const able = trackingModule.abilities(bridge, options);
      rootEl.classList.toggle("is-readonly", !!options.readOnly);
      for (const built of nextRows.values()) {
        built.button.setAttribute("data-able", able.pump ? "true" : "false");
        if (!able.pump) built.button.setAttribute("title", `Pump off: ${trackingModule.reason(bridge, "pump", options)}`);
        else built.button.removeAttribute("title");
      }
      for (const built of state.rows.values()) {
        const on = built.button.getAttribute("aria-pressed") === "true";
        built.button.setAttribute("data-able", able.pump ? "true" : "false");
        const label = trackingModule.stateLabel("pump", on);
        built.button.setAttribute("title", able.pump
          ? `${label} — click to ${trackingModule.actionLabel("pump", on)}`
          : `${label} — ${trackingModule.reason(bridge, "pump", options)}`);
      }
    }

    /* ---- Render ---- */

    function focusedKey() {
      const active = doc.activeElement;
      if (!active || typeof active.closest !== "function") return null;
      const member = active.closest("[data-key]");
      return member && rootEl.contains(member) ? member.getAttribute("data-key") : null;
    }

    function render() {
      const at = now();
      project(at);
      const entries = state.entries;
      const model = state.inputs && state.inputs.model;
      const keep = new Set();
      const focused = focusedKey();

      setText(clock, rundownModule.formatClock(at));
      state.window = layoutModule.windowFor({ now: at, changeover: state.changeover, horizonHours: state.horizon });
      const fit = state.window.mode === "fit";
      rootEl.setAttribute("data-mode", state.window.mode);
      show(scale, !fit);
      for (const [hours, button] of rangeButtons) button.setAttribute("aria-pressed", hours === state.horizon ? "true" : "false");
      setText(changeoverLine, changeoverText(state.changeover, at));
      rootEl.classList.toggle("is-stale", !!state.changeover.stale);
      rootEl.classList.toggle("is-unset", state.changeover.at === null);

      const tracked = entries.length;
      const idle = !model || tracked === 0;
      rootEl.classList.toggle("is-idle", idle);
      setText(counts, idle ? "" : countsFor(entries));
      paintNotice(model, tracked);

      state.view = viewNow();
      const listing = state.view === "list";
      rootEl.setAttribute("data-view", state.view);
      show(axis, !listing);
      show(viewport, !listing);
      show(listEl, listing);
      if (listing) show(scale, false);
      if (listing) {
        renderList(entries, at, keep);
      } else {
        renderAxis(entries, at, keep, fit);
      }

      // The foot: pumped off, in the grouping's order.
      const off = state.grouped ? state.grouped.done : [];
      show(done, off.length > 0);
      for (const entry of off) {
        keep.add(entry.key);
        const built = paintRow(entry, "Off", at);
        // A row that stood in the list carried its mark as a title; off, it has none.
        built.el.removeAttribute("title");
        place(doneList, built);
      }
      pruneRows(keep);
      paintNext(at);
      // A correction whose hopper is no longer pumped off has nothing to say.
      if (state.correcting && !off.some(entry => entry.key === state.correcting.key)) closeCorrection();
      applyAbilities();

      // A row moved to another card blurs in a real browser: give the
      // operator's focus back.
      if (focused && state.rows.has(focused)) {
        const button = state.rows.get(focused).button;
        // preventScroll: a panned tablet must not be yanked to the aside on
        // every tick while a pill keeps the focus it was tapped into.
        if (doc.activeElement !== button && typeof button.focus === "function") button.focus({ preventScroll: true });
      }
      return state.placed;
    }

    /* The list: every tracked hopper that is not pumped off, as a row -
     * late first, then by mark, then those with no estimate - each saying
     * its clock and countdown. No axis, no horizon, no cards. */
    function listAt(entry, at) {
      if (entry.reason || !Number.isFinite(entry.markAt)) return rundownModule.reasonLabel(entry.reason);
      const clock = rundownModule.formatClock(entry.markAt);
      if (entry.markAt < at) return `${clock} · late`;
      return `${clock} · in ${rundownModule.formatRemaining(entry.markAt - at)}`;
    }

    function renderList(entries, at, keep) {
      state.grouped = layoutModule.groupEvents(entries, { now: at, windowMs: state.window.windowMs });
      state.placed = null;
      pruneEvents(new Set());
      clear(ticksEl);
      clear(chips);
      show(chips, false);
      show(pinned, false);
      rootEl.classList.toggle("is-overdue", entries.some(entry => entry.overdue && !entry.pumpOff));
      const timed = entries.filter(entry => !entry.pumpOff && !entry.reason && Number.isFinite(entry.markAt)).sort((a, b) => a.markAt - b.markAt);
      const untimed = entries.filter(entry => !entry.pumpOff && (entry.reason || !Number.isFinite(entry.markAt)));
      const ordered = [];
      for (const entry of timed.concat(untimed)) {
        keep.add(entry.key);
        const built = paintRow(entry, listAt(entry, at), at);
        built.el.setAttribute("title", Number.isFinite(entry.markAt)
          ? `${entry.id} ${entry.markKind === "empty" ? "empty at" : "pump off by"} ${rundownModule.formatClock(entry.markAt)}`
          : `${entry.id}: ${rundownModule.reasonLabel(entry.reason)}`);
        ordered.push(built.el);
      }
      // Rows stand in time order; they are re-appended only when the
      // document disagrees, so a tick never moves a focused row.
      if (ordered.some((el, index) => listEl.children[index] !== el) || listEl.children.length !== ordered.length) {
        for (const el of ordered) listEl.appendChild(el);
      }
    }

    /* The axis: the clock, the cards at their marks, the pinned block,
     * the chips beyond the horizon. */
    function renderAxis(entries, at, keep, fit) {
      const bottomInsetFor = fit ? CHANGEOVER_INSET : BOTTOM_INSET;
      /* On a phone the Timeline is a page that scrolls. What is late is
       * past: its block stands above the Now line, and the time scale - the
       * ticks, the cards, the changeover - starts under it, so however many
       * hoppers are late none of it lies over the changeover. The axis
       * takes the height all of that needs. */
      const phone = phoneTier();
      let origin = TOP_INSET;
      if (phone) {
        const early = layoutModule.groupEvents(entries, { now: at, windowMs: state.window.windowMs });
        const late = early.overdue ? cardHeight(Object.assign({ pinned: true }, early.overdue)) + 2 * GAP : 0;
        origin = TOP_INSET + late;
        const cards = early.groups.reduce((sum, group) => sum + cardHeight(group) + GAP, 0);
        // Every run of cards - from any one to the last - stacks from its
        // first card's instant and must end by the changeover's (or the
        // axis's end): the scale is stretched until the most crowded run
        // fits, within reason.
        const windowMs = state.window.windowMs;
        const changeoverAt = state.changeover && Number.isFinite(state.changeover.at) && !state.changeover.stale ? state.changeover.at : null;
        const endFraction = changeoverAt !== null && changeoverAt > at && changeoverAt <= at + windowMs ? (changeoverAt - at) / windowMs : 1;
        let span = cards;
        let tail = 0;
        for (let index = early.groups.length - 1; index >= 0; index -= 1) {
          const group = early.groups[index];
          tail += cardHeight(group) + GAP;
          const fraction = Math.max(0, Math.min(1, group.fraction || 0));
          span = Math.max(span, tail / Math.max(endFraction - fraction, 0.05));
        }
        span = Math.min(span, MAX_PHONE_SPAN);
        axis.style.minHeight = px(origin + bottomInsetFor + span + GAP);
      }
      /* A desktop or a tablet: the axis fits its window while the cards
       * fit in it apart - hoppers within five minutes of each other share a
       * card, and no others - and grows past the window when they need more,
       * the window then scrolling. Every dot stays at its own instant. */
      let grown = null;
      if (!phone) {
        const early = layoutModule.groupEvents(entries, { now: at, windowMs: state.window.windowMs });
        const overdue = early.overdue ? Object.assign({ pinned: true }, early.overdue) : null;
        state.visible = visibleHeight();
        const need = layoutModule.spanNeeded(early.groups, {
          cardHeight,
          gap: GAP,
          floorOffset: overdue ? cardHeight(overdue) + 2 * GAP : 0,
          minSpan: Math.max(state.visible - TOP_INSET - bottomInsetFor, 0),
          maxSpan: MAX_SPAN
        });
        if (need.grows) {
          grown = TOP_INSET + need.span + bottomInsetFor;
          axis.style.minHeight = px(grown);
        } else if (axis.style.minHeight) {
          axis.style.minHeight = "";
        }
      }
      rootEl.classList.toggle("is-scrolling", grown !== null);
      paintEdges();
      const height = grown !== null ? grown : measuredHeight();
      state.height = height;
      const windowMs = state.window.windowMs;
      const bottomInset = fit ? CHANGEOVER_INSET : BOTTOM_INSET;
      const span = Math.max(height - origin - bottomInset, 0);
      nowLine.style.top = px(origin);

      const usable = Number.isFinite(state.changeover.at) && !state.changeover.stale && state.changeover.at > at && state.changeover.at <= at + windowMs;
      const changeoverY = usable ? ((state.changeover.at - at) / windowMs) * span : null;
      show(changeoverMark, usable);
      if (usable) {
        changeoverMark.style.top = px(origin + changeoverY);
        setText(changeoverLabel, `Changeover ${rundownModule.formatClock(state.changeover.at)}`);
      }
      paintTicks(layoutModule.verticalTicks({ now: at, windowMs, height: span }).marks, changeoverY, origin);

      state.grouped = layoutModule.groupEvents(entries, { now: at, windowMs });
      const grouped = state.grouped;
      const overdueBlock = grouped.overdue ? Object.assign({ pinned: true }, grouped.overdue) : null;
      // A phone's late block is laid above the scale (origin), not on it.
      state.placed = layoutModule.placeCards(grouped.groups, { height, topInset: origin, bottomInset, gap: GAP, cardHeight, pinned: phone ? null : overdueBlock });
      const placed = state.placed;

      // The pinned block: what is late now.
      rootEl.classList.toggle("is-overdue", !!overdueBlock);
      show(pinned, !!overdueBlock);
      if (overdueBlock) {
        pinned.style.top = px(phone ? GAP : placed.pinned.y);
        const count = overdueBlock.members.length;
        setText(pinnedWhen, overdueBlock.kind === "empty"
          ? (count > 1 ? `${count} hoppers past their estimated empty` : "Past its estimated empty")
          : (count > 1 ? `${count} hoppers late for pump-off` : "Late for pump-off"));
        for (const member of overdueBlock.members) {
          keep.add(member.key);
          const built = paintRow(member, rundownModule.formatClock(member.markAt), at);
          place(pinnedMembers, built);
        }
      }

      // The cards.
      const keepEvents = new Set();
      const titled = new Map();
      for (const card of placed.cards) {
        const group = card.group;
        const built = event(group);
        keepEvents.add(built.key);
        // The event box starts at whichever is higher, the instant or the
        // card; the dot sits at the instant, the leader runs from it to the
        // card's top corner.
        const top = Math.min(card.y0, card.y);
        built.el.style.top = px(top);
        // Neighbours are the only leaders that can run side by side: they
        // alternate in colour, down the axis in time order (timeline.css).
        built.el.setAttribute("data-lead", placed.cards.indexOf(card) % 2 ? "alt" : "main");
        built.dot.style.top = px(card.y0 - top);
        const line = leaderFor(card.y0 - top, card.y - top);
        built.leader.setAttribute("width", String(CARD_LEFT));
        built.leader.setAttribute("height", String(line.height));
        built.leaderPath.setAttribute("d", line.d);
        built.card.style.top = px(card.y - top);
        built.card.classList.toggle("is-group", group.members.length > 1);
        built.card.classList.toggle("is-merged", !!group.merged);
        built.card.classList.toggle("is-empty-kind", group.kind === "empty");
        built.card.classList.toggle("is-late", !!group.late);
        built.card.classList.toggle("is-clipped", !!card.clipped);
        built.card.classList.toggle("is-displaced", Math.abs(card.displacement) > 1);
        setText(built.when, whenText(group, at));
        built.when.setAttribute("title", fullWhenText(group, at));
        const single = group.members.length === 1 ? group.members[0] : null;
        setText(built.facts, single ? facts(single) : "");
        show(built.facts, !!single);
        for (const member of group.members) {
          keep.add(member.key);
          const rowBuilt = paintRow(member, rundownModule.formatClock(member.markAt), at);
          place(built.members, rowBuilt);
          // In a group the row's own clock is its title (the head says the span).
          if (group.members.length > 1) titled.set(member.key, `${member.id} ${group.kind === "empty" ? "empty at" : "pump off by"} ${rundownModule.formatClock(member.markAt)}`);
        }
      }
      pruneEvents(keepEvents);
      // Reading order follows the axis: the event boxes stand in time order.
      const ordered = placed.cards.map(card => state.events.get(groupKeyOf(card.group)).el);
      if (ordered.some((el, index) => eventsEl.children[index] !== el)) for (const el of ordered) eventsEl.appendChild(el);

      // The chips: beyond the horizon, and without an estimate.
      clear(chips);
      for (const entry of grouped.later) {
        chips.appendChild(text(doc, "span", "slate-timeline__chip is-later", `${entry.id} → ${rundownModule.formatRemaining(entry.markAt - at)}`, { "data-key": entry.key, title: `${entry.id} ${entry.markKind === "empty" ? "empty at" : "pump off by"} ${rundownModule.formatClock(entry.markAt)}` }));
      }
      for (const entry of grouped.unavailable) {
        // A hopper with no weight names the page that gives it one: on a
        // phone a tap there opens Weights (the boot's openWeights).
        const attributes = entry.reason === "no-weight" ? { "data-key": entry.key, "data-slate-weights": "" } : { "data-key": entry.key };
        chips.appendChild(text(doc, "span", "slate-timeline__chip is-unavailable", `${entry.id} · ${rundownModule.reasonLabel(entry.reason)}`, attributes));
      }
      show(chips, grouped.later.length + grouped.unavailable.length > 0);
      // A row that stood in the list carries a title the card's head says
      // instead - but for a group's, whose own clock is its title.
      for (const [key, built] of state.rows) {
        if (titled.has(key)) built.el.setAttribute("title", titled.get(key));
        else built.el.removeAttribute("title");
      }
    }

    /* ---- Results ---- */

    function settle(result) {
      if (!result) return result;
      if (result.ok && result.changed) onCommitted(result);
      else if (!result.ok) say(result.message || "The application refused the change.");
      return result;
    }

    // A hurried double tap on Pump off would send off and then on again: a
    // second tap on the same control within DOUBLE_TAP_MS of the first is
    // spent. A finger's or a pen's only (a click reports its pointerType):
    // a mouse's deliberate second click goes as it always has. Measured on
    // the events' own clock.
    const DOUBLE_TAP_MS = 400;
    let lastToggle = null;

    rootEl.addEventListener("click", event => {
      const target = event && event.target;
      if (!target || typeof target.closest !== "function") return;
      const range = target.closest("[data-window]");
      if (range && rootEl.contains(range)) { setWindow(Number(range.getAttribute("data-window"))); return; }
      const toggle = target.closest("[data-slate-control]");
      if (!toggle || !rootEl.contains(toggle) || toggle.hasAttribute("disabled")) return;
      const request = trackingModule.requestFrom(toggle);
      if (!request) return;
      if (!request.able) {
        say(`${trackingModule.stateLabel(request.control, request.on)}: ${trackingModule.reason(commands(), request.control, guard())}`);
        return;
      }
      const stamp = Number(event.timeStamp);
      const finger = !!event.pointerType && event.pointerType !== "mouse";
      if (finger && Number.isFinite(stamp) && stamp > 0) {
        if (lastToggle && lastToggle.toggle === toggle && stamp - lastToggle.at < DOUBLE_TAP_MS) return;
        lastToggle = { toggle, at: stamp };
      }
      settle(trackingModule.toggle(commands(), { control: request.control, layer: request.layer, index: request.index, next: !request.on }));
    });

    /* ---- Clock ---- */

    function schedule() {
      if (state.timer !== null) timers.clearTimeout(state.timer);
      state.timer = timers.setTimeout(tick, tickMs);
    }

    function marks() {
      return rundownModule.hopperMarks(state.entries);
    }

    function tick() {
      state.timer = null;
      render();
      try { onTick(marks()); } catch (error) { /* the boot's listener cannot stop the clock */ }
      schedule();
    }

    function wake() {
      render();
      schedule();
    }

    const visibility = settings.visibility && typeof settings.visibility.addEventListener === "function" ? settings.visibility : null;
    if (visibility) visibility.addEventListener("visibilitychange", wake);

    const view = settings.view || null;
    if (view && typeof view.ResizeObserver === "function") {
      // The axis is hidden in the list view; its collapse is not a resize to draw for.
      // A grown axis keeps its height while its window changes: the window's
      // own height is watched too.
      state.resize = new view.ResizeObserver(() => { if (state.inputs && state.view !== "list" && (measuredHeight() !== state.height || visibleHeight() !== state.visible)) render(); });
      state.resize.observe(axis);
      state.resize.observe(viewport);
    }

    /* ---- API ---- */

    function setWindow(hours) {
      if (!rundownModule.WINDOWS.includes(hours) || hours === state.horizon) return state.horizon;
      state.horizon = hours;
      render();
      return state.horizon;
    }

    /** New state: re-anchor, re-project, redraw. */
    function paintAlarm() {
      const alarm = state.alarm;
      show(alarmButton, !!alarm && trackingModule.alarmAble(commands()));
      alarmButton.setAttribute("aria-checked", alarm && alarm.enabled ? "true" : "false");
    }

    /* ---- Ran out early ---- */

    /* "14:05" read as the latest such moment no later than `limit`. */
    function momentFrom(value, limit) {
      const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || ""));
      if (!match) return NaN;
      const date = new Date(limit);
      date.setHours(Number(match[1]), Number(match[2]), 0, 0);
      let at = date.getTime();
      if (at > limit + 60 * 1000) at -= 24 * 60 * 60 * 1000;
      return at;
    }

    function clockValue(at) {
      const date = new Date(at);
      return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
    }

    function measureNow() {
      return weightActions.measureFor(weightActions.smartFrom(state.resolved));
    }

    function describe(correction, id) {
      if (!correction.ok) return runoutModule.reasonText(correction.reason);
      const what = correction.target === "geometry" ? `${correction.dimension === "volume" ? "Capacity" : "Usable height"} (Smart Hoppers)` : "Receiver weight";
      return `${what}: ${correction.from} ${correction.unit} → ${correction.to} ${correction.unit}`;
    }

    function paintCorrection() {
      const open = state.correcting;
      if (!open) return;
      const at = now();
      open.ranOutAt = momentFrom(outInput.value, at);
      open.pumpedOffAt = momentFrom(offInput.value, Number.isFinite(open.ranOutAt) ? open.ranOutAt : at);
      const runtime = state.inputs && state.inputs.hopperState ? (state.inputs.hopperState[open.key] || {}) : {};
      open.correction = runoutModule.correctionFor({ entry: open.entry, runtime, measure: measureNow(), pumpedOffAt: open.pumpedOffAt, ranOutAt: open.ranOutAt });
      const c = open.correction;
      setText(correctFed, c.fedMs > 0 && c.expectedMs > 0
        ? `Fed ${rundownModule.formatRemaining(c.fedMs)} of an expected ${rundownModule.formatRemaining(c.expectedMs)}${c.ratio < 1 ? ` (${Math.round((1 - c.ratio) * 100)}% short)` : ""}.`
        : "");
      setText(correctChange, describe(c, open.entry.id));
      correctChange.classList.toggle("is-change", c.ok);
      const shared = c.ok ? runoutModule.sharedShortfall(state.ratios.concat([c.ratio])) : null;
      setText(correctShared, shared ? `Several hoppers ran out about ${Math.round(shared * 100)}% early this run: the line's output may be set too high, rather than these weights.` : "");
      show(correctShared, !!shared);
      const bridge = commands();
      const able = weightActions.abilities(bridge, guard());
      const can = c.ok && !!able[c.target === "geometry" ? "geometry" : "weight"];
      correctApply.setAttribute("data-able", can ? "true" : "false");
      correctApply.setAttribute("title", can ? "Correct the stored value" : (c.ok ? `Unavailable: ${weightActions.reason(bridge, c.target === "geometry" ? "geometry" : "weight", guard())}` : runoutModule.reasonText(c.reason)));
    }

    function paintProfiles(preferred) {
      while (profileSelect.firstChild) profileSelect.removeChild(profileSelect.firstChild);
      const none = text(doc, "option", "", "Don't update a profile", { value: "" });
      profileSelect.appendChild(none);
      const book = profileActions.bookOf(profiles);
      const list = book && Array.isArray(book.profiles) ? book.profiles : [];
      const canUpdate = !!profileActions.can(profiles, guard()).update;
      for (const profile of list) profileSelect.appendChild(text(doc, "option", "", profile.name, { value: profile.id }));
      profileSelect.value = canUpdate && preferred && list.some(profile => profile.id === preferred) ? preferred : "";
      show(profileLabel, canUpdate && list.length > 0);
    }

    function openCorrection(key) {
      const entry = (state.grouped ? state.grouped.done : []).find(one => one.key === key);
      if (!entry) return;
      const at = now();
      // When the pump went off: the application's record, else the planned moment.
      const pumpedOffAt = Number.isFinite(entry.pumpOffAt) ? entry.pumpOffAt : (Number.isFinite(entry.pumpOffBy) ? entry.pumpOffBy : at);
      disarmApply();
      state.correcting = { key, entry: Object.assign({}, entry), pumpedOffAt, ranOutAt: at, correction: null, busy: false };
      setText(correctTitle, `${entry.id} ${entry.resin || ""} ran out early`.replace(/\s+/g, " "));
      offInput.value = clockValue(pumpedOffAt);
      outInput.value = clockValue(at);
      offInput.setAttribute("title", Number.isFinite(entry.pumpOffAt) ? "When the pump went off, as recorded" : "The planned pump-off time: correct it if the pump went off at another time");
      setText(correctNote, "");
      show(correctNote, false);
      paintProfiles(lastProfile());
      show(correct, true);
      paintCorrection();
    }

    function closeCorrection() {
      disarmApply();
      state.correcting = null;
      show(correct, false);
    }

    /* The second press is the one that corrects: the first arms Apply as
     * Confirm, which stands down on its own after RANOUT_ARM_MS. */
    let armTimer = null;
    function disarmApply() {
      if (armTimer !== null) { timers.clearTimeout(armTimer); armTimer = null; }
      if (!correctApply.hasAttribute("data-armed")) return;
      correctApply.removeAttribute("data-armed");
      correctApply.textContent = RANOUT_APPLY_LABEL;
    }

    function pressApply() {
      const open = state.correcting;
      if (!open || open.busy) return;
      if (correctApply.hasAttribute("data-armed")) { disarmApply(); applyCorrection(); return; }
      paintCorrection();
      const c = open.correction;
      if (!c || !c.ok || correctApply.getAttribute("data-able") !== "true") { say(correctApply.getAttribute("title") || runoutModule.reasonText(c && c.reason)); return; }
      correctApply.setAttribute("data-armed", "");
      correctApply.textContent = RANOUT_CONFIRM_LABEL;
      say(`Press Confirm to apply: ${describe(c, open.entry.id)}`);
      armTimer = timers.setTimeout(() => { armTimer = null; disarmApply(); }, RANOUT_ARM_MS);
    }

    async function applyCorrection() {
      const open = state.correcting;
      if (!open || open.busy) return;
      paintCorrection();
      const c = open.correction;
      if (!c || !c.ok || correctApply.getAttribute("data-able") !== "true") { say(correctApply.getAttribute("title") || runoutModule.reasonText(c && c.reason)); return; }
      const entry = open.entry;
      const bridge = commands();
      const result = c.target === "geometry"
        ? weightActions.setGeometry(bridge, entry.layer, entry.index, c.dimension, c.to)
        : weightActions.setWeight(bridge, entry.layer, entry.index, c.to);
      if (!result || !result.ok) {
        setText(correctNote, (result && result.message) || "The application refused the change.");
        show(correctNote, true);
        return;
      }
      if (result.changed) onCommitted(result);
      state.ratios.push(c.ratio);
      const profileId = profileSelect.value;
      const said = `${entry.id}: ${c.target === "geometry" ? (c.dimension === "volume" ? "capacity" : "usable height") : "receiver weight"} is now ${c.to} ${c.unit}.`;
      if (!profileId) { closeCorrection(); say(said); return; }
      open.busy = true;
      correctApply.setAttribute("disabled", "");
      let answer;
      try {
        answer = await profileActions.replace(profiles, profileId);
      } finally {
        open.busy = false;
        correctApply.removeAttribute("disabled");
      }
      const book = profileActions.bookOf(profiles);
      const profile = book && Array.isArray(book.profiles) ? book.profiles.find(one => one.id === profileId) : null;
      const name = profile ? profile.name : "the weight profile";
      if (answer && answer.ok) { closeCorrection(); say(`${said} “${name}” was updated with the line's weights.`); return; }
      // The hopper is corrected; only the profile was refused.
      setText(correctNote, `${said} “${name}” was not updated: ${(answer && answer.message) || "the application refused it."}`);
      show(correctNote, true);
    }

    // A changed time changes what Confirm would apply: it asks again.
    for (const input of [offInput, outInput]) input.addEventListener("input", () => { disarmApply(); paintCorrection(); });
    profileSelect.addEventListener("change", () => disarmApply());
    correct.addEventListener("click", event => {
      const target = event && event.target;
      const button = target && typeof target.closest === "function" ? target.closest("[data-slate-runout]") : null;
      if (!button) return;
      const action = button.getAttribute("data-slate-runout");
      if (action === "cancel") closeCorrection();
      else if (action === "apply") pressApply();
    });
    correct.addEventListener("keydown", event => {
      if (event && event.key === "Escape") { if (typeof event.stopPropagation === "function") event.stopPropagation(); closeCorrection(); }
    });
    doneList.addEventListener("click", event => {
      const target = event && event.target;
      const button = target && typeof target.closest === "function" ? target.closest("[data-slate-ranout]") : null;
      if (!button || !doneList.contains(button)) return;
      openCorrection(button.getAttribute("data-slate-ranout"));
    });

    function update(resolved) {
      state.resolved = resolved || null;
      state.alarm = resolved && resolved.alarm ? resolved.alarm : null;
      paintAlarm();
      const at = now();
      state.inputs = resolved && resolved.line
        ? { model: resolved.line, hopperState: resolved.hopperState || {}, layerState: resolved.layerState || {}, job: resolved.job || {}, next: resolved.plan && resolved.plan.planned ? (resolved.nextHopperState || {}) : null }
        : null;
      observe(state.inputs, at);
      const placed = render();
      if (state.timer === null) schedule();
      return placed;
    }

    function destroy() {
      disarmApply();
      if (state.timer !== null) timers.clearTimeout(state.timer);
      state.timer = null;
      if (visibility && typeof visibility.removeEventListener === "function") visibility.removeEventListener("visibilitychange", wake);
      if (state.resize && typeof state.resize.disconnect === "function") state.resize.disconnect();
      state.resize = null;
    }

    return Object.freeze({
      element: rootEl,
      update,
      refresh,
      correction: () => (state.correcting ? Object.assign({}, state.correcting.correction, { key: state.correcting.key }) : null),
      tick,
      wake,
      marks,
      setWindow,
      getWindow: () => state.window,
      destroy,
      entries: () => state.entries.slice(),
      grouped: () => state.grouped,
      placed: () => state.placed,
      observed: observedAt
    });
  }

  return Object.freeze({
    TICK_MS, RANOUT_ARM_MS, RANOUT_APPLY_LABEL, RANOUT_CONFIRM_LABEL, FALLBACK_HEIGHT, NONE_TRACKED, NONE_TRACKED_AUTOMATIC, STALE_CHANGEOVER, NO_LINE,
    TOP_INSET, BOTTOM_INSET, CHANGEOVER_INSET, GAP, CARD_PAD, CARD_HEAD, MEMBER_ROW, CARD_FACTS, DOT_X, CARD_LEFT, LEADER_INTO, leaderFor,
    cardHeight, facts, countsFor, changeoverText, create
  });
});
