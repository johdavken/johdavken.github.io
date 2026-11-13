/* The recipe scan in Slate's own sheet.
 *
 * The application's scan flow (recipe-scan-ui.js) photographs a job
 * traveler or a dosing screen, reads it, and applies what the operator
 * approves. Behind Slate its three dialogs - which layer is A, the photo,
 * the review - came up in the floor UI's clothes. This is Slate's answer,
 * as slate-conflict.js is for the RT Sync question: the flow keeps the
 * capture, the upload, the mapping and the apply, and hands each step here
 * through the presenter it is registered with (setPresenter). This draws
 * the step and answers through the flow it is handed (useFlow).
 *
 * One card over the page, one step at a time; on a phone it rises from the
 * foot as a sheet (scan.css). The scrim, Escape and Back are Cancel. A
 * step the flow hands over after a Cancel (a reply that was already on its
 * way) is not drawn: the sheet opens only on a capture or the orientation
 * question.
 *
 * It holds no recipe: the review is the flow's data, and the one value
 * typed here - a layer percentage the scan could not read - goes straight
 * back through flow.setLayerPct, as the floor UI's input does. It
 * requests and dispatches nothing.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynSlateScanSheet = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function dismissStack() {
    const shared = typeof require === "function" ? require("./slate-dismiss.js") : (typeof globalThis !== "undefined" ? globalThis.PolynSlateDismiss : null);
    return shared && typeof shared.register === "function" ? shared : { register: () => () => {} };
  }

  const WORDING = Object.freeze({
    orientationTitle: "Which layer is A?",
    orientationBody: "This line isn't one Resin.tools knows, so it can't tell which end layer A is. Choose it once for this scan so the layers map correctly.",
    inside: "A is the inside layer",
    outside: "A is the outside layer",
    takePhoto: "Take photo",
    choosePhoto: "Choose photo",
    webPhoto: "Take or choose a photo",
    cancel: "Cancel",
    retake: "Retake photo",
    calculated: "calculated",
    notRead: "not read",
    auto: "auto",
    componentsOff: "Components didn't total 100%",
    defaulted: "not read · 0%",
    missing: "—"
  });

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

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function show(node, on) {
    if (on) node.removeAttribute("hidden");
    else node.setAttribute("hidden", "");
  }

  /** "12.5%", "70%", "" for no number. Two places at most, trailing zeros dropped. */
  function percent(value) {
    if (typeof value !== "number" || !Number.isFinite(value)) return "";
    return `${Number(value.toFixed(2))}%`;
  }

  function button(doc, label, kind, attributes) {
    const tone = kind === "primary" ? " slate-recipe__plan-action--promote" : (kind === "quiet" ? " slate-recipe__plan-action--quiet" : "");
    const lead = kind === "primary" ? " slate-scan-sheet__answer--lead" : "";
    return text(doc, "button", `slate-recipe__plan-action${tone} slate-scan-sheet__answer${lead}`, label, Object.assign({ type: "button" }, attributes || {}));
  }

  /**
   * @param {Document} doc
   * @returns {{ element, presenter, useFlow(flow), isOpen(), step(), close() }}
   */
  function create(doc) {
    const stack = dismissStack();
    const sheet = element(doc, "div", "slate-modal slate-scan-sheet", { hidden: "" });
    const scrim = element(doc, "div", "slate-modal__scrim", { "data-slate-modal": "scrim" });
    sheet.appendChild(scrim);
    const card = element(doc, "div", "slate-modal__card slate-scan-sheet__card", { role: "dialog", "aria-modal": "true", "aria-labelledby": "slate-scan-sheet-title", tabindex: "-1" });
    const title = text(doc, "h2", "slate-modal__title slate-scan-sheet__title", "", { id: "slate-scan-sheet-title" });
    card.appendChild(title);
    const body = element(doc, "div", "slate-scan-sheet__body");
    card.appendChild(body);
    const status = element(doc, "p", "slate-scan-sheet__status", { role: "status", hidden: "" });
    card.appendChild(status);
    const actions = element(doc, "div", "slate-modal__actions slate-scan-sheet__actions");
    card.appendChild(actions);
    sheet.appendChild(card);
    // The web's way to a photo: the browser's own picker (a phone offers
    // its camera there). On Android the flow takes and picks photos itself.
    const fileInput = element(doc, "input", "slate-scan-sheet__file", { type: "file", accept: "image/*", hidden: "", tabindex: "-1", "aria-hidden": "true" });
    sheet.appendChild(fileInput);

    const state = { open: false, step: null, busy: false, restore: null, offStack: null };
    let flow = null;

    function setStatus(message, error) {
      status.textContent = message || "";
      status.classList.toggle("is-error", !!error);
      show(status, !!message);
    }

    function setBusy(on) {
      state.busy = !!on;
      sheet.classList.toggle("is-busy", state.busy);
      for (const node of actions.querySelectorAll("button")) {
        if (node.getAttribute("data-scan-do") === "cancel") continue;
        if (state.busy) node.setAttribute("disabled", "");
        else node.removeAttribute("disabled");
      }
    }

    function open() {
      if (state.open) return;
      state.open = true;
      state.restore = doc.activeElement || null;
      show(sheet, true);
      state.offStack = stack.register(() => cancel());
    }

    function close() {
      if (!state.open) return;
      state.open = false;
      state.step = null;
      setBusy(false);
      show(sheet, false);
      sheet.removeAttribute("data-scan-step");
      if (state.offStack) { const off = state.offStack; state.offStack = null; off(); }
      const back = state.restore;
      state.restore = null;
      if (back && typeof back.focus === "function") back.focus();
    }

    function cancel() {
      if (!state.open) return;
      close();
      if (flow) flow.cancel();
    }

    function setStep(step, heading) {
      state.step = step;
      sheet.setAttribute("data-scan-step", step);
      title.textContent = heading;
      clear(body);
      clear(actions);
      setStatus("", false);
      setBusy(false);
    }

    /* On a phone the lead answer spans the foot with the other two side by
     * side under it (scan.css); two answers, or the orientation question's
     * three equal ones, stack. */
    function layOut() {
      const count = actions.querySelectorAll("button").length;
      actions.classList.toggle("slate-scan-sheet__actions--stack", state.step === "orientation" || count < 3);
    }

    function focusFirst() {
      const first = Array.from(actions.querySelectorAll("button")).find(node => !node.hasAttribute("disabled"));
      if (first && typeof first.focus === "function") first.focus();
    }

    /* ---- the presenter: what the flow calls ---- */

    function orientation() {
      open();
      setStep("orientation", WORDING.orientationTitle);
      body.appendChild(text(doc, "p", "slate-modal__body", WORDING.orientationBody));
      actions.appendChild(button(doc, WORDING.inside, "plain", { "data-scan-do": "inside" }));
      actions.appendChild(button(doc, WORDING.outside, "plain", { "data-scan-do": "outside" }));
      actions.appendChild(button(doc, WORDING.cancel, "quiet", { "data-scan-do": "cancel" }));
      layOut();
      focusFirst();
    }

    function capture(step) {
      const details = step || {};
      open();
      setStep("capture", details.title || "Scan");
      body.appendChild(text(doc, "p", "slate-modal__body", details.description || ""));
      fileInput.value = "";
      if (details.native) {
        actions.appendChild(button(doc, WORDING.takePhoto, "primary", { "data-scan-do": "take" }));
        actions.appendChild(button(doc, WORDING.choosePhoto, "plain", { "data-scan-do": "choose" }));
      } else {
        actions.appendChild(button(doc, WORDING.webPhoto, "primary", { "data-scan-do": "pick" }));
      }
      actions.appendChild(button(doc, WORDING.cancel, "quiet", { "data-scan-do": "cancel" }));
      layOut();
      focusFirst();
    }

    function reviewLayer(layer) {
      const block = element(doc, "section", "slate-scan-sheet__layer", { "data-scan-layer": layer.index });
      const head = element(doc, "div", "slate-scan-sheet__layer-head");
      head.appendChild(text(doc, "span", "slate-scan-sheet__layer-name", `Layer ${layer.name}`));
      if (layer.pctState === "estimated") {
        const field = element(doc, "label", "slate-scan-sheet__layer-field");
        field.appendChild(text(doc, "span", "slate-scan-sheet__flag", WORDING.notRead));
        const input = element(doc, "input", "slate-scan-sheet__layer-input", {
          type: "number", inputmode: "decimal", min: "0", max: "100", step: "0.01",
          "aria-label": `Layer ${layer.name} percentage`, "data-scan-layer-pct": layer.index
        });
        input.addEventListener("input", () => { if (flow) flow.setLayerPct(layer.index, input.value); });
        // Enter goes on to the next unread layer, as the floor UI's does.
        input.addEventListener("keydown", event => {
          if (!event || event.key !== "Enter") return;
          if (typeof event.preventDefault === "function") event.preventDefault();
          const all = Array.from(body.querySelectorAll("[data-scan-layer-pct]"));
          const next = all[all.indexOf(input) + 1];
          if (next && typeof next.focus === "function") next.focus();
          else if (typeof input.blur === "function") input.blur();
        });
        field.appendChild(input);
        field.appendChild(text(doc, "span", "slate-scan-sheet__unit", "%", { "aria-hidden": "true" }));
        head.appendChild(field);
      } else {
        const pct = element(doc, "span", "slate-scan-sheet__layer-pct");
        pct.appendChild(doc.createTextNode(percent(layer.pct)));
        if (layer.pctState === "calculated") pct.appendChild(text(doc, "span", "slate-scan-sheet__tag", WORDING.calculated));
        head.appendChild(pct);
      }
      block.appendChild(head);
      if (layer.componentsOff) block.appendChild(text(doc, "p", "slate-scan-sheet__flag slate-scan-sheet__flag--line", WORDING.componentsOff));
      const list = element(doc, "ul", "slate-scan-sheet__hoppers");
      for (const hopper of layer.hoppers) {
        const row = element(doc, "li", `slate-scan-sheet__hopper is-${hopper.state}`);
        row.appendChild(text(doc, "span", "slate-scan-sheet__hopper-id", hopper.label));
        row.appendChild(text(doc, "span", "slate-scan-sheet__resin", hopper.resin || WORDING.notRead));
        const pct = element(doc, "span", "slate-scan-sheet__hopper-pct");
        if (hopper.state === "missing") pct.textContent = WORDING.missing;
        else if (hopper.state === "estimated") pct.appendChild(text(doc, "span", "slate-scan-sheet__flag", WORDING.defaulted));
        else {
          pct.appendChild(doc.createTextNode(percent(hopper.pct)));
          if (hopper.state === "auto") pct.appendChild(text(doc, "span", "slate-scan-sheet__tag", WORDING.auto));
        }
        row.appendChild(pct);
        list.appendChild(row);
      }
      block.appendChild(list);
      return block;
    }

    function review(model) {
      // Only over a scan this sheet is showing: a reply that lands after a
      // Cancel is not drawn.
      if (!state.open) return;
      const data = model || {};
      setStep("review", data.title || "Review scan");
      for (const warning of data.warnings || []) body.appendChild(text(doc, "p", "slate-scan-sheet__warning", warning));
      for (const layer of data.layers || []) body.appendChild(reviewLayer(layer));
      actions.appendChild(button(doc, data.applyLabel || "Apply", "primary", { "data-scan-do": "apply" }));
      actions.appendChild(button(doc, WORDING.retake, "plain", { "data-scan-do": "retake" }));
      actions.appendChild(button(doc, WORDING.cancel, "quiet", { "data-scan-do": "cancel" }));
      layOut();
      const firstField = body.querySelector("[data-scan-layer-pct]");
      if (firstField && typeof firstField.focus === "function") firstField.focus();
      else focusFirst();
    }

    function statusFor(step, message, error) {
      if (!state.open) return;
      if (step !== state.step) return;
      setStatus(message, error);
      // The capture is busy while the flow says it is: "Scanning…" until
      // the review arrives or an error says why not.
      // An error ends it (the flow clears its own flag just after).
      if (step === "capture") setBusy(!error && !!(flow && typeof flow.busy === "function" && flow.busy()));
    }

    const presenter = Object.freeze({ orientation, capture, status: statusFor, review });

    /* ---- the operator's answers: through the flow ---- */

    function act(what) {
      if (what === "cancel") { cancel(); return; }
      if (!flow || state.busy) return;
      if (what === "inside" || what === "outside") { flow.chooseOrientation(what); return; }
      if (what === "pick") { if (typeof fileInput.click === "function") fileInput.click(); return; }
      if (what === "take") { flow.takePhoto(); return; }
      if (what === "choose") { flow.choosePhoto(); return; }
      if (what === "retake") { flow.retake(); return; }
      if (what === "apply") {
        const result = flow.apply();
        if (result && result.ok) close();
      }
    }

    fileInput.addEventListener("change", () => {
      const file = fileInput.files && fileInput.files[0];
      if (file && flow) flow.submitFile(file);
    });
    sheet.addEventListener("click", event => {
      const target = event && event.target;
      if (!target) return;
      if (target === scrim) { cancel(); return; }
      const control = typeof target.closest === "function" ? target.closest("[data-scan-do]") : null;
      if (control && sheet.contains(control) && !control.hasAttribute("disabled")) act(control.getAttribute("data-scan-do"));
    });
    sheet.addEventListener("keydown", event => {
      if (!event || event.key !== "Escape" || !state.open) return;
      if (typeof event.stopPropagation === "function") event.stopPropagation();
      cancel();
    });

    return Object.freeze({
      element: sheet,
      presenter,
      useFlow(next) { flow = next && typeof next.cancel === "function" ? next : null; },
      isOpen: () => state.open,
      step: () => state.step,
      close: () => cancel()
    });
  }

  return Object.freeze({ WORDING, percent, create });
});
