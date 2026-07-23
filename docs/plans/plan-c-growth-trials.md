# Plan C — Growth trials: protocol stages, editing, photos, and comparison

**Run after Plan A and Plan B** (same session ideally). No hard code dependency on either, but Plan A establishes the date-edit panel pattern this plan reuses, and Plan B's "Growing" vitals tile becomes the jump-off point to this plan's Grow Trials section.

## Why — Caroline's asks, decoded

1. **A standard trial protocol**: every pile should ideally run (1) a quick **5-day germination trial** (phytotoxicity check) and (2) a **21-day broad bean growth test** before progressing to real crop trials (potatoes first, others to follow). Many piles × many crops.
2. **"PC1 was placed into growth trial and I think I added some details but can't seem to access this"** — accurate. Trials are currently **write-only**: created via the purple PhaseModal, then shown only as a one-line chip (`method · crop`) in the Manage page's Grow section (`ManagePage.tsx:1061-1086`), with delete as the only action. No detail view, no editing, no dates displayed, nothing on the Analyse page. Her PC1 details are safely stored (Build Phases sheet tab, `GrowJSON` column) — they're just unreachable in the UI.
3. The purple grow-trial modal (crop/method dropdowns with add-your-own) **is liked — keep it**, extend it.
4. **Photos per trial.**
5. **"Let's Compare" for growth trials** — she suggested either "below the compost performance" on the existing compare, or a clean standalone. Do the former first (see step 6).
6. **Adjustable dates** — trial dates and phase-transition dates.

## Current state (verified)

- `GrowTrial` in `src/types/index.ts`: `{ id, method, crop, notes?, createdAt }`. Lives inside `GrowInfo { startedAt, trials[] }` on the system, persisted as JSON in the **Build Phases** tab (`GrowJSON` column) via `netlify/functions/compost-build-phase.ts`. **Extending the type needs no sheet migration** — it's JSON.
- Write path: `setSystemPhase(id, 'grow', { grow, transitionNote? })` in `CompostContext.tsx` (~line 592) — this is also how `ManagePage.handleRemoveTrial` (~line 561) rewrites the trials array. Reuse it for edits.
- Creation UI: `src/components/PhaseModal.tsx`, `mode: 'addTrial'` — date input (back-datable), Method + Crop `EditableSelect`s (custom options persist to settings), notes textarea.
- Photo infra: **Media** sheet tab rows are keyed by `System` (display name) + `Slot` (free-text string) — so per-trial photo slots need **no backend change**. `InlinePhotoSlot` (`src/components/InlinePhotoSlot.tsx`) is self-fetching: `<InlinePhotoSlot systemName={...} slotId={...} />`. Canonical tags live in `src/utils/photoSlots.ts`.
- `src/pages/ComparePage.tsx`: day-aligned temperature curves + a readiness-check comparison for selected builds. No trial data.
- Defaults: `DEFAULT_TRIAL_METHODS` / `DEFAULT_TRIAL_CROPS` in `src/utils/config.ts`.

## Steps

### 1. Extend `GrowTrial` (`src/types/index.ts`)

```typescript
export type TrialType = 'germination' | 'growth-test' | 'crop';

export interface GrowTrial {
  id: string;
  method: string;
  crop: string;
  notes?: string;
  createdAt: string;
  /** Protocol stage — undefined on legacy trials, treat as 'crop' */
  trialType?: TrialType;
  /** Trial start (YYYY-MM-DD). Legacy fallback: createdAt.slice(0, 10) */
  startedAt?: string;
  /** Planned duration in days (5 germination, 21 growth test, null = open-ended) */
  plannedDays?: number | null;
  /** Set when the trial is finished (YYYY-MM-DD) */
  endedAt?: string;
  /** Outcome summary, e.g. "18/20 germinated, no leaf distortion" */
  result?: string;
}
```

All new fields optional → PC1's existing trial and any others parse untouched. Add a tiny helper (in `utils/config.ts` or a new `utils/trials.ts`):

```typescript
export const TRIAL_TYPES = [
  { id: 'germination', label: 'Germination test', days: 5,  hint: 'Quick phytotoxicity check' },
  { id: 'growth-test', label: 'Broad bean growth test', days: 21, hint: 'Simple growth comparison' },
  { id: 'crop',        label: 'Crop trial', days: null, hint: 'Potatoes, pumpkin, …' },
] as const;
export const trialStart = (t: GrowTrial) => t.startedAt ?? t.createdAt.slice(0, 10);
export const trialTypeOf = (t: GrowTrial): TrialType => t.trialType ?? 'crop';
```

Plus a status derivation used everywhere (card, Analyse, Compare): `endedAt` set → **Complete**; else if `plannedDays` → **Day N of M** (N = days since start + 1, clamp) and **Overdue**-ish styling when N > M; else → **Day N**.

### 2. PhaseModal — trial type first

In `mode: 'addTrial'` (`PhaseModal.tsx:199-241`), add a **Trial type** selector (three tappable option rows from `TRIAL_TYPES`, showing label + hint + default duration) above Method/Crop:

- Selecting germination/growth-test prefills `plannedDays` (5 / 21) into a small editable number input ("Planned days"); crop trial leaves it blank.
- For `growth-test`, prefill Crop to "Broad bean" (add to `DEFAULT_TRIAL_CROPS` if missing); still changeable.
- The existing date input now saves to `startedAt` (keep writing `createdAt` too).
- Non-blocking protocol nudge: when the build has no **completed germination** trial and the user picks growth-test/crop, show a small info line — "Tip: the 5-day germination test usually comes first" — never block.

