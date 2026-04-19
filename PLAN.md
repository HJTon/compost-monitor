# Green Loop Compost Monitor - Project Plan

## Overview

Mobile-first PWA for daily compost temperature monitoring at the Green Loop farm in Taranaki. Caroline records 9 temperature probe readings per compost system across up to 8 active systems. The app replaces manual Google Sheets entry with a fast, offline-capable interface that syncs back to the same spreadsheet the Massey University scientists use (PIVOT programme).

## Architecture

- **Frontend:** React 19 + TypeScript + Vite + Tailwind CSS
- **Backend:** Netlify Functions (serverless)
- **Data:** Google Sheets API v4 (service account: `green-loop-sheets@green-loop-collections.iam.gserviceaccount.com`)
- **Media:** Google Drive API (Compost Media folder)
- **PWA:** vite-plugin-pwa + Workbox (offline support, add to home screen)
- **Storage:** IndexedDB via `idb` library (offline-first)
- **Charts:** Recharts (SVG-based, works offline)
- **Weather:** Open-Meteo API (free, no key needed, proxied via Netlify function)

**Target spreadsheet:** `1dY7TxghJegPDWUZF51QRmLhWUXVFBcdK5BYzOLsbNAo`
**Farm location:** Taranaki ~-39.06, 174.08 (configurable in Settings)
**Repo:** https://github.com/HJTon/compost-monitor
**Deployed:** compost-monitor.netlify.app

## Screens

| Screen | Route | Purpose |
|--------|-------|---------|
| Dashboard | `/` | System cards with sync status, kill cycle progress, today's status |
| Daily Entry | `/entry/:systemId` | THE primary screen - weather, moisture, odour, 9 probe temps (stepper/grid), notes, media |
| System Detail | `/system/:systemId` | Temperature trend chart, kill cycle timeline, entry history |
| History | `/history` | Browse entries by date across all systems |
| Settings | `/settings` | Entry mode, active systems, farm coordinates, manual sync |

## Netlify Functions

| Function | Purpose |
|----------|---------|
| `compost-sheets-read` | Read a sheet tab |
| `compost-sheets-write` | Append row + AVERAGE/MAX formulas |
| `compost-sheets-history` | Read + parse historical entries for charting |
| `compost-media-upload` | Upload photo/video to Google Drive |
| `compost-weather` | Proxy Open-Meteo API (CORS + server-side cache) |

## Environment Variables (Netlify)

| Variable | Value |
|----------|-------|
| `GOOGLE_SERVICE_ACCOUNT_KEY` | Same JSON key as collector app |
| `COMPOST_SPREADSHEET_ID` | `1dY7TxghJegPDWUZF51QRmLhWUXVFBcdK5BYzOLsbNAo` |
| `GOOGLE_DRIVE_FOLDER_ID` | Compost Media folder ID |

## Offline Strategy

1. All saves go to IndexedDB first (always succeeds)
2. Sync queue tracks pending writes with retry logic (max 5 retries)
3. When online: process queue immediately, write to Google Sheets
4. When offline: data safe locally, amber indicator shows pending count
5. On reconnect: auto-processes queue via `online` event listener
6. PWA service worker precaches all app files for full offline launch

## Sheet Tab Mapping

The app maps system IDs to sheet tab names:

| System ID | Sheet Tab |
|-----------|-----------|
| `pivot-1` | Pivot #1 |
| `pivot-2` | Pivot #2 |
| `pivot-3` | Pivot #3 |
| `pivot-4` | Pivot #4 |
| `carbon-cube-2` | Carbon Cube Cycle 2 |
| `cylinder-1` | Cylinder #1 |
| `cylinder-2` | Cylinder #2 |
| `cylinder-3` | Cylinder #3 |
| `batch-1` | Batch 1 |
| `batch-2` | Batch 2 |
| `batch-3` | Batch 3 |

**Important:** These tab names must match exactly in the spreadsheet.

