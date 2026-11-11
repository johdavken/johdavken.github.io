/* Home: a phone's first page, as the floor UI's phone opens on one.
 *
 * The mark, large and turning (slate-logo.js) - its confluence alive to
 * RT Sync: the line's number where the die sits, a lit tick per device,
 * the streams and a spark moving with the sync - the line's name, the job's
 * two figures a glance is for - the changeover with its countdown, and the
 * output - and three numbered steps with a line each on how they stand:
 * the Recipe (how many hoppers change resin at the changeover), the Timeline
 * (what is late, what comes next) and Resin Balance (the job's pounds).
 * Under the steps, four tiles two by two - Winding Tension, Settings, Work
 * Alarm, Formulas - the phone's way to what has no step: there is no menu.
 *
 * The mark is a button: a tap raises the Lines sheet (slate-line-switcher.js,
 * through `ctx.home.lines`), the lines this device has joined to choose
 * between.
 *
 * It reads and asks, nothing more: the figures and the lines come through
 * `ctx.home`, which the boot fills from the job's cards, the Timeline and
 * the balance's own arithmetic; a tap on a figure opens that card's editor
 * and a tap on a step or a tile opens its page, each through the boot. It dispatches
 * nothing. Listed only on a phone (slate.js); elsewhere the rail and the
 * panes already show all of it.
 */
