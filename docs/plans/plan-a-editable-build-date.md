# Plan A — Canonical, editable build date

**Do this plan first. Plan B (build metrics strip) depends on it, and Plan C (growth trials) reuses the edit-panel pattern introduced here.** Recommended order: A → B → C.

## Why

Caroline's two problems, both rooted in the same gap:

1. There is no single "date this pile was built" field anywhere in the app. The date is written per-bin into the **Bin Tracker** tab (col J, "Date of Batching") when a build is created, and the Analyse/Print pages approximate the start date from the **first temperature reading's date** — which can be days after the actual build.
2. PC4 and PC5 were built days apart but were accidentally loaded with the same build date (the 7-May bins were missing from the spreadsheet at load time). There is currently **no way to edit a build date after creation** — hence this plan.

Goal: one canonical `buildDate` per build, synced across devices, editable from the build's Manage page, and propagated back into Bin Tracker so the spreadsheet stays consistent.

## Read first

- `CLAUDE.md` at the repo root (loads automatically) — deploy rules (production deploys are manual, **confirm with Joe before deploying**), Google Sheets architecture, coding conventions.
- Note: CLAUDE.md predates the Build flow. The newer relevant pieces are `src/pages/BuildPage.tsx` (create), `src/pages/BuildDetailPage.tsx` (per-build Manage page), `netlify/functions/compost-build-create.ts`, `compost-build-info.ts`, `compost-build-delete.ts`, `compost-build-bins-remove.ts`.

## Where the data lives today (verified)

- **Bin Tracker tab**: col G = bin serial, col I = maturation date, col J = "Date of Batching" (format `DD-MMM-YYYY`, e.g. `21-Feb-2026`), col K = batch/build name. `compost-build-create.ts:202-216` writes J:K for each selected bin; `compost-build-delete.ts` and `compost-build-bins-remove.ts` find a build's rows by matching col K against the build name and clear J:K — reuse that lookup pattern.
- **Build Info tab** (shared per-build metadata, bidirectionally synced on app open): columns A–I = `System, Notes, Summary, BuildType, MulchBins, MulchType, Dimensions(JSON), ProbeLabels(JSON), UpdatedAt`. Managed by `netlify/functions/compost-build-info.ts`. `ensureTabAndHeaders` auto-extends the header row when `HEADERS` grows — **append new columns at the end only**.
- **Client sync**: `src/contexts/CompostContext.tsx`
  - App-open merge (sheet→local, then push local→sheet where sheet is blank): ~lines 239–319.
  - `updateCustomSystem` (~line 553): saves to IndexedDB then fire-and-forget POSTs all editable fields to `compost-build-info`.
- **Type**: `CompostSystem` in `src/types/index.ts` — currently has no build date field.
- **Analyse "start date" approximations to replace**: `AnalysePage.tsx:91`, `PrintReportPage.tsx:41`, `PublicViewPage.tsx:46` all use `first entry .date`. (`CohortPage.tsx:129` / `SeasonalPage.tsx:130` do the same for cross-build charts — update if trivial, otherwise leave and note it.)

## Steps

### 1. Type

Add to `CompostSystem` in `src/types/index.ts`:

```typescript
/** Date the pile was physically built (YYYY-MM-DD). Canonical; editable. */
buildDate?: string;
```

### 2. Build Info sheet column

In `netlify/functions/compost-build-info.ts`:

