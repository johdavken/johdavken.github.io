/* Rearranging by drag: a hopper's id badge lifted onto another row.
 *
 * Pointer Events, desktop only: a left mouse press on the badge, a few
 * pixels of movement, then a floating proxy of the assignment follows the
 * pointer while the origin row dims and the row under the pointer is
 * marked. Release on another row hands the caller ONE drop; release
 * anywhere else, Escape, a lost capture or a cancel from outside end the
 * drag with nothing sent. The click a release produces is swallowed once
 * so the badge's row does not also act on it.
 *
 * Nothing is reordered here and nothing is optimistic: the caller asks
 * the application to move, and the rows redraw from its answer.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynSlateRecipeDrag = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const THRESHOLD = 6;
  const ROW = ".slate-hopper";
  const HANDLE = "[data-slate-handle]";

  function element(doc, name, className, attributes) {
    const node = doc.createElement(name);
    if (className) node.setAttribute("class", className);
    if (attributes) for (const key of Object.keys(attributes)) node.setAttribute(key, attributes[key]);
    return node;
  }

  function text(doc, name, className, value) {
    const node = element(doc, name, className);
    node.textContent = value;
    return node;
  }

  function positionOf(row) {
    const layer = row.getAttribute("data-layer");
    const index = Number(row.getAttribute("data-index"));
    return layer && Number.isInteger(index) ? { layer, index, key: `${layer}:${index}` } : null;
  }

  /**
   * @param {Document} doc
   * @param {object} options
   * @param {Element} options.list       the element the rows live in (events are delegated here)
   * @param {Element} options.mount      where the proxy stands (the section root)
   * @param {function} options.able      () => whether a drag may start now
   * @param {function} options.values    (row) => { id, resin, pct } for the proxy
   * @param {function} options.onDrop    ({ from, to }) - each a { layer, index, key }
   * @param {object} [options.view]      { addEventListener, removeEventListener } for the Escape key (the document)
   */
  function create(doc, options) {
    const settings = options || {};
    const list = settings.list;
    const mount = settings.mount || list;
    const able = typeof settings.able === "function" ? settings.able : () => true;
    const values = typeof settings.values === "function" ? settings.values : () => ({ id: "", resin: "", pct: "" });
    const onDrop = typeof settings.onDrop === "function" ? settings.onDrop : () => {};
    const view = settings.view || doc;

    let press = null;
    let drag = null;
    let swallow = false;

    function rowAt(x, y) {
      const hit = typeof doc.elementFromPoint === "function" ? doc.elementFromPoint(x, y) : null;
      const row = hit && typeof hit.closest === "function" ? hit.closest(ROW) : null;
      return row && list.contains(row) ? row : null;
    }

    function mark(target) {
      if (drag.target === target) return;
      if (drag.target) drag.target.classList.remove("is-drop-target");
      drag.target = target;
      if (target) target.classList.add("is-drop-target");
    }

    function begin(event) {
      const origin = press.row;
      const lifted = values(origin) || {};
      const proxy = element(doc, "div", "slate-drag-proxy", { "aria-hidden": "true" });
      proxy.appendChild(text(doc, "span", "slate-drag-proxy__id", lifted.id || ""));
      proxy.appendChild(text(doc, "span", "slate-drag-proxy__resin", lifted.resin || ""));
      proxy.appendChild(text(doc, "span", "slate-drag-proxy__pct", lifted.pct || ""));
      const rect = typeof origin.getBoundingClientRect === "function" ? origin.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 };
      proxy.style.width = `${rect.width}px`;
      proxy.style.height = `${rect.height}px`;
      mount.appendChild(proxy);
      drag = {
        pointerId: press.pointerId,
        origin,
        from: positionOf(origin),
        proxy,
        target: null,
        offsetX: press.x - rect.left,
        offsetY: press.y - rect.top
      };
      origin.classList.add("is-dragging");
      list.classList.add("is-moving");
      if (typeof press.handle.setPointerCapture === "function") {
        try { press.handle.setPointerCapture(press.pointerId); } catch (error) { /* capture is a courtesy */ }
      }
      if (typeof view.addEventListener === "function") view.addEventListener("keydown", onKey, true);
      follow(event);
    }

    function follow(event) {
      const x = Number(event.clientX) || 0;
      const y = Number(event.clientY) || 0;
      drag.proxy.style.transform = `translate(${Math.round(x - drag.offsetX)}px, ${Math.round(y - drag.offsetY)}px)`;
      const row = rowAt(x, y);
      mark(row && row !== drag.origin ? row : null);
    }

    function finish(dropped) {
      const active = drag;
      const pressed = press;
      press = null;
      drag = null;
      if (typeof view.removeEventListener === "function") view.removeEventListener("keydown", onKey, true);
      if (!active) return;
      active.origin.classList.remove("is-dragging");
      list.classList.remove("is-moving");
      if (active.target) active.target.classList.remove("is-drop-target");
      if (active.proxy.parentNode) active.proxy.parentNode.removeChild(active.proxy);
      if (pressed && pressed.handle && typeof pressed.handle.releasePointerCapture === "function") {
        try { pressed.handle.releasePointerCapture(active.pointerId); } catch (error) { /* already released */ }
      }
      swallow = true;
      if (dropped && active.target) {
        const to = positionOf(active.target);
        if (active.from && to && to.key !== active.from.key) onDrop({ from: active.from, to });
      }
    }

    function onKey(event) {
      if (event && event.key === "Escape" && drag) {
        if (typeof event.stopPropagation === "function") event.stopPropagation();
        finish(false);
      }
    }

    function onDown(event) {
      // A new press starts a new story: whatever the last release was
      // owed to a click, it is not owed to this one.
      swallow = false;
      if (!event || drag || press) return;
      if (event.pointerType && event.pointerType !== "mouse") return;
      if (event.button !== undefined && event.button !== 0) return;
      const target = event.target;
      const handle = target && typeof target.closest === "function" ? target.closest(HANDLE) : null;
      if (!handle || !list.contains(handle)) return;
      const row = handle.closest(ROW);
      if (!row || row.classList.contains("is-empty") || !positionOf(row)) return;
      if (!able()) return;
      press = { pointerId: event.pointerId, x: Number(event.clientX) || 0, y: Number(event.clientY) || 0, row, handle };
      if (typeof event.preventDefault === "function") event.preventDefault();
    }

    function onMove(event) {
      if (!event || !press || event.pointerId !== press.pointerId) return;
      if (!drag) {
        const dx = (Number(event.clientX) || 0) - press.x;
        const dy = (Number(event.clientY) || 0) - press.y;
        if (Math.sqrt(dx * dx + dy * dy) < THRESHOLD) return;
        begin(event);
        return;
      }
      follow(event);
    }

    function onUp(event) {
      if (!event || !press || event.pointerId !== press.pointerId) return;
      if (drag) finish(true);
      else press = null;
    }

    function onCancel(event) {
      if (!event || !press || event.pointerId !== press.pointerId) return;
      finish(false);
    }

    list.addEventListener("pointerdown", onDown);
    list.addEventListener("pointermove", onMove);
    list.addEventListener("pointerup", onUp);
    list.addEventListener("pointercancel", onCancel);
    // The row was replaced under the pointer (a structural render).
    list.addEventListener("lostpointercapture", event => { if (drag && event && event.pointerId === drag.pointerId && !drag.origin.isConnected) finish(false); });

    return Object.freeze({
      cancel: () => finish(false),
      active: () => !!drag,
      /* True once, right after a drag: the click the release produced. */
      consumeClick() { const was = swallow; swallow = false; return was; },
      target: () => (drag ? drag.target : null)
    });
  }

  return Object.freeze({ THRESHOLD, ROW, HANDLE, positionOf, create });
});
