"use strict";

/* Slate is a presentation layer, not a second application.
 *
 * These are the rules that keep it one: its stylesheets cannot reach the
 * application, its modules fork no state and write nothing outside the
 * page, it never connects or publishes to a bridge, and exactly two of
 * its files may dispatch a command - through the bridge they are handed,
 * never the global. The guard tests Station keeps over station/ scan
 * only station/; these are their equivalents over slate/.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = __dirname;
const SLATE = path.join(ROOT, "slate");
const STYLES = path.join(SLATE, "styles");

/* The roster. A new module is added here on purpose, with its place in
 * slate-host.js's SCRIPTS and slate.html. */
const SLATE_FILES = [
  "slate.js", "slate-shell.js", "slate-logo.js", "slate-line.js", "slate-source.js", "slate-demo.js",
  "slate-sections.js", "slate-rail.js", "slate-recipe.js", "slate-tracking.js", "slate-stat-cards.js",
  "slate-recipe-actions.js", "slate-plan-actions.js", "slate-book-actions.js", "slate-weight-actions.js", "slate-profile-actions.js",
  "slate-resin-search.js", "slate-recipe-drag.js", "slate-layer-menu.js", "slate-print.js",
  "slate-recipe-book.js", "slate-weights.js", "slate-sync.js", "slate-settings.js", "slate-timeline-layout.js", "slate-timeline.js", "slate-resin-balance.js",
  "slate-pressure.js", "slate-winding-tension.js"
];
const DISPATCHES = ["slate-tracking.js", "slate-stat-cards.js", "slate-recipe-actions.js", "slate-plan-actions.js", "slate-weight-actions.js"];
const REQUESTS = { connection: ["slate-sync.js"], recipes: ["slate-book-actions.js"], weightProfiles: ["slate-profile-actions.js"] };
const INNER_HTML = ["slate-sync.js"];
const TIMEOUTS = ["slate-timeline.js", "slate-recipe.js", "slate-layer-menu.js", "slate.js"];
/* The pure Station modules Slate shares: the run-down arithmetic and the
 * floor UI's print sheet. Both draw into whatever they are handed and
 * spend no Station token. */
const SHARED_STATION = ["station/station-rundown.js", "station/station-print-sheet.js"];

function read(file) {
  return fs.readFileSync(path.join(SLATE, file), "utf8");
}

function codeOnly(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function allCss() {
  const sheets = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".css")) sheets.push({ name: path.relative(ROOT, full), css: fs.readFileSync(full, "utf8") });
    }
  })(STYLES);
  return sheets;
}

function componentSheets() {
  return allCss().filter(sheet => !sheet.name.endsWith("host.css"));
}

function selectorsIn(css) {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const selectors = [];
  const pattern = /(^|[}{;])\s*([^{}@;]+?)\s*\{/g;
  let match;
  while ((match = pattern.exec(withoutComments))) {
    const text = match[2].trim();
    if (!text || text.startsWith("@")) continue;
    // Keyframe stops (from, to, 10%, "25%, 45%") are not selectors.
    for (const part of text.split(",")) if (part.trim() && !/^(from|to|\d+%)$/.test(part.trim())) selectors.push(part.trim());
  }
  return selectors;
}

/* ----------------------------------------------------------------------
 *   The roster
 * -------------------------------------------------------------------- */

test("every file in slate/ is on the roster, and every roster file exists", () => {
  const onDisk = fs.readdirSync(SLATE).filter(name => name.endsWith(".js")).sort();
  assert.deepEqual(onDisk, [...SLATE_FILES].sort(), "a slate/ module is missing from SLATE_FILES (or the reverse)");
  const host = codeOnly(fs.readFileSync(path.join(ROOT, "slate-host.js"), "utf8"));
  const harness = fs.readFileSync(path.join(SLATE, "slate.html"), "utf8");
  for (const file of SLATE_FILES) {
    assert.ok(host.includes(`"slate/${file}"`), `slate-host.js does not load ${file}`);
    assert.ok(harness.includes(`src="${file}?v=`), `slate.html does not load ${file}`);
  }
});

test("the harness and the host load the same Slate modules in the same order", () => {
  const host = codeOnly(fs.readFileSync(path.join(ROOT, "slate-host.js"), "utf8"));
  const hostOrder = [...host.matchAll(/"(slate\/[^"]+\.js|station\/[^"]+\.js)"/g)].map(match => match[1].replace(/^slate\//, ""));
  const harness = fs.readFileSync(path.join(SLATE, "slate.html"), "utf8");
  const harnessOrder = [...harness.matchAll(/src="(?:\.\.\/)?((?:station\/)?[^"?]+\.js)\?v=/g)].map(match => match[1])
    .filter(file => (/^slate/.test(file) && file !== "slate-theme.js" && file !== "slate-display.js") || SHARED_STATION.includes(file));
  assert.deepEqual(harnessOrder, hostOrder);
  const hostSheets = [...host.matchAll(/"slate\/styles\/([^"]+\.css)"/g)].map(match => match[1]).filter(name => name !== "host.css");
  const harnessSheets = [...harness.matchAll(/href="styles\/([^"?]+\.css)\?v=/g)].map(match => match[1]);
  assert.deepEqual(harnessSheets, hostSheets);
});

