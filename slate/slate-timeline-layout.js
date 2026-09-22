/* The vertical timeline's geometry, without a document.
 *
 * Four pure functions over station-rundown.js's projected entries:
 *
 *   windowFor      how much time the axis spans - fitted to the changeover
 *                  when there is a usable one, a fixed 6 or 12 hours otherwise
 *   verticalTicks  the wall-clock marks down the axis, labelled as densely
 *                  as the height allows
 *   groupEvents    who is overdue, who is on the axis (in groups within
 *                  five minutes of a group's earliest member), who is beyond
 *                  the horizon, who has no estimate, who is pumped off
 *   placeCards     where each card sits so that none overlap and none leave
 *                  the axis, while every dot stays at its exact instant
 *
 * Nothing here is time-aware beyond the `now` it is handed, so the tests
 * can pin every case; the DOM module (slate-timeline.js) only draws.
 */
(function (root, factory) {
  const rundown = typeof require === "function"
    ? require("../station/station-rundown.js")
    : (root && root.PolynStationRundown);
  const api = factory(rundown);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynSlateTimelineLayout = api;
})(typeof globalThis !== "undefined" ? globalThis : null, function (rundownModule) {
  "use strict";

  const MINUTE = rundownModule.MINUTE;
  const HOUR = rundownModule.HOUR;
  const WINDOWS = rundownModule.WINDOWS;
  const DEFAULT_WINDOW = rundownModule.DEFAULT_WINDOW;

  /* A fitted window keeps this much room under the changeover for its
   * label, and is never shorter than an hour. */
  const FIT_MARGIN = 1.1;
  const MIN_WINDOW_MS = HOUR;
  const GROUP_MS = 5 * MINUTE;

  /* Tick ladders for a tall, narrow axis: a minor mark needs eight
   * pixels, a label twenty-eight (one line of small type with air). */
  const MINOR_LADDER = [1, 5, 10, 15, 30];
  const LABEL_LADDER = [5, 10, 15, 30, 60, 120, 180];
  const MINOR_MIN_PX = 8;
  const LABEL_MIN_PX = 28;
  const LABEL_EDGE_PX = 10;

  /* ---- The window ---- */

  /**
   * @param {object} options  { now, changeover: {at, stale} | null, horizonHours }
   * @returns {{ mode: "fit"|"fixed", windowMs: number, horizonHours: number, endAt: number }}
   */
  function windowFor(options) {
    const settings = options || {};
    const now = Number.isFinite(settings.now) ? settings.now : Date.now();
    const changeover = settings.changeover || null;
    const horizonHours = WINDOWS.includes(settings.horizonHours) ? settings.horizonHours : DEFAULT_WINDOW;
    const usable = !!(changeover && Number.isFinite(changeover.at) && !changeover.stale && changeover.at > now);
    if (usable) {
      const windowMs = Math.max((changeover.at - now) * FIT_MARGIN, MIN_WINDOW_MS);
      return { mode: "fit", windowMs, horizonHours, endAt: now + windowMs };
    }
    const windowMs = horizonHours * HOUR;
    return { mode: "fixed", windowMs, horizonHours, endAt: now + windowMs };
  }

  /* ---- The ticks ---- */

  function localMinuteOfDay(t) {
    const date = new Date(t);
    return date.getHours() * 60 + date.getMinutes();
  }

  function tickPlan(windowMs, height, minLabelGapPx) {
    const minutes = windowMs / MINUTE;
    const pxPerMinute = height > 0 ? height / minutes : 0;
    const minor = MINOR_LADDER.find(step => step * pxPerMinute >= MINOR_MIN_PX) || MINOR_LADDER[MINOR_LADDER.length - 1];
    const label = LABEL_LADDER.find(step => step >= minor && step * pxPerMinute >= minLabelGapPx) || LABEL_LADDER[LABEL_LADDER.length - 1];
    return { minor, major: 30, hour: 60, label };
  }

  /**
   * The marks down an axis `height` pixels tall spanning `windowMs` from
   * `now`, aligned to the wall clock by minute-of-day (as station-rundown's
   * ticks are), each with its pixel offset and a label when the plan gives
   * it one. No label sits within `edgePx` of either end: the Now line owns
   * the top, the changeover the bottom.
   */
  function verticalTicks(options) {
    const settings = options || {};
    const now = Number.isFinite(settings.now) ? settings.now : Date.now();
    const windowMs = Number.isFinite(settings.windowMs) && settings.windowMs > 0 ? settings.windowMs : DEFAULT_WINDOW * HOUR;
    const height = Number.isFinite(settings.height) && settings.height > 0 ? settings.height : 0;
    const minLabelGapPx = Number.isFinite(settings.minLabelGapPx) ? settings.minLabelGapPx : LABEL_MIN_PX;
    const edgePx = Number.isFinite(settings.edgePx) ? settings.edgePx : LABEL_EDGE_PX;
    const plan = tickPlan(windowMs, height, minLabelGapPx);
    const minorMs = plan.minor * MINUTE;
    const marks = [];
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
      const y = ((t - now) / windowMs) * height;
      const clearOfEdges = height <= 0 || (y >= edgePx && y <= height - edgePx);
      const labelled = minuteOfDay % plan.label === 0 && clearOfEdges;
      marks.push({
        t,
        fraction: (t - now) / windowMs,
        y,
        kind: hour ? "hour" : (major ? "major" : "minor"),
        label: labelled ? rundownModule.formatClock(t) : ""
      });
      t += minorMs;
    }
    return { plan, marks };
  }

  /* ---- The events ---- */

  function byMark(a, b) {
    if (a.markAt !== b.markAt) return a.markAt - b.markAt;
    return String(a.key).localeCompare(String(b.key));
  }

  function makeGroup(first, now, windowMs) {
    return {
      id: first.key,
      at: first.markAt,
      fraction: windowMs > 0 ? (first.markAt - now) / windowMs : 0,
      kind: first.markKind === "empty" ? "empty" : "pump-off",
      late: !!first.late,
      members: [first]
    };
  }

  /**
   * Sort the projected entries into what the pane shows.
   *
   * @param {Array} entries   station-rundown's projectEntries output
   * @param {object} options  { now, windowMs, groupMs }
   * @returns {{ overdue: {members}|null, groups: Array, later: Array, unavailable: Array, done: Array }}
   */
  function groupEvents(entries, options) {
    const settings = options || {};
    const now = Number.isFinite(settings.now) ? settings.now : Date.now();
    const windowMs = Number.isFinite(settings.windowMs) && settings.windowMs > 0 ? settings.windowMs : DEFAULT_WINDOW * HOUR;
    const groupMs = Number.isFinite(settings.groupMs) ? settings.groupMs : GROUP_MS;
    const list = Array.isArray(entries) ? entries : [];
    const done = [];
    const unavailable = [];
    const overdue = [];
    const later = [];
    const upcoming = [];
    for (const entry of list) {
      if (!entry || !entry.tracked) continue;
      if (entry.pumpOff) { done.push(entry); continue; }
      if (entry.reason || !Number.isFinite(entry.markAt)) { unavailable.push(entry); continue; }
      if (entry.markAt < now) { overdue.push(entry); continue; }
      if (entry.markAt > now + windowMs) { later.push(entry); continue; }
      upcoming.push(entry);
    }
    done.sort((a, b) => {
      const at = (Number.isFinite(a.markAt) ? a.markAt : Infinity) - (Number.isFinite(b.markAt) ? b.markAt : Infinity);
      return at !== 0 && Number.isFinite(at) ? at : String(a.key).localeCompare(String(b.key));
    });
    overdue.sort(byMark);
    later.sort(byMark);
    upcoming.sort(byMark);

    const groups = [];
    for (const entry of upcoming) {
      const open = groups.length ? groups[groups.length - 1] : null;
      // Anchored on the group's earliest member, so a chain of near
      // misses cannot stretch a group past the five minutes.
      if (open && entry.markAt - open.at <= groupMs) {
        open.members.push(entry);
        open.late = open.late || !!entry.late;
      } else {
        groups.push(makeGroup(entry, now, windowMs));
      }
    }
    return {
      overdue: overdue.length ? { members: overdue, kind: overdue[0].markKind === "empty" ? "empty" : "pump-off" } : null,
      groups,
      later,
      unavailable,
      done
    };
  }

  /* ---- The cards ---- */

  function mergeInto(groups, index) {
    const a = groups[index];
    const b = groups[index + 1];
    const merged = {
      id: a.id,
      at: a.at,
      fraction: a.fraction,
      kind: a.kind,
      late: a.late || b.late,
      members: a.members.concat(b.members),
      merged: true
    };
    return groups.slice(0, index).concat([merged], groups.slice(index + 2));
  }

  /**
   * Place the cards down the axis.
   *
   * Each card wants its top at its group's instant (`y0`). A sweep down
   * pushes a card below the one before it; if the last then hangs below the
   * axis, a sweep back up lifts them to fit; if that lifts the first above
   * the top (or the pinned overdue block), the two nearest groups merge and
   * the placement runs again - until it fits or one group is left, which
   * is then `clipped` and scrolls its own list.
   *
   * @param {Array} groups        groupEvents' groups
   * @param {object} options      { height, topInset, bottomInset, gap, cardHeight(group), pinned: {members}|null }
   * @returns {{ cards: Array<{group, y0, y, displacement, height}>, pinned: {y, height}|null, span, floor, ceiling }}
   */
  function placeCards(groups, options) {
    const settings = options || {};
    const height = Number.isFinite(settings.height) && settings.height > 0 ? settings.height : 0;
    const topInset = Number.isFinite(settings.topInset) ? settings.topInset : 0;
    const bottomInset = Number.isFinite(settings.bottomInset) ? settings.bottomInset : 0;
    const gap = Number.isFinite(settings.gap) ? settings.gap : 0;
    const cardHeight = typeof settings.cardHeight === "function" ? settings.cardHeight : () => 0;
    const span = Math.max(height - topInset - bottomInset, 0);
    const ceiling = height - bottomInset;

    let pinned = null;
    let floor = topInset;
    if (settings.pinned && Array.isArray(settings.pinned.members) && settings.pinned.members.length) {
      const pinnedHeight = cardHeight(settings.pinned);
      pinned = { y: topInset + gap, height: pinnedHeight };
      floor = pinned.y + pinnedHeight + gap;
    }

    let list = Array.isArray(groups) ? groups.slice() : [];
    let cards = [];
    let clipped = false;
    for (;;) {
      cards = list.map(group => ({ group, y0: topInset + group.fraction * span, y: 0, displacement: 0, height: cardHeight(group) }));
      let cursor = floor;
      for (const card of cards) {
        card.y = Math.max(card.y0, cursor);
        cursor = card.y + card.height + gap;
      }
      const last = cards[cards.length - 1];
      if (last && last.y + last.height > ceiling) {
        let limit = ceiling;
        for (let index = cards.length - 1; index >= 0; index -= 1) {
          const card = cards[index];
          card.y = Math.min(card.y, limit - card.height);
          limit = card.y - gap;
        }
      }
      const first = cards[0];
      if (!first || first.y >= floor) break;
      if (list.length === 1) { clipped = true; first.y = floor; break; }
      // Merge the two nearest neighbours by instant.
      let nearest = 0;
      let distance = Infinity;
      for (let index = 0; index + 1 < list.length; index += 1) {
        const d = list[index + 1].at - list[index].at;
        if (d < distance) { distance = d; nearest = index; }
      }
      list = mergeInto(list, nearest);
    }
    for (const card of cards) card.displacement = card.y - card.y0;
    if (clipped && cards[0]) cards[0].clipped = true;
    return { cards, pinned, span, floor, ceiling };
  }

  return Object.freeze({
    FIT_MARGIN, MIN_WINDOW_MS, GROUP_MS, MINOR_LADDER, LABEL_LADDER, MINOR_MIN_PX, LABEL_MIN_PX, LABEL_EDGE_PX,
    windowFor, tickPlan, verticalTicks, groupEvents, placeCards
  });
});
