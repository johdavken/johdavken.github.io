/* Station run-down projection - when each tracked hopper is expected to
 * run empty, and where that lands on a rolling timeline.
 *
 * WHAT THIS IS
 *
 * A projection, not a simulation. Every number here is derived, on demand,
 * from what the application holds - the hopper's tracking flag, the weight
 * the run-down formula uses, its blend share, its layer's share, the line's
 * output, the changeover deadline - and from the clock. Nothing is
 * decremented as time passes, nothing is remembered between calls except
 * what the caller hands back in (see `observedAt` below), and nothing here
 * can reach application state at all: this file has no bridge, no DOM and
 * no timers. Hand it the same inputs and it answers the same.
 *
 * THE FORMULA
 *
 * The application's own, from validateAndCompute in app.js - restated here
 * because it lives inline in that function's body and is not exported, and
 * pinned to it by station-rundown.test.js so the two cannot drift apart:
 *
 *   hopper consumption (lb/hr) = line output x (layer % / 100) x (hopper % / 100)
 *   time to empty      (hours) = weight / hopper consumption
 *
 * The layer's share is part of it. A hopper's blend percentage is its share
 * OF ITS LAYER, and the layer's percentage is that layer's share of the
 * line's output; a five-layer line at 850 lb/hr does not feed 850 lb/hr
 * through any one hopper. The weight is the application's effective weight
 * (Smart Hoppers included), which the state bridge carries resolved.
 *
 * WHEN THE ESTIMATE IS ANCHORED
 *
 * The application's Timeline states time-to-empty as a duration from the
 * weight the operator last entered; it does not count down, because the
 * application does not decrement weights. A timeline that moves with the
 * clock has to anchor that duration somewhere, so each entry is projected
 * from `observedAt` - the moment this screen last saw the hopper's weight
 * change (or saw it become tracked), which the caller keeps as
 * presentation state and passes back in. The estimate is then
 *
 *   emptyAt = observedAt + weight / consumption
 *
 * and moves toward Now as the clock advances. A change of output or blend
 * re-projects from the same anchor with the new rate; only a new weight
 * moves the anchor. With no anchor given, `observedAt` is `now` and the
 * answer is exactly the application's duration.
 *
 * WHEN THERE IS NO ESTIMATE
 *
 * Any input the formula cannot use makes the estimate unavailable, with the
 * reason named, and never NaN, Infinity or an invented time:
 *
 *   no-output   line output is 0 or unset
 *   no-share    the hopper's layer has no share of the structure
 *   no-blend    the hopper has no blend percentage
 *   no-weight   the hopper has no weight (0 and "unset" are one state to
 *               the application)
 *   invalid     a value that is not a finite non-negative number
 *
 * THE PUMP-OFF POINT, AND OVERDUE
 *
 * The application's Timeline states, for each tracked hopper, when its
 * pump has to be turned off for it to run empty by the changeover - the
 * row's "start by" - and marks the row late once that moment has passed
 * (validateAndCompute in app.js: startByDate = changeover - time to empty;
 * formatTimelineStart in scheduling.js: late = startBy < now; the row's
 * `late` class needs the pump still running). Restated here, when the
 * caller hands in the changeover:
 *
 *   pumpOffBy = changeoverAt - durationMs    (the application's startByDate)
 *   late      = pumpOffBy < now              (scheduling's own judgement)
 *   overdue   = late and the pump still running
 *
 * The pump-off point is taken from the weight AS ENTERED, not from the
 * anchored estimate above - on purpose. The application never decrements
 * a weight, so its "start by" stands at changeover minus the run-down
 * time and the clock walks up to it: that is how a hopper becomes late on
 * the floor UI's Timeline, and a hopper drawn overdue here is the row the
 * phone marks late, at the same moment. Anchored, both instants would be
 * fixed and nothing would ever become late by the clock.
 *
 * WHERE THE MARKER STANDS
 *
 * With a changeover to plan by, a hopper's marker stands AT ITS PUMP-OFF
 * POINT - the instant the operator has to act on, as on the application's
 * Timeline - so moving the changeover moves every marker with it, and the
 * marker that has reached Now is the hopper the stage draws overdue: the
 * axis and the stage say one thing. Without a changeover there is no
 * pump-off point, and the marker stands at the anchored empty-at estimate
 * instead - when the hopper runs out, the only instant there is. Each
 * entry says which (`markAt`, `markKind`), and the renderer words it so.
 * A stale changeover (see resolveChangeover) is not a boundary to plan
 * by: the timeline draws no line for it, no hopper is late against it,
 * and the markers stand at their empty-at estimates.
 *
 * PUMP-OFF
 *
 * In the application, pump-off is an action that has been done: the
 * Timeline marks the row done, keeps its run-down figures, drops it from
 * "next pump-off" and the alarms, and hides it by default. The hopper is
 * still feeding - the pump-off is what lets it run down to empty for the
 * changeover. So a pumped-off hopper keeps its estimate here and carries
 * the flag, for the renderer to subdue rather than remove. That is the
 * application's reading, not a new one.
 */
