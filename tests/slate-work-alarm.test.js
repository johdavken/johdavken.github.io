"use strict";

/* slate/slate-work-alarm.js: the Work Alarm tool - crew, lead and the
 * switch over the device's own work alarm, the next shifts with their
 * alarm times, a skip per shift, and a status line that says plainly
 * when nothing can ring. */

process.env.TZ = "America/Chicago";

const test = require("node:test");
const assert = require("node:assert/strict");
const { makeDocument, click } = require("../tools/slate-test/fake-dom.js");
const tool = require("../slate/slate-work-alarm.js");
const workAlarm = require("../work-alarm.js");

const SAT_EVENING = new Date(2026, 8, 26, 20, 0).getTime();
const tick = () => new Promise(resolve => setImmediate(resolve));

function memoryStorage() {
  const data = new Map();
  return { getItem: key => (data.has(key) ? data.get(key) : null), setItem: (key, value) => data.set(key, String(value)) };
}

function boot(options) {
  const settings = options || {};
  const doc = makeDocument();
  const plugin = settings.native ? {
    armed: new Map(),
    async schedule({ notifications }) { for (const n of notifications) this.armed.set(n.id, n); },
    async cancel({ notifications }) { for (const n of notifications) this.armed.delete(n.id); },
    async checkNotificationPermission() { return { granted: true }; },
    async checkExactAlarmPermission() { return { granted: settings.exact !== false }; },
    async checkFullScreenIntentPermission() { return { granted: true }; },
    requested: [],
    async requestExactAlarmPermission() { this.requested.push("exact"); }
  } : null;
  const device = workAlarm.create({ storage: memoryStorage(), plugin, now: () => SAT_EVENING });
  let backs = 0;
  const view = tool.create(doc, { workAlarm: settings.missing ? null : { device, format: workAlarm }, back: () => { backs += 1; } });
  doc.body.appendChild(view.element);
  const el = view.element;
  return {
    doc, device, plugin, view, el, backs: () => backs,
    q: selector => el.querySelector(selector),
    all: selector => el.querySelectorAll(selector),
    status: () => el.querySelector(".slate-alarm__status").textContent
  };
}

test("it opens asking for a crew: the switch waits, no shifts are listed, and the close hands the aside back", () => {
  const view = boot();
  assert.equal(view.q(".slate-panel__title").textContent, "Work Alarm");
  assert.equal(view.status(), "Choose your crew to see your shifts.");
  assert.ok(view.q("[data-action='toggle']").hasAttribute("disabled"));
  assert.deepEqual(view.all("[data-crew]").map(button => button.textContent), ["A", "B", "C", "D"]);
  assert.equal(view.all(".slate-alarm__shift").length, 0);
  assert.equal(view.q("[data-field='lead']").value, "120");
  click(view.q("[data-slate-back]"));
  assert.equal(view.backs(), 1);
});

test("choosing a crew lists its next eight shifts with the time each alarm rings; in a browser it says nothing can ring", async () => {
  const view = boot();
  click(view.q("[data-crew='A']"));
  await tick(); await tick();
  assert.equal(view.q("[data-crew='A']").getAttribute("aria-checked"), "true");
  const rows = view.all(".slate-alarm__shift");
  assert.equal(rows.length, 8);
  assert.equal(rows[0].getAttribute("data-date"), "2026-09-28");
  assert.equal(rows[0].getAttribute("data-kind"), "night");
  assert.equal(rows[0].querySelector(".slate-alarm__ring").textContent, "6:00 PM");
  assert.match(rows[0].querySelector(".slate-alarm__kind").textContent, /Night · 8:00 PM/);
  assert.match(view.status(), /This browser can't ring an alarm/);
  assert.equal(view.q("[data-action='toggle']").hasAttribute("disabled"), false);
});

test("on the phone, the switch arms the alarms and the status names the next one; a skip takes one shift out and back", async () => {
  const view = boot({ native: true });
  click(view.q("[data-crew='A']"));
  await tick(); await tick();
  assert.equal(view.status(), "The alarm is off. Your shifts are below.");
  click(view.q("[data-action='toggle']"));
  await tick(); await tick();
  view.view.onShow();
  await tick(); await tick();
  assert.equal(view.q("[data-action='toggle']").getAttribute("aria-checked"), "true");
  assert.equal(view.plugin.armed.size, 14);
  assert.equal(view.status(), "On. Next alarm Mon, Sep 28 at 6:00 PM.");

  click(view.all("[data-action='skip']")[0]);
  await tick(); await tick();
  const first = view.all(".slate-alarm__shift")[0];
  assert.ok(first.hasAttribute("data-skipped"));
  assert.equal(first.querySelector(".slate-alarm__ring").textContent, "Skipped");
  assert.equal(view.plugin.armed.size, 13);
  assert.equal(view.status(), "On. Next alarm Tue, Sep 29 at 6:00 PM.");

  // A shorter lead moves every alarm.
  const lead = view.q("[data-field='lead']");
  lead.value = "60";
  lead.dispatchEvent({ type: "change", target: lead });
  await tick(); await tick();
  assert.equal(view.all(".slate-alarm__shift")[1].querySelector(".slate-alarm__ring").textContent, "7:00 PM");
});

test("when Android won't ring on time, the status says so and offers the fix", async () => {
  const view = boot({ native: true, exact: false });
  click(view.q("[data-crew='A']"));
  await tick(); await tick();
  click(view.q("[data-action='toggle']"));
  await tick(); await tick();
  view.view.onShow();
  await tick(); await tick();
  assert.match(view.status(), /allow exact alarms/);
  const fix = view.q("[data-action='allow-exact']");
  assert.ok(!fix.hasAttribute("hidden"));
  click(fix);
  await tick();
  assert.deepEqual(view.plugin.requested, ["exact"]);
});

test("without the device module it says the tool is unavailable and offers nothing to press but close", () => {
  const view = boot({ missing: true });
  assert.equal(view.status(), tool.UNAVAILABLE);
  assert.equal(view.q("[data-crew]"), null);
  assert.deepEqual(tool.statusFor({ settings: { crew: "A", enabled: true }, native: true, lastSync: { error: "No room" } }),
    { message: "The alarms could not be set: No room", kind: "warn" });
});
