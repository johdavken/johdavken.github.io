/* The Station Pressure converter: the Tools row's third tool, opened out
 * of its tile into a window over the stage. Psi to bar, and bar to psi.
 *
 * WHAT IT IS
 *
 * The application's pressure arithmetic (pressure-conversion.js: the one
 * factor, both roundings, the gauge ladder - a shared module index.html
 * loads too, as winding-tension.js is), as the desktop console presents
 * it: two gauge faces side by side, PSI on the left and bar on the
 * right, reading the SAME pressure. An entry stands under each face;
 * type in either and the other follows, both needles swinging to the
 * same place, because they show one pressure on two scales. A strip of
 * common line pressures under the faces sets an entry with one click.
 * This file computes nothing itself.
 *
 * THE TWO FACES
 *
 * The face the operator typed on is the SOURCE: its scale is a round
 * number off the ladder (15, 30, 60, 100...) and its ticks fall on
 * quarters of it. The other face carries the same full scale converted,
 * so its ticks are the same pressures in the other unit and its needle
 * stands at the same angle. Reading across is the conversion; the
 * figures under the ticks are the table.
 *
 * A WINDOW, NOT A HANDBOOK SECTION
 *
 * A Station window (station-window.js): a small focused frame spawned at
 * the stage's centre, moved by its title bar, closed by the bar's round
 * button, Escape, or the tile again. The window module owns the frame
 * and the flight; this file owns what is in it - the same glass
 * (glass.css), the Handbook's chips and fields (handbook.css), a box of
 * its own size (pressure.css).
 *
 * WHERE IT WRITES
 *
 * Nowhere. Nothing here is job state: no command is dispatched, nothing
 * is stored, nothing is synced. The entries live as long as the page.
 *
 * WHAT IT HOLDS
 *
 * Presentation state: the entries as typed, which face was typed on
 * last, and the last answer. Whether it is open, and where, is the
 * window's.
 */