(function (root, factory) {
  const logo = typeof require === "function"
    ? require("./slate-logo.js")
    : (root && root.PolynSlateLogo);
  // The rail's glyphs, for the tiles: one drawing of each tool's icon.
  const rail = typeof require === "function"
    ? require("./slate-rail.js")
    : (root && root.PolynSlateRail);
  const api = factory(logo, rail);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynSlateHome = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (logoModule, railModule) {
  "use strict";

  const TITLE = "Home";
  const READOUTS = Object.freeze([
    Object.freeze({ field: "changeover", label: "Changeover" }),
    Object.freeze({ field: "rate", label: "Output" })
  ]);
  const STEPS = Object.freeze([
    Object.freeze({ id: "recipe", label: "Recipe" }),
    Object.freeze({ id: "timeline", label: "Timeline" }),
    Object.freeze({ id: "resin-balance", label: "Resin Balance" })
  ]);
  /* Two by two, read across: the order is the operator's. */
  const TILES = Object.freeze([
    Object.freeze({ id: "winding-tension", label: "Winding Tension", icon: "winding" }),
    Object.freeze({ id: "settings", label: "Settings", icon: "settings" }),
    Object.freeze({ id: "work-alarm", label: "Work Alarm", icon: "alarm" }),
    Object.freeze({ id: "formulas", label: "Formulas", icon: "gauge" })
  ]);
  const SVG_NS = "http://www.w3.org/2000/svg";
  const LINES_LABEL = "Lines";

  function glyph(doc, name) {
    const glyphs = railModule && railModule.GLYPHS ? railModule.GLYPHS : {};
    const svg = doc.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "slate-home__tile-glyph");
    svg.setAttribute("viewBox", "0 0 20 20");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    const path = doc.createElementNS(SVG_NS, "path");
    path.setAttribute("d", glyphs[name] || glyphs.generic || "M4 4h12v12H4Z");
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "1.6");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    svg.appendChild(path);
    return svg;
  }

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

  function setText(node, value) {
    const next = value == null ? "" : String(value);
    if (node.textContent !== next) node.textContent = next;
  }

  /* ---- The lines, pure ---- */

  /**
   * RT Sync's status (the connection bridge's) as the live mark shows it:
   * a state of the mark's own, the line's number, and the devices. Pure.
   */
  function syncMark(status) {
    if (!status || !status.enabled || !status.assigned || !status.line) {
      return { state: "none", lineNumber: null, devices: [], label: "" };
    }
    const key = status.status ? status.status.key : "";
    let state;
    if (status.status && status.status.adminRequired) state = "error";
    else if (!status.linked) state = "warn";
    else if (key === "synced") state = "synced";
    else if (key === "syncing" || key === "connecting" || key === "pending") state = "busy";
    else if (key === "error") state = "error";
    else if (key === "offline" || key === "conflict") state = "warn";
    else state = "synced";
    const lineNumber = Number.isInteger(status.line.lineNumber) ? status.line.lineNumber : null;
    const devices = (Array.isArray(status.devices) ? status.devices : []).map(one => ({ thisDevice: !!(one && one.thisDevice) }));
    const words = [status.line.displayName, status.status ? status.status.label : ""].filter(Boolean).join(", ");
    return { state, lineNumber, devices, label: words };
  }

  /** The Recipe step's line: how many hoppers change resin at the changeover. */
  function recipeLine(facts) {
    const f = facts || {};
    if (!f.line) return "No line";
    if (!f.planned) return "Running · nothing planned";
    const n = Number(f.resinChanges) || 0;
    if (n === 0) return "No resin changes at the changeover";
    return `${n} hopper${n === 1 ? " changes" : "s change"} resin at the changeover`;
  }

  /** The Timeline step's line: what is late, and what comes next. */
  function timelineLine(entries, now, clock) {
    const list = Array.isArray(entries) ? entries.filter(entry => entry && !entry.pumpOff) : [];
    if (!list.length) return "No hoppers tracked";
    const late = list.filter(entry => entry.overdue).length;
    const upcoming = list.filter(entry => !entry.overdue && Number.isFinite(entry.markAt) && entry.markAt >= now).sort((a, b) => a.markAt - b.markAt)[0];
    const next = upcoming ? `next ${upcoming.id} at ${clock(upcoming.markAt)}` : "";
    if (late) return [`${late} late for pump-off`, next].filter(Boolean).join(" · ");
    return upcoming ? `Next: ${upcoming.id} at ${clock(upcoming.markAt)}` : "Nothing due before the horizon";
  }

  /** The Resin Balance step's line: the job's pounds. */
  function balanceLine(total) {
    const pounds = Number(total);
    if (!Number.isFinite(pounds) || pounds <= 0) return "No production entered";
    return `${Math.floor(pounds).toLocaleString("en-US")} lb in the job`;
  }

  /**
   * @param {Document} doc
   * @param {object} ctx
   * @param {object} ctx.home   { line(resolved), readout(field) -> {value, sub}, open(field),
   *                              go(id), recipe(resolved) -> {line, planned, resinChanges},
   *                              timeline() -> entries, balance(resolved) -> total pounds,
   *                              clock(at) -> "5:20 PM",
   *                              sync() -> the connection bridge's status, for the mark,
   *                              lines() - raise the Lines sheet, has(id) -> whether a
   *                              tile's page exists here (a tile without one is left out) }
   * @param {function} [ctx.now]
   */
  function create(doc, ctx) {
    const settings = ctx || {};
    const home = settings.home || {};
    const call = (name, ...args) => (typeof home[name] === "function" ? home[name](...args) : null);
    const now = typeof settings.now === "function" ? settings.now : () => Date.now();

    const rootEl = element(doc, "div", "slate-home");
    // The mark is the way to the Lines sheet: a button the mark's size.
    const brand = element(doc, "button", "slate-home__brand", { type: "button", "aria-haspopup": "dialog", "data-home-lines": "" });
    brand.addEventListener("click", () => call("lines"));
    // The mark alive to RT Sync where the logo module offers it; the plain
    // mark otherwise.
    const mark = logoModule && typeof logoModule.createLive === "function"
      ? logoModule.createLive(doc, { label: "Resin.Tools" })
      : null;
    if (mark) brand.appendChild(mark.element);
    else if (logoModule && typeof logoModule.create === "function") brand.appendChild(logoModule.create(doc, { label: "Resin.Tools" }));
    rootEl.appendChild(brand);
    const lineEl = text(doc, "p", "slate-home__line", "");
    rootEl.appendChild(lineEl);

    const readouts = element(doc, "div", "slate-home__readouts");
    const figures = new Map();
    for (const readout of READOUTS) {
      const button = element(doc, "button", "slate-home__readout", { type: "button", "data-home-field": readout.field });
      button.appendChild(text(doc, "span", "slate-home__readout-label", readout.label));
      const value = text(doc, "span", "slate-home__readout-value", "");
      const sub = text(doc, "span", "slate-home__readout-sub", "");
      button.appendChild(value);
      button.appendChild(sub);
      button.addEventListener("click", () => call("open", readout.field));
      figures.set(readout.field, { button, value, sub });
      readouts.appendChild(button);
    }
    rootEl.appendChild(readouts);

    const steps = element(doc, "div", "slate-home__steps");
    const stepLines = new Map();
    STEPS.forEach((step, i) => {
      const button = element(doc, "button", "slate-home__step", { type: "button", "data-home-step": step.id });
      button.appendChild(text(doc, "span", "slate-home__step-number", String(i + 1), { "aria-hidden": "true" }));
      const words = element(doc, "span", "slate-home__step-words");
      words.appendChild(text(doc, "span", "slate-home__step-label", step.label));
      const line = text(doc, "span", "slate-home__step-line", "");
      words.appendChild(line);
      button.appendChild(words);
      button.appendChild(text(doc, "span", "slate-home__step-chevron", "›", { "aria-hidden": "true" }));
      button.addEventListener("click", () => call("go", step.id));
      stepLines.set(step.id, line);
      steps.appendChild(button);
    });
    rootEl.appendChild(steps);

    const tiles = element(doc, "div", "slate-home__tiles");
    for (const tile of TILES) {
      if (typeof home.has === "function" && !home.has(tile.id)) continue;
      const button = element(doc, "button", "slate-home__tile", { type: "button", "data-home-tile": tile.id });
      button.appendChild(glyph(doc, tile.icon));
      button.appendChild(text(doc, "span", "slate-home__tile-label", tile.label));
      button.addEventListener("click", () => call("go", tile.id));
      tiles.appendChild(button);
    }
    rootEl.appendChild(tiles);

    let resolvedNow = null;

    function paint() {
      const markNow = syncMark(call("sync"));
      if (mark) mark.update(markNow);
      const label = markNow.label ? `${LINES_LABEL} — ${markNow.label}` : LINES_LABEL;
      if (brand.getAttribute("aria-label") !== label) brand.setAttribute("aria-label", label);
      setText(lineEl, call("line", resolvedNow) || "");
      for (const [field, figure] of figures) {
        const shown = call("readout", field) || { value: "", sub: "" };
        setText(figure.value, shown.value);
        setText(figure.sub, shown.sub);
      }
      setText(stepLines.get("recipe"), recipeLine(call("recipe", resolvedNow)));
      const clock = typeof home.clock === "function" ? home.clock : at => new Date(at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
      setText(stepLines.get("timeline"), timelineLine(call("timeline"), now(), clock));
      setText(stepLines.get("resin-balance"), balanceLine(call("balance", resolvedNow)));
    }

    function update(resolved) {
      resolvedNow = resolved || null;
      paint();
    }

    return Object.freeze({ element: rootEl, update, refresh: paint });
  }

  return Object.freeze({ TITLE, READOUTS, STEPS, TILES, syncMark, recipeLine, timelineLine, balanceLine, create });
});
