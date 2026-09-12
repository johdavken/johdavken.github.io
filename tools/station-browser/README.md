# Station browser spec

Developer tool. Not part of the app, not loaded by it, no dependency in
`package.json`.

## Why it exists

Station's node tests drive the editor against a small fake DOM. That proves
structure and behaviour, but a `<foreignObject>` inside a scaled `<svg>`,
focus moving between an HTML input and SVG hit areas, and the FLIP focus
transition are exactly where engines disagree, and none of it can be
measured without a browser. This spec runs the same flows in Chromium and
Firefox and fails on the first difference from what the node tests promise.

It was written during the cross-browser hardening pass (Firefox as the
primary target, Chromium as the baseline). The two things that pass found -
the resin list running off the bottom of the stage on the lower rows, and
the percentage field clipping "100" (and measuring differently in each
engine, because Chromium resolves `ch` from an uninstalled first font
family) - are covered here so they cannot come back unnoticed.

## Using it

Playwright is deliberately not a project dependency. Install it anywhere
outside the repo and point the spec at it:

```
cd /somewhere/outside && npm i playwright && npx playwright install chromium firefox
cd /path/to/repo && python3 -m http.server 8765 --bind 127.0.0.1 &
PLAYWRIGHT_MODULE=/somewhere/outside/node_modules/playwright node tools/station-browser/spec.js
```

Options: `STATION_BASE` (default `http://127.0.0.1:8765`), `BROWSERS`
(default `chromium,firefox`). Exit code is non-zero on any failure; every
check is named in the output.

The spec runs against the application host (`/?view=station`) with a
three-layer session seeded into the browser context's own storage, so the
executor is connected and the editor's search and fields are real. Every
request that is not to `STATION_BASE` is aborted, so nothing reaches RT
Sync or Supabase; the seeded session lives only in that context. The
standalone harness (`/station/station.html?source=demo&demo=three-layer`), which has no
producer, is visited once at the end to check that it is read-only.

## What it checks

- **Shell** - the page is a header, the stage, the run-down timeline row
  and a status bar, each the full width of the shell, in one grid column;
  the timeline is one modest row with no heading; no side pane, no recipe
  strip and no mount for one remains; the line console is in the header.
- **Fast click before hover** - a click dispatched on a mixer, a hopper and
  an editor row with no preceding pointer movement lands exactly like a
  hovered one.
- **Open / close focus** - the transition reaches `focused` and back to
  `normal`; Escape mid-flight reverses it; three rapid clicks end focused;
  the layer's cluster lands back on its normal-row position to the pixel.
- **Resin search keyboard flow** - Enter on the value opens the search with
  the value selected; ArrowDown moves `aria-activedescendant`; Enter chooses,
  the application applies it (the row, the bridge snapshot and the hidden
  legacy field all agree), the search closes and focus returns to the
  value; Escape closes the search and not the layer; Tab closes it and
  moves on; a mousedown on the list does not close it.
- **Read-only harness** - with no application connected the values read,
  the resin value is announced disabled and does not open a search, the
  percentage is read-only, and the note says why.
- **Result list placement** - on the top row the list is below and fully
  hit-testable; on the bottom row it is above and fully hit-testable; a
  no-match list is re-placed.
- **Focused editor click targets** - the centre of each control hit-tests
  to that control through the `<foreignObject>`.
- **Row <-> hopper linkage** - hovering a row highlights its hopper and vice
  versa; clicking either selects both.
- **Hopper hit areas** - in overview and focus, vessel hardware, cones and
  labels all hit the owning hopper's tracking cell, and the receiver cone
  its pump cell. Every drawing element remains pointer-inert.
- **Tracking and pump-off** - a click on a hopper's body tracks it through
  the application (the bridge snapshot, the legacy grid's clock button and
  the saved session agree), draws the halo over its receiver in the
  layer's colour, leaves the pump alone, and neither selects the hopper
  nor opens the layer; a click on the receiver marks the pump off the same
  way, the amber goes and the receiver steps back, tracking untouched;
  each toggles back from the same place. Every tracked hopper wears one
  halo, nothing animates, no icon is drawn. In the open layer the drawn
  hopper toggles the same state and the rows carry no operational control.
  On the harness the controls are read-only and a click says why.
- **Percentage field** - "60", "100" and "33.33" all fit without clipping.
- **Hopper drag** - a press on a row's surface that does not travel is not
  a drag; one that does marks the row and the row under the pointer with
  no text selected; the drop moves the assignment through the application
  (the rows, the bridge snapshot and the hidden legacy fields agree, one
  history entry); every mark is gone afterwards; a press in the percentage
  field never becomes a drag; Escape cancels a drag and leaves the layer
  open.
- **Viewports** - 1920x1080, 1440x900 and 1160x800; no page scrollbar, the
  too-small notice hidden, the editor's content not scrolling inside it.

The last item that cannot be automated here is font rasterisation. Compare
`out/*-editor-2x.png` by eye when a Station font token changes.
