/* The right pane, in phase 1: what the run-down says next.
 *
 * The vertical timeline is designed in its own session. Until it lands
 * the pane is honest about the job: which tracked hopper is next to need
 * attention - to be pumped off ahead of the changeover, or to run empty -
 * and the few after it. The arithmetic is station-rundown.js's, the pure
 * projection the application's own formula is pinned to; this module
 * anchors weights, keeps a clock, and words the answer.
 *
 * The clock ticks every 20 seconds (a run-down is measured in minutes),
 * wakes on visibility, and tells the boot each time so the job's cards
 * and the recipe's rows follow it.
 */
(function (root, factory) {
  const rundown = typeof require === "function"
    ? require("../station/station-rundown.js")
    : (root && root.PolynStationRundown);
  const api = factory(rundown);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynSlateRundownSummary = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (rundownModule) {
  "use strict";

  const TICK_MS = 20000;
  const UPCOMING = 5;
  const NONE_TRACKED = "No hoppers tracked. Turn on Track in the recipe.";
  const STALE_CHANGEOVER = "Changeover needs confirming";

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

  function roleLabelFor(model, layerId) {
    const layer = model && Array.isArray(model.layers) ? model.layers.find(one => one.id === layerId) : null;
    return layer ? layer.roleLabel : "";
  }

  /* What the pane says, from the projection. Pure, exported and tested:
   * `next` is the first entry with a mark that is not already pumped off,
   * by ascending mark time; `upcoming` the few after it. */
  function summarize(entries, changeover, now, model) {
    const list = Array.isArray(entries) ? entries : [];
    const marked = list
      .filter(entry => Number.isFinite(entry.markAt) && !entry.pumpOff)
      .sort((a, b) => a.markAt - b.markAt);
    const unavailable = list.filter(entry => !Number.isFinite(entry.markAt) && !entry.pumpOff);
    const describe = entry => ({
      key: entry.key,
      id: entry.id,
      layer: entry.layer,
      roleLabel: roleLabelFor(model, entry.layer),
      resin: entry.resin || "",
      kind: entry.markKind || (entry.pumpOffBy !== null && entry.pumpOffBy !== undefined ? "pump-off" : "empty"),
      at: entry.markAt,
      untilMs: entry.markAt - now,
      late: !!entry.late,
      overdue: !!entry.overdue,
      reason: entry.reason || null
    });
    return {
      tracked: list.length,
      overdue: list.filter(entry => entry.overdue).length,
      pumpedOff: list.filter(entry => entry.pumpOff).length,
      next: marked.length > 0 ? describe(marked[0]) : null,
      upcoming: marked.slice(1, 1 + UPCOMING).map(describe),
      unavailable: unavailable.map(describe),
      changeover: changeover || { at: null, stale: false }
    };
  }

  function wording(next) {
    if (!next) return "";
    const where = next.roleLabel ? `${next.id} (Layer ${next.layer} · ${next.roleLabel})` : `${next.id} (Layer ${next.layer})`;
    const verb = next.kind === "pump-off" ? "pump off by" : "empty at";
    return `${where} ${verb} ${rundownModule.formatClock(next.at)}`;
  }

  /**
   * @param {Document} doc
   * @param {object} [options]
   * @param {function} [options.now]
   * @param {object} [options.timers]   { setTimeout, clearTimeout }
   * @param {number} [options.tickMs]
   * @param {function} [options.onTick]
   * @param {object} [options.visibility]  something with addEventListener("visibilitychange") - the document
   */
  function create(doc, options) {
    const settings = options || {};
    const now = typeof settings.now === "function" ? settings.now : () => Date.now();
    const timers = settings.timers || { setTimeout, clearTimeout };
    const tickMs = Number.isFinite(settings.tickMs) && settings.tickMs > 0 ? settings.tickMs : TICK_MS;
    const onTick = typeof settings.onTick === "function" ? settings.onTick : () => {};

    const rootEl = element(doc, "div", "slate-summary");
    const head = element(doc, "div", "slate-summary__head");
    head.appendChild(text(doc, "h2", "slate-summary__title", "Timeline"));
    head.appendChild(text(doc, "span", "slate-summary__phase", "Phase 2"));
    rootEl.appendChild(head);
    const lead = element(doc, "div", "slate-summary__lead");
    const nextLabel = text(doc, "p", "slate-summary__label", "Next");
    const nextLine = text(doc, "p", "slate-summary__next", "");
    const nextWhen = text(doc, "p", "slate-summary__when", "");
    lead.appendChild(nextLabel);
    lead.appendChild(nextLine);
    lead.appendChild(nextWhen);
    rootEl.appendChild(lead);
    const counts = text(doc, "p", "slate-summary__counts", "");
    rootEl.appendChild(counts);
    const notice = element(doc, "p", "slate-summary__notice", { hidden: "" });
    rootEl.appendChild(notice);
    const list = element(doc, "ul", "slate-summary__list");
    rootEl.appendChild(list);

    const state = { inputs: null, observed: {}, entries: [], summary: null, timer: null };

    /* Bring the anchors into line with what is tracked now: a hopper
     * newly tracked, or whose weight moved, is observed now; one no
     * longer tracked is forgotten. */
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

    function project() {
      const at = now();
      const inputs = state.inputs;
      if (!inputs) { state.entries = []; state.summary = summarize([], null, at, null); return state.summary; }
      const changeover = rundownModule.resolveChangeover(inputs.job, { now: at });
      state.entries = rundownModule.projectEntries(
        { model: inputs.model, hopperState: inputs.hopperState, layerState: inputs.layerState, job: inputs.job, observed: observedAt() },
        { now: at, changeoverAt: changeover.stale ? null : changeover.at }
      );
      state.summary = summarize(state.entries, changeover, at, inputs.model);
      return state.summary;
    }

    function line(item) {
      const li = element(doc, "li", "slate-summary__item", { "data-hopper": item.id });
      if (item.overdue) li.classList.add("is-overdue");
      else if (item.late) li.classList.add("is-late");
      li.appendChild(text(doc, "span", "slate-summary__item-id", item.id));
      li.appendChild(text(doc, "span", "slate-summary__item-resin", item.resin || "—"));
      if (Number.isFinite(item.at)) {
        li.appendChild(text(doc, "span", "slate-summary__item-at", rundownModule.formatClock(item.at)));
        li.appendChild(text(doc, "span", "slate-summary__item-in", item.untilMs < 0 ? "now" : `in ${rundownModule.formatRemaining(item.untilMs)}`));
      } else {
        li.appendChild(text(doc, "span", "slate-summary__item-at", "—"));
        li.appendChild(text(doc, "span", "slate-summary__item-in", rundownModule.reasonLabel ? rundownModule.reasonLabel(item.reason) : (item.reason || "")));
      }
      return li;
    }

    function render() {
      const summary = project();
      clear(list);
      const stale = !!(summary.changeover && summary.changeover.stale);
      notice.textContent = stale ? STALE_CHANGEOVER : "";
      if (stale) notice.removeAttribute("hidden");
      else notice.setAttribute("hidden", "");
      rootEl.classList.toggle("is-stale", stale);
      if (summary.tracked === 0) {
        nextLabel.textContent = "";
        nextLine.textContent = NONE_TRACKED;
        nextWhen.textContent = "";
        counts.textContent = "";
        rootEl.classList.add("is-idle");
        rootEl.classList.remove("is-overdue");
        return summary;
      }
      rootEl.classList.remove("is-idle");
      if (summary.next) {
        nextLabel.textContent = "Next";
        nextLine.textContent = wording(summary.next);
        nextWhen.textContent = summary.next.untilMs < 0 ? "now" : `in ${rundownModule.formatRemaining(summary.next.untilMs)}`;
      } else {
        nextLabel.textContent = "";
        nextLine.textContent = summary.pumpedOff === summary.tracked ? "Every tracked hopper is pumped off." : "No estimate yet for the tracked hoppers.";
        nextWhen.textContent = "";
      }
      const parts = [`${summary.tracked} tracked`];
      if (summary.overdue > 0) parts.push(`${summary.overdue} overdue`);
      if (summary.pumpedOff > 0) parts.push(`${summary.pumpedOff} pumped off`);
      counts.textContent = parts.join(" · ");
      rootEl.classList.toggle("is-overdue", summary.overdue > 0);
      for (const item of summary.upcoming) list.appendChild(line(item));
      for (const item of summary.unavailable) list.appendChild(line(item));
      return summary;
    }

    /* ---- Clock ---- */

    function schedule() {
      if (state.timer !== null) timers.clearTimeout(state.timer);
      state.timer = timers.setTimeout(tick, tickMs);
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

    function marks() {
      return rundownModule.hopperMarks(state.entries);
    }

    /** New state: re-anchor, re-project, redraw. */
    function update(resolved) {
      const at = now();
      state.inputs = resolved && resolved.line
        ? { model: resolved.line, hopperState: resolved.hopperState || {}, layerState: resolved.layerState || {}, job: resolved.job || {} }
        : null;
      observe(state.inputs, at);
      const summary = render();
      if (state.timer === null) schedule();
      return summary;
    }

    function destroy() {
      if (state.timer !== null) timers.clearTimeout(state.timer);
      state.timer = null;
      if (visibility && typeof visibility.removeEventListener === "function") visibility.removeEventListener("visibilitychange", wake);
    }

    return Object.freeze({
      element: rootEl,
      update,
      tick,
      wake,
      marks,
      destroy,
      entries: () => state.entries.slice(),
      summary: () => state.summary,
      observed: observedAt
    });
  }

  return Object.freeze({ TICK_MS, UPCOMING, NONE_TRACKED, STALE_CHANGEOVER, summarize, wording, create });
});
