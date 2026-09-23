# Slate — tablet / touch mode: design pass

Date: 2026-09-22. Branch audited: `slate/layer-orientation` at a7436e1 (worktree `../slate`,
clean). Every `file:line` below is from that tree. This is a plan for Opus 5.5 to implement
step by step; no code was changed in the session that produced it.

Target: 10–13" Android floor tablets, both orientations, in Chrome and inside the Capacitor
app, gloved/hurried operators. Mouse/desktop Slate must not change by a pixel.

---

## Implementation log

- 2026-09-22, branch `slate/tablet` (uncommitted): Steps 0, 1 and 2 done. The root width
  attribute is named `data-viewport`, not `data-width`: the admin sheet already styles a field
  attribute `data-width="short"`. Step 2 adds only the `input` preference; the `host`
  preference moves to Step 8, where it is consumed.
- 2026-09-22, user decisions: Open question 1 — one two-line touch row format everywhere,
  "for now" (no third tier for 13" landscape). Open question 2 — the portrait aside is a
  **drawer**. Option B stands as written.
- 2026-09-22, Steps 3–8 implemented (uncommitted). Deviations and notes:
  - Step 3: the ⋯ button, timeline pills, 6H/12H, calculator and panel close keep their boxes
    and take an invisible `::after` hit area, so no mirrored geometry moves. Row picking by
    the whole row, Shift-range on touch, and hiding Print in the app are NOT done.
  - Step 4: the card editor's Save/Cancel are always built and hidden by the base sheet, so the
    tier can flip live; wizard and time picker become centred fixed sheets under touch (they
    cover the button that opened them: close with × or a tap outside). A refused card draft is
    no longer thrown away by a calculator tap — a desktop change too, and a fix.
  - Step 4b: the timeline's pump pill hit area fills its 28px row only (never the next row);
    list-view rows stay 28px (a 3-step selector would be needed). Admin repaint-while-typing
    guards, the Workspaces typed-name state, timeline render deferral while a finger is down,
    and the sync panel's draft keeping are NOT done.
  - Steps 5/6 shipped together. Touch rows are ~73px with Automatic tracking, ~88px when a
    Track toggle shows.
  - Step 7: `slate/slate-dismiss.js` also carries the Back stack; the Tools flyout closes on an
    outside tap and on a selection (the sidebar keeps its stay-open rule). Keyboard behaviour
    in the Capacitor WebView is NOT verified on a device.
  - Step 8: the stored choice is read through `PolynSlateDisplay.readFrom(root)` so the host
    still never names storage. Under the thresholds the unfolded Z Fold (≈840×757 CSS) is not
    a tablet and keeps the floor UI in the app unless the device chooses Slate (Open question 3).
  - Step 9 (touch drag) and Step 10 (hover un-sticking) not started.
- 2026-09-22, user decision (Open question 3): the unfolded Z Fold gets Slate by default.
  TABLET_MIN_LONG lowered 960 → 900 (the Fold reports 933×704 CSS); the short side ≥ 600
  still keeps phones and the folded cover screen out. Fold feedback also fixed: a stale
  WebView zoom after an Android font-size change (the host resets zoom after load and marks a
  provisional tier before the sheets arrive), and the header under the status bar
  (`--slate-inset-top/bottom`).
- 2026-09-22, user feedback (Fold, head on the left): layer cards far too tall. Touch rows are now
  ONE line while the section has room, cells stretched to a ~40px pitch; two-line rows only when
  the recipe body is narrower than 780px (weights: 700px), via two named container queries
  (`@container slate-recipe` / `slate-weights`, pinned in slate-tier.test.js). Top layout keeps
  its two-line cards. Halted before Step 9 at the user's request.
- 2026-09-22, Step 9 done (uncommitted): (1) the Tools flyout is `position: fixed`, placed from
  the Tools item on open (`--slate-flyout-top/left`), and the rail is lifted to z-index 28 under
  touch (the sticky rail is its own stacking context) - verified a menu item receives the tap at
  its own centre, and a tap opens the tool. (2) Touch drag: a pen drags as a mouse; a finger
  lifts the badge after HOLD_MS 300 held within THRESHOLD_TOUCH 10 (moving first abandons it),
  the system context menu is suppressed while pressed, only badges with `data-movable` carry
  `touch-action: none`. Verified with raw CDP touch events on the hosted page (A1 onto empty A2).
  (3) Found on the way: a finger's choice in the resin list left its click to land on the cell
  beneath (opening that row's editor); the click is now spent once at the document.
- 2026-09-22, Step 10 done (uncommitted): all 36 hover rules wrapped in place in
  `@media (hover: hover)` (in place, so the cascade order against is-active/selected rules is
  unchanged); slate-isolation allows exactly that one condition and pins every `:hover` inside it.
- 2026-09-22, user request: under touch, Print is replaced by **Scan** (Job traveler / Dosing
  screen), which starts the application's own scan flow (`PolynRecipeScanUI.startScan`, handed in
  by slate.js as `ctx.scan`) for the Slate tab on screen. `recipe-scan-ui.js` and app.js's scan
  bridge now carry an optional destination ("current" | "next") to the review label, the
  overwrite warning and the apply (`applyRecipeToActivePage`'s existing `destination`); without
  one the floor UI's page decides, as before. Unavailable with a reason while read-only or with no
  connected line; the menu re-checks as it opens. The capture/review dialogs are the app's own
  (light, legacy-styled) `:modal` dialogs over Slate - a Slate-styled scan flow is not built.
  Heat sheet is not offered (not asked for).

## 0. Findings that correct the brief

These change the shape of the plan, so they come first.

1. **The Android app cannot show Slate today, whatever `slate-host.js` decides.**
   `scripts/build-www.js:31-43,69-74` builds `www/` from an allowlist parsed out of
   index.html's `src=`/`href=` attributes (plus one level of manifest icons). Slate's assets
   are loaded dynamically by `slate-host.js:180-193` and are deliberately never linked in
   index.html (`slate-host-isolation.test.js:83`). Result: `www/` holds `slate-host.js`,
   `slate-theme.js` and `slate-display.js` but no `slate/` directory (checked: `ls www/slate`
   is empty; `www/station` too). Activating Slate in the app would 404 every module and land
   on the "stale application" notice. Packaging is therefore a step of its own (Step 1).
2. **The breakpoint ratchet does not cover Slate.** `css-breakpoint-ratchet.test.js:81-93`
   counts `@media` blocks in `styles.css` (the legacy parts joined by `css-source.js:79-82`)
   only. The only breakpoint guard over `slate/styles/` is
   `slate-isolation.test.js:182-192`, which forbids *every* non-`prefers-*` media query.
   The plan keeps that test unchanged by using root attributes instead of media queries
   (Section 2.4).
3. **Hopper drag refuses touch and pen outright by design**: `slate/slate-recipe-drag.js:150`
   (`if (event.pointerType && event.pointerType !== "mouse") return;`, header comment lines
   1-13 "desktop only"). The pointer-event plumbing (capture, `pointercancel`,
   `lostpointercapture`, fixed proxy) is already touch-correct; what is missing is a gate,
   `touch-action` on the handle, and a decision (Open question 6). CLAUDE.md lists "Mobile
   hopper drag-and-drop" under future ideas, so this plan makes it an explicit, separable step.
4. **Pre-existing desktop bug, not a tablet one:** in the default Left layout the layer ⋯ menu
   opens into the layer card's `overflow: hidden` (`recipe.css:211`) and only a sliver shows.
   Verified in the browser at 1280×800: the menu list rect is y 527–615 while the card ends
   at y≈535. Top layout sets `overflow: visible` (`recipe.css:604`). Fix first (Step 0).
5. **CSS px, not inches, decide the tier.** A 10" 1920×1200 panel at DPR 2 reports
   960×600 CSS px in landscape; Samsung 11" tablets report 1280×800; the 12.4"/13" S-series
   report 1400×876 / 1480×924. So "tablet" spans 600–924 CSS px on the short side and
   960–1480 on the long side. The plan's tiers are keyed on the viewport width with the
   1100px threshold Slate already uses, plus a shortest-side test for the phone/tablet
   decision (Section 3).
6. **Measured, not estimated.** A playwright-core scratch script against the running 8797
   server (touch emulation, hosted `?view=slate` and the harness) measured every control.
   Appendix B has the table; the headline sizes are: rail items 207×36, hopper resin/blend
   cells 188×21 / 72×21, layer ⋯ button **26×12**, Current/Next tabs 26 tall, Compare/Bulk/
   Print 28 tall, calculator buttons 28×28, panel close 28×28, timeline 6H/12H 30×21, pump
   pills 18 tall, combobox options 29 tall, menu items 26 tall, most inputs 31–32 tall, the
   stat-card triggers 201×111 (fine). Nothing between the header and the Settings tiles
   reaches 44px.
7. **Second pre-existing desktop bug:** the Workspaces section draws the shared name-entry row
   (`recipe-book.css:76-91`, non-wrapping, `nowrap` label) inside its ≈497px detail card with a
   ≈430px label (`slate-workspaces.js:338-357`), so the line-name input collapses toward zero
   width and the buttons overflow the card at the 1440 design width. Fix with Step 0.

---

## 1. Audit

Categories: **1** hover-only · **2** mouse-only · **3** target < 44px · **4** fixed px ·
**5** precise pointing / drag · **6** keyboard-only path · **7** focus/blur with an on-screen
keyboard (OSK) · **8** popover position · **9** other. Sizes are measured where a number is
given without "≈", CSS arithmetic otherwise.

### 1.0 Shell level (the blocker)

| file:line | cat | what | fix (see §2) |
|---|---|---|---|
| `slate/styles/tokens.css:43-46`, `shell.css:21-22` | 4 | Frame `width` AND `min-width` 1440px; rail 232, aside 300, header 64. At 800×1280 only 800px of 1440 are visible: the bar's Compare/Bulk edit/Print, the Blend/Weight/Tracking columns, the sync trigger, the read-only badge and the whole aside are off-screen and reachable only by horizontal panning (screenshots `harness-port-800x1280.png`). At 1280×800 there is still 160px of horizontal scroll. | Touch tier: fluid frame, icon rail, drawer aside (§2.3). |
| `shell.css:61-73`, `slate-shell.js:24,80` | 9 | `.slate-too-small` is an inert node with a stale message ("at least 1100px wide"). | Leave; or remove with its pin in `slate-shell.test.js:15`. Not needed by the plan. |
| `slate/styles/base.css:11`, `shell.css:23`, `rail.css:8`, `panel.css:18`, `sync.css:74` | 4 | `100vh` five times. Chrome Android's `100vh` is the large viewport (URL bar retracted), so the rail's Settings foot and the sticky panel's foot sit under the URL bar until it retracts. The Capacitor WebView has no URL bar, but the keyboard behaviour depends on `windowSoftInputMode`, which `android/app/src/main/AndroidManifest.xml` does not set (Step 7 verifies on device). | `100dvh` with a `100vh` fallback line in the touch tier; drawer/panel flow rules in §2.3. |
| `slate/styles/host.css:34-46` | 9 | Hides the app by exclusion; `:modal` let through. Fine for tablets. The app's `<dialog>`s that Slate still lets through are legacy-styled — unchanged by this plan. | None. |
| `index.html:5` | 9 | Viewport meta is `width=device-width,initial-scale=1,viewport-fit=cover` — right for tablets; no `interactive-widget`, so Chrome keeps the layout viewport when the keyboard opens (`resizes-visual`). Slate must use `visualViewport` for anything that has to stay above the keyboard (§1.1 combobox, §1.2 popovers). | Do not change index.html's meta: the legacy app depends on it. |
| `android-back-button.js:32-42` | 9 | Hardware Back calls app.js's `handleAndroidBack()` and minimises the app when it returns false. Under Slate the legacy handler runs against hidden legacy state (returns true for "section→Main" and swallows the press) and knows nothing of Slate's popovers/drawer. | Step 7: a cancelable document event before the legacy handler. |
| `slate-host.js:151-175` | 9 | `desktop()` = not Capacitor native AND `(min-width: 1100px)`. Any tablet in the app, and any tablet narrower than 1100 in the browser, gets the floor UI. | Step 8 (§3). |

### 1.1 Recipe section

Files: `slate/slate-recipe.js`, `slate-recipe-form.js`, `slate-recipe-drag.js`,
`slate-layer-menu.js`, `slate-resin-search.js`, `slate-print.js`, `styles/components/recipe.css`,
`recipe-edit.css`.

| file:line | cat | what | size | fix |
|---|---|---|---|---|
| `recipe.css:20-28`, `slate-recipe.js:952-956` | 3 | Current/Next tabs: padding 4/12, 12px text | 49–64×26 | touch tier `min-height: 44px; padding: 10px 16px` |
| `recipe.css:49-58`, `slate-recipe.js:213-217` | 3 | `.slate-switch` Compare / Bulk edit | 72–75×28 | same |
| `recipe.css:94-102` | 3 | `.slate-recipe__plan-action` (Copy current→Next, Save as recipe…, Cancel, Fill, Clear selection, Replace existing) — the shared class behind most 28px buttons in Slate | 28 tall | touch tier `min-height: 44px` on this ONE class fixes ~40% of all small targets |
| `recipe.css:117-122` | 3 | `--promote` (Promote, Apply, Save, Set, Use) | 36 tall | 44 |
| `recipe.css:169,177` | 4 | Left rows `56px 1fr 72px 96px 84px 80px` (+5×12 gaps) = 448px fixed + resin; with the 184px head the Left layout needs ≈750px of centre. A touch-wide tier at 1100–1224px has 688–812. | — | Touch tier uses the two-line row of the Top layout (`recipe.css:637-660`) in BOTH orientations (§2.3). |
| `recipe.css:258-271`, `:637-642` | 3 | Rows have no gap; padding 8/12 (Left) and 4/8 (Top) → 37px / 29px pitch; every in-row control sits inside that | 37 / 29 | touch tier: row `min-height: 48px`, cells `align-self: stretch` so the whole cell height is the target |
| `recipe.css:286-288`, `slate-recipe.js:374` | 3/5 | Hopper id badge is a `span` and is the drag handle AND the bulk-edit pick target; hit height one text line | 56×21 | fill the row; `role="button"`/`tabindex` for parity |
| `recipe.css:299-302`, `slate-recipe.js:375-380` | 3 | Blend cell button, no padding | 72×21 | fill the row |
| `recipe.css:290-295` | 9 | Resin cell ellipsises; `title` never carries the code | 188×21 | wrap on touch, or `aria-label` = code |
| `recipe.css:250-256`, `:617-621` | 3 | Layer share button (Left 132×30, Top ≈40×24) | 132×30 | padding 8/12, `min-width: 44px` |
| `recipe.css:379-391`, `slate-recipe.js:1382-1392` | 3 | Track pill: padding 4/8, 11px | ≈64×24 | `min-height: 36px` + padding 8/12; the 84px column (`tokens.css:52`) still fits |
| `recipe.css:304-313`, `slate-recipe.js:132-135,413` | 1 | Smart-Hoppers entered weight only in `title` | — | inline second line or on-tap `say()` |
| `recipe.css:211` + `recipe-edit.css:207-222` | 8 | **Layer ⋯ menu clipped in Left layout** (Finding 0.4) | — | Step 0: `overflow: visible` on `.slate-layer.is-menu-open` (class set by slate-layer-menu.js on open), or flip the list upward |
| `recipe.css:487-496`, `slate-recipe.js:328` | 3/7 | Save-name input 30px; no `enterkeyhint` | 30 | field token 44; `enterkeyhint="done"` |
| `recipe.css:513-521` | 3 | Reset tracking (armed two-tap) | 111×36 | 44 |
| `recipe-edit.css:18-28` | 1 | `[data-able="true"]:hover` background is the ONLY cue that a resin/blend/share cell is editable; on touch cells look like static text | — | touch tier: persistent cue (dotted underline or faint field background) on `[data-able="true"]` cells |
| `recipe-edit.css:36-47,350-360,454-464` | 3 | Inline editor / bulk draft inputs `--slate-field-min-height: 30px` | 188×31, 72×31 | one token: touch tier `--slate-field-min-height: 44px` on `.slate-root` |
| `recipe-edit.css:84-97`, `slate-resin-search.js:147,255` | 8/4 | Combobox list absolute `top:100%; left:0; min-width:260px`, drops DOWN only (8 options ≈ 242px). Lower rows in portrait put the list under the OSK; on a 260px Top card it overhangs | 258×29 per option | touch tier: `RESULT_LIMIT` 5; flip above the field when `rect.bottom + listHeight > visualViewport.height + visualViewport.offsetTop`; `right:0` on right-edge cards (layer menu already does: `recipe-edit.css:489-496`) |
| `recipe-edit.css:99-105`, `slate-resin-search.js:106` | 3 | Combobox option padding 4/12 | 258×29 | touch tier padding 12 → ≈44 |
| `recipe-edit.css:133-140` | 5 | Handle has no `touch-action`/`user-select`/`-webkit-touch-callout`; `user-select:none` only while `.is-moving` (too late for the press) | — | on the handle: `touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none` (Step 9) |
| `recipe-edit.css:186-205`, `slate-layer-menu.js:56-59` | 3/1 | ⋯ button: 4px dots, 4px padding, faint colour that only becomes `--slate-text` on hover | **26×12** | `min-width/min-height: 44px` (36 on desktop is acceptable too), centred glyph, `--slate-text-muted` at rest |
| `recipe-edit.css:224-228`, `slate-layer-menu.js:64,68` | 3 | Menu items incl. armed "Confirm clear" | 178×26 | padding 12/16 |
| `recipe-edit.css:264-272,295-299`, `slate-recipe.js:228-235` | 3 | Print trigger and items | 51×28, 138×26 | 44 |
| `recipe-edit.css:412-416` | 3 | Bulk-edit pick targets = id/layer-name text line | 56×21 / 65×20 | make the whole row the pick target while drafting |
| `slate-recipe.js:308`, `slate-recipe-form.js:139-141`, `slate-resin-search.js:135-145` | 7 | Resin-code inputs lack `autocapitalize="characters"` and `enterkeyhint` (Android capitalises the first letter only and shows a generic key) | — | add both; `enterkeyhint="next"` in the bulk form (Enter advances, `form.js:180-187`), `"done"` elsewhere |
| `slate-recipe.js:844-866` + `slate-resin-search.js:209-213` | 7 | **Blur cancels the inline resin editor.** On a tablet the OSK's hide/back key, an app switch, a notification, or any failed focus-keep cancels silently. | — | touch tier: blur with `document.activeElement === body` keeps the editor open (only Escape/Cancel/choose close it); or commit-on-blur when the typed text is an exact code. Add a visible Cancel (×). |
| `slate-resin-search.js:105` | 2/7 | Options keep the input focused through a click by `preventDefault` on **mousedown**. On touch this relies on Chrome's compatibility mouse events (fired after `touchend`); when they are suppressed (a scroll that ends as a tap, a cancelled pointerdown) the tap blurs → `cancel()` fires before `click` and the option is gone. | — | make choosing focus-independent: set `choosing = true` on `pointerdown` (and preventDefault there); blur handler defers while `choosing`. Applies to `open` and `attach` (shared `paint`). |
| `slate-resin-search.js:193-208` | 6 | Active option defaults to index 0, so the IME "Go" with a partial query picks the first match, not "as typed" | — | document; optionally require exact match on touch |
| `slate-recipe.js:895-906` | 6/7 | Numeric inline editor: Enter commits, blur commits, **Escape is the only cancel** | — | visible Cancel beside the field on touch; blur-commit stays (right default) |
| `slate-recipe.js:907-909`, `form.js:92-99,246-251` | 7 | `select()` on open shows Android selection handles/toolbar | — | cosmetic; `setSelectionRange(len,len)` on touch |
| `slate-recipe.js:1237` | 7 | Bulk edit auto-focuses the first resin field → OSK pops and the fill strip/Apply drop behind it | — | no auto-focus in the touch tier |
| `slate-recipe.js:1006` | 7 | Save flow focuses the name field (expected) | — | `scrollIntoView({block:"center"})` on touch |
| `slate-recipe.js:1107-1126`, `slate-layer-menu.js:103,113` | 7 | Outside closers on document **capture-phase `pointerdown`**: the start of a scroll anywhere closes the menu | — | shared fix: close on `pointerup`/`click` with < 10px movement, or ignore `pointerType==="touch"` on down and add a `click` outside listener (§1.5 #2) |
| `slate-recipe.js:1373`, `form.js:197-210` | 6 | Shift-click range pick has no touch equivalent | — | accept (layer name picks the layer; taps pick rows) and document; or a "select to here" long-press later |
| `slate-recipe.js:973-978,1351-1355,1284-1288`, `slate-layer-menu.js:139-146` | 9 | Armed two-tap confirms disarm after 4 s (`slate-recipe.js:74`, `menu.js:15`) — a good touch pattern; the second tap lands on 26–36px targets | — | size fix; consider 6 s for gloves |
| `slate-recipe-drag.js:150` | 2/5 | Touch and pen refused (Finding 0.3) | — | Step 9: allow `pen` as-is; `touch` starts after a ~300 ms hold with `THRESHOLD_TOUCH = 10`; handle gets `touch-action: none` |
| `slate-recipe-drag.js:159` | 5 | `preventDefault()` on pointerdown does not stop panning on touch (CSS `touch-action` does) | — | as above |
| `slate-print.js:85` | 9 | `iframe.contentWindow.print()` is a no-op inside the Capacitor WebView; the Print menu will silently do nothing | — | hide Print under Capacitor, or return `{ok:false}` so `slate-recipe.js:1137` speaks |

Already touch-friendly (do not redo): pointer events + capture + `pointercancel` in the drag;
menus open on click; every disabled control `say()`s its reason on tap (`slate-recipe.js:875-876,
959, 971, 995, 1133, 1209, 1294, 1348, 1388`; `menu.js:130-133`); `inputmode="decimal"` on all
numeric fields; bulk `attach` search hides on blur without cancelling (`search.js:328-332`);
Top layout is fluid and sets `overflow: visible`; no `100vh`, no `scrollIntoView`, no
`mouseenter/dblclick/contextmenu` in these eight files.

### 1.2 Stat cards, calculators, time picker, pressure, header, RT Sync popover, conflict dialog

Files: `slate-stat-cards.js`, `slate-wizard.js`, `slate-changeover.js`, `slate-line-rate.js`,
`slate-time-picker.js`, `slate-pressure.js`, `slate-sync.js`, `slate-conflict.js`, and
`stat-cards.css`, `wizard.css`, `time-picker.css`, `pressure.css`, `sync.css`, `modal.css`,
`header.css`.

| file:line | cat | what | size | fix |
|---|---|---|---|---|
| `slate-stat-cards.js:406-416`, `stat-cards.css:104-109` | 6/7 | **Typed card editor has no touch cancel path**: Enter (408) and blur (416) both COMMIT; Escape (411-414) is the only cancel. On a tablet any tap outside the field dispatches the draft (setLineRate / setProductionPounds / setScrapPounds). The keyboard stealing focus (rotation, keyboard dismissed by Back on some devices) commits a partial value. | — | Add visible Save / Cancel in `.slate-card__editor`; Cancel must win over blur (`pointerdown` sets a flag the blur handler checks, or blur checks `relatedTarget`). Highest-priority correctness item in this group. |
| `slate-stat-cards.js:269-274` | 7 | Calc click runs after the editor's blur-commit; on a failed commit the note shows, then `if (editing) close()` discards draft and error | — | keep the editor open when the last commit failed |
| `slate-stat-cards.js:261`, `wizard.css:8-20` | 1/3/5 | Calculator button: icon-only, `aria-label`+`title` only, absolutely positioned 28×28 over the trigger's corner; a fat tap on the card's label lands on either | 28×28 | 44×44 hit box (padding + negative margin, or `::after` inset −8px on a `position:relative` button), glyph stays 18 |
| `slate-stat-cards.js:355-356`, `slate-wizard.js:225` | 7 | `focus()`+`select()` on open / every wizard step: keyboard pops and drops across the six changeover steps (flicker); selection handles | — | focus without `select()` on touch; acceptable to keep the autofocus |
| `stat-cards.css:5` | 4 | `repeat(4, minmax(0,1fr))` — fine at ≥1100; at a 688px centre the cards are 160px and the value text ellipsises | 201×111 | narrow tier: `repeat(2, minmax(0,1fr))`; touch-wide: value 24px |
| `stat-cards.css:79-81`, `pressure.css:60-69` | 9 | Value/answer `nowrap` + `ellipsis` at 28px: "1,234.56 lb/hr" truncates at ≤171px | — | let the unit wrap or move it to `__sub` |
| `stat-cards.css:117`, `wizard.css:93`, `time-picker.css:102-112`, `pressure.css:25-36` | 3 | Fields 40 / 40 / 40 / 32 tall | 137×40, 329×40, 56×40, 125×32 | field token 44 |
| `wizard.css:38-51`, `time-picker.css:6-19` | 4/8 | Popovers `position:absolute; top:100%; left:0; width:400px`, no `max-width`/`max-height`, anchored to the card's LEFT edge; the Line-rate wizard overhangs 197px into the Production card; never re-anchors; with the OSK up the Set/Use row can sit at the keyboard's edge | 400×182 (wizard), 400×≈270 (picker) | `width: min(400px, 100vw - 32px)`; `max-height: calc(100dvh - 240px); overflow:auto`; anchor `right:0` for cards in the right half (or compute) |
| `wizard.css:122-146`, `slate-wizard.js:155-157`, `slate-changeover.js:80` | 3 | Choice tiles (up to 10 "how many up") 5 per row, padding 8 → 39 tall | ≈67×39 | `min-height: 44px`, gap 12 |
| `wizard.css:160-165`, `slate-wizard.js:130-131,193-197` | 3/9 | Back ≈28, Next/Use 36, Adjust 28, right-aligned with 8px gaps | 59×36 | 44; gap 12 |
| `time-picker.css:43-65`, `slate-time-picker.js:112-135` | 3 | 26 hour/minute/AM-PM tiles | 54–56×39 | `min-height: 44px` (+10px popover height) |
| `time-picker.css:120-125`, `slate-time-picker.js:147-149,179` | 3/9 | Clear (dispatches a clear!) sits 8px from Cancel, identical quiet style; `hadValue` toggles Clear's presence so Cancel/Set shift between opens | 50×28 / 63×28 / 52×36 | 44; Clear to the left (`margin-right:auto`) with a distinct style; reserve the slot (`visibility:hidden`) |
| `slate-wizard.js:296-320`, `slate-time-picker.js:203-231`, `slate-sync.js:366-391` | 7/5 | Outside closers on document capture-phase `pointerdown`: a scroll that STARTS outside (e.g. to lift Set/Join above the keyboard) closes the popover and, for sync, `close()` resets `joining`/`relabelling` (384-387), discarding a half-typed code | — | shared fix (§1.5 #2); do not reset drafts on an outside close while a form has text |
| `slate-pressure.js:98,113-116`, `pressure.css:39-57` | 1/3/5 | psi⇄bar unit chip looks like a static label (11px muted pill); the affordance lives in `title`; 36×24 | 36×24 | segmented "psi \| bar" ≥44 tall, or a visible "⇄ bar" button |
| `slate-pressure.js:136,149`, `slate-winding-tension.js:184-193,204` | 7 | `onShow` autofocus → the keyboard pops the moment a tool is chosen from the rail; `flip()`/`reset()` refocus | — | skip autofocus in the touch tier |
| `header.css:13-22` | 3/1 | "Legacy" link 12px, no padding; underline only on hover (never reads as a link on touch) | 39×18 | `display:inline-flex; min-height:44px; padding: 0 8px`; always underlined or quiet-button style |
| `header.css:28-35` | 9 | Notice `nowrap` + `ellipsis` cuts a page-problem message mid-sentence at narrow widths | — | allow two lines (`-webkit-line-clamp: 2`) |
| `header.css:49-61`, `slate-shell.js:91` | 3/1 | Read-only badge 27 tall; that it opens Settings is `title`-only | ≈80×27 | 44 hit box; label "Read-only · Settings" or a chevron |
| `sync.css:7-20`, `slate-sync.js:110-115` | 3 | Sync trigger pill | 144×36 | `min-height: 44px` |
| `sync.css:68-82` | 4/8 | Panel `absolute; right:0; width:380px; max-height: calc(100vh − 88px)`; right-anchored to the 1440 frame's header — entirely off-screen at 800 wide today; `100vh` puts Join/actions under the keyboard | 380×314 | narrow tier: `position: fixed; left:16px; right:16px; width:auto; max-width:420px; max-height: calc(100dvh − 88px)`; touch-wide: keep absolute (the frame is fluid then) |
| `sync.css:231-239`, `slate-sync.js:185-192,229,293-296,313-342` | 3/9 | Every panel button ≈28 tall (`.slate-sync__button`); Save/Cancel 4px apart; "Confirm leave" (armed) 8px from Close | 57–71×28, 48×32 | `min-height: 44px` on the class; gaps 12; Leave at the far left (`margin-right:auto`) |
| `sync.css:207-223`, `slate-sync.js:217,309-310` | 3/7 | Inputs 32 tall; rename input not focused after tapping Rename (two taps); join code lacks `autocorrect="off" spellcheck="false" enterkeyhint="go"` | 70×32, 212×32 | 44; focus on entering relabel mode; add the attributes |
| `sync.css:161-184` | 3 | Device/line rows 12px, 4px apart, "Use this line" 28px inside | ≈90×28 | row `min-height: 44px`; whole row tappable |
| `modal.css:51-57`, `slate-conflict.js:72-76` | 3/9 | Three conflict answers 28/36 tall, 8px apart, wrapping | 150×36, 190×28, 95×28 | 44; gap 16; stack full-width in the narrow tier so no two answers are side by side |

Already touch-friendly: card triggers are full-card buttons with the refusal reason written into
the note on tap (`slate-stat-cards.js:338`); `type="text" inputmode="decimal|numeric"` everywhere
(`slate-stat-cards.js:213-217`); the picker replaces typing with tiles and has Set/Clear/Cancel/×;
the wizard has Back/Next/Adjust/Use/× and inline `role=alert` errors; the sync panel scrolls
internally, taps inside never close it, status updates never rebuild a form being typed into
(`slate-sync.js:410`), Leave is two-tap armed, the join code auto-uppercases; the conflict modal
is `position:fixed; inset:0` with `max-width:100%` (fits 800 portrait), scrim tap = Decide later.

### 1.3 Aside (Timeline, Resin Balance, Winding Tension), rail, Settings, sections

| file:line | cat | what | size | fix |
|---|---|---|---|---|
| `panel.css:12-19` + `panel.css:8-10` | 4 | Sticky panel `height: calc(100vh − 64 − 48); min-height: 480px`; wrapper `height:100%` for the sticky travel. Landscape 800 tall → 688px (fine); Chrome URL bar hides the panel's foot (pumped-off rows, Winding Clear at `margin-top:auto`); keyboard-shrunk viewports clamp to 480 and the lower half is under the keyboard | — | `100dvh` line; in the narrow tier the panel lives in the drawer at `height: 100%` and is not sticky (§2.3) |
| `panel.css:39-51` | 3 | `.slate-panel__close` — the one way back from a tool to the Timeline | 28×28 | 44×44 (or 28 visual + `::after` inset −8px hit area) |
| `rail.css:3-11` | 4/9 | `.slate-rail__inner` sticky `height: 100vh; overflow-y: auto` — a swipe starting over the rail scrolls the rail, not the page (nothing to scroll usually); Settings foot under the URL bar | — | `100dvh`; `overscroll-behavior: contain`; icon rail in the touch tier (§2.3) |
| `rail.css:98-110`, `slate-rail.js:118-127,136-143` | 3 | Rail items / Tools menu items, 4px apart | 207×36, 205×36 | touch tier `min-height: 48px`, gap 8; icon rail 48×48 |
| `slate-rail.js:72` | 1 | `title` is the only full label once labels are hidden | — | add `aria-label` to every item (one-line change in `item()`) |
| `rail.css:161-167`, `slate-rail.js:157-184` | 8/6 | Tools menu is in-flow (accordion) and closes only via Tools again or Escape — fine in a sidebar, wrong for an icon rail where it must be a flyout with an outside-close | — | `.slate-rail__menu` becomes a flyout under `[data-input="touch"]`; boot passes `dismissOutside: true` (§2.3) |
| `rail.css:15-28` | 9 | Brand SVG scales with rail width (≈110px tall at 208; ≈21px at 40) | — | compact mark: `max-height` + `padding` so it stays legible at 64px |
| `timeline.css:33-43`, `slate-timeline.js:166` | 3 | 6H / 12H buttons | 30×21, 36×21 | `min-height: 44px; min-width: 48px` |
| `timeline.css:362-365`, `slate-timeline.js:289-295,309` | 3/1 | Pump pill "Off"/"Back on": 18 tall inside a 28px member row; visible label is the ACTION ("Off" while running) and the state is in `title`/`aria-label` only | 44–70×18 | keep the 28px row geometry (it is mirrored in JS, next row) and extend the hit area with `::after {inset: -8px -4px}` on a `position:relative` pill; visible two-state label ("Running · Off" / "Off · Back on") |
| `slate-timeline.js:53-60` ↔ `timeline.css:262-263,292-295,307-310,323,127` | 4 | Geometry mirrored: CARD_PAD 12 ↔ padding 6/8 (**2px border uncounted**, `cardHeight()` line 93); CARD_HEAD 18 ↔ `__when` 18; MEMBER_ROW 28 ↔ `__member` 28 (and list `min-height:28`); CARD_FACTS 16 ↔ `__facts` 16; TOP/BOTTOM/CHANGEOVER insets ↔ label offsets (183, 221); gutter 58/52/49/46/54/68 (138-158, 241, 253, 261, 282) | — | Do not grow the member row in the touch tier (hit-area technique instead). Optional: read the constants from CSS custom properties at render so the two cannot drift. Add `CARD_BORDER = 2`. |
| `slate-timeline.js:428-434,485-489` | 7 | Re-focus after a row move without `preventScroll`: on a horizontally panned tablet each 20 s tick yanks the sheet to the focused pill | — | `focus({preventScroll:true})`; only when focus was actually lost |
| `slate-timeline.js:316-318,466-489,574-594` | 5 | Rows move between cards/pinned/foot on every tick/sync; a pill can jump under a finger between down and up | — | defer `render()` while a pointer is down inside the panel |
| `slate-timeline.js:627-639` | 9 | No double-tap guard: a hurried double tap sends Off then Back on | — | ignore a second click on the same control within ~400 ms of a committed one |
| `slate-timeline.js:518-520,608`, `timeline.css:369-387` | 1 | List-row kind ("empty at" vs "pump off by") and later-chip clock live in `title` | — | inline the words / clock |
| `slate-timeline-layout.js:228-280`, `timeline.css:273-276,391-397,118-130` | 9 | Short axis (600-tall landscape, keyboard) collapses groups into one `is-clipped` card with an invisible nested scroll; pumped-off foot shrinks to a sliver | — | switch to the list view automatically when `span` < ~300px; `overscroll-behavior: contain`; foot `min-height: 64px` |
| `timeline.css:258-267`, `resin-balance.css:140-146` | 4 | Card `left: 68px` in a 252px panel → 184px cards; resin names ellipsise. Assumes aside = 300 | — | drawer width 360 in the narrow tier gives 312; touch-wide keeps 300 |
| `slate-resin-balance.js:144,151`, `resin-balance.css:122-130` | 9 | List rebuilt on every update resets a nested scroll | — | preserve `scrollTop` or patch rows by `data-resin` |
| `winding-tension.css:229-239,360-368`, `slate-winding-tension.js:103-106,151` | 3/7 | Inputs 84×32; Clear 55×28; no `enterkeyhint` | 84×32, 55×28 | field token 44; `enterkeyhint="next"/"done"` |
| `settings.css:246-257,297-316`, `slate-settings.js:214-241` | 3 | Admin disclosure 34 tall; email/password 32; Sign in/out ≈77×28; no `enterkeyhint`, no `autocapitalize="none"` on email | 858×34, ≈77×28 | 44; attributes |
| `slate-settings.js:299-300,321` | 7 | Re-focus on a failed sign-in re-pops the keyboard while the error note sits BELOW the form (under the keyboard) | — | note above the fields |
| `slate-settings.js:76,93,110-198` | 3 (OK) | Theme tiles 203×165, mode buttons 206×89–161 — already right | — | none |
| `settings.css:94,103,168,171` | 9 | `--slate-radius-xs`, `--slate-radius-pill`, `--slate-shadow-control`, `--slate-transition-fast` are undefined anywhere | — | define or replace (not a touch item; fix while there) |
| `slate-sections.js:64-81` | 7 | `show()` hides the outgoing section without blurring a focused field → Android keeps the keyboard up on a `display:none` input | — | blur `doc.activeElement` if it is inside the outgoing wrapper |

Already touch-friendly: everything is click/input driven; unable controls `say()` on tap
(`slate-timeline.js:637`, `slate-settings.js:296,326`); Settings tiles and every segmented mode
button are ≥200×60; timeline rows are built once and moved so a tapped button keeps focus;
Winding computes on `input` (no blur-commit); `aria-pressed`/`aria-current`/`aria-haspopup`
present.

### 1.4 Recipe Book, Weights, Workspaces, Line Configuration, Resin Database

Files: `slate-recipe-book.js`, `slate-weights.js`, `slate-workspaces.js`, `slate-line-config.js`,
`slate-resin-db.js`, `recipe-book.css`, `weights.css`, `admin.css`. Nothing here is positioned:
More… is an inline row, confirms are inline boxes, the admin confirm replaces the detail face.
List rows are full-width `<button aria-pressed>` ≈265×56 (`recipe-book.css:153-165`) — fine.

| file:line | cat | what | size | fix |
|---|---|---|---|---|
| `recipe-book.css:8-17` | 3 | `.slate-book__action` — the button class for all five sections (Save Current/Next, Refresh, Load, Update, More…, Rename/Duplicate/Delete, every confirm, Diagnostics, Create Line, Add Line/Resin, Save Changes, Discard, Deactivate…) | text+26 × 28 | touch tier `min-height: 44px; padding: 8px 16px` on this ONE class |
| `slate-recipe-book.js:460-467`, `recipe-book.css:277-279` | 3/5 **high** | "Load into Current" and "Load into Next" are 28px tall, 8px apart, and the confirm box IS the confirmation: a finger on the wrong one changes the RUNNING recipe with no further step | 130×28 / 112×28 | touch tier: 44 tall, `gap: 16px`, stacked (`flex-direction: column`); Cancel first |
| `slate-recipe-book.js:441-446`, `slate-weights.js:858` | 3/5 | More… items Rename / Duplicate / Delete inline 28px, 8px apart; Delete (danger) beside Duplicate | 66–84×28 | 44; Delete on its own line or `margin-left:auto` |
| `slate-recipe-book.js:187`, `:256-257`, `slate-weights.js:265-268,688` | 3/7 | Name entries 30px, no `enterkeyhint`; `focus()`+`select()` on open while the entry row sits at the TOP of the section and the More… tap was in the detail card below | 30 | field token 44; `enterkeyhint="done"`; `scrollIntoView({block:"nearest"})` after focus |
| `slate-recipe-book.js:545-552`, `slate-weights.js:968-976` | 5 | Re-tapping the selected row DESELECTS (a confirmed departure per memory); a hesitant gloved double-tap selects then deselects | — | ignore a second click on the same row within ~350 ms |
| `recipe-book.css:167-169` | 1 | Row `:hover` sticks after a tap; after a deselect the row keeps the hover tint and reads as still selected | — | Step 10, or a touch-tier reset on this one rule |
| `recipe-book.css:76-91`, `slate-workspaces.js:338-357` | 4 **desktop bug** | `.slate-book__entry` is one non-wrapping flex line with a `nowrap` label; Workspaces draws it INSIDE the ≈497px detail card with a ≈430px label ("A new line, created with this device's current setup…") → the name input collapses toward 0 and the buttons overflow, today, at 1440 (Finding 0.7) | input ≈0×30 | `flex-wrap: wrap`; label `flex: 1 0 100%` (or `white-space: normal`) |
| `recipe-book.css:128` | 4 | Book/Weights/admin detail grid `minmax(240px,1fr) 2fr` — fine at 858; under 640px the confirm rows wrap | — | narrow tier: `grid-template-columns: 1fr` |
| `weights.css:59-71,104` | 4 | Fixed tracks `56px … 128px [128px 160px]` = 520px + gaps; a centre under ≈640px overflows the card and `overflow:hidden` clips the Computed column | — | touch tier: the Top-style stacked rows (`weights.css:284-329`, `minmax(260px,1fr)` cards, 7em fields), same comma-extension as the recipe rows |
| `weights.css:151-155,188-198`, `slate-weights.js:508-526` | 3/5 **high** | Weight/geometry fields 30px in rows with 4px padding and no gap → 38px pitch, 8px between adjacent fields; with Smart on, two fields 12px apart per row. A gloved tap lands on the neighbouring hopper | ≈105×30 | field token 44; row `padding: 8px 12px`; `.slate-weights__rows { gap: 4px }` |
| `slate-weights.js:426-444` | 6 **high** | Escape is the ONLY way to discard a weight/geometry/circumference draft (`cancelField`); blur commits. A touch operator who mistypes has no cancel | — | a "Revert" button in the row while `is-editing` (calls `cancelField`); `enterkeyhint="done"` on `:227,509,522` |
| `slate-weights.js:469-484` | 7 | `abandonEdit` (structural publish, `onHide`) blurs the input and drops the draft — slams the keyboard shut mid-entry with only the `say(ABANDONED)` toast | — | keep; patch the row in place when only the shape flag changed |
| `slate-weights.js:417-418,609-610`, `weights.css:200-204` | 1 | Read-only fields explain themselves via `title` only; a tap does nothing and says nothing | — | `click` on a `[readonly]` field → `say(reason)` (the string exists at `:610`); a lock glyph |
| `slate-weights.js:573,579`, `weights.css:227-234` | 1 | Computed-weight explanation is `title`-only and the cell ellipsises at 160px | — | tap → row note (`setRowNote`), or a one-line legend |
| `slate-weights.js:226-234` | 3 | Circumference 6em×30; Smart Hoppers switch 28 | 84×30, 107×28 | 7em, 44; switch 44 |
| `admin.css:217-223,343-347`, `slate-line-config.js:537-548` | 3/5 **high** | Chip radios (Layers 1/3/5, Inside/Outside, Main+N, Cylindrical/Volume, Plast-Control/TSM) 28px tall, **4px** apart; single-digit chips ≈33×28; a layer-count tap rewrites the whole layer table (`:825-850`) | 33×28 … 86×28 | touch tier `min-height/min-width: 44px; padding: 10px 16px; gap: 8px` |
| `admin.css:330-341,357-365`, `slate-line-config.js:559-562,629-634` | 3 | `5ch` numeric fields ≈39×30 in 4px-padded rows → 38px pitch for the six hopper counts; `12ch` fields 92×30 | 39×30 | 44 tall, `6ch`; row padding 8 + gap 8 |
| `slate-line-config.js:1034-1048`, `slate-resin-db.js:832-845` | 6/7 **medium** | Enter in ANY editor field SAVES the line definition / catalog record if dirty. Android's IME "Done" sends Enter, so dismissing the keyboard after typing a display name saves (validated, unconfirmed; the resin save refreshes every device's catalog) | — | `enterkeyhint="next"` and move focus to the next `[data-field]` on Enter; Save Changes buttons exist (`line-config.js:619`, `resin-db.js:454`) |
| `slate-workspaces.js:869→490`, `slate-line-config.js:1051-1054→662`, `slate-resin-db.js:847→484` | 7 | Every bridge publish repaints the detail and REBUILDS the inputs: focus and the keyboard are lost mid-typing; Workspaces also loses the typed line name (`view.value` is not kept on `input`) | — | skip `drawDetail()` when `detailPane.contains(doc.activeElement)`; keep the Workspaces draft in state on `input` |
| `slate-workspaces.js:601-602`, `slate-line-config.js:752-753`, `slate-resin-db.js:573-574` | 5 | `busy()` row guard is silent (the race fix from memory): a tap during "Loading…" does nothing, operators re-tap and the toggle at `workspaces.js:827` may deselect once the load lands | — | `say("Still loading…")`, `aria-busy` on the list, dimmed rows |
| `slate-workspaces.js:396-414`, `admin.css:89-134` | 3/5 | Device-row actions "Make Owner" / "Disconnect" (danger) 28px, 8px apart on the wrapped actions line; device label ellipsised with no touch reveal | 96×28, 92×28 | 44; gap 12; Disconnect `margin-left:auto`; label wraps |
| `admin.css:144-152`, `slate-workspaces.js:423-428`, `slate-line-config.js:578-583`, `slate-resin-db.js:405-410` | 3 | Maintenance fold toggles ≈26 tall (full width) | full×26 | `min-height: 44px` |
| `slate-workspaces.js:456-465` | 3 | Merge-target chips 28, 8px gap; re-tap unchecks | — | 44 |
| `slate-resin-db.js:280-283,336`, `admin.css:410-418` | 3/7 | Search `type=search` 32px (native clear ×, good), no `enterkeyhint`; `disabled` while busy blurs a focused search and closes the keyboard | 100%×32 | 44; `enterkeyhint="search"`; `aria-busy` on the list instead of disabling |
| `slate-resin-db.js:464-468` | 3/7 | Resin code field lacks `autocapitalize="characters"`; density fields `inputmode=decimal` (good), 30px | 100%×30, 92×30 | attributes; 44 |
| `admin.css:154-157,225-228`, `recipe-book.css:19,43,56` | 1 | Unconditional cosmetic hovers | — | Step 10 |

Already touch-friendly: pure `click`/`input`/`keydown` delegation with `closest()` (a tap on a
row's inner span resolves to the row); rows ≈56px at 60px pitch; numeric fields are
`type=text` + `inputmode` with `pattern`, never `type=number`; hopper-count fields are
`maxlength=1`, select-on-focus, last-digit-wins (`slate-line-config.js:791,1028-1032`);
`data-able="false"` buttons `say()` on tap (`recipe-book.js:560`, `weights.js:983`,
`workspaces.js:840-843`, `line-config.js:1009-1012`, `resin-db.js:811-814`); typed admin fields
are written in place (`setField`/`syncDirty`); `role=switch`/`radio`/`aria-pressed`/`aria-live`
throughout.

### 1.5 Cross-cutting patterns, ranked by leverage

1. **The frame** (§1.0). Every other finding sits behind it.
2. **Four shared classes carry ~80% of the small targets**: `.slate-recipe__plan-action`
   (`recipe.css:94-102`), `.slate-sync__button` (`sync.css:231-239`), `.slate-panel__close`
   (`panel.css:39-51`), `.slate-rail__item` (`rail.css:98-110`), plus the two field tokens
   `--slate-field-min-height` (30/32/40 → 44) and the tile padding in wizard/time-picker.
   Raise them once under the touch tier attribute.
3. **Capture-phase document `pointerdown` outside-closers** in seven places
   (`slate-wizard.js:308`, `slate-time-picker.js:220`, `slate-sync.js:379`,
   `slate-layer-menu.js:103`, `slate-recipe.js:1117`, and the resin search's blur rule): on
   touch, `pointerdown` fires at touch-start, so *starting a scroll* closes the popover. One
   shared helper (`slate/slate-dismiss.js`, Step 7) that closes on `pointerup`/`click` with
   < 10px movement, plus an explicit close stack for the Android Back key.
4. **Blur semantics with an OSK**: numeric editors commit on blur (right); the inline resin
   search cancels on blur (`slate-resin-search.js:209-213`) and keeps focus via compat
   `mousedown` (`:105`); the card editor commits on blur with no cancel
   (`slate-stat-cards.js:406-416`). Give each a visible Cancel and make choosing
   focus-independent.
5. **Hover-only information**: editable-cell cue (`recipe-edit.css:18-22`), ⋯ button colour
   (`:195-198`), Legacy underline (`header.css:19-22`), pump state/list-row kind/later-chip
   clock (`slate-timeline.js:289,518,608`), smart-weight source (`slate-recipe.js:413`),
   pressure chip (`slate-pressure.js:114`), read-only badge (`slate-shell.js:91`). Everything
   else hover-related is cosmetic and merely sticks after a tap on Android.
6. **Autofocus pops the keyboard**: Bulk edit (`slate-recipe.js:1237`), Winding on show/Clear
   (`slate-winding-tension.js:184-193`), Pressure on show/flip (`slate-pressure.js:136,149`),
   each wizard step (`slate-wizard.js:225`). Gate on the touch tier.
7. **Input hints**: `inputmode` is consistently right; `enterkeyhint` is missing everywhere;
   `autocapitalize="characters"` missing on resin-code fields; `autocapitalize="none"` on the
   admin email.
8. **`100vh` and nested scrolls** (`rail.css:8,10`, `panel.css:18`, `sync.css:74`,
   `timeline.css:122,275,396`, `resin-balance.css:129`): `100dvh` lines and
   `overscroll-behavior: contain`; prefer flowing layouts in the narrow tier.
9. **Moving targets**: the Timeline re-places rows on every tick and sync
   (`slate-timeline.js:316-318,466-489,574-594`); the time picker's Clear appears/disappears
   (`slate-time-picker.js:179`).
10. **No mouse-only events anywhere in Slate** (the one `mousedown` is the resin search's
    focus-keep). No `(hover:)`/`(pointer:)` queries anywhere. No `touch-action` anywhere.

---

## 2. Layout decision

### 2.1 Facts the layout has to respect

- Frame 1440 = rail 232 + centre 908 (858 content) + aside 300 (252 panel). Header 64.
- Left rows need ≈750px of centre (`recipe.css:169`); Top cards are 260–278px and wrap
  (`recipe.css:595`, measured: three 278px cards at 858).
- Stat cards need ≈185px each to keep "12,400 lb" at 28px un-truncated.
- Popovers are 380–400px wide, absolutely anchored.
- Tablet viewports (CSS px): landscape 960×600 … 1480×924; portrait 600×960 … 924×1480.
- The desktop is pinned: `slate-shell.test.js:41-48` (frame width + `min-width`, no
  `@media (max-width`), `slate-isolation.test.js:182-192` (no non-`prefers` media query),
  `slate-display.test.js:305-321` (Top rules scoped to `.slate-root[data-layers="top"]`, no
  `@media (m(in|ax)-width` in recipe/recipe-edit/weights).
- The pane registry (`slate/slate.js:355-371`) builds each section ONCE into one of three
  mounts (centre / aside / stats). Moving the Timeline into the centre in portrait would mean
  re-parenting a built section between swaps and re-teaching `setActivePane`; avoid.

### 2.2 Options

**Option A — scale the sheet.** `.slate-root[data-input="touch"] .slate-shell { zoom: calc(100vw / 1440px) }`
(or `transform: scale()`). One rule, no reflow, no guard-test change.

```
1280×800 (zoom .89)                        800×1280 (zoom .56)
┌──────┬──────────────────────┬───────┐   ┌────┬───────────┬────┐
│ rail │ cards cards cards c. │ aside │   │rail│ c c c c   │asd │  everything 56%:
│ 206  │ ─────── recipe ───── │  267  │   │130 │ recipe    │168 │  21px cells → 12px,
│      │                      │       │   │    │           │    │  36px rail → 20px
└──────┴──────────────────────┴───────┘   └────┴───────────┴────┘
```

Tradeoffs: touch targets shrink exactly when they need to grow; portrait is unreadable;
`zoom` changes `getBoundingClientRect` arithmetic for the drag proxy and popovers and
interacts with `100vh` sticky panels. Reject as the mode. (It remains a legitimate ONE-LINE
stop-gap for 1225–1439px landscape windows with a fine pointer, which this plan leaves
scrolling as the user's commit 5e4c7fe chose.)

**Option B — one fluid frame, two touch tiers, same panes (recommended).**
The frame becomes `width: 100%; max-width: 1440px` only under the touch tier. The rail
collapses to a 64px icon rail in both tiers (labels hidden, `aria-label` carried, Tools as a
flyout). Above 1100px the three panes stay; below 1100px the aside becomes a right-hand
drawer over the content and the stat cards go 2×2. The recipe uses the Top layout's two-line
hopper row in both orientations under touch, which is what makes the Left layout fit a
688px centre and gives 47px rows for free.

```
touch-wide (≥1100): 1280×800            touch-narrow (<1100): 800×1280 / 960×600
┌──┬─────────────────────────┬───────┐  ┌──┬──────────────────────┐  ┌──┬─────────────┐
│▤ │ Recipe  Legacy  [sync]  │       │  │▤ │ Recipe   [⏱ 5·1] [sync]│  │▤ │ …  drawer ─▶│
│▤ │ ┌────┐┌────┐┌────┐┌────┐│ Time- │  │▤ │ ┌────────┐┌────────┐ │  │▤ │ ┌──┐┌──┐ ░░░░│
│▤ │ │chg ││rate││prod││scrp││ line  │  │▤ │ │ chg    ││ rate   │ │  │▤ │ │  ││  │ ░Tim│
│▤ │ └────┘└────┘└────┘└────┘│ 300   │  │▤ │ └────────┘└────────┘ │  │▤ │ └──┘└──┘ ░eli│
│▤ │ Layer A │ A1 HX204  60% │       │  │▤ │ ┌────────┐┌────────┐ │  │▤ │ Layer A  ░ne │
│  │ Inside  │    400 lb  ○  │       │  │  │ │ prod   ││ scrap  │ │  │  │ …        ░360│
│  │ 25%  ⋯  │ A2 LD105  30% │       │  │  │ └────────┘└────────┘ │  │  │          ░   │
│  │         │    380 lb  ○  │       │  │  │ Layer A │ A1 HX204 60%│  │  │          ░   │
│⚙ │ …                       │       │  │⚙ │ Inside  │    400 lb ○ │  │⚙ │          ░   │
└──┴─────────────────────────┴───────┘  └──┴──────────────────────┘  └──┴─────────────┘
 64        916 (868 content)     300      64      736 (688)               scrim + drawer
```

Widths: 1100 → centre 688 content; 1200 (12" portrait) → 788; 1280 → 868; 1480 → 1068
(frame caps at 1440 → centre 1028, cards 4×245). Narrow: 800 → 688; 960 → 848; 600 → 488
(Top gives one card per row, Left still fits: 184 + 40 + 72 + 84 + 36 + ≥72).

Layer orientation: unchanged and honoured in both tiers. Top gives 3 cards at ≥1100, 2 at
688–860, 1 below 560. Left keeps the head beside; only the row format changes. Reversed
order is `order:` arithmetic and needs nothing.

Tradeoffs: two rail presentations (labels vs icons) and one new surface (the drawer) to
test; the two-line row makes touch landscape slightly less dense than desktop landscape.
Nothing is re-parented, the three-pane registry, `setActive/setActivePane/setListed`
(`slate-rail.js:203-237`, DOM-id based) and every section module survive unchanged.

**Option C — bottom tab bar + single pane ("app" mode).** Rail → bottom bar (Recipe, Book,
Weights, Timeline, Tools, Settings); the Timeline becomes a centre section in the narrow
tier; stat cards a horizontally scrollable strip.

```
800×1280
┌──────────────────────────────┐
│ Recipe        Legacy  [sync] │
│ ◀ chg │ rate │ prod │ scrap ▶│  (scroll strip)
│ Layer A │ A1 HX204 60% …     │
│ …                            │
├──────────────────────────────┤
│  ▤     ▥     ⚖     ⏱    ⚙   │  bottom bar
└──────────────────────────────┘
```

Tradeoffs: most native-feeling in portrait; but the Timeline must move between panes by
tier (re-parenting a built section, `slate.js:363-371` and `slate-rail.test.js:242` "the
Timeline swaps in the aside without a rail item" both change), the Tools "stays open" policy
cannot survive a bottom bar, the bar covers the Save/Reset foot, and landscape gains nothing
over B. Higher risk for no landscape benefit. Keep as a later refinement of B's narrow tier
if operators ask for it (Open question 2).

### 2.3 Recommendation: Option B, with these specifics

- **Attributes, not media queries.** The boot writes `data-input="touch"|"pointer"` and
  `data-viewport="wide"|"narrow"` on the Slate root (beside `data-layers`, `data-layer-order`,
  `data-readonly`; `slate/slate.js:164-170`). Every tablet rule is
  `.slate-root[data-input="touch"] .slate-x` or
  `.slate-root[data-input="touch"][data-viewport="narrow"] .slate-x` — two steps, so the ≤2-step
  rule holds, and no `@media` is added, so `slate-isolation.test.js:182` holds unchanged.
  The pointer tier has no rule of its own (the sheets ARE the pointer tier), mirroring the
  Left/Top pin in `slate-display.test.js:305`.
- **New layout tokens in `tokens.css`** (not theme tokens, so the theme tests are untouched):
  `--slate-tap: 44px`, `--slate-rail-width-compact: 64px`, `--slate-drawer-width: 360px`.
  Under the touch tier the root re-points `--slate-rail-width` to the compact width and
  `--slate-field-min-height` to `--slate-tap`.
- **Shell** (`shell.css`): under touch, `.slate-shell { width: 100%; min-width: 0; max-width: var(--slate-frame-width); }`
  — the base rule keeps `width/min-width: var(--slate-frame-width)` so `slate-shell.test.js:45`
  still matches. Under narrow, `grid-template-columns: var(--slate-rail-width) minmax(0,1fr)`
  and areas without `aside`.
- **Rail** (`rail.css`): under touch, `.slate-rail__label`, `.slate-rail__chevron` hidden;
  items 48×48 centred; brand compact; `.slate-rail__menu` a flyout
  (`position:absolute; left:100%; top:0; min-width: 220px; background: var(--slate-surface-raised); box-shadow: var(--slate-shadow-card)`)
  with an outside-close the boot enables via a new `rail.create` option `dismissOutside`.
  `slate-rail.js:72` gains `aria-label`.
- **Aside drawer** (narrow only): `.slate-aside { position: fixed; top: 0; right: 0; bottom: 0; width: min(var(--slate-drawer-width), calc(100vw - var(--slate-rail-width))); transform: translateX(100%); transition: transform var(--slate-motion-move) var(--slate-motion-ease); z-index: 30; padding: var(--slate-space-4); background: var(--slate-surface); border-left: … }`;
  `.slate-root.is-aside-open .slate-aside { transform: none }`; a `.slate-shell__scrim`
  built by the shell builder (hidden unless narrow + open; `background: var(--slate-scrim)`,
  the token the conflict modal already defines in all 14 themes). The panel inside is
  `position: static; height: 100%` (the drawer is the height). The Timeline keeps measuring
  its axis while translated off-screen (transforms do not affect layout), so it never
  re-lays out on open. Opened by a header button `slate-header__aside` (built by
  `slate-shell.js` next to the sync mount, hidden unless narrow, label = the aside's current
  panel title + the timeline's tracked/overdue counts), by selecting an aside section on the
  rail, and closed by ×/scrim/Escape/Android Back. The open state is a root class owned by
  `slate.js`, not by `slate-sections.js`.
- **Stats** (`stat-cards.css:5`): narrow → `repeat(2, minmax(0,1fr))`.
- **Recipe rows**: broaden the Top row rules (`recipe.css:637-660`, `recipe-edit.css:483-486`,
  the `weights.css` equivalents) with a second selector `.slate-root[data-input="touch"] …`
  (a comma list, so the Top pin regex, which matches per selector containing `data-layers`,
  still passes); row `min-height: 48px`; cells stretch.
- **Popovers**: `width: min(400px, calc(100vw - 32px))`; `max-height: calc(100dvh - 240px); overflow: auto`;
  sync panel `position: fixed` under narrow. The combobox flips above its field using
  `visualViewport`.
- **Hit areas where geometry is mirrored in JS** (timeline pills, 6H/12H, calc button, panel
  close, ⋯ button): `position: relative` + `::after { content: ""; position: absolute; inset: -8px; }`
  extends the target without moving a pixel of layout. Use it wherever a real size change
  would ripple into `slate-timeline-layout.js` constants.
- **What stays exactly as is on desktop**: everything. A fine-pointer 1440+ window gets no
  touch attribute and not one new rule matches. This is testable: the CSS parity probe idea in
  `tools/css-parity/` can be reused as a computed-style snapshot at 1440×900 pointer before
  and after each step (Appendix A).

### 2.4 Why not `@media (pointer: coarse)` / `(hover: hover)`

The isolation test's breakpoint rule collects every non-`prefers` condition; allowing
`(pointer: coarse)` would make the sheets decide the tier while the boot also decides it
(Settings override, Capacitor). One decider — the boot — and attribute scoping keeps the
Settings override honest and the test unchanged. The one thing media queries do better is
un-sticking cosmetic `:hover` after a tap on Android; that is Step 10, optional, and the only
place the rule would grow (`(hover: hover)` only).

---

## 3. Activation

### 3.1 Two different questions

- **Which UI does a bare URL boot?** (`slate-host.js:151-175`, once, before any Slate asset
  loads). Coarse device-class decision: desktop / tablet → Slate; phone → floor UI.
- **Which tier does Slate draw?** (`slate.js`, live, follows rotation and the Settings
  choice). Fine decision: `data-input` from the pointer + Capacitor + preference,
  `data-viewport` from the viewport width.

Keep them separate; the host must not depend on `slate/` modules (they load after it), and
the tier must react to rotation without a reload.

### 3.2 `slate-host.js` change (Step 8)

```js
const MIN_WIDTH = 1100;          // a desktop's window, as today
const TABLET_MIN_SHORT = 600;    // shortest side of a tablet-class screen, CSS px
const TABLET_MIN_LONG = 960;

function tabletScreen() {        // screen.*, not innerWidth: orientation-stable
  const w = Number(root.screen && root.screen.width), h = Number(root.screen && root.screen.height);
  if (!(w > 0 && h > 0)) return false;
  return Math.min(w, h) >= TABLET_MIN_SHORT && Math.max(w, h) >= TABLET_MIN_LONG;
}
function coarse() { try { return !!root.matchMedia && root.matchMedia("(pointer: coarse)").matches; } catch (e) { return false; } }
function native() { … as today … }

function slateDevice() {
  if (native()) return tabletScreen();                 // app: tablets yes, phones no
  if (wide()) return true;                             // desktop window, as today
  return coarse() && tabletScreen();                   // touch tablet in a browser
}
```
`requested()` keeps `?view=slate` → yes, any other named view → no, and otherwise consults a
**persisted host choice** before `slateDevice()`: `PolynSlateDisplay.read(localStorage).host`
∈ `auto | slate | legacy` (a new key in `slate-display.js` DEFAULTS; `slate-display.js` is
loaded before the host by `index.html:79-80`, and the host already calls
`display.initialize`). `legacy` wins on any screen; `slate` wins only where `tabletScreen()`
or `wide()` holds (Slate was never drawn for phones). Settings › "This device opens" writes
it. This is what makes the choice survive a cold start inside the app, where there is no URL
bar (the header's Legacy link is `?view=legacy` and lasts one session).

Phones: a phone's short side is ≤ ~450 CSS px, landscape or not, so `tabletScreen()` is
false in both orientations and the decision does not flip on rotation. A touch laptop's
primary pointer is fine, so it takes the desktop path. The unfolded Z Fold (short side ≈ 700)
is a tablet-class screen under these numbers — Open question 3.

### 3.3 Tier computation (Step 2)

`slate/slate-tier.js` (new, pure + one observer):
`tierFor({ coarse, native, width, preference }) → { input: "touch"|"pointer", width: "wide"|"narrow" }`
with `preference` from `slate-display.js` `input: "auto"|"touch"|"pointer"` (default auto;
auto = coarse OR native). `observe(view, onChange)` subscribes to
`matchMedia("(pointer: coarse)")` and `matchMedia("(min-width: 1100px)")` change events and
returns an unsubscribe. The boot's `renderLayout()` (`slate.js:164-170`) writes both
attributes; `onDisplayChange` re-runs it. No section module reads the tier: the sheets do
(and the few JS behaviours that must know — autofocus, RESULT_LIMIT, hold-to-drag, the rail's
outside-close — take it from `ctx.tier()`).

### 3.4 Capacitor app: which screens get Slate

Recommendation: tablets in the app get Slate (that is the point of the mode); phones keep the
floor UI, unchanged. Two prerequisites are steps of their own: packaging (Step 1) and the
Back key (Step 7). Until Step 8 lands, the app keeps today's behaviour exactly, and Slate on
a tablet is testable in Chrome with `?view=slate` plus Settings › Input = Touch.

---

## 4. Guard-test changes

| test | today | change | replacement rule |
|---|---|---|---|
| `slate-isolation.test.js:182-192` "no width breakpoint" | forbids every non-`prefers` `@media` | **unchanged** through Steps 0–9 | — |
| `slate-isolation.test.js` (new) | — | add "every tablet rule is scoped to the root's input/width attributes": any selector containing `data-input` or `data-viewport` must match `^\.slate-root\[data-input="touch"\](\[data-viewport="narrow"\])? \.slate-[a-z_-]+`; no sheet may mention `data-input="pointer"` or `data-viewport="wide"`; `shell.css`, `rail.css`, `stat-cards.css`, `recipe.css` each carry at least one touch rule once Steps 5–6 land | the pointer tier is the sheet itself |
| `slate-isolation.test.js:154-160` ≤2 steps | — | unchanged; the attribute chain is one compound | — |
| `slate-isolation.test.js:196-225` "no override pile" | forbids the same selector setting a property twice at top level | unchanged; touch rules use different selectors | — |
| `slate-isolation.test.js:23-35` `SLATE_FILES`, `slate-host.js` `SCRIPTS`, `slate/slate.html` | roster | add `slate-tier.js`, `slate-dismiss.js` (Steps 2, 7) | — |
| `slate-shell.test.js:41-48` "keeps one 1440px composition" | pins `width`+`min-width` and no `@media (max-width` | unchanged (the base rule keeps both lines); add in `slate-tablet.test.js`: the touch override sets `width: 100%; min-width: 0; max-width: var(--slate-frame-width)` | fluid only under the attribute |
| `slate-shell.test.js:15` "every mount exactly once" | — | the shell gains `slate-header__aside` button and `slate-shell__scrim`; extend the assertion list | — |
| `slate-host.test.js:82,106,127`, `slate-host-isolation.test.js:101` | "phone-width bare URL creates nothing"; "desktop window → Slate, phone or native app → floor UI" | rewrite in Step 8 to the device rule: native+tablet screen → Slate; native+phone → floor; browser 800×1280 coarse → Slate; browser 900-wide fine → floor; 1440 fine → Slate; stored `host: legacy` → floor everywhere; stored `host: slate` on a phone → floor; nothing to measure → floor | "a phone, in any orientation and in the app, keeps the floor UI; a tablet-class screen gets Slate" |
| `slate-host.test.js:151-166` theme/display restore | — | unchanged | — |
| `slate-display.test.js` | Settings groups in order Appearance, Tracking, Safety, Layout, Layer order, Timeline | add `input` (Automatic/Touch/Pointer) and `host` (Automatic/Slate/Legacy) with the same shape as `:240-303`; new groups AFTER Timeline so the order pins stay | — |
| `slate-display.test.js:305-321` Top-rule scoping | per-selector regex on `data-layers` | unchanged; the touch selector is a separate comma member | — |
| `slate-rail.test.js:39,104` | items carry a glyph; Tools closes on its item and Escape | add: every item has `aria-label`; with `dismissOutside`, an outside press closes the menu | — |
| `slate-sections.test.js:116` "stays open through a press elsewhere" | — | unchanged (default option is still sticky) | — |
| `slate-theme.test.js` | token set, contrast | **unchanged**: no new colour token (the drawer scrim spends `--slate-scrim`) | — |
| `slate-timeline*.test.js` | geometry constants | unchanged if the hit-area technique is used; if `CARD_BORDER` is added, `placeCards` fixtures shift by 2px | — |
| `slate-isolation.test.js` "Slate is not bundled into the Android shell" | www/ carries no `slate/` file | **replaced in Step 1** | www/ carries exactly the `slate/` files `slate-host.js` loads, nothing else (no harness, no plan, no tests) |
| `station-isolation.test.js` "Station is not bundled into the Android shell" | only index.html's Station bridge ships | **widened in Step 1** | also the `station/` files `slate-host.js` names (the pure run-down and print-sheet modules); no Station UI |
| `build-www.test.js:25-97` | allowlist from index.html + manifest icons | add "www/ contains every asset `slate-host.js` names in STYLESHEETS/SCRIPTS" and "the allowlist follows the host lists, not a directory glob" | one more one-level follow, like the manifest |
| `css-breakpoint-ratchet.test.js` | `styles.css` only | unchanged | — |
| `css-cache-tags` / `slate-production-host.test.js:46` | VERSION + index.html tag recorded | bump `slate-host.js` VERSION and the `?v=` of `slate-host.js`, `slate-display.js` on every step that touches them; run `node tools/css-cache-tags.js --update` (if it refuses new bytes under a tag already bumped in the branch: `git checkout script-cache-tags.json` and re-run) | — |
| new `slate-tablet.test.js` | — | boots the hosted chain like `slate-display.test.js:bootHosted` with a fake `matchMedia`; asserts the attributes, the drawer class, the Settings override, that a pointer/wide boot adds no attribute-scoped match, and that rotation (a matchMedia change) flips `data-viewport` without a rebuild (every row keeps its element, as `slate-display.test.js:440` does for layers) | — |

Optional Step 10 (hover un-sticking) is the only step that would touch the breakpoint rule,
and only to allow `^\(hover: (hover|none)\)$`.

---

## 5. Implementation plan

Each step is one session, ships on its own behind the touch attribute (desktop is untouched
until Step 8), and ends with `node --test *.test.js` under `ulimit -v` (see memory
"Fake-DOM assert OOM"), `git diff --check`, a `regression-reviewer` pass, and the Playwright
probe of Appendix A at 1440×900 pointer (must be byte-identical to the previous step) and at
the tablet viewports. Do not commit unless asked. Work on a branch off `slate/layer-orientation`.

**Step 0 — Fix the Left-layout ⋯ menu clip.** *(tiny; desktop bug)*
`slate-layer-menu.js` toggles `is-menu-open` on the layer element (it already knows `open`);
`recipe.css` adds `.slate-layer.is-menu-open { overflow: visible; }` (2 steps). Test: a
`slate-layer-menu.test.js` case that the class is set/removed; browser check at 1280×800.
Same session: `.slate-book__entry { flex-wrap: wrap }` with the label `flex: 1 0 100%`
(`recipe-book.css:76-91`) so the Workspaces name entry (Finding 0.7) gets its input back;
check Recipe Book, Weights and Workspaces entries at 1440×900 before/after.

**Step 1 — Package Slate into `www/`.** *(risky only for the Android build)*
`scripts/build-www.js`: a `hostAssetReferences("slate-host.js")` that parses the `STYLESHEETS`
and `SCRIPTS` arrays (regex over the source, like `manifestIconReferences`) and adds them to
`files`; optionally the same for `station-host.js` (ask; Station is not needed for tablets).
Tests in `build-www.test.js` per §4. Verify: `node scripts/build-www.js`, `ls www/slate`,
`assemblePlayDebug` (memory: JBR at /opt/android-studio/jbr; revert
`capacitor.settings.gradle` after `cap sync` in a worktree), install on the Fold via
kdeconnect, open `index.html?view=slate` is NOT reachable in the app (no URL bar) — so this
step is verified by the build alone plus `android-debugger`. Nothing user-visible.

**Step 2 — Tier plumbing + Settings › Input.**
New `slate/slate-tier.js` (pure `tierFor`, `observe`); `slate-display.js` gains `input`
(`auto|touch|pointer`) and `host` (`auto|slate|legacy`) with getters/setters and the
`normalize` rules of the others; `slate-settings.js` gains two groups after Timeline
("Input: Automatic / Touch / Pointer" — "Touch: larger targets, a compact rail, the timeline
in a drawer on narrow screens"; "This device opens: Automatic / Slate / Legacy"); `slate.js`
`renderLayout()` writes `data-input` and `data-viewport`, `observe` re-runs it on change,
`ctx.tier`. Register in `SLATE_FILES`, `SCRIPTS`, `slate.html`. Add the new isolation test
(attribute scoping) and `slate-tablet.test.js` skeleton. No visible change beyond Settings.
Bump `slate-display.js` `?v=` and the host VERSION.

**Step 3 — Touch targets, pass 1: the recipe.** *(risky: the row format)*
Under `[data-input="touch"]`: `--slate-field-min-height: 44px` on the root; tabs/switches/
plan-actions/promote/print/reset to 44; the two-line row in both orientations (comma-extend
the Top rules; `min-height: 48px`; cells `align-self: stretch`); ⋯ button 44×44 + muted
colour; menu items and combobox options 44; editable-cell cue; `RESULT_LIMIT` 5 under touch;
combobox flips above the field via `visualViewport`; `autocapitalize`/`enterkeyhint` on the
resin/blend/name fields; no autofocus in Bulk edit under touch; Cancel (×) beside the inline
numeric editor; resin search: `pointerdown`-based choosing and the "blur with no
relatedTarget keeps the editor open under touch" rule. Tests: `slate-recipe.test.js`,
`slate-resin-search.test.js`, `slate-recipe-form.test.js` cases for each behaviour; a fake
`matchMedia` in the booted tests. Browser: tap every control at 1280×800 and 800×1280 with
`hasTouch`; screenshot both orientations in Left and Top.

**Step 4 — Touch targets, pass 2: cards, popovers, header, sync, conflict.**
Save/Cancel in the card editor (Cancel wins over blur); calc button 44 hit box; tile
`min-height: 44px`; popover `width: min(400px, calc(100vw - 32px))`, `max-height` +
`overflow`, right-anchoring for right-half cards; time picker Clear separated and slot
reserved; header Legacy 44, badge 44, notice two lines; sync trigger/buttons/inputs/rows 44,
join-code attributes, rename autofocus, Leave far left, drafts survive an outside close;
conflict buttons 44 and stacked under narrow; pressure chip → segmented toggle; no autofocus
under touch in pressure/wizard steps. Tests per module.

**Step 4b — Touch targets, pass 3: rail, aside panels, Settings, Recipe Book, Weights, admin.**
Rail items 48 + `aria-label`; panel close 44 hit; 6H/12H 44; pump pill hit area + two-state
label; `preventScroll` on timeline re-focus; double-tap guard; render deferral while a
pointer is down; Winding fields/Clear/`enterkeyhint`, no autofocus under touch; Settings
admin row/fields/buttons 44, note above the form, `autocapitalize="none"`; `sections.show()`
blurs the outgoing focus. §1.4: `.slate-book__action` 44; Load into Current/Next stacked
with a 16px gap; More… items 44 with Delete apart; weights rows 44 fields + gap and a Revert
button while editing; read-only weight fields `say()` on tap; admin chips 44 with 8px gaps;
`5ch` fields → `6ch`×44; Enter in admin editors moves to the next field instead of saving;
repaints skip `drawDetail()` while a field inside it has focus (and Workspaces keeps its typed
name in state); `busy()` refusals `say()` and set `aria-busy`; `enterkeyhint`/`autocapitalize`
on every code/name/search field. Tests per module (`slate-recipe-book.test.js`,
`slate-weights.test.js`, `slate-workspaces.test.js`, `slate-line-config.test.js`,
`slate-resin-db.test.js`).

**Step 5 — Touch-wide layout (landscape).**
`shell.css`/`tokens.css`/`rail.css`: fluid frame under touch, compact rail, flyout Tools
menu with `dismissOutside` (a `rail.create` option; boot passes `ctx.tier().input === "touch"`),
compact brand, stat value 24px under touch. Verify at 1280×800, 1200×1920, 1480×924, and
1440×900 pointer (unchanged). Tests: `slate-tablet.test.js` shell/rail rules;
`slate-rail.test.js` outside-close.

**Step 6 — Touch-narrow layout (portrait and small landscape).** *(risky: the drawer)*
Shell gains the `slate-header__aside` button and `slate-shell__scrim`; `slate.js` owns
`is-aside-open` (open on header button / rail selection of an aside section; close on ×,
scrim, Escape); `panel.css` drawer rules; stats 2×2; sync panel fixed; conflict actions
stacked. Verify at 800×1280, 960×600, 600×960 (the smallest plausible), in Left and Top,
reversed order, List and Realtime timeline; the timeline's axis measured while closed;
`ResizeObserver` does not fire on open. Tests: drawer state machine in
`slate-tablet.test.js`; `slate-shell.test.js` mount list.

**Step 7 — Dismissal stack, Android Back, keyboard.** *(needs `android-debugger` + a device)*
New `slate/slate-dismiss.js`: `register(close) → unregister`, `dismissTop()`, and the shared
outside-closer (`pointerdown` records the point; `pointerup`/`click` outside with < 10px
movement closes). Replace the seven capture-phase closers. `android-back-button.js`
dispatches `new CustomEvent("polyn:android-back", { cancelable: true })` on `document`
before calling `handleAndroidBack`, and stops if `defaultPrevented` (the same document-event
seam `polyn:line-configurations` already uses); `slate.js` listens and calls
`dismissTop()`, then closes the drawer, else lets the event through (the app minimises).
Header `padding-top: env(safe-area-inset-top)` under `[data-input="touch"]` when native.
Verify `windowSoftInputMode` behaviour in the WebView on the tablet/Fold (fields above the
keyboard, popovers not closed by the keyboard opening). Tests: `slate-dismiss.test.js`; a
production-host test that app.js still knows nothing of Slate (the event is dispatched by
`android-back-button.js`, and `slate-production-host.test.js:62` scans app.js only —
extend it to `android-back-button.js` naming no Slate global).

**Step 8 — Activation.** *(risky: production users on tablets switch UI)*
`slate-host.js` per §3.2 (+ `host` preference read); tests per §4; `slate-host-isolation`
wording. Ship after Steps 1–7 so a tablet's first Slate is the finished tier. Before merging:
a live check on the tablet in Chrome (bare URL) and in the APK (cold start → Slate; Settings
› This device opens › Legacy → cold start → floor UI).

**Step 9 — Touch drag (optional, separable).** *(risky: scroll conflicts)*
*Added 2026-09-22 (user report, Fold): fix the Tools flyout first.* On the compact rail the
Tools button works and the menu opens, but it cannot be seen or tapped: `.slate-rail__inner`
is `overflow-y: auto` (rail.css), which makes its x-overflow clip too, so the flyout at
`left: 100%` is cut off at the rail's edge and taps fall through to the page (verified:
elementFromPoint on a menu item returns `.slate-layer__role`). Fix by rendering the flyout
outside the scrolling box - e.g. `position: fixed` placed from the Tools button's rect when it
opens, or the menu moved out of `.slate-rail__inner` - and add a browser check that a menu item
is the element under its own centre. The committed tests only checked the menu's rect.
`slate-recipe-drag.js`: allow `pen` immediately; `touch` starts after a 300 ms hold on the
badge (a `setTimeout` — `slate-recipe-drag.js` must then join `TIMEOUTS` in
`slate-isolation.test.js:38`) with `THRESHOLD_TOUCH = 10`; cancel on `pointercancel`; handle
CSS `touch-action: none; user-select: none; -webkit-touch-callout: none` (safe globally — no
effect with a mouse); `contextmenu` prevented during a drag. Tests: `slate-recipe-drag.test.js`
touch cases with fake timers. Alternative if declined: a "Move to…" item on a row menu.

**Step 10 — Hover un-sticking (optional polish).**
Wrap cosmetic `:hover` rules (≈40 across 15 sheets) in `@media (hover: hover)` and let the
isolation test allow exactly that condition. Or skip; nothing functional depends on it.

Cache tags: every step that changes a Slate module bumps `slate-host.js` VERSION and its
index.html `?v=`; steps 2 and 8 also bump `slate-display.js`'s tag (memory: "Script cache
tags").

---

## 6. Open questions

Blocking for the layout choice (answer before Step 5):

1. **Landscape density.** Under touch the recipe uses the two-line hopper row in Left
   orientation too (it is what makes 1100–1224px centres fit and gives 47px rows). On a 13"
   tablet at 1480×924 the single-line desktop row would fit; do you want a third width tier
   (single-line rows again above ~1225px) or one touch row format everywhere? Recommendation:
   one format.
2. **Portrait aside: drawer (recommended), stacked below the recipe, or Option C's bottom bar
   with the Timeline as a centre section?**

Non-blocking (answer any time before Step 8):

3. **Unfolded Z Fold.** Under the thresholds in §3.2 (short side ≥ 600, long ≥ 960) the
   unfolded Fold is a tablet-class screen and gets Slate in the app; folded it keeps the floor
   UI. Wanted, or should the Fold stay on the floor UI (raise `TABLET_MIN_SHORT` to ~720)?
4. **App scope.** Tablets in the Capacitor app get Slate (Steps 1, 7, 8), or browser tablets
   first and the app in a later phase?
5. **A way back into Slate from the legacy UI inside the app.** The persisted "This device
   opens" choice covers Legacy→stays legacy, but a legacy user in the app has no URL bar to
   type `?view=slate`. Add a "Slate" link in the legacy shell (index.html, not app.js), or
   accept that the choice is made in Slate's Settings only?
6. **Touch drag** (Step 9): hold-to-drag on the badge, a "Move to…" row action, or leave
   rearrangement to Bulk edit and the layer menu on tablets?
7. **Rail flyout policy.** The Tools menu stays open in the sidebar by your 2026-09-22
   decision; the icon-rail flyout closes on an outside tap. Fine?
8. **Print in the app.** `window.print()` is a no-op in the WebView; hide Print under
   Capacitor, or wire a print plugin later?
9. **Station.** Package `station/` into `www/` in Step 1 as well (same mechanism), or leave
   Station browser-only?
10. **Timeline geometry**: keep the 28px member rows under touch with extended hit areas
    (recommended, no JS constant changes), or grow rows and move the mirrored constants into
    CSS custom properties read at render?

---

## Appendix A — Verification recipe

Playwright is not a project dependency (memory "Playwright outside repo"). Serve the worktree:
`node tools/serve.js --port 8797` (already running during this pass). Drive playwright-core
from the MCP install with a scratch script, the way `tools/station-browser/spec.js` reads
`PLAYWRIGHT_MODULE`:

```js
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "/home/jdk/.npm/_npx/9833c18b2d85bc59/node_modules/playwright-core");
const browser = await chromium.launch({ headless: true });
for (const vp of [[1280,800],[800,1280],[960,600],[1200,1920],[1480,924],[1440,900]]) {
  const touch = vp[0] !== 1440;
  const ctx = await browser.newContext({ viewport: { width: vp[0], height: vp[1] }, hasTouch: touch, isMobile: false });
  const page = await ctx.newPage();
  // Force the tier without Settings: seed the display record before load.
  await page.addInitScript(t => localStorage.setItem("polyn.slate.display.v1", JSON.stringify({ input: t ? "touch" : "pointer" })), touch);
  await page.goto("http://127.0.0.1:8797/index.html?view=slate", { waitUntil: "networkidle" });
  // 1. attributes; 2. no horizontal scroll under touch; 3. every visible control ≥ 44 in one axis
  //    and ≥ 36 in the other (report the rest); 4. screenshots to a NEW filename each run.
  await page.screenshot({ path: `shots/${vp.join("x")}.png` });
  await ctx.close();
}
```
Use `element.tap()` (not `click`) for touch runs. Measure with the snippet from this pass
(Appendix B was produced by it): `getBoundingClientRect()` over
`button, a[href], input, [role=button], [role=tab], [role=option], [role=menuitem]` inside
`.slate-root`, grouped by class. For the desktop-unchanged guarantee, snapshot
`getComputedStyle` of every element at 1440×900 pointer before and after a step and diff
(the `tools/css-parity/` probe already does this for the legacy sheets; copy its approach).
For the app: `node scripts/build-www.js && npx cap sync && ./gradlew assemblePlayDebug`, then
`kdeconnect-cli --share` to the device (memory "Android build + Fold transfer").

Gotchas from this pass: `button:has-text('Top')` matched a hidden element and hung a click —
select Settings radios by `data-layer-orientation`/`data-*-mode` attributes; the harness
(`slate/slate.html`) is demo data and read-only, so editor states must be measured on the
hosted view; the Read tool caches images by path, so screenshot to a new filename each run;
`navigator.vibrate` warnings in the console are the legacy app's and harmless.

## Appendix B — Measured control sizes (hosted `?view=slate`, 1280×800, touch emulation)

| control | class | measured w×h | n |
|---|---|---|---|
| Layer ⋯ | `.slate-layer-menu__button` | 26×12 | 3 |
| Legacy link | `.slate-header__legacy` | 39×18 | 1 |
| Timeline pump pill | `.slate-timeline__pump` | 44–70×18 | 5 |
| Hopper resin cell | `.slate-hopper__resin` | 188×21 | 18 |
| Hopper blend cell | `.slate-hopper__pct` | 72×21 | 18 |
| 6H / 12H | `.slate-timeline__range` | 30–36×21 | 2 |
| Pressure unit chip | `.slate-pressure__unit` | 36×24 | 1 |
| Current / Next tabs | `.slate-tabs__tab` | 49–64×26 | 2 |
| Layer menu items | `.slate-layer-menu__item` | 178×26 | 3 |
| Print items | `.slate-print__item` | 138×26 | 3 |
| Calculator | `.slate-card__calc` | 28×28 | 2 |
| Panel / popover close | `.slate-panel__close` | 28×28 | — |
| Compare / Bulk edit / Print | `.slate-switch`, `.slate-print__trigger` | 72–75×28, 51×28 | 3 |
| Plan actions (Cancel, Copy current→Next, book/sync buttons, Clear) | `.slate-recipe__plan-action`, `.slate-book__action`, `.slate-sync__button`, `.slate-winding__clear` | 55–138×28 | many |
| Combobox option | `.slate-combobox__option` | 258×29 | 8 |
| Layer share | `.slate-layer__share` | 132×30 | 3 |
| Inline / draft / weight / combobox inputs | `.slate-hopper__draft-*`, `.slate-weights__field`, `.slate-combobox__input` | 72–188×31 | many |
| Sync inputs, Join, winding/pressure inputs | `.slate-sync__input*`, `.slate-winding__input`, `.slate-pressure__input` | 48–212×32 | — |
| Settings admin disclosure | `.slate-settings__admin-toggle` | 858×34 | 1 |
| Rail items, Tools, Tools menu items | `.slate-rail__item` | 205–207×36 | 9 |
| Sync trigger | `.slate-sync__trigger` | 144×36 | 1 |
| Promote buttons (Apply, Set, Next, Save as recipe…, Reset tracking) | `--promote`, `.slate-recipe__reset` | 52–117×36 | — |
| Time tiles | `.slate-time__tile` | 54–56×39 | 26 |
| Card editor / wizard / minute inputs | `.slate-card__input`, `.slate-wizard__input`, `.slate-time__minute` | 56–329×40 | — |
| Settings mode buttons | `.slate-settings__mode` | 206×89–161 | 12 |
| Stat-card triggers | `.slate-card__trigger` | 201×111 | 4 |
| Theme tiles | `.slate-theme-tile` | 203×165 | 14 |

Popover rects at 1280×800: layer menu 180×88 (absolute; clipped in Left layout), sync panel
380×314 at x 860–1240 (right-anchored), changeover wizard 400×182 at x 83–483 (left-anchored
to its card), time picker ≈400×270. Top layout: three 278px layer cards at x 257/547/837.
`document.scrollWidth` = 1440 at every viewport below 1440.
