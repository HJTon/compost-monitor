import type {
  SizeBand,
  TrialControl,
  TrialCount,
  TrialPot,
  TrialRun,
  TrialRunSettings,
  GrowTrial,
} from '@/types';
import type { TrialField } from './trialFields';
import { dayDiff } from './trials';

// ── The pot-level mustard assay ──────────────────────────────────────────────
//
// Every one of Caroline's three spreadsheets is one row per pot, so the pot —
// not the compost — is the unit of observation. This module holds the whole
// assay: what gets recorded on a pot, and every number derived from a set of
// them.
//
// It merges two sources:
//   Green_Loop_Mustard_Performance_Assessment.xlsx — size-class distribution,
//     root descriptors, control comparison and the verdict ladder;
//   Green_Loop_Mustard_Trial_ALIGNED.xlsm — dated cumulative germination counts
//     with days-in derived from the sowing date.
//
// Nothing aggregate is ever stored. Treatment-level figures are recomputed on
// read by `treatmentSummary`, so a stale rollup can't survive an edit.

// ── Protocol defaults ────────────────────────────────────────────────────────

/**
 * Replicate pots per treatment. The protocol document ("Quick 5 day Simple
 * Germination Test", rev. 28 Aug 2026) specifies 5 per compost and 5 control
 * pots of seed raising mix.
 */
export const DEFAULT_POTS_PER_TREATMENT = 5;

/** Seeds per pot — 25 oriental mustard, evenly sown. */
export const DEFAULT_SEEDS_SOWN = 25;

/**
 * Relative-performance threshold for new runs, as a percentage of the control.
 * The Performance Assessment sheet uses 80% and makes it editable.
 */
export const DEFAULT_PASS_THRESHOLD_PCT = 80;

/**
 * Threshold for runs with no stored setting. The original protocol document
 * says ">90% of the control", which is what the app scored against before
 * pots existed — so leaving it at 90 means no historic verdict silently flips.
 */
export const LEGACY_PASS_THRESHOLD_PCT = 90;

/**
 * Whole-seedling length bands, root tip → shoot tip.
 *
 * The Performance Assessment sheet deliberately leaves these blank ("___ to
 * ___ cm") for the site to fix before scoring, so these are only a starting
 * point — they are editable per run and should be set once Caroline has
 * measured a batch.
 */
export const DEFAULT_SIZE_BANDS: SizeBand[] = [
  { cls: 1, minCm: null, maxCm: 5 },
  { cls: 2, minCm: 5, maxCm: 10 },
  { cls: 3, minCm: 10, maxCm: 15 },
  { cls: 4, minCm: 15, maxCm: null },
];

/** "under 5 cm", "5–10 cm", "over 15 cm" — the band, in words. */
export function bandLabel(band: SizeBand): string {
  if (band.minCm === null && band.maxCm === null) return 'any length';
  if (band.minCm === null) return `under ${band.maxCm} cm`;
  if (band.maxCm === null) return `over ${band.minCm} cm`;
  return `${band.minCm}–${band.maxCm} cm`;
}

// ── Field ids ────────────────────────────────────────────────────────────────

/** Count of seedlings in size class N. Classes are `sizeClass1`…`sizeClass4`. */
export const sizeClassField = (cls: number) => `sizeClass${cls}`;

/** Intact seedlings that couldn't be classified — snapped in the wash. */
export const BROKEN_FIELD = 'brokenUnclassifiable';

/** Endpoint date — when the pots were actually pulled apart and measured. */
export const ENDPOINT_DATE_FIELD = 'endpointDate';

export const LATERAL_ROOTS_FIELD = 'lateralRoots';
export const ROOT_INTEGRITY_FIELD = 'rootIntegrity';
export const ROOT_COLOUR_FIELD = 'rootColour';
export const LEAF_STAGE_FIELD = 'leafStage';

/** Symptom fields. A pot is "stressed" when any of these is Moderate or Severe. */
export const SYMPTOM_FIELDS = ['yellowing', 'distortion', 'stunting'] as const;

