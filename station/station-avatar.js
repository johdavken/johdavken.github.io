/* Station's profile picture: the small face in the header, beside the name,
 * and the larger picture it opens.
 *
 * WHAT IT IS
 *
 * Identity, in the same sense the name is. A compact profile photo to the
 * left of "Station", one header row tall and no more, that opens a larger
 * view of the same picture under itself when pressed - a popover of the
 * kind the line console opens at the header's other end, holding one image
 * and nothing else. It is not a control over the job, the line or the
 * screen: nothing it does reaches a bridge, and nothing on the stage
 * changes because it is open.
 *
 * THE PICTURES ARE FILES, NOT CSS CROPS
 *
 * Two derived images live in station/assets/: the face alone, cut for the
 * header (station-avatar.jpg, 96px square for a 32px slot on a dense
 * display), and the larger picture the popover shows (station-portrait.jpg,
 * 640x760 for a 320x380 panel). Cropping the whole photograph in place with
 * object-position would have made the header's look depend on the
 * photograph's geometry and fetched the full image for a 32px face. The
 * crops are made once, from the source photograph, with the commands in
 * tools/station-avatar/README.md.
 *
 * WHERE THE FILES ARE
 *
 * Station runs from two documents - station/station.html, and index.html
 * with ?view=station - and the two resolve a relative URL differently. The
 * one thing both have in common is this script's own address, so the assets
 * are resolved from that (document.currentScript, read while the script is
 * executing; both the harness's deferred tag and the host's injected one
 * set it). A host may hand in an `assets` base instead, and the tests do.
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynStationAvatar = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  const FILES = Object.freeze({ avatar: "station-avatar.jpg", portrait: "station-portrait.jpg" });
  /* The rendered sizes: the header's face fits its 52px row with the
   * header's own padding above and below; the portrait is the file at
   * half its pixels, and its box is stated on the element so the panel
   * has its size before the picture has arrived. */
  const AVATAR_SIZE = 32;
  const PORTRAIT = Object.freeze({ width: 320, height: 380 });

  /* The assets directory beside this script, read once as it executes. */
  function assetsBeside(script) {
    const src = script && script.src;
    if (!src) return null;
    try {
      return new URL("assets/", src).href;
    } catch (error) {
      return null;
    }
  }
  const DEFAULT_ASSETS = assetsBeside(root && root.document && root.document.currentScript);

  function element(doc, name, className, attributes) {
    const node = doc.createElement(name);
    if (className) node.setAttribute("class", className);
    if (attributes) {
      for (const key of Object.keys(attributes)) node.setAttribute(key, attributes[key]);
    }
    return node;
  }

  function show(node, on) {
    if (on) node.removeAttribute("hidden");
    else node.setAttribute("hidden", "");
  }

  /* Resolve the two files against an assets base. Pure, and exported, so
   * the resolution both hosts rely on can be tested without a browser. */
  function resolveAssets(base) {
    const prefix = typeof base === "string" && base ? (base.endsWith("/") ? base : `${base}/`) : "";
    return Object.freeze({ avatar: prefix + FILES.avatar, portrait: prefix + FILES.portrait });
  }

  /**
   * Build the avatar.
   *
   * @param {Document} doc
   * @param {object} [options]
   * @param {string} [options.assets]  The assets directory the two files
   *        are read from; by default the one beside this script.
   * @param {function} [options.onOpenChange]  Told when the picture opens
   *        or closes, as the line console tells its host.
   */
  function create(doc, options) {
    const settings = options || {};
    const assets = resolveAssets(typeof settings.assets === "string" ? settings.assets : DEFAULT_ASSETS);
    const state = { open: false };

    const rootEl = element(doc, "div", "station-avatar");

    /* The trigger is the picture itself: a button around the face, named
     * for the reader that cannot see it. The face is decorative to a
     * screen reader - the button's label says what it is. */
    const trigger = element(doc, "button", "station-avatar__trigger", {
      type: "button", "aria-label": "Station's picture", "aria-haspopup": "dialog", "aria-expanded": "false",
      title: "Station"
    });
    trigger.appendChild(element(doc, "img", "station-avatar__face", {
      src: assets.avatar, alt: "", width: String(AVATAR_SIZE), height: String(AVATAR_SIZE), decoding: "async"
    }));
    rootEl.appendChild(trigger);

    /* The larger picture, under the face. A dialog in name so assistive
     * technology announces it as one, focusable so Escape reaches it, and
     * hidden until asked for. The portrait is fetched lazily - the panel
     * is hidden, so the browser leaves the file alone until it is shown -
     * and its box is declared so the panel does not resize on arrival. */
    const panel = element(doc, "div", "station-avatar__panel", {
      role: "dialog", "aria-label": "Station's picture", tabindex: "-1", hidden: ""
    });
    panel.appendChild(element(doc, "img", "station-avatar__portrait", {
      src: assets.portrait, alt: "Station, waving from the floor of the line",
      width: String(PORTRAIT.width), height: String(PORTRAIT.height), loading: "lazy", decoding: "async"
    }));
    rootEl.appendChild(panel);

    /* ---- Open / close ---- */

    function onDocumentPointerDown(event) {
      if (!state.open) return;
      const target = event.target;
      if (target && rootEl.contains && rootEl.contains(target)) return;
      closePanel();
    }

    function openPanel() {
      if (state.open) return;
      state.open = true;
      show(panel, true);
      trigger.setAttribute("aria-expanded", "true");
      rootEl.classList.add("is-open");
      doc.addEventListener("pointerdown", onDocumentPointerDown, true);
      if (typeof panel.focus === "function") panel.focus();
      if (typeof settings.onOpenChange === "function") settings.onOpenChange(true);
    }

    function closePanel() {
      if (!state.open) return;
      state.open = false;
      show(panel, false);
      trigger.setAttribute("aria-expanded", "false");
      rootEl.classList.remove("is-open");
      doc.removeEventListener("pointerdown", onDocumentPointerDown, true);
      if (typeof trigger.focus === "function") trigger.focus();
      if (typeof settings.onOpenChange === "function") settings.onOpenChange(false);
    }

    trigger.addEventListener("click", () => { if (state.open) closePanel(); else openPanel(); });
    /* A press on the picture puts it away: there is nothing in the panel
     * to act on, so the whole of it is the way to close it. */
    panel.addEventListener("click", closePanel);
    /* Escape while the picture is open - on the panel, or on the face if
     * focus is still there - closes it, and is not passed on to close an
     * open layer under it. */
    rootEl.addEventListener("keydown", event => {
      if (event.key !== "Escape" || !state.open) return;
      event.stopPropagation();
      if (event.preventDefault) event.preventDefault();
      closePanel();
    });

    return Object.freeze({
      element: rootEl,
      assets,
      open: openPanel,
      close: closePanel,
      isOpen: () => state.open,
      destroy() {
        if (state.open) closePanel();
      }
    });
  }

  return Object.freeze({ create, resolveAssets, FILES, AVATAR_SIZE, PORTRAIT });
});
