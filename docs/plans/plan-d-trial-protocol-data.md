# Plan D — Fit the app to the real trial protocol

Follows plans A, B and C (all shipped). Those gave us trial stages, editing, photos, comparison
and adjustable dates — everything Caroline asked for in her email. This plan closes the gap
between what the app can store and what her protocol documents actually record.

## Source of truth

Caroline's protocol lives in four documents:
<https://drive.google.com/drive/folders/1EVc10zJd3nfZ7vKY9zMPcMSCDtqPw3JZ>

- **Stage 1** — "Quick 5 day Simple Germination Test - Mustard (Biological Sensor)". *Brassica
  juncea*, 25 seeds per pot, 3 replicates per compost, 3 control pots of seed raising mix.
  Records days to first germination, strike rate %, shoot height, root length, and any
  yellowing / distortion / stunting. **Pass = germination above 90% of the control.**
- **Stage 2** — "21 Day Simple Growth Trial - Broad Bean". *Vicia faba*, 1 seed per pot, 3
  replicates, 3 controls. Records strike rate %, days to emergence, plant height at day 21,
  number of true leaves, leaf colour, stem thickness, root length, root nodes present, root
  health, overall plant vigour (Excellent / Good / Acceptable / Borderline / Unsuitable), plus a
  visual observation checklist.
- **"Growth Pre testing"** — a pH reading per pile taken before the trials (18 July 2026),
  alongside columns for the mustard and broad bean outcomes.
- **"Potato Trail Draft Plan"** — the follow-on crop trial. **Out of scope here**; its
  variety × treatment × replicate design needs its own pass once stages 1 and 2 are working.

The piles under test are named "Pivot 1", "Cube 5", "Cylinder 3" in the documents; in the app
they are `Pivot #1`, `CC5`, `Cylinder #3`. Selection is always from the app's build list, so the
mismatch never needs resolving in data.

## The three gaps

1. **A trial holds one free-text `result` box.** The protocol records ten or more measured
   fields per pile. Entering that as a sentence loses it.
2. **Controls are not builds.** Seed raising mix, garden compost and zone 2 soil each get pots,
   and the Stage 1 pass rule is defined *relative to the control*. Our model attaches every
   trial to a build, so a control has nowhere to live and the pass rule cannot be evaluated.
3. **One test spans many piles.** Her tables are a single experiment with one start date, one
   set of controls, and a row per pile. We model isolated per-build trials, so the shared start
   date and controls would have to be retyped per pile.

## Model

Keep `GrowTrial` where it is (inside `system.grow.trials`, JSON in the Build Phases tab, so no
sheet migration). Add a **trial run**: the experiment that a per-pile trial belongs to.

### 1. New shared tab `Trial Runs` (`netlify/functions/compost-trial-runs.ts`)

Columns: `RunId | Type | StartDate | PlannedDays | SeedsSown | Controls | Notes | UpdatedAt`.
`Controls` is JSON: `[{ id, label, measurements }]`. Follow `compost-build-info.ts` for the
GET/POST/merge-patch and `ensureTabAndHeaders` shape. GET returns all runs; POST upserts one by
`RunId`. Add a DELETE-by-id path only if it falls out cheaply; otherwise leave it.

### 2. `GrowTrial` gains (all optional — legacy trials keep parsing)

```typescript
/** The protocol run this trial belongs to; standalone trials have none. */
runId?: string;
/** Pots per compost. Protocol default 3. */
replicates?: number;
/** pH of the compost at trial start ("Growth Pre testing"). */
phAtStart?: number | null;
/** Measured values, keyed by field id from TRIAL_FIELDS. */
measurements?: Record<string, number | string | boolean | null>;
/** Visual observation ids that applied, e.g. ['chlorosis', 'wilting']. */
observations?: string[];
```

### 3. `src/utils/trialFields.ts` — field definitions per trial type

