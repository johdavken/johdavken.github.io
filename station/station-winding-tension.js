/* The Station Winding Tension calculator: the Tools row's one tool,
 * opened out of its tile into a utility surface over the stage.
 *
 * WHAT IT IS
 *
 * The application's Winding Tension tool (winding-tension.js: the band
 * table, the interpolation, both display roundings - a shared module
 * index.html loads too, as scheduling.js is), as the desktop console
 * presents it: film thickness, roll width and the number of ups go in;
 * a starting tension comes out with the band's range around it, the
 * wind type and the taper the band recommends. The same arithmetic, the
 * same answers, the same words; this file computes nothing itself.
 *
 * A UTILITY SURFACE, NOT A HANDBOOK SECTION
 *
 * The Operator Handbook is the large work surface across the stage's
 * lower part; this is a smaller, focused one across its upper part, as
 * the Changeover Calculator is - the same glass (glass.css), the same
 * control vocabulary (the Handbook's action / chip / close classes,
 * handbook.css), a box of its own (winding-tension.css): fixed capacity,
 * stood at the rail's own edge, bounded above the Handbook's share so
 * the two are open together and never meet. It opens out of the rail's
 * Winding Tension tile and returns to it; Close, Escape, or the tile
 * again, and the tile is all that is left.
 *
 * THE RANGE
 *
 * The band's minimum and maximum are drawn as one scale with the target
 * held at its centre: the left half runs from the minimum up to the
 * target, the right half from the target up to the maximum, so the
 * recommended starting point is always the middle of what the operator
 * reads, and the ideal zone around it is the middle of the scale. Each
 * new answer sweeps the two halves out from the centre - a finite
 * motion on the transition's tokens, run by the compositor - and the
 * ideal zone breathes while an answer stands (winding-tension.css).
 *
 * WHERE IT WRITES
 *
 * Nowhere. Nothing here is job state: no command is dispatched, nothing
 * is stored, nothing is synced. The entries live as long as the page.
 *
 * WHAT IT HOLDS
 *
 * Presentation state: whether it is open, the flight in progress, the
 * entries as typed, and the last answer.
 */
