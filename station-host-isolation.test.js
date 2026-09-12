"use strict";

/* The host boundary.
 *
 * Two of Station's CSS rules were relaxed to let host.css exist: it may name an
 * application selector, and it may use !important. This file is what that
 * relaxation was traded for. host.css is held to rules the component sheets are
 * not: every selector gated on the Station view attribute, a hard size cap, and
 * no way to touch the application unless the flag is set.
 *
 * The property that actually matters is the one at the top: with no
 * ?view=station, nothing about Station is in the document at all.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = __dirname;
const host = fs.readFileSync(path.join(ROOT, "station-host.js"), "utf8");
const hostCss = fs.readFileSync(path.join(ROOT, "station/styles/host.css"), "utf8");
const indexHtml = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  /* Every element type Station renders, HTML and SVG.
 *
 * The SVG half was added with the machine schematic, and it is the half this
 * test exists for now. The previous audit found no bare `svg`, `g`, `path`,
 * `rect` or `text` rules in the legacy stylesheets - but that is a fact about
 * today, not a boundary. The machine puts hundreds of SVG elements into the
 * application's document, so the first legacy `text { font-size: ... }` would
 * reach every label on the machine. This fails the moment that happens, and
 * names the rule.
 *
 * Derived rather than hand-listed where it can be: station-machine-parts.js
 * is the only place SVG elements are created, so the list is checked against
 * what that file actually creates. */
const STATION_ELEMENTS = ["button", "input", "h1", "h2", "p", "dl", "dt", "dd", "ol", "ul", "li",
  "div", "span", "section", "nav", "aside", "header", "footer",
  "table", "thead", "tbody", "tfoot", "tr", "td", "th",
  "svg", "g", "path", "rect", "circle", "line", "text", "tspan", "ellipse",
  "polygon", "polyline", "defs", "linearGradient", "stop", "use", "clipPath", "mask", "marker", "foreignObject"];

const VIEW_GATE = '[data-station-view="station"]';

/* Source assertions must read CODE, not prose. These files explain themselves
 * at length, and a comment that says "app.js starts exactly as it always does"
 * is not app.js being loaded. Stripping comments first is the difference
 * between a guard and a tripwire for whoever writes the next paragraph. */
