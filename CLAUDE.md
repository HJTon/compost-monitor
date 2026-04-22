# Compost Monitor — Claude Code Guide

## What this project is

A Progressive Web App (PWA) for monitoring compost temperatures across 11 systems at a composting operation in Taranaki, New Zealand. Staff record daily probe temperatures, weather, moisture and odour readings per system. The app tracks kill cycle progress (131°F / 55°C for 3 consecutive days), syncs entries to Google Sheets, and shows historical temperature charts pulled directly from the spreadsheet.

Live at: https://compostmonitor.netlify.app

---

## Tech stack

- **React 19** with **TypeScript** and **Vite 7**
- **Tailwind CSS 4** for all styling
- **React Router 7** for routing (SPA)
- **Recharts** for temperature charts
- **IndexedDB** (via custom `db.ts` service) for local offline storage
- **Netlify Functions** for the serverless backend
- **Google Sheets API** (via service account) as the data store
- **Netlify Blobs** for photo/video storage
- No user accounts — no authentication layer

---

## Running locally

```bash
npm install
npm run dev
```

App runs at http://localhost:5173. The Netlify Functions won't be available locally, so data won't sync to/from Google Sheets. All local reads/writes go to IndexedDB.

To test functions locally:
```bash
netlify dev
```

---

## Deploying

**Always deploy via the Netlify CLI from this directory, using the explicit site ID:**

```bash
netlify deploy --prod --site 3025dc6b-9c5f-4433-9e66-4c0582fb649f
```

This builds the app and deploys to **https://compostmonitor.netlify.app**.

> **Important:** Always use `--site` flag as above. The CLI link state has caused cross-deployment incidents in the past (compost-monitor deploying to the Sustainable Trails site). The `--site` flag bypasses the link entirely and guarantees the right site every time. Never run `netlify deploy --prod` without it.

After deploying, push to GitHub:
```bash
git add .
git commit -m "your message"
git push
```

GitHub repo: https://github.com/HJTon/compost-monitor

---

## Project structure

```
netlify/
  functions/
    compost-sheets-write.ts     ← Append new entry row to Google Sheet
    compost-sheets-read.ts      ← Read raw sheet data
    compost-sheets-history.ts   ← Parse & return last N entries for a system
    compost-media-upload.ts     ← Upload photo/video to Netlify Blobs (daily entries) / Drive (build photos)
    compost-media-serve.ts      ← Serve media from Netlify Blobs
    compost-media-list.ts       ← List photos in a build's Drive subfolder
    compost-media-index.ts      ← Manage the `Media` sheet tab (slot assignments, captions, transforms)
    compost-build-info.ts       ← Manage the `Build Info` sheet tab (notes + summary per build)
    compost-weather.ts          ← Fetch weather from Open-Meteo API

src/
  App.tsx                       ← Routes
  contexts/
    CompostContext.tsx           ← Central state: entries, sync, settings
  pages/
    DashboardPage.tsx           ← All systems overview, kill cycle status
    SystemDetailPage.tsx        ← Per-system chart + recent entries
    SystemAnalysePage.tsx       ← "Let's Analyse": narrative report with paired data + photos
    PrintReportPage.tsx         ← Print-optimised layout at `/analyse/:id/print` (auto-fires window.print)
    DailyEntryPage.tsx          ← Data entry form (probe temps, weather, etc.)
    HistoryPage.tsx             ← Browse entries by date
    LandingPage.tsx             ← App intro/install prompt (Settings icon top-right)
  components/
    Header.tsx
    Button.tsx
    MediaCapture.tsx            ← Photo/video capture
    TempGrid.tsx                ← 3×3 grid input for 9 probe temps
    TempStepper.tsx             ← Sequential stepper input (alternative)
    SaveConfirmModal.tsx        ← Pre-save confirmation for out-of-range / skipped probes
    BuildDescription.tsx        ← Build-type badge + editable notes + summary
    PhotoGallery.tsx            ← Slideshow + lightbox for a slot's photos (click menu: caption / frame / remove)
    PhotoSlot.tsx               ← Wraps PhotoGallery with add/remove/caption/transform handlers
    InlinePhotoSlot.tsx         ← Self-fetching single-slot component for inline use
    DrivePicker.tsx             ← Modal to pick existing Drive photos or upload new ones
    FrameEditor.tsx             ← Non-destructive pan/zoom editor; saves {fx, fy, zoom}
  services/
    db.ts                       ← All IndexedDB CRUD operations
    syncService.ts              ← Sync queue management, retry logic
    weatherService.ts           ← Fetch & cache weather data
  utils/
    config.ts                   ← System definitions, thresholds, helpers
  types/
    index.ts                    ← All TypeScript interfaces
```

---

## The 11 compost systems

Defined in `src/utils/config.ts`. Each has an `id`, `name`, `sheetTab` (exact Google Sheet tab name), and probe count:

| ID | Name | Sheet Tab | Probes |
|---|---|---|---|
| `pivot-1` to `pivot-4` | Pivot #1–4 | `Pivot #1` etc. | 9 |
| `batch-1` to `batch-3` | Batch 1–3 | `Batch 1` etc. | 9 |
| `cylinder-1` to `cylinder-3` | Cylinder #1–3 | `Cylinder #1` etc. | 5 |
| `carbon-cube-1` | Carbon Cube Cycle 1 | `Carbon Cube Cycle 1 ` (trailing space) | 3 |

> Note the trailing space in `Carbon Cube Cycle 1 ` — this matches the actual sheet tab name and must be preserved.

---

## Data architecture

### Local (IndexedDB via `db.ts`)
Four stores:
- `entries` — all `DailyEntry` records, indexed by `systemId` and `date`
- `syncQueue` — pending sync items waiting to be pushed to Google Sheets
- `media` — photos/videos
- `weatherCache` — cached weather responses
- `settings` — app configuration

### Remote (Google Sheets)
Each system has its own sheet tab. Column layout:
- **A–G**: Date, Time, Weather, Ambient Min, Ambient Max, Moisture, Odour
- **H–Q**: Probe values (up to 9 columns)
- **R–S**: Average, Peak (spreadsheet formulas, auto-added on write)
- **T–W**: Vent Temps, Visual Notes, General Notes, Media Links

The app **writes** via `compost-sheets-write` and **reads history** via `compost-sheets-history`.

Two additional shared tabs (auto-created on first write):
- **`Media`** — per-slot photo assignments for every build (see "Let's Analyse" section below)
- **`Build Info`** — per-build shared metadata (see "Build Info sync" section below)

### Settings location
The Settings page is opened from the **landing page** (gear icon top-right), not from the Dashboard. Active-system toggling lives on the Manage page, not in Settings.

### Data flow
1. User saves entry → IndexedDB + sync queue
2. If online → immediate sync to Google Sheets
3. If offline → syncs automatically when connection restored
4. Charts on `SystemDetailPage` fetch directly from `compost-sheets-history` (last 365 days), falling back to local IndexedDB if the fetch fails

---

## State management

**`CompostContext`** (use via `useCompost()`) provides:
- `entries` — all local `DailyEntry[]` from IndexedDB
- `loading`, `isOnline`, `isSyncing`, `pendingCount`
- `saveEntry(entry)` — saves to IndexedDB, queues sync, triggers immediate sync if online
- `getSystemEntries(systemId)` — entries for one system
- `getEntryForSystemDate(systemId, date)` — single entry lookup
- `syncNow()` — manually trigger sync
- `settings`, `updateSettings()`
- `allSystems`, `getSystem(id)` — hardcoded `COMPOST_SYSTEMS` merged with custom builds
- `addCustomSystem(sys)` / `updateCustomSystem(sys)` / `removeCustomSystem(id)` — CRUD for custom builds in IndexedDB (state updates immediately)
- `setSystemActive(id, active)` — toggle a build's active flag

> Note: `getSystem` prefers hardcoded definitions over custom entries with the same id. Editable per-build settings (dimensions, probe count, mulch, build type) are written to the shared **`Build Info`** sheet tab so every device sees the same values — see next section.

---

## Build Info sync (shared across devices)

Per-build metadata that isn't part of the daily readings lives in a single `Build Info` sheet tab and is synced bidirectionally on app open.

Columns: `System | Notes | Summary | BuildType | MulchBins | MulchType | Dimensions (JSON) | ProbeLabels (JSON) | UpdatedAt`

- **Function:** `netlify/functions/compost-build-info.ts` — GET (all rows or single system), POST (merge-patch: undefined fields leave existing values alone)
- **Write path:** `updateCustomSystem()` in `CompostContext` writes to IndexedDB and fires a POST with all editable fields. Notes/Summary go through `BuildDescription` the same way.
- **Read path on app open:**
  1. Fetch all rows → for each system, merge sheet values over local where the sheet has data. Save merged result to IndexedDB so changes persist offline.
  2. For each local system that has data the sheet is missing (e.g. a user who entered mulch bins before sync existed), push the local values up so other devices see them next time they open the app.
- **Migration:** `ensureTabAndHeaders` extends the header row when old 4-column tabs are detected — no manual action needed.
- Dimensions + ProbeLabels are stored as JSON strings; parsed defensively on read (invalid JSON → null, falling back to local).

---

## Key data types

```typescript
DailyEntry {
  id: string
  systemId: string
  date: string          // YYYY-MM-DD
  time: string          // HH:MM
  weather: WeatherCondition | null
  ambientMin/Max: number | null
  moisture: MoistureLevel | null
  odour: OdourLevel | null
  probes: ProbeReading[]        // [{ probeIndex, label, value }]
  averageTemp: number | null    // calculated from probes
  peakTemp: number | null       // calculated from probes
  killCycleDays: number
  synced: boolean
}
```