(function (root, factory) {
  const windowModule = typeof require === "function"
    ? require("./station-window.js")
    : (root && root.PolynStationWindow);
  const pressure = typeof require === "function"
    ? (function () { try { return require("../pressure-conversion.js"); } catch (error) { return null; } })()
    : (root && root.PolynPressureConversion);
  const api = factory(windowModule, pressure);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynStationPressure = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (windowModule, pressureModule) {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";

  const DEFAULT_TIMING = windowModule && windowModule.DEFAULT_TIMING
    ? windowModule.DEFAULT_TIMING
    : Object.freeze({ ack: 80, move: 300, lead: 40, settle: 120, ease: "cubic-bezier(0.2, 0.8, 0.2, 1)" });

  /* The control vocabulary is the Handbook's (handbook.css): one set of
   * flat controls for every glass surface on the console. */
  const CHIP = "station-handbook__chip";

  /* The one line the application shows under the faces. */
  const NOTICE = pressureModule ? pressureModule.NOTICE : "";

  /* ------------------------------------------------------------------
   *   The gauge face
   * ------------------------------------------------------------------
   * A dial in a 100-by-76 box: the pivot low at (50, 52), the scale an
   * arc of SWEEP degrees centred on twelve o'clock, so the zero stop is
   * at the lower left and full scale at the lower right, as a pressure
   * gauge reads. Five major ticks on the quarters, three minor between
   * each; the figures outside the arc, where the needle never covers
   * one; the needle on the pivot, turned by a transform this file
   * writes (pressure.css eases it). */
  const DIAL = Object.freeze({
    view: "0 0 100 76",
    cx: 50, cy: 52,
    radius: 36,      // the scale's arc
    major: 6,        // a major tick's length, inward from the arc
    minor: 3,
    label: 45,       // the figures' radius, outside the arc
    sweep: 230,      // degrees from the zero stop to full scale
    majors: 4,       // intervals between major ticks
    minors: 4        // sub-intervals in each
  });

  /* The needle's angle for a fraction of full scale, in degrees clockwise
   * from twelve o'clock: the zero stop at -sweep/2, full scale at +sweep/2.
   * Held within the stops. */
  function angleFor(fraction) {
    const f = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0;
    return -DIAL.sweep / 2 + DIAL.sweep * f;
  }

  function polar(radius, degrees) {
    const rad = (degrees * Math.PI) / 180;
    return { x: DIAL.cx + radius * Math.sin(rad), y: DIAL.cy - radius * Math.cos(rad) };
  }

  const fix = n => Number(n.toFixed(2));

  /* The scale's arc from the zero stop to full scale, the long way round
   * the top. */
  function arcPath() {
    const start = polar(DIAL.radius, angleFor(0));
    const end = polar(DIAL.radius, angleFor(1));
    return `M ${fix(start.x)} ${fix(start.y)} A ${DIAL.radius} ${DIAL.radius} 0 ${DIAL.sweep > 180 ? 1 : 0} 1 ${fix(end.x)} ${fix(end.y)}`;
  }

  /* Every tick as one path: the majors on the quarters, the minors
   * between them, each a radial stroke inward from the arc. */
  function ticksPath(major) {
    const steps = DIAL.majors * DIAL.minors;
    const parts = [];
    for (let i = 0; i <= steps; i++) {
      const isMajor = i % DIAL.minors === 0;
      if (isMajor !== major) continue;
      const degrees = angleFor(i / steps);
      const outer = polar(DIAL.radius, degrees);
      const inner = polar(DIAL.radius - (major ? DIAL.major : DIAL.minor), degrees);
      parts.push(`M ${fix(outer.x)} ${fix(outer.y)} L ${fix(inner.x)} ${fix(inner.y)}`);
    }
    return parts.join(" ");
  }

  /* The needle at rest points at twelve o'clock: a slim blade from the
   * pivot to just short of the arc, with a short tail behind. */
  function needlePath() {
    const tip = DIAL.radius - DIAL.major - 2;
    return `M ${DIAL.cx - 1.6} ${DIAL.cy + 4} L ${DIAL.cx} ${DIAL.cy - tip} L ${DIAL.cx + 1.6} ${DIAL.cy + 4} Z`;
  }

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

  /* One gauge face: the dial, the unit under it, the entry under that. */
  function buildFace(doc, unit) {
    const face = element(doc, "div", `station-pressure__face station-pressure__face--${unit.key}`, {
      "data-unit": unit.key, "data-source": "false", "data-live": "false"
    });
    const dial = svgNode(doc, "svg", "station-pressure__dial", {
      viewBox: DIAL.view, role: "img", "aria-label": `${unit.label} gauge, no reading`, focusable: "false"
    });
    dial.appendChild(svgNode(doc, "path", "station-pressure__arc", { d: arcPath() }));
    dial.appendChild(svgNode(doc, "path", "station-pressure__tick station-pressure__tick--minor", { d: ticksPath(false) }));
    dial.appendChild(svgNode(doc, "path", "station-pressure__tick station-pressure__tick--major", { d: ticksPath(true) }));
    const figures = [];
    for (let i = 0; i <= DIAL.majors; i++) {
      const at = polar(DIAL.label, angleFor(i / DIAL.majors));
      const figure = svgNode(doc, "text", "station-pressure__figure", {
        x: fix(at.x), y: fix(at.y), "text-anchor": "middle", "dominant-baseline": "middle", "data-step": String(i)
      });
      figure.textContent = "";
      dial.appendChild(figure);
      figures.push(figure);
    }
    const needle = svgNode(doc, "g", "station-pressure__needle", { "transform-origin": `${DIAL.cx} ${DIAL.cy}`, "data-role": "needle" });
    needle.appendChild(svgNode(doc, "path", "station-pressure__blade", { d: needlePath() }));
    dial.appendChild(needle);
    dial.appendChild(svgNode(doc, "circle", "station-pressure__pivot", { cx: DIAL.cx, cy: DIAL.cy, r: 3 }));
    face.appendChild(dial);

    face.appendChild(text(doc, "span", "station-pressure__unit", unit.label, { title: unit.name }));
    const id = `station-pressure-${unit.key}`;
    const entry = element(doc, "div", "station-pressure__entry");
    entry.appendChild(text(doc, "label", "station-pressure__label", `Pressure in ${unit.label}`, { for: id }));
    const input = element(doc, "input", "station-pressure__input", {
      id, type: "text", inputmode: "decimal", autocomplete: "off", spellcheck: "false", "data-unit": unit.key, placeholder: "0",
      "aria-label": `Pressure in ${unit.label}`
    });
    entry.appendChild(input);
    face.appendChild(entry);
    return { unit, face, dial, figures, needle, input };
  }

  /* Between the faces: the two-way arrow and the factor each way. */
  function buildLink(doc, calc) {
    const link = element(doc, "div", "station-pressure__link", { "aria-hidden": "true" });
    const svg = svgNode(doc, "svg", "station-pressure__arrows", { viewBox: "0 0 40 24", focusable: "false" });
    svg.appendChild(svgNode(doc, "path", "station-pressure__arrow", { d: "M 4 8 L 36 8 M 30 3 L 36 8 L 30 13" }));
    svg.appendChild(svgNode(doc, "path", "station-pressure__arrow", { d: "M 36 17 L 4 17 M 10 12 L 4 17 L 10 22" }));
    link.appendChild(svg);
    link.appendChild(text(doc, "span", "station-pressure__factor", `× ${calc.BAR_PER_PSI.toFixed(4)}`, { "data-role": "factor-bar" }));
    link.appendChild(text(doc, "span", "station-pressure__factor", `× ${calc.PSI_PER_BAR.toFixed(2)}`, { "data-role": "factor-psi" }));
    return link;
  }

  /**
   * Build the converter.
   *
   * @param {Document} doc
   * @param {object}   [options]
   * @param {object}   [options.calculator]  pressure-conversion.js, when not global
   * @param {Element}  [options.anchor]      the rail's tile the window opens
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
    const calc = settings.calculator || pressureModule;
    if (!calc || !windowModule) return null;
    const reducedMotion = typeof settings.reducedMotion === "function" ? settings.reducedMotion : () => false;

    const state = {
      entries: { psi: "", bar: "" },
      source: "psi",      // the face last typed on
      result: null
    };

    /* ---- The frame: a Station window ---- */
    const win = windowModule.create(doc, {
      name: "pressure",
      title: "Pressure",
      className: "station-pressure__panel",
      closeTitle: "Close the converter (Esc)",
      anchor: settings.anchor,
      mount: settings.mount,
      reducedMotion,
      animate: settings.animate,
      measure: settings.measure,
      computedStyle: settings.computedStyle,
      timing: settings.timing,
      onOpenChange: settings.onOpenChange,
      focus: () => faces[state.source].input
    });
    const rootEl = win.element;
    rootEl.setAttribute("data-role", "pressure");
    const panel = win.panel;
    const body = win.body;
    const readout = win.readout;

    /* ---- The faces: PSI left, bar right, the link between ---- */
    const form = element(doc, "form", "station-pressure__faces", { "data-role": "faces" });
    const faces = {};
    for (const unit of calc.UNITS) faces[unit.key] = buildFace(doc, unit);
    form.appendChild(faces.psi.face);
    form.appendChild(buildLink(doc, calc));
    form.appendChild(faces.bar.face);
    body.appendChild(form);

    /* ---- The reference strip: common line pressures, one click each ---- */
    const reference = element(doc, "div", "station-pressure__reference", { role: "group", "aria-label": "Common pressures" });
    reference.appendChild(text(doc, "span", "station-pressure__label", "Common"));
    const chips = element(doc, "div", "station-pressure__chips");
    const points = calc.reference().map(point => {
      const chip = element(doc, "button", CHIP, {
        type: "button", "data-role": "reference", "data-psi": String(point.psi),
        title: `${calc.formatPsi(point.psi)} psi is ${calc.formatBar(point.bar)} bar`
      });
      chip.appendChild(text(doc, "span", "station-pressure__chip-psi", calc.formatPsi(point.psi).replace(/\.0$/, "")));
      chip.appendChild(text(doc, "span", "station-pressure__chip-bar", calc.formatBar(point.bar)));
      chips.appendChild(chip);
      return { point, chip };
    });
    reference.appendChild(chips);
    body.appendChild(reference);

    body.appendChild(text(doc, "p", "station-pressure__notice", NOTICE, { "data-role": "notice" }));
    const note = element(doc, "p", "station-pressure__note", { role: "status", hidden: "" });
    body.appendChild(note);

    /* ---- Display ---- */

    function say(message, kind) {
      note.textContent = message || "";
      note.setAttribute("data-kind", kind || "");
      show(note, !!message);
    }

    function markInvalid(unit, message) {
      const input = faces[unit].input;
      if (message) { input.setAttribute("aria-invalid", "true"); input.setAttribute("title", message); }
      else { input.removeAttribute("aria-invalid"); input.removeAttribute("title"); }
    }

    function turn(face, fraction) {
      face.needle.style.transform = `rotate(${fix(angleFor(fraction))}deg)`;
      face.needle.setAttribute("data-angle", String(fix(angleFor(fraction))));
    }

    /* A face drawn for a full scale: the figures on its quarters (the
     * source's round, the other's converted), the needle on the reading. */
    function drawFace(face, value, fullScale, source) {
      const unit = face.unit.key;
      face.face.setAttribute("data-source", source ? "true" : "false");
      face.face.setAttribute("data-live", "true");
      for (let i = 0; i < face.figures.length; i++) {
        const at = (fullScale * i) / DIAL.majors;
        face.figures[i].textContent = source ? String(Number(at.toPrecision(12))) : calc.format(at, unit);
      }
      turn(face, fullScale > 0 ? value / fullScale : 0);
      face.dial.setAttribute("aria-label", `${face.unit.label} gauge reading ${calc.format(value, unit)} of ${calc.format(fullScale, unit)}`);
    }

    function drawSource() {
      for (const key of Object.keys(faces)) faces[key].face.setAttribute("data-source", key === state.source ? "true" : "false");
    }

    /* Nothing to show: the figures go, both needles rest on the zero
     * stop, the readout says what is missing. A half-typed entry never
     * leaves a stale reading on the other face. */
    function withoutAnswer(message) {
      state.result = null;
      for (const key of Object.keys(faces)) {
        const face = faces[key];
        face.face.setAttribute("data-live", "false");
        for (const figure of face.figures) figure.textContent = "";
        turn(face, 0);
        face.dial.setAttribute("aria-label", `${face.unit.label} gauge, no reading`);
        // The other face's entry is cleared with the source's: it was the
        // answer, and there is none.
        if (key !== state.source) { face.input.value = ""; state.entries[key] = ""; }
      }
      drawSource();
      readout.textContent = message;
      readout.classList.add("is-unset");
    }

    function drawAnswer(answer) {
      state.result = answer;
      const other = answer.from === "psi" ? "bar" : "psi";
      // The other face's entry is the answer, formatted as its face reads.
      const otherText = calc.format(answer[other], other);
      faces[other].input.value = otherText;
      state.entries[other] = otherText;
      // The source's scale is round; the other's is the same pressure.
      const sourceScale = calc.scaleFor(answer[answer.from]);
      const otherScale = answer.from === "psi" ? calc.psiToBar(sourceScale) : calc.barToPsi(sourceScale);
      drawFace(faces[answer.from], answer[answer.from], sourceScale, true);
      drawFace(faces[other], answer[other], otherScale, false);
      readout.textContent = `${calc.formatPsi(answer.psi)} psi · ${calc.formatBar(answer.bar)} bar`;
      readout.classList.remove("is-unset");
    }

    /* The answer follows the source's entry live, through the
     * application's own arithmetic. */
    function compute() {
      const from = state.source;
      markInvalid("psi", "");
      markInvalid("bar", "");
      say("");
      const value = state.entries[from];
      if (String(value).trim() === "") {
        withoutAnswer("Enter a pressure in psi or bar");
        return null;
      }
      const answer = calc.convert({ value, from });
      if (!answer.valid) {
        markInvalid(from, answer.errors[0]);
        withoutAnswer("Check the entry");
        say(answer.errors[0], "error");
        return null;
      }
      drawAnswer(answer);
      return answer;
    }

    for (const key of Object.keys(faces)) {
      faces[key].input.addEventListener("input", () => {
        state.source = key;
        state.entries[key] = String(faces[key].input.value || "");
        compute();
      });
      faces[key].input.addEventListener("focus", () => {
        // The face with the keyboard is the one the next entry is on.
        if (state.source !== key && String(state.entries[key]).trim() === "" && !state.result) {
          state.source = key;
          drawSource();
        }
      });
    }
    for (const { point, chip } of points) {
      chip.addEventListener("click", () => {
        state.source = "psi";
        state.entries.psi = calc.formatPsi(point.psi).replace(/\.0$/, "");
        faces.psi.input.value = state.entries.psi;
        compute();
      });
    }
    form.addEventListener("submit", event => {
      if (typeof event.preventDefault === "function") event.preventDefault();
      compute();
    });

    compute();

    return {
      element: rootEl,
      panel,
      window: win,
      open: win.open,
      close: win.close,
      toggle: win.toggle,
      compute,
      isOpen: win.isOpen,
      entries: () => Object.assign({}, state.entries),
      source: () => state.source,
      place: win.place,
      result: () => (state.result ? Object.assign({}, state.result) : null),
      getTiming: win.getTiming
    };
  }

  return Object.freeze({ DEFAULT_TIMING, DIAL, NOTICE, angleFor, arcPath, ticksPath, needlePath, create });
});
