import { Calendar, Clock, Package, Sprout, Star, FlaskConical } from 'lucide-react';
import type { ReactNode } from 'react';
import type { CompostSystem } from '@/types';
import { getNZDate } from '@/utils/config';

interface BuildVitalsProps {
  system: CompostSystem;
  /** Earliest reading date (YYYY-MM-DD) — fallback when no canonical buildDate */
  firstEntryDate: string | null;
  /** F:B ratio from the most recent readiness check, or null */
  latestFbRatio: number | null;
  /** Public / print view — no star tapping */
  readOnly: boolean;
  /** Called with 1–5 to set the rating, or 0 to clear it */
  onRate?: (rating: number) => void;
  /** Plan C wires this up to scroll to the Growth Trials section */
  onGrowingClick?: () => void;
}

/** YYYY-MM-DD → "12 May 2026". Returns '' for anything unparseable. */
export function formatNiceDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '';
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-NZ', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
}

/** Whole days from isoFrom → isoTo. Null if either date is unparseable. */
export function daysBetween(isoFrom: string, isoTo: string): number | null {
  const a = Date.parse(`${isoFrom.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${isoTo.slice(0, 10)}T00:00:00Z`);
  if (isNaN(a) || isNaN(b)) return null;
  return Math.floor((b - a) / 86_400_000);
}

const PHASE_LABELS: Record<string, string> = {
  thermophilic: 'still thermophilic',
  maturation: 'maturing',
  grow: 'in grow trials',
};

interface TileProps {
  icon: ReactNode;
  label: string;
  children: ReactNode;
  sub?: ReactNode;
  /** Optional tooltip on the value */
  title?: string;
}

function Tile({ icon, label, children, sub, title }: TileProps) {
  return (
    <div className="text-center" title={title}>
      <div className="flex items-center justify-center gap-1 text-sm text-gray-500">
        {icon}
        <span>{label}</span>
      </div>
      {children}
      {sub && <div className="text-xs text-gray-400 line-clamp-1">{sub}</div>}
    </div>
  );
}