---

## Let's Analyse — narrative report

The `SystemAnalysePage` at `/analyse/:systemId` is a desktop-first "story of this pile" view. Data sections (Composition, Readiness Check, Soil, Harvest, etc.) sit on the left; photos of the same subject sit on the right (2-column on desktop via `md:grid-cols-2`, stacks on mobile).

### Build description (top of page)
`BuildDescription` shows the build-type badge only at the top (probe count, dimensions, mulch bins are no longer surfaced here — those details live on the Manage page). Two editable textareas — **Build notes** (freeform story of the build) and **Summary** (plain-language wrap-up) — are saved per-system to the `Build Info` sheet tab via `compost-build-info.ts`.

### Temperature chart

The chart lives under the Build Description. Two toggles in the header:
- **°F → °C / °C → °F** — unit conversion for all temperature series
- **Ambient** — overlays the daily ambient min (light blue dashed) and max (deeper blue dashed) pulled from the sheet's Ambient Min/Max columns. Values are stored in the sheet in °C; converted to the chart's active unit at render time.

When Ambient is on, the chart tooltip adds an `Ambient: min / max` line.

### Future enhancements (not yet built)

- **AI-assisted summary** on the Summary field — pre-fill from readings, kill-cycle achievement, turn events, sample labs. Will use the same pattern as Hononga's `summarise-korero.ts`.
- **Cross-build analytics** — filter and compare multiple builds by build type, season, or custom attribute. See "Ideas for expanding Analyse" further down.

### Photo slots
Fixed slots are defined in `src/utils/photoSlots.ts`:
- `hero` — lead photo
- `start` — the build being made
- `readiness` — readiness check
- `quality` — compost quality / lab
- `soil` — soil performance
- `harvest` — harvest / outcome

Photos are stored in **Google Drive** per-build subfolders (same folder tree as daily-entry uploads; folder name matches `system.name`). Slot assignments, captions, and pan/zoom transforms are tracked in a **`Media` sheet tab**:

| System | Slot | Order | FileId | ThumbnailUrl | WebViewLink | MimeType | Caption | Date | AddedAt | Transform |
|---|---|---|---|---|---|---|---|---|---|---|

The `Transform` column holds JSON `{fx, fy, zoom}` (0..1 focal-point coords + zoom factor); `FrameEditor` writes it, `PhotoGallery` applies it via CSS `object-position` + `scale()` — the Drive file is never modified.

### Components
- **`DrivePicker`** — modal with Pick/Upload tabs, shows aspect-ratio-preserving thumbnails with Portrait/Landscape badges
- **`PhotoGallery`** — slideshow with dots, lightbox, per-photo kebab menu (Edit caption / Adjust frame / Remove). Portrait photos (aspect < 0.95) are detected via `onLoad` and capped at `max-h-[70vh]`.
- **`PhotoSlot` / `InlinePhotoSlot`** — slot wrappers; `InlinePhotoSlot` self-fetches and is used throughout `SystemAnalysePage`
- **`FrameEditor`** — pointer-drag focal point + 1×–4× zoom slider

### Print / Save as PDF
`/analyse/:systemId/print` (`PrintReportPage`) renders all slots stacked (no slideshow), `loading="eager"`, with `@page {size: A4; margin: 14mm}` and `break-inside-avoid`. Auto-calls `window.print()` after 800ms.

### Public view
Routes under `/view/:systemId` set `isPublicView = true` — photo editing controls and CSV import are hidden, textareas are read-only.

### Ideas for expanding Analyse (roadmap)

Single-build Analyse works today. The next step is **cross-build analytics**, grouping builds by their shared metadata (which is why `buildType`, `mulchBins`, dimensions, season-of-build, etc. are now synced to the Build Info tab — it becomes the query axis).

Four directions worth exploring:

1. **Build-type cohorts** — e.g. "all Johnson-Su Static builds". Averaged kill-cycle curves overlaid, mean days-to-131°F, longest-streak distribution. Feels like an Analyse-level page with a `?type=` filter.
2. **Type-vs-type comparisons** — Johnson-Su Static vs Non-Static side-by-side; Carbon Cube vs Pallet Bay. Two curves, delta table below (avg peak, avg kill days, avg volume loss %).
3. **Seasonal comparisons** — same build type split by build start month (summer vs winter). Ambient overlay (already built for the single-chart view) becomes essential context here.
4. **Recipe correlation** — bin composition (% food, % coffee, % cardboard, etc.) as input, peak temperature / kill days achieved as output. Scatter or small-multiple charts.

