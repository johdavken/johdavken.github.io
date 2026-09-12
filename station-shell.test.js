"use strict";

/* The shell builder is what keeps the standalone harness and the in-app host
 * from forking. These tests check the structure both of them depend on, and
 * the two element choices that exist specifically because Station has to be
 * able to live inside the application's document.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const shell = require("./station/station-shell.js");

function makeNode(name) {
  return {
    nodeName: name.toUpperCase(),
    attributes: {},
    children: [],
    textContent: "",
    setAttribute(key, value) { this.attributes[key] = String(value); },
    getAttribute(key) { return Object.prototype.hasOwnProperty.call(this.attributes, key) ? this.attributes[key] : null; },
    appendChild(child) { this.children.push(child); return child; }
  };
}

const fakeDocument = () => ({ createElement: name => makeNode(name) });

function walk(node, visit) {
  visit(node);
  for (const child of node.children) walk(child, visit);
}

function find(root, predicate) {
  const out = [];
  walk(root, node => { if (predicate(node)) out.push(node); });
  return out;
}

const built = () => shell.createShell(fakeDocument());

test("the shell carries the token scope, so a host never has to remember to add one", () => {
  const root = built();
  assert.match(root.getAttribute("class"), /\bstation-root\b/);
  assert.equal(root.getAttribute("data-station-app"), "");
});

test("every declared mount point exists exactly once", () => {
  const root = built();
  for (const mount of shell.MOUNTS) {
    const found = find(root, node => node.getAttribute("data-station-mount") === mount);
    assert.equal(found.length, 1, `expected exactly one "${mount}" mount`);
  }
});

test("MOUNTS is the whole list - the shell declares no mount it does not name", () => {
  const root = built();
  const present = find(root, node => node.getAttribute("data-station-mount") !== null)
    .map(node => node.getAttribute("data-station-mount")).sort();
  assert.deepEqual(present, [...shell.MOUNTS].sort());
});

test("the shell builds no <main>, because the application already has one", () => {
  // A second <main> is invalid, and the legacy stylesheet styles bare `main`
  // with its own grid - so a Station <main> would be mis-laid-out inside the
  // application as well.
  const root = built();
  assert.deepEqual(find(root, node => node.nodeName === "MAIN"), []);
  // The machine area is still a labelled landmark.
  const machine = find(root, node => node.getAttribute("data-station-mount") === "machine")[0];
  assert.equal(machine.nodeName, "SECTION");
  assert.equal(machine.getAttribute("aria-label"), "Machine stage");
});

test("the shell uses only elements the legacy stylesheets do not bare-style", () => {
  // `main` is excluded above; `button` is handled by Station's own reset. Any
  // other bare-styled element would arrive here unstyled-by-Station.
  const root = built();
  const used = new Set();
  walk(root, node => used.add(node.nodeName.toLowerCase()));
  assert.ok(!used.has("main"));
  assert.ok(!used.has("input"));
  assert.ok(!used.has("select"));
  assert.ok(!used.has("textarea"));
});

test("the too-small notice is part of the shell, not of a page", () => {
  // Both hosts need it, so it cannot live in the harness's HTML.
  const root = built();
  const notice = find(root, node => /station-too-small/.test(node.getAttribute("class") || ""));
  assert.equal(notice.length, 1);
  assert.match(notice[0].textContent, /1100px/);
});

test("header tags are configurable, so a host can label the mode it is in", () => {
  const doc = fakeDocument();
  const root = shell.createShell(doc, { tags: ["Experimental", "Live"] });
  const tags = find(root, node => /station-header__tag/.test(node.getAttribute("class") || ""))
    .map(node => node.textContent);
  assert.deepEqual(tags, ["Experimental", "Live"]);
  // And there is a sane default.
  assert.deepEqual(
    find(built(), node => /station-header__tag/.test(node.getAttribute("class") || "")).map(n => n.textContent),
    ["Experimental"]
  );
});

test("every class the shell emits is in the station- namespace", () => {
  walk(built(), node => {
    for (const name of String(node.getAttribute("class") || "").split(/\s+/).filter(Boolean)) {
      assert.ok(name.startsWith("station-"), `shell emitted "${name}" outside the namespace`);
    }
  });
});

test("the shell sets no inline styles", () => {
  walk(built(), node => {
    assert.equal(node.getAttribute("style"), null, "the shell sets presentation in JavaScript");
  });
});

/* ----------------------------------------------------------------------
 *   Three regions, the whole width
 * -------------------------------------------------------------------- */

test("the shell is a header, the stage and a status bar - no side column, no strip under the stage", () => {
  const root = built();
  const shell = find(root, node => /\bstation-shell\b/.test(node.getAttribute("class") || ""))[0];
  assert.deepEqual(shell.children.map(node => [node.nodeName, node.getAttribute("class")]),
    [["HEADER", "station-header"], ["SECTION", "station-machine"], ["FOOTER", "station-status"]]);
  assert.deepEqual([...require("./station/station-shell.js").MOUNTS], ["machine", "status", "connection"]);
  // Nothing of the old columns survives: no nav, no aside, no heading, no
  // recipe strip - and no element with nothing in it holding a place.
  walk(root, node => {
    assert.ok(!["NAV", "ASIDE", "H2"].includes(node.nodeName), `the shell still builds a <${node.nodeName.toLowerCase()}>`);
    assert.doesNotMatch(String(node.getAttribute("class") || ""), /sidebar|inspector|recipe-strip|station-nav|section__heading/);
  });
});

test("the stylesheet reserves no track for a side column or a strip: one column, three rows, and the tokens for the old widths are gone", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  // Rules only: the file's comments are allowed to say what is no longer there.
  const codeOnly = text => text.replace(/\/\*[\s\S]*?\*\//g, "");
  const css = codeOnly(fs.readFileSync(path.join(__dirname, "station/styles/shell.css"), "utf8"));
  const tokens = codeOnly(fs.readFileSync(path.join(__dirname, "station/styles/tokens.css"), "utf8"));
  assert.match(css, /\.station-shell \{[^}]*grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(css, /grid-template-rows: var\(--station-header-height\) minmax\(0, 1fr\) var\(--station-status-height\);/);
  assert.match(css, /grid-template-areas:\s*"header"\s*"machine"\s*"status";/);
  for (const gone of ["sidebar", "inspector", "recipe-strip", "station-nav", "section__heading", "strip"]) {
    assert.doesNotMatch(css, new RegExp(gone), `shell.css still styles ${gone}`);
  }
  for (const token of ["--station-sidebar-width", "--station-inspector-width", "--station-recipe-strip-height"]) {
    assert.doesNotMatch(tokens, new RegExp(token));
    assert.doesNotMatch(css, new RegExp(token));
  }
  // The stage's cell is the whole width: it sets no max-width and no margin
  // that would centre it in a narrower band.
  const machine = css.slice(css.indexOf(".station-machine {"), css.indexOf("}", css.indexOf(".station-machine {")));
  assert.doesNotMatch(machine, /max-width|margin/);
  // And the recipe strip's stylesheet is gone, not merely unlinked.
  assert.ok(!fs.existsSync(path.join(__dirname, "station/styles/components/recipe-strip.css")));
  for (const file of ["station/station.html", "station-host.js"]) {
    assert.doesNotMatch(fs.readFileSync(path.join(__dirname, file), "utf8"), /recipe-strip\.css/);
  }
});
