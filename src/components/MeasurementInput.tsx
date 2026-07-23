import type { TrialField } from '@/utils/trialFields';
import type { TrialMeasurements } from '@/types';

/** One stored measurement. Mirrors the value type of `TrialMeasurements`. */
export type MeasurementValue = number | string | boolean | null;

/**
 * Draft values are held as the raw typed string so a half-typed decimal ("1.")
 * survives a re-render — `<input type="number">` reports an empty value for
 * partial input, which would wipe the cell mid-keystroke. Everything is
 * converted on the way to storage by `normaliseMeasurements`.
 */
function coerce(value: MeasurementValue, field: TrialField | undefined): MeasurementValue {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  // Text and choice fields keep their string exactly as entered.
  if (field && field.kind !== 'number') return trimmed;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : trimmed;
}

/**
 * Draft measurements → the shape that gets stored: numbers as numbers, blanks
 * dropped, derived fields never written (they're recomputed on read).
 *
 * Keys with no matching field definition are kept — a control row carries its
 * own `replicates`, and a value recorded before the protocol changed shouldn't
 * silently disappear.
 */
export function normaliseMeasurements(
  fields: readonly TrialField[],
  draft: TrialMeasurements | undefined,
): TrialMeasurements {
  const out: TrialMeasurements = {};
  for (const [key, raw] of Object.entries(draft || {})) {
    const field = fields.find(f => f.id === key);
    if (field?.derived) continue;
    const value = coerce(raw, field);
    if (value === null || value === undefined || value === '') continue;
    out[key] = value;
  }
  return out;
}

/** Value for an `<input>` / `<select>`, given whatever is stored. */
function inputValue(value: MeasurementValue | undefined): string {
  if (value === null || value === undefined) return '';
  return String(value);
}

interface Props {
  field: TrialField;
  value: MeasurementValue | undefined;
  onChange: (value: MeasurementValue) => void;
  /** Fired when the edit is finished — blur for typed fields, change for the rest. */
  onCommit?: () => void;
  disabled?: boolean;
  /** Tighter sizing for table cells. */
  compact?: boolean;
}

/**
 * One protocol field's input, driven entirely by its `TrialField` definition —
 * used by both the trial card and the run table so the two can never drift.
 * Derived fields are read-only here; callers should render `displayValue`
 * instead of an input for those.
 */
export function MeasurementInput({ field, value, onChange, onCommit, disabled, compact }: Props) {
  const base = compact
    ? 'w-full px-1.5 py-1 text-xs border border-gray-200 rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-purple-400 disabled:bg-gray-50 disabled:text-gray-400'
    : 'w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-green-primary disabled:bg-gray-50 disabled:text-gray-400';

  if (field.kind === 'bool') {
    const checked = value === true || value === 'true';
    return (
      <label className={`inline-flex items-center gap-1.5 ${compact ? 'text-xs' : 'text-sm'} text-gray-700`}>
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={e => { onChange(e.target.checked); onCommit?.(); }}
          className="w-4 h-4 rounded border-gray-300 text-purple-600 focus:ring-purple-400"
        />
        <span className={compact ? 'sr-only' : ''}>{checked ? 'Yes' : 'No'}</span>
      </label>
    );
  }

  if (field.kind === 'choice') {
    return (
      <select
        value={inputValue(value)}
        disabled={disabled}
        onChange={e => { onChange(e.target.value || null); onCommit?.(); }}
        className={base}
      >
        <option value="">—</option>
        {(field.choices || []).map(c => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>
    );
  }

  if (field.kind === 'text') {
    return (
      <input
        type="text"
        value={inputValue(value)}
        disabled={disabled}
        onChange={e => onChange(e.target.value)}
        onBlur={() => onCommit?.()}
        placeholder={compact ? '' : field.hint}
        className={base}
      />
    );
  }

  // number — text input with a decimal keypad, so partial entry isn't sanitised
  // away by the browser before we see it.
  return (
    <input
      type="text"
      inputMode="decimal"
      value={inputValue(value)}
      disabled={disabled}
      onChange={e => onChange(e.target.value)}
      onBlur={() => onCommit?.()}
      placeholder={field.unit || ''}
      className={base}
    />
  );
}