(function (root, factory) {
  const scheduling = typeof require === "function"
    ? (function () { try { return require("../scheduling.js"); } catch (error) { return null; } })()
    : (root && root.PolynScheduling);
  const api = factory(scheduling);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynStationRundown = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (scheduling) {
  "use strict";

  const MINUTE = 60 * 1000;
  const HOUR = 60 * MINUTE;

  /* The two windows the timeline offers, in hours. Arbitrary zoom is
   * deliberately not a thing: two known scales are what an operator learns
   * to read at a glance. */
  const WINDOWS = Object.freeze([6, 12]);
  const DEFAULT_WINDOW = 6;

  /* Why an estimate is unavailable, and what the timeline says for each. */
  const REASONS = Object.freeze({
    "no-output": "No output",
    "no-share": "No layer share",
    "no-blend": "No blend",
    "no-weight": "No weight",
    invalid: "Unknown"
  });

  function reasonLabel(reason) {
    return REASONS[reason] || REASONS.invalid;
  }

  function usable(value) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0;
  }

  /* --------------------------------------------------------------------
   *   One hopper
   * ------------------------------------------------------------------ */

  /** Hopper consumption in lb/hr, or null when any input cannot be used. */
  function consumptionRate(lineRate, layerPct, pct) {
    if (!usable(lineRate) || !usable(layerPct) || !usable(pct)) return null;
    return lineRate * (layerPct / 100) * (pct / 100);
  }

  /**
   * Project one hopper.
   *
   * @param {object} input
   * @param {boolean} input.track
   * @param {boolean} [input.pumpOff]
   * @param {number}  input.effectiveWeight   pounds
   * @param {number}  input.pct               the hopper's blend percentage
   * @param {number}  input.layerPct          its layer's share percentage
   * @param {number}  input.lineRate          line output, lb/hr
   * @param {number}  [input.observedAt]      epoch ms the weight was last seen;
   *                                          defaults to `now`
   * @param {object}  [options]
   * @param {number}  [options.now]           epoch ms; defaults to Date.now()
   * @param {number}  [options.changeoverAt]  epoch ms of the changeover, when
   *                                          one is set and not stale; gives
   *                                          pumpOffBy, late and overdue
   * @returns {{tracked, pumpOff, reason, rate, durationMs, emptyAt, remainingMs, past, pumpOffBy, late, overdue, markAt, markKind, untilMs}}
   *   markAt/markKind/untilMs: where the marker stands - the pump-off
   *   point ("pump-off") when a changeover is given, else the empty-at
   *   estimate ("empty") - and how far off that is from now.
   */
  function hopperRundown(input, options) {
    const hopper = input || {};
    const now = options && Number.isFinite(options.now) ? options.now : Date.now();
    const result = {
      tracked: !!hopper.track,
      pumpOff: !!hopper.pumpOff,
      reason: null,
      rate: null,
      durationMs: null,
      emptyAt: null,
      remainingMs: null,
      past: false,
      pumpOffBy: null,
      late: false,
      overdue: false,
      markAt: null,
      markKind: null,
      untilMs: null
    };
    if (!result.tracked) { result.reason = "not-tracked"; return result; }

    const lineRate = hopper.lineRate;
    const layerPct = hopper.layerPct;
    const pct = hopper.pct;
    const weight = hopper.effectiveWeight;
    if (!usable(lineRate) || !usable(layerPct) || !usable(pct) || !usable(weight)) {
      result.reason = "invalid";
      return result;
    }
    if (lineRate <= 0) { result.reason = "no-output"; return result; }
    if (layerPct <= 0) { result.reason = "no-share"; return result; }
    if (pct <= 0) { result.reason = "no-blend"; return result; }
    result.rate = consumptionRate(lineRate, layerPct, pct);
    if (weight <= 0) { result.reason = "no-weight"; return result; }

    const durationMs = (weight / result.rate) * HOUR;
    if (!Number.isFinite(durationMs)) { result.reason = "invalid"; result.rate = null; return result; }
    const observedAt = Number.isFinite(hopper.observedAt) ? hopper.observedAt : now;
    result.durationMs = durationMs;
    result.emptyAt = observedAt + durationMs;
    result.remainingMs = result.emptyAt - now;
    result.past = result.remainingMs < 0;
    result.markAt = result.emptyAt;
    result.markKind = "empty";

    const changeoverAt = options && Number.isFinite(options.changeoverAt) ? options.changeoverAt : null;
    if (changeoverAt !== null) {
      result.pumpOffBy = changeoverAt - durationMs;
      result.late = scheduling && typeof scheduling.formatTimelineStart === "function"
        ? !!scheduling.formatTimelineStart(new Date(result.pumpOffBy), new Date(changeoverAt), new Date(now)).late
        : result.pumpOffBy < now;
      result.overdue = result.late && !result.pumpOff;
      result.markAt = result.pumpOffBy;
      result.markKind = "pump-off";
    }
    result.untilMs = result.markAt - now;
    return result;
  }

  /* --------------------------------------------------------------------
   *   The line
   * ------------------------------------------------------------------ */

  /**
   * Every tracked hopper on the line, projected, in physical order.
   *
   * @param {object} inputs
   * @param {object} inputs.model        PolynStationLineModel's model
   * @param {object} inputs.hopperState  station-source's hopper state by slot
   * @param {object} inputs.layerState   station-source's layer state by name
   * @param {object} inputs.job          { lineRate, ... }
   * @param {object} [inputs.observed]   slot -> epoch ms the weight was last seen
   * @param {object} [options]           { now, changeoverAt }
   */
  function projectEntries(inputs, options) {
    const settings = inputs || {};
    const model = settings.model;
    if (!model || !Array.isArray(model.layers)) return [];
    const hopperState = settings.hopperState || {};
    const layerState = settings.layerState || {};
    const job = settings.job || {};
    const observed = settings.observed || {};
    const entries = [];
    for (const layer of model.layers) {
      const share = layerState[layer.id] ? layerState[layer.id].layerPct : 0;
      for (const hopper of layer.hoppers) {
        const key = `${layer.id}:${hopper.index}`;
        const runtime = hopperState[key];
        if (!runtime || !runtime.track) continue;
        const projected = hopperRundown({
          track: true,
          pumpOff: runtime.pumpOff,
          effectiveWeight: runtime.effectiveWeight,
          pct: runtime.pct,
          layerPct: share,
          lineRate: job.lineRate,
          observedAt: observed[key]
        }, options);
        entries.push(Object.assign({
          key,
          id: hopper.id,
          layer: layer.id,
          role: layer.role,
          index: hopper.index,
          resin: runtime.resinName || "",
          weight: usable(runtime.effectiveWeight) ? runtime.effectiveWeight : 0,
          pct: usable(runtime.pct) ? runtime.pct : 0,
          layerPct: usable(share) ? share : 0,
          lineRate: usable(job.lineRate) ? job.lineRate : 0,
          // When the pump went off, when the application recorded it.
          pumpOffAt: runtime.pumpOff && Number(runtime.pumpOffAt) > 0 ? Number(runtime.pumpOffAt) : null
        }, projected));
      }
    }
    return entries;
  }

  /**
   * The changeover as an instant, from the clock time the job stores - read
   * through scheduling.js's own parser, so the timeline and the application
   * agree on which day a clock time means. `stale` is scheduling's own
   * judgement of a deadline left unedited for too long; a stale deadline is
   * still returned, flagged, for the caller to show as needing confirmation
   * rather than as a boundary to plan by.
   */
  function resolveChangeover(job, options) {
    const now = options && Number.isFinite(options.now) ? options.now : Date.now();
    const time = job && typeof job.changeoverTime === "string" ? job.changeoverTime : "";
    if (!time || !scheduling || typeof scheduling.parseChangeoverDate !== "function") return { at: null, stale: false };
    const date = scheduling.parseChangeoverDate(time, new Date(now));
    if (!date) return { at: null, stale: false };
    const setAt = job && Number.isFinite(job.changeoverSetAt) ? job.changeoverSetAt : null;
    const stale = setAt !== null && typeof scheduling.isChangeoverStale === "function"
      ? scheduling.isChangeoverStale(setAt, new Date(now))
      : false;
    return { at: date.getTime(), stale };
  }

  /* --------------------------------------------------------------------
   *   Ticks
   * ------------------------------------------------------------------ */

  /* How dense the axis can be, from the pixels available. Minor ticks need
   * a few pixels between them to read as separate marks; labels need room
   * for a clock time. Both are chosen from short fixed ladders so the axis
   * is always one of a handful of known appearances. At six hours on a
   * 1100px stage there is room for five-minute ticks and a label every
   * half hour; at twelve hours the ticks open to ten minutes and the
   * labels to the hour, and widen back at a wider window. */
  const MINOR_LADDER = [5, 10, 15, 30];
  const LABEL_LADDER = [30, 60, 120, 180];
  const MINOR_MIN_PX = 10;
  const LABEL_MIN_PX = 56;
  /* A label centred within this many pixels of either edge of the track
   * would run into the Now anchor on the left or off the track on the
   * right, so those marks keep their tick and lose their label. */
  const LABEL_EDGE_PX = 30;

  function tickPlan(windowMs, width) {
    const minutes = windowMs / MINUTE;
    const pxPerMinute = width > 0 ? width / minutes : 0;
    const minor = MINOR_LADDER.find(step => step * pxPerMinute >= MINOR_MIN_PX) || MINOR_LADDER[MINOR_LADDER.length - 1];
    const label = LABEL_LADDER.find(step => step * pxPerMinute >= LABEL_MIN_PX) || LABEL_LADDER[LABEL_LADDER.length - 1];
    return { minor, major: 30, hour: 60, label };
  }

  function localMinuteOfDay(t) {
    const date = new Date(t);
    return date.getHours() * 60 + date.getMinutes();
  }

  /**
   * The axis marks for a window starting at `now`, aligned to the wall
   * clock (so they slide left as time passes) and positioned as a fraction
   * of the window. Each mark says what it is - minor, major (half hour),
   * hour - and carries a label when the plan gives it one.
   */
  function ticks(options) {
    const settings = options || {};
    const now = Number.isFinite(settings.now) ? settings.now : Date.now();
    const windowMs = Number.isFinite(settings.windowMs) && settings.windowMs > 0 ? settings.windowMs : DEFAULT_WINDOW * HOUR;
    const width = Number.isFinite(settings.width) && settings.width > 0 ? settings.width : 0;
    const plan = tickPlan(windowMs, width);
    const minorMs = plan.minor * MINUTE;
    const out = [];
    // The first mark on or after now, on the minor grid, in local wall time
    // (a zone offset is a whole number of minutes, so the grid is aligned
    // by minute-of-day rather than by epoch arithmetic).
    const startMinute = localMinuteOfDay(now);
    const startSeconds = new Date(now).getSeconds() * 1000 + new Date(now).getMilliseconds();
    const firstOffset = ((plan.minor - (startMinute % plan.minor)) % plan.minor) * MINUTE - startSeconds;
    let t = now + (firstOffset < 0 ? firstOffset + minorMs : firstOffset);
    if (t < now) t += minorMs;
    const end = now + windowMs;
    while (t <= end) {
      const minuteOfDay = localMinuteOfDay(t);
      const hour = minuteOfDay % plan.hour === 0;
      const major = hour || minuteOfDay % plan.major === 0;
      const x = ((t - now) / windowMs) * width;
      const clearOfEdges = width <= 0 || (x >= LABEL_EDGE_PX && x <= width - LABEL_EDGE_PX);
      const labelled = minuteOfDay % plan.label === 0 && clearOfEdges;
      out.push({
        t,
        fraction: (t - now) / windowMs,
        kind: hour ? "hour" : (major ? "major" : "minor"),
        label: labelled ? formatClock(t) : ""
      });
      t += minorMs;
    }
    return { plan, marks: out };
  }

  /* --------------------------------------------------------------------
   *   Layout
   * ------------------------------------------------------------------ */

  const LANES = 3;
  /* A marker's permanent label is its hopper id alone - "B1", "C12" -
   * or, for a collapsed group, "N hoppers". Its width on the track is
   * estimated from the characters, at the timeline's type size, plus the
   * label's own offset from the stem and a little air before the next;
   * collision is worked in these pixels, not in minutes, so 6H and 12H
   * lay out the same way at their own scales. */
  const LABEL_CHAR_PX = 7.5;
  const LABEL_PAD_PX = 18;
  /* Markers within this many pixels of one another stand at effectively
   * the same instant - one event group - and are labelled as one. */
  const GROUP_PX = 4;
  /* The most hopper ids a group shows stacked on the lanes; more than
   * this, or fewer lanes free, and the group collapses to "N hoppers". */
  const STACK_MAX = LANES;

  function labelWidth(textLength) {
    return textLength * LABEL_CHAR_PX + LABEL_PAD_PX;
  }

  function groupLabel(size) {
    return `${size} hoppers`;
  }

  /**
   * Where everything goes. Positions are fractions of the window (0 = Now,
   * 1 = the window's far edge); lanes and crowding are worked in pixels from
   * the width the caller measured. Deterministic: the same inputs give the
   * same lanes, so two devices looking at one job draw the same picture.
   *
   * A marker's instant is the entry's `markAt` - its pump-off point when
   * there is a changeover, its empty-at estimate when there is not (see
   * WHERE THE MARKER STANDS above); an entry without one stands at its
   * empty-at estimate. `past` is that instant behind Now; `late` is a
   * pump-off point behind Now with the pump still running - the marker
   * the stage draws overdue.
   *
   * LABELS NEVER OVERLAP. Every marker's stem and dot stand at its exact
   * instant; only its label is laid out. Markers within GROUP_PX of one
   * another are one event group. A group of up to STACK_MAX ids takes one
   * free lane per id - stacked down the shared stem - when that many
   * lanes are free at its x (a lane is free once the last label in it has
   * ended, by its estimated width); otherwise, or when larger, it
   * collapses to one "N hoppers" label in the first free lane. When no
   * lane is free even for that, the group is folded into the group
   * placed before it, which becomes "N hoppers" where it stood. Nothing
   * is shrunk, nothing is moved along the axis, and the row never grows.
   *
   * @returns {{ markers, groups, beyond, unavailable, changeover, ticks }}
   *   markers      in the window, each { entry, at, fraction, lane, past,
   *                late, group, label } - `label` is the text this marker
   *                shows (its id, "N hoppers", or null for a member of a
   *                collapsed group whose first marker carries the label)
   *   groups       the event groups, each { id, fraction, lane, entries,
   *                collapsed, label }
   *   beyond       past the window's edge, soonest first
   *   unavailable  tracked with no estimate, in physical order
   *   changeover   { at, fraction, inWindow, past, stale, remainingMs } or null
   */
  function layout(inputs) {
    const settings = inputs || {};
    const now = Number.isFinite(settings.now) ? settings.now : Date.now();
    const windowMs = Number.isFinite(settings.windowMs) && settings.windowMs > 0 ? settings.windowMs : DEFAULT_WINDOW * HOUR;
    const width = Number.isFinite(settings.width) && settings.width > 0 ? settings.width : 1000;
    const entries = Array.isArray(settings.entries) ? settings.entries : [];
    const laneCount = Number.isInteger(settings.lanes) && settings.lanes > 0 ? settings.lanes : LANES;

    const at = entry => (Number.isFinite(entry.markAt) ? entry.markAt : entry.emptyAt);
    const inWindow = [];
    const beyond = [];
    const unavailable = [];
    for (const entry of entries) {
      if (!entry || !entry.tracked) continue;
      if (at(entry) === null || at(entry) === undefined || entry.reason) { unavailable.push(entry); continue; }
      if (at(entry) > now + windowMs) { beyond.push(entry); continue; }
      inWindow.push(entry);
    }
    beyond.sort((a, b) => at(a) - at(b) || a.key.localeCompare(b.key));
    inWindow.sort((a, b) => at(a) - at(b) || a.key.localeCompare(b.key));

    // Event groups: soonest first, each marker joining the group before it
    // when it stands within GROUP_PX of that group's first marker.
    const groups = [];
    for (const entry of inWindow) {
      const instant = at(entry);
      const past = instant < now;
      const fraction = past ? 0 : (instant - now) / windowMs;
      const x = fraction * width;
      const item = { entry, at: instant, fraction, x, past, late: past && entry.markKind === "pump-off" && !entry.pumpOff };
      const last = groups[groups.length - 1];
      if (last && x - last.x <= GROUP_PX) last.items.push(item);
      else groups.push({ id: groups.length, x, fraction, items: [item], lanes: [], collapsed: false });
    }

    // Lanes: where each lane's last label ends, from the groups placed so far.
    const laneEnds = () => {
      const ends = Array.from({ length: laneCount }, () => -Infinity);
      for (const g of placed) for (const slot of g.lanes) ends[slot.lane] = Math.max(ends[slot.lane], slot.end);
      return ends;
    };
    const freeLanes = (ends, x) => ends.map((end, lane) => (end <= x ? lane : -1)).filter(lane => lane >= 0);
    const stack = group => {
      group.collapsed = false;
      group.lanes = group.items.map((item, i) => ({ lane: -1, end: group.x + labelWidth(String(item.entry.id).length), item }));
    };
    const collapse = group => {
      group.collapsed = true;
      group.lanes = [{ lane: -1, end: group.x + labelWidth(groupLabel(group.items.length).length), item: group.items[0] }];
    };
    const place = group => {
      const ends = laneEnds();
      const free = freeLanes(ends, group.x);
      if (group.items.length <= STACK_MAX && free.length >= group.items.length) {
        stack(group);
        group.lanes.forEach((slot, i) => { slot.lane = free[i]; });
        return true;
      }
      if (free.length === 0) return false;
      collapse(group);
      group.lanes[0].lane = free[0];
      return true;
    };
    const placed = [];
    for (const group of groups) {
      if (place(group)) { placed.push(group); continue; }
      // Nothing free: fold into the group before it, which then stands
      // collapsed where it was (its own lanes are free again at its x).
      const previous = placed[placed.length - 1];
      previous.items.push(...group.items);
      placed.pop();
      const ends = laneEnds();
      collapse(previous);
      previous.lanes[0].lane = freeLanes(ends, previous.x)[0];
      placed.push(previous);
    }

    const markers = [];
    const groupsOut = [];
    for (const group of placed) {
      const label = group.collapsed ? groupLabel(group.items.length) : null;
      groupsOut.push({
        id: group.id, fraction: group.fraction, lane: group.lanes[0].lane,
        entries: group.items.map(item => item.entry), collapsed: group.collapsed, label
      });
      group.items.forEach((item, i) => {
        const slot = group.collapsed ? group.lanes[0] : group.lanes[i];
        markers.push({
          entry: item.entry, at: item.at, fraction: item.fraction, lane: slot.lane, past: item.past, late: item.late,
          crowded: false, group: group.id,
          label: group.collapsed ? (i === 0 ? label : null) : String(item.entry.id)
        });
      });
    }

    let changeover = null;
    const co = settings.changeover;
    if (co && Number.isFinite(co.at)) {
      const remainingMs = co.at - now;
      changeover = {
        at: co.at,
        remainingMs,
        stale: !!co.stale,
        past: remainingMs < 0,
        inWindow: remainingMs >= 0 && remainingMs <= windowMs,
        fraction: Math.max(0, Math.min(1, remainingMs / windowMs))
      };
    }

    return {
      now,
      windowMs,
      width,
      markers,
      groups: groupsOut,
      beyond,
      unavailable,
      changeover,
      ticks: ticks({ now, windowMs, width })
    };
  }

  /* --------------------------------------------------------------------
   *   Formatting
   * ------------------------------------------------------------------ */

  /** "2h 14m", "45m", "<1m"; a negative duration reads as "0m". */
  function formatRemaining(ms) {
    if (!Number.isFinite(ms)) return "—";
    if (ms < 0) return "0m";
    const minutes = Math.floor(ms / MINUTE);
    if (minutes < 1) return "<1m";
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    if (hours === 0) return `${rest}m`;
    return `${hours}h ${String(rest).padStart(2, "0")}m`;
  }

  /** A clock time in the operator's locale, hours and minutes. */
  function formatClock(t) {
    if (!Number.isFinite(t)) return "—";
    const date = new Date(t);
    try {
      return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    } catch (error) {
      return `${date.getHours()}:${String(date.getMinutes()).padStart(2, "0")}`;
    }
  }

  /** "12.5 lb/hr" - one decimal, as the application's Timeline states it. */
  function formatRate(rate) {
    if (!Number.isFinite(rate)) return "—";
    return `${rate.toLocaleString([], { maximumFractionDigits: 1 })} lb/hr`;
  }

  /* --------------------------------------------------------------------
   *   Operational marks
   * ------------------------------------------------------------------ */

  /**
   * What the drawn hoppers need of the projection and nothing more: per
   * slot, whether the hopper is tracked, late, and overdue. The renderer
   * writes these as classes; it derives no deadline of its own.
   *
   * @param {Array} entries  projectEntries' answer
   * @returns {Object<string, {tracked: boolean, late: boolean, overdue: boolean, pumpOff: boolean}>}
   */
  function hopperMarks(entries) {
    const out = {};
    for (const entry of Array.isArray(entries) ? entries : []) {
      if (!entry || !entry.key) continue;
      out[entry.key] = {
        tracked: !!entry.tracked,
        pumpOff: !!entry.pumpOff,
        late: !!entry.late,
        overdue: !!entry.overdue
      };
    }
    return out;
  }

  return Object.freeze({
    MINUTE,
    HOUR,
    WINDOWS,
    DEFAULT_WINDOW,
    LANES,
    LABEL_CHAR_PX,
    LABEL_PAD_PX,
    GROUP_PX,
    STACK_MAX,
    labelWidth,
    LABEL_EDGE_PX,
    REASONS,
    reasonLabel,
    consumptionRate,
    hopperRundown,
    projectEntries,
    hopperMarks,
    resolveChangeover,
    tickPlan,
    ticks,
    layout,
    formatRemaining,
    formatClock,
    formatRate
  });
});