function codeOnly(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function cssCode(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

function selectorsIn(css) {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const selectors = [];
  const pattern = /(^|[}{;])\s*([^{}@;]+?)\s*\{/g;
  let match;
  while ((match = pattern.exec(withoutComments))) {
    const text = match[2].trim();
    if (!text || text.startsWith("@")) continue;
    for (const part of text.split(",")) if (part.trim()) selectors.push(part.trim());
  }
  return selectors;
}

/* ----------------------------------------------------------------------
 *   Normal startup is untouched
 * -------------------------------------------------------------------- */

test("without the flag, the host returns before touching the document", () => {
  // The guarantee is structural, not "the rules happen not to match": in normal
  // mode no Station stylesheet, element or attribute is ever created.
  const gate = codeOnly(host).indexOf("if (!requested()) return;");
  assert.ok(gate > -1, "the host has no early return for the normal case");

  const before = codeOnly(host).slice(0, gate);
  for (const sideEffect of [/appendChild/, /createElement/, /setAttribute/, /classList/, /\.rel\s*=/, /\.src\s*=/]) {
    assert.doesNotMatch(before, sideEffect,
      "the host touches the document before deciding whether Station was asked for");
  }
});

test("every asset the host loads is loaded dynamically, never linked in index.html", () => {
  // A statically linked Station stylesheet would be inert but present, and
  // "inert but present" stops being true one edit later.
  for (const asset of ["station/styles/tokens.css", "station/styles/host.css",
    "station/station.js", "station/station-render.js", "station/station-shell.js"]) {
    assert.ok(codeOnly(host).includes(asset), `the host does not load ${asset}`);
    assert.ok(!indexHtml.includes(asset), `index.html statically links ${asset}`);
  }
});

test("the host is the only thing that sets the view attribute", () => {
  assert.match(host, /const ATTRIBUTE = "data-station-view";/);
  assert.match(host, /doc\.body\.setAttribute\(ATTRIBUTE, VALUE\)/);
  const app = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
  assert.doesNotMatch(app, /data-station-view/, "app.js sets the Station view attribute");
});

test("the flag is read from the URL and matched exactly", () => {
  assert.match(host, /const FLAG = "view";/);
  assert.match(host, /const VALUE = "station";/);
  assert.match(host, /searchParams\.get\(FLAG\) === VALUE/);
  // An unreadable URL must mean "not requested", never "assume yes".
  assert.match(host, /catch \(error\) \{\s*return false;\s*\}/);
});

/* ----------------------------------------------------------------------
 *   host.css is inert unless the flag is set
 * -------------------------------------------------------------------- */

test("every rule in host.css is gated on the Station view attribute", () => {
  const selectors = selectorsIn(hostCss);
  assert.ok(selectors.length > 0);
  for (const selector of selectors) {
    assert.ok(selector.includes(VIEW_GATE),
      `host.css: "${selector}" is not gated on ${VIEW_GATE}, so it could affect a normal load`);
  }
});

test("host.css stays small enough to read in one sitting", () => {
  // The size cap is the point: an integration layer that grows is an
  // integration layer that has started making design decisions.
  const selectors = selectorsIn(hostCss);
  assert.ok(selectors.length <= 3,
    `host.css has ${selectors.length} rules; it is the boundary, not a component`);
});

test("host.css hides the application by exclusion, never by naming its elements", () => {
  // Naming them would be a list that goes stale the first time the application
  // grows a new top-level root - and would make this file own legacy selectors.
  assert.match(hostCss, /body\[data-station-view="station"\] > :not\(\[data-station-host\]\)/);
  for (const legacy of ["main", "footer", "dialog", "#appOverlayRoot", ".footerBar", ".mobileFooterMeta"]) {
    const selectors = selectorsIn(hostCss).join(" | ");
    assert.ok(!new RegExp(`(^|[\\s>+~,(])${legacy.replace(/[.#]/g, "\\$&")}([\\s>+~,)]|$)`).test(selectors),
      `host.css names the legacy element ${legacy}`);
  }
});

test("!important appears only in host.css, and only on the hide rule", () => {
  const sheets = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".css")) sheets.push(full);
    }
  })(path.join(ROOT, "station/styles"));

  for (const sheet of sheets) {
    const css = fs.readFileSync(sheet, "utf8");
    if (path.basename(sheet) === "host.css") continue;
    assert.doesNotMatch(css, /!important/, `${path.relative(ROOT, sheet)} uses !important`);
  }
  assert.equal((cssCode(hostCss).match(/!important/g) || []).length, 1,
    "host.css uses !important more than once - it is licensed for the hide rule only");
  assert.match(cssCode(hostCss), /display: none !important;/);
});

/* ----------------------------------------------------------------------
 *   Legacy CSS cannot style Station
 * -------------------------------------------------------------------- */

