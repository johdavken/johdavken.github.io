# Resin.tools — Project Guide for Claude Code

## Project Overview

Resin.tools is a dependency-light web application used by blown film operators to plan resin hopper run-downs, manage recipe setup, store shared line configurations, and synchronize active job state across devices.

The app is designed for practical use on the production floor, primarily on desktop, with selected mobile workflows.

The project currently includes:

- Hopper run-down calculations
- Recipe Setup
- Receiver hopper weights
- Shared RT Sync workspaces
- Shared cloud recipes
- Shared cloud receiver-weight profiles
- Drag-and-drop hopper rearrangement
- Resin lookup
- Supabase-backed resin catalog
- Admin-only resin database editor
- Local fallback configurations
- Theme and display preferences
- Timeline and pump-off tracking

The app is already in active development and has an established architecture. Extend that architecture rather than replacing it.

---

# Core Product Concepts

## 1. Receiver Weight Profiles

Receiver Weight Profiles represent physical equipment values.

They may contain:

- Line type / layer layout
- Hopper naming mode where relevant
- Receiver hopper weights by physical hopper position

They must not contain:

- Resin names
- Hopper blend percentages
- Layer percentages
- Tracking state
- Pump-off state
- Timeline state
- Production values
- Appearance preferences
- RT Sync metadata

Loading a Receiver Weight Profile must only change receiver hopper weights.

---

## 2. Recipes

Recipes represent production material setup.

They may contain:

- Line type
- Hopper naming mode
- Layer percentages
- Resin name/code for each hopper
- Hopper blend percentage for each hopper

They must not contain:

- Receiver hopper weights
- Tracking state
- Pump-off state
- Timeline/runtime state
- Production or scrap values
- Themes or UI preferences
- Workspace identity
- RT Sync metadata
- Admin authentication data

Loading a Recipe must not overwrite physical hopper weights.

Unknown or inactive resin codes must remain loadable as stored strings.

---

## 3. Runtime State

Runtime state is separate from reusable configurations.

Examples:

- Tracking selections
- Pump-off state
- Current timeline state
- Active-job revision
- Sync outbox
- Device identity
- Current workspace connection
- Current operator changes

Do not include runtime state in recipes or receiver-weight profiles.

---

# Hopper Data Model

The current hopper objects mix several concerns:

```js
{
  pct,
  weight,
  resinName,
  track,
  pumpOff
}
```

Interpret these fields as:

- `pct`: recipe assignment
- `resinName`: recipe assignment
- `weight`: physical equipment value
- `track`: runtime state
- `pumpOff`: runtime state

Do not move or serialize entire hopper objects when only one concern is intended.

---

# Hopper Rearrangement

Desktop Recipe Setup supports rearranging hopper assignments.

The movable assignment consists only of:

- Resin name/code
- Hopper blend percentage

The following remain attached to the physical hopper:

- Receiver weight
- Tracking state
- Pump-off state
- Runtime state

Rules:

- Dropping onto an occupied hopper swaps assignments.
- Dropping onto an empty hopper moves the assignment and clears the source.
- H1 participates as a valid source and destination.
- H1 percentage is recalculated using the existing automatic H1 logic.
- Cross-layer moves must validate both affected layers.
- Rearrangement supports Undo, Cancel, and Done.
- Intermediate moves should not emit repeated RT Sync mutations.
- Done should emit no more than one normal RT Sync mutation.

Do not redesign this behavior without explicit instruction.

---

# Automatic Hopper 1 Behavior

Hopper 1 percentage is derived from Hoppers 2–6.

Conceptually:

```
H1 = 100 - sum(H2 through H6)
```

Use the existing `recomputeAutoH1()` behavior as the source of truth.

Requirements:

- Preserve H1 resin assignment.
- Validate H2–H6 totals.
- Recalculate H1 after applying recipes or rearranging assignments.
- Do not treat H1 as permanently non-draggable.
- Keep JavaScript and database validation semantics aligned.

---

# Supabase Architecture

Supabase is used for:

- Anonymous authenticated RT Sync users
- Workspaces
- Workspace membership
- Active-job synchronization
- Shared Workspace Configurations
- Resin catalog
- Admin authentication for resin editing

