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
