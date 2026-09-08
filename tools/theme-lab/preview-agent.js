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
      themeData: null,
      traceSrc: "/__theme-lab/css-trace.js",
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
      var token = (S.pickToken = (S.pickToken || 0) + 1);
      post("themelab:picked", { info: describe(el), token: token, tracePending: true });
      runTrace(el).then(function (trace) {
        if (token !== S.pickToken) return; // superseded by a newer pick
        post("themelab:picked-trace", { token: token, trace: trace });
      });
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

  // Phase 2: real matched-rule / token-source tracing. Loaded lazily; the
  // parent normally injects it, but pick before it lands and we add it here.
  function ensureTracer() {
    if (window.__themeLabTrace) return Promise.resolve(window.__themeLabTrace);
    return new Promise(function (resolve) {
      var s = document.createElement("script");
      s.src = S.traceSrc;
      s.onload = function () { resolve(window.__themeLabTrace || null); };
      s.onerror = function () { resolve(null); };
      (document.head || document.documentElement).appendChild(s);
      // safety timeout
      setTimeout(function () { resolve(window.__themeLabTrace || null); }, 2500);
    });
  }

  function runTrace(el) {
    return ensureTracer().then(function (tracer) {
      if (!tracer) return { ok: false, error: "tracer unavailable" };
      return tracer.trace(el, { themeTokens: S.themeData }).catch(function (e) {
        return { ok: false, error: String(e && e.message || e) };
      });
    });
  }

  function runImpact(token) {
    return ensureTracer().then(function (tracer) {
      if (!tracer || !tracer.impact) return { ok: false, error: "tracer unavailable" };
      return tracer
        .impact(token, { doc: document, themeTokens: S.themeData })
        .catch(function (e) {
          return { ok: false, error: String((e && e.message) || e) };
        });
    });
  }

  // Translucent boxes over every visible element matching any of `selectors`.
  function highlightSelectors(selectors) {
    clearHighlights();
    if (!selectors || !selectors.length) return 0;
    var host = document.createElement("div");
    host.setAttribute("data-theme-lab", "impact-highlights");
    host.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483645";
    var count = 0;
    selectors.forEach(function (sel) {
      var nodes;
      try {
        nodes = document.querySelectorAll(sel);
      } catch (e) {
        return;
      }
      for (var i = 0; i < nodes.length && count < 300; i += 1) {
        var rects = nodes[i].getClientRects();
        if (!rects.length) continue;
        var r = rects[0];
        var box = document.createElement("div");
        box.style.cssText =
          "position:absolute;left:" + r.left + "px;top:" + r.top + "px;width:" +
          r.width + "px;height:" + r.height +
          "px;background:rgba(240,180,41,.22);outline:2px solid #f0b429;border-radius:2px";
        host.appendChild(box);
        count += 1;
      }
    });
    (document.body || document.documentElement).appendChild(host);
    S.highlightHost = host;
    return count;
  }

  function clearHighlights() {
    if (S.highlightHost && S.highlightHost.parentNode) {
      S.highlightHost.parentNode.removeChild(S.highlightHost);
    }
    S.highlightHost = null;
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
      info.isSvg = true;
    }
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
    // Impact highlight boxes are fixed-position snapshots; drop them on
    // scroll rather than let them drift.
    if (S.highlightHost) {
      clearHighlights();
      post("themelab:highlight-done", { count: 0, reason: "scrolled" });
    }
  }

  function onMessage(e) {
    var d = e.data;
    if (!d || d.source !== "theme-lab") return;
    if (d.type === "themelab:pick") {
      setPicking(!!d.on, false);
      if (!d.on) clearHighlights();
    } else if (d.type === "themelab:ping") {
      post("themelab:ready", {});
    } else if (d.type === "themelab:themeData") {
      S.themeData = d.themeData || null;
      // stylesheets are unchanged, but the active [data-theme] differs, so
      // matched rules differ — the parsed index itself stays valid.
    } else if (d.type === "themelab:impact") {
      var reqId = d.reqId;
      runImpact(d.token).then(function (result) {
        post("themelab:impact-result", { reqId: reqId, token: d.token, result: result });
      });
    } else if (d.type === "themelab:highlight") {
      if (d.clear) {
        clearHighlights();
        post("themelab:highlight-done", { count: 0 });
      } else {
        var n = highlightSelectors(d.selectors || []);
        post("themelab:highlight-done", { count: n });
      }
    }
  }

  if (!S.handlersBound) {
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("message", onMessage, false);
    S.handlersBound = true;
  }

  post("themelab:ready", { first: first });
})();
