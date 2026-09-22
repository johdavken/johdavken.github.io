/* The RT Sync conflict question, asked in Slate's own dialog.
 *
 * The floor UI asks it with a <dialog> when the active job changed here
 * and on another device: use the shared version, keep this device's, or
 * decide later. Behind Slate that dialog is a question in the wrong
 * clothes, so the connection bridge asks the console first
 * (station-connection-bridge.js, QUESTIONS) and this is Slate's answer:
 * the same words, the same three choices, in Slate's styling, over the
 * page. Escape and a press on the scrim are "decide later", as the floor
 * UI's Escape is. One question at a time: a second one asked while one
 * is open is answered "cancel" at once, as the floor UI answers it.
 *
 * It dispatches and requests nothing; slate-sync.js registers ask() with
 * the bridge, and the answer goes back the way the question came.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynSlateConflict = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const TITLE = "RT Sync conflict";
  const BODY = "The active job changed here and on another device. Both versions were backed up locally.";
  const CHOICES = Object.freeze([
    Object.freeze({ answer: "remote", label: "Use shared version", primary: true }),
    Object.freeze({ answer: "local", label: "Keep this device's version" }),
    Object.freeze({ answer: "cancel", label: "Decide later", quiet: true })
  ]);
  const CANCEL = "cancel";

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

  /** "This device started from revision 3; the shared line is now revision 5." */
  function detailText(details) {
    const d = details || {};
    const local = Number.isInteger(d.localRevision) ? d.localRevision : "?";
    const remote = Number.isInteger(d.remoteRevision) ? d.remoteRevision : "?";
    return `This device started from revision ${local}; the shared line is now revision ${remote}.`;
  }

  /**
   * @param {Document} doc
   */
  function create(doc) {
    const rootEl = element(doc, "div", "slate-modal", { hidden: "" });
    const scrim = element(doc, "div", "slate-modal__scrim", { "data-slate-modal": "scrim" });
    rootEl.appendChild(scrim);
    const card = element(doc, "div", "slate-modal__card", { role: "dialog", "aria-modal": "true", "aria-labelledby": "slate-conflict-title", tabindex: "-1" });
    card.appendChild(text(doc, "h2", "slate-modal__title", TITLE, { id: "slate-conflict-title" }));
    card.appendChild(text(doc, "p", "slate-modal__body", BODY));
    const detail = text(doc, "p", "slate-modal__detail", "");
    card.appendChild(detail);
    const actions = element(doc, "div", "slate-modal__actions");
    const buttons = new Map();
    for (const choice of CHOICES) {
      const button = text(doc, "button", `slate-recipe__plan-action${choice.primary ? " slate-recipe__plan-action--promote" : ""}${choice.quiet ? " slate-recipe__plan-action--quiet" : ""}`, choice.label, { type: "button", "data-slate-answer": choice.answer });
      buttons.set(choice.answer, button);
      actions.appendChild(button);
    }
    card.appendChild(actions);
    rootEl.appendChild(card);

    let pending = null;  // { resolve, restore }

    function settle(answer) {
      if (!pending) return;
      const open = pending;
      pending = null;
      show(rootEl, false);
      open.resolve(answer);
      if (open.restore && typeof open.restore.focus === "function") open.restore.focus();
    }

    /** Ask; resolves with the operator's answer. A second question while
     * one is open is answered "cancel" at once. */
    function ask(details) {
      if (pending) return Promise.resolve(CANCEL);
      detail.textContent = detailText(details);
      return new Promise(resolve => {
        pending = { resolve, restore: doc.activeElement || null };
        show(rootEl, true);
        const primary = buttons.get("remote");
        if (primary && typeof primary.focus === "function") primary.focus();
      });
    }

    rootEl.addEventListener("click", event => {
      const target = event && event.target;
      if (!target || typeof target.closest !== "function") return;
      const button = target.closest("[data-slate-answer]");
      if (button && rootEl.contains(button)) { settle(button.getAttribute("data-slate-answer")); return; }
      if (target === scrim) settle(CANCEL);
    });
    rootEl.addEventListener("keydown", event => {
      if (!event || event.key !== "Escape") return;
      if (typeof event.stopPropagation === "function") event.stopPropagation();
      settle(CANCEL);
    });

    return Object.freeze({
      element: rootEl,
      ask,
      isOpen: () => !!pending,
      close: () => settle(CANCEL),
      button: answer => buttons.get(answer) || null
    });
  }

  return Object.freeze({ TITLE, BODY, CHOICES, CANCEL, detailText, create });
});