Implementation approach when ready: add an `/analyse` index page with filter chips (type, season, mulch load), render a small-multiple grid of sparkline temperature curves, and link through to the existing per-build page for detail. Volume/kill-days aggregations can live in a new Netlify function that reads multiple sheet tabs server-side and returns a normalised dataset.

---

## Kill cycle logic

- **Threshold:** 131°F (55°C) — `KILL_TEMP_F` in `config.ts`
- **Required:** 3 consecutive days above threshold — `KILL_DAYS_REQUIRED`
- Kill cycle streaks are calculated from `peakTemp` in `SystemDetailPage`
- Temperature colour coding: cold (< 100°F) → warm (100–130°F) → hot (131–160°F) → danger (> 160°F)

---

## Guardrails (Let's Measure)

Extreme / skipped temperature readings are caught at two points by the same `SaveConfirmModal` component.

**Limits:**
- **Upper:** `TEMP_UPPER_LIMIT_F` = 200°F (fixed)
- **Lower (daily entries):** `getTempLowerLimitF(ambientMaxC)` = `max(50, round(ambientMaxF))` — uses the entry's own ambient max so cold days keep the 50°F floor and warm days lift it to roughly ambient
- **Lower (samples):** fixed `TEMP_ABSOLUTE_LOWER_F` = 50°F (no ambient context on the sample form)

**Per-probe check — fires during entry, as soon as an extreme reading is committed:**
- `TempStepper` / `TempGrid` expose an `onProbeCommit(probeIndex)` callback
- Stepper fires on Next / Prev / dot-tap (for the probe being left); grid fires on `blur` and Enter
- `SampleEntryPage` fires on blur of the Temp input
- Modal copy: title "Check this reading", primary "Let me fix it" (clears the value), secondary "Yes, keep it"
- Confirmed values are tracked in a `Map<probeIndex, value>` (daily) or `Map<sampleId, tempString>` (samples) so they won't get re-flagged
- Changing a confirmed value invalidates the confirmation — the guardrail re-runs on the next commit

**Save-time check — catches everything still unresolved:**
- Skipped probes (daily: any `value === null`; samples: row with a probe label but blank temp) — flagged only here since "skipped" isn't knowable mid-entry
- Any out-of-range value that wasn't already user-confirmed per-probe
- Modal copy: title "Hold on — before you save", primary "Go back and edit", secondary "Save anyway"
- On daily entries with skipped probes, a small bottom link offers to navigate to `/manage/:systemId` to reduce the probe count

Builds can have their probe count adjusted at any time via the "Probes" panel on the build detail page — the change applies to future readings only; past sheet rows keep their original probe columns.

---

## Coding conventions

- **TypeScript throughout** — no `any` unless absolutely necessary, use proper interfaces from `src/types/index.ts`
- **Tailwind only** for styling — no CSS modules or inline styles
- **`useCompost()`** to access global state — do not read IndexedDB directly in components
- Keep Netlify Functions lean — they should only handle I/O with Google Sheets/Blobs, no business logic
- All temperatures are stored and calculated in **Fahrenheit**
- Dates are always **YYYY-MM-DD** strings, times are **HH:MM** strings
- Use `getNZDate()` and `getNZTime()` from `config.ts` for current date/time (NZ timezone)

---

## What NOT to do

- Do not add a separate database or backend — Google Sheets is the canonical store
- Do not bypass `CompostContext` to read/write IndexedDB directly from components
- Do not change the `sheetTab` values in `config.ts` without updating the actual Google Sheet tab names to match
- Do not remove the trailing space from `'Carbon Cube Cycle 1 '` — it matches the real sheet tab name
- Do not commit `.env` files — Google service account credentials are stored in Netlify environment variables only
- Do not run `netlify link` or `netlify unlink` in either project folder without checking which site it's currently linked to first (`netlify status`)
- Do not commit the `dist/` folder

---

## Environment variables (set in Netlify dashboard)

- `GOOGLE_SERVICE_ACCOUNT_KEY` — JSON credentials for the Google service account
- `COMPOST_SPREADSHEET_ID` — Google Sheets spreadsheet ID

These are not needed for local development (functions won't work locally without them).

---

## Git workflow for teams

- Work on a **feature branch**, not directly on `main`
- Branch naming: `feature/description` or `fix/description`
- Open a pull request on GitHub for review before merging
- Only deploy to production from `main`

```bash
git checkout -b feature/my-change
# make changes
git add .
git commit -m "Short description of what and why"
git push origin feature/my-change
# open PR on GitHub
```

### Adding new team members
1. Add them as a collaborator at https://github.com/HJTon/compost-monitor (Settings → Collaborators)
2. They clone and install:
   ```bash
   git clone https://github.com/HJTon/compost-monitor.git
   cd compost-monitor
   npm install
   npm run dev
   ```
3. They open Claude Code in the project folder — this file loads automatically
4. For Netlify deploys, add them to the Netlify account at https://app.netlify.com
