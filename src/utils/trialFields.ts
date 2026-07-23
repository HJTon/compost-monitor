import type { TrialType, TrialMeasurements } from '@/types';

// ── The protocol, in one place ───────────────────────────────────────────────
//
// Caroline's protocol documents record ten or more measured fields per pile.
// This table is the single definition of those fields: every editor, table and
// print view reads it, so the protocol only ever changes here.
//
// Values are stored on `GrowTrial.measurements` (and `TrialControl.measurements`)
// keyed by `TrialField.id`. Derived fields are NEVER stored — they are computed
// on read by `computeField`.

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

/** Field id of the strike rate, referenced by the pass rule in `trials.ts`. */
export const STRIKE_RATE_FIELD = 'strikeRatePct';

const GERMINATION_FIELDS: readonly TrialField[] = [
  {
    id: 'daysToFirstGermination',
    label: 'Days to first germination',
    kind: 'number',
    min: 0,
    max: 60,
  },
  {
    id: 'seedsSown',
    label: 'Seeds sown',
    kind: 'number',
    min: 0,
    hint: 'Protocol default: 25 per pot',
  },
  {
    id: 'seedsGerminated',
    label: 'Seeds germinated',
    kind: 'number',
    min: 0,
  },
  {
    id: STRIKE_RATE_FIELD,
    label: 'Strike rate',
    unit: '%',
    kind: 'number',
    min: 0,
    max: 100,
    derived: true,
    hint: 'Germinated ÷ sown × 100',
  },
  {
    id: 'shootHeightMm',
    label: 'Shoot height',
    unit: 'mm',
    kind: 'number',
    min: 0,
  },
  {
    id: 'rootLengthMm',
    label: 'Root length',
    unit: 'mm',
    kind: 'number',
    min: 0,
  },
  {
    id: 'abnormalities',
    label: 'Abnormalities',
    kind: 'text',
    hint: 'Yellowing, distortion, stunting…',
  },
];

const GROWTH_TEST_FIELDS: readonly TrialField[] = [
  {
    id: 'germinatedOfReplicates',
    label: 'Germinated (of replicates)',
    kind: 'number',
    min: 0,
    hint: 'Broad bean is 1 seed per pot, so this is out of the replicate count',
  },
  {
    id: STRIKE_RATE_FIELD,
    label: 'Strike rate',
    unit: '%',
    kind: 'number',
    min: 0,
    max: 100,
    derived: true,
    hint: 'Germinated ÷ pots × 100',
  },
  {
    id: 'daysToEmergence',
    label: 'Days to emergence',
    kind: 'number',
    min: 0,
    max: 60,
  },
  {
    id: 'plantHeightCm',
    label: 'Plant height at day 21',
    unit: 'cm',
    kind: 'number',
    min: 0,
  },
  {
    id: 'trueLeaves',
    label: 'True leaves',
    kind: 'number',
    min: 0,
  },
  {
    id: 'leafColour',
    label: 'Leaf colour',
    kind: 'choice',
    choices: ['0', '1', '2', '3', '4', '5'],
    hint: 'Colour chart score, 0 (pale / yellow) – 5 (deep green)',
  },
  {
    id: 'stemThicknessMm',
    label: 'Stem thickness',
    unit: 'mm',
    kind: 'number',
    min: 0,
  },
  {
    id: 'rootLengthCm',
    label: 'Root length',
    unit: 'cm',
    kind: 'number',
    min: 0,
  },
  {
    id: 'rootNodesPresent',
    label: 'Root nodes present',
    kind: 'bool',
  },
  {
    id: 'rootHealth',
    // The protocol leaves this open; these wordings mirror its own visual
    // observation list ("healthy white roots" / "poor root development").
    label: 'Root health',
    kind: 'choice',
    choices: ['Healthy white', 'Some browning', 'Poor development', 'Rotting'],
  },
  {
    id: 'overallVigour',
    label: 'Overall plant vigour',
    kind: 'choice',
    choices: ['Excellent', 'Good', 'Acceptable', 'Borderline', 'Unsuitable'],
  },
];

/**
 * Crop trials have no structured fields in v1 — they keep the free-text
 * `result`. The potato design (variety × treatment × replicate) is its own plan.
 */
const CROP_FIELDS: readonly TrialField[] = [];

export const TRIAL_FIELDS: Record<TrialType, readonly TrialField[]> = {
  'germination': GERMINATION_FIELDS,
  'growth-test': GROWTH_TEST_FIELDS,
  'crop': CROP_FIELDS,
};

/**
 * Protocol defaults when starting a new run of each type:
 * 25 mustard seeds per pot / 1 broad bean per pot, 3 replicate pots per compost.
 * Crop trials have no protocol design yet (the potato plan comes later).
 */
export const PROTOCOL_RUN_DEFAULTS: Record<TrialType, {
  seedsSown: number | null;
  replicates: number | null;
}> = {
  'germination': { seedsSown: 25, replicates: 3 },
  'growth-test': { seedsSown: 1,  replicates: 3 },
  'crop':        { seedsSown: null, replicates: null },
};

