# Slate — phone tier: design pass

Written 2026-09-22 (Fable 5.1) for Opus 5.5 to implement step by step. Design only:
no code was changed for this document. It follows `slate/TABLET-PLAN.md` in shape and
builds on what that plan shipped (branch `slate/tablet`, PR #90, HEAD b252faf). Read the
tablet plan first: the touch tier, the tier attributes, the dismissal stack, the drawer
and the Scan menu are all assumed here.

**Brief (the user, 2026-09-22).** A phone-sized tier of Slate itself. The legacy phone UI
"worked great, but it was very dense" and **stays the default on phones until Slate is the
better experience**. Goal: match the legacy phone's functionality in Slate's style, borrowing
from Station-Mobile ("Ignition", abandoned) where it makes more sense — its hopper cells
"looked good in how they were animated".

**Target.** Android phones in the browser and in the Capacitor app, gloved operators, one
hand. Portrait first; landscape must not break. Reference viewports (CSS px): 360×800,
412×915 (Pixel-class), 374×900-ish (Z Fold cover screen), 915×412 landscape. Text scaling
up to ×1.3 (the user runs a large font). Desktop and tablet must not change by a pixel.

---

## Implementation log

**2026-09-22 (Opus 5.5), branch `slate/phone` off `slate/tablet` (b252faf), uncommitted.**
User answers: **B1** (no home page). Bar keys left at the plan's default
(Recipe · Timeline · Weights · Book · Menu). Steps 1–8 implemented; Step 9 not started.

- **Step 1 — phone word and shell.** `slate-tier.js`: `WIDTHS` gains `phone`,
  `PHONE_MAX_SHORT = 600`. **Departure from §4.2:** the phone is decided by the
  *screen's* shorter side (`screen.width/height`, rotation-stable) or a *window*
  narrower than 600 — not the viewport's shorter side, because a 960×600 tablet under
  its browser's bars has a ~540 px tall viewport and would have become a phone.
  `probe` returns `screenShort`; `observe` adds `(min-width: 600px)`. Host marks the
  provisional word with the same rule (`phoneViewport()`); a test pins
  `TABLET_MIN_SHORT === PHONE_MAX_SHORT`. `slate.js`: derived `data-layers="top"` under
  touch/phone (record untouched), `page()` beside `drawer()`, rail sheet
  (`setRail`, on the dismiss stack, shares the scrim), `paintBar`/`paintTitle` (the
  header names the page over the centre), Back = stack → non-Recipe section →
  Recipe → minimise. New `slate/slate-phone-bar.js` (+ test), `nav.slate-bar` mount in
  the shell (`MOUNTS` gains `bar`). Shell grid under phone: header / stats / page / bar,
  `height: 100dvh`; centre and aside share the `page` cell and scroll on their own.
  Stat strip: **2×2, label and value on one line** (four across could not hold
  "12,400 lb" at 360 px — a departure from the one-row strip). Header title ellipsises
  (`flex: 1 1 0`); the notice takes its own line. Recipe bar: subtitle hidden, tabs and
  switches narrower so the row fits 360. Settings hides Layout under phone
  (`.slate-settings__group--layout`).
- **Step 2 — sheets.** One geometry in `components/phone.css` (renamed from the
  plan's `phone-bar.css`; it holds the bar and the sheets): card editor, time picker,
  wizard/line-rate calc, layer ⋯, Scan menu, sync panel, and Pressure. Pressure stays up
  (a tool, not a popover), so it stands above the bar and is on the Back stack
  (`statsOffStack` in `slate.js`, phone only — a tablet's Back is unchanged, pinned in slate-display.test.js). The
  tile keeps its value while its editor is up (`{P} .slate-card__trigger` out-specifies
  the is-editing hide). The calc key on a tile is hidden on phones; the editor sheet and
  the picker gain a **Calculate** key (`slate-card__action--calc`, picker option
  `calculate` → `[data-time-calc]`; not `data-time`, which the picker's delegate would
  read as Set — caught in the browser).
- **Step 3 — keyboard and dock.** Host adds `interactive-widget=resizes-content` to the
  viewport meta on a phone (kept; the zoom reset restores it as found). Bulk edit's
  foot is `position: sticky` at the foot of the scrolling centre. **Not yet verified on
  a device** (WebView keyboard behaviour; `windowSoftInputMode` unchanged).
- **Step 4 — cell grid.** `recipe.css` phone block: one column per layer
  (`--slate-layers` written by the section), 44 px heads (letter + ⋯, share under),
  56 px cells (id + blend / two-line resin / weight), tracked / pump-off / overdue /
  picked / empty states. `slate-recipe.js`: `phone()`; a tap on a Current cell is its
  Track (only where the toggle is offered; Next tracks nothing; no inline editors except
  the layer share); Bulk edit picks the whole cell, drafts shown as values
  (`pointer-events: none`), phone hint text; layer name split into
  `.slate-layer__word` + letter. No face wrapper was needed (see Step 5).
- **Step 5 — motion.** **Departure from §3.4:** the *row itself* turns (`is-turned`,
  `rotateX(180deg)`, `transform-style: preserve-3d`, faces `backface-visibility:
  hidden`), with `.slate-hopper__other` laid over it as the back. The arrival animation
  is removed from each row on `animationend`, so its fill never holds the transform — the
  Station-Mobile clash cannot happen, and the bulk form (which inserts drafts beside the
  cells with `row.insertBefore`) is untouched. `is-quiet` steps unchanged cells back.
  `--slate-motion-flip` joins the off-switch. The rise replays on a tab turn under phone
  (`rise()`). Timeline page: "No weight" chips open Weights on a phone
  (`ctx.openWeights`); list-view rows without a weight do not (yet).
- **Step 6 — alarm.** Contract: `setTimelineAlarm { enabled }` in
  `PREFERENCE_COMMANDS`. app.js: `primeTimelineAlarm()` (the toggle's browser asks,
  moved beside `applyMobileTimelineAlarm`, shared by the toggle and the executor),
  executor `setTimelineAlarm` (apply, commit unsynced, then prime → native permission),
  `firePumpOffAlert` dispatches cancelable `polyn:pump-off-alert` and skips its banner
  when cancelled. Bridge: `alarm: { enabled }` (the no-leak test now names the two
  device switches that cross, on/off only). Slate: `slate-source` `alarmFrom` (+ in
  `valuesKey`), tracking seam `alarmAble`/`setAlarm` (not held by read-only: it is the
  device's, not the job's), Timeline switch (touch only), `[data-slate-alert]` banner in
  the shell with Dismiss (on the Back stack). Guard `mobile-timeline-alarm.test.js`
  rewritten to pin the two explicit callers of the permission asks.
- **Step 7 — other sections.** No overflow at 360/412 in Book, Weights, Resin Balance,
  Winding Tension, Pressure, Settings, RT Sync. Book/profiles one column. Admin sections
  not visited (they need a signed-in admin).
- **Step 8 — activation.** `slate-host.js`: `host: "slate"` → Slate everywhere, phones
  included; a bare phone load unchanged. Floor UI: "Slate (Beta)" link in Workspace &
  Support (`#workspaceNavSlate`, touch only), which loads `?view=slate`; Settings ›
  This device opens › Slate makes it stick. Three legacy nav pins updated
  (count 10→11, aria-controls, Notes rule kept separate).
- **Follow-up (user, same day): production and scrap move to Resin Balance on a phone.**
  The strip keeps Changeover and Line rate as one row. The Production and Scrap slots
  stay built but unseen (absolute under the strip, `visibility: hidden`); their editor
  sheet, refusal note and the Pressure sheet opt back in with `visibility: visible`.
  Resin Balance gains two rows (`.slate-balance__entry`, phone only) showing the cards'
  own words and opening the cards' own editors (`ctx.job.value/edit` from the boot), so
  the panel still dispatches nothing. Its empty state on a phone says "above".
- **Follow-up 2 (user): the same on tablets.** Every touch tier: the strip holds
  Changeover and Line rate (2 across); Production's slot is `display: none`; the Scrap
  slot stays built but unseen for a tool in its place (Pressure: a sheet on a phone,
  centred under the header on a tablet, as the calculators are). The Resin Balance rows
  now edit **in place** (field, Save, Cancel, refusal words) and send through the cards'
  new `enter(field, raw)` / `draft(field)` — the card editors are no longer opened from
  elsewhere (on a narrow tablet the drawer would have stood above them). The hidden-slot
  visibility rules for the card editor and note are gone.
- **Operator inspection follow-ups (2026-09-22, uncommitted after 474e709).** From a run
  of the preview APK in the Android emulator (real WebView driven over CDP): the two
  glances and the two friction points the user picked.
  - Recipe cells (phone): `.slate-hopper__next` says "→ LD317" on Current / "was LD165"
    on Next where the resin changes (the weight yields its line, `is-yielding`), and
    "→77%" where only the blend moves (the ▲n tag beside the blend was dropped after the device showed it crowding the id); changing cells wear an
    accent edge. No Compare needed.
  - Timeline (touch): rows say what goes into the hopper next (`→ MS1200`), and the pill
    reads "Pump off" (a mouse keeps "Off").
  - Changeover tile (phone): the countdown ("in 4h 59m") under the time.
  - A visit (host marks `data-slate-visit` when ?view=slate opens where the device, left
    on automatic, would open the floor UI): Slate offers "Open Slate every time on this
    device?" - Always sets the host choice, Not now closes.
  - Landscape phone: new root word `data-orientation` (tier; guard regex widened); the bar
    becomes a left column, the header and strip share one row, quiet notices hide and
    others ride as a toast.
  - Still open from the inspection: turned Compare card lacks the hopper id and shows a
    doubled border; empty trailing slots; bar over the keyboard; tile label truncation at
    font ×1.3 and the focus ring after Save; Menu repeats bar keys; Settings theme tiles one
    per row; "Connect this desktop" on a phone; no brand in the phone header; the floor
    UI's vibrate(0) console error at every launch.
- **Tight rows replace the cell grid on a phone (user, same night).** Device screenshots
  showed the cells could not say a resin change and a blend change together, Compare
  repeated what the cells said, and five layers crowded the ids. Now: layers stack, one
  36 px row per hopper - id, resin, `.slate-hopper__next` ("→MS0400"), blend,
  `.slate-hopper__pct-to` ("→59.5%"), weight - arrows from the sheet via `data-way`
  (← on Next). A hopper empty in both recipes is `is-vacant` and left out (user: "drop
  empty"); Bulk edit brings those back and hides the plan's marks beside the drafts. A
  hopper filled from or emptied to nothing says so by its resin alone. Compare is hidden
  on a phone; the phone card flip, its token and its test are gone.
- **Back to cells, the floor UI's way (user: "show less, use the legacy as a guide").**
  The rows tried to say too much. Now the phone grid mirrors the floor UI's phone grid:
  one shared grid (layer wrappers `display: contents`, each column from `--slate-layer-i`,
  `grid-auto-flow: column`) so positions line up across layers; a cell is `id  blend` over
  `resin` - no weight, no marks. Compare is back and adds one small band under a cell
  whose resin changes ("→ MS1200"; on Next "← MS0440"; "—" where the plan empties it).
  Blend-only changes are not shown (as on the floor UI). A position empty in every layer
  and both recipes is dropped (Bulk edit brings it back). The per-layer ⋯ menu is hidden
  on a phone (the floor UI's phone has none). Hopper 1's blend is not dimmed there.
- **Then (user):** no overdue outline on a phone's cells; Compare's band drops in as a
  split-flap wave (`slate-band-drop`, delay from `--slate-hopper-slot` + `--slate-layer-i`,
  `--slate-motion-band` in the off-switch); the phone Timeline's axis takes a min-height
  from its cards and late block (`phoneTier()` in `renderAxis`), the panel grows and the
  page scrolls - no card over another or over the changeover; its title and changeover
  line are hidden on a phone (the header and strip say them) and the alarm switch moved to
  the panel's foot.
- **Denser Weights on a phone (user).** One ~40 px line per hopper (id, resin, weight
  field, geometry field, computed weight), head bars instead of side heads, the Smart
  Hoppers explanation and "shared by every hopper" hidden; hoppers empty in both recipes
  are `is-vacant` and left out, with a "Show empty hoppers (n)" switch
  (`state.showEmpty`, never hiding a row being typed in).
- **Home (user: "a dashboard like legacy where the logo can be shown off").** New
  `slate/slate-home.js` + `components/home.css`: the turning mark large, the line's name,
  the changeover (with countdown) and output as big figures that open the cards' editors,
  and three numbered steps with live lines - hoppers changing resin, late/next on the
  Timeline, the job's pounds - that open their pages. It reads through `ctx.home` (boot
  hooks) and dispatches nothing. Phone only: the definition carries `phone: true`, the
  rail keeps it unlisted elsewhere (`setListed(HOME, page())`), a phone boots onto it,
  Back walks back to it, and the strip hides on it (`.slate-stats.is-home`, built and
  unseen so its editors still rise as sheets). Bar keys are now Home · Recipe · Timeline
  · Weights · Menu (the Book is in the Menu sheet). This answers the plan's B1/B2 question
  in B2's favour after all.
- **Desktop bug found and fixed on the way (a deliberate desktop change).** The rail's
  `.slate-root .slate-rail__item { display: flex }` out-specified base.css's `[hidden]`, so
  the administrator's three sections were drawn on every desktop rail with nobody signed in
  (their `hidden` attribute set, the item still shown). `rail.css` now hides
  `.slate-rail__item[hidden]`; pinned in slate-production-host.test.js.
- **Home carries the job (user).** On a phone the job's strip leaves every page (built
  and unseen, so Home's figures still open its editors as sheets); the header keeps the
  RT Sync trigger alone (no page title, no Legacy link - that moved to the foot of
  Settings, `.slate-settings__legacy`, phone only). Bar: Weights · Tools · **Home** ·
  Settings · Menu; Recipe, Timeline and Resin Balance are reached from Home and light
  Home; Tools raises `.slate-toolsheet` (the calculators); Menu still lists everything;
  the overdue dot moved to Home.
- **Timeline overlap, second cause (device screenshot, 15 late).** On a phone the late
  block now stands above the Now line (it is past) and the scale - ticks, cards,
  changeover - starts under it (`origin` in `renderAxis`; placeCards gets no pinned block
  there). The axis's min-height stretches the scale until the most crowded run of cards
  (any card to the last) fits before the changeover, capped at `MAX_PHONE_SPAN`.
- **Gates.** Full suite green but the known `privacy-policy` Capacitor test. Parity
  (computed styles, base b252faf served from a `git archive` on 8798) byte-identical at
  1440×900 pointer, 1280×800 / 800×1280 / 933×704 touch; the only differences are the new
  hidden elements and Settings' index shift. Browser checks at 412×915 / 360×800 /
  915×412: no sideways overflow; Bulk edit fill + apply; tap to track; Compare turn;
  alarm on/off persists; alert + Dismiss.
- **Deferred / not done:** Step 9 (drag between cells, Current|Next swipe, Heat Sheet);
  device verification of the keyboard; admin sections at phone width; the timeline's
  pump toggles keep the tablet's hit area (the axis geometry is placed from the marks).

---

## 0. Findings that correct the brief

**0.1 Station-Mobile exists only as an orphaned checkout.** `/home/jdk/johdavken.github.io/station-mobile/`
is a whole former worktree whose `.git` file points at `/home/fable/.../.git/worktrees/station-mobile`;
git commands fail there. Branch `station-mobile` (tip b074f7f) holds none of its files, and
nothing was ever committed. Its `station/station-clock.js` and the `demoRuntime` changes to
`station-source.js` / `station-demo-lines.js` never reached main or this worktree. So
"borrowing" means copying source text and ideas out of that directory, never a merge or a
cherry-pick. Copy what §3.4 names before the directory is lost; nothing else there is needed.

**0.2 What "the hopper cells" are.** Station-Mobile's per-hopper cell is the Recipe grid cell
`.sm-recipe__cell` (`station-mobile/station-mobile-recipe.js:463-495`; CSS
`station-mobile/styles/components/recipe.css:284-437`; motion
`station-mobile/styles/motion.css:273-307`). Its motion is three things: a staggered rise
when the grid shows (`sm-rise`, 22 ms per cell), a departure-board flip of differing cells
when Compare turns on (a 600 ms transform transition, 38 ms per cell), and a 3 px amber spine
that grows after the flip. The Timeline's "pellet vessels" are a second per-hopper element,
and they are **liquid** now: the user asked for the liquid fill on 2026-09-19 ("the pelletized
fill looks odd"); the pellet CSS survives only in a transcript.

**0.3 Station-Mobile has a probable motion bug worth designing around.** Its cascade holds
`opacity: 1` with `animation-fill-mode: both` on the *cell*, and the Compare recede sets
`opacity: .42` on the same cell, so the recede is beaten by the finished animation whenever
motion is on. Its flip survives only because it animates a *child* (`.sm-recipe__card`).
Slate's phone cell keeps that split: the cascade on one element, the flip on another (§3.4).

**0.4 Phones cannot reach Slate today, even by choice.** `slate-host.js:222-230`:
`if (choice === "slate") return tablet || (!native && wideWindow());` — a phone that chose
"This device opens: Slate" still gets the floor UI, and `slate-host.test.js:374-379` pins
"a phone was given Slate" as wrong. The tier has no phone word either: `slate/slate-tier.js:34`
`WIDTHS = ["wide", "narrow"]`, threshold `WIDE_MIN = 1100` only. Nothing in the app can set the
choice on a phone: `slate-display.js` is loaded by `index.html:79` before the host, but no
legacy control writes `host`.

**0.5 Slate at phone widths today (hosted `index.html?view=slate`, touch emulation, 412×915).**
Measured (Appendix B): the layout viewport is 502 px wide (90 px of sideways pan) because the
Recipe bar's tabs + Compare + Large + Scan do not wrap (`.slate-section__bar`, 133+83+80+61 px
of content in a 346 px centre); the Left layout's 168 px layer head (`tokens.css:49`,
`recipe.css:198`) leaves the two-line row's `minmax(0,1fr)` resin column **0 px** wide
(`recipe.css:748`); the drawer is 348 of 412 px; the stat cards run 2×2 at 113 px each
(226 px of job before the recipe); the calc key is 28×28. At 360 the header's sync trigger
overflows too. Landscape 915×412 has no overflow but 300 px of height for content. So the
narrow tier is not a phone tier; nothing short of a third viewport word fixes the recipe.

**0.6 The alarm banner is hidden under Slate; the alarm itself is not.** `app.js:2203-2214`
`firePumpOffAlert` appends `.pumpOffAlarmBanner` to `document.body`; `slate/styles/host.css:34`
hides every body child but the host and `:modal`. The vibration, the three beeps, the
service-worker notification and the native `PumpOffAlarm` schedule (`app.js:2299-2339`) run
from `state.mobileTimelineAlarm`, which is saved with the session (`app.js:1859,1887`) and
toggled only by the legacy Timeline's `#mobileTimelineAlarmToggle` (`app.js:11324-11347`).
Under Slate on a phone the alarm therefore keeps working if it was on, but cannot be turned
on or off, and its banner never shows. §2 row "Alarm".

**0.7 Legacy items that are not there to match.** The legacy phone status bar is hidden
outright (`styles-shell.css:106`), so its scan shortcut and timeline/recipe-only chips are not
phone features. Legacy local saved setups have functions but **no markup** (`app.js:2597-2760`,
`11874`; nothing in index.html) — unreachable on every device. Recipe Book Favorite is hidden
on phones (`styles-recipe-views-phone.css:1080-1084`) and Slate has no Favorite on any tier.
Print is desktop-only in legacy and already replaced by Scan under Slate's touch tier.

**0.8 Legacy phone tools that Slate lacks on every tier.** Short Footage, Hopper Weight, Hopper
Volume Weight, Resin Reference, Bulk Density Measurement, RT Notes, the Changelog, the beta
banner and the info guides (`index.html:1102-1109`, `1700`, `1449`, `472`). These are not
phone-tier work; they are "Slate lacks X" and are listed in §7 for the user to rank.

**0.9 One legacy phone behaviour Slate must not copy silently.** On a compact phone with more
than one layer, legacy makes the **first layer's share automatic** (`app.js:5497,5611-5615,8439`).
Desktop, tablet and Slate validate shares as entered. The phone tier keeps Slate's rule (§7).

---

## 1. Audit

Categories as in the tablet plan: **1** hover-only · **2** mouse-only · **3** target < 44 px ·
**4** fixed px · **5** precise pointing / drag · **6** keyboard-only path · **7** focus/blur
with an on-screen keyboard · **8** popover position · **9** other. Measured at 412×915 hosted
unless marked ≈.

### 1.0 Shell level (the blocker)

| file:line | cat | what | fix (see §3) |
|---|---|---|---|
| `slate/slate-tier.js:30-34,53` | 9 | Two viewport words; anything under 1100 is "narrow" and gets the tablet drawer. A 412 px phone is laid out as a small tablet. | Third word `phone` (§4.2). |
| `slate/styles/shell.css:92`, `panel.css:85-180`, `stat-cards.css:177`, `sync.css:342`, `modal.css:72` | 4 | Eleven `[data-viewport="narrow"]` rules. The drawer, its handle and its scrim (`panel.css:85-158`) are wrong for a phone (a 348 px drawer over a 412 px page). The stat cards 2×2, the sync panel fixed and the modal actions stacked are right and are wanted under `phone` too. | Phone rules stated explicitly; shared ones listed for both words (§5). |
| `slate/styles/components/rail.css` (touch: 64 px icon rail) | 4 | The rail takes 64 of 412 px for the whole height, leaving 346 for the centre; the Tools flyout is placed from the button's rect. | Rail becomes a **sheet** behind a Menu key; a 5-key bottom bar navigates (§3.3). |
| `slate/styles/components/header.css`, `slate-shell.js:86-92` | 4 | Header 64 px: title 64 + Legacy 55 + notice + sync trigger 144. At 360 the sync trigger crosses the edge (R404). | 48 px header; sync trigger icon+dot; notice under the header (§3.3). |
| `slate/styles/tokens.css:49`, `recipe.css:198` | 4 | Left layout's 168 px layer head beside the rows; at 266 px of recipe the rows' resin column is 0 px. | The boot derives `data-layers="top"` under phone; the phone recipe is a cell grid anyway (§3.4). |
| `slate/slate.js:174-177`, `218-260` | 9 | Drawer state (`setAside`, `followDrawer`, `paintHandle`) assumes the aside is a drawer when narrow. | Under phone the aside is a **page** (`is-open` = the Timeline tab); no drag, no handle, no scrim (§3.5). |
| `slate/slate-drawer-drag.js` | 5 | Pull/push on the handle. | `enabled()` false under phone; module untouched. |
| `slate/slate-dismiss.js`, `slate.js:557-560` | 9 | Back closes the top of the stack, then asks to minimise. There is no notion of "go to the home section". | Back: stack → Timeline page → non-Recipe section → Recipe → minimise (§3.6). |
| `slate-host.js:307-308` (provisional tier), `222-230` | 9 | Provisional `data-viewport` never says `phone`; the phone is excluded from Slate even by choice. | §4. |
| `index.html:5`, `slate-host.js` `settleZoom` | 7 | Viewport meta has no `interactive-widget`; Chrome Android keeps the layout viewport under the keyboard (`resizes-visual`). A form docked at the bottom sits under the keyboard unless lifted. The host already rewrites the meta for 300 ms after load. | Host sets `interactive-widget=resizes-content` while Slate is the view on a phone; verify in the WebView (§3.7, Step 3). |
| `android/app/src/main/AndroidManifest.xml` | 7 | No `windowSoftInputMode`. What the WebView does under the keyboard is unverified. | Device check in Step 3; `adjustResize` if needed (android-debugger). |

### 1.1 Recipe section

| file:line | cat | what | fix |
|---|---|---|---|
| `slate/slate-recipe.js:222-262` (bar: tabs, Compare, Large, Print/Scan) | 4 | ≈400 px of non-wrapping bar in 346 px (the 502 px layout). Large is a desktop reading aid. | Phone bar: Current \| Next tabs, Compare, Edit (pencil), Scan; Large withheld (§3.4). |
| `recipe.css:746-790` (two-line row) | 4 | 80 px per hopper; 18 hoppers = 1440 px of scroll for a 3-layer line; five layers ≈ 2400. The overview the operator needs (which hopper, where) is gone. | Cell grid: every hopper on one screen, layers as columns (§3.4). |
| `recipe.css:287-292` | 9 | Resin is `white-space: nowrap; text-overflow: ellipsis`. A 76 px cell shows 6 characters of "LL 1002.32". | Two-line clamp in the cell. |
| `slate-recipe.js:402` "Track", `.slate-toggle--tracking` 36 px min-height + padding | 3/4 | A labelled pill in a 76 px cell cannot fit. | View mode: tap the cell = Track (Current only), as legacy (`app.js:6015-6027`) and Station-Mobile do; the pill is hidden in the cell. |
| `slate-recipe.js:659-662` inline editors ("Change the resin", "Change the blend"), `slate-resin-search.js` touch mode | 7/8 | A per-cell popover editor in a 76 px cell, keyboard under it. | Phone edits go through **Bulk edit** only, docked at the foot (§3.4). Inline editors withheld under phone (the cells' `data-able` stays for a11y but the phone tap opens nothing). |
| `slate-recipe.js:94-104` Bulk edit form (Fill, Apply, Cancel), `slate-recipe-form.js` | 7 | Form sits in the section head; the on-screen keyboard covers the rows it edits. | Docked at the foot with a measured `--slate-dock` scroll margin (Station-Mobile's `recipe.css:529-538`, `recipe.js:1088-1092`). |
| `slate-recipe-drag.js` (hold-to-drag on the id badge, 300 ms) | 5 | Works in a grid too, but a 76 px cell's badge is ≈24 px. | Keep hold-to-drag on the whole cell in Edit mode (optional, Step 9); legacy's tap-source-then-destination is the alternative. |
| `slate-layer-menu.js`, `recipe.css` layer ⋯ (36×28 compact button with `::after`) | 3 | Sits in the layer head; at the top of a 76 px column. | Column head = letter + share + ⋯, 44 px tall (§3.4). |
| `slate-recipe.js:603-637` Compare (accent id text on a resin change; `__other` line) | 9 | The `__other` line is a second text line under the row: fine in a row, not in a cell. | Split-flap flip on differing cells (§3.4). |
| `slate-recipe.js` `SCAN_KINDS` (Job traveler, Dosing screen) | 9 | Legacy phone also scans a **Heat Sheet** (lots → Resin Totals). Slate's Resin Balance shows no lots. | §7. |
| `recipe.css:274-277` `slate-row-enter` (stagger by `--slate-row-i`) | 9 | The rise exists; it is on the cell element itself (the fill clash of 0.3 if the flip is added there). | Flip a child face; rise the cell (§3.4). |

### 1.2 Stat cards, calculators, time picker, header, sync, conflict

| file:line | cat | what | fix |
|---|---|---|---|
| `stat-cards.css:177-179` (2×2 under narrow) | 4 | 226 px of cards above every section. The value at 28 px needs ≈185 px per card. | A one-row **strip** of four tiles (label 11 px over value 18 px, ≈56 px tall); the editor opens as a bottom sheet (§3.3). |
| `slate-stat-cards.js:198-225`, `.slate-card__calc` 28×28 | 3/8 | Calc key too small; the editor popover is anchored to the card. | Calc key inside the sheet, 44 px; editor = fixed bottom sheet under phone. |
| `slate-time-picker.js`, `slate-wizard.js`, `slate-changeover.js`, `slate-line-rate.js` | 8 | Popovers anchored to the card; the wizard is already a modal under touch. | All fixed bottom sheets under phone (one rule family in `time-picker.css`, `wizard.css`). |
| `slate-sync.js:108-423`, `sync.css:342` | 4/8 | Panel fixed under narrow (good). Its Join/Lines/Devices/Rename/Leave rows are ≈380 px wide. | Full-width sheet from the bottom, 44 px rows; the QR/code display it has (`"CODE"`) stays. |
| `slate-conflict.js`, `modal.css:72` | 4 | Stacked actions under narrow (good). | Shared with phone. |
| `slate-shell.js:89` notice, `:91` read-only badge | 4 | Both in the 48 px header would not fit beside the sync trigger. | Notice becomes a line under the header; Read-only badge stays (icon + short word). |

### 1.3 Aside (Timeline, Resin Balance, Winding Tension), rail, Settings

| file:line | cat | what | fix |
|---|---|---|---|
| `slate-timeline.js` (axis + cards; LIST view via the Timeline preference) | 4 | Renders in 348 px today (1089 px tall). Cards' member rows carry name/resin/at + Pump off. | Full page under phone; member rows 44 px; the horizon switch (6H/12H) stays. Default view unchanged (the preference decides). |
| `slate-timeline.js` Now pulse, `--slate-overdue`, `slate.js:251` `paintHandle` (overdue dot) | 9 | The dot lives on the drawer handle, which the phone has not got. | The Timeline key on the bottom bar carries the dot (§3.3). |
| `slate-resin-balance.js`, `slate-winding-tension.js` (aside tools with `back: () => home("aside")`) | 9 | Their Back returns the aside to the Timeline. | Same, as a page: the bar's Timeline key shows the Timeline, Menu's Resin Balance / Winding Tension replace it in the same page. |
| `slate-rail.js` (Tools flyout, Settings foot, admin items after sign-in) | 4/8 | Ten items; flyout placed from a button's rect. | Rail styled as a bottom **sheet** under phone (its own element, no rebuild): opened by the bar's Menu key, on the dismiss stack; the flyout is inline (Tools listed flat). |
| `slate-settings.js:72-145` (Appearance gallery, Safety, Tracking, Layout, Input, This device opens, sign-in) | 4 | Theme tiles are a gallery; Layout (orientation, order) is meaningless on a phone. | Tiles 2-up; Layout group hidden under phone (`[hidden]` set by the settings module when the tier is phone, not by CSS — the pin "touch rules never set display on [hidden]" holds). |
| `slate-sections.js` (`is-entering` swap) | 9 | Section swaps animate `slate-section-enter`. | Unchanged; the page swap rides it. |

### 1.4 Recipe Book, Weights, Workspaces, Line Configuration, Resin Database

| file:line | cat | what | fix |
|---|---|---|---|
| `slate-recipe-book.js:177-198,432-463` (Save Current/Next, Refresh, rows: Load → Load into Current/Next, Update, ⋯ Rename/Duplicate/Delete) | 4/8 | Row actions in one line; Load's Current/Next choice is a popover. | Rows stack: name + line 2 actions; Load's choice is a bottom sheet; the save dialog is a sheet. Same as `recipe-book.css` container-style rules but under the phone word (no third container query: §5). |
| `slate-weights.js:225-274,422` (Circumference, Smart Hoppers, Revert, profiles) + `weights.css:365` container query (≤699) | 4 | The 699 px two-line rows already fit 346 px except the layer head (0.5). | Derived Top layout fixes the head; rows stay two-line (weights are typed, not tapped through). Profiles list stacks like the Book. |
| `slate-workspaces.js`, `slate-line-config.js`, `slate-resin-db.js`, `admin.css` (`[data-width="short"]` fields) | 4 | Two-column detail cards, tables. Legacy admin goes single-column at ≤760 (`styles-base.css:960,1036,1106`). | Single column under phone; tables become stacked rows. Admin on a phone is rare; a light pass (Step 7), with §7 asking whether it is wanted at all. |

### 1.5 Cross-cutting, ranked by leverage

1. **The third viewport word** (`phone`), computed from the viewport's shorter side, so a
   rotation does not swap the navigation model. Everything else hangs on it.
2. **Bottom sheets** for every popover Slate already has (card editors, time picker, wizard,
   Load-into, save dialogs, layer ⋯, Scan menu, sync panel): one rule family per sheet under
   the phone word, `position: fixed; inset: auto 0 0 0; padding-bottom: var(--slate-inset-bottom)`,
   on the dismiss stack (they already are), scrim shared.
3. **The cell grid** for the Recipe: the one piece of new DOM (a face wrapper) and the one
   piece borrowed from Station-Mobile.
4. **The bar + rail-as-sheet**: one new module, no change to the rail.
5. **Safe areas and the keyboard**: tokens exist; the meta `interactive-widget` and a device
   check are the unknowns.

---

## 2. Functionality map — legacy phone → Slate phone

"Have" = Slate has it on desktop/tablet today; the phone tier only needs to fit it.

| Legacy phone (agent inventory, `file:line`) | Slate today | Phone tier |
|---|---|---|
| Home: logo, line identity (`index.html:394`), production band (changeover with native time input + `showPicker()`, wizard key, output; `app.js:11197-11230`) | Have: stat cards + editors, time picker, wizard, line-rate calc, sync trigger names the line | Stat strip on every page; no home page (§3.3 B1). Line name in the header. |
| Home rows with live status ("Next: A3 in 12 min", `index.html:402-414`) | Handle dot (overdue) only | Bar badges: Timeline dot for overdue; Next tab dot for a plan. No status lines (B2 in §7 if wanted). |
| Production estimate line (`app.js:6840`) | Not in Slate | Out of scope (Slate desktop lacks it). |
| More: RT Sync, RT Notes, Tools, Beta, Changelog, Sudo (`index.html:421-500`) | Have: RT Sync (header), Tools (Pressure, Winding), Settings sign-in (admin) | Menu sheet = the rail. Notes/Beta/Changelog: 0.8. |
| Dock: Display, Back, Home, Forward, Alerts (`index.html:2420-2438`) | Settings; dismiss stack; no history; no alerts | Bar: Recipe · Timeline · Weights · Book · Menu. Back key per §3.6; no Forward; Alerts: §7. |
| Recipe tabs Current/Next/Weights/Recipe Book (`index.html:811-815`) | Have: Current\|Next tabs in Recipe; Weights and Book are sections | Bar keys; Current\|Next tabs stay in the Recipe bar. |
| Scan (Job Traveler / Dosing / Heat Sheet; default scan action) | Have: Job traveler, Dosing screen (touch) | Same two; Heat Sheet and default action: §7. |
| Load Next / Load Current with confirm (`index.html:2138,2153`) | Have: plan actions with "Confirm promote" | Confirm as a bottom sheet. |
| Compare (eye; "→ CODE" band on differing cells) | Have: Compare switch; accent id + `__other` line | Split-flap flip of differing cells (§3.4). |
| Summary: tap cell = Track (Current only); green tint (`app.js:6015-6027`) | Track pill per row | View mode: tap = Track on Current; tracked tint via `is-tracked`. |
| Edit (pencil): select cells/letters/rows; bar: Resin (autocomplete), %, Apply, Undo, Redo, Clear, Empty, Copy/Paste hoppers, Rearrange, Reset (`app.js:5093-5125`) | Have: Bulk edit (pick badges / Shift run / layer name; Fill; Apply = one `setHopperAssignments`), Reset tracking, layer ⋯ (copy/clear layer), hold-to-drag | Edit mode = Bulk edit docked at the foot; layer letter picks the column; ⋯ per column. Undo/Redo, Copy/Paste hoppers, Empty: only what Slate's form already has (§7 lists the gap). Rearrange: Step 9. |
| Cells static; H1 automatic; first layer automatic on phones (0.9) | H1 automatic (`recomputeAutoH1` semantics) | H1 as Slate; first-layer stays as entered (§7). |
| Recipe Book (phone): + / +›, search, Load/Update/Rename/Duplicate/Delete, no Favorite | Have all but search and Favorite | Same; no search (not in Slate). |
| Weights: Smart Hoppers switch, circumference, summary/edit matrix, bulk Weight/Height/Volume apply, profiles sheet, Fix from Timeline (`app.js:2785-3180`) | Have: fields per row, Smart Hoppers, Revert, profiles (Load/Update/Rename/Duplicate/Delete) | Rows two-line; no bulk weight apply (Slate lacks it on every tier). "Fix" = Timeline's needs-weight rows link to Weights (Slate lists them beneath the axis; a tap opens Weights: small addition, Step 5). |
| Timeline: Show all, Reset, display gear (next resin, source labels), rows with pump toggle, Needs weight + Fix, Hookups tab (`index.html:875-936`) | Have: axis/list, pinned late, pumped-off foot with Back on, Reset tracking (Recipe bar), Timeline preference | Page; Hookups: not in Slate (§7). |
| Alarm toggle + vibrate/sound rows; alarm banner (`app.js:11324-11347, 2199-2214`) | Nothing (0.6) | Step 6: preference command + snapshot field + alert event → Slate notice with Dismiss. |
| Changeover wizard, 6 steps, bottom sheet (`app.js:11060-11180`) | Have (`slate-wizard.js`, shares the wizard's LS keys) | Bottom sheet. |
| Resin Totals: production/scrap inputs, per-resin lb with lots, estimate row (`index.html:946-972`) | Have: Resin Balance (no lots), Production/Scrap cards | Page under Menu; lots: §7. |
| RT Sync (phone): status card, guide, current line select, device label, Refresh, Leave, join code, QR join via URL/App Link, conflict dialog | Have: status, Lines, Devices, Add device, Join, Rename, Leave, Refresh/Reconnect, CODE, conflict | Sheet; QR *join* arrives through the app (URL/App Link) regardless of view — verify it opens Slate's confirm, not the hidden legacy dialog (Step 7). |
| Tools: Short Footage, Winding Tension, Hopper Weight, Hopper Volume Weight, Resin Reference, Scan Recipe, Bulk Density | Have: Winding Tension, Pressure | Menu lists what Slate has. Rest: 0.8 / §7. |
| Display sheet: theme, 12/24 h, default scan action, layer headers, manual layer count | Have: theme gallery, tracking, safety, layout, input, host. No 12/24 h, no layer count (line-driven) | Settings page; 12/24 h: not in Slate (§7). |
| Admin via Sudo: Resin DB, Workspace Management, Line Configuration, Beta Applicants, DB Health | Have the first three | Single-column pass; Beta/Health: not in Slate. |
| Install hint (iOS), Privacy/Delete Data footer | Not in Slate | Footer links in Settings (Privacy, Delete Data) — small, Step 7. |
| Android Back (`app.js:8219-8245`): dialog → sheet → edit modes → rearrange → tool back → home → minimise | Stack → minimise | §3.6 mirrors the order. |
| Resume refresh (`appStateChange`, `app.js:11960`) | App-level; Slate re-renders from the bridge | Nothing to do. |
| Haptics on alarm only | None | Stays in app.js (Step 6 keeps Dismiss's `vibrate(0)` there). |

---

## 3. Layout decision

### 3.1 Facts the layout has to respect

- 412 px wide: 16 px gutters leave 380; five layer columns = 72 px each (four gaps of 4);
  three layers = 124; one layer = 380. 360 px: 62 / 108 / 328. Station-Mobile measured 65 px
  per column for five layers at 375 (`recipe.css:226-233`), and legacy uses 20 % columns.
- 915 px tall: header 48 + strip 56 + bar 56 + insets ≈ 40 leaves ≈ 715 for the page.
  A 3-layer, 6-hopper grid at 56 px cells + 44 px heads = 380 px: fits with the bar in view.
  Five layers × 6 = the same height (columns), so every line fits on one screen in portrait.
- Landscape 915×412: 48 + 56 + 56 + insets leaves ≈ 250; the grid scrolls. Acceptable.
- Text ×1.3: 56 px cells hold 12 px badge/pct and a two-line 12 px resin at ×1.3
  (15.6 px, 2×18 px lines + 16 px top line = 52 px). Cells are `min-height`, so they grow.
- The section registry mounts each section once (`slate-sections.js`): centre / aside / stats.
  Nothing is re-parented; the aside is *styled* as a page.
- Guards: selectors ≤ 2 steps (`slate-isolation.test.js:154-161`); no width `@media`;
  keyframes `slate-*` with reduced-motion; no script animation; every tier rule
  `^\.slate-root\[data-input="touch"\](\[data-viewport="narrow"\])? \.slate-` (`slate-tier.test.js:71`);
  exactly two container queries (`:78`).

### 3.2 Options

**Option A — stretch the narrow tier.** Keep `narrow`; add phone-only fixes under it: wrap
the recipe bar, force Top, shrink the drawer to 100 %, cards to a strip.

```
412×915                                      + drawer open
+------------------------------------+       +------------------------------------+
|64 rail | header  ........  sync    |       |64 |  header                        |
|  ○     | [chg][out][prod][scrap]   |       |   |  [chg][out] ...   ############ |
|  ○     | Recipe  Cur|Next  Cmp Scan|       |   |                   # Timeline # |
|  ○     | +---- Layer A  30% ⋯ ----+|       |   |                   # ........ # |
|  ○     | | A1  LL 1002    70%  wt ||       |   |                   # ........ # |
|  ○     | | A2  ...            ... ||       |   |                   # ........ # |
|  ⚙     | +-------------------------+|      |   |                 (]#          # |
+------------------------------------+       +------------------------------------+
```
Rows at 80 px, 18–30 of them; the rail still takes 64 px; the drawer covers 85 % of the
screen anyway. Least work, and it is the tablet layout squeezed — what the user called dense
in legacy, without legacy's one-screen overview. Rejected.

**Option B — a phone word: bar, pages, cell grid.** (Recommended.)

```
412×915 Recipe (View)                        Timeline page                 Edit mode
+----------------------------------+   +----------------------------------+   +----------------------------------+
| Slate · Line 3          ● RO  ⟳ |   | Slate · Line 3          ● RO  ⟳ |   | Slate · Line 3          ● RO  ⟳ |
| CHANGEOVER  OUTPUT  PROD   SCRAP |   | CHANGEOVER  OUTPUT  PROD   SCRAP |   | CHANGEOVER  OUTPUT  PROD   SCRAP |
|  14:30      1,240   12,400  310  |   |  14:30      1,240   12,400  310  |   |  14:30      1,240   12,400  310  |
| Recipe   [Current|Next]  ◐  ✎  ⌕ |   | Timeline            6H|12H  ≡   |   | Recipe   [Current|Next]  ◐  ✓  ⌕ |
| +------+ +------+ +------+       |   | Now ─────────────────────── 13:02|   | +------+ +------+ +------+       |
| | A 30%| | B 40%| | C 30%|  ⋯    |   |  ┃                              |   | | A 30%| | B 40%| | C 30%|       |
| +------+ +------+ +------+       |   |  ●─ 13:20  A3 LL 1002  [Pump off]|   | +------+ +------+ +------+       |
| |A1  70| |B1  55| |C1  70|       |   |  ┃         B2 HD 7500  [Pump off]|   | |A1  70| |B1  55| |C1  70|       |
| |LL1002| |HD7500| |LL1002|       |   |  ┃                              |   | |LL1002| |HD7500| |LL1002|       |
| |A2  30| |B2  25| |C2  30|       |   |  ●─ 14:05  A1 ...              |   | |A2 ✓30| |B2 ✓25| |C2  30|       |
| |LD 200| |LD 200| |LD 200|       |   |  ┃                              |   | |LD 200| |LD 200| |LD 200|       |
| |A3  — | |B3  20| |C3  — |       |   |  ┃                              |   | +-----------------------------+   |
| |      | |AB 1  | |      |       |   |  ▼ Changeover 14:30             |   | | Resin  [LL 1002.32     ] ⌕  |   |
| |A4  — | |B4  — | |C4  — |       |   |  Needs weight: C2 → Weights     |   | | Blend  [30 ] %   2 picked   |   |
| ...                              |   |  Pumped off: A5 (13:40) Back on  |   | |        [Cancel]  [ Apply ]  |   |
|[Recipe][Timeline•][Weights][Book][≡]|  |[Recipe][Timeline•][Weights][Book][≡]|  |[Recipe][Timeline ][Weights][Book][≡]|
+----------------------------------+   +----------------------------------+   +----------------------------------+
```
- Header 48 px: title + line name, Read-only mark, sync trigger (icon + dot). Notice as a
  line beneath when present.
- Stat **strip**: four tiles in one row on every page; a tap opens that card's editor as a
  bottom sheet (the calc key inside it, 44 px).
- **Bar**: Recipe · Timeline · Weights · Book · Menu (≡). 56 px + bottom inset. Timeline
  key carries the overdue dot; Recipe key a plan dot when Next differs. Menu opens the
  **rail as a sheet** (Resin Balance, Pressure, Winding Tension, admin sections when signed
  in, Settings, Legacy).
- **Recipe = cell grid**, layers as columns, a 44 px column head (letter, share, ⋯), 56 px
  cells: badge and blend on line one, resin clamped to two lines, weight on the last line
  (muted; smart tint as today). View mode: tap = Track on Current. Compare = flip. Edit
  (pencil) = Bulk edit docked at the foot.
- **Timeline = the aside as a page**; Resin Balance / Winding Tension take the same page.
- Every popover = bottom sheet.

**Option C — Station-Mobile's shell.** Ignition home (two readouts, three numbered steps
with status lines, the Workspace & support sheet at three snaps), pages flying from the
tapped row, spring settles.

```
+----------------------------------+
|  ◉ Slate                  LOCAL  |
|  CHANGEOVER   14:30   (odometer) |
|  OUTPUT        1,240  (odometer) |
|  1  Recipe        LL 1002 ×3 ... |
|  2  Timeline      Next A3 13:20  |
|  3  Resin Totals  ...            |
|  ~~~~~ Workspace & support ~~~~~ |
+----------------------------------+
```
Its motion runs on WAAPI `element.animate` through `station-transition.js` and on
`station-clock.js`, which Slate forbids and does not have; its home is a launcher, which
puts every task one tap further away than B's bar; and the user abandoned it. Rejected as a
shell. Its cells, vessels' `--level` idea, snap geometry and two-tap arming are borrowed.

### 3.3 Recommendation: Option B (B1: no home page), with these specifics

**Tier.** `data-viewport="phone"` when the viewport's **shorter side** is under
`PHONE_MAX_SHORT = 600` (`slate/slate-tier.js`; matches the host's tablet short side and
legacy's ≤600 Timeline rules). `tierFor` takes `height` beside `width`; `probe` reads
`(min-width: 600px)` and `(min-height: 600px)` (unknown → not phone, as today's NaN → wide);
`observe` listens to both. Landscape phones stay `phone`, so the bar never turns into a rail
on a rotation. Every phone rule: `.slate-root[data-input="touch"][data-viewport="phone"] .slate-x`.
A phone with a mouse (a desktop window dragged to 500 px) is `pointer/phone` and gets no
rule — the desktop sheet, as the pin requires.

**Derived layout.** Under `touch/phone` the boot writes `data-layers="top"` whatever the
stored preference is (`slate.js` `renderLayout()`; the preference is not overwritten —
`slate-display.test.js` pins the record). Settings hides its Layout group under phone. This
alone makes Weights, Book and the desktop-format recipe fit; the recipe then goes further.

**Shell (new: `slate/slate-phone-bar.js`, `slate/styles/components/phone-bar.css`).**
The bar is a small module in the rail's shape: `create(doc, { onSelect })` builds five
`button.slate-bar__key` with an icon (from `slate-rail.js`'s icon set: export it or share
`slate-logo.js`'s pattern), a label and a dot span; `setActive(id)` marks one; `setDot(id, on)`.
It dispatches nothing and reads nothing: the boot maps Recipe/Weights/Book to `show(id)`,
Timeline to `setAside(true)` (and `home("aside")` so a tool gives way to the Timeline),
Menu to `openRail()`. The boot mounts it in the shell after the aside
(`slate-shell.js` adds `nav.slate-bar[data-slate-mount="bar"]`, hidden except under phone).
Rail-as-sheet: under phone the rail element is `position: fixed; inset: auto 0 0 0;
max-height: 70vh; transform: translateY(100%)`, `.slate-rail.is-open` slides it up over the
scrim; the boot registers it on the dismiss stack like the drawer; a selection closes it.
The Tools flyout is listed flat (the rail's `flyout` option off under phone: the rail
already takes it as an option).

**Header 48 px.** `header.css` phone rules: title 16 px, the line name after it (from the
sync module's status: the trigger already knows the line), Legacy link hidden (it is in the
Menu sheet), Read-only as a 32 px badge, sync trigger icon-only with its dot. The notice
element moves under the header as its own row (`.slate-header__notice` becomes
`position: static; grid-column: 1 / -1`).

**Stat strip.** `stat-cards.css` phone rules: `.slate-cards { grid-template-columns: repeat(4, minmax(0,1fr)); }`,
`.slate-card__value` 18 px, `.slate-card__label` 11 px, `.slate-card__sub` hidden, tile
56 px min. The editor (`.slate-card__editor`), the time picker, the wizard, the calc: fixed
bottom sheets, `width: 100%`, `padding-bottom: calc(var(--slate-inset-bottom) + 56px)`
(clear of the bar), on the stack as today. The Pressure tool (stats pane swap) shows in the
Scrap tile's slot as it does now; it will be cramped; §7 asks whether to list it under Menu
only.

**Pages.** Under phone the centre is the page; the aside is `position: fixed;
top: calc(48px + 56px + inset-top); bottom: calc(56px + inset-bottom); left: 0; right: 0;
transform: none; clip-path: none; visibility: hidden` and `.slate-aside.is-open` shows it.
`setAside(true)` is the Timeline key; `setAside(false)` returns to the centre. The handle,
scrim-for-drawer and drag are off (`drawer()` in `slate.js` returns false under phone; the
handle's rules are narrow-only already). Rail active marking: `setActivePane("aside", …)`
already exists; the bar's Timeline key lights from the same call.

### 3.4 The Recipe: cell grid, borrowed from Station-Mobile

**Layout, CSS only, under the phone word.**
- `.slate-recipe__body[data-recipe]`: `display: grid; grid-template-columns: repeat(var(--slate-layers, 1), minmax(0, 1fr)); gap: 4px;`
  where the section already writes the layer count (or add `--slate-layers` on the body in
  `slate-recipe.js` beside `--slate-layer-i`).
- `.slate-layer`: a column (`display: flex; flex-direction: column; min-width: 0`), the Top
  layout's card chrome removed (no border, no padding).
- `.slate-layer__head`: 44 px, letter (`__name` shortened to the id — the module already has
  `layer.id`; show "A" not "Layer A" under phone via `data-short` text or a `::before` of
  `attr(data-layer)`), share button 44 px, ⋯ 44 px.
- `.slate-layer__rows`: `display: contents` or a column with `gap: 4px`.
- `.slate-hopper` (the cell): `min-height: 56px; display: grid; grid-template-columns: 1fr auto;
  grid-template-areas: "id pct" "resin resin" "weight weight"; padding: 4px 5px;
  border: var(--slate-stroke) solid var(--slate-border); border-radius: var(--slate-radius-sm);
  perspective: 600px;` — the areas map the existing children (`__id`, `__pct`, `__resin`,
  `__weight`); `__controls` (the Track pill), `__mark`, `__other`, `__note` are hidden in
  the cell (`__other` becomes the back face, below).
- `.slate-hopper__resin`: `white-space: normal; display: -webkit-box; -webkit-line-clamp: 2;
  -webkit-box-orient: vertical; font-size: 12px; line-height: 1.2`.
- `.slate-hopper.is-tracked`: the tint Slate already uses for a tracked row (`is-tracked`
  exists on rows), on the cell's border and background. `.is-empty`: dashed border, faint.
- Spare hoppers (past the line's hopper count, `hopper_counts`): Slate's `slotCount` vs
  `hopperCount` rule from Station applies if the section already marks them; otherwise
  every listed hopper is a cell.

**View mode: tap = Track.** `slate-recipe.js` already handles the Track toggle through
`slate-tracking.js`. Under phone, a tap on the cell (not on a control) on the Current page
toggles tracking; on Next it does nothing (Next cannot track — as legacy). The module reads
the tier from the root attribute (it already reads `data-input` for touch behaviours) or the
boot hands `ctx.tier()`; prefer the latter (one decider). The inline resin/blend editors do
not open from a cell tap under phone. Keyboard users keep the desktop path (the cells'
buttons are still focusable and Enter still edits): the phone rule is about the tap.

**Edit mode = Bulk edit, docked.** The pencil is the existing Bulk edit toggle
(`slate-recipe.js:94`). Under phone the form (`slate-recipe-form.js`'s element) is
`position: sticky; bottom: calc(56px + inset)` inside the scrolling centre (Station-Mobile's
dock, `recipe.css:529-538`), and on entering Edit the module measures its height into
`--slate-dock` on the recipe root; cells get `scroll-margin-bottom: var(--slate-dock)` and a
picked cell is `scrollIntoView({block: "nearest"})` (SM `recipe.js:866-871`: a tap does not
focus a button on every phone). Picking: a tap on a cell toggles its pick (the id badge is
the pick target today; under phone the whole cell is), the layer letter picks the column.
Fill / Apply / Cancel as today; Apply = one `setHopperAssignments` (unchanged seam). The
on-screen keyboard: the resin field uses `slate-resin-search.js`'s touch mode (`keepInView`
via `visualViewport`) — with `interactive-widget=resizes-content` (3.7) the sticky dock sits
above the keyboard by layout, and `keepInView` is a fallback.

**Compare: the split-flap flip.** DOM change in `slate-recipe.js` (all tiers): the cell's
front children are wrapped in `span.slate-hopper__face`, and `.slate-hopper__other` gains
the same inner shape (badge, pct, resin) so it can be the back face. On desktop and tablet
`.slate-hopper__face { display: contents; }` keeps the grid identical (the parity probe of
Appendix A proves it: the children stay grid items of `.slate-hopper`). Under phone:

```css
.slate-root[data-input="touch"][data-viewport="phone"] .slate-hopper__face {
  display: grid; grid-area: 1 / 1 / -1 / -1; grid-template-columns: 1fr auto;
  grid-template-areas: "id pct" "resin resin" "weight weight";
  backface-visibility: hidden; transition: transform var(--slate-motion-flip) var(--slate-motion-ease);
  transition-delay: calc(var(--slate-row-i, 0) * var(--slate-motion-lead));
}
.slate-root[data-input="touch"][data-viewport="phone"] .slate-hopper__other {
  display: grid; grid-area: 1 / 1 / -1 / -1; /* the same areas */
  transform: rotateX(180deg); backface-visibility: hidden;
  border-color: var(--slate-accent); background: color-mix(in srgb, var(--slate-accent) 14%, var(--slate-surface));
  transition: transform var(--slate-motion-flip) var(--slate-motion-ease);
  transition-delay: calc(var(--slate-row-i, 0) * var(--slate-motion-lead));
}
.slate-root[data-input="touch"][data-viewport="phone"] .slate-hopper__face.is-flipped { transform: rotateX(180deg); }
.slate-root[data-input="touch"][data-viewport="phone"] .slate-hopper__other.is-flipped { transform: rotateX(360deg); }
.slate-root[data-input="touch"][data-viewport="phone"] .slate-hopper__spine { /* 3px accent bar, scaleY 0→1, delayed */ }
```
State lives on the flipped elements themselves (`is-flipped` on face and other), never on an
ancestor, so every selector stays two steps. `slate-recipe.js` toggles `is-flipped` on the
two children of each differing cell when Compare is on (it already computes `differs` per
hopper: `:611,625`). Cells that do not differ recede: `opacity` on `.slate-hopper__face`
(a child, never the animated cell — finding 0.3). A new token `--slate-motion-flip: 600ms`
joins the off-switch block in `tokens.css:94-113`, and a `slate-cell-rise` keyframe (from
`sm-rise`: 16 px up, scale .97, opacity) in `recipe.css` with its reduced-motion block. The
rise plays on the **cell** (`.slate-hopper.slate-row-enter` already does this with
`--slate-row-i`; under phone the order runs down each column, which is the DOM order); the
flip plays on the **faces**. Replays (a face turn Current→Next) use the class-off/reflow/
class-on trick Slate already uses for `is-updated` (`slate-recipe.js:539-545`) — no timers.
Compare's meaning stays Slate's: the accent id and the flip say "resin changes"; whether
a blend-only change also flips is §7.

**Column heads.** `.slate-layer__share` (44 px) opens the share editor as a sheet under
phone; the ⋯ (`slate-layer-menu.js`) opens as a sheet from the bottom (the menu's outside-
close and stack entry are already the shared `slate-dismiss.js`).

**Scan** stays as the touch tier built it (`SCAN_KINDS`, `ctx.scan.start`); the menu is a
sheet under phone.

**What is copied from Station-Mobile, literally:** the `sm-rise` keyframe values, the
flip/spine/recede timings (600 / 350 / 400 ms, 38 ms per cell, +200 ms spine), the two-line
resin clamp, the 56 px cell, `perspective: 600px`, the docked editor's measured margin, and
`snapIndex` if the Current|Next pager becomes a swipe (§7). **Not copied:** any `--sm-*`
token, the sheet spring (WAAPI), `station-clock.js`, the demo executor, the pages module.

### 3.5 Timeline as a page

The aside's content is unchanged: the axis with Now, the changeover line, cards with member
rows and Pump off, the pinned-late block, needs-data beneath, the pumped-off foot with Back
on, the 6H|12H horizon; or the LIST view. Phone rules in `timeline.css`: member rows 44 px
with the Pump off key 44 px wide at the right; the horizon switch 44 px; card padding 8 px.
"Needs weight" rows gain a small "Weights" link (a `button` the boot maps to `show("weights")`
— the timeline module already takes `ctx`; the link is a new callback `ctx.openWeights`, no
dispatch). The bar's Timeline key shows the overdue dot from the same value `paintHandle()`
computes today (`slate.js:251`): move the computation into a `overdue()` the boot calls for
both the handle and the bar.

### 3.6 Navigation and the Back key

Order, mirroring legacy `app.js:8219-8245` and Slate's stack:
1. Top of the dismiss stack (sheet, menu, rail sheet, card editor) — `dismissTop()`.
2. Edit mode on (Bulk edit form) → leave it, keeping nothing (the draft is discarded, as
   legacy leaves Edit).
3. The Timeline page open → `setAside(false)` (it is on the stack already: `slate.js:221`).
4. Centre section ≠ Recipe → `show("recipe")`.
5. Recipe → `detail.minimize = true` (the existing path).
No history, no Forward. `polyn:android-back` is already dispatched first
(`android-back-button.js:37-50`); the boot's listener gains steps 2 and 4.

### 3.7 Keyboard, safe areas, one hand

- Safe areas: header `padding-top: var(--slate-inset-top)`, bar `padding-bottom: var(--slate-inset-bottom)`,
  sheets clear the bar. Tokens exist (`tokens.css:72-73`).
- Keyboard: `slate-host.js` sets the viewport meta to add `interactive-widget=resizes-content`
  when it boots Slate on a phone (it already rewrites the meta for `settleZoom`; on a
  `?view=legacy` navigation the document reloads with the original meta). Step 3 verifies
  the WebView on the Fold's cover screen and, if the WebView ignores it, the android-debugger
  reports whether `windowSoftInputMode="adjustResize"` is needed in the manifest.
- One hand: the bar and every sheet are bottom-anchored; the Recipe bar's keys are 44 px;
  the column heads are 44 px; cells 56 px.
- Scroll: the centre scrolls (`overflow-y: auto` under phone between the strip and the bar),
  `overscroll-behavior: contain`; the document does not.

---

## 4. Activation

### 4.1 Rule

Phones stay on the floor UI by default. **Nothing in this plan changes what a bare load
gets on a phone.** Slate on a phone is reached by:
- `?view=slate` in the browser (already: `requested()` wins);
- the device's choice "This device opens: Slate" (`slate-display.js` `host`), which the host
  must now honour on a phone — `slate-host.js:227` becomes `if (choice === "slate") return true;`
  (the comment "slate is Slate anywhere but a phone's screen" and `slate-host.test.js:374-379`
  flip with it);
- a way to *make* that choice from the floor UI, since the app has no URL bar: a
  "Slate (Beta)" row in the legacy home's Workspace & support group on touch
  (`index.html:421-500`, beside the desktop rail's Station link at `:504-517`), whose handler
  calls `PolynSlateDisplay`'s host setter with `"slate"` (`slate-display.js:209`
  `setHostChoice` on a controller; the legacy row may create one with `create(root)` or the
  host may expose a `chooseHost()` — Opus picks the smaller seam, in `slate-host.js`, never
  in `app.js` beyond the click) and navigates to `?view=slate`.
- The way back: Slate's Legacy link (in the Menu sheet) navigates to `?view=legacy` for one
  load; Settings › This device opens › Legacy makes it stick. Both exist.

### 4.2 Tier computation

`slate/slate-tier.js`: `WIDTHS = ["wide", "narrow", "phone"]`, `PHONE_MAX_SHORT = 600`,
`tierFor({coarse, native, width, height, preference})` returns `phone` when
`min(width, height) < 600` and both are finite; `probe` reads `(min-width: 600px)` and
`(min-height: 600px)`; `observe` adds the two queries. `slate-host.js`'s provisional mark
(before the sheets load) applies the same rule with the same constant; a source-level test
pins the two constants equal, as the 1100 pair is pinned today.

### 4.3 Capacitor app

Unchanged by default: `if (native) return tablet;`. With the stored choice, a phone in the
app gets Slate at every launch until Settings says otherwise. The preview APK recipe
(memory "Android build + Fold transfer") applies; the cover screen of the Z Fold (374×900-ish,
short side < 600) is the phone test device the user has.

---

## 5. Guard-test changes

| test | change |
|---|---|
| `slate-tier.test.js:71` regex | `(\[data-viewport="(narrow\|phone)"\])?`; `WIDTHS` pin gains `phone`; `tierFor` cases for the shorter side, NaN height, landscape; `observe` registers four queries. |
| `slate-tier.test.js:78` container queries | Unchanged: exactly two. The phone tier uses the attribute, not a third query. |
| `slate-host.test.js:122-129, 357-366` | Unchanged (bare load on a phone → nothing). |
| `slate-host.test.js:374-379` | Flip: `host: "slate"` on a phone → Slate, browser and native. Add: provisional `data-viewport="phone"` on a phone load. |
| `slate-host-isolation.test.js` / `slate-isolation.test.js:84,95` roster | `slate-phone-bar.js`, `phone-bar.css` in `STYLESHEETS`/`SCRIPTS`, the harness and the roster; `build-www` follows the host (no change). |
| `slate-isolation.test.js:277-291` dispatch/request allowlists | Unchanged: the bar dispatches nothing; alarm (Step 6) adds a preference command through the existing stat-cards or tracking seam — pick one, do not add a file. |
| `slate-isolation.test.js:316-321` timers/animation | Unchanged; the flip is CSS. |
| `slate-isolation.test.js:197` keyframes | `slate-cell-rise` (+ any `slate-sheet-rise`) with reduced-motion blocks; `--slate-motion-flip` in the off-switch (a test reads the token list). |
| `slate-display.test.js` | `data-layers` derived under `touch/phone` while the record keeps the stored orientation; Settings' Layout group hidden under phone. |
| `slate-shell.test.js` | The bar mount exists and is hidden outside phone; the handle pin unchanged. |
| `slate-recipe*.test.js` | The face wrapper: desktop DOM tests that read `.slate-hopper`'s children need `.slate-hopper__face`'s; cell-tap = Track on Current only under phone; Edit mode picks the cell; `is-flipped` toggles on the two faces of differing cells; nothing dispatches on a Next-page tap. |
| new `slate-phone-bar.test.js` | Five keys, `setActive`, `setDot`, `onSelect` ids, no dispatch, no timers. |
| `station-command-contract.test.js` / `app.js` pins (Step 6) | `setTimelineAlarm` in `PREFERENCE_COMMANDS` (`station-command-contract.js:169`); snapshot `alarm` field; `polyn:pump-off-alert` event. |
| `index.html` pins (`slate-host.test.js`, cache-tag tests) | The Slate (Beta) row; bump `slate-host.js` VERSION and `?v=` tags (memory "Script cache tags"). |

---

## 6. Implementation plan

Each step ships on its own behind `data-viewport="phone"` (desktop and tablet untouched
until Step 8's one-line host change, which changes nothing for a device that made no
choice), ends with `node --test *.test.js` under `ulimit -v` (memory "Fake-DOM assert OOM"),
`git diff --check`, a `regression-reviewer` pass, and the Appendix A probe: 1440×900 pointer
and 1280×800 / 800×1280 touch **byte-identical** to the previous step, then the four phone
viewports. Work on a branch `slate/phone` off `slate/tablet` (or main once PR #90 merges).
Do not commit unless asked. Bump cache tags every step.

**Step 1 — The phone word and the shell.** *(medium)*
`slate-tier.js` (§4.2), host provisional mark with the shared constant, `slate.js`
`renderLayout()` derives Top, `drawer()` false under phone, Back order (§3.6).
`slate-phone-bar.js` + `phone-bar.css`; `slate-shell.js` bar mount; rail-as-sheet rules
(`rail.css`) and `openRail()` on the stack; header 48 px (`header.css`); stat strip
(`stat-cards.css`); aside-as-page (`panel.css`); shared narrow rules restated for phone
(shell frame, sync panel, modal actions); safe areas. Settings hides Layout. After this the
phone shows the desktop-format recipe under Top at 396 px (two-line rows, 0.5 fixed by the
derived Top): usable, not final. Tests per §5 rows 1, 4–6, 10–11, 13.

**Step 2 — Bottom sheets.** *(small, wide)*
Card editors, time picker, wizard, line-rate calc, Load-into, save/rename/duplicate
dialogs, layer ⋯, Scan menu, share editor, sync panel: fixed bottom sheets under phone,
clear of the bar, `slate-sheet-rise` keyframe. No JS beyond what `placeFlyout`-style
positioning already skips under a fixed rule. Verify each opens above the bar and closes on
Back and on the scrim.

**Step 3 — Keyboard and the dock.** *(small, device-verified)*
Host meta `interactive-widget=resizes-content` under phone; Bulk edit form docked with the
measured `--slate-dock` and `scrollIntoView` on pick; resin search touch mode checked with
the dock. Preview APK on the Fold's cover screen: type in the resin field with the keyboard
up; if the WebView does not resize, `android-debugger` reports the manifest change.

**Step 4 — The cell grid.** *(the main step)*
`recipe.css` phone rules (§3.4 layout), `--slate-layers` on the body, column heads, cell
areas, two-line resin, tracked/empty states; `slate-recipe.js`: the face wrapper (all tiers,
`display: contents` outside phone — parity probe must be byte-identical), cell tap = Track on
Current under phone, Edit mode picks the cell, Large withheld. Tests: `slate-recipe.test.js`
additions (§5 row 12). Measure at 360/412/374 with 1, 3 and 5 layers, text ×1.0 and ×1.3
(Appendix A's font-scale caveat: emulate with `document.documentElement.style.fontSize` on
the harness only).

**Step 5 — Motion: rise and flip.** *(small)*
`slate-cell-rise`, `--slate-motion-flip`, the flip/spine/recede rules on the faces,
`is-flipped` toggling in `slate-recipe.js` on Compare, replay on a face turn. Reduced-motion
blocks. Timeline page rules (§3.5) and the bar's overdue/plan dots via a shared `overdue()`.
"Needs weight → Weights" link.

**Step 6 — The alarm.** *(touches app.js; separate review)*
`station-command-contract.js`: `setTimelineAlarm(on)` in `PREFERENCE_COMMANDS`; app.js's
executor maps it to `applyMobileTimelineAlarm(enabled)` (`app.js:2135`, the same function the
legacy toggle calls, so permission requests and native scheduling stay in app.js); the
state bridge publishes `alarm: { enabled, supported }` (the legacy toggle's availability rule);
`firePumpOffAlert` dispatches `polyn:pump-off-alert` (detail: hopper label, resin, dismiss
callback) on the document *before* appending its banner, and skips the banner when the event
was cancelled. Slate's Timeline page shows a notice with Dismiss (which calls the detail's
dismiss → `vibrate(0)` stays in app.js) and a switch "Alarm when pump-off is due" that
dispatches the preference command through the tracking seam (`slate-tracking.js`, the file
that already owns pump-off). Vibrate/sound rows: native-only, §7.

**Step 7 — The rest of the sections at phone width.** *(medium, mechanical)*
Recipe Book, Weights and profiles, Resin Balance, Winding Tension, Pressure (in the strip),
RT Sync sheet, Settings (2-up tiles, footer links Privacy / Delete Data), the three admin
sections single-column. QR-join arrival under Slate verified (`app.js:9306-9314, 9712` opens a
legacy `<dialog>`, which is `:modal` and shows; confirm it is usable or route it to Slate's
conflict-style sheet — §7).

**Step 8 — Activation.** *(one line + one row; LAST)*
`slate-host.js:227`; the legacy "Slate (Beta)" row on touch; tests §5 row 4; VERSION and
tags; preview APK; open the app on the Fold folded, choose Slate, relaunch, choose Legacy
back. Update `CLAUDE.md`'s Mobile section only if the user asks.

**Step 9 — Optional.** Hold-to-drag between cells in Edit mode (whole cell as the handle,
`slate-recipe-drag.js` `data-movable`), or legacy's tap-source/tap-destination; a swipe
between Current and Next (`snapIndex` from Station-Mobile, a script-written transform while
dragging like the drawer, CSS settle); Heat Sheet scan.

---

## 7. Open questions

Blocking before Step 1:
1. **B1 or B2?** B1 (recommended): no home page; the bar goes straight to Recipe, the stat
   strip is on every page. B2: a Job/home tab in the bar's first slot with the four cards
   large, the numbered section rows with live status lines (legacy's home), and the sync row.
   B2 costs a fourth pane-less section and status-line derivation; B1 is one tap closer to
   everything.
2. **Bar keys.** Recipe · Timeline · Weights · Book · Menu, or swap Book for Balance?

Answerable during the steps (defaults in brackets):
3. Compare flips on a resin change only, as Slate's compare means today, or on any change
   like Station-Mobile's ▲▼ tags [resin only].
4. Edit mode extras legacy has and Slate's bulk form lacks: Undo/Redo, Copy/Paste hoppers,
   Empty cells [not in this pass; they are Slate features, not phone ones].
5. First-layer share automatic on phones (legacy 0.9) [no: Slate validates as entered].
6. Pressure tool on a phone: in the Scrap tile's slot as on desktop, or under Menu as a page
   [Menu page; the strip tile is too small].
7. Heat Sheet scan and lots in Resin Balance [later; Slate lacks lots everywhere].
8. Alerts (attention centre) on the phone: none, or a bell in the header deriving Slate's own
   list from the snapshot [none in this pass; the overdue and plan dots cover the two that
   matter on the floor].
9. Native alarm sound / vibrate rows (Step 6) [preference commands later; the on/off switch
   first].
10. Admin sections on a phone: light single-column pass, or hidden under phone with a note
    "use a tablet or desktop" [light pass].
11. Legacy tools Slate lacks (0.8): which, if any, the user wants in Slate at all — that is
    Slate scope, not phone scope [ask].
12. Swipe between Current and Next (Step 9) [yes if cheap: the drawer's follow/settle
    pattern already exists].
13. 12/24-hour clock: Slate has no preference; the phone tier inherits whatever Slate does
    [unchanged].
14. Delete the orphaned `../station-mobile` directory after Step 5 has copied what §3.4
    names [the user decides; nothing else in the repo references it].

---

## Appendix A — Verification recipe

As the tablet plan's Appendix A (playwright-core at
`/home/jdk/.npm/_npx/9833c18b2d85bc59/node_modules/playwright-core`, `isMobile: true,
hasTouch: true`, server `node tools/serve.js --port 8797` from `../slate`), plus:
- Viewports: 412×915, 360×800, 374×900, 915×412; hosted `index.html?view=slate` and the
  harness `slate/slate.html?demo=<id>` with 1, 3 and 5 layers.
- The parity gate is the same computed-style diff at 1440×900 pointer AND at 1280×800 /
  800×1280 touch (the tablet tier must not move either).
- Overflow probe: `document.documentElement.scrollWidth === innerWidth` at every viewport,
  and the element list past the right edge (the `phone.js` pattern in the scratchpad:
  `.slate-root *` whose `right > clientWidth + 1`, excluding fixed sheets).
- Cell probe: every `.slate-hopper` ≥ 56 px tall and ≥ 60 px wide at 360 with five layers;
  `.slate-hopper__resin` two lines at most (`scrollHeight <= 2 * lineHeight + 1`).
- Back probe: dispatch `polyn:android-back` with a cancelable CustomEvent and assert the
  §3.6 order (sheet → Edit → Timeline → Recipe → `detail.minimize`).
- Real touch: CDP `Input.dispatchTouchEvent` for the cell tap (Track) and for a hold-to-drag.
- Text scale: headless Chromium ignores the font-scale flag; approximate with
  `document.documentElement.style.fontSize = "130%"` on the harness; the true check is the
  Fold's cover screen with the user's font size.

## Appendix B — Measured (2026-09-22, hosted `?view=slate`, touch emulation, HEAD b252faf)

| viewport | tier | layout width | centre | cards | hopper row | resin col | drawer | over the edge |
|---|---|---|---|---|---|---|---|---|
| 412×915 | touch/narrow | **502** | 346 | 149 ×4 (113 tall, 2×2) | 80 | **0** | 348 | `.slate-switch` R425, `.slate-scan` R502 |
| 360×800 | touch/narrow | **502** | 294 | 123 ×4 | 80 | 0 | 296 | + `.slate-header__sync` R404, `.slate-hopper__pct/__controls` R402 |
| 374×900 | touch/narrow | **503** | 308 | 130 ×4 | 80 | 0 | 310 | as 360 |
| 915×412 | touch/narrow | 915 | 849 | 401 ×4 | 80 | 427 | 360 | none |

Recipe at 412: section 266 px wide (layer head 168 + rows); bar children: tabs 133, Compare 83,
Large 80, Scan 61; hopper cell children: id 40×72, resin 0×36, pct 72×36, weight 0×21,
controls 72×36. Small targets: `.slate-card__calc` 28×28, `.slate-layer-menu__button` 36×28,
`.slate-timeline__range` 44×21. Timeline scroll height in the drawer: 1089.

Station-Mobile reference (from its source; not re-measured): cell 56 px, column
`minmax(0,1fr)` per layer with `grid-auto-flow: column`, ≈65 px per column at 375 with five
layers; badge 9.5 px/900, pct 16 px/800, resin 13 px two-line clamp; rise 460 ms ease-out,
22 ms stagger after 120 ms; flip 600 ms, 38 ms per cell; spine 350 ms, +200 ms; recede 400 ms
to opacity .42; vessel 52 px wide, glass 76 px, fill height 600 ms, waves 3.2 s / 4.6 s.

## Appendix C — Where Station-Mobile's pieces are (copy before the directory is lost)

`/home/jdk/johdavken.github.io/station-mobile/station-mobile/`:
- `styles/components/recipe.css:226-233` (grid), `:284-437` (cell, faces, spine, states);
  `styles/motion.css:13-16, 82-85, 273-327` (rise, stamp, flip, spine, recede, ripple/pop/shake),
  `:380-530` (reduced motion).
- `station-mobile-recipe.js:48-200` (pure: `diff`, `buildGrid`, `snapIndex`, `footText`),
  `:539-562` (`paintCell` states), `:681-776` (swipe pager), `:866-871`, `:1088-1092` (dock).
- `station-mobile-timeline.js:122-142` (`vesselModel`, `badgeFor`), `:388` (wave path),
  `:403-420` (vessel DOM); `styles/components/timeline.css:125-209`.
- `station-mobile-sheet.js:43-84` (`snapOffsets`, `chooseSnap`); `station-mobile-spring.js`
  (a `linear()` easing generator: usable once, offline, to mint a token; never at runtime).
- `mobile-motion-previews.html` (the eight concepts; #4 split-flap, #5 liquid).
