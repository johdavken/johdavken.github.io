/* How to Use: a short guide, in the Timeline's place.
 *
 * A typical changeover for an operator new to Slate, in eight short
 * steps, then the one thing worth knowing about - Ran out. Smart Hoppers
 * is left out on purpose: not a need-to-know for a new operator. Kept
 * short on purpose: a line or two a step, in the words the controls
 * themselves carry, so what the guide says is what is on the
 * screen. One drawing, where words alone are slow: a hopper dragged by
 * the bar at its foot onto another. The guide reads nothing and
 * dispatches nothing.
 *
 * The head's close hands the aside back to the Timeline (ctx.back).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynSlateGuide = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const TITLE = "How to Use";
  const CLOSE_LABEL = "Back to the Timeline";
  const CAPTION = "A changeover, start to finish.";

  /* [title, what to do]; a `drawing` names the step's picture. */
  const STEPS = Object.freeze([
    Object.freeze({ title: "Enter what's running", body: "Recipe → Current: type each hopper's resin and blend, then Apply. Hopper 1's blend fills itself. Or scan the dosing screen with a phone on the same line." }),
    Object.freeze({ title: "Enter the next job", body: "Switch to Next and enter the job traveler the same way, or scan it with a phone. Or Copy current → Next and change only what differs." }),
    Object.freeze({ title: "Changes track themselves", body: "Every hopper whose resin changes is tracked, and shows on the Timeline at the time to turn its pump off." }),
    Object.freeze({ title: "Plan the blend change", body: "On Next, each hopper also shows what's in it now. Drag one by the bar at its foot to move or swap it: stack resins that run well together, and keep ones staying in the blend where they are.", drawing: "drag" }),
    Object.freeze({ title: "Edit several at once", body: "Click hopper ids to select them - Shift for a run, a layer's name for the whole layer - enter a resin or blend, Fill, then Apply." }),
    Object.freeze({ title: "Print the hookups", body: "Print → Next makes a sheet for whoever hooks up the line." }),
    Object.freeze({ title: "Run it down", body: "When a Timeline card comes due, turn that hopper's pump off and press Off. Press Back on once it's hooked up again." }),
    Object.freeze({ title: "Finish", body: "Once the new job runs, Promote Next → Current, then Reset tracking." })
  ]);

  const NOTES = Object.freeze([
    Object.freeze({ title: "Ran out", body: "A hopper ran dry before its time? On its row at the Timeline's foot press Ran out, set when, then Apply and Confirm. Slate corrects that hopper's weight, so the next run-down is on time." })
  ]);

  const SVG = "http://www.w3.org/2000/svg";

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

  function svg(doc, name, attributes) {
    const node = typeof doc.createElementNS === "function" ? doc.createElementNS(SVG, name) : doc.createElement(name);
    if (attributes) for (const key of Object.keys(attributes)) node.setAttribute(key, String(attributes[key]));
    return node;
  }

  /* Two cells: the left one lifted by its foot bar and carried onto the
   * right, which it swaps with. Each shows its next resin, and under it
   * what the hopper holds now. Colours are the sheet's (guide.css). */
  function dragDrawing(doc) {
    const figure = svg(doc, "svg", { class: "slate-guide__drawing", viewBox: "0 0 240 100", role: "img", "aria-label": "A hopper dragged by the bar at its foot onto another" });
    for (const [x, id, next, now, lifted] of [[8, "B2", "HD622", "now MS0100", true], [140, "B3", "MS0100", "now HD622", false]]) {
      figure.appendChild(svg(doc, "rect", { class: lifted ? "slate-guide__cell is-lifted" : "slate-guide__cell", x, y: 6, width: 92, height: 70, rx: 6 }));
      const idText = svg(doc, "text", { class: "slate-guide__cell-id", x: x + 8, y: 22 });
      idText.textContent = id;
      figure.appendChild(idText);
      const resin = svg(doc, "text", { class: "slate-guide__cell-resin", x: x + 8, y: 40 });
      resin.textContent = next;
      figure.appendChild(resin);
      const band = svg(doc, "text", { class: "slate-guide__cell-now", x: x + 8, y: 56 });
      band.textContent = now;
      figure.appendChild(band);
      figure.appendChild(svg(doc, "rect", { class: "slate-guide__cell-grip", x: x + 36, y: 66, width: 20, height: 3, rx: 1.5 }));
    }
    figure.appendChild(svg(doc, "path", { class: "slate-guide__arrow", d: "M54 72 C 80 96, 150 96, 186 74" }));
    figure.appendChild(svg(doc, "path", { class: "slate-guide__arrow is-head", d: "M178 74.2 L186 74 L182.2 81" }));
    return figure;
  }

  const DRAWINGS = Object.freeze({ drag: dragDrawing });

  /**
   * @param {Document} doc
   * @param {object} [ctx]
   * @param {function} [ctx.back]  hand the aside back to the Timeline
   */
  function create(doc, ctx) {
    const settings = ctx || {};
    const back = typeof settings.back === "function" ? settings.back : () => {};

    const rootEl = element(doc, "section", "slate-panel slate-guide", { "aria-label": TITLE });
    const head = element(doc, "div", "slate-panel__head");
    head.appendChild(text(doc, "h2", "slate-panel__title", TITLE));
    const close = element(doc, "button", "slate-panel__close", { type: "button", "aria-label": CLOSE_LABEL, title: CLOSE_LABEL, "data-slate-back": "" });
    close.appendChild(text(doc, "span", "slate-panel__close-glyph", "×", { "aria-hidden": "true" }));
    close.addEventListener("click", () => back());
    head.appendChild(close);
    rootEl.appendChild(head);

    const body = element(doc, "div", "slate-guide__body");
    body.appendChild(text(doc, "p", "slate-guide__caption", CAPTION));
    const steps = element(doc, "ol", "slate-guide__steps");
    STEPS.forEach((step, i) => {
      const item = element(doc, "li", "slate-guide__step", { "data-step": i + 1 });
      item.appendChild(text(doc, "span", "slate-guide__number", String(i + 1), { "aria-hidden": "true" }));
      const words = element(doc, "div", "slate-guide__words");
      words.appendChild(text(doc, "h3", "slate-guide__title", step.title));
      words.appendChild(text(doc, "p", "slate-guide__text", step.body));
      if (step.drawing && DRAWINGS[step.drawing]) words.appendChild(DRAWINGS[step.drawing](doc));
      item.appendChild(words);
      steps.appendChild(item);
    });
    body.appendChild(steps);

    body.appendChild(text(doc, "h3", "slate-guide__subhead", "Good to know"));
    const notes = element(doc, "dl", "slate-guide__notes");
    for (const note of NOTES) {
      const pair = element(doc, "div", "slate-guide__note");
      pair.appendChild(text(doc, "dt", "slate-guide__note-title", note.title));
      pair.appendChild(text(doc, "dd", "slate-guide__note-text", note.body));
      notes.appendChild(pair);
    }
    body.appendChild(notes);
    rootEl.appendChild(body);

    return Object.freeze({ element: rootEl });
  }

  return Object.freeze({ TITLE, CLOSE_LABEL, STEPS, NOTES, create });
});