(function (root, factory) {
  const transition = typeof require === "function"
    ? require("./station-transition.js")
    : (root && root.PolynStationTransition);
  const winding = typeof require === "function"
    ? (function () { try { return require("../winding-tension.js"); } catch (error) { return null; } })()
    : (root && root.PolynWindingTension);
  const api = factory(transition, winding);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynStationWindingTension = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (transitionModule, windingModule) {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";

  const DEFAULT_TIMING = transitionModule && transitionModule.DEFAULT_TIMING
    ? transitionModule.DEFAULT_TIMING
    : Object.freeze({ ack: 80, move: 300, lead: 40, settle: 120, ease: "cubic-bezier(0.2, 0.8, 0.2, 1)" });

  /* The control vocabulary is the Handbook's (handbook.css): one set of
   * flat controls for every glass surface on the console. */
  const ACTION = "station-handbook__action";
  const CHIP = "station-handbook__chip";
  const CLOSE = "station-handbook__close";

  /* The ups are chips, as the Changeover Calculator's "Up" is, with the
   * same reach: one to ten rolls across the web. */
  const UPS_MAX = 10;

  /* The two ways a roll is driven, as the band table names them: every
   * band allows a surface wind; from one mil up a centre/surface wind
   * as well. Each has a pictogram (below) lit when the band allows it. */
  const WIND = Object.freeze([
    Object.freeze({ key: "surface", label: "Surface", allows: wind => /surface/i.test(wind) }),
    Object.freeze({ key: "center", label: "Center / Surface", allows: wind => /center/i.test(wind) })
  ]);

  /* The one line the application shows under every answer. */
  const NOTICE = windingModule ? windingModule.NOTICE : "";

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

  function text(doc, name, className, value, attributes) {
    const node = element(doc, name, className, attributes);
    node.textContent = value;
    return node;
  }

  function svgNode(doc, name, className, attributes) {
    const node = doc.createElementNS ? doc.createElementNS(SVG_NS, name) : doc.createElement(name);
    if (className) node.setAttribute("class", className);
    if (attributes) for (const key of Object.keys(attributes)) node.setAttribute(key, String(attributes[key]));
    return node;
  }

  function show(node, on) {
    if (on) node.removeAttribute("hidden");
    else node.setAttribute("hidden", "");
  }

  /* "30 – 50%" as the fraction the wedge is drawn from: the midpoint of
   * the numbers in the band's words, over a hundred. 0 for words with
   * no number in them. */
  function taperFraction(taper) {
    const numbers = (String(taper || "").match(/\d+(?:\.\d+)?/g) || []).map(Number).filter(Number.isFinite);
    if (!numbers.length) return 0;
    const mean = numbers.reduce((sum, n) => sum + n, 0) / numbers.length;
    return Math.min(1, Math.max(0, mean / 100));
  }

  /* ------------------------------------------------------------------
   *   The pictograms
   * ------------------------------------------------------------------
   * Line drawings in the control's own colour, 40 by 30: the roll as a
   * ring with its core, the web as a line arriving on it, the drive as a
   * short arc with a head. Surface wind: a drum against the roll's face
   * and the nip's arrow into it; centre wind: the arc on the core. */
  const PICT_VIEW = "0 0 40 30";

  function surfaceWindPictogram(doc) {
    const svg = svgNode(doc, "svg", "station-winding__pictogram", { viewBox: PICT_VIEW, "aria-hidden": "true", focusable: "false" });
    svg.appendChild(svgNode(doc, "circle", "station-winding__pict-roll", { cx: 27, cy: 16, r: 11 }));
    svg.appendChild(svgNode(doc, "circle", "station-winding__pict-core", { cx: 27, cy: 16, r: 2.6 }));
    svg.appendChild(svgNode(doc, "circle", "station-winding__pict-drum", { cx: 10, cy: 16, r: 6 }));
    svg.appendChild(svgNode(doc, "path", "station-winding__pict-web", { d: "M 0.5 10 L 10 10" }));
    svg.appendChild(svgNode(doc, "path", "station-winding__pict-drive", { d: "M 3.2 21.5 A 8 8 0 0 0 10 25.5" }));
    svg.appendChild(svgNode(doc, "path", "station-winding__pict-drive", { d: "M 7.6 24 L 10 25.5 L 8.9 22.8" }));
    svg.appendChild(svgNode(doc, "path", "station-winding__pict-nip", { d: "M 24 16 L 18.5 16 M 20.2 14.3 L 18.5 16 L 20.2 17.7" }));
    return svg;
  }

  function centerWindPictogram(doc) {
    const svg = svgNode(doc, "svg", "station-winding__pictogram", { viewBox: PICT_VIEW, "aria-hidden": "true", focusable: "false" });
    svg.appendChild(svgNode(doc, "circle", "station-winding__pict-roll", { cx: 24, cy: 14, r: 11 }));
    svg.appendChild(svgNode(doc, "circle", "station-winding__pict-core", { cx: 24, cy: 14, r: 2.6 }));
    svg.appendChild(svgNode(doc, "path", "station-winding__pict-drive", { d: "M 24 20.5 A 6.5 6.5 0 0 0 30.5 14" }));
    svg.appendChild(svgNode(doc, "path", "station-winding__pict-drive", { d: "M 28.6 15.8 L 30.5 14 L 32.2 15.9" }));
    svg.appendChild(svgNode(doc, "path", "station-winding__pict-web", { d: "M 0.5 25 L 13 25 M 11 23.4 L 13 25 L 11 26.6" }));
    return svg;
  }

  /* The taper: the tension's band, full at the core and narrowed by the
   * taper at the roll's face. The far edge is drawn from the answer. */
  function taperPictogram(doc) {
    const svg = svgNode(doc, "svg", "station-winding__pictogram station-winding__pictogram--taper", { viewBox: "0 0 40 20", "aria-hidden": "true", focusable: "false" });
    const wedge = svgNode(doc, "path", "station-winding__pict-wedge", { d: taperWedge(0) });
    svg.appendChild(wedge);
    svg.appendChild(svgNode(doc, "path", "station-winding__pict-web", { d: "M 0.5 10 L 39.5 10" }));
    return { svg, wedge };
  }

  function taperWedge(fraction) {
    const half = 8 * (1 - fraction);
    return `M 1 2 L 39 ${(10 - half).toFixed(2)} L 39 ${(10 + half).toFixed(2)} L 1 18 Z`;
  }

  /**
   * Build the calculator.
   *
   * @param {Document} doc
   * @param {object}   [options]
   * @param {object}   [options.calculator]  winding-tension.js, when not global
   * @param {Element}  [options.anchor]      the rail's tile the surface opens
   *        out of and returns to
   * @param {Element}  [options.mount]       the element the motion tokens are read off
   * @param {function} [options.reducedMotion]  () => boolean
   * @param {function} [options.animate]     (element, keyframes, options) => Animation
   * @param {function} [options.measure]     (element) => client rect
   * @param {function} [options.computedStyle]
   * @param {object}   [options.timing]
   * @param {function} [options.onOpenChange]  (open) => void
   */
  function create(doc, options) {
    const settings = options || {};
    const calc = settings.calculator || windingModule;
    if (!calc) return null;
    const reducedMotion = typeof settings.reducedMotion === "function" ? settings.reducedMotion : () => false;
    const animate = typeof settings.animate === "function"
      ? settings.animate
      : (el, keyframes, opts) => (transitionModule && typeof transitionModule.play === "function" ? transitionModule.play(el, keyframes, opts) : null);
    const measure = typeof settings.measure === "function"
      ? settings.measure
      : el => (el && typeof el.getBoundingClientRect === "function" ? el.getBoundingClientRect() : null);
    const computedStyle = settings.computedStyle
      || (typeof getComputedStyle === "function" ? el => getComputedStyle(el) : null);
    const timing = Object.assign({},
      transitionModule && typeof transitionModule.readTiming === "function" && settings.mount
        ? transitionModule.readTiming(settings.mount, computedStyle)
        : DEFAULT_TIMING,
      settings.timing || {});
    const onOpenChange = typeof settings.onOpenChange === "function" ? settings.onOpenChange : () => {};
    const anchor = settings.anchor || null;

    const state = {
      open: false,
      flight: null,          // { animations, closing }
      sweep: [],             // the range's last motion, cancelled by the next
      entries: { thickness: "", width: "", ups: 1 },
      result: null
    };

    const rootEl = element(doc, "div", "station-winding", { "data-role": "winding-tension" });

    /* ---- The surface ---- */
    const panel = element(doc, "section", "station-winding__panel station-glass", {
      role: "region", "aria-label": "Winding Tension", hidden: ""
    });
    const head = element(doc, "header", "station-winding__head");
    head.appendChild(text(doc, "h2", "station-winding__title", "Winding Tension"));
    const readout = text(doc, "span", "station-winding__readout", "");
    head.appendChild(readout);
    const closeButton = text(doc, "button", `${CLOSE} station-winding__close`, "Close", {
      type: "button", "data-action": "close-winding", title: "Close the calculator (Esc)"
    });
    head.appendChild(closeButton);
    panel.appendChild(head);

    const body = element(doc, "div", "station-winding__body");
    panel.appendChild(body);

    /* ---- The entries: thickness, width, ups ---- */
    const form = element(doc, "form", "station-winding__form", { "data-role": "entries" });
    const fields = {};

    function fieldRow(field, labelText, unit) {
      const row = element(doc, "div", "station-winding__field", { "data-field": field });
      const id = `station-winding-${field}`;
      row.appendChild(text(doc, "label", "station-winding__label", labelText, { for: id }));
      const input = element(doc, "input", "station-winding__input", {
        id, type: "text", inputmode: "decimal", autocomplete: "off", spellcheck: "false", "data-field": field, placeholder: "0"
      });
      row.appendChild(input);
      row.appendChild(text(doc, "span", "station-winding__unit", unit));
      fields[field] = { row, input };
      return row;
    }

    form.appendChild(fieldRow("thickness", "Film thickness", "mil"));
    form.appendChild(fieldRow("width", "Roll width", "in"));
    const upsRow = element(doc, "div", "station-winding__field station-winding__field--chips", { "data-field": "ups" });
    upsRow.appendChild(text(doc, "span", "station-winding__label", "Ups"));
    const chips = element(doc, "div", "station-winding__chips", { role: "radiogroup", "aria-label": "Number of ups" });
    const upsChips = Array.from({ length: UPS_MAX }, (_, i) => {
      const value = i + 1;
      const chip = text(doc, "button", CHIP, String(value), {
        type: "button", role: "radio", "data-field": "ups", "data-value": String(value), "aria-checked": "false", "aria-pressed": "false"
      });
      chips.appendChild(chip);
      return { value, chip };
    });
    upsRow.appendChild(chips);
    form.appendChild(upsRow);
    body.appendChild(form);

    /* ---- The answer: the figure, the range, the advice ---- */
    const result = element(doc, "div", "station-winding__result", { "data-role": "result", "data-live": "false" });

    const figure = element(doc, "div", "station-winding__figure");
    const target = text(doc, "span", "station-winding__target", "—", { "data-role": "target" });
    figure.appendChild(target);
    figure.appendChild(text(doc, "span", "station-winding__unit-large", "lb"));
    const pli = text(doc, "span", "station-winding__pli", "", { "data-role": "pli" });
    figure.appendChild(pli);
    result.appendChild(figure);

    /* The range: the scale with the target at its centre, the halves
     * that sweep out to the ends, the ideal zone and the mark over the
     * centre, and the three readings under it. */
    const range = element(doc, "div", "station-winding__range", { "data-role": "range", role: "img", "aria-label": "" });
    const scale = element(doc, "div", "station-winding__scale");
    const fillLow = element(doc, "div", "station-winding__fill station-winding__fill--low", { "data-role": "fill-low" });
    const fillHigh = element(doc, "div", "station-winding__fill station-winding__fill--high", { "data-role": "fill-high" });
    const ideal = element(doc, "div", "station-winding__ideal", { "data-role": "ideal" });
    const mark = element(doc, "div", "station-winding__mark", { "data-role": "mark" });
    scale.append(fillLow, fillHigh, ideal, mark);
    range.appendChild(scale);
    const ends = element(doc, "div", "station-winding__ends");
    const endValues = {};
    for (const [key, label] of [["min", "Min"], ["target", "Target"], ["max", "Max"]]) {
      const end = element(doc, "span", `station-winding__end station-winding__end--${key}`, { "data-role": key });
      end.appendChild(text(doc, "span", "station-winding__end-label", label));
      const value = text(doc, "span", "station-winding__end-value", "—");
      end.appendChild(value);
      ends.appendChild(end);
      endValues[key] = value;
    }
    range.appendChild(ends);
    result.appendChild(range);

    const advice = element(doc, "div", "station-winding__advice");
    const windCell = element(doc, "div", "station-winding__wind", { "data-role": "wind" });
    windCell.appendChild(text(doc, "span", "station-winding__label", "Wind type"));
    const windKinds = element(doc, "div", "station-winding__kinds");
    const kinds = WIND.map(kind => {
      const cell = element(doc, "span", `station-winding__kind station-winding__kind--${kind.key}`, { "data-kind": kind.key, "data-allowed": "false" });
      cell.appendChild(kind.key === "surface" ? surfaceWindPictogram(doc) : centerWindPictogram(doc));
      cell.appendChild(text(doc, "span", "station-winding__kind-label", kind.label));
      windKinds.appendChild(cell);
      return { kind, cell };
    });
    windCell.appendChild(windKinds);
    const windWords = text(doc, "span", "station-winding__words", "—", { "data-role": "wind-words" });
    windCell.appendChild(windWords);
    advice.appendChild(windCell);

    const taperCell = element(doc, "div", "station-winding__taper", { "data-role": "taper" });
    taperCell.appendChild(text(doc, "span", "station-winding__label", "Taper"));
    const taperArt = taperPictogram(doc);
    taperCell.appendChild(taperArt.svg);
    const taperWords = text(doc, "span", "station-winding__words", "—", { "data-role": "taper-words" });
    taperCell.appendChild(taperWords);
    advice.appendChild(taperCell);
    result.appendChild(advice);

    result.appendChild(text(doc, "p", "station-winding__notice", NOTICE, { "data-role": "notice" }));
    body.appendChild(result);

    const note = element(doc, "p", "station-winding__note", { role: "status", hidden: "" });
    body.appendChild(note);

    rootEl.appendChild(panel);

    /* ---- Display ---- */

    function say(message, kind) {
      note.textContent = message || "";
      note.setAttribute("data-kind", kind || "");
      show(note, !!message);
    }

    function markInvalid(field, message) {
      const input = fields[field] && fields[field].input;
      if (!input) return;
      if (message) { input.setAttribute("aria-invalid", "true"); input.setAttribute("title", message); }
      else { input.removeAttribute("aria-invalid"); input.removeAttribute("title"); }
    }

    function drawChips() {
      for (const { value, chip } of upsChips) {
        const on = value === state.entries.ups;
        chip.setAttribute("aria-checked", on ? "true" : "false");
        chip.setAttribute("aria-pressed", on ? "true" : "false");
        chip.classList.toggle("is-selected", on);
      }
    }

    function cancelSweep() {
      for (const animation of state.sweep) { try { animation.cancel(); } catch (error) { /* gone */ } }
      state.sweep = [];
    }

    /* The two halves out from the centre, the mark rising after them,
     * the figure coming up: finite, transform and opacity, on the
     * transition's tokens. Nothing under reduced motion. */
    function sweep() {
      cancelSweep();
      if (reducedMotion()) return;
      const move = { duration: timing.move, easing: timing.ease, fill: "both" };
      state.sweep = [
        animate(fillLow, [{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], move),
        animate(fillHigh, [{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], move),
        animate(mark, [{ transform: "scaleY(0)", opacity: 0 }, { transform: "none", opacity: 1 }],
          { duration: timing.settle, delay: timing.lead, easing: "ease-out", fill: "both" }),
        animate(figure, [{ opacity: 0.35 }, { opacity: 1 }], { duration: timing.settle, easing: "ease-out", fill: "both" })
      ].filter(Boolean);
    }

    /* Nothing to show: the scale empties, the readings go, the readout
     * says what is missing. A half-typed gauge never leaves a stale
     * recommendation standing. */
    function withoutAnswer(message) {
      state.result = null;
      cancelSweep();
      result.setAttribute("data-live", "false");
      target.textContent = "—";
      pli.textContent = "";
      for (const key of Object.keys(endValues)) endValues[key].textContent = "—";
      range.setAttribute("aria-label", "No tension to show yet");
      for (const { cell } of kinds) cell.setAttribute("data-allowed", "false");
      windWords.textContent = "—";
      taperWords.textContent = "—";
      taperArt.wedge.setAttribute("d", taperWedge(0));
      readout.textContent = message;
      readout.classList.add("is-unset");
    }

    function drawAnswer(answer, changed) {
      state.result = answer;
      const targetText = calc.formatTension(answer.target);
      const pliText = calc.formatPli(answer.pli);
      target.textContent = targetText;
      pli.textContent = `${pliText} PLI of web width`;
      endValues.min.textContent = calc.formatTension(answer.min);
      endValues.target.textContent = targetText;
      endValues.max.textContent = calc.formatTension(answer.max);
      range.setAttribute("aria-label", `Tension range ${calc.formatTension(answer.min)} to ${calc.formatTension(answer.max)} lb, target ${targetText} lb`);
      for (const { kind, cell } of kinds) cell.setAttribute("data-allowed", kind.allows(answer.wind) ? "true" : "false");
      windWords.textContent = answer.wind;
      taperWords.textContent = answer.taper;
      taperArt.wedge.setAttribute("d", taperWedge(taperFraction(answer.taper)));
      readout.textContent = `${targetText} lb · ${pliText} PLI`;
      readout.classList.remove("is-unset");
      result.setAttribute("data-live", "true");
      if (changed) sweep();
    }

    /* The answer follows the entries live, through the application's
     * own arithmetic. */
    function compute() {
      const entries = state.entries;
      markInvalid("thickness", "");
      markInvalid("width", "");
      say("");
      if (entries.thickness.trim() === "" || entries.width.trim() === "") {
        withoutAnswer("Enter film thickness and roll width");
        return null;
      }
      const answer = calc.calculate({ filmThicknessMil: entries.thickness, rollWidthIn: entries.width, ups: entries.ups });
      if (!answer.valid) {
        for (const [field, matcher] of [["thickness", /film thickness/i], ["width", /roll width/i]]) {
          const message = answer.errors.find(one => matcher.test(one));
          if (message) markInvalid(field, message);
        }
        withoutAnswer("Check the entries");
        say(answer.errors[0], "error");
        return null;
      }
      const before = state.result;
      const changed = !before || before.target !== answer.target || before.min !== answer.min || before.max !== answer.max;
      drawAnswer(answer, changed);
      return answer;
    }

    for (const field of ["thickness", "width"]) {
      fields[field].input.addEventListener("input", () => {
        state.entries[field] = String(fields[field].input.value || "");
        compute();
      });
    }
    for (const { value, chip } of upsChips) {
      chip.addEventListener("click", () => {
        state.entries.ups = value;
        drawChips();
        compute();
      });
    }
    form.addEventListener("submit", event => {
      if (typeof event.preventDefault === "function") event.preventDefault();
      compute();
    });

    /* ---- Opening and closing: the Changeover Calculator's flight ---- */

    function announce() {
      rootEl.classList.toggle("is-open", state.open);
      if (anchor && typeof anchor.setAttribute === "function") anchor.setAttribute("aria-expanded", state.open ? "true" : "false");
      onOpenChange(state.open);
    }

    function cancelFlight() {
      const flight = state.flight;
      state.flight = null;
      if (!flight) return;
      for (const animation of flight.animations) { try { animation.cancel(); } catch (error) { /* gone */ } }
    }

    function settled(animations) {
      return Promise.all(animations.filter(Boolean).map(a => (a.finished ? a.finished.catch(() => {}) : Promise.resolve())));
    }

    function flightTransform() {
      if (!anchor || !transitionModule || typeof transitionModule.overlayTransform !== "function") return null;
      return transitionModule.overlayTransform(measure(anchor), measure(panel));
    }

    function firstField() {
      return fields[state.entries.thickness.trim() === "" ? "thickness" : (state.entries.width.trim() === "" ? "width" : "thickness")].input;
    }

    function open() {
      if (state.open && !(state.flight && state.flight.closing)) return false;
      const wasClosing = !!(state.flight && state.flight.closing);
      state.open = true;
      show(panel, true);
      announce();
      if (wasClosing) {
        const flight = state.flight;
        flight.closing = false;
        for (const animation of flight.animations) { try { animation.reverse(); } catch (error) { /* ok */ } }
        settled(flight.animations).then(() => { if (state.flight === flight) state.flight = null; });
        return true;
      }
      cancelFlight();
      const transform = reducedMotion() ? null : flightTransform();
      if (transform) {
        const move = { duration: timing.move, easing: timing.ease, fill: "both" };
        const animations = [
          animate(panel, [{ transform, opacity: 0.3 }, { transform: "none", opacity: 1 }], move),
          animate(body, [{ opacity: 0 }, { opacity: 1 }],
            { duration: timing.settle, delay: Math.max(0, timing.move - timing.settle), easing: "ease-out", fill: "both" })
        ].filter(Boolean);
        const flight = { animations, closing: false };
        state.flight = flight;
        settled(animations).then(() => { if (state.flight === flight) state.flight = null; });
      }
      const field = firstField();
      if (field && typeof field.focus === "function") field.focus();
      return true;
    }

    function hideNow() {
      show(panel, false);
      cancelFlight();
    }

    function returnFocus() {
      if (anchor && typeof anchor.focus === "function") anchor.focus();
    }

    function close() {
      if (!state.open) return false;
      state.open = false;
      announce();
      if (reducedMotion() || !state.flight) {
        const transform = reducedMotion() ? null : flightTransform();
        if (!transform) { hideNow(); returnFocus(); return true; }
        const animations = [
          animate(panel, [{ transform: "none", opacity: 1 }, { transform, opacity: 0.3 }],
            { duration: timing.move, easing: timing.ease, fill: "both" })
        ].filter(Boolean);
        const flight = { animations, closing: true };
        state.flight = flight;
        settled(animations).then(() => { if (!state.open) hideNow(); });
        returnFocus();
        return true;
      }
      const flight = state.flight;
      flight.closing = true;
      for (const animation of flight.animations) { try { animation.reverse(); } catch (error) { /* ok */ } }
      settled(flight.animations).then(() => { if (!state.open) hideNow(); });
      returnFocus();
      return true;
    }

    function toggle() {
      return state.open ? close() : open();
    }

    closeButton.addEventListener("click", () => { close(); });
    panel.addEventListener("keydown", event => {
      if (event.key !== "Escape") return;
      if (typeof event.stopPropagation === "function") event.stopPropagation();
      if (typeof event.preventDefault === "function") event.preventDefault();
      close();
    });

    drawChips();
    compute();
    // The tile is the launcher from the start: closed, and said so.
    if (anchor && typeof anchor.setAttribute === "function") anchor.setAttribute("aria-expanded", "false");

    return {
      element: rootEl,
      panel,
      open,
      close,
      toggle,
      compute,
      isOpen: () => state.open,
      entries: () => Object.assign({}, state.entries),
      result: () => (state.result ? Object.assign({}, state.result) : null),
      getTiming: () => Object.assign({}, timing)
    };
  }

  return Object.freeze({ DEFAULT_TIMING, UPS_MAX, WIND, NOTICE, taperFraction, taperWedge, create });
});