export function BuildVitals({
  system,
  firstEntryDate,
  latestFbRatio,
  readOnly,
  onRate,
  onGrowingClick,
}: BuildVitalsProps) {
  const today = getNZDate();

  // Canonical build date wins; fall back to the first reading (flagged with ~).
  const canonicalDate = system.buildDate || '';
  const effectiveDate = canonicalDate || firstEntryDate || '';
  const isApprox = !canonicalDate && !!firstEntryDate;

  const ageDays = effectiveDate ? daysBetween(effectiveDate, today) : null;

  const maturationStart = system.maturation?.startedAt || '';
  const daysToMaturation = effectiveDate && maturationStart
    ? daysBetween(effectiveDate, maturationStart)
    : null;

  const trials = system.grow?.trials ?? [];
  const crops = trials.map(t => t.crop).filter(Boolean);
  const cropList = crops.join(', ');
  const growStart = system.grow?.startedAt || '';

  const rating = system.performanceRating ?? 0;
  const canRate = !readOnly && !!onRate;

  const growingBody = (
    <>
      <div className={`font-bold text-gray-700 line-clamp-1 ${cropList ? 'text-lg' : 'text-3xl'}`}>
        {cropList || '—'}
      </div>
      <div className="text-xs text-gray-400 line-clamp-1">
        {trials.length > 0
          ? (growStart ? `since ${formatNiceDate(growStart) || growStart}` : `${trials.length} trial${trials.length !== 1 ? 's' : ''}`)
          : 'no trials yet'}
      </div>
    </>
  );

  return (
    <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
      <h3 className="font-semibold text-gray-900 mb-3">Build vitals</h3>

      <div className={
        latestFbRatio != null
          ? 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3'
          : 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3'
      }>

        {/* Built */}
        <Tile
          icon={<Calendar size={13} className="text-gray-400" />}
          label="Built"
          sub={effectiveDate ? (isApprox ? 'from first reading' : undefined) : 'set on Manage page'}
          title={isApprox ? 'Approximate — from first reading' : undefined}
        >
          <div className="text-lg font-bold text-gray-700">
            {effectiveDate
              ? `${isApprox ? '~' : ''}${formatNiceDate(effectiveDate) || effectiveDate}`
              : '—'}
          </div>
        </Tile>

        {/* Age */}
        <Tile
          icon={<Clock size={13} className="text-gray-400" />}
          label="Age"
          sub={ageDays !== null ? 'days old' : 'no build date'}
        >
          <div className="text-3xl font-bold text-gray-700">
            {ageDays !== null ? ageDays : '—'}
          </div>
        </Tile>

        {/* Maturation */}
        <Tile
          icon={<Package size={13} className="text-gray-400" />}
          label="Maturation"
        >
          <div className="text-3xl font-bold text-gray-700">
            {daysToMaturation !== null ? daysToMaturation : '—'}
          </div>
          <div className="text-xs text-gray-400 line-clamp-1">
            {daysToMaturation !== null
              ? 'days to maturation'
              : (maturationStart
                  ? 'started'
                  : (PHASE_LABELS[system.phase || 'thermophilic'] || 'not yet'))}
          </div>
          {maturationStart && (
            <div className="text-[11px] text-gray-400 line-clamp-1">
              {formatNiceDate(maturationStart) || maturationStart}
            </div>
          )}
        </Tile>

        {/* Growing — Plan C turns this into a jump link to the Growth Trials section */}
        {onGrowingClick ? (
          <button
            type="button"
            onClick={onGrowingClick}
            className="text-center rounded-lg hover:bg-green-50 focus:outline-none focus:ring-2 focus:ring-green-500/40 transition-colors"
            title={cropList || 'Growth trials'}
          >
            <div className="flex items-center justify-center gap-1 text-sm text-gray-500">
              <Sprout size={13} className="text-gray-400" />
              <span>Growing</span>
            </div>
            {growingBody}
          </button>
        ) : (
          <div className="text-center" title={cropList || undefined}>
            <div className="flex items-center justify-center gap-1 text-sm text-gray-500">
              <Sprout size={13} className="text-gray-400" />
              <span>Growing</span>
            </div>
            {growingBody}
          </div>
        )}

        {/* Rating — manual 1–5, tap the current value again to clear */}
        <Tile
          icon={<Star size={13} className="text-gray-400" />}
          label="Rating"
          sub={rating > 0
            ? `${rating} of 5`
            : (canRate ? 'tap to rate' : undefined)}
        >
          <div className="flex items-center justify-center gap-0.5 py-1.5">
            {[1, 2, 3, 4, 5].map(n => {
              const filled = n <= rating;
              const glyph = (
                <Star
                  size={20}
                  className={filled ? 'text-amber-400' : 'text-gray-300'}
                  fill={filled ? 'currentColor' : 'none'}
                />
              );
              if (!canRate) return <span key={n}>{glyph}</span>;
              return (
                <button
                  key={n}
                  type="button"
                  onClick={() => onRate?.(n === rating ? 0 : n)}
                  className="p-0.5 rounded hover:scale-110 transition-transform"
                  aria-label={n === rating ? `Clear rating` : `Rate ${n} out of 5`}
                  title={n === rating ? 'Tap again to clear' : `Rate ${n} of 5`}
                >
                  {glyph}
                </button>
              );
            })}
          </div>
        </Tile>

        {/* F:B ratio — only shown when a readiness check has one */}
        {latestFbRatio != null && (
          <Tile
            icon={<FlaskConical size={13} className="text-gray-400" />}
            label="F:B ratio"
            sub="at last readiness check"
          >
            <div className="text-3xl font-bold text-gray-700">{latestFbRatio}</div>
          </Tile>
        )}

      </div>
    </div>
  );
}
