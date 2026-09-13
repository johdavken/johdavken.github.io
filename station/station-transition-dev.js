/* Transition review controls - development only, not part of the product.
 *
 * At ?transition=debug on the standalone harness, a small panel that can
 * open and close a layer, slow the transition down, and hold it at any
 * point, so the motion can be inspected frame by frame. Production timing
 * is untouched: the slowdown is a playback rate on the animations in
 * flight, applied only while this panel asks for it.
 *
 * REMOVING IT
 *
 * Delete this file, its <script> tag in station/station.html, and the
 * `transitionDebugRequested()` branch in station/station.js. Nothing else
 * refers to it, and it is never loaded by station-host.js - so the real
 * application cannot reach it at all.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynStationTransitionDev = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function element(doc, name, className, text) {
    const el = doc.createElement(name);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }

  /* The flight's whole span, so one fraction can address every animation
   * in it - each has its own delay and duration. */
  function spanOf(animations) {
    let end = 0;
    for (const a of animations) {
      const t = a.effect && a.effect.getTiming ? a.effect.getTiming() : { delay: 0, duration: 0 };
      end = Math.max(end, (t.delay || 0) + (Number(t.duration) || 0));
    }
    return end;
  }

  /**
   * @param {Element} container   the Station app container
   * @param {Document} doc
   * @param {object} deps  { stage, open(layer), close() }
   */
  function mount(container, doc, deps) {
    const panel = element(doc, "div", "station-dev");
    panel.setAttribute("data-station-dev", "transition");
    panel.appendChild(element(doc, "span", "station-dev__title", "Transition"));

    const layers = element(doc, "span", "station-dev__group");
    for (const id of ["A", "B", "C", "D", "E"]) {
      const button = element(doc, "button", "station-dev__button", id);
      button.type = "button";
      button.addEventListener("click", () => deps.open(id));
      layers.appendChild(button);
    }
    panel.appendChild(layers);

    const close = element(doc, "button", "station-dev__button", "Close");
    close.type = "button";
    close.addEventListener("click", () => deps.close());
    panel.appendChild(close);

    const speed = element(doc, "select", "station-dev__select");
    for (const factor of [1, 2, 4, 8]) {
      const option = element(doc, "option", null, `${factor}×`);
      option.value = String(factor);
      speed.appendChild(option);
    }
    speed.addEventListener("change", () => deps.stage.setSlowdown(Number(speed.value)));
    panel.appendChild(speed);

    /* Hold: pauses whatever is in flight and parks it at a fraction of its
     * span. Release lets it run on from there. */
    const hold = element(doc, "input", "station-dev__range");
    hold.type = "range";
    hold.min = "0"; hold.max = "100"; hold.value = "0";
    hold.setAttribute("aria-label", "Hold the transition at a point");
    hold.addEventListener("input", () => {
      const animations = deps.stage.animations();
      const span = spanOf(animations);
      const fraction = Number(hold.value) / 100;
      for (const a of animations) {
        a.pause();
        a.currentTime = Math.max(0, Math.min(span, span * fraction));
      }
      readout.textContent = `${hold.value}%`;
    });
    panel.appendChild(hold);
    const readout = element(doc, "span", "station-dev__readout", "—");
    panel.appendChild(readout);

    const release = element(doc, "button", "station-dev__button", "Release");
    release.type = "button";
    release.addEventListener("click", () => {
      for (const a of deps.stage.animations()) a.play();
      readout.textContent = "—";
    });
    panel.appendChild(release);

    // The controller's state, written whenever the host reports a change
    // (station.js forwards the controller's onChange here).
    const state = element(doc, "span", "station-dev__state", "");
    panel.appendChild(state);
    const update = s => {
      const now = s || deps.stage.getState();
      state.textContent = `${now.phase}${now.focusLayer ? ` · ${now.focusLayer}` : ""}`;
    };
    update();

    // For scripted review (a console or an automation driving the harness):
    // the controller, reachable from the panel element.
    panel.stage = deps.stage;
    container.appendChild(panel);
    return { panel, update };
  }

  return { mount, spanOf };
});