/** Controlled vocabularies, verbatim from the Performance Assessment sheet. */
export const LATERAL_ROOT_CHOICES = ['Sparse', 'Branched', 'Dense/fibrous'] as const;
export const ROOT_INTEGRITY_CHOICES = ['Robust', 'Some breakage', 'Fragile'] as const;
export const SYMPTOM_CHOICES = ['None', 'Mild', 'Moderate', 'Severe'] as const;
export const ROOT_COLOUR_CHOICES = ['White / healthy', 'Some browning', 'Browning / necrotic'] as const;

/**
 * Leaf stage rather than a prescribed assessment day. Caroline: "have staging
 * of the leaf development, two leaf, four leaf, as the user will get to it when
 * they can really than being prescriptive."
 */
export const LEAF_STAGE_CHOICES = ['Cotyledon', '2-leaf', '4-leaf', 'Beyond 4-leaf'] as const;

/**
 * Endpoint fields recorded on each pot, in entry order.
 *
 * The size-class counts are generated from the run's bands rather than listed
 * here, because their labels depend on the boundaries the site chose — see
 * `potFields`.
 */
const POT_ENDPOINT_FIELDS: readonly TrialField[] = [
  {
    id: ENDPOINT_DATE_FIELD,
    label: 'Endpoint date',
    kind: 'text',
    hint: 'The day this pot was pulled apart and measured',
  },
  {
    id: LEAF_STAGE_FIELD,
    label: 'Leaf stage',
    kind: 'choice',
    choices: LEAF_STAGE_CHOICES,
  },
  {
    id: 'leafSpanCm',
    label: 'Leaf span',
    unit: 'cm',
    kind: 'number',
    min: 0,
    hint: 'Looking straight down, the widest span across all leaves — not diagonal, not leaf length',
  },
  {
    id: 'shootHeightCm',
    label: 'Shoot height',
    unit: 'cm',
    kind: 'number',
    min: 0,
    hint: 'Compost surface to growing point',
  },
  {
    id: 'rootLengthCm',
    label: 'Root length',
    unit: 'cm',
    kind: 'number',
    min: 0,
    hint: 'Root–shoot junction to the tip of the longest root',
  },
  {
    id: LATERAL_ROOTS_FIELD,
    label: 'Lateral roots',
    kind: 'choice',
    choices: LATERAL_ROOT_CHOICES,
    hint: 'Sparse = mostly main root · Branched = clear laterals · Dense/fibrous = lots of fine roots',
  },
  {
    id: ROOT_INTEGRITY_FIELD,
    label: 'Root integrity',
    kind: 'choice',
    choices: ROOT_INTEGRITY_CHOICES,
    hint: 'How the roots held up to gentle washing. Extraction technique can cause breakage too.',
  },
  {
    id: ROOT_COLOUR_FIELD,
    label: 'Root colour',
    kind: 'choice',
    choices: ROOT_COLOUR_CHOICES,
    hint: 'A visual flag, not a primary outcome',
  },
  { id: 'yellowing',  label: 'Yellowing',  kind: 'choice', choices: SYMPTOM_CHOICES },
  { id: 'distortion', label: 'Distortion', kind: 'choice', choices: SYMPTOM_CHOICES },
  { id: 'stunting',   label: 'Stunting',   kind: 'choice', choices: SYMPTOM_CHOICES },
];

/**
 * Every field recorded on a pot: the size-class counts for this run's bands,
 * the broken bucket, then the endpoint observations.
 */
export function potFields(run: TrialRun | null | undefined): TrialField[] {
  const bands = runSizeBands(run);
  const classFields: TrialField[] = bands.map(b => ({
    id: sizeClassField(b.cls),
    label: `Class ${b.cls}`,
    kind: 'number' as const,
    min: 0,
    hint: `Intact seedlings ${bandLabel(b)} (root tip → shoot tip)`,
  }));
  classFields.push({
    id: BROKEN_FIELD,
    label: 'Broken',
    kind: 'number',
    min: 0,
    hint: "Seedlings that snapped or couldn't be classified",
  });
  return [...classFields, ...POT_ENDPOINT_FIELDS];
}