test("the harness never loads the application, and every shared module it does load is UI-independent", () => {
  const harness = fs.readFileSync(path.join(SLATE, "slate.html"), "utf8");
  assert.doesNotMatch(harness, /app\.js|cloud-sync|line-sync|workspace-recovery/, "the harness runs application code");
  const shared = [...harness.matchAll(/src="\.\.\/([^"?]+)/g)].map(match => match[1]);
  assert.ok(shared.length > 0);
  for (const file of shared) {
    const source = fs.readFileSync(path.join(ROOT, file), "utf8");
    assert.doesNotMatch(source, /document\.(getElementById|querySelector|createElement)/, `${file} touches the DOM, so Slate must not load it directly`);
  }
});

/* ----------------------------------------------------------------------
 *   Slate CSS cannot reach the application
 * -------------------------------------------------------------------- */

test("every Slate component selector is namespaced, so it cannot match an application element", () => {
  for (const sheet of componentSheets()) {
    for (const selector of selectorsIn(sheet.css)) {
      assert.ok(/(^|[\s>+~(])\.slate-/.test(selector), `${sheet.name}: selector "${selector}" is not anchored to a slate- class`);
    }
  }
});

test("Slate styles no bare element outside its own base layer", () => {
  for (const sheet of componentSheets()) {
    if (sheet.name.endsWith("base.css")) continue;
    for (const selector of selectorsIn(sheet.css)) {
      assert.doesNotMatch(selector, /(^|[\s>+~,])(html|body|div|span|button|input|select|textarea|a|p|ul|li|table|h1|h2|h3|nav|aside|header|section)\b/,
        `${sheet.name}: "${selector}" styles a bare element outside base.css`);
    }
  }
});

test("the Slate base layer's element rules are all scoped inside .slate-root", () => {
  const base = allCss().find(sheet => sheet.name.endsWith("base.css"));
  for (const selector of selectorsIn(base.css)) {
    assert.match(selector, /^\.slate-/, `base.css: "${selector}" escapes the Slate root`);
  }
});

test("no Slate rule is styled by id, and no component rule uses !important", () => {
  for (const sheet of allCss()) {
    for (const selector of selectorsIn(sheet.css)) assert.doesNotMatch(selector, /#/, `${sheet.name}: "${selector}" styles by id`);
  }
  for (const sheet of componentSheets()) assert.doesNotMatch(sheet.css, /!important/, `${sheet.name} uses !important`);
});

test("no Slate selector is deep enough to depend on document structure", () => {
  for (const sheet of componentSheets()) {
    for (const selector of selectorsIn(sheet.css)) {
      const steps = selector.split(/[\s>+~]+/).filter(Boolean).length;
      assert.ok(steps <= 2, `${sheet.name}: "${selector}" is ${steps} steps deep`);
      assert.doesNotMatch(selector, /:nth-child/, `${sheet.name}: "${selector}" depends on child position`);
    }
  }
});

test("Slate state is expressed semantically, never as a visual name", () => {
  const banned = /\.(red|green|blue|yellow|orange|small|large|big|wide|narrow|bold|grey|gray)\b/;
  for (const sheet of componentSheets()) {
    for (const selector of selectorsIn(sheet.css)) assert.doesNotMatch(selector, banned, `${sheet.name}: "${selector}" names a colour or a size`);
    for (const match of sheet.css.matchAll(/\.(is-[a-z0-9-]+)/g)) assert.match(match[1], /^is-[a-z][a-z0-9-]*$/);
  }
});

test("raw colours live only in the theme mappings, and no sheet spends a Station token", () => {
  for (const sheet of allCss()) {
    const body = sheet.css.replace(/\/\*[\s\S]*?\*\//g, "");
    assert.doesNotMatch(body, /--station-/, `${sheet.name} spends a Station token`);
    if (sheet.name.includes("styles/themes/")) continue;
    assert.doesNotMatch(body, /#[0-9a-f]{3,8}\b/i, `${sheet.name} hard-codes a hex colour`);
    assert.doesNotMatch(body, /\brgba?\(/i, `${sheet.name} hard-codes an rgb colour`);
  }
});

test("Slate has no width breakpoint, so narrowing the browser cannot replace or reflow it", () => {
  const conditions = new Set();
  for (const sheet of componentSheets()) {
    for (const match of sheet.css.matchAll(/@media([^{]+)\{/g)) {
      const condition = match[1].replace(/\s+/g, " ").trim();
      if (/^\(prefers-[a-z-]+:/.test(condition)) continue;
      conditions.add(condition);
    }
  }
  assert.deepEqual([...conditions].sort(), [], "Slate gained an undocumented width breakpoint");
});

test("every keyframe is named slate-<thing> and has a reduced-motion switch in the same file", () => {
  for (const sheet of componentSheets()) {
    const names = [...sheet.css.matchAll(/@keyframes\s+([\w-]+)/g)].map(match => match[1]);
    for (const name of names) {
      assert.match(name, /^slate-[a-z][a-z-]*$/, `${sheet.name}: keyframes ${name}`);
    }
    if (names.length > 0) assert.match(sheet.css, /@media \(prefers-reduced-motion: reduce\)/, `${sheet.name} animates with no reduced-motion switch`);
  }
  const tokens = allCss().find(sheet => sheet.name.endsWith("tokens.css")).css;
  assert.match(tokens, /@media \(prefers-reduced-motion: reduce\)[\s\S]*--slate-motion-move: 0ms/, "the global motion off-switch is missing");
});

test("no stylesheet carries an override pile at its own level", () => {
  for (const sheet of allCss()) {
    const topLevel = sheet.css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@media[^{]+\{[\s\S]*?\n\}/g, "").replace(/@keyframes[^{]+\{[\s\S]*?\n\}/g, "");
    const declared = new Map();
    const collisions = [];
    const rule = /(^|[};{])\s*([^{}@;]+?)\s*\{([^{}]*)\}/g;
    let match;
    while ((match = rule.exec(topLevel))) {
      const selectorText = match[2].trim();
      if (!selectorText || selectorText.startsWith("@")) continue;
      const properties = match[3].split(";").filter(one => one.includes(":")).map(one => one.split(":")[0].trim());
      for (const selector of selectorText.split(",").map(one => one.trim()).filter(Boolean)) {
        if (!declared.has(selector)) declared.set(selector, new Set());
        const seen = declared.get(selector);
        for (const property of properties) {
          if (seen.has(property)) collisions.push(`${selector} { ${property} }`);
          seen.add(property);
        }
      }
    }
    assert.deepEqual(collisions, [], `${sheet.name} sets these twice at top level`);
  }
});

test("no application stylesheet claims a slate- class", () => {
  for (const name of fs.readdirSync(ROOT).filter(one => one.endsWith(".css"))) {
    const css = fs.readFileSync(path.join(ROOT, name), "utf8");
    assert.doesNotMatch(css, /\.slate-/, `${name} styles a Slate class`);
  }
});

/* ----------------------------------------------------------------------
 *   Slate owns no application state and writes nothing outside the page
 * -------------------------------------------------------------------- */

test("Slate defines no parallel copy of application state", () => {
  const forbidden = /\b(slateRecipeState|slateLayers|slateHoppers|slateActiveJob|slateSyncState)\b/;
  for (const file of SLATE_FILES) assert.doesNotMatch(read(file), forbidden, `${file} forks application state`);
});

test("Slate writes nothing to storage, sync, or the network", () => {
  for (const file of SLATE_FILES) {
    const source = codeOnly(read(file));
    for (const pattern of [/localStorage/, /sessionStorage/, /\bfetch\s*\(/, /XMLHttpRequest/, /supabase/i, /WebSocket/, /location\.reload/]) {
      assert.doesNotMatch(source, pattern, `${file} reaches outside the page`);
    }
  }
  // The theme and display controllers are the two Slate modules that
  // persist, and they are the host's, not slate/'s: one key each.
  const theme = codeOnly(fs.readFileSync(path.join(ROOT, "slate-theme.js"), "utf8"));
  assert.equal((theme.match(/setItem\(/g) || []).length, 1);
  assert.match(theme, /polyn\.slate\.theme\.v1/);
  const display = codeOnly(fs.readFileSync(path.join(ROOT, "slate-display.js"), "utf8"));
  assert.equal((display.match(/setItem\(/g) || []).length, 1);
  assert.match(display, /polyn\.slate\.display\.v1/);
});

test("Slate never writes through a bridge - it only reads and subscribes", () => {
  for (const file of SLATE_FILES) {
    const source = codeOnly(read(file));
    assert.doesNotMatch(source, /\.connect\s*\(/, `${file} connects a producer to a bridge`);
    assert.doesNotMatch(source, /\.publish\s*\(/, `${file} publishes to a bridge`);
    for (const match of source.matchAll(/(\w+)\.subscribe\s*\(/g)) {
      assert.ok(["bridge", "connection", "admin", "recipes", "profiles", "controller", "theme", "display", "displayController"].includes(match[1]), `${file} subscribes to ${match[1]}`);
    }
  }
});

test("exactly five Slate files dispatch commands - tracking, the job's cards, the recipe's edits, the plan's moves and the weights - and only through the bridge they are handed", () => {
  for (const file of SLATE_FILES) {
    const source = codeOnly(read(file));
    if (DISPATCHES.includes(file)) {
      assert.match(source, /commands\.dispatch\s*\(/, `${file} should dispatch on the bridge it is handed`);
    } else {
      assert.doesNotMatch(source, /\.dispatch\s*\(/, `${file} dispatches a command`);
    }
    assert.doesNotMatch(source, /PolynStationCommandBridge\.dispatch/, `${file} dispatches on the global`);
  }
  // The boot file hands the bridge over and dispatches nothing itself.
  assert.doesNotMatch(codeOnly(read("slate.js")), /dispatch\s*\(/);
});

test("exactly one Slate file requests connection actions, one recipe actions, one weight-profile actions, and none asks the admin bridge for anything", () => {
  for (const file of SLATE_FILES) {
    const source = codeOnly(read(file));
    if (REQUESTS.connection.includes(file)) assert.match(source, /connection\.request\s*\(/);
    else if (REQUESTS.recipes.includes(file)) assert.match(source, /recipes\.request\s*\(/);
    else if (REQUESTS.weightProfiles.includes(file)) assert.match(source, /profiles\.request\s*\(/);
    else assert.doesNotMatch(source, /\.request\s*\(/, `${file} requests a bridge action`);
    assert.doesNotMatch(source, /admin\.request/, `${file} asks the admin bridge to act`);
    // The recipes and weight-profiles bridges are read from their globals
    // once each, by the boot file, and handed on: the seams act on the
    // bridge they are given.
    for (const [global, name] of [["PolynStationRecipesBridge", "recipes"], ["PolynStationWeightProfilesBridge", "weight-profiles"]]) {
      if (file === "slate.js") assert.equal((source.match(new RegExp(global, "g")) || []).length, 1, `slate.js reads the ${name} bridge other than once`);
      else assert.ok(!source.includes(global), `${file} reaches the ${name} bridge global`);
    }
  }
});

test("innerHTML, timers and animation are confined to the files licensed for them", () => {
  for (const file of SLATE_FILES) {
    const source = codeOnly(read(file));
    if (!INNER_HTML.includes(file)) assert.doesNotMatch(source, /innerHTML/, `${file} writes markup`);
    if (!TIMEOUTS.includes(file)) assert.doesNotMatch(source, /setTimeout/, `${file} sets a timer`);
    assert.doesNotMatch(source, /setInterval|requestAnimationFrame|\.animate\s*\(/, `${file} animates from script; Slate's motion is CSS`);
  }
});

test("Slate queries only inside its own container, never the document", () => {
  for (const file of SLATE_FILES) {
    const source = codeOnly(read(file));
    if (file === "slate.js") {
      // The one document-wide lookup is the mount point itself.
      assert.equal((source.match(/doc\.querySelector\(/g) || []).length, 1);
      assert.match(source, /doc\.querySelector\("\[data-slate-app\]"\)/);
    } else {
      assert.doesNotMatch(source, /document\.(querySelector|getElementById|body)/, `${file} reaches into the document`);
    }
  }
});

/* ----------------------------------------------------------------------
 *   Slate ships to the web only
 * -------------------------------------------------------------------- */

test("Slate is not bundled into the Android shell", () => {
  const www = path.join(ROOT, "www");
  if (!fs.existsSync(www)) return;
  const files = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else files.push(path.relative(www, full));
    }
  })(www);
  assert.deepEqual(files.filter(file => file.startsWith("slate/")), [], "www/ carries Slate's modules");
});
