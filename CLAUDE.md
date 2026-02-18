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

**Always deploy via the Netlify CLI from this directory:**

```bash
netlify deploy --prod
```

This builds the app and deploys to **https://compostmonitor.netlify.app**.

> **Important:** This folder is linked to the `compostmonitor` Netlify site. Do not run `netlify link` or `netlify unlink` unless you know exactly what you're doing — it caused a cross-deployment incident previously.

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
    compost-media-upload.ts     ← Upload photo/video to Netlify Blobs
    compost-media-serve.ts      ← Serve media from Netlify Blobs
    compost-weather.ts          ← Fetch weather from Open-Meteo API

src/
  App.tsx                       ← Routes
  contexts/
    CompostContext.tsx           ← Central state: entries, sync, settings
  pages/
    DashboardPage.tsx           ← All systems overview, kill cycle status
    SystemDetailPage.tsx        ← Per-system chart + recent entries
    DailyEntryPage.tsx          ← Data entry form (probe temps, weather, etc.)
    HistoryPage.tsx             ← Browse entries by date
    LandingPage.tsx             ← App intro/install prompt
  components/
    Header.tsx
    Button.tsx
    MediaCapture.tsx            ← Photo/video capture
    TempGrid.tsx                ← 3×3 grid input for 9 probe temps
    TempStepper.tsx             ← Sequential stepper input (alternative)
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

## Kill cycle logic

- **Threshold:** 131°F (55°C) — `KILL_TEMP_F` in `config.ts`
- **Required:** 3 consecutive days above threshold — `KILL_DAYS_REQUIRED`
- Kill cycle streaks are calculated from `peakTemp` in `SystemDetailPage`
- Temperature colour coding: cold (< 100°F) → warm (100–130°F) → hot (131–160°F) → danger (> 160°F)

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
