"use strict";

/* slate-settings.js: the theme picker over the controller. */

const test = require("node:test");
const assert = require("node:assert/strict");

const { makeDocument, click, key } = require("./tools/slate-test/fake-dom.js");
const settings = require("./slate/slate-settings.js");
const theme = require("./slate-theme.js");

function storage() {
  const store = {};
  return { getItem: key => (key in store ? store[key] : null), setItem(key, value) { store[key] = String(value); }, store };
}

/* aria-checked down the gallery with exactly one tile on. */
const checkedOnly = id => theme.THEME_IDS.map(one => (one === id ? "true" : "false"));

test("the picker offers every registered theme as a radio, marks the current one, and drives the controller", () => {
  const doc = makeDocument();
  const root = doc.createElement("div");
  const saved = storage();
  const controller = theme.create(root, saved);
  const view = settings.create(doc, { theme: controller, themes: theme.THEMES });
  const tiles = view.element.querySelectorAll("[data-theme-choice]");
  assert.deepEqual(tiles.map(tile => tile.getAttribute("data-theme-choice")), [...theme.THEME_IDS]);
  assert.deepEqual(tiles.map(tile => tile.getAttribute("role")), theme.THEME_IDS.map(() => "radio"));
  assert.deepEqual(tiles.map(tile => tile.getAttribute("aria-checked")), checkedOnly("yaru-light"));
  assert.equal(view.element.querySelector("[role='radiogroup']").getAttribute("aria-label"), "Theme");
  // The swatch draws in the tile's own theme, not the live one.
  assert.equal(tiles[1].querySelector(".slate-theme-scope").getAttribute("data-theme"), "yaru-dark");
  assert.equal(tiles[0].querySelector(".slate-theme-tile__selected-mark").textContent, "✓");
  assert.ok(tiles[0].querySelector(".slate-theme-tile__preview-title"));
  assert.ok(tiles[0].querySelector(".slate-theme-tile__preview-status"));
  assert.ok(tiles[0].querySelector(".slate-theme-tile__preview-action"));

  click(tiles[1]);
  assert.equal(controller.getTheme(), "yaru-dark");
  assert.equal(root.getAttribute("data-theme"), "yaru-dark");
  assert.equal(saved.store[theme.STORAGE_KEY], "yaru-dark");
  assert.deepEqual(tiles.map(tile => tile.getAttribute("aria-checked")), checkedOnly("yaru-dark"));
  assert.ok(tiles[1].classList.contains("is-selected"));

  // A change from elsewhere (another Settings, the harness) is followed.
  controller.setTheme("yaru-light");
  assert.deepEqual(tiles.map(tile => tile.getAttribute("aria-checked")), checkedOnly("yaru-light"));
});

test("with no controller the tiles are inert and the section says so; the later-preferences stub is present", () => {
  const doc = makeDocument();
  const view = settings.create(doc, { theme: null, themes: theme.THEMES });
  const tiles = view.element.querySelectorAll("[data-theme-choice]");
  assert.deepEqual(tiles.map(tile => tile.getAttribute("aria-checked")), theme.THEME_IDS.map(() => "false"));
  assert.doesNotThrow(() => click(tiles[0]));
  assert.match(view.element.querySelector(".slate-settings__note").textContent, /cannot be changed/);
  assert.match(view.element.querySelector(".slate-stub").textContent, /later phases/);
  assert.equal(view.tile("yaru-dark"), tiles[1]);
  assert.equal(view.tile("nope"), null);
});

/* ----------------------------------------------------------------------
 *   Administrator access
 * -------------------------------------------------------------------- */

const adminActions = require("./slate/slate-admin-actions.js");
const adminBridge = require("./station-admin-bridge.js");

/* A fake admin bridge whose session the test moves, as a sign-in
 * elsewhere would: every listener is told, the way the real one does. */
function makeAdmin(options) {
  const settings2 = options || {};
  const calls = [];
  const listeners = new Set();
  let state = Object.assign({ ready: true, signedIn: false, isAdmin: false, email: "" }, settings2.state || {});
  let access = adminBridge.project(state, { ready: true, userId: "user-1234abcd", deviceId: "dev-5678efgh", deviceLabel: "Line 5" });
  function publish() { access = adminBridge.project(state, { ready: true, userId: "user-1234abcd", deviceId: "dev-5678efgh", deviceLabel: "Line 5" }); for (const listener of listeners) listener(access); }
  return {
    calls,
    isConnected: () => settings2.connected !== false,
    capabilities: () => (settings2.capabilities || [...adminBridge.ACTIONS]).slice(),
    getAccess: () => access,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    set(next) { state = Object.assign({}, state, next); publish(); },
    async request(action, args) {
      calls.push({ action, args });
      const answer = typeof settings2.answer === "function" ? settings2.answer(action, args) : undefined;
      if (answer !== undefined) {
        if (answer.ok && action === "signIn") this.set({ signedIn: true, isAdmin: true, email: args.email });
        if (answer.ok && action === "signOut") this.set({ signedIn: false, isAdmin: false, email: "" });
        return answer;
      }
      if (action === "signIn") this.set({ signedIn: true, isAdmin: true, email: args.email });
      if (action === "signOut") this.set({ signedIn: false, isAdmin: false, email: "" });
      return { ok: true };
    }
  };
}

function bootAdmin(options) {
  const doc = makeDocument();
  const admin = options && "admin" in options ? options.admin : makeAdmin();
  const said = [];
  const view = settings.create(doc, { theme: null, themes: theme.THEMES, admin, say: message => said.push(message) });
  const el = view.element;
  return {
    doc, admin, said, view, el,
    toggle: el.querySelector("[data-slate-admin='disclosure']"),
    email: el.querySelector("[data-slate-admin='email']"),
    password: el.querySelector("[data-slate-admin='password']"),
    signIn: el.querySelector("[data-slate-admin='sign-in']"),
    signOut: el.querySelector("[data-slate-admin='sign-out']"),
    note: el.querySelector(".slate-settings__admin-note")
  };
}