// ── Run settings, with defaults applied ──────────────────────────────────────

function settingsOf(run: TrialRun | null | undefined): TrialRunSettings {
  return run?.settings || {};
}

export function runPotCount(run: TrialRun | null | undefined): number {
  const n = settingsOf(run).potsPerTreatment;
  return typeof n === 'number' && n > 0 ? Math.floor(n) : DEFAULT_POTS_PER_TREATMENT;
}

export function runSizeBands(run: TrialRun | null | undefined): SizeBand[] {
  const bands = settingsOf(run).sizeBands;
  return Array.isArray(bands) && bands.length > 0 ? bands : DEFAULT_SIZE_BANDS;
}

/** Shared count dates for the run, oldest first. */
export function runObservationDates(run: TrialRun | null | undefined): string[] {
  const dates = settingsOf(run).observationDates;
  if (!Array.isArray(dates)) return [];
  return [...new Set(dates.filter(d => typeof d === 'string' && d))].sort();
}

/**
 * The run's relative-performance threshold. Runs saved before the setting
 * existed fall back to 90, so their verdicts don't move.
 */
export function runThreshold(run: TrialRun | null | undefined): number {
  const n = settingsOf(run).passThresholdPct;
  return typeof n === 'number' && n > 0 ? n : LEGACY_PASS_THRESHOLD_PCT;
}

/** True once this run has been taken to pot level. */
export function isPotLevel(run: TrialRun | null | undefined): boolean {
  return !!run?.settings && run.settings.potsPerTreatment != null;
}

// ── Pot access ───────────────────────────────────────────────────────────────

