"use strict";

// Android hardware/gesture Back. Part of the canonical web source (not a
// native-only file) so there is exactly one app to reason about - but it
// must do nothing at all on plain web/GitHub Pages.
//
// No Capacitor script is loaded anywhere in index.html (see the comment
// there): on native Android, Capacitor's own bridge already injects a
// complete window.Capacitor object - including Plugins.App - before any
// page script runs, confirmed empirically (App.addListener works with zero
// vendored Capacitor JS present). On plain web, window.Capacitor simply
// does not exist.
//
// That means existence of window.Capacitor would already be a safe-enough
// native check today, but it's the wrong thing to key off - a future
// change could load some other Capacitor-shaped script for an unrelated
// reason, or a plugin's own web fallback could start behaving differently.
// window.Capacitor.isNativePlatform() is Capacitor's own documented API
// for exactly this question ("is this real native, not just a Capacitor
// global existing") and is what's used here.
//
// All actual Back priority logic (close topmost dialog/sheet, exit Bulk
// Edit, exit Rearrange, Tool->Tools, Help->Help, section->Main) lives in
// app.js's handleAndroidBack() - this file only wires that single function
// to the native backButton event and minimizes the app when it returns
// false. See handleAndroidBack's own comment in app.js for why the logic
// lives there instead of here: it needs this module's real state and real
// close functions, which only app.js has.
(function () {
  function init() {
    const Capacitor = window.Capacitor;
    if (!Capacitor?.isNativePlatform?.()) return;

    const App = Capacitor.Plugins?.App;
    if (!App?.addListener) return;

    App.addListener("backButton", () => {
      if (window.handleAndroidBack?.()) return;
      App.minimizeApp();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
