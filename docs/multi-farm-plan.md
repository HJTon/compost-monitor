# Multi-farm Compost Monitor: plan

**Status:** proposed, 2026-11-25. Nothing built yet.

**Goal:** one app and one codebase, with each farm getting its own Google Sheet and Drive folder.
Farmers pick their farm at login, and each farm can switch features off so the app stays simple.

## Why not one shared sheet

Each new build adds a tab (`compost-build-create.ts`), so the sheet only ever grows. With two
farms in one sheet it would grow twice as fast. It would get slow in the browser, the functions
would read more on every request, and each farm would see the other's builds. A sheet per farm
halves the growth and keeps each farm's data apart.

## What is shared and what is per farm

| Data | Where it lives |
|---|---|
| **Bin Tracker** (written by the Green Loop collector app; col O = farm) | **Shared.** It stays in the current sheet. Every farm reads it filtered by col O, which builds on the uncommitted FarmPicker work in `BuildPage` / `BuildDetailPage`. |
| Build Types, Trial Methods, Trial Crops (pick-lists) | Shared. They stay in the current sheet so both farms use the same vocabulary. |
| Build tabs (one per pile), Build Info, Build Phases, Media, Trial Runs, readiness / sampling tabs | **Per farm.** Each farm has its own spreadsheet. |
| Photos and videos | A Drive folder per farm. |
| Event Feedback | Unchanged (`FEEDBACK_SPREADSHEET_ID` or the current sheet). |

Eudaimonia keeps the current spreadsheet as its farm sheet, so **no existing data moves**.

## Farm config

A new `src/config/farms.ts` (read by the client) and `netlify/functions/_lib/farms.ts` (read by
the server). Both use the same keys:

```ts
{
  key: 'eudaimonia',
  name: 'Eudaimonia',                 // must match Bin Tracker col O exactly
  spreadsheetEnv: 'COMPOST_SPREADSHEET_ID',
  driveFolderEnv: 'COMPOST_DRIVE_FOLDER_ID',
  location: { lat: -39.18598, lng: 174.078433 },
  fixedSystems: COMPOST_SYSTEMS,      // the 11 hardcoded Pivot/Batch/Cylinder/Carbon Cube systems
  features: 'all',
},
{
  key: 'kahu-glen',
  name: 'Kahu Glen',
  spreadsheetEnv: 'COMPOST_SPREADSHEET_ID_KAHU_GLEN',
  driveFolderEnv: 'COMPOST_DRIVE_FOLDER_ID_KAHU_GLEN',
  location: { lat: …, lng: … },
  fixedSystems: [],                   // builds only, made via Let's Build
  features: ['entry', 'build', 'photos', 'history'],   // the simpler farmer view
}
```

Spreadsheet IDs stay in Netlify env vars, not in the code.

## Changes

### 1. Server: resolve the sheet from the farm (about 30 functions)
- Add `_lib/farms.ts` with `farmFrom(event)`, which reads the `X-Farm` header (or `?farm=`),
  validates it against the farm list, and defaults to `eudaimonia` so old clients keep working.
  Also add `sheetIdFor(farm)`, `driveFolderFor(farm)` and `sharedSheetId()`.
- Replace each `process.env.COMPOST_SPREADSHEET_ID` with either `sheetIdFor(farmFrom(event))`
  (per-farm tabs) or `sharedSheetId()` (Bin Tracker, pick-lists). This is mechanical, but every
  function needs checking for which tabs it touches. The functions that use both kinds are
  `compost-build-create`, `-delete`, `-date`, `-recolour`, `-bins-remove` and `-bin-composition`:
  they write Bin Tracker cols H–J in the shared sheet *and* create or read the build tab in the
  farm sheet.
- Edge-cache keys must vary by farm. Add `Vary: X-Farm`, or use the `?farm=` query param on
  cached GETs. This one matters most: without it, one farm could be served the other's cached data.

### 2. Client: send the farm with every request
- Store the current farm in settings. The FarmPicker's "which farm are you at" setting becomes
  this value.
