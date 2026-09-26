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

/* The families, in gallery order: each registered light/dark pair. */
const FAMILIES = [...new Set(theme.THEME_IDS.map(id => id.replace(/-(light|dark)$/, "")))];
/* aria-checked down the gallery with exactly one family's tile on. */
const checkedOnly = family => FAMILIES.map(one => (one === family ? "true" : "false"));
const labelOf = id => theme.THEMES.find(item => item.id === id).label;

test("the picker offers one tile per family as a radio, each showing one half, marks the current one, and drives the controller", () => {
  const doc = makeDocument();
  const root = doc.createElement("div");
  const saved = storage();
  const controller = theme.create(root, saved);
  const view = settings.create(doc, { theme: controller, themes: theme.THEMES });
  assert.equal(FAMILIES.length * 2, theme.THEME_IDS.length, "every theme has its other half");
  const boxes = view.element.querySelectorAll(".slate-theme-tile");
  assert.deepEqual(boxes.map(box => box.getAttribute("data-theme-family")), FAMILIES);
  const tiles = view.element.querySelectorAll("[data-theme-choice]");
  assert.equal(tiles.length, FAMILIES.length);
  assert.deepEqual(tiles.map(tile => tile.getAttribute("role")), FAMILIES.map(() => "radio"));
  // The live theme is Yaru Dark: its family shows it, and every other family shows its dark half too.
  assert.deepEqual(tiles.map(tile => tile.getAttribute("data-theme-choice")), FAMILIES.map(family => `${family}-dark`));
  assert.deepEqual(tiles.map(tile => tile.getAttribute("aria-checked")), checkedOnly("yaru"));
  assert.equal(view.element.querySelector("[role='radiogroup']").getAttribute("aria-label"), "Theme");
  assert.equal(tiles[0].querySelector(".slate-theme-tile__name").textContent, "Yaru Dark");
  // The swatch draws in the half the tile shows, not the live one.
  assert.equal(tiles[1].querySelector(".slate-theme-scope").getAttribute("data-theme"), "rose-pine-dark");
  assert.equal(tiles[0].querySelector(".slate-theme-tile__selected-mark").textContent, "✓");
  assert.ok(tiles[0].querySelector(".slate-theme-tile__preview-title"));
  assert.ok(tiles[0].querySelector(".slate-theme-tile__preview-status"));
  assert.ok(tiles[0].querySelector(".slate-theme-tile__preview-action"));

  // A tile chooses the half it shows.
  click(tiles[1]);
  assert.equal(controller.getTheme(), "rose-pine-dark");
  assert.equal(root.getAttribute("data-theme"), "rose-pine-dark");
  assert.equal(saved.store[theme.STORAGE_KEY], "rose-pine-dark");
  assert.deepEqual(tiles.map(tile => tile.getAttribute("aria-checked")), checkedOnly("rose-pine"));
  assert.ok(boxes[1].classList.contains("is-selected") && !boxes[0].classList.contains("is-selected"));

  // A change from elsewhere (another Settings, the harness) is followed, half and all.
  controller.setTheme("yaru-light");
  assert.deepEqual(tiles.map(tile => tile.getAttribute("aria-checked")), checkedOnly("yaru"));
  assert.equal(tiles[0].getAttribute("data-theme-choice"), "yaru-light");
  assert.equal(tiles[0].querySelector(".slate-theme-tile__name").textContent, "Yaru Light");
});