## Row Format (written to each sheet tab)

| Col | Field |
|-----|-------|
| A | Date |
| B | Time |
| C | Weather |
| D | Ambient Min (°C) |
| E | Ambient Max (°C) |
| F | Moisture |
| G | Odour |
| H | (empty / reserved) |
| I-Q | Probe 1-9 temperatures (°F) |
| R | `=AVERAGE(I:Q)` formula |
| S | `=MAX(I:Q)` formula |
| T | Vent Temps |
| U | Visual Notes |
| V | General Notes |
| W | Media Links |

---

## Status

### Completed
- [x] Project scaffold (Vite + React + Tailwind + PWA)
- [x] TypeScript types and system configuration
- [x] IndexedDB storage layer (entries, sync queue, media, weather cache, settings)
- [x] Shared components (Button, Header, Toast, SyncStatusBar)
- [x] CompostContext with sync queue and online/offline detection
- [x] Dashboard page with system cards and kill cycle progress
- [x] Daily Entry page with stepper and grid modes
- [x] Weather auto-fill from Open-Meteo API
- [x] Temperature colour coding (blue/green/amber/red)
- [x] Auto-calculated summary (average, peak, kill cycle status)
- [x] Photo and video capture with thumbnail generation
- [x] All 5 Netlify functions
- [x] System Detail page with Recharts line chart
- [x] History page with date browser
- [x] Settings page (entry mode, active systems, coordinates, sync)
- [x] PWA manifest and service worker
- [x] GitHub repo + Netlify deploy
- [x] Fix: stepper no longer auto-scrolls past moisture/odour on page load
- [x] "Let's Build" feature — create new compost systems dynamically from the app
  - BuildPage (`/build`): fetch available bins from Bin Tracker, select bins, name build, choose probe count (3/5/9), colour, height, date
  - `compost-build-create` Netlify function: creates new Google Sheet tab with headers + formatting, assigns selected bins in Bin Tracker (cols H & I), applies colour
  - `compost-build-delete` Netlify function: unassigns bins in Bin Tracker, removes sheet tab
  - ManagePage (`/manage`): list active/retired custom builds, retire/reactivate, delete with full cleanup
  - Custom systems stored in IndexedDB (`customSystems` store, DB v2) and merged with hardcoded systems at runtime via `allSystems` in `CompostContext`
  - `addCustomSystem()`, `updateCustomSystem()`, `removeCustomSystem()`, `setSystemActive()` in `CompostContext`
  - Custom builds immediately appear in Measure (Dashboard), Analyse, and Manage screens
  - LandingPage updated with "Let's Build" and "Let's Manage" navigation buttons
