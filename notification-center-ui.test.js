const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const app = fs.readFileSync("app.js", "utf8");
const html = fs.readFileSync("index.html", "utf8");
const desktop = fs.readFileSync("desktop.css", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");

/* ----------------------------------------------------------------------
 *   Bell placement and treatment
 * -------------------------------------------------------------------- */

test("the bell is a real button in the desktop status-bar utility cluster", () => {
  const clusterStart = html.indexOf('<div id="desktopUtilityCluster"');
  const clusterEnd = html.indexOf("</div>", html.indexOf('id="desktopDisplayToggle"'));
  const cluster = html.slice(clusterStart, clusterEnd);
  assert.ok(clusterStart > -1, "the desktop utility cluster must exist");
  assert.match(cluster, /<button id="desktopNotificationsToggle"[^>]*type="button"/);
  assert.match(cluster, /aria-controls="footerNotificationsMenu"/);
  assert.match(cluster, /aria-haspopup="dialog"/);
  assert.match(cluster, /aria-expanded="false"/);
});

test("the empty bell has a neutral label, neutral severity and a hidden badge", () => {
  assert.match(html, /id="desktopNotificationsToggle"[^>]*data-severity="none"/);
  assert.match(html, /id="desktopNotificationsToggle"[^>]*aria-label="Notifications, no items"/);
  assert.match(html, /id="desktopNotificationsBadge"[^>]*aria-hidden="true" hidden/);
});

test("the bell matches the borderless Display and Account icon treatment", () => {
  const block = desktop.slice(desktop.indexOf(".desktopNotificationsToggle{"));
  const rule = block.slice(0, block.indexOf("}"));
  assert.match(rule, /border:1px solid transparent/);
  assert.match(rule, /background:transparent/);
  assert.match(rule, /box-shadow:none/);
  // Same 38px square as #appFooterAccount / .desktopDisplayToggle.
  assert.match(rule, /width:38px/);
  assert.match(rule, /height:38px/);
});

test("badge severity is expressed by shape as well as color", () => {
  assert.match(desktop, /\.desktopNotificationsBadge\{[^}]*border-radius:5px/);
  assert.match(desktop, /\.desktopNotificationsBadge\[data-severity="error"\]\{[^}]*border-radius:50%/);
  assert.match(desktop, /\.desktopNotificationsBadge\[data-severity="error"\]\{[^}]*background:var\(--bad\)/);
  assert.match(desktop, /\.desktopNotificationsBadge\{[^}]*background:var\(--warn\)/);
});

test("emphasis is a short one-shot, never a continuous pulse, and respects reduced motion", () => {
  assert.match(desktop, /animation:desktopNotificationsEmphasis \.42s ease-out 2/);
  assert.doesNotMatch(desktop, /desktopNotificationsEmphasis[^;]*infinite/);
  assert.match(desktop, /@media \(prefers-reduced-motion:reduce\)\{[\s\S]*?data-attention-new="true"\] \.desktopNotificationsBadge\{animation:none\}/);
});

/* ----------------------------------------------------------------------
 *   Popover semantics and dismissal
 * -------------------------------------------------------------------- */

test("the popover is a dialog living permanently outside the inert workspace", () => {
  const overlay = html.slice(html.indexOf('<div id="appOverlayRoot"'), html.indexOf("</body>"));
  assert.match(overlay, /<dialog id="footerNotificationsMenu"/);
  assert.match(overlay, /aria-labelledby="desktopNotificationsTitle"/);
  assert.match(overlay, /tabindex="-1"/);
  assert.match(overlay, /id="desktopNotificationsList"[^>]*role="list"/);
  // No X button - dismissal is outside-click, Escape, or another menu.
  assert.doesNotMatch(overlay.slice(0, overlay.indexOf("</dialog>")), /aria-label="Close/i);
});

test("the bell joins the one mutually exclusive status-bar menu registry", () => {
  assert.match(app, /notifications: \[\$\("desktopNotificationsToggle"\), \$\("footerNotificationsMenu"\)\]/);
  assert.match(app, /setFooterSheetOpen\("notifications", true, event\.currentTarget\)/);
  // setFooterSheetOpen closes every other pair first, so opening Display or
  // Account closes the bell and vice versa.
  assert.match(app, /closeFooterSheets\(\{ returnFocus:false \}\);\s*\n\s*activeFooterSheetName = name;/);
});

test("the popover is nonmodal: no backdrop, no inert workspace, no overlay left behind", () => {
  assert.match(app, /function isDesktopNotificationsPopover\(name = activeFooterSheetName\)\{\s*\n\s*return name === "notifications"/);
  assert.match(app, /const nonmodalPopover = isDesktopAccountPopover\(name\) \|\| isDesktopNotificationsPopover\(name\);/);
  assert.match(app, /backdrop\.hidden = nonmodalPopover/);
  assert.match(app, /main\.inert = !nonmodalPopover/);
  // closeFooterSheets clears presentation state and anchoring for every pair.
  assert.match(app, /if \(sheet\?\.dataset\.presentation === "popover"\)\{[\s\S]*?delete sheet\.dataset\.presentation/);
  assert.match(app, /if \(main\) main\.inert = false;/);
});

test("the popover is anchored to its trigger and kept inside the viewport", () => {
  assert.match(app, /function desktopPopoverWidth\(sheet\)\{\s*\n\s*return sheet\?\.id === "footerNotificationsMenu" \? 380 : 290;/);
  assert.match(app, /Math\.max\(viewportMargin, Math\.min\(triggerRect\.right - width, window\.innerWidth - width - viewportMargin\)\)/);
  assert.match(app, /const top = below \+ height <= window\.innerHeight - viewportMargin/);
  assert.match(app, /if \(isDesktopPopover\(\)\) positionDesktopPopover\(\);/);
  assert.match(desktop, /\.desktopNotificationsMenu\{[\s\S]*?max-height:min\(430px,calc\(100dvh - 86px\)\)/);
  assert.match(desktop, /\.desktopNotificationsMenu:not\(\[open\]\)\{display:none!important\}/);
});

test("outside click dismisses without stealing focus; Escape dismisses and restores it", () => {
  const pointer = app.slice(app.indexOf('document.addEventListener("pointerdown",event=>{\n      if (!isDesktopPopover())'));
  assert.match(pointer.slice(0, 700), /closeFooterSheets\(\{ returnFocus:false \}\)/);
  assert.match(app, /if \(event\.key === "Escape"\)\{\s*\n\s*event\.preventDefault\(\);\s*\n\s*closeFooterSheets\(\);/);
  // closeFooterSheets' default returnFocus path targets the trigger.
  assert.match(app, /if \(returnFocus && focusTarget\) requestAnimationFrame\(\(\)=>focusTarget\.focus\(\)\)/);
});

test("keyboard focus enters the popover and every control is focus-visible", () => {
  assert.match(app, /const first = footerSheetFocusable\(sheet\)\[0\];\s*\n\s*\(first \|\| sheet\)\?\.focus\(\);/);
  assert.match(desktop, /\.desktopNotificationsMenu:focus-visible\{outline:2px solid var\(--focus-border\)/);
  assert.match(desktop, /\.desktopNotificationAction:focus-visible\{outline:2px solid var\(--focus-border\)/);
  assert.match(desktop, /\.desktopNotificationsToggle:focus-visible\{outline:2px solid var\(--focus-border\)/);
});

/* ----------------------------------------------------------------------
 *   Derived state, not a second source of truth
 * -------------------------------------------------------------------- */

test("the bell renders only what PolynAttentionCenter derives", () => {
  assert.match(app, /const summary = attention\.derive\(facts\);/);
  assert.match(app, /const attention = window\.PolynAttentionCenter;/);
  assert.match(html, /<script src="attention-center\.js\?v=[\d.]+" defer><\/script>/);
  // Derivation runs before app.js so window.PolynAttentionCenter is present.
  assert.ok(
    html.indexOf('src="attention-center.js') < html.indexOf('src="app.js'),
    "attention-center.js must load before app.js"
  );
});

test("facts are written by the code that already computes them, not recomputed", () => {
  assert.match(app, /attentionFacts\.setup\.lineRateSet = state\.lineRate > 0;/);
  assert.match(app, /attentionFacts\.recipe\.layerTotalValid = layerTotalValid;/);
  assert.match(app, /attentionFacts\.recipe\.invalidLayerNames = badLayers\.map\(L=>L\.name\);/);
  assert.match(app, /attentionFacts\.setup\.hopperWeightsUnset = allWeightsUnset;/);
  assert.match(app, /attentionFacts\.timeline\.trackedCount = tracked\.length;/);
  assert.match(app, /attentionFacts\.setup\.missingTrackedWeightCount = allWeightsUnset \? 0 : missingW;/);
  // No percentage/weight/sync rule is reimplemented inside the module. Its
  // comments name those rules on purpose, so only executable code is checked.
  const code = fs.readFileSync("attention-center.js", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "");
  assert.doesNotMatch(code, /0\.0001/);
  assert.doesNotMatch(code, /HOPPERS_PER_LAYER|recomputeAutoH1|effectiveHopperWeight/);
  assert.doesNotMatch(code, /layerPct|hoppers\[|state\./);
});

test("publishing happens on validation and on sync state changes, not on clock ticks", () => {
  assert.match(app, /updateCollapsedSummaries\(\);\s*\n\s*publishAttention\(\);/);
  const sync = app.slice(app.indexOf("renderPendingList(syncState.pendingSummary);"));
  assert.match(sync.slice(0, 900), /attentionFacts\.sync = \{[\s\S]*?\};\s*\n\s*publishAttention\(\);/);
  // refreshTimelinePresentation is the clock ticker; it must not republish.
  const ticker = app.slice(app.indexOf("function refreshTimelinePresentation()"));
  assert.doesNotMatch(ticker.slice(0, ticker.indexOf("\n    }\n")), /publishAttention/);
});

test("a repeated render never duplicates or re-announces an unchanged condition", () => {
  assert.match(app, /const introduced = knownIds !== null && ids\.some\(id=>!knownIds\.has\(id\)\);/);
  assert.match(app, /knownIds = new Set\(ids\);/);
  // knownIds starts null so the first render - conditions that already
  // existed when the operator arrived - never emphasizes.
  assert.match(app, /let knownIds = null;/);
  assert.match(app, /if \(announcer && key !== announcedKey\)\{/);
  assert.match(app, /announcer\.textContent = label;/);
  assert.match(html, /id="desktopNotificationsAnnouncer" class="visuallyHidden" role="status" aria-live="polite"/);
  // The list is rebuilt from the derived set every time, so a resolved
  // condition cannot survive as a stale row.
  assert.match(app, /list\.replaceChildren\(\);/);
});

test("closing the popover cannot dismiss an unresolved condition", () => {
  // There is no dismiss/acknowledge/snooze path at all - state is derived.
  assert.doesNotMatch(app, /dismissNotification|acknowledgeNotification|snoozeNotification|dismissedAttention/);
  assert.doesNotMatch(fs.readFileSync("attention-center.js", "utf8"), /dismiss|acknowledge|snooze/i);
});

test("transient storage failures get a real lifecycle instead of living forever", () => {
  assert.match(app, /function recordAttentionStorageError\(message\)\{/);
  assert.match(app, /\.filter\(item=>item\.message !== detail\)/);
  assert.match(app, /\.concat\(\{ message: detail, at: Date\.now\(\) \}\)/);
  assert.match(app, /function showStorageWarning\(message\)\{\s*\n\s*recordAttentionStorageError\(message\);/);
});

/* ----------------------------------------------------------------------
 *   Actions navigate to the responsible control
 * -------------------------------------------------------------------- */

test("each action opens the right section and reveals the responsible control", () => {
  assert.match(app, /"review-setup": \(\)=>\{\s*\n\s*setWorkspacePanel\("lineSetupBlock", \{ reveal:true \}\);\s*\n\s*focusSoon\(\(\)=>\$\("lineRate"\)\);/);
  assert.match(app, /"open-weights": \(\)=>\{\s*\n\s*setWorkspacePanel\("lineSetupBlock", \{ reveal:true \}\);\s*\n\s*focusSoon\(\(\)=>responsibleControl\("weightsArea", '\[data-weight-view="edit"\]'\)\);/);
  assert.match(app, /"open-recipe": \(\)=>\{\s*\n\s*setWorkspacePanel\("splitsBlock", \{ reveal:true \}\);\s*\n\s*focusSoon\(\(\)=>responsibleControl\("splitsArea", 'input\[id\^="lp_"\], input\.splitInput'\)\);/);
  assert.match(app, /"retry-sync": \(\)=>\{\s*\n\s*setWorkspacePanel\("lineSyncBlock", \{ reveal:true \}\);/);
});

test("focus targets are resolved after the panel is revealed, and skip unusable controls", () => {
  // Resolving eagerly would inspect the previous panel's DOM, and focusing a
  // zero-sized or hidden control silently drops focus to the document body.
  assert.match(app, /function focusSoon\(resolve\)\{\s*\n\s*requestAnimationFrame\(\(\)=>\{\s*\n\s*const element = typeof resolve === "function" \? resolve\(\) : resolve;\s*\n\s*if \(!usableControl\(element\)\) return;/);
  assert.match(app, /function usableControl\(element\)\{\s*\n\s*return !!element && !element\.disabled && element\.getClientRects\(\)\.length > 0;/);
  assert.match(app, /return find\('\[aria-invalid="true"\]'\)\s*\n\s*\|\| \(preferred \? find\(preferred\) : null\)\s*\n\s*\|\| find\("input:not\(\[type=checkbox\]\):not\(\[type=radio\]\), select"\)/);
});

test("the retry action reuses the existing Reconnect control, not a second retry path", () => {
  const retry = app.slice(app.indexOf('"retry-sync": ()=>{'));
  assert.match(retry.slice(0, 300), /const retry = \$\("lineSyncRetryBtn"\);\s*\n\s*if \(retry && !retry\.disabled\) retry\.click\(\);/);
  assert.doesNotMatch(retry.slice(0, 300), /lineSync\.(retry|refreshSelected)\(\)/);
});

test("the responsible field is located through the existing aria-invalid marker", () => {
  assert.match(app, /function responsibleControl\(hostId, preferred\)\{/);
  assert.match(app, /find\('\[aria-invalid="true"\]'\)/);
});

test("choosing an action closes the popover without bouncing focus back to the bell", () => {
  assert.match(app, /action\.addEventListener\("click",\(\)=>\{\s*\n\s*closeFooterSheets\(\{ returnFocus:false \}\);\s*\n\s*handler\(\);/);
});

/* ----------------------------------------------------------------------
 *   Global banner replaced; contextual validation retained
 * -------------------------------------------------------------------- */

test("the large global heads-up banner is not shown on desktop", () => {
  assert.match(desktop, /#lineSetupBlock #statusBox\{display:none\}/);
  // The old desktop grid slot for the banner is gone.
  assert.doesNotMatch(desktop, /#lineSetupBlock #statusBox\{grid-column/);
});

test("mobile keeps the same heads-up banner from the same unchanged code path", () => {
  assert.match(app, /function setStatus\(html\)\{\s*\n\s*const el = \$\("statusBox"\);/);
  assert.match(app, /setStatus\(statusMessage\(msgs\)\);/);
  assert.match(html, /<div id="statusBox"><\/div>/);
  // #statusBox is only hidden inside desktop.css's min-width:901px block.
  assert.doesNotMatch(styles, /#statusBox\{[^}]*display:none/);
  const desktopOnly = desktop.slice(desktop.indexOf("@media (min-width:901px){"));
  assert.ok(desktopOnly.includes("#lineSetupBlock #statusBox{display:none}"));
});

test("contextual validation surfaces are all retained", () => {
  // Invalid-field outlines and accessible error relationships.
  assert.match(app, /el\.setAttribute\("aria-invalid", String\(!result\.valid\)\)/);
  assert.match(app, /el\.setCustomValidity\(result\.valid \? "" : result\.message\)/);
  // Per-layer and per-column totals beside the fields. `tone` is "warn" on the
  // running recipe and a muted "planning" on the Next page, where an unfinished
  // total is expected rather than a fault.
  assert.match(app, /summary\.className = `splitsMatrixSummary \$\{layerOkay \? "ok" : tone\}`/);
  assert.match(app, /el\.className = `splitColumnTotal \$\{okay \? "ok" : tone\}`/);
  assert.match(app, /const tone = planning \? "planning" : "warn";/);
  // Section-level markers in the sidebar and section pills.
  assert.match(app, /navButton\?\.setAttribute\("data-status", navState\)/);
  assert.match(app, /splitsStatus\.classList\.toggle\("badge-warn", !ready\)/);
});

test("the RT Sync status control and its tap-to-refresh behavior are preserved", () => {
  assert.match(html, /id="cloudSyncFooterStatus"[^>]*aria-label="RT Sync status - tap to refresh/);
  assert.match(html, /<strong id="lineSyncTopStatus">/);
  assert.match(app, /\$\("cloudSyncFooterStatus"\)\?\.addEventListener\("click",\(\)=>runLineSyncAction/);
});

test("no desktop document scrolling is introduced", () => {
  assert.match(desktop, /body\{overflow:hidden;background:var\(--desktop-canvas-bg\)\}/);
  // The popover scrolls internally rather than growing the page.
  assert.match(desktop, /\.desktopNotificationsList\{[^}]*overflow:auto/);
  assert.match(desktop, /\.desktopNotificationsMenu\{[\s\S]*?overflow:hidden;/);
  assert.match(desktop, /position:fixed/);
});
