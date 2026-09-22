"use strict";

/* slate-conflict.js: the RT Sync conflict question in Slate's dialog, and
 * its way in and out through the connection bridge. */

const test = require("node:test");
const assert = require("node:assert/strict");

const { makeDocument, click, key } = require("./tools/slate-test/fake-dom.js");
const conflict = require("./slate/slate-conflict.js");
const sync = require("./slate/slate-sync.js");
const bridgeModule = require("./station-connection-bridge.js");

const q = (view, selector) => view.element.querySelector(selector);

test("the dialog carries the floor UI's words and three choices; each choice answers and closes; the revisions are said", async () => {
  const doc = makeDocument();
  const view = conflict.create(doc);
  doc.body.appendChild(view.element);
  assert.ok(view.element.hasAttribute("hidden"));
  assert.equal(q(view, ".slate-modal__card").getAttribute("role"), "dialog");
  assert.equal(q(view, ".slate-modal__card").getAttribute("aria-modal"), "true");
  assert.equal(q(view, ".slate-modal__title").textContent, "RT Sync conflict");
  assert.equal(q(view, ".slate-modal__body").textContent, "The active job changed here and on another device. Both versions were backed up locally.");
  assert.deepEqual(view.element.querySelectorAll("[data-slate-answer]").map(one => [one.getAttribute("data-slate-answer"), one.textContent]), [["remote", "Use shared version"], ["local", "Keep this device's version"], ["cancel", "Decide later"]]);
  assert.ok(view.button("remote").classList.contains("slate-recipe__plan-action--promote"));

  const trigger = doc.createElement("button");
  doc.body.appendChild(trigger);
  trigger.focus();
  const asked = view.ask({ localRevision: 3, remoteRevision: 5 });
  assert.ok(view.isOpen());
  assert.ok(!view.element.hasAttribute("hidden"));
  assert.equal(q(view, ".slate-modal__detail").textContent, "This device started from revision 3; the shared line is now revision 5.");
  assert.ok(doc.activeElement === view.button("remote"), "focus did not land on the primary choice");
  click(view.button("remote"));
  assert.equal(await asked, "remote");
  assert.ok(!view.isOpen());
  assert.ok(view.element.hasAttribute("hidden"));
  assert.ok(doc.activeElement === trigger, "focus did not return");

  const kept = view.ask({ localRevision: 7, remoteRevision: 9 });
  click(view.button("local"));
  assert.equal(await kept, "local");
  const later = view.ask({});
  assert.equal(q(view, ".slate-modal__detail").textContent, "This device started from revision ?; the shared line is now revision ?.");
  click(view.button("cancel"));
  assert.equal(await later, "cancel");
});

test("Escape and a press on the scrim mean decide later; a second question while one is open is answered cancel at once; close() cancels", async () => {
  const doc = makeDocument();
  const view = conflict.create(doc);
  doc.body.appendChild(view.element);
  const first = view.ask({ localRevision: 1, remoteRevision: 2 });
  const second = view.ask({ localRevision: 1, remoteRevision: 3 });
  assert.equal(await second, "cancel");
  assert.ok(view.isOpen(), "the second question closed the first");
  const escape = key(view.element, "Escape");
  assert.equal(escape._stopped, true);
  assert.equal(await first, "cancel");
  const third = view.ask({});
  click(q(view, ".slate-modal__scrim"));
  assert.equal(await third, "cancel");
  const fourth = view.ask({});
  view.close();
  assert.equal(await fourth, "cancel");
  // A click inside the card that is not a choice does nothing.
  const fifth = view.ask({});
  click(q(view, ".slate-modal__body"));
  assert.ok(view.isOpen());
  view.close();
  await fifth;
});

test("the sync module registers the dialog as the bridge's conflict answerer, so the application's ask comes back with the operator's choice", async () => {
  const doc = makeDocument();
  const bridge = bridgeModule.create();
  assert.equal(bridge.ask("conflict", { localRevision: 1, remoteRevision: 2 }), null, "the bridge answered before anyone registered");
  const view = conflict.create(doc);
  doc.body.appendChild(view.element);
  const panel = sync.create(doc, { connection: bridge, admin: null, conflict: view });
  doc.body.appendChild(panel.element);
  assert.ok(bridge.answers("conflict"));
  const asked = bridge.ask("conflict", { localRevision: 4, remoteRevision: 6 });
  assert.ok(asked && typeof asked.then === "function");
  assert.ok(view.isOpen());
  assert.equal(q(view, ".slate-modal__detail").textContent, "This device started from revision 4; the shared line is now revision 6.");
  click(view.button("local"));
  assert.equal(await asked, "local");
  // Without a dialog nothing is registered, and the bridge says so.
  const bare = bridgeModule.create();
  sync.create(doc, { connection: bare, admin: null });
  assert.equal(bare.answers("conflict"), false);
  assert.equal(bare.ask("conflict", {}), null);
});