- Add a single `api()` wrapper around `fetch` that adds `X-Farm`. Point all ~65
  `/.netlify/functions/` call sites at it (`fetchRetry` already covers some of them).
- **Local data per farm:** open IndexedDB as `compost-monitor` (Eudaimonia, unchanged) or
  `compost-monitor-<key>` (other farms). Then a device that switches farms can't mix entries,
  custom builds or the sync queue. Each queued sync item also records its farm, so an entry
  saved offline at Kahu Glen still goes to Kahu Glen's sheet after a switch.
- `COMPOST_SYSTEMS` comes from `farm.fixedSystems`, and weather uses `farm.location`.

### 3. Login and farm choice
- `PasswordGate` takes a password per farm (a hash per farm in the config), and the password you
  type picks the farm. Staff who work across both farms get an admin password plus a farm switcher
  in Settings.
- This is still only a client-side gate, the same as today. The functions don't check who is
  calling, so a determined person could post to either farm. That's acceptable for now. Real
  per-farm auth is a reason to move to Supabase later.

### 4. Simple mode via feature flags
- `features` hides nav entries and Dashboard cards: Analyse, Trials, Sampling, Cohort / Compare /
  Seasonal, Impact report and the sandbox. Hidden routes redirect to the Dashboard.
- It's one codebase, so turning a feature on for a farm later is a one-line config change.

### 5. Setting up a new farm (checklist)
1. Create the Google Sheet and the Drive folder (Joe owns them), then share both with the
   service account `green-loop-sheets@green-loop-collections.iam.gserviceaccount.com` as Editor.
2. Set the Netlify env vars `COMPOST_SPREADSHEET_ID_<FARM>` and `COMPOST_DRIVE_FOLDER_ID_<FARM>`.
3. Add the farm to both config files with its password hash, location and features.
4. Deploy. The shared tabs (Build Info, Media, and so on) are created on first write; the
   existing `ensureTabAndHeaders` already does this.

### 6. Keep each sheet small: yearly archive
- Add a `compost-archive-builds` function (or a script in `scripts/`). It copies a finished build's
  tab into a per-farm archive spreadsheet (`copyTo`), then deletes it from the live sheet.
  Build Info and Media rows stay in place, so Analyse still works through a lookup that points at
  the archive.
- This is a separate, later phase. It isn't needed to launch the second farm.

## Order of work

1. Server `_lib/farms.ts` and the per-function switch. Defaulting to Eudaimonia means it can ship
   on its own with no visible change.
2. Client `api()` wrapper, IndexedDB per farm, farm-tagged sync queue.
3. Farm config, per-farm passwords, farm switcher.
4. Feature flags / simple mode.
5. Set up Kahu Glen's sheet and folder, then deploy.
6. (Later) yearly archive.

Test steps 1 and 2 by checking that Eudaimonia behaves exactly as before: entries, a build
create/delete against Bin Tracker, and photo upload. Then point a test farm at a scratch
spreadsheet and repeat.

## Decisions (2026-11-25)
- The new farm is **Kahu Glen** (Bin Tracker col O value `Kahu Glen`). It is builds only, with
  no fixed systems.
- It gets the same features as Eudaimonia, so step 4 (feature flags) is deferred.
- It uses one shared farm password.

## Progress
- **Step 1 done (not yet deployed):** `netlify/functions/_lib/farms.ts`. Every function now
  resolves its spreadsheet or Drive folder from the farm. Bin Tracker lookups by build name also
  check the bin's farm (col O). Cached reads vary by `X-Farm`. `compost-build-create` refuses
  bins from another farm.
- A request with **no** farm still sees every bin, so today's app behaves exactly as before.
  This includes building Kahu Glen piles from it.

## Still open
- The FarmPicker / bin-filter changes in `BuildPage`, `BuildDetailPage`, `types` and `farm.ts`
  are uncommitted. Should they be finished and committed first? This plan builds on them.