Do not place a Supabase service-role key in browser code.

Only the publishable browser key may be used client-side.

---

# RT Sync

RT Sync handles live shared job state.

It uses:

- Anonymous authenticated Supabase users
- Device IDs
- `line_workspaces`
- `line_workspace_members`
- Existing RLS and security-definer RPCs
- Existing Realtime behavior
- Existing outbox/retry behavior

Do not redesign RT Sync unless explicitly requested.

Do not couple reusable saved configurations to the live-state outbox.

---

# Workspace Configurations

Cloud Workspace Configurations are reusable documents, not live synchronized state.

Database table:

`public.workspace_configurations`

Supported types:

- `receiver_weight_profile`
- `recipe`

Behavior:

- Belong to an RT Sync workspace
- Shared by members of that workspace
- Explicit create/load/update/rename/duplicate/delete
- Recipe favorite metadata
- Last-write-wins
- No Realtime subscription
- No polling
- No offline mutation queue
- Cached reads are supported
- Failed writes preserve existing cache and operator state

All writes go through established security-definer RPCs.

Do not write directly to the table from UI code.

## Workspace Configuration Phases Already Implemented

### Payload layer

File: `workspace-configuration-payloads.js`

Global/module: `PolynWorkspaceConfigurationPayloads`

Contains pure creation, validation, and atomic application helpers for:

- Receiver Weight Profiles
- Recipes

Use these helpers rather than duplicating payload logic.

### Database layer

Migration: `supabase/migrations/202608020003_workspace_configurations.sql`

Includes:

- Table
- Constraints
- Payload validation
- Member-only RLS reads
- No direct client writes
- RPCs for create/update/rename/duplicate/delete/favorite
- Server-derived audit fields
- Server-normalized names
- Recipe-only favorites
- No Realtime publication

Do not alter this contract casually.

### Service/cache layer

File: `workspace-configurations-service.js`

Global/module: `PolynWorkspaceConfigurations`

Public service operations include:

- `getCached`
- `listCached`
- `listRecipes`
- `listReceiverWeightProfiles`
- `refresh`
- `create`
- `update`
- `rename`
- `duplicate`
- `delete`
- `setFavorite`
- `clearWorkspaceCache`
- `subscribe`

Use this service from UI code.

Do not query Supabase directly from Workspace Configuration UI.

Cache keys are workspace-scoped:

`polyn.workspaceConfigurations.v1::<workspace-id>`

Never mix caches between workspaces.

---

# Resin Catalog Architecture

Resin data is stored in:

`public.resins`

The app uses:

`resin-catalog-service.js`

Global/module: `PolynResinCatalog`

The shared resin service provides:

- `getResins`
- `getResinByCode`
- `refreshResins`
- `getCachedResins`
- `clearResinCache`
- `subscribe`

Recipe autocomplete and Resin Lookup must consume this service.

Do not read hard-coded resin data directly from UI code.

The hard-coded resin data remains only as an offline fallback.

---

# Resin Admin Architecture

Admin authentication uses Supabase email/password.

Admin membership is stored in:

`public.admin_users`

The admin UI supports:

- Add resin
- Edit resin
- Activate/deactivate resin
- No hard delete

Normal operators can read active resins.

Verified admins can read active and inactive resins and may insert/update.

Authorization is enforced by RLS and server-side checks, not only hidden UI.

Do not put the service-role key in the browser.

Do not authorize admins solely by checking an email address in JavaScript.

---

# Local Configurations

The app still has a legacy local saved-configuration system.

It uses localStorage and remains functional.

Do not:

- remove it
- silently migrate it
- overwrite it
- break it
- hide it without explicit instruction

The long-term plan is to treat it as migration-only legacy infrastructure, but it must coexist safely until an explicit import/retirement phase is implemented.

---

# UI Principles

## Main panels

Major tools should open in the app's main information panel, not oversized modals, unless a short confirmation or focused form is appropriate.

Examples:

- Timeline
- Recipe Setup
- Tools
- Resin Database
- Line Configurations

## Action hierarchy

