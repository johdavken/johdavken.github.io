/* Work Alarm: a wake-up alarm before every shift of your crew.
 *
 * The shifts come from the plant rotation (work-rotation.js); this device
 * says which crew it belongs to and how long before a shift to ring. The
 * alarms are the pump-off alarm's own native ones (the PumpOffAlarm
 * Capacitor plugin): full screen over the lock screen, exact to the
 * minute, put back after a reboot. This file arms them under its own ids,
 * recorded under its own key, so it cancels only what it armed and the
 * Timeline's pump-off alarms never see them.
 *
 * The settings belong to this device, not to a line, a job or a
 * workspace: they are kept in localStorage and never synced. In a browser
 * there is no plugin, so nothing rings; the tool says so and still shows
 * the schedule.
 *
 * Alarms are armed a few weeks ahead and topped up whenever the app opens
 * or comes back to the front.
 */
(function (root, factory) {
  const rotation = typeof require === "function" ? require("./work-rotation.js") : (root && root.PolynWorkRotation);
  const api = factory(rotation, root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynWorkAlarm = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (rotationModule, root) {
  "use strict";

  const SETTINGS_KEY = "polyn.workAlarm.v1";
  const ARMED_KEY = "polyn.workAlarm.armedIds.v1";
  /* How far ahead alarms are armed. */
  const HORIZON_DAYS = 28;
  const DEFAULT_LEAD = 120;
  const LEAD_MIN = 15;
  const LEAD_MAX = 240;
  const LEAD_STEP = 15;
  const MINUTE = 60 * 1000;
  const DAY = 24 * 60 * MINUTE;

  const DEFAULTS = Object.freeze({ enabled: false, crew: null, leadMinutes: DEFAULT_LEAD, skips: Object.freeze([]) });

  /* The same id scheme as the Timeline's (FNV-1a into a positive int),
   * seeded apart from it. */
  function alarmId(dateKey) {
    const seed = `work-alarm:${dateKey}`;
    let hash = 2166136261;
    for (let i = 0; i < seed.length; i += 1) {
      hash ^= seed.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return ((hash >>> 0) % 2147483647) + 1;
  }

  function clampLead(value) {
    const minutes = Math.round(Number(value) / LEAD_STEP) * LEAD_STEP;
    if (!Number.isFinite(minutes)) return DEFAULT_LEAD;
    return Math.min(LEAD_MAX, Math.max(LEAD_MIN, minutes));
  }

  /** The lead choices a picker offers: every 15 minutes, 15 min to 4 h. */
  function leadChoices() {
    const choices = [];
    for (let minutes = LEAD_MIN; minutes <= LEAD_MAX; minutes += LEAD_STEP) choices.push(minutes);
    return choices;
  }

  /** "2 hours", "1 h 30 min", "45 minutes". */
  function formatLead(minutes) {
    const total = clampLead(minutes);
    const hours = Math.floor(total / 60);
    const rest = total % 60;
    if (!hours) return `${rest} minutes`;
    if (!rest) return hours === 1 ? "1 hour" : `${hours} hours`;
    return `${hours} h ${rest} min`;
  }

  /** "6:00 PM". */
  function formatClock(date) {
    const hours = date.getHours();
    const h = hours % 12 || 12;
    return `${h}:${String(date.getMinutes()).padStart(2, "0")} ${hours < 12 ? "AM" : "PM"}`;
  }

  function normalize(value) {
    const raw = value && typeof value === "object" ? value : {};
    const crew = rotationModule ? rotationModule.normalizeCrew(raw.crew) : null;
    const skips = Array.isArray(raw.skips) ? [...new Set(raw.skips.filter(key => /^\d{4}-\d{2}-\d{2}$/.test(String(key))).map(String))].sort() : [];
    return { enabled: raw.enabled === true && !!crew, crew, leadMinutes: raw.leadMinutes === undefined ? DEFAULT_LEAD : clampLead(raw.leadMinutes), skips };
  }

  /**
   * The alarms a set of settings asks for between now and the horizon:
   * one per shift, `leadMinutes` before it starts, skipping the dates
   * skipped and any whose time has passed. Pure.
   */
  function plan(settings, nowMs, horizonDays) {
    const s = normalize(settings);
    if (!rotationModule || !s.crew) return [];
    const shifts = rotationModule.shiftsBetween(s.crew, nowMs, nowMs + (horizonDays || HORIZON_DAYS) * DAY);
    return shifts
      .filter(shift => shift.start.getTime() > nowMs)
      .map(shift => {
        const at = shift.start.getTime() - s.leadMinutes * MINUTE;
        return {
          id: alarmId(shift.date), date: shift.date, kind: shift.kind, crew: s.crew,
          start: shift.start, end: shift.end, at: new Date(at),
          skipped: s.skips.includes(shift.date), passed: at <= nowMs
        };
      });
  }

  function notificationFor(alarm, settings) {
    const s = normalize(settings);
    const kind = alarm.kind === "day" ? "Day" : "Night";
    return {
      id: alarm.id,
      at: alarm.at.getTime(),
      title: `Work: ${kind.toLowerCase()} shift at ${formatClock(alarm.start)}`,
      body: `Crew ${alarm.crew}. Your ${kind.toLowerCase()} shift starts in ${formatLead(s.leadMinutes)}.`,
      sound: null,
      vibrate: true
    };
  }

  /**
   * @param {object} [options]
   * @param {Storage|null} [options.storage]  localStorage, or null
   * @param {object|null} [options.plugin]    the PumpOffAlarm plugin, or null in a browser
   * @param {function} [options.now]
   */
  function create(options) {
    const settingsIn = options || {};
    const storage = settingsIn.storage || null;
    const plugin = settingsIn.plugin || null;
    const now = typeof settingsIn.now === "function" ? settingsIn.now : () => Date.now();
    const listeners = new Set();
    let lastSync = null;
    let syncing = null;

    function read(key, fallback) {
      try {
        const raw = storage && typeof storage.getItem === "function" ? storage.getItem(key) : null;
        return raw ? JSON.parse(raw) : fallback;
      } catch (error) { return fallback; }
    }

    function write(key, value) {
      try { if (storage && typeof storage.setItem === "function") storage.setItem(key, JSON.stringify(value)); return true; } catch (error) { return false; }
    }

    function getSettings() {
      return normalize(read(SETTINGS_KEY, DEFAULTS));
    }

    function emit() {
      for (const listener of listeners) { try { listener(); } catch (error) { /* a listener's fault is its own */ } }
    }

    function armedIds() {
      const ids = read(ARMED_KEY, []);
      return new Set(Array.isArray(ids) ? ids.filter(id => Number.isInteger(id) && id > 0) : []);
    }

    /**
     * Arms what the settings ask for and cancels what this file armed that
     * they no longer ask for. Never touches ids it did not record.
     */
    async function sync() {
      if (syncing) return syncing;
      syncing = (async () => {
        const settings = getSettings();
        const wanted = settings.enabled ? plan(settings, now(), HORIZON_DAYS).filter(alarm => !alarm.skipped && !alarm.passed) : [];
        if (!plugin) {
          lastSync = { at: now(), native: false, armed: 0, wanted: wanted.length, error: null };
          return lastSync;
        }
        const desired = new Map(wanted.map(alarm => [alarm.id, notificationFor(alarm, settings)]));
        const known = armedIds();
        const toCancel = [...known].filter(id => !desired.has(id));
        try {
          if (toCancel.length) await plugin.cancel({ notifications: toCancel.map(id => ({ id })) });
          if (desired.size) await plugin.schedule({ notifications: [...desired.values()] });
          write(ARMED_KEY, [...desired.keys()]);
          lastSync = { at: now(), native: true, armed: desired.size, wanted: wanted.length, error: null };
        } catch (error) {
          // The record stays as it was: a later sync retries both halves.
          lastSync = { at: now(), native: true, armed: 0, wanted: wanted.length, error: (error && error.message) || "The alarms could not be set." };
        }
        return lastSync;
      })();
      try { return await syncing; } finally { syncing = null; emit(); }
    }

    /** Saves a change to the settings and re-arms. */
    async function update(patch) {
      const next = normalize(Object.assign({}, getSettings(), patch || {}));
      // Skips for dates already behind us are dropped as they are saved.
      const today = rotationModule ? rotationModule.dateKey(new Date(now()).getFullYear(), new Date(now()).getMonth() + 1, new Date(now()).getDate()) : "";
      next.skips = next.skips.filter(key => key >= today || !today);
      if (!write(SETTINGS_KEY, next)) return { ok: false, message: "This device could not save the alarm settings." };
      emit();
      const result = await sync();
      return { ok: !result.error, message: result.error || "", settings: next, sync: result };
    }

    function toggleSkip(dateKey) {
      const settings = getSettings();
      const skips = new Set(settings.skips);
      if (skips.has(dateKey)) skips.delete(dateKey);
      else skips.add(dateKey);
      return update({ skips: [...skips] });
    }

    /** The next `count` shifts with their alarm times, skipped or not. */
    function upcoming(count) {
      const settings = getSettings();
      return plan(settings, now(), HORIZON_DAYS).slice(0, count || 8);
    }

    /** What Android allows: notifications, exact timing, full screen. */
    async function permissions() {
      if (!plugin) return { native: false, notifications: false, exact: false, fullScreen: false };
      const ask = async name => {
        try { return typeof plugin[name] === "function" ? !!(await plugin[name]()).granted : true; } catch (error) { return false; }
      };
      return {
        native: true,
        notifications: await ask("checkNotificationPermission"),
        exact: await ask("checkExactAlarmPermission"),
        fullScreen: await ask("checkFullScreenIntentPermission")
      };
    }

    async function requestExact() { if (plugin && typeof plugin.requestExactAlarmPermission === "function") await plugin.requestExactAlarmPermission(); }
    async function requestFullScreen() { if (plugin && typeof plugin.requestFullScreenIntentPermission === "function") await plugin.requestFullScreenIntentPermission(); }

    function subscribe(listener) {
      if (typeof listener !== "function") return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    }

    return Object.freeze({
      native: !!plugin,
      getSettings, update, toggleSkip, upcoming, sync, permissions, requestExact, requestFullScreen, subscribe,
      lastSync: () => lastSync
    });
  }

  /* One instance per page, over this page's storage and the native plugin
   * when there is one; it tops the alarms up on load and whenever the app
   * comes back to the front. */
  let sharedInstance = null;
  function shared() {
    if (sharedInstance) return sharedInstance;
    let storage = null;
    try { storage = root && root.localStorage ? root.localStorage : null; } catch (error) { storage = null; }
    const capacitor = root && root.Capacitor;
    const native = !!(capacitor && typeof capacitor.isNativePlatform === "function" && capacitor.isNativePlatform());
    const plugin = native && capacitor.Plugins ? capacitor.Plugins.PumpOffAlarm || null : null;
    sharedInstance = create({ storage, plugin });
    return sharedInstance;
  }

  if (root && root.document && typeof root.document.addEventListener === "function" && !(typeof module === "object" && module.exports)) {
    const topUp = () => {
      try {
        const instance = shared();
        if (instance.native && instance.getSettings().enabled) instance.sync();
      } catch (error) { /* the next visit tries again */ }
    };
    if (root.document.readyState === "loading") root.document.addEventListener("DOMContentLoaded", topUp, { once: true });
    else topUp();
    root.document.addEventListener("visibilitychange", () => { if (root.document.visibilityState === "visible") topUp(); });
  }

  return Object.freeze({
    SETTINGS_KEY, ARMED_KEY, HORIZON_DAYS, DEFAULT_LEAD, LEAD_MIN, LEAD_MAX, LEAD_STEP,
    alarmId, clampLead, leadChoices, formatLead, formatClock, normalize, plan, notificationFor, create, shared
  });
});