- Append `'BuildDate'` to `HEADERS` (becomes col J — after `UpdatedAt`; the append-only rule matters more than tidy ordering because `ensureTabAndHeaders` only extends, never reorders).
- Widen `RANGE`/`HEADER_RANGE` to `A:J` / `A1:J1`.
- Add `buildDate: string` to the `BuildInfo` interface, `parseRow` (`r[9] || ''`), and `buildRow`.
- In the POST merge-patch handler, treat `buildDate` like the other fields: `undefined` leaves the existing value alone, a string (including `''`) overwrites. Store as `YYYY-MM-DD` in this tab (it's app-internal; the `DD-MMM-YYYY` format is only for Bin Tracker).

### 3. Client sync in `CompostContext.tsx`

- Add `buildDate` to the `infos` type in the app-open fetch, to the sheet→local merge (`buildDate: sheetInfo.buildDate || base.buildDate`), to the `hasLocal`/`sheetHas` checks, and to both POST bodies (app-open push-up and `updateCustomSystem`).

### 4. New Netlify function: `compost-build-date.ts`

POST `{ buildName: string, buildDate: string /* YYYY-MM-DD */ }`. It must:

1. Read `'Bin Tracker'!K:K`, find every row where col K equals `buildName` (copy the lookup from `compost-build-delete.ts:56-82`).
2. Write the new date into col J of each matched row, formatted `DD-MMM-YYYY` — copy `formatNZDate` from `compost-build-create.ts:27-42` (parse as noon NZ time to dodge UTC day-boundary bugs).
3. Also upsert `BuildDate` in the Build Info tab for that system (so the two stores can't drift even if the client's separate build-info POST fails).
4. Return `{ success, binsUpdated }`.

Keep it lean — I/O only, matching the other functions' CORS/OPTIONS/error shape.

### 5. Edit UI on `BuildDetailPage.tsx`

Add a collapsible "Build date" panel alongside the existing Dimensions / Probes / Build-details panels (follow the `dimsOpen`/`metaOpen` pattern, ~lines 114–136 for state, and their JSX panels further down):

- `<input type="date">` (same as `BuildPage.tsx:312`).
- Prefill priority: `system.buildDate` → earliest `batchingDate` among `assignedBins` (already parsed on this page — `AssignedBin.batchingDate`, parse with the existing `parseTrackerDate` helper and convert to YYYY-MM-DD) → empty.
- On save:
  1. `await updateCustomSystem({ ...system, buildDate })` — persists locally + syncs Build Info.
  2. POST to `/.netlify/functions/compost-build-date` with `{ buildName: system.name, buildDate }` — rewrites Bin Tracker col J for all this build's bins. Show a toast with how many bin rows were updated; on failure, toast an error but keep the local save (the sheet can be retried by saving again).
- Brief caption under the field: "Used for pile age and day-numbering. Also updates the batching date on this build's bins in the spreadsheet."

### 6. Set buildDate at creation

`BuildPage.tsx` `handleCreate` (~line 259): the `CompostSystem` object built after a successful create should include `buildDate` (the form already has it in state — line 98). Server side already writes Bin Tracker col J; step 2's Build Info column gets populated via `addCustomSystem`'s eventual sync — check whether `addCustomSystem` POSTs to build-info like `updateCustomSystem` does; if it doesn't, either add the same fire-and-forget POST there or rely on the app-open push-up (which only fires when the sheet row is blank — that's sufficient for a brand-new build, but adding the explicit POST is cleaner).

### 7. Use it where "start date" is shown

In `AnalysePage.tsx`, `PrintReportPage.tsx`, `PublicViewPage.tsx`: prefer `system.buildDate` when set, falling back to the current first-entry-date logic. Don't touch chart x-axes — charts plot actual reading dates and should keep doing so.

## Explicitly out of scope

- **The day-zero temperature outlier on PC4/PC5**: correcting the build date fixes the age/day-numbering; it does not delete the anomalous first reading. If Caroline wants that reading removed or annotated, that's a manual edit to the sheet row — flag it to Joe, don't build anything.
- Per-bin batching dates diverging within one build (bins added later via BuildDetailPage get today's date — that behaviour stays).
- Editing **phase-transition dates** (maturation started, grow started) and **trial dates** — that's Plan C step 5 (`plan-c-growth-trials.md`), which adds a "Phase dates" panel on the same BuildDetailPage following this plan's panel pattern. Don't build it here.

## Testing / verification

- `npm run dev` covers UI states but functions need `netlify dev` (env vars only exist in Netlify, so real sheet round-trips can't be tested locally without them — verify the function logic by code review, then verify live after Joe approves a deploy).
- Manual checks after deploy (with Joe): edit PC5's build date → confirm Bin Tracker col J updated for exactly PC5's bins, Build Info row updated, second device picks up the new date on app open, Analyse shows the corrected date.
- `npm run build` must pass (TypeScript strict).

## Fixing PC4/PC5 (the actual data repair)

Once shipped, Caroline (or Joe) opens Manage → PC5 (whichever has the wrong date) → Build date panel → sets the true build date. That corrects Bin Tracker, Build Info, and every derived "days old" figure in one action. No code-side data migration needed.