Common actions should be visible.

Occasional actions should be in overflow menus.

For shared configurations:

- Load = primary
- Update = secondary
- Rename / Duplicate / Favorite / Delete = overflow actions

Avoid walls of equally prominent buttons.

## Mobile

Do not assume every desktop feature needs mobile support.

Current mobile priorities include:

- Viewing active run-down state
- Recipe Setup
- Workspace connection
- Potential future job-traveler camera scanning

Desktop-only behavior is acceptable when explicitly designed that way, such as hopper drag-and-drop.

## Safety

Before applying a cloud Recipe or Weight Profile, use confirmation previews that clearly state what will and will not change.

Do not alter operator state on:

- opening a panel
- refreshing
- canceling
- failed validation
- failed cloud calls

Only confirmed, validated operations may mutate approved fields.

---

# Coding Style

The project is framework-free and dependency-light.

Follow existing patterns:

- Plain JavaScript
- UMD/global exports where used
- HTML/CSS without introducing a framework
- Existing naming conventions
- Existing test style
- Existing script loading order

Do not introduce React, Vue, Svelte, a build system, or a package dependency unless explicitly requested.

Prefer small, focused modules.

Avoid broad refactors unrelated to the requested task.

---

# Testing Expectations

Every substantial feature or correction should include focused tests.

Run:

```
node --test *.test.js
git diff --check
```

Also run targeted tests for the feature being changed.

Tests should cover:

- success
- failure
- atomicity
- non-regression
- state preservation
- workspace isolation
- permission boundaries
- no unintended side effects

Source-level SQL contract tests are currently used where no local Postgres/Supabase instance is configured.

---

# Git and Workflow Rules

Work in small feature branches.

Before implementation:

- Inspect relevant code.
- Summarize current architecture.
- State intended files and changes.
- Identify compatibility/security concerns.

During implementation:

- Keep scope narrow.
- Do not begin future phases.
- Preserve backward compatibility.
- Do not commit unless explicitly asked.

After implementation:

- Inspect the full diff.
- Run focused tests.
- Run the full test suite.
- Run `git diff --check`.
- Report:
  - Files changed
  - Behavior added
  - Tests run
  - Remaining limitations

Never commit automatically unless explicitly instructed.

---

# Security Rules

Never:

- expose service-role keys
- expose auth tokens
- trust browser-supplied audit IDs
- trust browser-supplied normalized names
- bypass RLS
- use UI visibility as the only authorization
- add broad write policies
- weaken existing workspace membership checks without explicit instruction

Prefer:

- RLS
- security-definer RPCs
- empty SQL search_path
- server-derived user IDs
- narrow permissions
- explicit validation

---

# Current Product Status

The following are implemented and working:

- Resin catalog in Supabase
- Resin local cache
- Recipe autocomplete from resin service
- Resin Lookup from resin service
- Admin login
- Admin resin editor
- Resin activation/deactivation
- RT Sync workspaces
- Workspace Configuration payload helpers
- Workspace Configuration database contract
- Workspace Configuration service/cache
- Read/load UI
- Save/update/rename/duplicate/delete/favorite
- Receiver Weight Profiles
- Recipes
- Load previews
- Desktop hopper drag-and-drop
- Undo / Cancel / Done for rearrangement
- Existing local saves

Treat these as established features.

Do not replace them with alternate implementations unless explicitly requested.

---

# Future Ideas — Not Yet Implemented

Do not implement these unless explicitly asked:

- Job-traveler photo scanning
- OCR / vision extraction
- Supabase Edge Function for recipe images
- Mobile camera capture
- Recipe notes
- Search/filtering
- Recent recipes
- Legacy local-to-cloud import
- Retirement of old saved setups
- Mobile hopper drag-and-drop
- Offline cloud mutation queue

---

# Product Philosophy

Resin.tools is an internal production-floor tool.

Priorities:

1. Correctness
2. Operator clarity
3. State safety
4. Reliability during poor connectivity
5. Maintainability
6. Speed of use
7. Visual polish

Do not prioritize cleverness over predictable behavior.

When uncertain, preserve existing operator state and fail clearly rather than guessing.