export const VISUAL_OBSERVATIONS: readonly { id: string; label: string; good?: boolean }[] = [
  { id: 'chlorosis',        label: 'Yellowing (chlorosis)' },
  { id: 'purpleLeaves',     label: 'Purple leaves' },
  { id: 'leafBurn',         label: 'Leaf burn' },
  { id: 'wilting',          label: 'Wilting' },
  { id: 'stuntedGrowth',    label: 'Stunted growth' },
  { id: 'poorRoots',        label: 'Poor root development' },
  { id: 'healthyWhiteRoots', label: 'Healthy white roots', good: true },
];

/** Label for a stored observation id; falls back to the raw id if unknown. */
export function observationLabel(id: string): string {
  return VISUAL_OBSERVATIONS.find(o => o.id === id)?.label || id;
}

// ── Lookups ──────────────────────────────────────────────────────────────────

/** Fields for a trial type. Legacy/crop trials get an empty list. */
export function fieldsFor(trialType: TrialType): readonly TrialField[] {
  return TRIAL_FIELDS[trialType] || [];
}

/** A single field definition, or undefined when the type doesn't record it. */
export function fieldById(trialType: TrialType, fieldId: string): TrialField | undefined {
  return fieldsFor(trialType).find(f => f.id === fieldId);
}

// ── Derived values ───────────────────────────────────────────────────────────

/** Extra context a derived field may need that isn't itself a measurement. */
export interface ComputeContext {
  /**
   * Pots per compost (`GrowTrial.replicates`). The broad bean test sows one
   * seed per pot, so this is the strike-rate denominator for `growth-test`.
   * A control row can supply the same number as a `replicates` measurement.
   */
  replicates?: number | null;
  /**
   * Seeds sown per pot from the run (`TrialRun.seedsSown`, protocol default
   * 25). Used as the `germination` denominator when the pot's own `seedsSown`
   * measurement wasn't entered. Never used for `growth-test` — there the
   * denominator is pots, not seeds.
   */
  seedsSown?: number | null;
}

/** Coerce a measurement to a finite number, or null. */
function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** germinated ÷ sown × 100, to one decimal place. */
function rate(germinated: number, sown: number | null): number | null {
  // Guard the divide: a blank or zero denominator means "not measurable", not 0%.
  if (sown === null || sown === 0) return null;
  return Math.round((germinated / sown) * 1000) / 10;
}

/**
 * Value of a derived field, or null when it can't be computed.
 *
 * Currently only `strikeRatePct`. Returns null when either input is missing or
 * the denominator is 0 — never divides by zero, and never guesses a rate from
 * partial data.
 *
 * The two stages count different things, so their denominators differ:
 *   germination — seeds germinated ÷ seeds sown (25 per pot by default)
 *   growth-test — germinated pots ÷ pots (broad bean is 1 seed per pot)
 */
export function computeField(
  fieldId: string,
  measurements: TrialMeasurements | undefined,
  ctx: ComputeContext = {},
): number | null {
  if (fieldId !== STRIKE_RATE_FIELD) return null;
  const m = measurements || {};

  const germinatedSeeds = toNumber(m.seedsGerminated);
  if (germinatedSeeds !== null) {
    return rate(germinatedSeeds, toNumber(m.seedsSown) ?? toNumber(ctx.seedsSown));
  }

  const germinatedPots = toNumber(m.germinatedOfReplicates);
  if (germinatedPots !== null) {
    // `m.replicates` lets a control row carry its own pot count — controls
    // aren't trials, so they have no `GrowTrial.replicates` to draw on.
    return rate(germinatedPots, toNumber(m.replicates) ?? toNumber(ctx.replicates));
  }

  return null;
}

// ── Formatting ───────────────────────────────────────────────────────────────

/** Shown wherever a field has no usable value. */
export const EMPTY_VALUE = '—';

/**
 * The value of `field` formatted for display, with its unit — or '—' when
 * nothing has been recorded. Derived fields are computed, never read from
 * storage, so a stale stored copy can't leak into the UI.
 */
export function displayValue(
  field: TrialField,
  measurements: TrialMeasurements | undefined,
  ctx: ComputeContext = {},
): string {
  const withUnit = (text: string) => field.unit ? `${text}${field.unit === '%' ? '' : ' '}${field.unit}` : text;

  if (field.derived) {
    const computed = computeField(field.id, measurements, ctx);
    return computed === null ? EMPTY_VALUE : withUnit(String(computed));
  }

  const raw = (measurements || {})[field.id];
  if (raw === null || raw === undefined || raw === '') return EMPTY_VALUE;

  if (field.kind === 'bool') return raw ? 'Yes' : 'No';
  if (field.kind === 'number') {
    const n = toNumber(raw);
    return n === null ? EMPTY_VALUE : withUnit(String(n));
  }
  return withUnit(String(raw));
}
