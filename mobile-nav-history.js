"use strict";

// Linear visited-view history for the mobile footer's Back / Forward
// controls (concept 7: "Back + Home, Forward on demand"). Pure and
// DOM-free on purpose - it only owns the stack and the pointer. app.js is
// the sole integrator: it captures the current mobile nav state into an
// opaque entry, feeds those entries in via record(), and re-applies
// whatever back()/forward() hand back.
//
// An "entry" is any value app.js chooses (today a small
// {workspace,panelId,tools,notes} descriptor). This module never inspects
// its shape beyond an equality check, which is also supplied by app.js so
// the comparison logic stays next to the thing it describes.
//
// Semantics match a browser history:
//   - record(entry) appended after the pointer; anything past the pointer
//     (the forward stack) is discarded, because reaching a new view always
//     invalidates "forward".
//   - record() is a no-op when the new entry equals the current one, so
//     redundant navigations and the re-entrant writes caused by applying a
//     back()/forward() result never grow the stack.
//   - the stack is capped; overflow drops the oldest entry and the pointer
//     shifts with it, so a long session cannot grow memory without bound.

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PolynMobileNavHistory = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const DEFAULT_LIMIT = 50;

  function createNavHistory(options) {
    const opts = options || {};
    const limit = Number.isInteger(opts.limit) && opts.limit > 1 ? opts.limit : DEFAULT_LIMIT;
    // Equality defaults to identity; app.js passes a real structural
    // comparison for its descriptor objects.
    const equals = typeof opts.equals === "function" ? opts.equals : (a, b) => a === b;

    let entries = [];
    let index = -1;

    function current() {
      return index >= 0 && index < entries.length ? entries[index] : null;
    }
    function canGoBack() {
      return index > 0;
    }
    function canGoForward() {
      return index >= 0 && index < entries.length - 1;
    }

    // Record a newly-reached view. Returns true only when the stack
    // actually changed (a genuinely new entry was appended).
    function record(entry) {
      if (entry == null) return false;
      if (index >= 0 && equals(entry, entries[index])) return false;
      // Drop the forward stack, then append.
      if (index < entries.length - 1) entries = entries.slice(0, index + 1);
      entries.push(entry);
      index = entries.length - 1;
      // Enforce the cap from the front so recent history is what survives.
      if (entries.length > limit) {
        const overflow = entries.length - limit;
        entries = entries.slice(overflow);
        index -= overflow;
      }
      return true;
    }

    function back() {
      if (!canGoBack()) return null;
      index -= 1;
      return entries[index];
    }
    function forward() {
      if (!canGoForward()) return null;
      index += 1;
      return entries[index];
    }

    function reset() {
      entries = [];
      index = -1;
    }

    return {
      record,
      back,
      forward,
      canGoBack,
      canGoForward,
      current,
      reset,
      // Introspection, for tests and diagnostics only.
      get length() {
        return entries.length;
      },
      get index() {
        return index;
      }
    };
  }

  return { createNavHistory };
});
