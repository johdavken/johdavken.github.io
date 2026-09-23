/* Dismissal: how an open popover closes on a press outside it, and the
 * one stack of what is open, for the Android Back key.
 *
 * A PRESS OUTSIDE
 *
 * Slate's popovers closed on a capture-phase `pointerdown` anywhere outside
 * them. A mouse keeps exactly that. A finger's pointerdown is the START of
 * a gesture - a scroll to lift Set above the keyboard begins with one - so
 * a touch or pen closes the popover only on release, and only if it did
 * not travel (MOVE_PX): a tap outside closes, a scroll does not.
 *
 * THE STACK
 *
 * Every popover that closes this way is on the stack while it is open, in
 * the order opened; the boot adds the aside's drawer. `dismissTop()` closes
 * the most recent and says whether there was one - the Android Back key
 * (slate.js, through the `polyn:android-back` event android-back-button.js
 * dispatches) closes what is on top before it ever leaves the app.
 *
 * One stack per page: Slate is mounted once.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynSlateDismiss = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const MOVE_PX = 10;
  const stack = [];

  /** Put a closer on the stack; the returned function takes it off. */
  function register(close) {
    if (typeof close !== "function") return () => {};
    const entry = { close };
    stack.push(entry);
    return () => {
      const at = stack.indexOf(entry);
      if (at > -1) stack.splice(at, 1);
    };
  }

  /** Close the most recently opened thing. False when nothing is open. */
  function dismissTop() {
    const entry = stack.pop();
    if (!entry) return false;
    try { entry.close(); } catch (error) { /* one closer cannot keep Back from working */ }
    return true;
  }

  function depth() {
    return stack.length;
  }

  /**
   * Close `close()` on a press outside `inside` - which may be an element
   * or a function (target) => boolean - by the rules above, and keep it on
   * the stack while listening. Returns { start, stop }: the popover calls
   * start() as it opens and stop() as it closes, however it closes.
   *
   * @param {EventTarget} target   where to listen (the document, or the window)
   */
  function outside(target, inside, close) {
    const contains = typeof inside === "function"
      ? inside
      : node => !!(inside && node && typeof inside.contains === "function" && inside.contains(node));
    let press = null;
    let unregister = null;
    let on = false;

    function down(event) {
      if (!event || contains(event.target)) { press = null; return; }
      if (!event.pointerType || event.pointerType === "mouse") { press = null; close(); return; }
      press = { id: event.pointerId, x: Number(event.clientX) || 0, y: Number(event.clientY) || 0 };
    }
    function up(event) {
      if (!press || !event || (event.pointerId !== undefined && press.id !== undefined && event.pointerId !== press.id)) return;
      const moved = Math.hypot((Number(event.clientX) || 0) - press.x, (Number(event.clientY) || 0) - press.y);
      press = null;
      if (moved < MOVE_PX) close();
    }
    function cancel() {
      press = null;
    }

    function start() {
      if (on || !target || typeof target.addEventListener !== "function") return;
      on = true;
      target.addEventListener("pointerdown", down, true);
      target.addEventListener("pointerup", up, true);
      target.addEventListener("pointercancel", cancel, true);
      unregister = register(close);
    }
    function stop() {
      if (!on) return;
      on = false;
      press = null;
      if (typeof target.removeEventListener === "function") {
        target.removeEventListener("pointerdown", down, true);
        target.removeEventListener("pointerup", up, true);
        target.removeEventListener("pointercancel", cancel, true);
      }
      if (unregister) { unregister(); unregister = null; }
    }
    return Object.freeze({ start, stop, isOn: () => on });
  }

  return Object.freeze({ MOVE_PX, register, dismissTop, depth, outside });
});