const tick = () => new Promise(resolve => setImmediate(resolve));

test("administrator access is the last group and stays closed until it is pressed; leaving Settings closes it again", () => {
  const { el, view, toggle, password } = bootAdmin();
  const groups = el.querySelectorAll(".slate-settings__group");
  assert.equal(groups[groups.length - 1].getAttribute("aria-label"), "Administrator access", "the admin block is not last");
  assert.match(el.querySelector(".slate-stub").textContent, /later phases/, "the More stub was displaced");
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  assert.ok(el.querySelector(".slate-settings__admin-body").hasAttribute("hidden"));
  assert.deepEqual(view.admin(), { open: false, pending: false, note: "", signedIn: false });

  click(toggle);
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  assert.ok(!el.querySelector(".slate-settings__admin-body").hasAttribute("hidden"));
  assert.match(el.querySelector(".slate-settings__admin-opens").textContent, /appear in the rail/);
  password.value = "secret";
  view.onHide();
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  assert.equal(password.value, "", "the password survived leaving Settings");
});

test("signing in sends one request with the email trimmed and the password as typed, clears the password, and turns the block into who is signed in", async () => {
  const { el, view, admin, said, toggle, email, password, signIn, note } = bootAdmin();
  click(toggle);
  email.value = "  ada@example.com  ";
  password.value = " secret ";
  click(signIn);
  await tick();
  assert.deepEqual(admin.calls, [{ action: "signIn", args: { email: "ada@example.com", password: " secret " } }]);
  assert.equal(password.value, "", "the password stayed in the page");
  assert.equal(email.value, "");
  assert.equal(view.admin().signedIn, true);
  assert.ok(el.querySelector(".slate-settings__admin-form").hasAttribute("hidden"), "the form stayed under a signed-in session");
  assert.equal(el.querySelector(".slate-settings__admin-email").textContent, "Signed in as ada@example.com");
  assert.equal(el.querySelector(".slate-settings__admin-who").textContent, "ada@example.com");
  assert.equal(signIn.getAttribute("data-able"), "false");
  assert.equal(el.querySelector("[data-slate-admin='sign-out']").getAttribute("data-able"), "true");
  assert.match(said[said.length - 1], /Signed in as ada@example.com/);
  assert.equal(note.textContent, "");

  // And out again, from the same block.
  click(el.querySelector("[data-slate-admin='sign-out']"));
  await tick();
  assert.deepEqual(admin.calls[1], { action: "signOut", args: undefined });
  assert.equal(view.admin().signedIn, false);
  assert.ok(!el.querySelector(".slate-settings__admin-form").hasAttribute("hidden"));
  assert.equal(said[said.length - 1], adminActions.WORDING.signedOut);
});

test("Enter in either field signs in; an empty field is refused here and sends nothing", async () => {
  const { admin, toggle, email, password, signIn, note } = bootAdmin();
  click(toggle);
  key(signIn, "Enter");           // not a field: nothing happens
  key(email, "Enter");
  await tick();
  assert.equal(admin.calls.length, 0);
  assert.equal(note.textContent, adminActions.WORDING.emailNeeded);
  email.value = "ada@example.com";
  key(password, "Enter");
  await tick();
  assert.equal(admin.calls.length, 0);
  assert.equal(note.textContent, adminActions.WORDING.passwordNeeded);
  password.value = "secret";
  key(password, "Enter");
  await tick();
  assert.deepEqual(admin.calls, [{ action: "signIn", args: { email: "ada@example.com", password: "secret" } }]);
});

test("a refused sign-in keeps the block open with the application's words and the email as typed", async () => {
  const admin = makeAdmin({ answer: () => ({ ok: false, code: "failed", message: "Those credentials were not accepted." }) });
  const { view, toggle, email, password, signIn, note } = bootAdmin({ admin });
  click(toggle);
  email.value = "ada@example.com";
  password.value = "wrong";
  click(signIn);
  await tick();
  assert.equal(note.textContent, "Those credentials were not accepted.");
  assert.ok(note.classList.contains("is-error"));
  assert.equal(email.value, "ada@example.com", "the email was taken away on a refusal");
  assert.equal(password.value, "", "the password was kept after a refusal");
  assert.equal(view.admin().signedIn, false);
  assert.equal(view.admin().pending, false);
});

test("a session opened or ended anywhere else is followed here; with no bridge the block explains instead of asking", async () => {
  const { el, view, admin, toggle } = bootAdmin();
  click(toggle);
  admin.set({ signedIn: true, isAdmin: true, email: "ada@example.com" });
  assert.equal(view.admin().signedIn, true, "a sign-in elsewhere did not reach Settings");
  assert.equal(el.querySelector(".slate-settings__admin-who").textContent, "ada@example.com");
  admin.set({ signedIn: false, isAdmin: false, email: "" });
  assert.equal(view.admin().signedIn, false);
  assert.ok(el.querySelector(".slate-settings__admin-who").hasAttribute("hidden"));

  const none = bootAdmin({ admin: null });
  click(none.toggle);
  assert.equal(none.signIn.getAttribute("data-able"), "false");
  assert.match(none.signIn.getAttribute("title"), /no application is connected/);
  click(none.signIn);
  await tick();
  assert.match(none.said[none.said.length - 1], /Sign in is unavailable: no application is connected/);
});
