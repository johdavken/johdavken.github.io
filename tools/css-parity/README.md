# CSS parity probe

Developer tool. Not part of the app, not loaded by it, no dependencies.

## Why it exists

This project guards its CSS with ~8,200 source-level assertions that read
stylesheet **text**. They answer "does this rule say what we wrote". They
cannot answer "does the page still lay out the same".

The Gruvbox / Industrial Slate side-rail divergence sat in the repo unseen by
all of them: every rule involved said exactly what it was written to say, they
just resized the rail for four themes out of fourteen. Two of the offending
declarations were also completely dead — overridden by a later rule — while
three others were quietly reshaping the layout. Reading the CSS could not tell
you which was which. Measuring the rendered page could, in one pass.

So: capture what the browser actually computes, before a change and after it,
and diff. **A refactor that is supposed to change nothing visible must produce
an empty diff.**

## Using it

The capture step is a plain expression evaluated in the page — no driver
dependency, so it works with whatever browser tooling is to hand.

```
node tools/css-parity/probe.js --print          # print the expression
# serve the app, set the viewport, evaluate it, save the JSON as before.json
# ... make the change, reload, evaluate again, save as after.json
node tools/css-parity/probe.js --diff before.json after.json
```

`--diff` exits non-zero if anything moved.

Snapshots are **transient**. Take one before a change, one after, diff, throw
them away. They are deliberately not committed: they would churn on every CSS
edit, and a stale baseline is worse than no baseline.

### Drilling down

The default payload is a few kilobytes of counts and checksums, because a full
capture is ~200 KB of rule text. When a checksum moves, re-capture both sides
with the drill-down and diff again:

```
node tools/css-parity/probe.js --print-detail ayu-light   # one theme, in full
node tools/css-parity/probe.js --print-detail rules       # every selector
node tools/css-parity/probe.js --print-detail outlines    # every outline rule
```

`--diff` names the theme to drill into when a theme checksum changes.

### Theme parity

```
node tools/css-parity/probe.js --parity snapshot.json
```

Groups themes by identical layout. Themes should differ in colour, never in
geometry — more than one group means some theme is resizing something.

## Known-good delta

As of the side-rail fix, `--parity` reports **two groups**: the four themes
carrying the extra rail surface pass (Gruvbox Dark/Light, Industrial Slate and
its Dark variant) and the other ten. That split is expected and benign:

- `border-radius` 12px vs 16px on the rail, 0px vs 12px on the foldaway rows —
  a deliberate flat-surface choice for those four themes. Paint, not layout.
- `position: relative` vs `static` on four rail children — from a
  `.workspaceNav > *{position:relative;z-index:1}` stacking helper. No offsets
  are applied, so nothing moves.

**No box differs between the two groups.** If a `.box` difference ever appears
in that split, something has regressed.

## Caveats

- The probe records `viewport` and `--diff` refuses to compare snapshots taken
  at different sizes. Set the viewport through the driver; the probe cannot.
- It restores `data-theme` on `html`/`body` when it finishes, but it does cycle
  every theme to take the measurement, so don't run it against a page whose
  theme state you care about mid-interaction.
- Geometry only. Colour is theme-specific by design and would make every
  snapshot differ for the wrong reason.
- A `CSSStyleRule` exposes an empty `.cssRules` under CSS Nesting, so the rule
  walker tests `.length` before recursing. Testing truthiness alone silently
  skips every style rule and reports zero — this cost an hour once.