- [x] Guardrails on temperature entries (DailyEntry + SampleEntry)
  - `SaveConfirmModal` component — reused for both per-probe and save-time checks
  - Flags probes left blank (skipped, save-time only) and temps outside a safe range
  - Upper limit: fixed `TEMP_UPPER_LIMIT_F` = 200°F
  - Lower limit: `getTempLowerLimitF(ambientMaxC)` = `max(50°F, ambientMaxF)` — dynamic against the ambient max on the entry; falls back to fixed 50°F when ambient is not known (e.g. SampleEntryPage)
  - **Per-probe check** — fires as soon as an extreme reading is committed:
    - `TempStepper` fires `onProbeCommit` on Next / Prev / dot-tap (for the probe being left)
    - `TempGrid` fires `onProbeCommit` on `blur` and Enter (for the cell being left)
    - `SampleEntryPage` fires on Temp input blur
    - Modal: "Check this reading" / "Let me fix it" (clears) / "Yes, keep it" (adds to confirmedValues Map so it won't re-flag on save)
    - Changing a confirmed value invalidates the confirmation and the guardrail re-runs on the next commit
  - **Save-time check** — catches skipped probes and any out-of-range value not already per-probe confirmed:
    - Modal: "Hold on — before you save" / "Go back and edit" (primary) / "Save anyway" (secondary)
    - On daily entries with skipped probes, a small bottom link offers to navigate to `/manage/:systemId` to reduce the probe count
- [x] Adjustable probe count per build
  - New "Probes" panel on BuildDetailPage (`/manage/:systemId`): – / + stepper to change `probeLabels.length` for a build (1–20)
  - Applies to future readings only — past entries keep their original probe data on the sheet
  - Warning shown when reducing: "Probes N+1–M will no longer be measured in future readings"
  - Backed by `updateCustomSystem()` in `CompostContext`, which upserts into state so the UI refreshes immediately
  - Limitation: only persists for custom builds — hardcoded `COMPOST_SYSTEMS` entries will lose changes on reload because `getSystem` prefers hardcoded definitions

### In Progress
- [ ] Verify sheet tab names match spreadsheet (sync depends on this)
- [ ] Field testing with Caroline at the farm

---

## Future TODOs

### Sample Logging ✅ BUILT

The **"Sampling Log"** tab exists on the main spreadsheet with all historical data (298 rows from the Sampling Key document, Nov 2025 – Apr 2026). The app now has a full "Log Sample" flow.

**Sheet:** `Sampling Log` tab on the main spreadsheet (`1dY7TxghJegPDWUZF51QRmLhWUXVFBcdK5BYzOLsbNAo`)

**Column structure (A–L):**
| Col | Header | Notes |
|-----|--------|-------|
| A | Date | DD/MM/YYYY |
| B | Sample ID | Sequential (S1, S2, S3…) — auto-increment per system |
| C | System | Matches system names (Pivot #1, Carbon Cube Cycle 1, etc.) |
| D | Turn | Turn number at time of sampling (blank if none) |
| E | System Height (cm) | Height at time of sampling |
| F | Probe | Probe number (1–10) or layer name for initial builds |
| G | Sub-sample | a, b, c, d — depth sub-samples (blank if single core) |
| H | Temperature (°F) | Temp at probe location |
| I | Depth (cm) | Depth the sample was taken at |
| J | Sampling Method | Auger / Layered / New tool / Dug |
| K | Handling | Storage + transport info |
| L | Notes | Free text |

**One row per probe/sub-sample** — a sampling event with 4 probes × 3 sub-samples = 12 rows. Shared fields (date, sample ID, system, method, handling) repeat on every row.

**Key design points:**
- Samples go to Massey for analysis — this is separate from the "Readiness Checks" tab (which stores lab results). The Sample ID is the join key if results need linking later.
- The "Log Sample" screen should: pick system, auto-suggest next sample ID, select probes, enter temps/depths per probe, choose method, add handling notes
- The setup function (`compost-sampling-log-setup.ts`) was a one-time migration tool — can be removed once confirmed the data is correct

**App screens:**
- **Dashboard** (`/dashboard`) — Measure/Sample tab toggle at top. Sample tab is blue-themed, shows all active systems with flask icons
- **SampleEntryPage** (`/sample/:systemId`) — blue-themed form with:
  - Auto-suggested Sample ID (fetched from `compost-sampling-next-id` function)
  - Date, turn number, system height fields
  - Sampling method selector (New tool, Auger, Layered, Dug, Other)
  - Quick-add probe buttons for common patterns (1,3,6,7 with a,b,c / 1,3,5,6,7,9 / all 7)
  - Expandable per-probe entries with temp, depth, sub-sample, notes
  - Delete button per probe for cleanup
  - Handling & transport text field
  - Writes all rows to "Sampling Log" tab via `compost-sampling-write` function

**Netlify functions:**
- `compost-sampling-write` — appends sample rows to the Sampling Log tab
- `compost-sampling-next-id` — reads column B to find the highest S-number and returns next ID

### Weather Accuracy Check
The Open-Meteo API returns weather for a grid cell around the configured coordinates (-39.06, 174.08). Need to verify:

- **Is the grid resolution fine enough for the Taranaki farm location?** Open-Meteo uses ~1km resolution for some models but coarser for others. The farm may be in a microclimate (valley, hillside, coastal) that differs from the grid forecast
- **Compare API weather vs actual conditions** over a few weeks - have Caroline note when the auto-filled weather doesn't match what she sees
- **Consider alternative weather sources** if Open-Meteo proves too coarse:
  - MetService (NZ national weather service) - may have better local data but needs API access
  - Harvest Electronics or Davis Vantage (on-site weather station) - most accurate but requires hardware
  - NIWA CliFlo data - historical/research grade but not real-time
- **Temperature accuracy** - ambient min/max from the API vs a thermometer at the farm. If they're consistently off by a few degrees, we could add a calibration offset in Settings

For now, the auto-fill values are clearly marked with an "auto" badge and Caroline can override them with what she actually observes. This is a good baseline until we know how accurate the API is at this specific location.

---

## Future Vision: Farmer/Grower Edition

A farmer-facing version of the Compost Monitor designed to make composting science accessible to growers without requiring technical expertise. This builds on the existing app's infrastructure but adds intelligent guidance, visual analysis, and a research feedback loop.

### Smart Temperature Monitoring
- **Stage-aware prompts** — the app knows which composting phase each system is in (mesophilic, thermophilic, cooling, curing) and prompts the farmer when to check temperatures based on stage and time elapsed
- **Pathogen safety alerts** — flags when temperatures haven't reached thermophilic range (55°C / 131°F) for the required duration, with plain-language explanations of what this means and what to do
- **Weather-integrated interpretation** — pulls in local weather data (ambient temperature, rainfall) and factors it into composting guidance ("temperatures dropped overnight but that's consistent with the cold snap — check again tomorrow rather than turning the pile")

### Visual Compost Analysis (AI-Powered)
- **Photo analysis** — analyse compost photos to assess colour, texture, moisture level, fungal growth (hyphal development), and decomposition stage
- **Progressive learning** — as more images get linked to lab results over time, the model improves at estimating readiness from visuals alone
- **Plain-language interpretation** — e.g. "Your compost looks like it's through the thermophilic phase but fungal colonisation looks light — leave it another couple of weeks before using"
- **Research dataset** — the photo-to-outcome dataset is genuinely valuable for composting science and could be shared (with consent) for academic research

### Input Tracking & Outcome Linking
- **Input mix recording** — ratio of greens to browns, bokashi volume, food waste types, carbon sources
- **Outcome correlation** — link input mixes to composting outcomes (time to maturity, peak temperatures achieved, final quality) so farmers can see what works best
- **Recipe suggestions** — over time, recommend input ratios based on what has produced the best results across similar systems and conditions

### Research Feedback Loop
This is the most compelling part of the concept:

1. **Research → App:** If Peter's sequencing work (or other Massey research) identifies microbial indicators of compost readiness or safety, those findings feed into the app's interpretation logic. The farmer gets useful guidance without needing to understand microbial guilds.

2. **App → Research:** Structured data flowing back from farmers using the app — temperatures, photos, inputs, outcomes — feeds directly into the research, improving the models for everyone.

3. **Circular value:** This relationship between research and practice is a strong scalability story. It addresses criteria around real-world impact and sustainability beyond funding periods. The app gets smarter as more farmers use it; the research gets richer as more structured field data comes in.

### Why This Is Buildable
- The existing Compost Monitor already handles temperature recording, weather integration, photo capture, and Google Sheets sync — the infrastructure is in place
- Recent advances in AI coding and vision models (Claude, GPT-4V etc.) make the photo analysis and plain-language interpretation feasible at low cost
- The PWA architecture means no app store barriers — farmers just open a link
- Sustainable Taranaki has the capability to build this at very low cost with AI-assisted development; Massey has the research capability to close the feedback loop
- Could be pitched as a funded project (e.g. Google.org, MBIE, Callaghan Innovation) with the circular research-practice model as a key differentiator