test("each tile's day / night switch turns it between its halves - the name, the description and the swatch with it - and the live family's switch changes the theme at once", () => {
  const doc = makeDocument();
  const root = doc.createElement("div");
  const saved = storage();
  saved.setItem(theme.STORAGE_KEY, "yaru-light");
  const controller = theme.create(root, saved);
  const view = settings.create(doc, { theme: controller, themes: theme.THEMES });
  const yaru = view.themeSwitch("yaru");
  assert.equal(yaru.getAttribute("role"), "switch");
  assert.equal(yaru.getAttribute("aria-checked"), "false", "Yaru Light is day");
  assert.equal(view.themeSwitch("yaru-dark"), yaru, "either half names the family");
  assert.ok(yaru.closest(".slate-theme-tile") === view.tile("yaru").closest(".slate-theme-tile"));
  assert.ok(!view.tile("yaru").contains(yaru), "the switch is not inside the choosing button");

  // The live family: the theme turns with the switch, and the untouched families turn with it.
  click(yaru);
  assert.equal(controller.getTheme(), "yaru-dark");
  assert.equal(view.tile("catppuccin").getAttribute("data-theme-choice"), "catppuccin-dark", "an untouched family did not follow the live scheme");
  assert.equal(saved.store[theme.STORAGE_KEY], "yaru-dark");
  assert.equal(yaru.getAttribute("aria-checked"), "true");
  assert.equal(view.tile("yaru").querySelector(".slate-theme-tile__name").textContent, "Yaru Dark");
  assert.equal(view.tile("yaru").querySelector(".slate-theme-scope").getAttribute("data-theme"), "yaru-dark");
  assert.match(yaru.getAttribute("aria-label"), /^Night: Yaru Dark$/);
  click(yaru);
  assert.equal(controller.getTheme(), "yaru-light");

  // Another family: the switch only turns the tile; choosing it then chooses that half.
  const gruvbox = view.tile("gruvbox");
  assert.equal(gruvbox.getAttribute("data-theme-choice"), "gruvbox-light", "a family starts on the live theme's scheme");
  click(view.themeSwitch("gruvbox"));
  assert.equal(controller.getTheme(), "yaru-light", "a switch on another family changed the theme");
  assert.equal(gruvbox.getAttribute("data-theme-choice"), "gruvbox-dark");
  assert.equal(gruvbox.querySelector(".slate-theme-tile__name").textContent, labelOf("gruvbox-dark"));
  assert.equal(gruvbox.querySelector(".slate-theme-tile__description").textContent, theme.THEMES.find(item => item.id === "gruvbox-dark").description);
  assert.equal(gruvbox.getAttribute("aria-checked"), "false");
  // The turned tile keeps its half when the theme changes elsewhere.
  controller.setTheme("tokyo-night-light");
  assert.equal(gruvbox.getAttribute("data-theme-choice"), "gruvbox-dark");
  click(gruvbox);
  assert.equal(controller.getTheme(), "gruvbox-dark");
  assert.equal(view.tile("yaru").getAttribute("data-theme-choice"), "yaru-dark", "Yaru, untouched, follows the live scheme");
  assert.equal(gruvbox.getAttribute("data-theme-choice"), "gruvbox-dark");
});

test("with no controller the tiles are inert and the section says so; there is no More section and no stub", () => {
  const doc = makeDocument();
  const view = settings.create(doc, { theme: null, themes: theme.THEMES });
  const tiles = view.element.querySelectorAll("[data-theme-choice]");
  assert.deepEqual(tiles.map(tile => tile.getAttribute("aria-checked")), FAMILIES.map(() => "false"));
  assert.doesNotThrow(() => click(tiles[0]));
  assert.doesNotThrow(() => click(view.themeSwitch("yaru")));
  assert.equal(tiles[0].getAttribute("data-theme-choice"), "yaru-dark", "the switch still turns the tile");
  assert.match(view.element.querySelector(".slate-settings__note").textContent, /cannot be changed/);
  assert.equal(view.element.querySelector(".slate-stub"), null);
  assert.ok(!view.element.querySelectorAll(".slate-settings__group").map(one => one.getAttribute("aria-label")).includes("More settings"));
  assert.equal(view.tile("yaru-dark"), tiles[0]);
  assert.equal(view.tile("rose-pine"), tiles[1]);
  assert.equal(view.tile("nope"), null);
  assert.equal(view.themeSwitch("nope"), null);
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
  assert.equal(groups[groups.length - 2].getAttribute("aria-label"), "This device opens", "the admin block no longer follows the last preference");
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

test("on a phone Settings is the desktop's at a phone's size: the galleries two across, smaller pictures, the one-line descriptions left to the pictures and names", () => {
  const css = require("node:fs").readFileSync(require("node:path").join(__dirname, "slate/styles/components/settings.css"), "utf8");
  const phone = '.slate-root[data-input="touch"][data-viewport="phone"]';
  const rule = selector => { const at = css.indexOf(`${selector} {`); assert.ok(at > -1, `no rule for ${selector}`); return css.slice(at, css.indexOf("}", at)); };
  assert.match(css, new RegExp(`${phone.replace(/[[\]]/g, "\\$&")} \\.slate-settings__themes,\\n${phone.replace(/[[\]]/g, "\\$&")} \\.slate-settings__backgrounds \\{\\s*grid-template-columns: repeat\\(2, minmax\\(0, 1fr\\)\\);`));
  assert.match(css, new RegExp(`${phone.replace(/[[\]]/g, "\\$&")} \\.slate-theme-tile__description,\\n${phone.replace(/[[\]]/g, "\\$&")} \\.slate-settings__background-note \\{\\s*display: none;`));
  assert.ok(Number(rule(`${phone} .slate-theme-tile__swatch`).match(/height: (\d+)px/)[1]) < 64, "the phone's swatch is no smaller");
  // The background's notes carry their own class, so the phone can leave them out alone.
  const doc = makeDocument();
  const view = settings.create(doc, { theme: null, themes: theme.THEMES });
  assert.ok(view.element.querySelectorAll(".slate-settings__background-note").length >= 2);
  assert.equal(view.element.querySelectorAll(".slate-settings__mode-note.slate-settings__background-note").length, view.element.querySelectorAll("[data-background-choice]").length);
});
