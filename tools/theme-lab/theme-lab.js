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
    ].forEach(function (id) { el[id] = document.getElementById(id); });

    wireTopbar();
    wireTabs();
    wireGutter();
    wirePreviewFrame();
    wireExport();
    window.addEventListener("message", onPreviewMessage);

    loadThemes();
  });

  function loadThemes() {
    fetch(API + "/themes")
      .then(function (r) { return r.json(); })
      .then(function (data) {
        state.themes = data.themes || [];
        state.rootDefaults = data.rootDefaults || {};
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
    renderTokens();
    renderChanges();
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
    nm.textContent = name;
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
    } else if (d.type === "themelab:pickState") {
      if (!d.picking && state.picking) setPicking(false);
    } else if (d.type === "themelab:picked") {
      renderInspect(d.info);
    }
  }

  function renderInspect(info) {
    var c = info.computed || {};
    var rows = [
      ["tag", info.tag],
      ["id", info.id || "\u2014"],
      ["classes", info.classes && info.classes.length ? info.classes.join(" ") : "\u2014"],
      ["text", info.text || "\u2014"],
    ];
    var colorRows = [
      ["color", c.color],
      ["background", c.backgroundColor],
      ["border", (c.borderWidth || "") + " " + (c.borderColor || "")],
    ];
    if (c.fill) colorRows.push(["fill", c.fill]);
    if (c.stroke) colorRows.push(["stroke", c.stroke]);
    colorRows.push(["font", (c.fontWeight || "") + " " + (c.fontSize || "")]);
    if (c.boxShadow && c.boxShadow !== "none") colorRows.push(["box-shadow", c.boxShadow]);

    var html = "<dl>";
    rows.forEach(function (r) {
      html += "<dt>" + r[0] + "</dt><dd>" + escapeHtml(String(r[1])) + "</dd>";
    });
    colorRows.forEach(function (r) {
      var val = String(r[1] || "").trim();
      var sw = /rgb|#|hsl/.test(val)
        ? '<span class="mini-swatch" style="background:' + escapeHtml(val.split(" ").filter(function(x){return /rgb|#|hsl/.test(x);})[0] || val) + '"></span>'
        : "";
      html += "<dt>" + r[0] + "</dt><dd>" + sw + escapeHtml(val || "\u2014") + "</dd>";
    });
    html += "</dl>";

    var guess = info.tokenGuess || {};
    var gk = Object.keys(guess);
    if (gk.length) {
      html += '<p class="lab-hint" style="margin-top:8px">Likely token (guess, not verified):</p><dl>';
      gk.forEach(function (k) {
        html += "<dt>" + k + "</dt><dd>" + escapeHtml(guess[k]) + "</dd>";
      });
      html += "</dl>";
    }
    el.inspectResult.innerHTML = html;
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
