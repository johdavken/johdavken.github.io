"use strict";

/* ---------------------------------------------------------------------------
 * Theme Lab — preview agent
 *
 * Injected by theme-lab.js into the live resin.tools preview iframe AFTER the
 * app has loaded. Same-origin (both served by tools/theme-lab/server.js), so
 * this runs in the app's document but is not part of the app: nothing in the
 * repo references it, and it does nothing until Theme Lab sends it a message.
 *
 * Responsibilities (v1):
 *   - element picker: hover highlight + click-to-select, computed colours only
 *   - report back to the parent via postMessage
 *
 * It never mutates app state, never touches localStorage, never calls app
 * functions. Theme switching and token overrides are done by the parent
 * directly on this document (also same-origin); they are not routed here.
 *
 * Written to be safely re-injectable: all state lives on
 * window.__themeLabAgentState and every listener is attached through a single
 * dispatcher keyed off that state, so a second injection just refreshes the
 * behaviour instead of doubling it.
 * ------------------------------------------------------------------------- */

(function () {
  var S = window.__themeLabAgentState;
  var first = !S;
  if (first) {
    S = window.__themeLabAgentState = {
      picking: false,
      overlay: null,
      lastEl: null,
      probe: null,
      handlersBound: false,
    };
  }
  window.__themeLabAgent = true;

  function post(type, extra) {
    var msg = { source: "theme-lab-agent", type: type };
    if (extra) for (var k in extra) msg[k] = extra[k];
    try {
      parent.postMessage(msg, "*");
    } catch (e) {
      /* ignore */
    }
  }

  function ensureOverlay() {
    if (S.overlay && S.overlay.isConnected) return S.overlay;
    var o = document.createElement("div");
    o.setAttribute("data-theme-lab", "overlay");
    var s = o.style;
    s.position = "fixed";
    s.pointerEvents = "none";
    s.zIndex = "2147483647";
    s.border = "2px solid #4aa3ff";
    s.background = "rgba(74,163,255,0.12)";
    s.borderRadius = "2px";
    s.display = "none";
    (document.body || document.documentElement).appendChild(o);
    S.overlay = o;
    return o;
  }

  // A full-viewport transparent layer that swallows all pointer input while
  // picking, so hovering/clicking to inspect never reaches the app. The real
  // target under the cursor is found by momentarily disabling this layer's
  // hit-testing and calling elementFromPoint.
  function ensureCatcher() {
    if (S.catcher && S.catcher.isConnected) return S.catcher;
    var c = document.createElement("div");
    c.setAttribute("data-theme-lab", "catcher");
    var s = c.style;
    s.position = "fixed";
    s.inset = "0";
    s.zIndex = "2147483646";
    s.cursor = "crosshair";
    s.background = "transparent";
    s.display = "none";
    c.addEventListener("mousemove", function (e) {
      if (!S.picking) return;
      positionOverlay(targetAt(e.clientX, e.clientY));
    });
    c.addEventListener("click", function (e) {
      if (!S.picking) return;
      e.preventDefault();
      e.stopPropagation();
      var el = targetAt(e.clientX, e.clientY) || S.lastEl;
      if (!el) return;
      positionOverlay(el);
      post("themelab:picked", { info: describe(el) });
    });
    c.addEventListener("contextmenu", function (e) {
      e.preventDefault();
    });
    (document.body || document.documentElement).appendChild(c);
    S.catcher = c;
    return c;
  }

  function targetAt(x, y) {
    var c = S.catcher;
    var prevPE = c ? c.style.pointerEvents : "";
    var prevOv = S.overlay ? S.overlay.style.display : "";
    if (c) c.style.pointerEvents = "none";
    if (S.overlay) S.overlay.style.display = "none";
    var el = document.elementFromPoint(x, y);
    if (c) c.style.pointerEvents = prevPE || "auto";
    if (S.overlay) S.overlay.style.display = prevOv;
    if (!el || el === S.overlay || el === S.catcher) return null;
    S.lastEl = el;
    return el;
  }

  function positionOverlay(el) {
    var o = ensureOverlay();
    if (!el || !el.getBoundingClientRect) {
      o.style.display = "none";
      return;
    }
    var r = el.getBoundingClientRect();
    o.style.display = "block";
    o.style.left = r.left + "px";
    o.style.top = r.top + "px";
    o.style.width = r.width + "px";
    o.style.height = r.height + "px";
  }

  function normalizeColor(value) {
    if (!value) return "";
    if (!S.probe || !S.probe.isConnected) {
      S.probe = document.createElement("span");
      S.probe.style.display = "none";
      (document.body || document.documentElement).appendChild(S.probe);
    }
    S.probe.style.color = "";
    S.probe.style.color = value;
    return getComputedStyle(S.probe).color || "";
  }

  function guessTokens(cs) {
    var rootCs = getComputedStyle(document.documentElement);
    var names = [
      "--text", "--fg", "--title", "--subtitle", "--muted",
      "--bg", "--panel", "--panel2", "--panelOpen", "--field-bg",
      "--border", "--border2", "--focus-border",
      "--ok", "--bad", "--warn", "--yellow", "--orange",
    ];
    var map = {};
    names.forEach(function (n) {
      var v = rootCs.getPropertyValue(n).trim();
      if (v) map[n] = normalizeColor(v);
    });
    var out = {};
    [["color", "color"], ["backgroundColor", "background"], ["borderTopColor", "border"]].forEach(
      function (pair) {
        var target = normalizeColor(cs[pair[0]]);
        if (!target || target === "rgba(0, 0, 0, 0)") return;
        for (var n in map) {
          if (map[n] && map[n] === target) {
            out[pair[1]] = n;
            break;
          }
        }
      }
    );
    return out;
  }

  function describe(el) {
    var cs = getComputedStyle(el);
    var classes = (
      typeof el.className === "string"
        ? el.className
        : (el.getAttribute && el.getAttribute("class")) || ""
    )
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    var info = {
      tag: el.tagName ? el.tagName.toLowerCase() : "(unknown)",
      id: el.id || null,
      classes: classes,
      text: (el.textContent || "").trim().slice(0, 80),
      computed: {
        color: cs.color,
        backgroundColor: cs.backgroundColor,
        borderColor: cs.borderTopColor,
        borderWidth: cs.borderTopWidth,
        fontSize: cs.fontSize,
        fontWeight: cs.fontWeight,
        boxShadow: cs.boxShadow,
      },
    };
    if (el.namespaceURI === "http://www.w3.org/2000/svg") {
      info.computed.fill = cs.fill;
      info.computed.stroke = cs.stroke;
    }
    info.tokenGuess = guessTokens(cs);
    return info;
  }

  function setPicking(on, notify) {
    S.picking = !!on;
    var c = ensureCatcher();
    var o = ensureOverlay();
    c.style.display = S.picking ? "block" : "none";
    c.style.pointerEvents = S.picking ? "auto" : "none";
    o.style.display = "none";
    if (notify) post("themelab:pickState", { picking: S.picking });
  }

  // ---- single set of DOM handlers, bound once per document ----------------

  function onKey(e) {
    if (S.picking && e.key === "Escape") setPicking(false, true);
  }

  function onScroll() {
    if (S.picking && S.lastEl) positionOverlay(S.lastEl);
  }

  function onMessage(e) {
    var d = e.data;
    if (!d || d.source !== "theme-lab") return;
    if (d.type === "themelab:pick") setPicking(!!d.on, false);
    else if (d.type === "themelab:ping") post("themelab:ready", {});
  }

  if (!S.handlersBound) {
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("message", onMessage, false);
    S.handlersBound = true;
  }

  post("themelab:ready", { first: first });
})();
