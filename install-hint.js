"use strict";

// Home Screen install support. Two separate concerns, both small:
//
//   1. isStandaloneDisplay() - is this an installed app window rather than a
//      browser tab? Exported for anything that later needs to know, and used
//      here to suppress install guidance in an already-installed app.
//   2. A one-time iPhone/iPad hint pointing at Safari's Share > Add to Home
//      Screen, which is the only way to install on iOS: there is no
//      beforeinstallprompt event on iOS and no programmatic install, so this
//      deliberately does not imitate Android's install-prompt pattern.
//
// Part of the canonical web source, like android-back-button.js, so there is
// one app to reason about - but it must do nothing at all inside the native
// Android app, on Android browsers, or on desktop. Every one of those exits
// early below.
(function (root) {
  const DISMISSED_KEY = "polyn.installHint.v1";

  // Installed/standalone window. matchMedia covers the manifest `display`
  // modes used by Chrome/Edge/Safari 17+; navigator.standalone is the older
  // iOS-only flag, still what Home Screen apps report on many iOS versions.
  function isStandaloneDisplay() {
    return !!(
      root.matchMedia?.("(display-mode: standalone)")?.matches ||
      root.matchMedia?.("(display-mode: fullscreen)")?.matches ||
      root.navigator?.standalone === true
    );
  }

  // iPadOS 13+ reports a desktop Mac user agent, so touch points are what
  // separate an iPad from a real Mac - a Mac has maxTouchPoints 0.
  function isIosDevice() {
    const navigatorRef = root.navigator;
    if (!navigatorRef) return false;
    if (/iphone|ipad|ipod/i.test(navigatorRef.userAgent || "")) return true;
    return navigatorRef.platform === "MacIntel" && (navigatorRef.maxTouchPoints || 0) > 1;
  }

  // The native Android shell never shows web install guidance - it is already
  // an installed app. Capacitor's own documented API, same check and same
  // reasoning as android-back-button.js.
  function isNativeApp() {
    return !!root.Capacitor?.isNativePlatform?.();
  }

  function wasDismissed() {
    try {
      return root.localStorage?.getItem(DISMISSED_KEY) === "1";
    } catch {
      // Private mode / blocked storage: showing the hint once per session is
      // better than throwing, and it stays dismissible for this session.
      return false;
    }
  }

  function rememberDismissal() {
    try {
      root.localStorage?.setItem(DISMISSED_KEY, "1");
    } catch { /* best-effort only - dismissal just won't survive a reload */ }
  }

  function shouldShowIosHint() {
    return isIosDevice() && !isNativeApp() && !isStandaloneDisplay() && !wasDismissed();
  }

  // Mirrors .pumpOffAlarmBanner: a fixed bottom notice with a text Dismiss
  // button, which is this app's existing dismiss convention rather than an
  // "X". Not a dialog - it must never block the operator's controls.
  function render(document) {
    if (document.getElementById("installHint")) return null;
    const hint = document.createElement("div");
    hint.className = "installHint";
    hint.id = "installHint";
    hint.setAttribute("role", "note");

    const title = document.createElement("strong");
    title.textContent = "Install Resin.Tools";
    const body = document.createElement("span");
    body.textContent = "Add Resin.Tools to your Home Screen for a full-screen app experience. Safari → Share → Add to Home Screen.";
    const dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.className = "secondary";
    dismiss.textContent = "Dismiss";
    dismiss.addEventListener("click", () => {
      rememberDismissal();
      hint.remove();
    });

    hint.append(title, body, dismiss);
    document.body.appendChild(hint);
    return hint;
  }

  function init() {
    if (!shouldShowIosHint()) return;
    render(root.document);
  }

  if (root.document) {
    if (root.document.readyState === "loading") {
      root.document.addEventListener("DOMContentLoaded", init, { once: true });
    } else {
      init();
    }
  }

  // Narrow export. isStandaloneDisplay is the piece other code may legitimately
  // want later; the rest is this module's own business.
  root.PolynInstallHint = { isStandaloneDisplay, isIosDevice, shouldShowIosHint, DISMISSED_KEY };
})(typeof globalThis !== "undefined" ? globalThis : this);
