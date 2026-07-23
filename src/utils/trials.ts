import type { GrowTrial, TrialType, TrialRun, TrialControl } from '@/types';
import { getNZDate } from './config';
import { computeField, STRIKE_RATE_FIELD } from './trialFields';

// ── Protocol stages ──────────────────────────────────────────────────────────
//
// Caroline's standard protocol: every pile should ideally run a 5-day
// germination (phytotoxicity) test, then a 21-day broad bean growth test,
// before it goes into real crop trials.

export interface TrialTypeDef {
  id: TrialType;
  label: string;
  /** Default planned duration in days — null means open-ended */
  days: number | null;
  hint: string;
  /** Short label used in progress chips / compare columns */
  short: string;
}

export const TRIAL_TYPES: TrialTypeDef[] = [
  { id: 'germination', label: 'Germination test',        days: 5,    hint: 'Quick phytotoxicity check', short: 'Germination' },
  { id: 'growth-test', label: 'Broad bean growth test',  days: 21,   hint: 'Simple growth comparison',  short: 'Broad bean' },
  { id: 'crop',        label: 'Crop trial',              days: null, hint: 'Potatoes, pumpkin, …',      short: 'Crop trials' },
];

/** Crop prefilled for the broad bean growth test. */
export const BROAD_BEAN_CROP = 'Broad bean';

export function trialTypeDef(type: TrialType): TrialTypeDef {
  return TRIAL_TYPES.find(t => t.id === type) || TRIAL_TYPES[2];
}

/** Legacy trials (no `trialType`) are crop trials. */
export function trialTypeOf(t: GrowTrial): TrialType {
  return t.trialType ?? 'crop';
}

/** Trial start date (YYYY-MM-DD). Legacy trials fall back to `createdAt`. */
export function trialStart(t: GrowTrial): string {
  return t.startedAt || (t.createdAt || '').slice(0, 10);
}

/** Badge colours — purple family, a distinct shade per protocol stage. */
export const TRIAL_TYPE_BADGE: Record<TrialType, string> = {
  'germination': 'bg-purple-100 text-purple-700 border-purple-200',
  'growth-test': 'bg-violet-100 text-violet-700 border-violet-200',
  'crop':        'bg-fuchsia-100 text-fuchsia-700 border-fuchsia-200',
};

// ── Status derivation ────────────────────────────────────────────────────────

export type TrialState = 'complete' | 'running' | 'overdue' | 'unknown';

export interface TrialStatus {
  state: TrialState;
  /** Chip text, e.g. "Day 3 of 5", "Complete · 6 days" */
  label: string;
  /** Compact chip text for dense grids, e.g. "day 3/5" */
  shortLabel: string;
  /** Tailwind classes for the status chip */
  chipClass: string;
  /** 1-based day number (start day = Day 1). Null when the date is unusable. */
  day: number | null;
  plannedDays: number | null;
}

/** Whole days from isoFrom → isoTo. Null if either date is unparseable. */
export function dayDiff(isoFrom: string, isoTo: string): number | null {
  if (!isoFrom || !isoTo) return null;
  const a = Date.parse(`${isoFrom.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${isoTo.slice(0, 10)}T00:00:00Z`);
  if (isNaN(a) || isNaN(b)) return null;
  return Math.floor((b - a) / 86_400_000);
}

/**
 * Status of a trial:
 *   `endedAt` set        → Complete
 *   `plannedDays` set    → "Day N of M" (overdue styling when N > M)
 *   otherwise            → "Day N"
 */
export function trialStatus(t: GrowTrial, today: string = getNZDate()): TrialStatus {
  const planned = t.plannedDays ?? null;
  const start = trialStart(t);

  if (t.endedAt) {
    const span = dayDiff(start, t.endedAt);
    const days = span !== null ? Math.max(1, span + 1) : null;
    return {
      state: 'complete',
      label: days !== null ? `Complete · ${days} day${days === 1 ? '' : 's'}` : 'Complete',
      shortLabel: 'complete',
      chipClass: 'bg-green-100 text-green-700 border-green-200',
      day: days,
      plannedDays: planned,
    };
  }

  const diff = dayDiff(start, today);
  if (diff === null) {
    return {
      state: 'unknown',
      label: 'In progress',
      shortLabel: 'running',
      chipClass: 'bg-gray-100 text-gray-600 border-gray-200',
      day: null,
      plannedDays: planned,
    };
  }

  const day = Math.max(1, diff + 1);

  if (planned && planned > 0) {
    const overdue = day > planned;
    return {
      state: overdue ? 'overdue' : 'running',
      label: overdue ? `Day ${day} of ${planned} · overdue` : `Day ${day} of ${planned}`,
      shortLabel: `day ${day}/${planned}`,
      chipClass: overdue
        ? 'bg-amber-100 text-amber-700 border-amber-200'
        : 'bg-blue-100 text-blue-700 border-blue-200',
      day,
      plannedDays: planned,
    };
  }

  return {
    state: 'running',
    label: `Day ${day}`,
    shortLabel: `day ${day}`,
    chipClass: 'bg-blue-100 text-blue-700 border-blue-200',
    day,
    plannedDays: null,
  };
}

