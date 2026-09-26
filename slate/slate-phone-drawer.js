/* The phone's drawer: a grip floating at the foot of the screen, and the
 * menu it slides up.
 *
 * On a phone (data-viewport="phone" under touch, slate/slate-tier.js) there
 * is no bar along the foot: Home, the phone's first page, leads to the
 * Recipe, the Timeline and Resin Balance, and everything else - Home again,
 * the tools, Settings, the administrator's sections - is in the rail, laid
 * out as a sheet (components/rail.css). The grip raises it. A tap on the
 * grip opens it; so does a swipe up, the sheet following the finger. The
 * open sheet is swiped back down from anywhere on it once the move is
 * plainly downward and its own list is scrolled to the top; its taps, and
 * its scroll, are left alone, and the click a push releases is spent so it
 * does not also press whatever was under the finger.
 *
 * `follow(shift)` hands the boot where the sheet stands during a drag, in
 * px from open (0) to its height (shut), or null when the drag ends; the
 * boot writes it as a CSS custom property. On release it settles the other
 * way once it has travelled OPEN_FRACTION of its height, or with a flick
 * either way (FLICK px/ms). Nothing here opens or shuts anything itself:
 * `settle(open)` asks the boot, which owns the sheet (slate.js). The grip
 * carries a dot the boot raises while a hopper is overdue (`setDot`), and
 * says whether the sheet is open (`setExpanded`).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynSlatePhoneDrawer = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* Travel before a press is a drag, not a tap. */
  const THRESHOLD = 6;
  /* This much of its height travelled, a released sheet settles the other way. */
  const OPEN_FRACTION = 0.3;
  /* A release faster than this, px per ms, settles the way it was going. */
  const FLICK = 0.4;
  const LABEL = "Menu";

  /** Where a release settles: open or shut, from where it started, where
   *  it stands and how it moved (velocity > 0 is downward). */
  function settleOpen(shift, height, velocity, wasOpen) {
    if (velocity <= -FLICK) return true;
    if (velocity >= FLICK) return false;
    return wasOpen ? shift < height * OPEN_FRACTION : shift <= height * (1 - OPEN_FRACTION);
  }

  function clamp(value, low, high) {
    return Math.min(high, Math.max(low, value));
  }

  function element(doc, name, className, attributes) {
    const node = doc.createElement(name);
    if (className) node.setAttribute("class", className);
    if (attributes) for (const key of Object.keys(attributes)) node.setAttribute(key, attributes[key]);
    return node;
  }

  /**
   * @param {Document} doc
   * @param {object} options
   * @param {Element} options.sheet      the rail, laid out as a sheet
   * @param {function} options.enabled   () => whether there is a drawer now (a phone)
   * @param {function} options.isOpen    () => whether the sheet is open
   * @param {function} options.height    () => the sheet's height, px
   * @param {function} options.follow    (shift | null) - a drag's position; null when it ends
   * @param {function} options.settle    (open) - the sheet should end open or shut
   * @param {function} [options.now]     () => ms, for a flick's speed
   */
  function create(doc, options) {
    const settings = options || {};
    const sheet = settings.sheet;
    const enabled = typeof settings.enabled === "function" ? settings.enabled : () => true;
    const isOpen = typeof settings.isOpen === "function" ? settings.isOpen : () => false;
    const height = typeof settings.height === "function" ? settings.height : () => 0;
    const follow = typeof settings.follow === "function" ? settings.follow : () => {};
    const settle = typeof settings.settle === "function" ? settings.settle : () => {};
    const now = typeof settings.now === "function" ? settings.now : () => Date.now();

    const grip = element(doc, "button", "slate-grip", { type: "button", "aria-haspopup": "dialog", "aria-expanded": "false", "aria-label": LABEL });
    grip.appendChild(element(doc, "span", "slate-grip__bar", { "aria-hidden": "true" }));
    const label = element(doc, "span", "slate-grip__label", { "aria-hidden": "true" });
    label.textContent = LABEL;
    grip.appendChild(label);
    const dot = element(doc, "span", "slate-grip__dot", { "aria-hidden": "true", hidden: "" });
    grip.appendChild(dot);

    let press = null;
    let justHandled = false;
    let spendClick = false;

    function point(event) {
      return { y: Number(event && event.clientY) || 0, x: Number(event && event.clientX) || 0, at: now() };
    }

    function capture(target, pointerId) {
      if (target && typeof target.setPointerCapture === "function") {
        try { target.setPointerCapture(pointerId); } catch (error) { /* capture is a courtesy */ }
      }
    }

    function begin(event, source) {
      const h = Math.max(0, Number(height()) || 0);
      const start = point(event);
      press = { pointerId: event.pointerId, source, start, last: start, prev: start, h, from: isOpen() ? 0 : h, shift: null, dragging: false };
      if (source === "grip") capture(grip, event.pointerId);
    }

    function move(event) {
      if (!press || !event || event.pointerId !== press.pointerId) return;
      const at = point(event);
      const dx = at.x - press.start.x;
      const dy = at.y - press.start.y;
      if (!press.dragging) {
        if (Math.hypot(dx, dy) < THRESHOLD) return;
        // On the open sheet only a plainly downward push from the top of
        // its list is ours; anything else is its own scroll or tap.
        if (press.source === "sheet" && !(dy > 0 && Math.abs(dy) > Math.abs(dx) * 1.5 && !(sheet.scrollTop > 0))) { press = null; return; }
        press.dragging = true;
        if (press.source === "sheet") capture(sheet, press.pointerId);
      }
      press.prev = press.last;
      press.last = at;
      press.shift = clamp(press.from + dy, 0, press.h);
      follow(press.shift);
      if (typeof event.preventDefault === "function") event.preventDefault();
    }

    function end(event, cancelled) {
      if (!press || !event || event.pointerId !== press.pointerId) return;
      const done = press;
      press = null;
      if (!done.dragging) {
        // A tap on the grip: open or shut. The click that follows is the
        // same tap, so it is not taken twice.
        if (done.source === "grip" && !cancelled) {
          justHandled = true;
          settle(!isOpen());
        }
        return;
      }
      follow(null);
      if (done.source === "sheet") spendClick = true;
      if (cancelled) { settle(isOpen()); return; }
      const elapsed = Math.max(1, done.last.at - done.prev.at);
      const velocity = (done.last.y - done.prev.y) / elapsed;
      settle(settleOpen(done.shift === null ? done.from : done.shift, done.h, velocity, done.from === 0));
    }

    grip.addEventListener("pointerdown", event => {
      if (!event || !enabled() || press) return;
      if (event.button !== undefined && event.button !== 0) return;
      justHandled = false;
      begin(event, "grip");
      if (typeof event.preventDefault === "function") event.preventDefault();
    });
    // The keyboard's Enter and Space arrive as a click alone.
    grip.addEventListener("click", () => {
      if (justHandled) { justHandled = false; return; }
      if (enabled()) settle(!isOpen());
    });
    if (sheet) {
      // Scrolled to the top, a downward swipe is the sheet's push, not its
      // scroll: the browser is left only the upward pans there
      // (components/rail.css, is-at-top), so it does not take the touch.
      const paintTop = () => sheet.classList.toggle("is-at-top", !(sheet.scrollTop > 0));
      paintTop();
      sheet.addEventListener("scroll", paintTop);
      sheet.addEventListener("pointerdown", event => {
        spendClick = false;
        if (!event || !enabled() || press || !isOpen()) return;
        if (event.button !== undefined && event.button !== 0) return;
        begin(event, "sheet");
      });
      // The click a push releases is not a press on what was under it.
      sheet.addEventListener("click", event => {
        if (!spendClick) return;
        spendClick = false;
        if (typeof event.preventDefault === "function") event.preventDefault();
        if (typeof event.stopPropagation === "function") event.stopPropagation();
      }, true);
    }
    for (const target of sheet ? [grip, sheet] : [grip]) {
      target.addEventListener("pointermove", move);
      target.addEventListener("pointerup", event => end(event, false));
      target.addEventListener("pointercancel", event => end(event, true));
    }

    function setDot(on) {
      if (on) dot.removeAttribute("hidden");
      else dot.setAttribute("hidden", "");
      grip.classList.toggle("has-dot", !!on);
    }

    function setExpanded(on) {
      grip.setAttribute("aria-expanded", on ? "true" : "false");
    }

    return Object.freeze({ element: grip, setDot, setExpanded });
  }

  return Object.freeze({ THRESHOLD, OPEN_FRACTION, FLICK, settleOpen, create });
});
