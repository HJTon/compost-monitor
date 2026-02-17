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

### In Progress
- [ ] Verify sheet tab names match spreadsheet (sync depends on this)
- [ ] Field testing with Caroline at the farm

---

## Future TODOs

### Flexible Compost System Setup
Currently the 8 systems are hardcoded in `src/utils/config.ts` with a fixed 9-probe layout. Need to make this configurable so Caroline or an admin can:

- **Add new compost builds** from within the app (or a simple admin screen)
- **Configure probe count per system** - not all systems need 9 temperature measurement points. Some may have 3, 5, or 6 probes
- **Name/label probes** - different systems may have different probe positions (e.g. a small batch might just have "Top", "Middle", "Bottom")
- **Set the grid layout** per system - a 3-probe system shouldn't show a 3x3 grid
- **Create a matching sheet tab** automatically when a new system is added (or prompt the user to create one)
- **Archive/deactivate** old builds without deleting their data

This likely means:
1. Moving system definitions from hardcoded config into IndexedDB/Settings
2. A "Manage Systems" screen in Settings where you can add/edit/archive systems
3. Updating TempStepper and TempGrid to handle variable probe counts
4. Updating the sheet write function to handle variable column counts

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
