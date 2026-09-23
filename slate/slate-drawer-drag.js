/* Pulling the aside's drawer out by its handle, and pushing it back.
 *
 * On a narrow touch screen the aside is a drawer over the page's right
 * edge (components/panel.css), with a handle floating on that edge, low,
 * where a thumb rests. The handle is inset from the screen's edge: an
 * inward swipe that starts ON the edge is Android's Back gesture, which the
 * system takes before the page sees it.
 *
 * The drawer follows the finger: `shift` is how far it stands from open,
 * 0 (open) to its width (shut), handed to the boot on every move, which
 * writes it as a CSS custom property. On release it settles the other way
 * once it has travelled OPEN_FRACTION of its width from where it started -
 * a pull and a push alike - or with a flick either way (FLICK px/ms).
 * A tap on the handle - no travel - opens or shuts it; so does the
 * keyboard's click. The open drawer is pushed back by a swipe to the right
 * that starts anywhere on it, once the move is plainly sideways; its taps,
 * and its vertical scroll, are left alone, and the click a push releases
 * is spent so it does not also press whatever was under the finger.
 *
 * Nothing here opens or shuts anything itself: `settle(open)` asks the
 * boot, which owns the drawer's state (slate.js).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynSlateDrawerDrag = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* Travel before a press is a drag, not a tap. */
  const THRESHOLD = 6;
  /* This much of its width travelled, a released drawer settles the other way. */
  const OPEN_FRACTION = 0.4;
  /* A release faster than this, px per ms, settles the way it was going. */
  const FLICK = 0.4;

  /** Where a release settles: open or shut, from where it started, where
   *  it stands and how it moved. */
  function settleOpen(shift, width, velocity, wasOpen) {
    if (velocity <= -FLICK) return true;
    if (velocity >= FLICK) return false;
    return wasOpen ? shift < width * OPEN_FRACTION : shift <= width * (1 - OPEN_FRACTION);
  }

  function clamp(value, low, high) {
    return Math.min(high, Math.max(low, value));
  }

  /**
   * @param {Document} doc
   * @param {object} options
   * @param {Element} options.handle     the floating handle
   * @param {Element} options.drawer     the aside (a push starts on it)
   * @param {function} options.enabled   () => whether there is a drawer now (touch, narrow)
   * @param {function} options.isOpen    () => whether the drawer is open
   * @param {function} options.width     () => the drawer's width, px
   * @param {function} options.follow    (shift | null) - a drag's position; null when it ends
   * @param {function} options.settle    (open) - the drawer should end open or shut
   * @param {function} [options.now]     () => ms, for a flick's speed
   */
  function create(doc, options) {
    const settings = options || {};
    const handle = settings.handle;
    const drawer = settings.drawer;
    const enabled = typeof settings.enabled === "function" ? settings.enabled : () => true;
    const isOpen = typeof settings.isOpen === "function" ? settings.isOpen : () => false;
    const width = typeof settings.width === "function" ? settings.width : () => 0;
    const follow = typeof settings.follow === "function" ? settings.follow : () => {};
    const settle = typeof settings.settle === "function" ? settings.settle : () => {};
    const now = typeof settings.now === "function" ? settings.now : () => Date.now();

    let press = null;
    let justHandled = false;
    let spendClick = false;

    function point(event) {
      return { x: Number(event && event.clientX) || 0, y: Number(event && event.clientY) || 0, at: now() };
    }

    function begin(event, source) {
      const w = Math.max(0, Number(width()) || 0);
      const start = point(event);
      press = { pointerId: event.pointerId, source, start, last: start, prev: start, w, from: isOpen() ? 0 : w, shift: null, dragging: false };
      const target = source === "handle" ? handle : drawer;
      if (source === "handle" && typeof target.setPointerCapture === "function") {
        try { target.setPointerCapture(event.pointerId); } catch (error) { /* capture is a courtesy */ }
      }
    }

    function move(event) {
      if (!press || !event || event.pointerId !== press.pointerId) return;
      const at = point(event);
      const dx = at.x - press.start.x;
      const dy = at.y - press.start.y;
      if (!press.dragging) {
        if (Math.hypot(dx, dy) < THRESHOLD) return;
        // On the open drawer only a plainly sideways push to the right is
        // ours; anything else is its own scroll or tap.
        if (press.source === "drawer" && !(dx > 0 && Math.abs(dx) > Math.abs(dy) * 1.5)) { press = null; return; }
        press.dragging = true;
        if (press.source === "drawer" && typeof drawer.setPointerCapture === "function") {
          try { drawer.setPointerCapture(press.pointerId); } catch (error) { /* capture is a courtesy */ }
        }
      }
      press.prev = press.last;
      press.last = at;
      press.shift = clamp(press.from + dx, 0, press.w);
      follow(press.shift);
    }

    function end(event, cancelled) {
      if (!press || !event || event.pointerId !== press.pointerId) return;
      const done = press;
      press = null;
      if (!done.dragging) {
        // A tap on the handle: open or shut. The click that follows is the
        // same tap, so it is not taken twice.
        if (done.source === "handle" && !cancelled) {
          justHandled = true;
          settle(!isOpen());
        }
        return;
      }
      follow(null);
      if (done.source === "drawer") spendClick = true;
      if (cancelled) { settle(isOpen()); return; }
      const elapsed = Math.max(1, done.last.at - done.prev.at);
      const velocity = (done.last.x - done.prev.x) / elapsed;
      settle(settleOpen(done.shift === null ? done.from : done.shift, done.w, velocity, done.from === 0));
    }

    handle.addEventListener("pointerdown", event => {
      if (!event || !enabled() || press) return;
      if (event.button !== undefined && event.button !== 0) return;
      justHandled = false;
      begin(event, "handle");
      if (typeof event.preventDefault === "function") event.preventDefault();
    });
    // The keyboard's Enter and Space arrive as a click alone.
    handle.addEventListener("click", () => {
      if (justHandled) { justHandled = false; return; }
      if (enabled()) settle(!isOpen());
    });
    drawer.addEventListener("pointerdown", event => {
      spendClick = false;
      if (!event || !enabled() || press || !isOpen()) return;
      if (event.button !== undefined && event.button !== 0) return;
      begin(event, "drawer");
    });
    for (const target of [handle, drawer]) {
      target.addEventListener("pointermove", move);
      target.addEventListener("pointerup", event => end(event, false));
      target.addEventListener("pointercancel", event => end(event, true));
    }
    // The click a push released would press whatever was under the finger.
    drawer.addEventListener("click", event => {
      if (!spendClick) return;
      spendClick = false;
      if (event && typeof event.stopPropagation === "function") event.stopPropagation();
      if (event && typeof event.preventDefault === "function") event.preventDefault();
    }, true);

    return Object.freeze({
      active: () => !!(press && press.dragging),
      cancel() { if (press && press.dragging) follow(null); press = null; }
    });
  }

  return Object.freeze({ THRESHOLD, OPEN_FRACTION, FLICK, settleOpen, create });
});