// ── Protocol progress ────────────────────────────────────────────────────────

export interface ProtocolStage {
  def: TrialTypeDef;
  trials: GrowTrial[];
  /** At least one trial of this type has an endedAt */
  done: boolean;
  /** First still-running trial of this type, if any */
  running: GrowTrial | null;
}

export function trialsOfType(trials: GrowTrial[], type: TrialType): GrowTrial[] {
  return trials.filter(t => trialTypeOf(t) === type);
}

export function protocolProgress(trials: GrowTrial[]): ProtocolStage[] {
  return TRIAL_TYPES.map(def => {
    const list = trialsOfType(trials, def.id);
    return {
      def,
      trials: list,
      done: list.some(t => !!t.endedAt),
      running: list.find(t => !t.endedAt) || null,
    };
  });
}

/** Used for the non-blocking "germination usually comes first" nudge. */
export function hasCompletedGermination(trials: GrowTrial[]): boolean {
  return trialsOfType(trials, 'germination').some(t => !!t.endedAt);
}

/** Newest-first by start date — the order trial cards are listed in. */
export function sortTrials(trials: GrowTrial[]): GrowTrial[] {
  return [...trials].sort((a, b) => trialStart(b).localeCompare(trialStart(a)));
}

// ── Pass rule (relative to the run's control) ────────────────────────────────
//
// Stage 1 of the protocol passes a compost when its germination reaches 90% of
// the control's. The control is not a build — it lives on the `TrialRun` — so
// every function here needs the run, and returns null without it. A missing
// control means "no verdict", never "fail".

/** Stage-1 rule: germination at or above 90% of the control passes. */
export const PASS_THRESHOLD_PCT = 90;

/** Strike rate % from a measurement set, derived — never read from storage. */
function strikeRateOf(
  measurements: GrowTrial['measurements'],
  replicates: number | null,
  runSeedsSown: number | null,
): number | null {
  return computeField(STRIKE_RATE_FIELD, measurements, {
    replicates,
    seedsSown: runSeedsSown,
  });
}

/** Strike rate % for one pile's trial, or null when it hasn't been recorded. */
export function trialStrikeRate(trial: GrowTrial, run?: TrialRun | null): number | null {
  return strikeRateOf(trial.measurements, trial.replicates ?? null, run?.seedsSown ?? null);
}

/**
 * Strike rate % for a single control row, or null when it has none.
 *
 * A germination control needs `seedsGerminated` (its `seedsSown` falls back to
 * the run's). A growth-test control needs `germinatedOfReplicates` plus a
 * `replicates` measurement — controls aren't trials, so there is no
 * `GrowTrial.replicates` to borrow.
 */
export function controlStrikeRate(control: TrialControl, run?: TrialRun | null): number | null {
  return strikeRateOf(control.measurements, null, run?.seedsSown ?? null);
}

/**
 * The run's baseline strike rate: the MEAN of every control that has a usable
 * one. A run commonly carries several controls (seed raising mix, garden
 * compost, zone 2 soil); the protocol compares against "the control", so
 * averaging them keeps one duff control row from swinging every verdict.
 *
 * Null when the run has no controls, or no control has a usable strike rate.
 */
export function runControlStrikeRate(run: TrialRun | null | undefined): number | null {
  if (!run || run.controls.length === 0) return null;
  const rates = run.controls
    .map(c => controlStrikeRate(c, run))
    .filter((r): r is number => r !== null);
  if (rates.length === 0) return null;
  const mean = rates.reduce((sum, r) => sum + r, 0) / rates.length;
  return Math.round(mean * 10) / 10;
}

/**
 * This trial's strike rate as a percentage of the run's control, to one decimal
 * place. Null when there is no run, no control, no usable control strike rate,
 * the control rate is 0, or the trial has no strike rate of its own.
 */
export function percentOfControl(
  trial: GrowTrial,
  run: TrialRun | null | undefined,
): number | null {
  const control = runControlStrikeRate(run);
  if (control === null || control === 0) return null;
  const mine = trialStrikeRate(trial, run);
  if (mine === null) return null;
  return Math.round((mine / control) * 1000) / 10;
}

/**
 * PASS at or above 90% of the control, CHECK below it. Null whenever
 * `percentOfControl` is null — a verdict is never invented from a missing
 * control, so callers should render no badge at all in that case.
 */
export function protocolVerdict(
  trial: GrowTrial,
  run: TrialRun | null | undefined,
): 'pass' | 'check' | null {
  const pct = percentOfControl(trial, run);
  if (pct === null) return null;
  return pct >= PASS_THRESHOLD_PCT ? 'pass' : 'check';
}

/** Badge colours for the pass/check verdict. */
export const VERDICT_BADGE: Record<'pass' | 'check', string> = {
  pass:  'bg-green-100 text-green-700 border-green-200',
  check: 'bg-amber-100 text-amber-700 border-amber-200',
};
