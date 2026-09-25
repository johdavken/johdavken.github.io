/* Rearranging by drag: a hopper's id badge lifted onto another row.
 *
 * Pointer Events. A mouse or a pen: a press on the badge and a few pixels
 * of movement. A finger: a press held still on the badge for HOLD_MS -
 * moving first abandons it, so a hurried swipe is never a move - and the
 * badge carries touch-action: none (recipe-edit.css) so the page does not
 * scroll away under the drag. Then a floating proxy of the assignment
 * follows the pointer while the origin row dims and the row under the
 * pointer is marked. The proxy is two boxes: the outer one only follows
 * the pointer (its transform), the card inside it is what the sheet
 * animates - lifted, tilted, floating and so on, the Handling preference;
 * the card is-over while a hopper waits under it - and it
 * carries --slate-drag-sway, the pointer's sideways speed as a lean, which
 * settles back to upright once the pointer rests. Release on another row hands the caller ONE drop; release
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
  /* A finger: held this long, this still, before the badge lifts. */
  const HOLD_MS = 300;
  const THRESHOLD_TOUCH = 10;
  /* The lean: degrees per pixel of sideways movement, at most this far,
   * and back upright after the pointer has rested this long. */
  const SWAY_PER_PX = 0.35;
  const SWAY_MAX = 7;
  const SWAY_REST_MS = 110;
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
   * @param {object} [options.timers]    { setTimeout, clearTimeout } for a finger's hold
   */
  function create(doc, options) {
    const settings = options || {};
    const list = settings.list;
    const mount = settings.mount || list;
    const able = typeof settings.able === "function" ? settings.able : () => true;
    const values = typeof settings.values === "function" ? settings.values : () => ({ id: "", resin: "", pct: "" });
    const onDrop = typeof settings.onDrop === "function" ? settings.onDrop : () => {};
    const view = settings.view || doc;
    const timers = settings.timers || { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: id => clearTimeout(id) };

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
      // Over a hopper it would land on: some handlings settle the card.
      drag.card.classList.toggle("is-over", !!target);
    }

    function begin(event) {
      const origin = press.row;
      const lifted = values(origin) || {};
      const proxy = element(doc, "div", "slate-drag-proxy", { "aria-hidden": "true" });
      // The card, laid out as the Grid's cell is: id and blend on the
      // first line, the resin under them.
      const card = element(doc, "div", "slate-drag-proxy__card");
      card.appendChild(text(doc, "span", "slate-drag-proxy__id", lifted.id || ""));
      card.appendChild(text(doc, "span", "slate-drag-proxy__pct", lifted.pct || ""));
      card.appendChild(text(doc, "span", "slate-drag-proxy__resin", lifted.resin || ""));
      proxy.appendChild(card);
      const rect = typeof origin.getBoundingClientRect === "function" ? origin.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 };
      proxy.style.width = `${rect.width}px`;
      proxy.style.height = `${rect.height}px`;
      mount.appendChild(proxy);
      drag = {
        pointerId: press.pointerId,
        origin,
        from: positionOf(origin),
        proxy,
        card,
        lastX: press.x,
        sway: 0,
        rest: null,
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
      lean(x);
      const row = rowAt(x, y);
      mark(row && row !== drag.origin ? row : null);
    }

    /* The card leans the way the pointer is going, half what it leaned
     * before and half the new speed, and stands up again at rest. */
    function lean(x) {
      const dx = x - drag.lastX;
      drag.lastX = x;
      const wanted = Math.max(-SWAY_MAX, Math.min(SWAY_MAX, dx * SWAY_PER_PX));
      setSway((drag.sway + wanted) / 2);
      if (drag.rest !== null) timers.clearTimeout(drag.rest);
      const held = drag;
      drag.rest = timers.setTimeout(() => { held.rest = null; if (drag === held) setSway(0); }, SWAY_REST_MS);
    }

    function setSway(value) {
      drag.sway = Math.abs(value) < 0.05 ? 0 : value;
      drag.card.style.setProperty("--slate-drag-sway", `${Math.round(drag.sway * 10) / 10}deg`);
    }

    function releaseHold() {
      if (press && press.timer !== null && press.timer !== undefined) {
        timers.clearTimeout(press.timer);
        press.timer = null;
      }
    }

    function finish(dropped) {
      releaseHold();
      const active = drag;
      const pressed = press;
      press = null;
      drag = null;
      if (typeof view.removeEventListener === "function") view.removeEventListener("keydown", onKey, true);
      if (!active) return;
      if (active.rest !== null) timers.clearTimeout(active.rest);
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
      const finger = event.pointerType === "touch";
      if (event.button !== undefined && event.button !== 0) return;
      const target = event.target;
      const handle = target && typeof target.closest === "function" ? target.closest(HANDLE) : null;
      if (!handle || !list.contains(handle)) return;
      const row = handle.closest(ROW);
      if (!row || row.classList.contains("is-empty") || !positionOf(row)) return;
      if (!able()) return;
      press = { pointerId: event.pointerId, x: Number(event.clientX) || 0, y: Number(event.clientY) || 0, row, handle, finger, timer: null };
      if (typeof event.preventDefault === "function") event.preventDefault();
      // A finger lifts the badge once it has been held still long enough.
      if (finger) {
        const held = press;
        held.timer = timers.setTimeout(() => {
          held.timer = null;
          if (press !== held || drag) return;
          if (!able() || !held.row.isConnected) { press = null; return; }
          begin({ clientX: held.x, clientY: held.y });
        }, HOLD_MS);
      }
    }

    function onMove(event) {
      if (!event || !press || event.pointerId !== press.pointerId) return;
      if (!drag) {
        const dx = (Number(event.clientX) || 0) - press.x;
        const dy = (Number(event.clientY) || 0) - press.y;
        const moved = Math.sqrt(dx * dx + dy * dy);
        // A finger that moves before its hold is up is not lifting the badge.
        if (press.finger) {
          if (moved >= THRESHOLD_TOUCH) { releaseHold(); press = null; }
          return;
        }
        if (moved < THRESHOLD) return;
        begin(event);
        return;
      }
      follow(event);
    }

    function onUp(event) {
      if (!event || !press || event.pointerId !== press.pointerId) return;
      if (drag) finish(true);
      else { releaseHold(); press = null; }
    }

    function onCancel(event) {
      if (!event || !press || event.pointerId !== press.pointerId) return;
      finish(false);
    }

    list.addEventListener("pointerdown", onDown);
    list.addEventListener("pointermove", onMove);
    list.addEventListener("pointerup", onUp);
    list.addEventListener("pointercancel", onCancel);
    // A finger's long press would open the system's menu over the drag.
    list.addEventListener("contextmenu", event => { if ((press || drag) && event && typeof event.preventDefault === "function") event.preventDefault(); });
    // The row was replaced under the pointer (a structural render).
    list.addEventListener("lostpointercapture", event => { if (drag && event && event.pointerId === drag.pointerId && !drag.origin.isConnected) finish(false); });

    return Object.freeze({
      cancel: () => { if (drag) finish(false); else { releaseHold(); press = null; } },
      active: () => !!drag,
      /* True once, right after a drag: the click the release produced. */
      consumeClick() { const was = swallow; swallow = false; return was; },
      target: () => (drag ? drag.target : null)
    });
  }

  return Object.freeze({ THRESHOLD, HOLD_MS, THRESHOLD_TOUCH, SWAY_PER_PX, SWAY_MAX, SWAY_REST_MS, ROW, HANDLE, positionOf, create });
});