test("Station's base layer covers every property the legacy sheets set on bare elements it uses", () => {
  /* Inside the application document, a legacy `button { ... }` rule matches
   * Station's buttons. Station's own `.station-root button` out-specifies it,
   * but only for properties it actually declares - so this derives the list
   * from the legacy stylesheets rather than trusting anyone to remember it.
   * If legacy adds a property to a bare-element rule, this fails and names it. */
  // Hoisted to module scope so both tests below check one list.

  const legacySheets = fs.readdirSync(ROOT)
    .filter(name => name.endsWith(".css"))
    .map(name => ({ name, css: fs.readFileSync(path.join(ROOT, name), "utf8").replace(/\/\*[\s\S]*?\*\//g, "") }));

  const reaching = new Map();
  for (const sheet of legacySheets) {
    const pattern = /(^|[};{])\s*([^{}@;]+?)\s*\{([^{}]*)\}/g;
    let match;
    while ((match = pattern.exec(sheet.css))) {
      const selectorText = match[2].trim();
      if (!selectorText || selectorText.startsWith("@")) continue;
      for (const selector of selectorText.split(",").map(one => one.trim())) {
        if (!STATION_ELEMENTS.includes(selector)) continue;
        for (const declaration of match[3].split(";")) {
          if (!declaration.includes(":")) continue;
          const property = declaration.split(":")[0].trim();
          if (!reaching.has(selector)) reaching.set(selector, new Map());
          reaching.get(selector).set(property, sheet.name);
        }
      }
    }
  }

  const base = fs.readFileSync(path.join(ROOT, "station/styles/base.css"), "utf8");
  const uncovered = [];
  for (const [element, properties] of reaching) {
    const rule = base.match(new RegExp(`\\.station-root ${element}\\s*\\{([^}]*)\\}`));
    const declared = rule
      ? new Set(rule[1].split(";").filter(one => one.includes(":")).map(one => one.split(":")[0].trim()))
      : new Set();
    // `font` is the shorthand covering font-size/weight/family/line-height.
    if (declared.has("font")) ["font-size", "font-weight", "font-family", "line-height"].forEach(one => declared.add(one));
    for (const [property, sheetName] of properties) {
      if (!declared.has(property)) uncovered.push(`${element}{${property}} from ${sheetName}`);
    }
  }
  assert.deepEqual(uncovered, [],
    "the legacy stylesheets set these on elements Station renders, and Station's base layer does not reset them - " +
    "inside ?view=station they would leak into Station");
});

test("the Station shell avoids the one element the legacy grid owns", () => {
  // Legacy styles bare `main` with its own grid, and the application already
  // has a <main>; a second one is invalid as well as mis-styled.
  const shell = fs.readFileSync(path.join(ROOT, "station/station-shell.js"), "utf8");
  assert.doesNotMatch(shell, /createElement\("main"\)|"main"/,
    "the Station shell builds a <main>, which the legacy grid styles and the application already has");
  assert.match(shell, /createElement/);
});

/* ----------------------------------------------------------------------
 *   One application, one producer
 * -------------------------------------------------------------------- */

test("the host starts no application code and owns no state", () => {
  const code = codeOnly(host);
  for (const pattern of [/PolynCloudSync/, /supabase/i, /localStorage/, /\bfetch\s*\(/,
    /app\.js/, /\.connect\s*\(/, /\.publish\s*\(/, /\.project\s*\(/, /PolynStationStateBridge/]) {
    assert.doesNotMatch(code, pattern,
      `station-host.js does more than switch presentation (matched ${pattern})`);
  }
});

test("the host never loads app.js or any application UI script a second time", () => {
  const scripts = [...codeOnly(host).matchAll(/"([^"]+\.js)"/g)].map(match => match[1]);
  assert.ok(scripts.length > 0);
  for (const script of scripts) {
    assert.ok(script.startsWith("station/"),
      `the host loads ${script}, which is not part of the Station presentation`);
  }
});

test("index.html loads app.js exactly once, and the bridge before it", () => {
  assert.equal((indexHtml.match(/src="app\.js\?/g) || []).length, 1);
  assert.ok(indexHtml.indexOf("station-state-bridge.js") < indexHtml.indexOf('src="app.js'));
  assert.ok(indexHtml.indexOf("station-host.js") < indexHtml.indexOf('src="app.js'));
});

test("only app.js connects a producer; the host and Station only consume", () => {
  const app = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
  assert.equal((app.match(/stationBridge\.connect\s*\(/g) || []).length, 1);
  for (const file of ["station-host.js", "station/station.js", "station/station-source.js"]) {
    const source = fs.readFileSync(path.join(ROOT, file), "utf8");
    assert.doesNotMatch(source, /\.connect\s*\(\s*\{/, `${file} connects a second producer`);
  }
});

/* ----------------------------------------------------------------------
 *   One shell, shared by both hosts
 * -------------------------------------------------------------------- */

test("the harness and the application host build the same shell from the same builder", () => {
  const harness = fs.readFileSync(path.join(ROOT, "station/station.html"), "utf8");
  // Neither restates the shell's markup. Checked as class attributes rather
  // than as substrings, so the station-shell.js script tag is not mistaken for
  // a .station-shell element.
  for (const marker of ["station-shell", "station-header", "station-machine", "station-status"]) {
    const asClass = new RegExp(`class="[^"]*\\b${marker}\\b`);
    assert.doesNotMatch(harness, asClass, `station.html restates shell markup (.${marker})`);
    assert.doesNotMatch(codeOnly(host), new RegExp(`"${marker}"`),
      `station-host.js restates shell markup (.${marker})`);
  }
  assert.match(harness, /data-station-app/);
  assert.match(codeOnly(host), /data-station-app/);
  assert.ok(fs.existsSync(path.join(ROOT, "station/station-shell.js")));
});

test("the harness and the application host load the same Station modules", () => {
  const harness = fs.readFileSync(path.join(ROOT, "station/station.html"), "utf8");
  const harnessModules = [...harness.matchAll(/src="(station-[^"?]+)\.js/g)].map(match => `${match[1]}.js`);
  const hostModules = [...codeOnly(host).matchAll(/"station\/(station-[^"]+\.js)"/g)].map(match => match[1])
    .filter(name => name !== "station.js");
  for (const module of hostModules) {
    assert.ok(harnessModules.includes(module),
      `${module} is loaded by the application host but not by the harness - the two have forked`);
  }
});

/* ----------------------------------------------------------------------
 *   SVG isolation
 * -------------------------------------------------------------------- */

test("STATION_ELEMENTS covers every SVG element the machine actually creates", () => {
  /* The protection above is only as good as the list. This derives what the
   * machine really builds from the one file allowed to build it, so adding a
   * <polyline> to the artwork without protecting it fails here rather than
   * silently leaving that element exposed to the legacy cascade. */
  const source = fs.readFileSync(path.join(ROOT, "station/station-machine-parts.js"), "utf8");
  const created = new Set();
  for (const match of codeOnly(source).matchAll(/node\(doc,\s*"([a-zA-Z]+)"/g)) created.add(match[1]);
  for (const match of codeOnly(source).matchAll(/createElementNS\([^,]+,\s*name\)/g)) { /* generic */ }
  // The renderer creates the root <svg> itself.
  const renderSource = fs.readFileSync(path.join(ROOT, "station/station-render.js"), "utf8");
  for (const match of codeOnly(renderSource).matchAll(/parts\.node\(doc,\s*"([a-zA-Z]+)"/g)) created.add(match[1]);

  assert.ok(created.size > 0, "no SVG elements were found - has the parts file moved?");
  const covered = STATION_ELEMENTS;
  const unprotected = [...created].filter(name => !covered.includes(name));
  assert.deepEqual(unprotected, [],
    "the machine creates these element types and the legacy-coverage test does not check them");
});

test("the machine stylesheets stay inside the token system", () => {
  // Raw colours in a component sheet are how a themeable drawing stops being
  // themeable. tokens.css is the only place a literal colour may appear.
  for (const name of ["machine.css", "hopper.css"]) {
    const css = fs.readFileSync(path.join(ROOT, "station/styles/components", name), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i, `${name} hard-codes a hex colour`);
    assert.doesNotMatch(css, /\brgba?\(/i, `${name} hard-codes an rgb colour`);
  }
});

/* ----------------------------------------------------------------------
 *   Motion
 * -------------------------------------------------------------------- */

test("the only animation is the agitator, and it is CSS with no JavaScript timer", () => {
  const fs_ = require("node:fs");
  const sheets = ["machine.css", "hopper.css", "layer-bank.css"]
    .map(name => ({ name, css: fs_.readFileSync(path.join(ROOT, "station/styles/components", name), "utf8") }));

  const animated = sheets.filter(sheet => /@keyframes|animation:/.test(cssCode(sheet.css)));
  assert.deepEqual(animated.map(s => s.name), ["layer-bank.css"],
    "animation appeared outside the component that owns the agitator");

  // Exactly one keyframes block, applied to exactly one selector.
  const css = cssCode(animated[0].css);
  assert.equal((css.match(/@keyframes/g) || []).length, 1);
  // `animation: none` is the reduced-motion switch-off, not a second animation.
  const applied = (css.match(/animation:\s*[^;]+;/g) || [])
    .filter(one => !/animation:\s*none/.test(one));
  assert.equal(applied.length, 1, "more than one thing is being animated");
  assert.match(applied[0], /station-agitate/);

  // No Station file spins anything from JavaScript: no timers, no frame
  // loop. The one script that animates is the transition (finite Web
  // Animations, transform and opacity, run by the compositor), and only it.
  const stationDir = path.join(ROOT, "station");
  const stationFiles = fs.readdirSync(stationDir).filter(name => name.endsWith(".js"));
  assert.ok(stationFiles.length > 4, "expected to find the Station modules");
  for (const file of stationFiles.concat(["station-host.js"])) {
    const full = file === "station-host.js" ? path.join(ROOT, file) : path.join(stationDir, file);
    const source = codeOnly(fs_.readFileSync(full, "utf8"));
    for (const pattern of [/setInterval/, /requestAnimationFrame/]) {
      assert.doesNotMatch(source, pattern, `${file} drives animation from JavaScript`);
    }
    if (file !== "station-transition.js") {
      assert.doesNotMatch(source, /\.animate\s*\(/, `${file} animates outside the transition module`);
    }
  }
});

test("reduced motion turns the agitator off", () => {
  const css = cssCode(fs.readFileSync(path.join(ROOT, "station/styles/components/layer-bank.css"), "utf8"));
  const block = css.match(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(block, "there is no prefers-reduced-motion block");
  assert.match(block[1], /animation:\s*none/);
  assert.match(block[1], /station-mixer__agitator/);
});

test("reduced motion is not counted as one of Station's two layout breakpoints", () => {
  // It is a preference query, not a width - the breakpoint guard must stay
  // about layout, and must not start accepting arbitrary media queries.
  const layout = cssCode(fs.readFileSync(path.join(ROOT, "station/styles/shell.css"), "utf8"));
  assert.doesNotMatch(layout, /prefers-reduced-motion/);
});

test("a ghost layer is inert to the pointer as a whole, not only at its hit rectangles", () => {
  /* Ghosts fade to opacity 0 but stand where the open layer's editor and
   * hoppers are drawn. Every path in them would still take a click - an
   * invisible receiver under an editor row would resolve to a cluster on
   * another layer and close the view. The rule is on the group. */
  const css = cssCode(fs.readFileSync(path.join(ROOT, "station/styles/components/layer-bank.css"), "utf8"));
  const rule = css.match(/\.station-layer\.is-dimmed\s*\{([^}]*)\}/);
  assert.ok(rule, "no rule for .station-layer.is-dimmed");
  assert.match(rule[1], /pointer-events:\s*none/);
  // And the boot file refuses a click that reaches it from a ghost or from a
  // layer other than the open one - the cluster can never close a layer.
  const boot = codeOnly(fs.readFileSync(path.join(ROOT, "station/station.js"), "utf8"));
  assert.match(boot, /classList\.contains\("is-dimmed"\)\)\s*return/);
  assert.match(boot, /if \(shown && layer !== shown\) return/);
});

test("the agitator is animated only while the layer is running", () => {
  // Whatever the layer's emphasis: a dimmed layer keeps turning under its
  // fade so it has not been reset when it comes back, and the transition
  // hands the rotor's phase across renders.
  const css = cssCode(fs.readFileSync(path.join(ROOT, "station/styles/components/layer-bank.css"), "utf8"));
  assert.match(css, /\.station-layer\.is-running\s+\.station-mixer__agitator\s*\{[^}]*animation:/);
  assert.doesNotMatch(css, /is-running:not\(\.is-dimmed\)/);
});

/* ----------------------------------------------------------------------
 *   The Extruder Lab is development-only
 * -------------------------------------------------------------------- */

test("the application host cannot reach the extruder lab", () => {
  /* It is loaded by the standalone harness and by nothing else, so
   * `PolynStationExtruderLab` is simply undefined in the application and the
   * ?lab= branch can never fire there whatever the URL says. */
  assert.ok(!codeOnly(host).includes("station-extruder-lab"),
    "station-host.js loads the development-only extruder lab");
  const harness = fs.readFileSync(path.join(ROOT, "station/station.html"), "utf8");
  assert.match(harness, /station-extruder-lab\.js/);
});

test("the lab is guarded on the module being present, not only on the URL", () => {
  const boot = codeOnly(fs.readFileSync(path.join(ROOT, "station/station.js"), "utf8"));
  const guard = boot.slice(boot.indexOf("function labRequested()"));
  const body = guard.slice(0, guard.indexOf("\n  function "));
  assert.match(body, /if \(!root\.PolynStationExtruderLab\) return false;/);
  assert.match(body, /searchParams\.get\("lab"\) === "extruder"/);
});

test("the lab is removable in three edits, and says so", () => {
  // A study that cannot be deleted cleanly becomes permanent by accident.
  const lab = fs.readFileSync(path.join(ROOT, "station/station-extruder-lab.js"), "utf8");
  assert.match(lab, /REMOVING IT/);
  // Nothing outside those three places refers to it.
  const referrers = fs.readdirSync(path.join(ROOT, "station"))
    .filter(name => name.endsWith(".js") && name !== "station-extruder-lab.js")
    .filter(name => /station-extruder-lab|PolynStationExtruderLab/
      .test(fs.readFileSync(path.join(ROOT, "station", name), "utf8")));
  assert.deepEqual(referrers, ["station.js"]);
});

test("lab styles cannot reach the product stage", () => {
  // Scoped to station-lab classes, which nothing in the product emits.
  const css = cssCode(fs.readFileSync(path.join(ROOT, "station/styles/components/layer-bank.css"), "utf8"));
  const labRules = css.match(/\.station-lab__[a-z-]+/g) || [];
  assert.ok(labRules.length > 0);
  const parts = fs.readFileSync(path.join(ROOT, "station/station-machine-parts.js"), "utf8");
  assert.doesNotMatch(parts, /station-lab/, "the product renderer emits a lab class");
});