One exported table driving every editor, table and print view, so the protocol lives in exactly
one place:

```typescript
export interface TrialField {
  id: string;
  label: string;
  unit?: string;                       // 'cm', 'mm', '%'
  kind: 'number' | 'text' | 'bool' | 'choice';
  choices?: readonly string[];         // for kind: 'choice'
  min?: number; max?: number;
  /** Derived, never entered — computed by `computeField` */
  derived?: boolean;
  hint?: string;
}
export const TRIAL_FIELDS: Record<TrialType, readonly TrialField[]>;
export const VISUAL_OBSERVATIONS: readonly { id: string; label: string; good?: boolean }[];
```

**germination**: `daysToFirstGermination`, `seedsSown` (default 25), `seedsGerminated`,
`strikeRatePct` (derived = germinated ÷ sown × 100), `shootHeightMm`, `rootLengthMm`,
`abnormalities` (text).

**growth-test**: `germinatedOfReplicates`, `strikeRatePct` (derived), `daysToEmergence`,
`plantHeightCm`, `trueLeaves`, `leafColour` (choice 0–5), `stemThicknessMm`, `rootLengthCm`,
`rootNodesPresent` (bool), `rootHealth` (choice), `overallVigour` (choice: Excellent, Good,
Acceptable, Borderline, Unsuitable).

**crop**: no structured fields in v1 — keep `result` free text. Potato design comes later.

**VISUAL_OBSERVATIONS**: yellowing (chlorosis), purple leaves, leaf burn, wilting, stunted
growth, poor root development, healthy white roots (`good: true`).

### 4. Pass rule

`src/utils/trials.ts` gains:

```typescript
/** Stage-1 rule: germination at or above 90% of the control passes. */
export function percentOfControl(trial, run): number | null;
export function protocolVerdict(trial, run): 'pass' | 'check' | null;
```

`null` whenever the run has no control or the trial has no strike rate — never invent a verdict
from a missing control. Surface as a small PASS / CHECK badge wherever a trial is shown.

## UI

1. **`TrialCard`** — replace the single Result box with the fields for that trial's type
   (derived fields shown read-only and live-computed), the observation checkboxes, replicates,
   pH, and the pass badge. Keep `result` as a free-text "Notes on the outcome" field underneath;
   never drop existing text.
2. **`PhaseModal` (addTrial)** — after picking the type, offer the open runs of that type
   ("Germination test, started 19 Jul, 8 piles") or "Start a new run". A new run asks only for
   start date, planned days and seeds sown; controls are added on the run page.
3. **New `/trials` index** — every run: type, start date, day N of M, piles included, how many
   have results in. Reachable from the Analyse index next to the protocol overview.
4. **New `/trials/:runId`** — *the replacement for her Word table.* Rows are the participating
   piles plus the control rows; columns are that type's fields; cells edit in place. Add-pile
   and add-control actions. Must scroll horizontally inside its own container at 375px, never
   the page body. This is the highest-value screen in the plan — build it properly.
5. **`ComparePage`** — the trials grid shows strike rate, % of control and vigour rather than
   only truncated free text.
6. **`PrintReportPage`** — measured values under each trial, not just the result sentence.

## Out of scope

- The potato trial's variety × treatment × replicate design (its own plan).
- Per-replicate measurements. The protocol's own result table records one aggregated row per
  compost, so aggregate plus a replicate count matches how it is actually filled in.
- Charting trial data over time.
- Reconciling document pile names with app build names — selection is from the build list.

## Testing

- A legacy trial (`{id, method, crop, notes?, createdAt}`) and a Plan C trial with only `result`
  must both still render and edit without losing anything.
- Derived strike rate recomputes as seeds germinated changes, and is never stored as an entered
  value.
- A run with no control shows no verdict badge at all.
- 375px: run table scrolls inside itself; page body does not.
- Public `/view/...` routes stay read-only throughout.
- `npm run build` passes.
