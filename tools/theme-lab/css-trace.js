/* ---------------------------------------------------------------------------
 * Theme Lab — CSS cascade / token-source tracer  (Phase 2)
 *
 * Developer-only. Loaded into the preview iframe next to preview-agent.js
 * (same origin, so document.styleSheets and every stylesheet's source text
 * are directly readable). Nothing in the app references it.
 *
 * Given a picked element it answers, per visual property (text colour,
 * background, border colour, SVG fill/stroke):
 *
 *   - which authored CSS rule wins under the cascade (selector, file:line)
 *   - that rule's full declaration
 *   - if the declaration is `var(--token[, fallback])`, the resolved token
 *     chain — each hop's value and source location — ending at a literal
 *   - whether the result is token-driven, a theme-specific override, or a
 *     plain hardcoded value
 *
 * This is NOT a full DevTools cascade engine. Known limitations are listed
 * at the bottom of this file and surfaced in the report.
 *
 * Exposed as `window.__themeLabTrace` in the browser; also `module.exports`
 * for the Node unit tests (the pure parser/specificity/cascade helpers).
 * ------------------------------------------------------------------------- */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.__themeLabTrace = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* ===================================================================
   * 1. Stylesheet source parser (line-accurate)
   * =================================================================== */

  // Replace /* ... */ comments with whitespace of the same shape so every
  // subsequent character keeps its original line number.
  function stripComments(text) {
    var out = "";
    var i = 0;
    var n = text.length;
    while (i < n) {
      if (text[i] === "/" && text[i + 1] === "*") {
        var end = text.indexOf("*/", i + 2);
        if (end === -1) end = n - 2;
        var chunk = text.slice(i, end + 2);
        out += chunk.replace(/[^\n]/g, " ");
        i = end + 2;
      } else {
        out += text[i];
        i += 1;
      }
    }
    return out;
  }

  function countNewlines(str) {
    var c = 0;
    for (var i = 0; i < str.length; i += 1) if (str[i] === "\n") c += 1;
    return c;
  }

  // Split a selector list / value on top-level commas (ignoring commas inside
  // (), [], "" , '').
  function splitTopLevel(str, sep) {
    var parts = [];
    var depthRound = 0;
    var depthSquare = 0;
    var quote = "";
    var buf = "";
    for (var i = 0; i < str.length; i += 1) {
      var ch = str[i];
      if (quote) {
        buf += ch;
        if (ch === quote && str[i - 1] !== "\\") quote = "";
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        buf += ch;
        continue;
      }
      if (ch === "(") depthRound += 1;
      else if (ch === ")") depthRound -= 1;
      else if (ch === "[") depthSquare += 1;
      else if (ch === "]") depthSquare -= 1;
      if (ch === sep && depthRound === 0 && depthSquare === 0) {
        parts.push(buf);
        buf = "";
      } else {
        buf += ch;
      }
    }
    parts.push(buf);
    return parts;
  }

  // Parse one declaration block body ("prop:value; prop:value") into
  // { prop, value, important, line } entries. `startLine` is the 1-based line
  // of the block body's first character.
  function parseDeclarations(body, startLine) {
    var decls = [];
    var depthRound = 0;
    var quote = "";
    var buf = "";
    var bufStartOffset = 0; // offset into `body` where `buf` began

    function flush(endOffset) {
      var raw = buf;
      buf = "";
      var pieceStart = bufStartOffset;
      bufStartOffset = endOffset + 1;
      if (!raw.trim()) return;
      var colon = raw.indexOf(":");
      if (colon === -1) return;
      var prop = raw.slice(0, colon).trim();
      var value = raw.slice(colon + 1).trim();
      if (!prop || prop[0] === "@") return;
      var important = false;
      var bang = value.toLowerCase().lastIndexOf("!important");
      if (bang !== -1) {
        important = true;
        value = value.slice(0, bang).replace(/\s*$/, "");
      }
      // line of the property name: newlines from body start up to where the
      // non-whitespace of this piece begins
      var lead = raw.match(/^\s*/)[0];
      var line = startLine + countNewlines(body.slice(0, pieceStart + lead.length));
      decls.push({ prop: prop.toLowerCase(), value: value.trim(), important: important, line: line });
    }

    for (var i = 0; i < body.length; i += 1) {
      var ch = body[i];
      if (quote) {
        buf += ch;
        if (ch === quote && body[i - 1] !== "\\") quote = "";
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        buf += ch;
        continue;
      }
      if (ch === "(") depthRound += 1;
      else if (ch === ")") depthRound -= 1;
      if (ch === ";" && depthRound === 0) {
        flush(i);
      } else {
        buf += ch;
      }
    }
    flush(body.length);
    return decls;
  }

  /**
   * Parse stylesheet text into a flat list of style-rule records.
   *
   * @returns Array<{
   *   sheet: string, selector: string, selectorList: string[],
   *   line: number, order: number,
   *   media: Array<{type:string, prelude:string, line:number}>,
   *   declarations: Array<{prop, value, important, line}>
   * }>
   */
  function parseStylesheet(text, opts) {
    opts = opts || {};
    var sheetName = opts.sheet || "(stylesheet)";
    var lineOffset = opts.lineOffset || 0;
    var src = stripComments(text);
    var rules = [];
    var atStack = [];
    var i = 0;
    var n = src.length;
    var line = 1 + lineOffset;
    var tokenStart = 0;
    var tokenStartLine = line;
    var quote = "";
    var order = 0;

    function flushWhitespaceTrack(from, to) {
      for (var k = from; k < to; k += 1) if (src[k] === "\n") line += 1;
    }

    while (i < n) {
      var ch = src[i];
      if (quote) {
        if (ch === "\n") line += 1;
        if (ch === quote && src[i - 1] !== "\\") quote = "";
        i += 1;
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        i += 1;
        continue;
      }
      if (ch === "\n") {
        line += 1;
        i += 1;
        continue;
      }
      if (ch === "{") {
        var prelude = src.slice(tokenStart, i).trim();
        var preludeLine = tokenStartLine;
        // advance line count for any newlines inside the prelude already
        // handled above; recompute preludeLine as the first non-space line
        var lead = src.slice(tokenStart, i).match(/^\s*/)[0];
        preludeLine = tokenStartLine + countNewlines(lead);

        if (prelude[0] === "@") {
          var atName = (prelude.match(/^@([A-Za-z-]+)/) || [])[1] || "";
          atName = atName.toLowerCase();
          if (atName === "keyframes" || atName === "font-face" || atName === "property") {
            // skip this block wholesale
            var d = 1;
            i += 1;
            while (i < n && d > 0) {
              if (src[i] === "\n") line += 1;
              else if (src[i] === "{") d += 1;
              else if (src[i] === "}") d -= 1;
              i += 1;
            }
            tokenStart = i;
            tokenStartLine = line;
            continue;
          }
          atStack.push({ type: atName, prelude: prelude, line: preludeLine });
          i += 1;
          tokenStart = i;
          tokenStartLine = line;
          continue;
        }

        // style rule: read its declaration block
        var bodyStart = i + 1;
        var depth = 1;
        var j = i + 1;
        var bodyStartLine = line;
        while (j < n && depth > 0) {
          var cj = src[j];
          if (cj === "\n") line += 1;
          else if (cj === '"' || cj === "'") {
            var q = cj;
            j += 1;
            while (j < n && !(src[j] === q && src[j - 1] !== "\\")) {
              if (src[j] === "\n") line += 1;
              j += 1;
            }
          } else if (cj === "{") depth += 1;
          else if (cj === "}") depth -= 1;
          if (depth === 0) break;
          j += 1;
        }
        var body = src.slice(bodyStart, j);
        var decls = parseDeclarations(body, bodyStartLine);
        // Per-selector line: comma-split the raw prelude, but track newlines
        // so `.b` on a line below `.a,` reports its own line.
        var rawParts = splitTopLevel(prelude, ",");
        var selectorList = rawParts
          .map(function (s) { return s.trim(); })
          .filter(Boolean);
        var consumedPrelude = 0;
        rawParts.forEach(function (rawSel) {
          var sel = rawSel.trim();
          var selLine =
            preludeLine +
            countNewlines(prelude.slice(0, consumedPrelude + rawSel.match(/^\s*/)[0].length));
          consumedPrelude += rawSel.length + 1; // + the comma
          if (!sel) return;
          order += 1;
          rules.push({
            sheet: sheetName,
            selector: sel,
            selectorList: selectorList,
            line: selLine,
            order: order,
            media: atStack.slice(),
            declarations: decls,
          });
        });
        i = j + 1;
        tokenStart = i;
        tokenStartLine = line;
        continue;
      }
      if (ch === "}") {
        if (atStack.length) atStack.pop();
        i += 1;
        tokenStart = i;
        tokenStartLine = line;
        continue;
      }
      i += 1;
    }
    return rules;
  }

  /* ===================================================================
   * 2. Specificity
   * =================================================================== */

  // Returns [a, b, c]. :where() contributes 0. :is()/:not()/:has() take the
  // max specificity of their arguments. Good enough for resin.tools CSS.
  function computeSpecificity(selector) {
    var sel = String(selector);
    var acc = [0, 0, 0];

    // :where(...) contributes zero -- drop it and its contents.
    sel = sel.replace(/:where\(([^()]*(?:\([^()]*\)[^()]*)*)\)/gi, " ");

    // :is()/:matches()/:not()/:has() take the max specificity of their args.
    var funcRe = /:(is|matches|not|has)\(([^()]*(?:\([^()]*\)[^()]*)*)\)/gi;
    var m;
    while ((m = funcRe.exec(sel))) {
      var inner = splitTopLevel(m[2], ",")
        .map(function (s) { return computeSpecificity(s.trim()); })
        .sort(cmpSpec);
      var best = inner.pop() || [0, 0, 0];
      acc[0] += best[0]; acc[1] += best[1]; acc[2] += best[2];
    }
    sel = sel.replace(funcRe, " ");

    // ids
    sel = sel.replace(/#[A-Za-z0-9_-]+/g, function () { acc[0] += 1; return " "; });
    // classes
    sel = sel.replace(/\.[A-Za-z0-9_-]+/g, function () { acc[1] += 1; return " "; });
    // attribute selectors
    sel = sel.replace(/\[[^\]]*\]/g, function () { acc[1] += 1; return " "; });
    // pseudo-elements (::x and legacy :before/:after/:first-line/:first-letter)
    sel = sel.replace(/::[A-Za-z-]+/g, function () { acc[2] += 1; return " "; });
    sel = sel.replace(/:(before|after|first-line|first-letter)\b/gi, function () { acc[2] += 1; return " "; });
    // remaining pseudo-classes
    sel = sel.replace(/:[A-Za-z-]+(\([^)]*\))?/g, function () { acc[1] += 1; return " "; });
    // element / type names left over
    sel.replace(/[A-Za-z][A-Za-z0-9_-]*/g, function () { acc[2] += 1; return " "; });

    return acc;
  }

  function cmpSpec(x, y) {
    return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
  }

  /* ===================================================================
   * 3. Value inspection helpers
   * =================================================================== */

  // First top-level var() reference in a value, with its raw fallback text.
  function firstVarRef(value) {
    var idx = topLevelIndexOf(value, "var(");
    if (idx === -1) return null;
    var open = idx + 3;
    var depth = 0;
    var i = open;
    for (; i < value.length; i += 1) {
      if (value[i] === "(") depth += 1;
      else if (value[i] === ")") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    var inner = value.slice(open + 1, i);
    var parts = splitTopLevel(inner, ",");
    var name = parts.shift().trim();
    var fallback = parts.length ? parts.join(",").trim() : null;
    return {
      name: name,
      fallback: fallback,
      raw: value.slice(idx, i + 1),
      before: value.slice(0, idx),
      after: value.slice(i + 1),
    };
  }

  function topLevelIndexOf(str, needle) {
    var depth = 0;
    var quote = "";
    for (var i = 0; i < str.length; i += 1) {
      var ch = str[i];
      if (quote) {
        if (ch === quote && str[i - 1] !== "\\") quote = "";
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        continue;
      }
      if (ch === "(") depth += 1;
      else if (ch === ")") depth -= 1;
      else if (depth === 0 && str.slice(i, i + needle.length) === needle) return i;
    }
    return -1;
  }

  function hasTopLevelVar(value) {
    return topLevelIndexOf(String(value), "var(") !== -1;
  }

  // Any var() at any depth (e.g. inside color-mix()/gradients).
  function hasAnyVar(value) {
    return /(^|[^-\w])var\(/.test(String(value));
  }

  // First var(...) reference anywhere in the value (depth-agnostic).
  function anyVarRef(value) {
    var s = String(value);
    var idx = s.search(/(^|[^-\w])var\(/);
    if (idx === -1) return null;
    // move to the 'v' of var(
    while (idx < s.length && s.slice(idx, idx + 4) !== "var(") idx += 1;
    var open = idx + 3;
    var depth = 0;
    var i = open;
    for (; i < s.length; i += 1) {
      if (s[i] === "(") depth += 1;
      else if (s[i] === ")") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    var inner = s.slice(open + 1, i);
    var parts = splitTopLevel(inner, ",");
    var name = parts.shift().trim();
    var fallback = parts.length ? parts.join(",").trim() : null;
    return {
      name: name,
      fallback: fallback,
      raw: s.slice(idx, i + 1),
      before: s.slice(0, idx),
      after: s.slice(i + 1),
    };
  }

  // Every distinct --custom-property name referenced by a value, at any depth
  // (var(--a, var(--b)) and color-mix(... var(--c) ...) all counted). Fallback
  // sub-references count too — they are still "places --x could flow from".
  function allVarNames(value) {
    var names = [];
    var seen = {};
    var re = /var\(\s*(--[A-Za-z0-9_-]+)/g;
    var m;
    while ((m = re.exec(String(value)))) {
      if (!seen[m[1]]) {
        seen[m[1]] = true;
        names.push(m[1]);
      }
    }
    return names;
  }

  // Which longhand + shorthand props can set the colour of a given target.
  var PROP_MAP = {
    color: ["color"],
    background: ["background-color", "background"],
    border: ["border-top-color", "border-color", "border-top", "border"],
    fill: ["fill"],
    stroke: ["stroke"],
  };

  // Pull the colour-ish token out of a shorthand value (background / border).
  function colorPartOf(prop, value) {
    if (prop === "background" || prop === "border" || prop === "border-top") {
      if (hasTopLevelVar(value) && /^\s*var\(/.test(value)) return value.trim();
      var toks = splitTopLevel(value, " ")
        .map(function (s) { return s.trim(); })
        .filter(Boolean);
      for (var k = toks.length - 1; k >= 0; k -= 1) {
        if (looksLikeColor(toks[k])) return toks[k];
      }
      return null;
    }
    return value.trim();
  }

  function looksLikeColor(tok) {
    return (
      /^#[0-9a-fA-F]{3,8}$/.test(tok) ||
      /^(rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color|color-mix)\(/i.test(tok) ||
      /^var\(/.test(tok) ||
      /^(transparent|currentColor|inherit|initial|unset)$/i.test(tok) ||
      NAMED_COLORS.indexOf(tok.toLowerCase()) !== -1
    );
  }

  var NAMED_COLORS = (
    "black,white,red,green,blue,yellow,orange,purple,gray,grey,silver,gold," +
    "navy,teal,olive,maroon,lime,aqua,fuchsia,pink,brown,cyan,magenta,coral," +
    "salmon,khaki,violet,indigo,crimson,tomato,orchid,tan,beige,ivory,azure"
  ).split(",");

  /* ===================================================================
   * 4. DOM-bound tracing
   * =================================================================== */

  function stripPseudoElements(sel) {
    return sel.replace(/::[-\w]+(\([^)]*\))?/g, "").trim() || "*";
  }

  function mediaMatches(win, mediaChain) {
    for (var i = 0; i < mediaChain.length; i += 1) {
      var m = mediaChain[i];
      if (m.type === "media") {
        var q = m.prelude.replace(/^@media\s*/i, "").trim();
        try {
          if (!win.matchMedia(q).matches) return false;
        } catch (e) {
          /* unparseable query: assume it applies, note elsewhere */
        }
      } else if (m.type === "supports") {
        var cond = m.prelude.replace(/^@supports\s*/i, "").trim();
        try {
          if (win.CSS && win.CSS.supports && !win.CSS.supports(cond)) return false;
        } catch (e2) {
          /* ignore */
        }
      }
    }
    return true;
  }

  // All rules from the index that currently match `el` (media queries
  // evaluated against the iframe window). Returns candidates sorted by
  // cascade order (weakest first, winner last) — NOT filtered by property.
  function matchingRules(el, index) {
    var win = el.ownerDocument.defaultView;
    var out = [];
    for (var i = 0; i < index.rules.length; i += 1) {
      var rule = index.rules[i];
      if (rule.media.length && !mediaMatches(win, rule.media)) continue;
      var sel = stripPseudoElements(rule.selector);
      var ok = false;
      try {
        ok = el.matches(sel);
      } catch (e) {
        ok = false;
      }
      if (!ok) continue;
      out.push({
        rule: rule,
        specificity: computeSpecificity(rule.selector),
        sheetIndex: index.sheetOrder.indexOf(rule.sheet),
      });
    }
    out.sort(function (x, y) {
      return (
        cmpSpec(x.specificity, y.specificity) ||
        x.sheetIndex - y.sheetIndex ||
        x.rule.order - y.rule.order
      );
    });
    return out;
  }

  // Resolve a custom property `name` for `el`: walk el + ancestors, at each
  // level take the cascade winner among rules that declare `name` (plus that
  // level's inline style). Custom props inherit, so the nearest ancestor with
  // a definition wins. Returns { value, source } or null.
  function resolveCustomProperty(el, name, index) {
    var node = el;
    while (node && node.nodeType === 1) {
      // inline style on this node
      var inlineVal = node.style && node.style.getPropertyValue(name);
      var candidates = [];
      var matches = matchingRules(node, index);
      for (var i = 0; i < matches.length; i += 1) {
        var decls = matches[i].rule.declarations;
        for (var d = 0; d < decls.length; d += 1) {
          if (decls[d].prop === name) {
            candidates.push({
              value: decls[d].value,
              important: decls[d].important,
              specificity: matches[i].specificity,
              sheetIndex: matches[i].sheetIndex,
              order: matches[i].rule.order,
              rule: matches[i].rule,
              declLine: decls[d].line,
            });
          }
        }
      }
      candidates.sort(function (x, y) {
        return (
          x.important - y.important ||
          cmpSpec(x.specificity, y.specificity) ||
          x.sheetIndex - y.sheetIndex ||
          x.order - y.order
        );
      });
      var winner = candidates[candidates.length - 1];

      if (inlineVal && inlineVal.trim()) {
        // Inline beats any selector on the same element (Theme Lab's own
        // preview overrides live here, on <html>/<body>).
        return {
          value: inlineVal.trim(),
          source: {
            kind: "inline",
            where:
              node === el.ownerDocument.documentElement
                ? "<html> inline style"
                : node === el.ownerDocument.body
                ? "<body> inline style"
                : "inline style on <" + node.tagName.toLowerCase() + ">",
            themeScoped: false,
            node: node,
            isPreviewOverride:
              node === el.ownerDocument.documentElement ||
              node === el.ownerDocument.body,
          },
        };
      }
      if (winner) {
        var srcOf = function (cand) {
          return {
            kind: classifyRuleSource(cand.rule),
            file: cand.rule.sheet,
            line: cand.declLine,
            ruleLine: cand.rule.line,
            selector: cand.rule.selector,
            value: cand.value,
            themeScoped: /\[data-theme/.test(cand.rule.selector),
            isPaletteBlock: isPaletteBlock(cand.rule.selector),
            media: cand.rule.media.map(function (m) { return m.prelude; }),
          };
        };
        // Other declarations of this same custom property, at the same
        // element level, that lost the cascade. A losing non-theme
        // definition is what makes a palette-block win a "theme override".
        var overridden = candidates
          .slice(0, candidates.length - 1)
          .map(srcOf)
          .reverse();
        return {
          value: winner.value,
          source: srcOf(winner),
          overridden: overridden,
        };
      }
      node = node.parentElement;
    }
    return null;
  }

  function isPaletteBlock(selector) {
    return /^:where\(html,\s*body\)\[data-theme="[^"]+"\]$/.test(
      String(selector).trim()
    );
  }

  function classifyRuleSource(rule) {
    if (isPaletteBlock(rule.selector)) return "palette-block";
    if (/\[data-theme/.test(rule.selector)) return "theme-scoped-rule";
    if (/^:root$/.test(rule.selector.trim())) return "root-default";
    return "component-rule";
  }

  // Follow a value through the var() chain. `themeTokens` (from
  // theme-parser.js via the parent) authoritatively supplies palette-block
  // token lines; everything else comes from the parsed index.
  function resolveChain(el, value, index, themeTokens, seen) {
    seen = seen || {};
    var chain = [];
    var current = value;
    var guard = 0;
    while (hasAnyVar(current) && guard < 12) {
      guard += 1;
      var ref = hasTopLevelVar(current) ? firstVarRef(current) : anyVarRef(current);
      if (!ref) break;
      if (seen[ref.name]) {
        chain.push({ ref: ref.name, resolved: null, note: "cycle detected" });
        break;
      }
      seen[ref.name] = true;

      var resolved = resolveCustomProperty(el, ref.name, index);
      var link = { ref: ref.name, declaration: ref.raw };

      if (resolved) {
        link.value = resolved.value;
        link.source = resolved.source;
        link.overridden = resolved.overridden || [];
        // Prefer theme-parser's line for palette-block tokens.
        if (
          resolved.source &&
          resolved.source.isPaletteBlock &&
          themeTokens &&
          themeTokens.byName &&
          themeTokens.byName[ref.name]
        ) {
          link.source = Object.assign({}, resolved.source, {
            file: themeTokens.themeCssPath || resolved.source.file,
            line: themeTokens.byName[ref.name].line,
            paletteName: themeTokens.name,
            fromThemeParser: true,
          });
          link.value = themeTokens.byName[ref.name].value;
        }
        chain.push(link);
        current = link.value;
      } else if (ref.fallback != null) {
        link.value = ref.fallback;
        link.usedFallback = true;
        link.source = { kind: "fallback", where: "var() fallback (token undefined)" };
        chain.push(link);
        current = ref.fallback;
      } else {
        link.value = null;
        link.source = { kind: "unresolved", where: "token not defined anywhere matching" };
        chain.push(link);
        break;
      }
    }
    return { chain: chain, terminal: current };
  }

  function pickComputed(cs, target) {
    switch (target) {
      case "color":
        return cs.color;
      case "background":
        return cs.backgroundColor;
      case "border":
        return cs.borderTopColor;
      case "fill":
        return cs.fill;
      case "stroke":
        return cs.stroke;
      default:
        return "";
    }
  }

  // Winning authored declaration for one visual target on `el`.
  function resolveProperty(el, target, index, themeTokens) {
    var cs = el.ownerDocument.defaultView.getComputedStyle(el);
    var computed = pickComputed(cs, target);
    var props = PROP_MAP[target];
    var matches = matchingRules(el, index);
    var candidates = [];

    for (var i = 0; i < matches.length; i += 1) {
      var mr = matches[i];
      var decls = mr.rule.declarations;
      for (var d = 0; d < decls.length; d += 1) {
        var dc = decls[d];
        if (props.indexOf(dc.prop) === -1) continue;
        var colorPart = colorPartOf(dc.prop, dc.value);
        if (colorPart == null) continue;
        candidates.push({
          prop: dc.prop,
          rawValue: dc.value,
          value: colorPart,
          important: dc.important,
          specificity: mr.specificity,
          sheetIndex: mr.sheetIndex,
          order: mr.rule.order,
          rule: mr.rule,
          declLine: dc.line,
        });
      }
    }

    // element inline style
    var inlineRaw = "";
    for (var pi = 0; pi < props.length; pi += 1) {
      var v = el.style.getPropertyValue(props[pi]);
      if (v) inlineRaw = v;
    }
    if (inlineRaw) {
      candidates.push({
        prop: props[0],
        rawValue: inlineRaw,
        value: colorPartOf(props[0], inlineRaw) || inlineRaw,
        important: /!important/i.test(el.getAttribute("style") || ""),
        specificity: [1, 0, 0, 0],
        sheetIndex: 999,
        order: 1e9,
        rule: { sheet: "element style attribute", selector: "(inline)", line: 0, media: [] },
        declLine: 0,
        inline: true,
      });
    }

    candidates.sort(function (x, y) {
      return (
        x.important - y.important ||
        cmpSpec(x.specificity, y.specificity) ||
        x.sheetIndex - y.sheetIndex ||
        x.order - y.order
      );
    });

    var winner = candidates[candidates.length - 1];
    if (!winner) {
      return {
        target: target,
        computed: computed,
        matched: false,
        note: "No authored rule sets " + target + " — inherited value or UA default.",
      };
    }

    var chainInfo = hasAnyVar(winner.value)
      ? resolveChain(el, winner.value, index, themeTokens, {})
      : { chain: [], terminal: winner.value };

    return {
      target: target,
      computed: computed,
      matched: true,
      winning: {
        selector: winner.rule.selector,
        file: winner.rule.sheet,
        line: winner.declLine || winner.rule.line,
        ruleLine: winner.rule.line,
        declaration: winner.prop + ": " + winner.rawValue,
        important: winner.important,
        inline: !!winner.inline,
        media: (winner.rule.media || []).map(function (m) { return m.prelude; }),
        themeScoped: /\[data-theme/.test(winner.rule.selector),
      },
      chain: chainInfo.chain,
      terminal: chainInfo.terminal,
      classification: classify(winner, chainInfo),
    };
  }

  function chainRefs(chain) {
    return chain
      .map(function (l) { return "var(" + l.ref + ")"; })
      .join(" → ");
  }

  // Did any hop in the chain win against a losing NON-theme-scoped var()
  // definition of the same token? That is the signature of a theme redefining
  // a component/base token (e.g. --btnstyle-ink: var(--text) in button-
  // styling.css, overridden to a literal in a palette block).
  function componentTokenOverride(chain) {
    for (var i = 0; i < chain.length; i += 1) {
      var link = chain[i];
      if (!link.source || (link.source.kind !== "palette-block" && link.source.kind !== "theme-scoped-rule")) continue;
      var base = (link.overridden || []).filter(function (o) {
        return !o.themeScoped && hasAnyVar(o.value || "");
      })[0];
      if (base) {
        return {
          token: link.ref,
          overrideFile: link.source.file,
          overrideLine: link.source.line,
          overrideValue: link.value,
          baseFile: base.file,
          baseLine: base.line,
          baseValue: base.value,
          baseSelector: base.selector,
        };
      }
    }
    return null;
  }

  function classify(winner, chainInfo) {
    var srcRef = winner.rule.sheet + ":" + (winner.declLine || winner.rule.line);

    if (!hasAnyVar(winner.value)) {
      if (winner.inline) {
        return { kind: "inline", summary: "Set directly by an inline style attribute on the element (" + srcRef + ")." };
      }
      if (/\[data-theme/.test(winner.rule.selector)) {
        return {
          kind: "theme-specific-override",
          summary:
            "Hardcoded literal in a theme-scoped rule (" + srcRef +
            "). Not token-driven — this selector only applies under its data-theme.",
        };
      }
      return {
        kind: "hardcoded",
        summary: "Hardcoded literal (" + srcRef + "). Applies regardless of theme; no token involved.",
      };
    }

    var chain = chainInfo.chain;
    var last = chain[chain.length - 1];
    if (!last) return { kind: "token-driven", summary: "Declaration uses var(), chain unresolved." };
    if (last.source && last.source.kind === "unresolved") {
      return {
        kind: "unresolved",
        summary: "Declaration is " + chainRefs(chain) + " but " + last.ref + " is not defined for this element in this theme.",
      };
    }

    var cto = componentTokenOverride(chain);
    var terminalKind = last.source ? last.source.kind : "?";
    var terminalLoc = last.source && last.source.file ? last.source.file + ":" + last.source.line : terminalKind;
    var paletteName = null;
    for (var i = 0; i < chain.length; i += 1) {
      if (chain[i].source && chain[i].source.paletteName) paletteName = chain[i].source.paletteName;
    }

    if (cto) {
      return {
        kind: "theme-specific-override",
        summary:
          "Declaration is " + chainRefs(chain) + " (token-driven), but " + cto.token +
          " is REDEFINED by the theme: " + cto.overrideFile + ":" + cto.overrideLine +
          " sets it to " + cto.overrideValue + ", overriding its base definition " +
          cto.baseFile + ":" + cto.baseLine + " (" + cto.token + ": " + cto.baseValue +
          "). The rendered colour is a theme-specific override, not the semantic palette value the base would resolve to.",
        componentTokenOverride: cto,
        chainText: chainRefs(chain),
      };
    }

    if (terminalKind === "palette-block") {
      return {
        kind: "token-driven",
        summary:
          "Token-driven. " + chainRefs(chain) + " resolves to a value defined in the " +
          (paletteName ? paletteName + " palette block" : "palette block") + " (" + terminalLoc + ").",
        chainText: chainRefs(chain),
      };
    }
    if (terminalKind === "theme-scoped-rule") {
      return {
        kind: "theme-specific-override",
        summary:
          "Token-driven declaration, but " + last.ref + " is set by a theme-scoped rule (" +
          terminalLoc + ") rather than the palette block — only applies under that data-theme.",
        chainText: chainRefs(chain),
      };
    }
    if (last.usedFallback) {
      return {
        kind: "token-driven",
        summary:
          chainRefs(chain) + ": token undefined, so the inline var() fallback is used (" +
          last.value + "). Not theme-tunable through the palette.",
        chainText: chainRefs(chain),
      };
    }
    return {
      kind: "token-driven",
      summary:
        "Token-driven via " + chainRefs(chain) + "; terminal value from " + terminalKind +
        " (" + terminalLoc + "). This is a base/component token — not part of the per-theme palette.",
      chainText: chainRefs(chain),
    };
  }

  /* ===================================================================
   * 5. Index building (browser)
   * =================================================================== */

  function buildIndex(doc) {
    var sheets = [];
    var rules = [];
    var sheetOrder = [];
    var list = doc.styleSheets;
    var pending = [];

    for (var i = 0; i < list.length; i += 1) {
      (function (sheet, orderIdx) {
        var name;
        var p;
        if (sheet.href) {
          name = sheet.href.split("/").pop().split("?")[0];
          p = fetch(sheet.href, { cache: "force-cache" })
            .then(function (r) { return r.text(); })
            .then(function (text) {
              return { name: name, text: text, lineOffset: 0 };
            });
        } else {
          // inline <style> — locate it inside index.html for real line numbers
          name = "index.html <style>";
          var cssText = "";
          try {
            cssText = sheet.ownerNode ? sheet.ownerNode.textContent : "";
          } catch (e) {}
          p = fetch("/", { cache: "force-cache" })
            .then(function (r) { return r.text(); })
            .then(function (html) {
              var at = html.indexOf(cssText.slice(0, 40));
              var lineOffset = at > -1 ? countNewlines(html.slice(0, at)) : 0;
              return { name: name, text: cssText, lineOffset: lineOffset };
            })
            .catch(function () {
              return { name: name, text: cssText, lineOffset: 0 };
            });
        }
        sheetOrder[orderIdx] = name;
        pending.push(
          p.then(function (res) {
            sheets[orderIdx] = res.name;
            var parsed = parseStylesheet(res.text, {
              sheet: res.name,
              lineOffset: res.lineOffset,
            });
            return { orderIdx: orderIdx, name: res.name, parsed: parsed };
          }).catch(function (err) {
            return { orderIdx: orderIdx, name: name, parsed: [], error: String(err) };
          })
        );
      })(list[i], i);
    }

    return Promise.all(pending).then(function (results) {
      results.sort(function (a, b) { return a.orderIdx - b.orderIdx; });
      results.forEach(function (r) {
        for (var k = 0; k < r.parsed.length; k += 1) rules.push(r.parsed[k]);
      });
      return {
        sheetOrder: sheetOrder.filter(Boolean),
        sheets: results.map(function (r) { return r.name; }),
        rules: rules,
        errors: results.filter(function (r) { return r.error; }),
      };
    });
  }

  /* ===================================================================
   * 6. Public trace entry point (browser)
   * =================================================================== */

  var _indexCache = null;
  var _refMapCache = null;

  // Live (DOM-dependent) result caches, keyed implicitly by _liveGen. The
  // parsed stylesheet index and refMap do NOT change when the DOM does, but
  // querySelectorAll results and body-scope var() resolution do — bump the
  // generation on theme switch / viewport change / app navigation so those
  // are recomputed while the expensive parse work is kept.
  var _liveGen = 0;
  var _selStatsCache = new Map(); // normalizedSelector -> { inDom, onScreen }
  var _routeCache = new Map(); // "target|producer" -> { routes, terminal, chainLen }

  function invalidate() {
    _indexCache = null;
    _refMapCache = null;
    bumpLiveGen();
  }

  // Stylesheets unchanged, but the rendered DOM / active theme did.
  function bumpLiveGen() {
    _liveGen += 1;
    _selStatsCache.clear();
    _routeCache.clear();
  }

  function liveGen() {
    return _liveGen;
  }

  function getIndex(doc) {
    if (_indexCache) return Promise.resolve(_indexCache);
    return buildIndex(doc).then(function (idx) {
      _indexCache = idx;
      return idx;
    });
  }

  // Compact "tag#id.c1.c2" style descriptor for the panel identity line.
  function subjectDesc(el) {
    if (!el || el.nodeType !== 1) return { tag: "?", hint: "?" };
    var classes = (
      typeof el.className === "string"
        ? el.className
        : (el.getAttribute && el.getAttribute("class")) || ""
    )
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    var tag = el.tagName.toLowerCase();
    var hint = tag;
    if (el.id) hint += "#" + el.id;
    if (classes.length) hint += "." + classes.slice(0, 3).join(".");
    return { tag: tag, id: el.id || null, classes: classes, hint: hint };
  }

  function traceElementProperties(el, index, themeTokens) {
    var targets = ["color", "background", "border"];
    if (el.namespaceURI === "http://www.w3.org/2000/svg") {
      targets = ["fill", "stroke", "color"];
    }
    var properties = {};
    var anyMatched = false;
    targets.forEach(function (t) {
      try {
        properties[t] = resolveProperty(el, t, index, themeTokens);
        if (properties[t].matched) anyMatched = true;
      } catch (e) {
        properties[t] = { target: t, matched: false, note: "trace error: " + e.message };
      }
    });
    return { properties: properties, anyMatched: anyMatched, isSvg: targets[0] === "fill" };
  }

  function trace(el, opts) {
    opts = opts || {};
    var doc = el.ownerDocument;
    var themeTokens = opts.themeTokens || null;

    return getIndex(doc).then(function (index) {
      // Part A: if the clicked element has no authored rule for ANY of its
      // relevant properties, walk up to the nearest ancestor that does and
      // trace that instead — flagged, never silent.
      var subject = el;
      var res = traceElementProperties(subject, index, themeTokens);
      var depth = 0;
      while (
        !res.anyMatched &&
        subject.parentElement &&
        subject.parentElement.nodeType === 1 &&
        depth < 10
      ) {
        subject = subject.parentElement;
        depth += 1;
        res = traceElementProperties(subject, index, themeTokens);
      }
      var substituted = depth > 0 && res.anyMatched;

      var cs = doc.defaultView.getComputedStyle(subject);
      return {
        ok: true,
        sheets: index.sheetOrder,
        indexErrors: index.errors,
        substituted: substituted,
        clicked: subjectDesc(el),
        subject: subjectDesc(subject),
        ancestorDepth: substituted ? depth : 0,
        computed: {
          color: cs.color,
          backgroundColor: cs.backgroundColor,
          borderColor: cs.borderTopColor,
          borderWidth: cs.borderTopWidth,
          fill: cs.fill,
          stroke: cs.stroke,
          fontSize: cs.fontSize,
          fontWeight: cs.fontWeight,
          boxShadow: cs.boxShadow,
        },
        properties: res.properties,
      };
    });
  }

  /* ===================================================================
   * 7. Reverse lookup — token -> consumers (Phase 3, Part B)
   * =================================================================== */

  // One pass over the parsed index: for every declaration, record which
  // custom properties its value references. `byToken['--x']` is the list of
  // declarations (rule + decl) that contain `var(--x)` anywhere in their
  // value. A declaration whose own property is itself a custom property is a
  // "producer" (a component token); one whose property is a real CSS
  // property is a "consumer".
  function buildRefMap(index) {
    var byToken = Object.create(null);
    for (var i = 0; i < index.rules.length; i += 1) {
      var rule = index.rules[i];
      for (var d = 0; d < rule.declarations.length; d += 1) {
        var decl = rule.declarations[d];
        var refs = allVarNames(decl.value);
        if (!refs.length) continue;
        var entryBase = {
          file: rule.sheet,
          line: decl.line,
          ruleLine: rule.line,
          selector: rule.selector,
          prop: decl.prop,
          value: decl.value,
          important: decl.important,
          media: rule.media.map(function (m) { return m.prelude; }),
          producesToken: decl.prop.slice(0, 2) === "--" ? decl.prop : null,
          themeScopeMatch: (rule.selector.match(/\[data-theme[~^$*|]?=\s*"([^"]+)"/) || [])[1] || null,
          order: rule.order,
        };
        for (var r = 0; r < refs.length; r += 1) {
          (byToken[refs[r]] || (byToken[refs[r]] = [])).push(entryBase);
        }
      }
    }
    return { byToken: byToken };
  }

  function getRefMap(doc) {
    return getIndex(doc).then(function (index) {
      if (!_refMapCache) _refMapCache = buildRefMap(index);
      return { index: index, refMap: _refMapCache };
    });
  }

  function stripPseudoAll(sel) {
    return (
      sel
        .replace(/::[-\w]+(\([^)]*\))?/g, "")
        // Longest alternatives first so `:focus-visible` isn't clipped to
        // `-visible` by an earlier `:focus` match.
        .replace(/:(focus-visible|focus-within|focus|hover|active|visited|target|checked|disabled|enabled|read-only|read-write|placeholder-shown|first-child|last-child|only-child|nth-child\([^)]*\)|nth-of-type\([^)]*\)|nth-last-child\([^)]*\))/gi, "")
        .trim() || "*"
    );
  }

  // Transient interaction states — an element only matches these while the
  // user is hovering / focusing / pressing it, so a consumer selector using
  // one can't be boxed by the static hover-highlight. (Structural pseudos
  // like :first-child are not "states" and are excluded here.)
  var STATE_PSEUDO_RE = /:(hover|focus|focus-visible|focus-within|active|visited|target)\b/i;

  function hasStatePseudo(selector) {
    return STATE_PSEUDO_RE.test(String(selector));
  }

  // How many elements currently in the DOM match this consumer's selector,
  // and how many of those are visible. Best-effort; capped. Cached per
  // _liveGen (the same normalized selector is shared by many tokens' consumer
  // lists, so this collapses an eager all-token pass to one query each).
  function liveMatchStats(doc, selector) {
    var sel = stripPseudoAll(selector);
    var hit = _selStatsCache.get(sel);
    if (hit) return hit;
    var out;
    var nodes;
    try {
      nodes = doc.querySelectorAll(sel);
    } catch (e) {
      out = { total: null, visible: null, error: "unmatchable selector", sel: sel };
      _selStatsCache.set(sel, out);
      return out;
    }
    var visible = 0;
    var cap = Math.min(nodes.length, 400);
    for (var i = 0; i < cap; i += 1) {
      var n = nodes[i];
      if (n.getClientRects && n.getClientRects().length) visible += 1;
    }
    out = { total: nodes.length, visible: visible, sel: sel };
    _selStatsCache.set(sel, out);
    return out;
  }

  // Walk one batch of (pseudo-stripped) selectors, adding matched elements to
  // a shared `seen` Set and tallying how many were newly seen / visible.
  function tallySelectors(doc, selectors, seen) {
    var inDom = 0;
    var onScreen = 0;
    var bad = 0;
    for (var s = 0; s < selectors.length; s += 1) {
      var sel = stripPseudoAll(selectors[s]);
      var nodes;
      try {
        nodes = doc.querySelectorAll(sel);
      } catch (e) {
        bad += 1;
        continue;
      }
      var cap = Math.min(nodes.length, 500);
      for (var i = 0; i < cap; i += 1) {
        var n = nodes[i];
        if (seen.has(n)) continue;
        seen.add(n);
        inDom += 1;
        if (n.getClientRects && n.getClientRects().length) onScreen += 1;
      }
    }
    return { inDom: inDom, onScreen: onScreen, unmatchable: bad };
  }

  // Unique visible-element count for a set of consumer selectors, de-duped by
  // element. `static` selectors always style their match; `state` selectors
  // only style it while hovered/focused/etc, so their extra matches are
  // reported separately (they inflate a token's badge relative to what the
  // static hover-highlight can box).
  function countVisibleUnique(doc, selectors) {
    var staticSels = [];
    var stateSels = [];
    for (var i = 0; i < selectors.length; i += 1) {
      (hasStatePseudo(selectors[i]) ? stateSels : staticSels).push(selectors[i]);
    }
    var seen = new Set();
    var st = tallySelectors(doc, staticSels, seen);
    var ex = tallySelectors(doc, stateSels, seen); // only elements not already seen
    return {
      inDom: st.inDom + ex.inDom,
      onScreen: st.onScreen + ex.onScreen,
      onScreenStatic: st.onScreen,
      onScreenStateExtra: ex.onScreen,
      stateSelectorCount: stateSels.length,
      unmatchable: st.unmatchable + ex.unmatchable,
    };
  }

  function themeAllows(entry, themeName) {
    if (!entry.themeScopeMatch) return true; // theme-agnostic rule
    return entry.themeScopeMatch === themeName;
  }

  // Does component token `producer` currently resolve THROUGH `target` at
  // :root/body scope in the live document? Cached per _liveGen — a given
  // component token is referenced by many target tokens, but resolves once.
  function producerRoutesThrough(producer, target, index, themeTokens, body) {
    var key = target + "|" + producer;
    var hit = _routeCache.get(key);
    if (hit) return hit;
    var chainInfo = resolveChain(body, "var(" + producer + ")", index, themeTokens, {});
    var routes = chainInfo.chain.some(function (l) { return l.ref === target; });
    var unresolvedAtScope = chainInfo.chain.length === 0;
    var blockedBy = null;
    if (!routes && chainInfo.chain.length) {
      var firstLink = chainInfo.chain[0];
      if (
        firstLink.ref === producer &&
        firstLink.source &&
        (firstLink.source.kind === "palette-block" ||
          firstLink.source.kind === "theme-scoped-rule")
      ) {
        blockedBy = {
          token: producer,
          value: firstLink.value,
          file: firstLink.source.file,
          line: firstLink.source.line,
          kind: firstLink.source.kind,
        };
      }
    }
    var out = {
      routes: routes,
      unresolvedAtScope: unresolvedAtScope,
      blockedBy: blockedBy,
      terminal: chainInfo.terminal,
    };
    _routeCache.set(key, out);
    return out;
  }

  // Shared BFS behind both impact() and impactCount(): collect the flat
  // consumer entries for `targetToken` — direct, and via component-token
  // chains — with per-branch routing status. No grouping, no counting.
  function walkConsumers(targetToken, index, byToken, themeTokens, body) {
    var themeName = themeTokens && themeTokens.name;
    var direct = (byToken[targetToken] || []).filter(function (e) {
      return !e.producesToken && themeAllows(e, themeName);
    });
    var otherThemeDirect = (byToken[targetToken] || []).filter(function (e) {
      return !e.producesToken && !themeAllows(e, themeName);
    });

    var branches = [];
    var seenProducers = {};
    var queue = [];
    (byToken[targetToken] || []).forEach(function (e) {
      if (e.producesToken && !seenProducers[e.producesToken]) {
        queue.push({ token: e.producesToken, through: [targetToken] });
      }
    });

    var guard = 0;
    while (queue.length && guard < 200) {
      guard += 1;
      var item = queue.shift();
      var producer = item.token;
      if (seenProducers[producer]) continue;
      seenProducers[producer] = true;
      if (producer === targetToken) continue;

      var route = producerRoutesThrough(producer, targetToken, index, themeTokens, body);
      var producerConsumers = (byToken[producer] || []).filter(function (e) {
        return !e.producesToken && themeAllows(e, themeName);
      });

      if (producerConsumers.length || route.blockedBy) {
        branches.push({
          through: item.through.concat(producer),
          routes: route.routes,
          blockedBy: route.blockedBy,
          unresolvedAtScope: route.unresolvedAtScope,
          producerResolvesTo: route.terminal,
          entries: producerConsumers,
        });
      }

      (byToken[producer] || []).forEach(function (e) {
        if (e.producesToken && !seenProducers[e.producesToken]) {
          queue.push({ token: e.producesToken, through: item.through.concat(producer) });
        }
      });
    }

    return { direct: direct, otherThemeDirect: otherThemeDirect, branches: branches };
  }

  /**
   * Everywhere `targetToken` is consumed in the current theme's rendering.
   *
   * @param {string} targetToken   e.g. "--focus-border"
   * @param {object} opts          { doc, themeTokens }
   * @returns Promise<{
   *   token, theme, direct:[consumer], via:[{through:[...names], routes:bool,
   *     blockedBy?:{...}, consumers:[consumer]}], notes:[], sheets:[]
   * }>
   */
  function impact(targetToken, opts) {
    opts = opts || {};
    var doc = opts.doc || (typeof document !== "undefined" ? document : null);
    var themeTokens = opts.themeTokens || null;
    var themeName = themeTokens && themeTokens.name;

    return getRefMap(doc).then(function (bundle) {
      var index = bundle.index;
      var byToken = bundle.refMap.byToken;
      var body = doc.body || doc.documentElement;

      // Group entries that share a file:line + declaration (grouped selectors
      // in the source, and near-identical mobile/desktop variants, expand to
      // many index rules — collapse them back for display).
      function groupConsumers(entries, via) {
        var groups = Object.create(null);
        var orderList = [];
        entries.forEach(function (e) {
          var key = e.file + ":" + e.line + "|" + e.prop + "|" + e.value;
          var g = groups[key];
          if (!g) {
            g = groups[key] = {
              property: e.prop,
              declaration: e.prop + ": " + e.value,
              file: e.file,
              line: e.line,
              media: e.media,
              important: e.important,
              themeScoped: !!e.themeScopeMatch,
              via: via || null,
              selectors: [],
              liveVisible: 0,
              liveTotal: 0,
            };
            orderList.push(g);
          }
          if (g.selectors.indexOf(e.selector) === -1) {
            g.selectors.push(e.selector);
            var s = liveMatchStats(doc, e.selector);
            if (s.total != null) {
              g.liveTotal += s.total;
              g.liveVisible += s.visible;
            }
          }
        });
        orderList.sort(function (a, b) {
          return (a.file + "").localeCompare(b.file) || a.line - b.line;
        });
        return orderList;
      }

      var walk = walkConsumers(targetToken, index, byToken, themeTokens, body);
      var notes = [];

      var direct = groupConsumers(walk.direct, null);
      var via = walk.branches.map(function (b) {
        return {
          through: b.through,
          routes: b.routes,
          blockedBy: b.blockedBy,
          unresolvedAtScope: b.unresolvedAtScope,
          producerResolvesTo: b.producerResolvesTo,
          consumers: groupConsumers(b.entries, b.through),
        };
      });

      if (walk.otherThemeDirect.length) {
        notes.push(
          walk.otherThemeDirect.length +
            " direct consumer(s) are scoped to other themes and excluded from this list."
        );
      }

      return {
        ok: true,
        token: targetToken,
        theme: themeName || "(unknown)",
        sheets: index.sheetOrder,
        direct: direct,
        via: via,
        otherThemeDirectCount: walk.otherThemeDirect.length,
        notes: notes,
      };
    });
  }

  /**
   * Lightweight companion to impact(): just the on-screen count and the
   * union of consumer selectors, for the per-row badge + hover-highlight in
   * the Tokens tab. Same "affects" definition as impact() (shared
   * walkConsumers), minus the grouped/classified breakdown.
   *
   * @returns Promise<{ ok, token, theme, selectors:[...], onScreen, inDom,
   *   directCount, viaCount, hasConsumers, note }>
   */
  function impactCount(targetToken, opts) {
    opts = opts || {};
    var doc = opts.doc || (typeof document !== "undefined" ? document : null);
    var themeTokens = opts.themeTokens || null;
    var themeName = themeTokens && themeTokens.name;

    return getRefMap(doc).then(function (bundle) {
      var index = bundle.index;
      var byToken = bundle.refMap.byToken;
      var body = doc.body || doc.documentElement;
      var walk = walkConsumers(targetToken, index, byToken, themeTokens, body);

      var selSet = new Set();
      walk.direct.forEach(function (e) { selSet.add(e.selector); });
      var viaCount = 0;
      walk.branches.forEach(function (b) {
        if (!b.routes) return; // only branches that currently resolve through the target
        viaCount += 1;
        b.entries.forEach(function (e) { selSet.add(e.selector); });
      });
      var selectors = Array.from(selSet);
      var counts = countVisibleUnique(doc, selectors);

      return {
        ok: true,
        token: targetToken,
        theme: themeName || "(unknown)",
        selectors: selectors,
        onScreen: counts.onScreen,
        onScreenStatic: counts.onScreenStatic,
        onScreenStateExtra: counts.onScreenStateExtra,
        hasStateConsumers: counts.stateSelectorCount > 0,
        inDom: counts.inDom,
        directCount: walk.direct.length,
        viaCount: viaCount,
        hasConsumers: selectors.length > 0,
        otherThemeDirectCount: walk.otherThemeDirect.length,
      };
    });
  }

  // Pure aggregation for the Tokens-tab coverage summary (Phase 5). Reads the
  // map Phase 4's eager pass already produced — no DOM, no rescan.
  //   counts: { token -> { onScreen, hasConsumers, pending, error } }
  //   inherited: array or Set of token names the palette does NOT declare
  function summarizeCoverage(counts, inherited) {
    var inh = inherited && inherited.has ? inherited : new Set(inherited || []);
    var names = Object.keys(counts || {});
    var rendering = 0, pending = 0, errored = 0;
    var offScreen = []; // onScreen 0, but the theme's CSS references it
    var unused = []; // nothing in this theme references var(--token)
    names.forEach(function (name) {
      var c = counts[name];
      if (!c || c.pending) { pending += 1; return; }
      if (c.error) { errored += 1; return; }
      if ((c.onScreen || 0) > 0) { rendering += 1; return; }
      (c.hasConsumers ? offScreen : unused).push({ name: name, inherited: inh.has(name) });
    });
    offScreen.sort(byName);
    unused.sort(byName);
    return {
      total: names.length,
      rendering: rendering,
      pending: pending,
      errored: errored,
      offScreen: offScreen,
      unused: unused,
      zero: offScreen.length + unused.length,
    };
  }

  function byName(a, b) {
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  }

  // Coverage filter predicate (Phase 6). `mode` is "all" | "rendering" |
  // "offscreen". A token whose count is not yet known (pending) or errored
  // passes every mode, so filtering never hides a row we can't classify yet.
  function coverageMatch(count, mode) {
    if (!mode || mode === "all") return true;
    if (!count || count.pending || count.error) return true;
    var on = (count.onScreen || 0) > 0;
    return mode === "rendering" ? on : !on;
  }

  return {
    // browser
    trace: trace,
    impact: impact,
    impactCount: impactCount,
    summarizeCoverage: summarizeCoverage,
    coverageMatch: coverageMatch,
    buildIndex: buildIndex,
    buildRefMap: buildRefMap,
    walkConsumers: walkConsumers,
    invalidate: invalidate,
    bumpLiveGen: bumpLiveGen,
    liveGen: liveGen,
    // pure helpers (unit-tested in Node)
    parseStylesheet: parseStylesheet,
    computeSpecificity: computeSpecificity,
    cmpSpec: cmpSpec,
    firstVarRef: firstVarRef,
    anyVarRef: anyVarRef,
    allVarNames: allVarNames,
    hasTopLevelVar: hasTopLevelVar,
    hasAnyVar: hasAnyVar,
    splitTopLevel: splitTopLevel,
    colorPartOf: colorPartOf,
    isPaletteBlock: isPaletteBlock,
    subjectDesc: subjectDesc,
    hasStatePseudo: hasStatePseudo,
    countVisibleUnique: countVisibleUnique,
    stripComments: stripComments,
  };

  /* ===================================================================
   * Known limitations vs. real DevTools
   * -------------------------------------------------------------------
   *  - Specificity for :is()/:not()/:has() uses the max-argument rule but
   *    does not re-expand selector lists the way engines do; nested
   *    functional pseudo-classes beyond one level are approximated.
   *  - @media/@supports are evaluated with matchMedia/CSS.supports at trace
   *    time; an unparseable query is treated as matching (and flagged).
   *  - Shorthand colour extraction is heuristic (last colour-looking token
   *    in background/border). `border-<side>-color` longhands other than
   *    -top are not separately reported; the top edge is used as the
   *    representative border colour, matching the computed-value panel.
   *  - Cascade layers (@layer), structural pseudo-class re-matching after
   *    DOM changes, and animation/transition intermediate values are out of
   *    scope.
   *  - UA stylesheet and inherited-from-ancestor computed values are
   *    reported as "no authored rule", not traced further.
   * =================================================================== */
});
