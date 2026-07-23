import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ChevronRight, Sprout } from 'lucide-react';
import { useCompost } from '@/contexts/CompostContext';
import { getNZDate } from '@/utils/config';
import { trialStatus, trialTypeDef, trialTypeOf } from '@/utils/trials';
import type { TrialStatus } from '@/utils/trials';

type DueBucket = 'overdue' | 'today' | 'soon';

interface DueRow {
  key: string;
  systemId: string;
  systemName: string;
  typeShort: string;
  crop: string;
  status: TrialStatus;
  bucket: DueBucket;
  /** planned - day. Negative = overdue by that many days. */
  remaining: number;
}

/** Keep the card compact — anything past this collapses into "+N more". */
const MAX_ROWS = 5;
/** "Due soon" window — trials landing within the next N days. */
const SOON_DAYS = 2;

function dueLabel(row: DueRow): string {
  if (row.bucket === 'today') return 'Due today';
  if (row.bucket === 'soon') {
    return row.remaining === 1 ? 'Due tomorrow' : `Due in ${row.remaining} days`;
  }
  const over = Math.abs(row.remaining);
  return `Overdue by ${over} day${over === 1 ? '' : 's'}`;
}

/**
 * Compact Dashboard prompt: which growth trials are due to be read?
 *
 * Renders nothing at all when nothing is due — the Dashboard hides grow-phase
 * builds from its main list, so without this card a "Day 5 of 5" germination
 * test is invisible until someone opens that specific build.
 */
export function TrialsDueCard() {
  const navigate = useNavigate();
  const { allSystems, settings } = useCompost();
  const today = getNZDate();

  const rows = useMemo<DueRow[]>(() => {
    const out: DueRow[] = [];

    for (const system of allSystems) {
      if (!settings.activeSystems.includes(system.id)) continue;

      for (const trial of system.grow?.trials ?? []) {
        if (trial.endedAt) continue;

        const status = trialStatus(trial, today);
        const planned = status.plannedDays;
        // Open-ended trials (crop trials, legacy trials) have no due date.
        if (!planned || planned <= 0 || status.day === null) continue;

        const remaining = planned - status.day;
        if (remaining > SOON_DAYS) continue;

        const bucket: DueBucket =
          remaining < 0 ? 'overdue' : remaining === 0 ? 'today' : 'soon';

        out.push({
          key: `${system.id}:${trial.id}`,
          systemId: system.id,
          systemName: system.name,
          typeShort: trialTypeDef(trialTypeOf(trial)).short,
          crop: trial.crop || '—',
          status,
          bucket,
          remaining,
        });
      }
    }

    // Most overdue first, then due today, then soonest.
    return out.sort((a, b) => a.remaining - b.remaining || a.systemName.localeCompare(b.systemName));
  }, [allSystems, settings.activeSystems, today]);

  if (rows.length === 0) return null;

  const overdueCount = rows.filter(r => r.bucket === 'overdue').length;
  const shown = rows.slice(0, MAX_ROWS);
  const extra = rows.length - shown.length;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-amber-200 overflow-hidden">
      <div className="px-4 py-2.5 bg-amber-50 border-b border-amber-100 flex items-center gap-2">
        {overdueCount > 0 ? (
          <AlertTriangle size={16} className="text-amber-600 shrink-0" />
        ) : (
          <Sprout size={16} className="text-amber-600 shrink-0" />
        )}
        <h3 className="font-semibold text-amber-900 text-sm">Trials due</h3>
        <span className="ml-auto text-[11px] text-amber-700">
          {overdueCount > 0
            ? `${overdueCount} overdue`
            : `${rows.length} to read`}
        </span>
      </div>

      <div className="divide-y divide-gray-50">
        {shown.map(row => (
          <button
            key={row.key}
            onClick={() => navigate(`/analyse/${row.systemId}`)}
            className="w-full px-4 py-2.5 text-left flex items-center gap-3 active:bg-amber-50/60 transition-colors"
          >
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-sm font-medium text-gray-900 truncate">{row.systemName}</span>
                <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border bg-purple-100 text-purple-700 border-purple-200">
                  {row.typeShort}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                <span className="text-xs text-gray-500 truncate">{row.crop}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${row.status.chipClass}`}>
                  {row.status.label}
                </span>
              </div>
            </div>

            <div className="shrink-0 flex items-center gap-1">
              <span
                className={`text-[11px] font-semibold ${
                  row.bucket === 'overdue'
                    ? 'text-red-600'
                    : row.bucket === 'today'
                      ? 'text-amber-700'
                      : 'text-gray-400'
                }`}
              >
                {dueLabel(row)}
              </span>
              <ChevronRight size={16} className="text-gray-300" />
            </div>
          </button>
        ))}
      </div>

      {extra > 0 && (
        <div className="px-4 py-2 text-[11px] text-gray-500 bg-gray-50/60 border-t border-gray-100">
          +{extra} more trial{extra === 1 ? '' : 's'} due
        </div>
      )}
    </div>
  );
}
