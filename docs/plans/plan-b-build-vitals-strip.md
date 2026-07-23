# Plan B — "Build vitals" metrics strip on the Analyse page

**Depends on Plan A (`plan-a-editable-build-date.md`) being implemented first** — it introduces the canonical `system.buildDate` this strip displays, plus the mechanics for adding synced Build Info columns (reused here for the performance rating). **Plan C (`plan-c-growth-trials.md`) follows this plan** and adds a full Growth Trials section to the same Analyse page; this strip's "Growing" tile is the summary that jumps to it.

## Why

Caroline's request, verbatim intent: the build date and pile age are currently only findable if someone happened to write them into the narrative text ("Build notes"), which isn't consistently filled in. She wants an at-a-glance metrics row **above the Build start photo** on the Analyse page — styled like the existing Kill Cycle stat tiles — showing: date built, days old, maturation reached, growth trials, an overall performance rating, and (stretch) the fungal-to-bacterial ratio at maturity.

## Read first

- `CLAUDE.md` at repo root (auto-loads) — deploy rules (**confirm with Joe before any production deploy**), conventions.
- `src/pages/SystemAnalysePage.tsx` — the page being changed. Key landmarks:
  - Line ~741: `<BuildDescription system={system} ... />` (top of page).
  - Lines ~743–812: "Composition + Build-start photos" grid — `InlinePhotoSlot slotId="start"` at line ~811 is the Build start photo.
  - Lines ~814–842: **Kill Cycle card** — the visual template Caroline wants copied: white rounded card, `grid grid-cols-3 gap-3`, centered tiles with small grey label / big bold value / tiny sub-label.
  - Readiness checks are already fetched into state (`readinessChecks`, sorted by date; each `check.results.fbRatio` — see line ~1399 where F:B is already rendered in the Readiness section).
  - `isPublicView` flag (line ~284) — `/view/...` routes are read-only.

## Data sources (all already available on the page or via `system`)

| Metric | Source |
|---|---|
| Date built | `system.buildDate` (Plan A), fallback: first chart-data entry date |
| Days old / age | today − buildDate (use `getNZDate()` from `utils/config.ts` for "today") |
| Maturation reached | `system.phase` + `system.maturation?.startedAt` (`MaturationInfo` in `src/types/index.ts`; synced via the Build Phases tab) |
| Growth trials | `system.grow?.trials` (`GrowTrial[]` — each has `crop` and `method`) + `system.grow?.startedAt` |
| F:B ratio at maturity | latest `readinessChecks` entry's `results.fbRatio` |
| Performance rating | **new field** — see step 1 |

## Steps

### 1. Performance rating field (new, synced)

Follow exactly the pattern Plan A established for `buildDate`:

- `src/types/index.ts`: add to `CompostSystem`: `/** Overall performance rating 1–5, set manually. */ performanceRating?: number;`
- `netlify/functions/compost-build-info.ts`: append `'Rating'` to `HEADERS` (next free column after Plan A's `BuildDate`), widen ranges, add to interface/`parseRow`/`buildRow`/POST merge-patch (store as a plain number string; parse defensively like `MulchBins`).
- `src/contexts/CompostContext.tsx`: include `performanceRating` in the app-open merge, push-up checks, and both build-info POST bodies.

Rating semantics: manual 1–5 stars, set by tapping the stars in the strip (not in public view). Manual is deliberate — Caroline said "perhaps an overall performance rating" and a human judgement is more honest than an invented formula. Don't build a computed score.

### 2. New component: `src/components/BuildVitals.tsx`

Props: `{ system: CompostSystem; firstEntryDate: string | null; latestFbRatio: number | null; readOnly: boolean; onRate?: (rating: number) => void }`.

Layout: same card chrome as Kill Cycle (`bg-white rounded-xl p-4 shadow-sm border border-gray-100`), header row with title (suggest **"Build vitals"**), then stat tiles — `grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3` so it works on mobile (the app is a PWA used in the field) and desktop:

1. **Built** — date formatted `12 May 2026`. If falling back to first-entry date, show a subtle `~` prefix with `title="Approximate — from first reading"`. If neither exists: `—` with sub-label "set on Manage page".
2. **Age** — big number = whole days since buildDate, sub-label `days old`. If the pile has moved to grow, this still counts from build (total age) — that's the number Caroline uses to judge maturity timing.
3. **Maturation** — if `maturation?.startedAt`: big number = days from buildDate to `startedAt`, sub-label `days to maturation`, small date underneath. Else: `—` with sub-label `not yet` (or current phase name).
4. **Growing** — if `grow?.trials?.length`: crop names joined (`Pumpkin, Comfrey`), sub-label `since {grow.startedAt}`. Truncate gracefully (`line-clamp-1` + `title` attr) — crop lists can get long. Else `—`. Once Plan C's Growth Trials section exists on this page, tapping this tile scrolls to it (`scrollIntoView` on a ref) — if Plan C ships after this, leave the tile non-interactive and Plan C wires it up.
5. **Rating** — five star glyphs; filled up to `performanceRating`. Tappable when `!readOnly` (calls `onRate`); include a way to clear (tap the current value again → unset). Unrated: hollow stars, sub-label `tap to rate` (hidden in public view).
6. **F:B ratio** (stretch — include if `latestFbRatio != null`, otherwise omit the tile entirely rather than showing a permanent `—`): value like `8.5:1` or the raw number as shown in the Readiness section (line ~1399 formats it `F:B {value}`), sub-label `at last readiness check`.

Keep it Tailwind-only, no new dependencies. Lucide icons are already used on the page if a small icon per tile helps scanning (e.g. `Calendar`, `Sprout`, `Star`) — optional, don't overdecorate.

### 3. Wire into `SystemAnalysePage.tsx`

- Render `<BuildVitals ... />` **directly above the Composition + Build-start-photos grid** (i.e. between `BuildDescription` at ~line 741 and the grid at ~line 743). Full-width card above the photo, not squeezed into the grid column — it's the "quick look see" for the whole build.
- `firstEntryDate`: derive from the earliest chart/entry date already computed on the page.
- `latestFbRatio`: last element of the sorted `readinessChecks` array's `results.fbRatio` (nullable).
- `readOnly={isPublicView}`.
- `onRate`: `updateCustomSystem({ ...system, performanceRating: rating })` (from `useCompost()` — already imported on the page via context) + a success toast.

### 4. Print report

`src/pages/PrintReportPage.tsx` already prints a bare "Start" date (~lines 91–95). Replace that with a compact static version of the same vitals (a simple flex row of label/value pairs — no interactivity, no star-tapping). Keep `break-inside-avoid`.

## Out of scope

- Backfilling narratives / "training him on the narratives" — human process, not app work.
- Computed performance scores, cross-build rating comparisons (CohortPage etc.).
- Trial detail, per-trial photos, and the Growth Trials section itself — all Plan C. This strip only summarises.
- Kill-cycle tiles duplication — the Kill Cycle card already exists just below; don't repeat its numbers in the vitals strip.

## Testing / verification

- `npm run dev` + browser preview: check a build with full data (matured + grow + readiness), a young thermophilic build (mostly `—` states), and a legacy build with no `buildDate` (fallback path). Check mobile width (375px) — tiles must wrap, not overflow.
- Check `/view/:systemId` (public): stars visible but not tappable, no "tap to rate".
- Check `/analyse/:id/print`: vitals row renders, no layout break.
- `npm run build` must pass.
- Production deploy only after Joe confirms.
