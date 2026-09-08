"use strict";

/* ---------------------------------------------------------------------------
 * Theme Lab — controller (developer-only)
 *
 * Two panes: the REAL resin.tools app in an iframe (served from the repo root
 * by server.js, same origin) and a token editor. Edits are held in memory and
 * applied to the preview as inline custom-property overrides on the iframe's
 * <html> element — the source files are never touched until you explicitly
 * export or save.
 * ------------------------------------------------------------------------- */

(function () {
  var API = "/__theme-lab/api";
  var AGENT_SRC = "/__theme-lab/preview-agent.js";
  var TRACE_SRC = "/__theme-lab/css-trace.js";
  var PREVIEW_URL = "/?themelab=1";

  var VIEWPORTS = {
    desktop: { w: 1440, h: 900, label: "1440 \u00d7 900" },
    tablet: { w: 820, h: 1180, label: "820 \u00d7 1180" },
    mobile: { w: 390, h: 844, label: "390 \u00d7 844" },
    flex: { w: 0, h: 0, label: "flexible" },
  };

  // Token -> group. Anything unmatched falls through to a prefix rule, then
  // "Other". Uses the project's real token names; invents nothing.
  var GROUP_RULES = [
    ["Surfaces", ["--bg", "--desktop-canvas-bg", "--panel", "--panel2", "--panelOpen", "--field-bg", "--readonly-bg"]],
    ["Text", ["--text", "--fg", "--title", "--subtitle", "--muted"]],
    ["Borders & interaction", ["--border", "--border2", "--focus-border", "--focus-ring", "--row-border", "--row-border-2", "--readonly-border", "--chev"]],
    ["Semantic", ["--ok", "--bad", "--warn", "--yellow", "--orange", "--f-var1", "--f-var2", "--f-var3", "--f-const"]],
    ["Rows, glow, toggle, footer", ["--row-bg", "--row-bg-2", "--bg-glow-a", "--bg-glow-b", "--card-glow-a", "--card-glow-b", "--toggle-on-bg", "--toggle-on-border", "--footer-bg", "--footer-border"]],
    ["Accents & effects", ["--shadow2", "--recipe-pill-accent", "--recipe-pill-danger", "--workflow-recipe", "--workflow-resin-totals"]],
  ];
  var PREFIX_RULES = [
    ["Buttons & controls", /^--btn-/],
    ["Workflow accents", /^--workflow-/],
    ["Accents & effects", /^--recipe-pill-/],
  ];

  var HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

  var el = {};
  var state = {
    themes: [],
    rootDefaults: {},
    current: null, // theme object
    originals: {}, // token -> { value, inherited }
    working: {}, // token -> new value string
    lockTheme: true,
    picking: false,
    agentReady: false,
  };

  /* --------------------------- boot --------------------------- */

  document.addEventListener("DOMContentLoaded", function () {
    [
      "previewFrame", "frameWrap", "viewportSeg", "viewportDim", "themePicker",
      "lockTheme", "pickBtn", "reloadBtn", "tokenGroups", "tokenFilter",
      "resetAllBtn", "changeCount", "changeSummary", "blockPreview",
      "copyBlockBtn", "downloadBtn", "saveBtn", "inspectResult", "gutter",
      "controlsPane", "toast", "saveDialog", "saveDiff", "saveDialogTheme",
      "saveCancel", "saveConfirm",
      "impactToken", "impactHighlightBtn", "impactResult", "impactThemeName",
    ].forEach(function (id) { el[id] = document.getElementById(id); });

    wireTopbar();
    wireTabs();
    wireGutter();
    wirePreviewFrame();
    wireExport();
    wireImpact();
    window.addEventListener("message", onPreviewMessage);

    loadThemes();
  });

  function loadThemes() {
    fetch(API + "/themes")
      .then(function (r) { return r.json(); })
      .then(function (data) {
        state.themes = data.themes || [];
        state.rootDefaults = data.rootDefaults || {};
        state.themeCssPath = data.themeCssPath || "theme.css";
        el.themePicker.innerHTML = "";
        state.themes.forEach(function (t) {
          var o = document.createElement("option");
          o.value = t.name;
          o.textContent = t.label + (t.touchOnly ? "  (touch-only)" : "");
          el.themePicker.appendChild(o);
        });
        // Prefer whatever the app is actually showing in the preview.
        var appTheme = readPreviewTheme();
        var initial =
          findTheme(appTheme) ||
          findTheme("industrial-slate") ||
          state.themes[0];
        if (initial) {
          el.themePicker.value = initial.name;
          selectTheme(initial.name, { switchPreview: false });
        }
      })
      .catch(function (err) {
        toast("Could not load themes: " + err.message, true);
      });
  }

  function findTheme(name) {
    if (!name) return null;
    for (var i = 0; i < state.themes.length; i += 1) {
      if (state.themes[i].name === name) return state.themes[i];
    }
    return null;
  }

  /* ----------------------- preview iframe ---------------------- */

  function previewDoc() {
    try {
      return el.previewFrame.contentDocument || null;
    } catch (e) {
      return null;
    }
  }

  function readPreviewTheme() {
    var d = previewDoc();
    if (!d) return null;
    return (
      d.documentElement.getAttribute("data-theme") ||
      d.body && d.body.getAttribute("data-theme") ||
      null
    );
  }

  function wirePreviewFrame() {
    el.previewFrame.addEventListener("load", onPreviewLoad);
    el.reloadBtn.addEventListener("click", function () {
      var d = previewDoc();
      if (d) d.location.reload();
      else el.previewFrame.src = PREVIEW_URL;
    });
    // Kick off the first load only now that the listener is attached.
    el.previewFrame.src = PREVIEW_URL;
  }

  function onPreviewLoad() {
    state.agentReady = false;
    injectTracer();
    injectAgent();
    // Re-assert the previewed theme + working overrides after any in-app
    // navigation reload.
    if (state.current) {
      applyPreviewTheme(state.current.name);
      Object.keys(state.working).forEach(function (tok) {
        setOverride(tok, state.working[tok]);
      });
    }
    startThemeGuard();
    // One gentle retry: if the app happened to swap the document out from
    // under the first injection, try once more. The agent is idempotent.
    setTimeout(function () {
      if (!state.agentReady) {
        injectAgent();
        pingAgent();
      }
    }, 700);
  }

  function pingAgent() {
    try {
      el.previewFrame.contentWindow.postMessage(
        { source: "theme-lab", type: "themelab:ping" },
        "*"
      );
    } catch (e) {
      /* ignore */
    }
  }

  function injectAgent() {
    var d = previewDoc();
    if (!d) {
      toast("Preview is cross-origin — cannot inject agent. Serve via server.js.", true);
      return;
    }
    var w = el.previewFrame.contentWindow;
    if (w && w.__themeLabAgent) {
      state.agentReady = true;
      return;
    }
    if (d.getElementById("__themeLabAgent")) return;
    var s = d.createElement("script");
    s.id = "__themeLabAgent";
    s.src = AGENT_SRC;
    (d.head || d.documentElement).appendChild(s);
  }

  function injectTracer() {
    var d = previewDoc();
    if (!d) return;
    var w = el.previewFrame.contentWindow;
    if (w && w.__themeLabTrace) return;
    if (d.getElementById("__themeLabTrace")) return;
    var s = d.createElement("script");
    s.id = "__themeLabTrace";
    s.src = TRACE_SRC;
    (d.head || d.documentElement).appendChild(s);
  }

  // Hand the agent the active theme's per-token source lines (straight from
  // theme-parser.js via /api/themes) so the tracer can resolve palette tokens
  // to their exact theme.css line without re-parsing.
  function sendThemeData() {
    if (!state.current) return;
    var byName = {};
    (state.current.tokens || []).forEach(function (t) {
      byName[t.name] = { value: t.value, line: t.line };
    });
    try {
      el.previewFrame.contentWindow.postMessage(
        {
          source: "theme-lab",
          type: "themelab:themeData",
          themeData: {
            name: state.current.name,
            themeCssPath: state.themeCssPath || "theme.css",
            openLine: state.current.openLine,
            closeLine: state.current.closeLine,
            byName: byName,
          },
        },
        "*"
      );
    } catch (e) {
      /* ignore */
    }
  }

  var guardObserver = null;
  function startThemeGuard() {
    if (guardObserver) guardObserver.disconnect();
    var d = previewDoc();
    if (!d) return;
    guardObserver = new MutationObserver(function () {
      if (!state.lockTheme || !state.current) return;
      var want = state.current.name;
      if (d.documentElement.getAttribute("data-theme") !== want) {
        applyPreviewTheme(want);
      }
    });
    guardObserver.observe(d.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    if (d.body) {
      guardObserver.observe(d.body, {
        attributes: true,
        attributeFilter: ["data-theme"],
      });
    }
  }

  function applyPreviewTheme(name) {
    var d = previewDoc();
    if (!d) return;
    // Set the attribute directly — do NOT go through the app's theme <select>
    // or applyTheme(), so the user's stored preference and localStorage are
    // left alone.
    d.documentElement.setAttribute("data-theme", name);
    if (d.body) d.body.setAttribute("data-theme", name);
  }

  function setOverride(token, value) {
    var d = previewDoc();
    if (!d) return;
    // The palette blocks are `:where(html, body)[data-theme="…"]`, i.e. the
    // tokens are declared directly on BOTH <html> and <body>. A custom
    // property set on <body> by that rule beats one merely inherited from
    // <html>, so the override has to be written to both elements. Inline
    // style still outranks the `:where(...)` selector on each.
    d.documentElement.style.setProperty(token, value);
    if (d.body) d.body.style.setProperty(token, value);
  }

  function clearOverride(token) {
    var d = previewDoc();
    if (!d) return;
    d.documentElement.style.removeProperty(token);
    if (d.body) d.body.style.removeProperty(token);
  }

  /* -------------------------- topbar -------------------------- */

  function wireTopbar() {
    el.viewportSeg.addEventListener("click", function (e) {
      var b = e.target.closest("button[data-vp]");
      if (!b) return;
      setViewport(b.getAttribute("data-vp"));
    });
    setViewport("desktop");

    el.themePicker.addEventListener("change", function () {
      selectTheme(el.themePicker.value, { switchPreview: true });
    });

    el.lockTheme.addEventListener("change", function () {
      state.lockTheme = el.lockTheme.checked;
      if (state.lockTheme && state.current) applyPreviewTheme(state.current.name);
    });

    el.pickBtn.addEventListener("click", function () {
      setPicking(!state.picking);
    });
  }

  function setViewport(name) {
    var vp = VIEWPORTS[name] || VIEWPORTS.desktop;
    Array.prototype.forEach.call(
      el.viewportSeg.querySelectorAll("button"),
      function (b) { b.classList.toggle("is-active", b.getAttribute("data-vp") === name); }
    );
    el.viewportDim.textContent = vp.label;
    if (name === "flex") {
      el.frameWrap.classList.add("is-flex");
      el.frameWrap.style.width = "";
      el.frameWrap.style.height = "";
    } else {
      el.frameWrap.classList.remove("is-flex");
      el.frameWrap.style.width = vp.w + "px";
      el.frameWrap.style.height = vp.h + "px";
    }
  }

  /* --------------------- theme selection --------------------- */

  function selectTheme(name, opts) {
    var theme = findTheme(name);
    if (!theme) return;

    // Discard the previous theme's working set from the preview.
    Object.keys(state.working).forEach(clearOverride);
    state.working = {};

    state.current = theme;
    state.originals = {};
    theme.tokens.forEach(function (t) {
      state.originals[t.name] = { value: t.value, inherited: false };
    });
    // Show inherited base values (styles.css :root) for tokens the palette
    // does not declare, read-only-ish context.
    Object.keys(state.rootDefaults).forEach(function (tok) {
      if (!(tok in state.originals)) {
        state.originals[tok] = { value: state.rootDefaults[tok], inherited: true };
      }
    });

    if (!opts || opts.switchPreview !== false) applyPreviewTheme(name);
    sendThemeData();
    renderTokens();
    renderChanges();
    populateImpactTokens();
  }

  /* ---------------------- token editor ---------------------- */

  function groupFor(token) {
    for (var i = 0; i < GROUP_RULES.length; i += 1) {
      if (GROUP_RULES[i][1].indexOf(token) !== -1) return GROUP_RULES[i][0];
    }
    for (var j = 0; j < PREFIX_RULES.length; j += 1) {
      if (PREFIX_RULES[j][1].test(token)) return PREFIX_RULES[j][0];
    }
    return "Other";
  }

  function currentValue(token) {
    if (token in state.working) return state.working[token];
    return state.originals[token] ? state.originals[token].value : "";
  }

  function renderTokens() {
    var filter = (el.tokenFilter.value || "").trim().toLowerCase();
    var groups = {};
    var order = [];

    // Palette-declared tokens first, in source order; then inherited ones.
    var names = state.current.tokens.map(function (t) { return t.name; });
    Object.keys(state.originals).forEach(function (n) {
      if (names.indexOf(n) === -1) names.push(n);
    });

    names.forEach(function (name) {
      if (filter && name.toLowerCase().indexOf(filter) === -1) return;
      var g = groupFor(name);
      if (!groups[g]) { groups[g] = []; order.push(g); }
      groups[g].push(name);
    });

    var groupSort = GROUP_RULES.map(function (r) { return r[0]; })
      .concat(["Buttons & controls", "Workflow accents", "Other"]);
    order.sort(function (a, b) {
      var ia = groupSort.indexOf(a), ib = groupSort.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });

    el.tokenGroups.innerHTML = "";
    if (!order.length) {
      el.tokenGroups.innerHTML = '<p class="lab-empty">No tokens match.</p>';
      return;
    }
    order.forEach(function (gName) {
      var wrap = document.createElement("div");
      wrap.className = "lab-token-group";
      var h = document.createElement("h3");
      h.textContent = gName;
      wrap.appendChild(h);
      groups[gName].forEach(function (name) {
        wrap.appendChild(renderTokenRow(name));
      });
      el.tokenGroups.appendChild(wrap);
    });
  }

  function renderTokenRow(name) {
    var meta = state.originals[name] || { value: "", inherited: false };
    var value = currentValue(name);
    var changed = name in state.working;

    var row = document.createElement("div");
    row.className = "tok" + (changed ? " is-changed" : "");
    row.dataset.token = name;

    // swatch (+ colour picker when the value is a plain hex)
    var swatch = document.createElement("label");
    swatch.className = "tok-swatch" + (HEX_RE.test(value) ? "" : " no-picker");
    var fill = document.createElement("span");
    fill.style.background = safeCssColor(value);
    swatch.appendChild(fill);
    var picker = document.createElement("input");
    picker.type = "color";
    if (HEX_RE.test(value)) picker.value = toHex6(value);
    picker.addEventListener("input", function () {
      applyEdit(name, picker.value);
      var f = row.querySelector(".tok-value");
      if (f) f.value = picker.value;
    });
    swatch.appendChild(picker);
    row.appendChild(swatch);

    // name + value field
    var main = document.createElement("div");
    main.className = "tok-main";
    var nm = document.createElement("div");
    nm.className = "tok-name";
    var nameBtn = document.createElement("button");
    nameBtn.type = "button";
    nameBtn.className = "tok-name-btn";
    nameBtn.textContent = name;
    nameBtn.title = "Show where " + name + " is used (Impact tab)";
    nameBtn.addEventListener("click", function () {
      activateTab("impact");
      runImpact(name);
    });
    nm.appendChild(nameBtn);
    if (meta.inherited) {
      var badge = document.createElement("span");
      badge.className = "tok-inherit";
      badge.textContent = "inherited";
      badge.title = "Not declared by this palette — value comes from styles.css :root";
      nm.appendChild(badge);
    }
    main.appendChild(nm);

    var input = document.createElement("input");
    input.className = "tok-value" + (changed ? " is-changed" : "");
    input.type = "text";
    input.spellcheck = false;
    input.value = value;
    input.addEventListener("input", function () {
      applyEdit(name, input.value);
    });
    main.appendChild(input);
    row.appendChild(main);

    // reset
    var actions = document.createElement("div");
    actions.className = "tok-actions";
    var reset = document.createElement("button");
    reset.className = "tok-reset";
    reset.type = "button";
    reset.title = "Reset this token";
    reset.textContent = "\u21ba";
    reset.addEventListener("click", function () { resetToken(name); });
    actions.appendChild(reset);
    row.appendChild(actions);

    return row;
  }

  function applyEdit(name, rawValue) {
    var value = String(rawValue);
    var original = state.originals[name] ? state.originals[name].value : "";
    var row = el.tokenGroups.querySelector('.tok[data-token="' + cssEscape(name) + '"]');
    var field = row && row.querySelector(".tok-value");

    var invalid = value.trim() === "" || /[{};]/.test(value) || value.length > 400;
    if (field) field.classList.toggle("is-invalid", invalid);
    if (invalid) return;

    if (value === original) {
      delete state.working[name];
      clearOverride(name);
      // Let the palette's own rule take back over.
    } else {
      state.working[name] = value;
      setOverride(name, value);
    }
    refreshRowState(name);
    renderChanges();
  }

  function refreshRowState(name) {
    var row = el.tokenGroups.querySelector('.tok[data-token="' + cssEscape(name) + '"]');
    if (!row) return;
    var changed = name in state.working;
    row.classList.toggle("is-changed", changed);
    var field = row.querySelector(".tok-value");
    if (field) field.classList.toggle("is-changed", changed);
    var fill = row.querySelector(".tok-swatch > span");
    if (fill) fill.style.background = safeCssColor(currentValue(name));
    var sw = row.querySelector(".tok-swatch");
    var pick = row.querySelector('input[type="color"]');
    var v = currentValue(name);
    if (sw && pick) {
      sw.classList.toggle("no-picker", !HEX_RE.test(v));
      if (HEX_RE.test(v)) pick.value = toHex6(v);
    }
  }

  function resetToken(name) {
    delete state.working[name];
    clearOverride(name);
    var row = el.tokenGroups.querySelector('.tok[data-token="' + cssEscape(name) + '"]');
    if (row) {
      var field = row.querySelector(".tok-value");
      if (field) {
        field.value = state.originals[name] ? state.originals[name].value : "";
        field.classList.remove("is-invalid");
      }
    }
    refreshRowState(name);
    renderChanges();
  }

  function resetAll() {
    Object.keys(state.working).forEach(clearOverride);
    state.working = {};
    renderTokens();
    renderChanges();
  }

  /* ----------------------- changes view ---------------------- */

  function renderChanges() {
    var names = Object.keys(state.working);
    el.changeCount.textContent = String(names.length);
    var has = names.length > 0;
    el.resetAllBtn.disabled = !has;
    el.copyBlockBtn.disabled = !has;
    el.downloadBtn.disabled = !has;
    el.saveBtn.disabled = !has || !state.current;

    if (!has) {
      el.changeSummary.innerHTML = '<p class="lab-empty">No token changes yet.</p>';
      el.blockPreview.textContent = "";
      return;
    }

    var declared = {};
    (state.current.tokens || []).forEach(function (t) { declared[t.name] = true; });

    el.changeSummary.innerHTML = "";
    names.sort().forEach(function (name) {
      var from = state.originals[name] ? state.originals[name].value : "(unset)";
      var to = state.working[name];
      var d = document.createElement("div");
      d.className = "chg";
      var n = document.createElement("div");
      n.className = "chg-name";
      n.textContent = name;
      if (!declared[name]) {
        var tag = document.createElement("span");
        tag.className = "chg-new";
        tag.textContent = "will be added to block";
        n.appendChild(tag);
      }
      var delta = document.createElement("div");
      delta.className = "chg-delta";
      delta.innerHTML =
        escapeHtml(from) + '<span class="arrow">\u2192</span>' + escapeHtml(to);
      d.appendChild(n);
      d.appendChild(delta);
      el.changeSummary.appendChild(d);
    });

    el.blockPreview.textContent = buildUpdatedBlock();
  }

  // Reconstruct the palette block text with working values substituted, from
  // the raw source the API returned. Mirrors the server's conservative
  // line-level rewrite so the preview matches what Save would write.
  function buildUpdatedBlock() {
    var raw = state.current.raw || "";
    var lines = raw.split("\n");
    var handled = {};
    var declRe = /^(\s*(--[A-Za-z0-9_-]+)\s*:\s*)([^;]+?)(\s*;.*)$/;
    for (var i = 0; i < lines.length; i += 1) {
      var m = lines[i].match(declRe);
      if (!m) continue;
      var tok = m[2];
      if (tok in state.working) {
        lines[i] = m[1] + state.working[tok] + m[4];
        handled[tok] = true;
      }
    }
    var added = Object.keys(state.working).filter(function (t) { return !handled[t]; });
    if (added.length) {
      var ins = added.map(function (t) { return "  " + t + ": " + state.working[t] + ";"; });
      lines.splice(lines.length - 1, 0, ...ins);
    }
    return lines.join("\n");
  }

  /* ------------------------- export ------------------------- */

  function wireExport() {
    el.tokenFilter.addEventListener("input", renderTokens);
    el.resetAllBtn.addEventListener("click", resetAll);

    el.copyBlockBtn.addEventListener("click", function () {
      var text = buildUpdatedBlock();
      navigator.clipboard.writeText(text).then(
        function () { toast("Updated block copied to clipboard."); },
        function () { toast("Clipboard blocked — use Download instead.", true); }
      );
    });

    el.downloadBtn.addEventListener("click", function () {
      var text =
        "/* Theme Lab export \u2014 " + state.current.name + " \u2014 " +
        new Date().toISOString() + " */\n" + buildUpdatedBlock() + "\n";
      var blob = new Blob([text], { type: "text/css" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "theme-lab-" + state.current.name + ".css";
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    });

    el.saveBtn.addEventListener("click", openSaveDialog);
    el.saveCancel.addEventListener("click", closeSaveDialog);
    el.saveDialog.addEventListener("click", function (e) {
      if (e.target === el.saveDialog) closeSaveDialog();
    });
    el.saveConfirm.addEventListener("click", confirmSave);
  }

  function openSaveDialog() {
    if (!Object.keys(state.working).length) return;
    el.saveDialogTheme.textContent =
      ':where(html, body)[data-theme="' + state.current.name + '"]';
    el.saveDiff.textContent = "Requesting preview\u2026";
    el.saveDialog.hidden = false;
    postSave(false)
      .then(function (res) {
        if (!res.ok) { el.saveDiff.textContent = "Error: " + res.error; return; }
        el.saveDiff.textContent = res.diff || "(no textual change)";
      })
      .catch(function (err) { el.saveDiff.textContent = "Error: " + err.message; });
  }

  function closeSaveDialog() { el.saveDialog.hidden = true; }

  function confirmSave() {
    el.saveConfirm.disabled = true;
    postSave(true)
      .then(function (res) {
        el.saveConfirm.disabled = false;
        if (!res.ok) { toast("Save failed: " + res.error, true); return; }
        closeSaveDialog();
        toast(
          "Saved. Backup: " + res.backup +
          (res.newTokens && res.newTokens.length
            ? "  (added: " + res.newTokens.join(", ") + ")" : "")
        );
        // Fold the saved values into originals; the working set is now clean.
        Object.keys(state.working).forEach(function (tok) {
          state.originals[tok] = { value: state.working[tok], inherited: false };
        });
        state.working = {};
        // Refresh the palette's raw/token data so further edits diff correctly.
        loadThemesKeepSelection();
      })
      .catch(function (err) {
        el.saveConfirm.disabled = false;
        toast("Save failed: " + err.message, true);
      });
  }

  function loadThemesKeepSelection() {
    var keep = state.current && state.current.name;
    fetch(API + "/themes")
      .then(function (r) { return r.json(); })
      .then(function (data) {
        state.themes = data.themes || [];
        state.rootDefaults = data.rootDefaults || {};
        var t = findTheme(keep);
        if (t) {
          state.current = t;
          renderTokens();
          renderChanges();
        }
      });
  }

  function postSave(confirm) {
    return fetch(API + "/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        theme: state.current.name,
        changes: state.working,
        dryRun: !confirm,
        confirm: !!confirm,
      }),
    }).then(function (r) { return r.json(); });
  }

  /* ----------------------- element picker ------------------- */

  function setPicking(on) {
    state.picking = !!on;
    el.pickBtn.classList.toggle("is-active", state.picking);
    el.pickBtn.textContent = state.picking ? "Stop selecting" : "Select element";
    document.getElementById("app").classList.toggle("is-picking", state.picking);
    el.previewFrame.contentWindow.postMessage(
      { source: "theme-lab", type: "themelab:pick", on: state.picking }, "*"
    );
    if (state.picking) activateTab("inspect");
  }

  function onPreviewMessage(e) {
    var d = e.data;
    if (!d || d.source !== "theme-lab-agent") return;
    if (d.type === "themelab:ready") {
      state.agentReady = true;
      sendThemeData();
    } else if (d.type === "themelab:pickState") {
      if (!d.picking && state.picking) setPicking(false);
    } else if (d.type === "themelab:picked") {
      state.lastPick = { info: d.info, token: d.token, trace: null, tracePending: !!d.tracePending };
      renderInspect();
    } else if (d.type === "themelab:picked-trace") {
      if (state.lastPick && state.lastPick.token === d.token) {
        state.lastPick.trace = d.trace;
        state.lastPick.tracePending = false;
        renderInspect();
      }
    } else if (d.type === "themelab:impact-result") {
      if (state.impact && state.impact.reqId === d.reqId) {
        state.impact.result = d.result;
        state.impact.pending = false;
        renderImpact();
      }
    } else if (d.type === "themelab:highlight-done") {
      if (el.impactHighlightBtn) {
        el.impactHighlightBtn.textContent =
          d.count > 0 ? "Clear highlight (" + d.count + ")" : "Highlight on screen";
        state.impactHighlighting = d.count > 0;
      }
    }
  }

  function swatch(val) {
    var v = String(val || "").trim();
    if (!/rgb|#|hsl|hwb|lab|lch|oklab|oklch/i.test(v)) return "";
    var pick = v.split(/\s+/).filter(function (x) {
      return /^#|rgb|hsl|hwb|lab|lch|oklab|oklch/i.test(x);
    })[0] || v;
    return '<span class="mini-swatch" style="background:' + escapeHtml(pick) + '"></span>';
  }

  var CLASS_LABEL = {
    "token-driven": "token-driven",
    "theme-specific-override": "theme-specific override",
    hardcoded: "hardcoded",
    inline: "inline style",
    unresolved: "unresolved",
  };

  function renderTraceProperty(key, p) {
    var title = { color: "Text colour", background: "Background", border: "Border colour", fill: "Fill", stroke: "Stroke" }[key] || key;
    var h = '<section class="trace-prop">';
    h += "<h4>" + title + "</h4>";
    h += '<div class="trace-computed">' + swatch(p.computed) + escapeHtml(p.computed || "\u2014") + "</div>";

    if (!p.matched) {
      h += '<p class="lab-hint">' + escapeHtml(p.note || "No authored rule \u2014 inherited or UA default.") + "</p>";
      return h + "</section>";
    }

    var w = p.winning;
    var cls = (p.classification && p.classification.kind) || "?";
    h += '<div class="trace-badge trace-' + escapeHtml(cls) + '">' + escapeHtml(CLASS_LABEL[cls] || cls) + "</div>";
    h += '<dl class="trace-dl">';
    h += "<dt>Winning rule</dt><dd>" + escapeHtml(w.selector) + (w.important ? ' <span class="trace-imp">!important</span>' : "") + "</dd>";
    h += "<dt>Source</dt><dd>" + escapeHtml(w.file) + ":" + w.line + "</dd>";
    if (w.media && w.media.length) h += "<dt>Media</dt><dd>" + escapeHtml(w.media.join(" / ")) + "</dd>";
    h += "<dt>Declaration</dt><dd><code>" + escapeHtml(w.declaration) + "</code></dd>";
    h += "</dl>";

    if (p.chain && p.chain.length) {
      h += '<ol class="trace-chain">';
      p.chain.forEach(function (link) {
        var s = link.source || {};
        var loc = s.file ? s.file + ":" + s.line : (s.where || s.kind || "");
        var kindNote =
          s.kind === "palette-block"
            ? (s.paletteName ? s.paletteName + " palette block" : "palette block")
            : s.kind === "theme-scoped-rule"
            ? "theme-scoped rule"
            : s.kind === "root-default"
            ? ":root default"
            : s.kind === "component-rule"
            ? "component/base rule"
            : s.kind === "inline"
            ? (s.isPreviewOverride ? "Theme Lab preview override (inline)" : s.where || "inline")
            : s.kind === "fallback"
            ? "var() fallback"
            : s.kind || "";
        h += "<li>";
        h += "<code>var(" + escapeHtml(link.ref) + ")</code>";
        if (link.value != null) {
          h += ' &rarr; ' + swatch(link.value) + "<code>" + escapeHtml(link.value) + "</code>";
        } else {
          h += ' &rarr; <em>unresolved</em>';
        }
        if (loc) h += ' <span class="trace-loc">(' + escapeHtml(loc) + (kindNote ? ", " + escapeHtml(kindNote) : "") + ")</span>";
        if (s.selector && s.kind !== "inline") h += ' <span class="trace-loc">' + escapeHtml(s.selector) + "</span>";
        if (link.usedFallback) h += ' <span class="trace-loc">\u2014 fallback used (token undefined)</span>';
        (link.overridden || []).forEach(function (ov) {
          h += '<div class="trace-overridden">overrides <code>' + escapeHtml(link.ref) + ": " + escapeHtml(ov.value || "") +
            "</code> <span class=\"trace-loc\">(" + escapeHtml((ov.file || "") + (ov.line ? ":" + ov.line : "")) +
            (ov.themeScoped ? ", theme-scoped" : "") + ")</span></div>";
        });
        h += "</li>";
      });
      h += "</ol>";
    }

    var cl = p.classification || {};
    if (cl.summary) {
      h += '<p class="trace-summary">' + escapeHtml(cl.summary) + "</p>";
    }
    if (cl.componentTokenOverride) {
      var cto = cl.componentTokenOverride;
      h += '<p class="trace-summary trace-warn">Base <code>' + escapeHtml(cto.token) + ": " + escapeHtml(cto.baseValue) +
        "</code> at " + escapeHtml(cto.baseFile + ":" + cto.baseLine) + " is overridden by <code>" +
        escapeHtml(cto.token) + ": " + escapeHtml(cto.overrideValue) + "</code> at " +
        escapeHtml(cto.overrideFile + ":" + cto.overrideLine) + ".</p>";
    }
    return h + "</section>";
  }

  function renderInspect() {
    var pick = state.lastPick;
    if (!pick) { el.inspectResult.innerHTML = '<p class="lab-empty">Nothing selected.</p>'; return; }
    var info = pick.info || {};
    var c = info.computed || {};

    var html = '<dl class="trace-identity">';
    html += "<dt>tag</dt><dd>" + escapeHtml(info.tag || "?") + (info.isSvg ? " <span class=\"trace-loc\">(SVG)</span>" : "") + "</dd>";
    html += "<dt>id</dt><dd>" + escapeHtml(info.id || "\u2014") + "</dd>";
    html += "<dt>classes</dt><dd>" + escapeHtml((info.classes || []).join(" ") || "\u2014") + "</dd>";
    html += "<dt>text</dt><dd>" + escapeHtml(info.text || "\u2014") + "</dd>";
    html += "<dt>font</dt><dd>" + escapeHtml((c.fontWeight || "") + " " + (c.fontSize || "")) + "</dd>";
    if (c.boxShadow && c.boxShadow !== "none") html += "<dt>box-shadow</dt><dd>" + escapeHtml(c.boxShadow) + "</dd>";
    html += "</dl>";

    var trace = pick.trace;
    if (pick.tracePending && !trace) {
      html += '<p class="lab-hint">Tracing the cascade\u2026</p>';
      el.inspectResult.innerHTML = html;
      return;
    }
    if (trace && trace.ok === false) {
      html += '<p class="lab-hint">Trace unavailable: ' + escapeHtml(trace.error || "?") + ". Computed values only.</p>";
      html += legacyComputedDl(c, info);
      el.inspectResult.innerHTML = html;
      return;
    }
    if (trace && trace.substituted && trace.subject) {
      html +=
        '<p class="trace-substituted">Clicked <code>' +
        escapeHtml(trace.clicked ? trace.clicked.hint : (info.tag || "?")) +
        "</code> has no authored colour rules of its own. Showing <code>" +
        escapeHtml(trace.subject.hint) + "</code> \u2014 " +
        trace.ancestorDepth + " level" + (trace.ancestorDepth === 1 ? "" : "s") +
        " up.</p>";
    }
    if (trace && trace.properties) {
      var isSvg = !!(trace.properties.fill || trace.properties.stroke);
      var order = isSvg ? ["fill", "stroke", "color"] : ["color", "background", "border"];
      order.forEach(function (k) {
        if (trace.properties[k]) html += renderTraceProperty(k, trace.properties[k]);
      });
      if (trace.indexErrors && trace.indexErrors.length) {
        html += '<p class="lab-hint">Note: ' + trace.indexErrors.length + " stylesheet(s) could not be parsed for tracing.</p>";
      }
      html += '<p class="lab-hint">Sheets indexed: ' + escapeHtml((trace.sheets || []).join(", ")) + "</p>";
    }
    el.inspectResult.innerHTML = html;
  }

  function legacyComputedDl(c, info) {
    var rows = [["color", c.color], ["background", c.backgroundColor], ["border", (c.borderWidth || "") + " " + (c.borderColor || "")]];
    if (info.isSvg) { rows.push(["fill", c.fill]); rows.push(["stroke", c.stroke]); }
    var h = '<dl class="trace-dl">';
    rows.forEach(function (r) { h += "<dt>" + r[0] + "</dt><dd>" + swatch(r[1]) + escapeHtml(String(r[1] || "\u2014")) + "</dd>"; });
    return h + "</dl>";
  }

  /* -------------- impact / token -> used-by (Phase 3B) ------------- */

  function wireImpact() {
    el.impactToken.addEventListener("change", function () {
      runImpact(el.impactToken.value);
    });
    el.impactHighlightBtn.addEventListener("click", function () {
      if (state.impactHighlighting) {
        postAgent({ type: "themelab:highlight", clear: true });
        return;
      }
      var sels = collectImpactSelectors();
      if (!sels.length) return;
      postAgent({ type: "themelab:highlight", selectors: sels });
    });
  }

  function postAgent(msg) {
    try {
      msg.source = "theme-lab";
      el.previewFrame.contentWindow.postMessage(msg, "*");
    } catch (e) { /* ignore */ }
  }

  function populateImpactTokens() {
    if (!el.impactToken) return;
    var prev = el.impactToken.value;
    var names = Object.keys(state.originals || {}).sort();
    el.impactToken.innerHTML =
      '<option value="">\u2014 select a token \u2014</option>' +
      names
        .map(function (n) {
          return '<option value="' + escapeHtml(n) + '">' + escapeHtml(n) + "</option>";
        })
        .join("");
    if (prev && names.indexOf(prev) !== -1) el.impactToken.value = prev;
    if (el.impactThemeName && state.current) el.impactThemeName.textContent = state.current.name;
  }

  function runImpact(token) {
    if (!token) {
      state.impact = null;
      el.impactResult.innerHTML = '<p class="lab-empty">Pick a token.</p>';
      el.impactHighlightBtn.disabled = true;
      return;
    }
    var reqId = (state.impactReq = (state.impactReq || 0) + 1);
    state.impact = { token: token, reqId: reqId, pending: true, result: null };
    el.impactHighlightBtn.disabled = true;
    if (el.impactToken.value !== token) el.impactToken.value = token;
    el.impactResult.innerHTML =
      '<p class="lab-hint">Scanning stylesheets for consumers of <code>' +
      escapeHtml(token) + "</code>\u2026</p>";
    postAgent({ type: "themelab:impact", token: token, reqId: reqId });
  }

  function collectImpactSelectors() {
    var r = state.impact && state.impact.result;
    if (!r || !r.ok) return [];
    var out = [];
    (r.direct || []).forEach(function (g) { out = out.concat(g.selectors || []); });
    (r.via || []).forEach(function (v) {
      if (v.routes) (v.consumers || []).forEach(function (g) { out = out.concat(g.selectors || []); });
    });
    return out;
  }

  function consumerGroupHtml(g) {
    var h = '<div class="impact-consumer">';
    h += '<div class="impact-decl"><code>' + escapeHtml(g.declaration) + "</code>" +
      (g.important ? ' <span class="trace-imp">!important</span>' : "") + "</div>";
    h += '<div class="impact-loc">' + escapeHtml(g.file + ":" + g.line);
    if (g.media && g.media.length) h += " \u00b7 " + escapeHtml(g.media.join(" / "));
    h += "</div>";
    h += '<div class="impact-selectors">';
    g.selectors.slice(0, 8).forEach(function (s) {
      h += "<code>" + escapeHtml(s) + "</code>";
    });
    if (g.selectors.length > 8) h += "<span class=\"trace-loc\">+" + (g.selectors.length - 8) + " more</span>";
    h += "</div>";
    var live = g.liveVisible || 0;
    h += '<div class="impact-live">' +
      (live > 0
        ? "<strong>" + live + "</strong> visible on screen now"
        : (g.liveTotal ? g.liveTotal + " in DOM, none visible" : "none in DOM right now")) +
      "</div>";
    h += "</div>";
    return h;
  }

  function directGroupSplit(groups) {
    var onScreen = [];
    var offScreen = [];
    (groups || []).forEach(function (g) {
      (g.liveVisible > 0 ? onScreen : offScreen).push(g);
    });
    onScreen.sort(function (a, b) { return b.liveVisible - a.liveVisible; });
    return { onScreen: onScreen, offScreen: offScreen };
  }

  function renderImpact() {
    var st = state.impact;
    if (!st) { el.impactResult.innerHTML = '<p class="lab-empty">Pick a token.</p>'; return; }
    if (st.pending) return;
    var r = st.result;
    if (!r || r.ok === false) {
      el.impactResult.innerHTML =
        '<p class="lab-hint">Impact scan failed: ' + escapeHtml((r && r.error) || "?") + "</p>";
      return;
    }

    var h = '<div class="impact-head"><code>' + escapeHtml(r.token) + "</code> in <strong>" +
      escapeHtml(r.theme) + "</strong></div>";

    var totalVisible = 0;
    (r.direct || []).forEach(function (g) { totalVisible += g.liveVisible || 0; });
    (r.via || []).forEach(function (v) {
      if (v.routes) (v.consumers || []).forEach(function (g) { totalVisible += g.liveVisible || 0; });
    });

    var split = directGroupSplit(r.direct);
    h += '<h4 class="impact-h">Direct consumers <span class="lab-count">' + (r.direct || []).length + "</span></h4>";
    if (!(r.direct || []).length) {
      h += '<p class="lab-hint">No rule references <code>var(' + escapeHtml(r.token) + ")</code> directly in this theme.</p>";
    } else {
      if (split.onScreen.length) {
        h += '<p class="impact-sub">On screen now (' + split.onScreen.length + " rule group" +
          (split.onScreen.length === 1 ? "" : "s") + "):</p>";
        split.onScreen.forEach(function (g) { h += consumerGroupHtml(g); });
      }
      if (split.offScreen.length) {
        h += '<details class="impact-more"><summary>' + split.offScreen.length +
          " more rule group" + (split.offScreen.length === 1 ? "" : "s") +
          " in this theme (not on screen right now)</summary>";
        split.offScreen.forEach(function (g) { h += consumerGroupHtml(g); });
        h += "</details>";
      }
    }

    var routing = (r.via || []).filter(function (v) { return v.routes && (v.consumers || []).length; });
    var notRouting = (r.via || []).filter(function (v) { return !v.routes; });

    if (routing.length) {
      h += '<h4 class="impact-h">Via component token — currently routing <span class="lab-count">' + routing.length + "</span></h4>";
      routing.forEach(function (v) {
        h += '<div class="impact-via"><div class="impact-chainpath">' +
          v.through.map(function (t) { return "<code>" + escapeHtml(t) + "</code>"; }).join(" &larr; ") +
          "</div>";
        var vs = directGroupSplit(v.consumers);
        vs.onScreen.forEach(function (g) { h += consumerGroupHtml(g); });
        if (vs.offScreen.length) {
          h += '<details class="impact-more"><summary>' + vs.offScreen.length + " more (off screen)</summary>";
          vs.offScreen.forEach(function (g) { h += consumerGroupHtml(g); });
          h += "</details>";
        }
        h += "</div>";
      });
    }

    if (notRouting.length) {
      h += '<h4 class="impact-h impact-h-muted">Via component token — NOT routing in this theme <span class="lab-count">' + notRouting.length + "</span></h4>";
      notRouting.forEach(function (v) {
        var b = v.blockedBy;
        h += '<div class="impact-via impact-blocked"><div class="impact-chainpath">' +
          v.through.map(function (t) { return "<code>" + escapeHtml(t) + "</code>"; }).join(" &larr; ") +
          "</div>";
        var reason;
        if (b) {
          reason = "<code>" + escapeHtml(b.token) + "</code> is redefined to <code>" +
            escapeHtml(b.value) + "</code> at " + escapeHtml(b.file + ":" + b.line) +
            " (" + escapeHtml(b.kind) + ")";
        } else if (v.unresolvedAtScope) {
          reason = "<code>" + escapeHtml(v.through[v.through.length - 1]) +
            "</code> is not defined at :root/body scope (set per-element), so routing can't be confirmed from here";
        } else {
          reason = "<code>" + escapeHtml(v.through[v.through.length - 1]) +
            "</code> currently resolves to <code>" + escapeHtml(v.producerResolvesTo || "?") +
            "</code>, which does not pass through <code>" + escapeHtml(r.token) + "</code>";
        }
        h += '<p class="lab-hint">' + reason + " — its " + (v.consumers || []).length +
          " consumer(s) do <strong>not</strong> depend on <code>" + escapeHtml(r.token) + "</code> right now.</p>";
        h += '<details class="impact-more"><summary>show the ' + (v.consumers || []).length + " consumer(s)</summary>";
        (v.consumers || []).forEach(function (g) { h += consumerGroupHtml(g); });
        h += "</details></div>";
      });
    }

    (r.notes || []).forEach(function (n) {
      h += '<p class="lab-hint">' + escapeHtml(n) + "</p>";
    });
    h += '<p class="lab-hint">' + totalVisible + " matching element(s) visible on screen now. Indexed: " +
      escapeHtml((r.sheets || []).join(", ")) + "</p>";

    el.impactResult.innerHTML = h;
    var sels = collectImpactSelectors();
    el.impactHighlightBtn.disabled = sels.length === 0;
  }

  /* -------------------------- tabs -------------------------- */

  function wireTabs() {
    document.querySelectorAll(".lab-tab").forEach(function (t) {
      t.addEventListener("click", function () { activateTab(t.dataset.tab); });
    });
  }
  function activateTab(name) {
    document.querySelectorAll(".lab-tab").forEach(function (t) {
      t.classList.toggle("is-active", t.dataset.tab === name);
    });
    document.querySelectorAll(".lab-tabpanel").forEach(function (p) {
      p.classList.toggle("is-active", p.dataset.panel === name);
    });
    // Leaving Impact clears any on-screen highlight boxes.
    if (name !== "impact" && state.impactHighlighting) {
      postAgent({ type: "themelab:highlight", clear: true });
    }
  }

  /* ------------------------- gutter ------------------------ */

  function wireGutter() {
    var dragging = false;
    el.gutter.addEventListener("mousedown", function (e) {
      dragging = true;
      document.getElementById("app").classList.add("is-resizing");
      e.preventDefault();
    });
    window.addEventListener("mousemove", function (e) {
      if (!dragging) return;
      var total = document.querySelector(".lab-body").getBoundingClientRect();
      var w = total.right - e.clientX;
      w = Math.max(300, Math.min(640, w));
      el.controlsPane.style.width = w + "px";
    });
    window.addEventListener("mouseup", function () {
      dragging = false;
      document.getElementById("app").classList.remove("is-resizing");
    });
  }

  /* ------------------------ helpers ----------------------- */

  function toast(msg, isError) {
    el.toast.textContent = msg;
    el.toast.classList.toggle("is-error", !!isError);
    el.toast.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.toast.hidden = true; }, isError ? 6000 : 3500);
  }

  function safeCssColor(v) {
    v = String(v || "").trim();
    if (!v || /[{};]/.test(v) || /var\(/.test(v)) return "transparent";
    return v;
  }

  function toHex6(v) {
    v = String(v).trim();
    if (/^#[0-9a-fA-F]{3}$/.test(v)) {
      return "#" + v[1] + v[1] + v[2] + v[2] + v[3] + v[3];
    }
    if (/^#[0-9a-fA-F]{8}$/.test(v)) return v.slice(0, 7);
    if (/^#[0-9a-fA-F]{4}$/.test(v)) {
      return "#" + v[1] + v[1] + v[2] + v[2] + v[3] + v[3];
    }
    return /^#[0-9a-fA-F]{6}$/.test(v) ? v : "#000000";
  }

  function cssEscape(s) {
    return String(s).replace(/["\\]/g, "\\$&");
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return {
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
      }[c];
    });
  }
})();