function toNum(value: unknown): number | null {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** An empty pot, numbered. */
export function blankPot(pot: number): TrialPot {
  return { pot, counts: [], measurements: {} };
}

/**
 * This treatment's pots, padded out to the run's pot count and in pot order.
 *
 * Stored pots always win; padding only ever adds empty ones, so raising the
 * pot count mid-run can't disturb what's already recorded, and lowering it
 * doesn't delete anything (the extra pots simply stop being rendered by
 * callers that slice to `runPotCount`).
 */
export function potsOf(
  owner: { pots?: TrialPot[] } | null | undefined,
  run: TrialRun | null | undefined,
): TrialPot[] {
  const stored = owner?.pots ?? [];
  const wanted = Math.max(runPotCount(run), stored.length);
  const byNumber = new Map(stored.map(p => [p.pot, p]));
  const out: TrialPot[] = [];
  for (let i = 1; i <= wanted; i++) out.push(byNumber.get(i) || blankPot(i));
  return out;
}

/** Seeds sown in this pot — its own figure, else the run's. */
export function potSeedsSown(pot: TrialPot, run: TrialRun | null | undefined): number | null {
  return toNum(pot.seedsSown) ?? toNum(run?.seedsSown) ?? null;
}

/** Counts oldest first. */
export function sortedCounts(pot: TrialPot): TrialCount[] {
  return [...(pot.counts || [])]
    .filter(c => c && typeof c.date === 'string' && c.date && toNum(c.count) !== null)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** The count recorded on `date`, or null if the pot wasn't assessed that day. */
export function countOn(pot: TrialPot, date: string): number | null {
  const hit = (pot.counts || []).find(c => c.date === date);
  return hit ? toNum(hit.count) : null;
}

/**
 * Final germination for a pot: the highest cumulative count recorded.
 *
 * MAX rather than "last", matching the ALIGNED sheet — a later count can dip
 * when a seedling collapses, and that shouldn't reduce the number that
 * germinated. Null when the pot has never been assessed; 0 is a real result.
 */
export function finalGerminated(pot: TrialPot): number | null {
  const counts = sortedCounts(pot);
  if (counts.length === 0) return null;
  return counts.reduce((max, c) => Math.max(max, Number(c.count)), 0);
}

/** Germination % for one pot, or null when it hasn't been assessed. */
export function potGerminationPct(pot: TrialPot, run: TrialRun | null | undefined): number | null {
  const germinated = finalGerminated(pot);
  const sown = potSeedsSown(pot, run);
  if (germinated === null || sown === null || sown === 0) return null;
  return Math.round((germinated / sown) * 1000) / 10;
}

/**
 * Days from sowing to the first count above zero, or null when nothing has
 * germinated yet. This is the ALIGNED sheet's "speed of germination" — the
 * email keeps it ("Does compost delay germination even if seeds eventually
 * emerge?").
 */
export function daysToFirstGermination(
  pot: TrialPot,
  run: TrialRun | null | undefined,
): number | null {
  const sow = run?.startDate;
  if (!sow) return null;
  const first = sortedCounts(pot).find(c => Number(c.count) > 0);
  if (!first) return null;
  return dayDiff(sow, first.date);
}

// ── Per-pot checks ───────────────────────────────────────────────────────────

/** Total seedlings sorted into size classes, including the broken bucket. */
export function classifiedTotal(pot: TrialPot, run: TrialRun | null | undefined): number {
  const m = pot.measurements || {};
  let total = 0;
  for (const band of runSizeBands(run)) total += toNum(m[sizeClassField(band.cls)]) ?? 0;
  return total + (toNum(m[BROKEN_FIELD]) ?? 0);
}

export type CountCheck = 'ok' | 'mismatch' | 'pending';

/** True when not one size-class box on this pot has been filled in. */
function unsorted(pot: TrialPot, run: TrialRun | null | undefined): boolean {
  const m = pot.measurements || {};
  const ids = [...runSizeBands(run).map(b => sizeClassField(b.cls)), BROKEN_FIELD];
  return ids.every(id => m[id] === undefined || m[id] === null || m[id] === '');
}

/**
 * Does the size-class breakdown account for every seedling that germinated?
 *
 * Three states, and the distinction between the last two matters: `mismatch` is
 * a data error somebody has to reconcile, `pending` is simply work not started.
 * Flagging an unsorted pot as an error would put a warning on every pot the
 * moment it was counted, which is most of the run's life.
 *
 * Mirrors the sheet's "OK" / "CHECK COUNTS".
 */
export function countCheck(pot: TrialPot, run: TrialRun | null | undefined): CountCheck {
  const germinated = finalGerminated(pot);
  if (germinated === null) return 'pending';
  // Nothing came up, so there is nothing to sort — that pot is finished.
  if (germinated === 0) return classifiedTotal(pot, run) === 0 ? 'ok' : 'mismatch';
  if (unsorted(pot, run)) return 'pending';
  return classifiedTotal(pot, run) === germinated ? 'ok' : 'mismatch';
}

/** True when any symptom field on this pot reads Moderate or Severe. */
export function isStressed(pot: TrialPot): boolean {
  const m = pot.measurements || {};
  return SYMPTOM_FIELDS.some(f => m[f] === 'Moderate' || m[f] === 'Severe');
}

export type PotFlag = 'none' | 'no-germination' | 'check-data' | 'stress' | 'counted' | 'observed';

/**
 * The sheet's pot flag, in precedence order: nothing germinated beats a data
 * problem, which beats a stress signal. `counted` sits between — the pot has
 * its germination number but hasn't been pulled apart yet.
 */
export function potFlag(pot: TrialPot, run: TrialRun | null | undefined): PotFlag {
  const germinated = finalGerminated(pot);
  if (germinated === null) return 'none';
  if (germinated === 0) return 'no-germination';
  const check = countCheck(pot, run);
  if (check === 'mismatch') return 'check-data';
  if (isStressed(pot) || pot.measurements?.[ROOT_INTEGRITY_FIELD] === 'Fragile') return 'stress';
  if (check === 'pending') return 'counted';
  return 'observed';
}

export const POT_FLAG_LABEL: Record<PotFlag, string> = {
  'none': '',
  'no-germination': 'No germination',
  'check-data': 'Check counts',
  'stress': 'Stress flag',
  'counted': 'Counted',
  'observed': 'Observed',
};

export const POT_FLAG_CLASS: Record<PotFlag, string> = {
  'none': 'text-gray-300',
  'no-germination': 'bg-red-100 text-red-700 border-red-200',
  'check-data': 'bg-orange-100 text-orange-700 border-orange-200',
  'stress': 'bg-amber-100 text-amber-700 border-amber-200',
  'counted': 'bg-blue-50 text-blue-700 border-blue-200',
  'observed': 'bg-green-100 text-green-700 border-green-200',
};

// ── Treatment rollup ─────────────────────────────────────────────────────────

export interface TreatmentSummary {
  pots: TrialPot[];
  /** Pots with a germination count */
  assessedPots: number;
  totalSeeds: number;
  totalGerminated: number;
  /** Total germinated ÷ total sown — the primary batch result */
  overallGerminationPct: number | null;
  /** Mean of the per-pot percentages (differs from overall when pots differ) */
  avgPotPct: number | null;
  minPotPct: number | null;
  maxPotPct: number | null;
  /** Best pot − worst pot, in percentage points */
  rangePP: number | null;
  /** 100 − range. The sheet's field-friendly uniformity score. */
  consistencyPct: number | null;
  /** Sample standard deviation of the per-pot percentages */
  sdPotPct: number | null;
  /** Fastest days-to-first-germination across the pots */
  daysToFirstGermination: number | null;
  /** Seedlings in the upper bands ÷ all classified, incl. broken */
  upperSizePct: number | null;
  brokenPct: number | null;
  /** Most common lateral-root pattern, or null when none recorded */
  dominantLateralRoots: string | null;
  sparsePots: number;
  fragilePots: number;
  stressPots: number;
  /** Every pot has a germination count — enough for the germination screen */
  countsComplete: boolean;
  /**
   * Every pot's seedlings are sorted into size classes and the counts agree —
   * what the growth screen needs on top of `countsComplete`.
   */
  classesComplete: boolean;
  /** Both of the above */
  dataComplete: boolean;
  potsWithBadCounts: number;
}

/** Classes counted as "upper size" for the growth screen — the top two bands. */
function upperClasses(run: TrialRun | null | undefined): number[] {
  const bands = runSizeBands(run);
  return bands.slice(-2).map(b => b.cls);
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

/** Sample standard deviation (n−1), matching the sheet's STDEV.S. */
function sampleSd(values: number[]): number | null {
  if (values.length < 2) return null;
  const m = mean(values) as number;
  const variance = values.reduce((s, v) => s + (v - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

const round1 = (n: number | null): number | null => (n === null ? null : Math.round(n * 10) / 10);

/**
 * Everything the Batch Summary and Report Summary sheets compute for one
 * treatment, from its pots.
 *
 * Percentages are only reported once every pot has been assessed, exactly like
 * the sheet's `COUNT(...)<5` guards — a half-counted treatment shouldn't
 * publish a germination rate that will move.
 */
export function treatmentSummary(
  owner: { pots?: TrialPot[] } | null | undefined,
  run: TrialRun | null | undefined,
): TreatmentSummary {
  const all = potsOf(owner, run);
  const pots = all.slice(0, runPotCount(run));

  const assessed = pots.filter(p => finalGerminated(p) !== null);
  const potPcts = assessed
    .map(p => potGerminationPct(p, run))
    .filter((v): v is number => v !== null);

  let totalSeeds = 0;
  let totalGerminated = 0;
  for (const pot of assessed) {
    const sown = potSeedsSown(pot, run);
    const germ = finalGerminated(pot);
    if (sown !== null) totalSeeds += sown;
    if (germ !== null) totalGerminated += germ;
  }

  const complete = assessed.length === pots.length && pots.length > 0;
  const overall = complete && totalSeeds > 0
    ? round1((totalGerminated / totalSeeds) * 100)
    : null;

  const min = complete && potPcts.length > 0 ? Math.min(...potPcts) : null;
  const max = complete && potPcts.length > 0 ? Math.max(...potPcts) : null;
  const range = min !== null && max !== null ? round1(max - min) : null;

  // Size classes pool across every pot in the treatment, as the sheet does —
  // the distribution is a property of the compost, not of one pot.
  const upper = upperClasses(run);
  let classified = 0;
  let upperCount = 0;
  let broken = 0;
  for (const pot of pots) {
    const m = pot.measurements || {};
    for (const band of runSizeBands(run)) {
      const n = toNum(m[sizeClassField(band.cls)]) ?? 0;
      classified += n;
      if (upper.includes(band.cls)) upperCount += n;
    }
    const b = toNum(m[BROKEN_FIELD]) ?? 0;
    classified += b;
    broken += b;
  }

  const patterns = pots
    .map(p => p.measurements?.[LATERAL_ROOTS_FIELD])
    .filter((v): v is string => typeof v === 'string' && v !== '');
  let dominant: string | null = null;
  if (patterns.length > 0) {
    const tally = new Map<string, number>();
    for (const p of patterns) tally.set(p, (tally.get(p) || 0) + 1);
    // Ties break toward the better pattern, matching the sheet's nested IFs
    // (Dense/fibrous wins a tie with Branched, which wins one with Sparse).
    for (const choice of [...LATERAL_ROOT_CHOICES].reverse()) {
      const n = tally.get(choice) || 0;
      if (n > 0 && n >= Math.max(...tally.values())) { dominant = choice; break; }
    }
  }

  // A mismatch is a data error to fix; a pending check is just work not done
  // yet. Only the first is worth flagging at the user.
  const badCounts = pots.filter(p => countCheck(p, run) === 'mismatch').length;
  const classesComplete = pots.length > 0 && pots.every(p => countCheck(p, run) === 'ok');
  const emergence = pots
    .map(p => daysToFirstGermination(p, run))
    .filter((v): v is number => v !== null);

  return {
    pots,
    assessedPots: assessed.length,
    totalSeeds,
    totalGerminated,
    overallGerminationPct: overall,
    avgPotPct: complete ? round1(mean(potPcts)) : null,
    minPotPct: round1(min),
    maxPotPct: round1(max),
    rangePP: range,
    consistencyPct: range === null ? null : round1(Math.max(0, 100 - range)),
    sdPotPct: complete ? round1(sampleSd(potPcts)) : null,
    daysToFirstGermination: emergence.length > 0 ? Math.min(...emergence) : null,
    upperSizePct: classified > 0 ? round1((upperCount / classified) * 100) : null,
    brokenPct: classified > 0 ? round1((broken / classified) * 100) : null,
    dominantLateralRoots: dominant,
    sparsePots: pots.filter(p => p.measurements?.[LATERAL_ROOTS_FIELD] === 'Sparse').length,
    fragilePots: pots.filter(p => p.measurements?.[ROOT_INTEGRITY_FIELD] === 'Fragile').length,
    stressPots: pots.filter(p => isStressed(p)).length,
    countsComplete: complete,
    classesComplete,
    dataComplete: complete && classesComplete,
    potsWithBadCounts: badCounts,
  };
}

/**
 * The run's control baseline: every control's pots pooled into one summary.
 *
 * Pooling rather than averaging the controls' rates means a control with fewer
 * assessed pots carries proportionally less weight, which is what the sheet's
 * `SUM(F25:F29)/SUM(C25:C29)` does across the control block.
 */
export function controlBaseline(run: TrialRun | null | undefined): TreatmentSummary | null {
  if (!run || run.controls.length === 0) return null;
  const pots: TrialPot[] = [];
  let offset = 0;
  for (const control of run.controls) {
    for (const pot of potsOf(control, run)) {
      // Renumber so pots from different controls don't collide in `potsOf`.
      pots.push({ ...pot, pot: pot.pot + offset });
    }
    offset += runPotCount(run);
  }
  // The pooled set is longer than one treatment's, so summarise it directly
  // against a run whose pot count covers all of them.
  const pooledRun = {
    ...run,
    settings: { ...(run.settings || {}), potsPerTreatment: pots.length },
  } as TrialRun;
  return treatmentSummary({ pots }, pooledRun);
}

// ── Verdict ──────────────────────────────────────────────────────────────────

export type VerdictCode =
  | 'incomplete'
  | 'no-control'
  | 'strong-inhibition'
  | 'germination-inhibition'
  | 'growth-pending'
  | 'growth-inhibition'
  | 'root-stress'
  | 'no-inhibition'
  | 'control-benchmark';

export interface Verdict {
  code: VerdictCode;
  label: string;
  /** Plain-English "what this means", from the sheet's column M */
  meaning: string;
  /** "Suggested interpretation", from column N */
  interpretation: string;
  chipClass: string;
  /** This treatment's germination as a % of the control's */
  vsControlGermination: number | null;
  /** This treatment's upper-size share as a % of the control's */
  vsControlGrowth: number | null;
}

const VERDICT_TEXT: Record<VerdictCode, { label: string; meaning: string; interpretation: string; chipClass: string }> = {
  'incomplete': {
    label: 'Incomplete',
    meaning: 'Count every pot before reading a result.',
    interpretation: '',
    chipClass: 'bg-gray-100 text-gray-600 border-gray-200',
  },
  'growth-pending': {
    label: 'Germination OK',
    meaning: 'Germination is comparable with the control. The growth screen is still outstanding.',
    interpretation: 'Sort each pot\'s intact seedlings into the size bands to complete the assessment — germination alone does not show whether the seedlings then grew normally.',
    chipClass: 'bg-blue-100 text-blue-700 border-blue-200',
  },
  'no-control': {
    label: 'No control',
    meaning: 'This run has no control pots assessed, so there is nothing to compare against.',
    interpretation: 'Add a seed raising mix control and assess it alongside the composts.',
    chipClass: 'bg-gray-100 text-gray-600 border-gray-200',
  },
  'strong-inhibition': {
    label: 'Strong inhibition',
    meaning: 'Seeds did not establish.',
    interpretation: 'Review alongside EC, pH, maturity/stability and other compost measures; this assay identifies a plant-response concern, not its cause.',
    chipClass: 'bg-red-100 text-red-700 border-red-200',
  },
  'germination-inhibition': {
    label: 'Germination inhibition',
    meaning: 'Germination is reduced relative to the control.',
    interpretation: 'Review alongside EC, pH, maturity/stability and other compost measures; this assay identifies a plant-response concern, not its cause.',
    chipClass: 'bg-red-100 text-red-700 border-red-200',
  },
  'growth-inhibition': {
    label: 'Growth inhibition',
    meaning: 'Seeds germinated, but fewer reached the upper size bands relative to the control.',
    interpretation: 'Review alongside EC, pH, maturity/stability and other compost measures; this assay identifies a plant-response concern, not its cause.',
    chipClass: 'bg-orange-100 text-orange-700 border-orange-200',
  },
  'root-stress': {
    label: 'Root / stress concern',
    meaning: 'Germination and growth may be acceptable, but repeated root or visible stress flags are present.',
    interpretation: 'Review alongside EC, pH, maturity/stability and other compost measures; this assay identifies a plant-response concern, not its cause.',
    chipClass: 'bg-amber-100 text-amber-700 border-amber-200',
  },
  'no-inhibition': {
    label: 'No clear inhibition',
    meaning: 'Germination and early growth are broadly comparable with the control.',
    interpretation: 'Supports readiness from this plant-response screen; interpret alongside the other readiness indicators.',
    chipClass: 'bg-green-100 text-green-700 border-green-200',
  },
  'control-benchmark': {
    label: 'Control benchmark',
    meaning: 'Reference response for this trial.',
    interpretation: 'Use as the same-day benchmark for germination, growth distribution and root development.',
    chipClass: 'bg-amber-50 text-amber-700 border-amber-200',
  },
};

/** How many flagged pots it takes to raise a root/stress concern — a majority. */
export function flagThreshold(run: TrialRun | null | undefined): number {
  return Math.ceil(runPotCount(run) / 2);
}

function ratio(value: number | null, base: number | null): number | null {
  if (value === null || base === null || base === 0) return null;
  return Math.round((value / base) * 1000) / 10;
}

/**
 * Screening verdict for one treatment against the run's control.
 *
 * The ladder is the Performance Assessment sheet's, in its order: data
 * completeness first, then nothing germinated, then germination against the
 * control, then growth against the control, then root/stress flags.
 *
 * It is a screen, not a diagnosis — the interpretation text says so, and
 * should stay attached wherever the verdict is shown.
 */
export function treatmentVerdict(
  summary: TreatmentSummary,
  control: TreatmentSummary | null,
  run: TrialRun | null | undefined,
  isControl = false,
): Verdict {
  const threshold = runThreshold(run);
  const vsGerm = control ? ratio(summary.overallGerminationPct, control.overallGerminationPct) : null;
  const vsGrowth = control ? ratio(summary.upperSizePct, control.upperSizePct) : null;
  const make = (code: VerdictCode): Verdict => ({
    code,
    ...VERDICT_TEXT[code],
    vsControlGermination: vsGerm,
    vsControlGrowth: vsGrowth,
  });

  // Counting every pot is the minimum for any verdict. Sorting the seedlings
  // into size bands is a second, later job, so a run that has been counted but
  // not yet sorted still reports its germination result rather than hiding
  // behind "incomplete" — that is the signal the assay exists for.
  if (!summary.countsComplete) return make('incomplete');
  if (isControl) return make('control-benchmark');
  if (!control || control.overallGerminationPct === null) return make('no-control');

  if (summary.overallGerminationPct === 0) return make('strong-inhibition');
  if (vsGerm !== null && vsGerm < threshold) return make('germination-inhibition');

  if (!summary.classesComplete) return make('growth-pending');
  if (vsGrowth !== null && vsGrowth < threshold) return make('growth-inhibition');

  const flag = flagThreshold(run);
  if (summary.sparsePots >= flag || summary.fragilePots >= flag || summary.stressPots >= flag) {
    return make('root-stress');
  }
  return make('no-inhibition');
}

// ── Migration ────────────────────────────────────────────────────────────────

/**
 * Pots for a trial recorded before pot-level entry existed.
 *
 * The old model stored one aggregate row (`seedsGerminated` out of
 * `seedsSown`, across `replicates` pots). There is no honest way to split that
 * back into pots, so it becomes a single pot carrying the totals, and the
 * remaining pots stay empty. That reads as "partially assessed" rather than
 * inventing per-pot numbers that were never observed.
 */
export function potsFromLegacyTrial(trial: GrowTrial, run: TrialRun | null | undefined): TrialPot[] {
  if (trial.pots && trial.pots.length > 0) return trial.pots;
  const m = trial.measurements || {};
  const germinated = toNum(m.seedsGerminated);
  if (germinated === null) return [];
  const sown = toNum(m.seedsSown) ?? toNum(run?.seedsSown);
  const date = trial.endedAt || run?.startDate || '';
  if (!date) return [];
  return [{
    pot: 1,
    seedsSown: sown,
    counts: [{ date, count: germinated }],
    measurements: {},
    notes: 'Carried over from the single-row record for this trial.',
  }];
}

/** Same, for a control row. */
export function potsFromLegacyControl(control: TrialControl, run: TrialRun | null | undefined): TrialPot[] {
  if (control.pots && control.pots.length > 0) return control.pots;
  const germinated = toNum(control.measurements?.seedsGerminated);
  if (germinated === null) return [];
  const sown = toNum(control.measurements?.seedsSown) ?? toNum(run?.seedsSown);
  const date = run?.startDate || '';
  if (!date) return [];
  return [{
    pot: 1,
    seedsSown: sown,
    counts: [{ date, count: germinated }],
    measurements: {},
    notes: 'Carried over from the single-row record for this control.',
  }];
}