### 3. New component `src/components/TrialCard.tsx` — view + edit (fixes the PC1 problem)

An expandable card replacing the one-line chip, used in **both** ManagePage's Grow section and the new Analyse section (step 4). Props: `{ system, trial, readOnly, onChange(nextTrial), onRemove? }`.

- **Collapsed**: trial-type badge (purple family, distinct shade per type), `crop · method`, status chip (from step 1's derivation), start date.
- **Expanded (readOnly=false)**: editable Method/Crop (`EditableSelect`, same options as PhaseModal), **Start date** and **End date** (`<input type="date">`), Planned days, Notes, **Result** textarea, and a **"Mark complete"** button (sets `endedAt` to today, focuses the Result field). This is Caroline's "adjustable dates" for trials.
- **Photos**: `<InlinePhotoSlot systemName={system.name} slotId={'trial-' + trial.id} heightClass="h-48" />` inside the expanded card. DrivePicker already offers camera/upload + Drive picking. Add `'trial'` to the canonical tag list in `src/utils/photoSlots.ts` so these uploads are tagged for any future auto-routing.
- Saving: parent builds the next `GrowInfo` (map over `trials`, replace the edited one) and calls `setSystemPhase(system.id, 'grow', { grow: next })`. Debounce or save-on-blur per field group; a single explicit Save button in the expanded card is fine and simpler — prefer that.
- ManagePage: swap the chip markup (`ManagePage.tsx:1063-1084`) for `TrialCard`; keep `handleRemoveTrial` wired to `onRemove` (keep its existing confirm behaviour if any).

### 4. "Growth Trials" section on the Analyse page

New section in `SystemAnalysePage.tsx`, placed **after the Readiness section and before the Soil/Harvest sections** (it's the narrative step between "compost is ready" and "here's what it grew"). Render only when `system.phase === 'grow'` or trials exist.

- Header: "Growth Trials" + **protocol progress chips**: `Germination ✓/–` · `Broad bean ✓/–` · `Crop trials (n)` — ✓ when a trial of that type has `endedAt`, an in-progress marker (e.g. "day 3/5") when one is running. This is the at-a-glance answer to "all piles should do 1 and 2 first".
- Body: `TrialCard` list, `readOnly={isPublicView}`.
- An "+ Add trial" button (not in public view) opening `PhaseModal` in `addTrial` mode — import it here; it's currently only used by ManagePage.
- Plan B's vitals "Growing" tile: make it scroll to this section (`ref` + `scrollIntoView`) — one-line change in `BuildVitals` usage.
- `PrintReportPage.tsx`: compact static trial list (type, crop, dates, status, result) — no photos needed in v1 print.

### 5. Adjustable phase dates (maturation / grow started)

Same pattern as Plan A's Build-date panel, on `BuildDetailPage.tsx`: a "Phase dates" panel showing, when applicable, **Maturation started** and **Grow started** date inputs. Save via `setSystemPhase(system.id, system.phase, { maturation: {...system.maturation, startedAt}, grow: {...system.grow, startedAt} })` — patch only what changed, no transition note. (These dates drive Plan B's "days to maturation" tile and the chart's maturation reference line at `SystemAnalysePage.tsx:925`, so a wrong entry is now user-fixable.)

### 6. Growth trials in "Let's Compare"

Extend `ComparePage.tsx` — **below the existing readiness comparison** (Caroline's "just added below the compost performance" option):

- Render when ≥1 selected build has trials. Grid: one row per build, columns grouped by trial type (Germination / Broad bean / Crops). Each cell: crop, start → end (or "day N"), status chip, result text (truncated with `title`), and a link "View →" to `/analyse/:id`'s trial section.
- Data is already client-side (`allSystems` from context carries `grow`) — **no new fetches needed** for v1.
- **Stretch, not v1**: photo thumbnails in compare cells (would need per-system Media fetches — defer), and a clean standalone grow-compare page. If the section proves useful, the standalone page is a later extraction.

## Out of scope

- Structured lab-style scoring (germination counts as fields, height measurements over time) — the free-text `result` plus photos covers the current need; revisit if Caroline wants charted trial data.
- Standalone grow-compare page (deferred, see step 6).
- Caroline's Drive folder of trial protocol docs — that's reference material, not app data. The protocol lives in the app only as the three `TRIAL_TYPES`. If she wants the protocol text in-app later, it can go in trial-type hints.

## PC1 data repair

None needed. Whatever she entered for PC1 is in the Build Phases tab (`GrowJSON`) and will appear in the new TrialCards automatically. If she believes something is missing after this ships, check that sheet cell's JSON directly before assuming data loss.

## Testing / verification

- Legacy trial (no new fields) renders as a 'crop' type with dates falling back to `createdAt` — verify with PC1's real data pattern (create one via the old shape locally if needed).
- Add each trial type; check status chips at day boundaries (start day = "Day 1"), mark-complete flow, date edits round-tripping through Build Phases sync (second device / fresh IndexedDB pulls the edit).
- Trial photos: upload via camera on mobile width (375px), confirm the Media tab row gets `Slot = trial-<id>` and the photo reappears after reload.
- Public view `/view/:systemId`: cards read-only, no add/edit/photo-upload controls.
- Compare: two builds with overlapping trial types; one build with none (row still renders sensibly).
- `npm run build` passes; deploy only after Joe confirms.
