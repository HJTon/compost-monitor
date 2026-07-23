import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronRight, Sprout } from 'lucide-react';
import { protocolProgress, trialStatus } from '@/utils/trials';
import type { ProtocolStage } from '@/utils/trials';
import type { CompostSystem, GrowTrial } from '@/types';

interface Props {
  /** Every build that could run trials — not only the ones that have. */
  systems: CompostSystem[];
}

/** "12 Jun" — short enough for a three-across grid at 375px. */
function shortDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '';
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/** Latest end date across the completed trials of a stage. */
function lastCompleted(trials: GrowTrial[]): string | null {
  const ended = trials.map(t => t.endedAt).filter((d): d is string => !!d);
  if (ended.length === 0) return null;
  return ended.sort()[ended.length - 1];
}

interface CellView {
  /** Main line — "✓ 12 Jun", "Day 3 of 5", "3 trials" or a muted dash */
  text: string;
  /** Optional second line, e.g. the running status under a crop-trial count */
  sub: string | null;
  tone: 'done' | 'running' | 'none';
}

function cellFor(stage: ProtocolStage): CellView {
  const isCrop = stage.def.id === 'crop';
  const doneAt = lastCompleted(stage.trials);
  const running = stage.running ? trialStatus(stage.running) : null;

  if (isCrop) {
    if (stage.trials.length === 0) return { text: '—', sub: null, tone: 'none' };
    const n = stage.trials.length;
    return {
      text: `${n} trial${n === 1 ? '' : 's'}`,
      sub: running ? running.label : doneAt ? `✓ ${shortDate(doneAt)}` : null,
      tone: running ? 'running' : doneAt ? 'done' : 'none',
    };
  }

  if (doneAt) return { text: `✓ ${shortDate(doneAt)}`, sub: null, tone: 'done' };
  if (stage.done) return { text: '✓ Complete', sub: null, tone: 'done' };
  if (running) return { text: running.label, sub: null, tone: 'running' };
  return { text: '—', sub: null, tone: 'none' };
}

const TONE_CLASS: Record<CellView['tone'], string> = {
  done: 'text-green-700 font-medium',
  running: 'text-blue-700 font-medium',
  none: 'text-gray-300',
};

/**
 * Protocol progress for every build at a glance — the answer to
 * "which piles haven't run the germination test yet?" without opening each one.
 *
 * Stacked cells (never a wide table) so it stays readable at 375px.
 */
export function TrialProtocolOverview({ systems }: Props) {
  const navigate = useNavigate();
  const [showNotStarted, setShowNotStarted] = useState(false);

  const rows = useMemo(
    () =>
      systems.map(system => ({
        system,
        stages: protocolProgress(system.grow?.trials ?? []),
        started: (system.grow?.trials?.length ?? 0) > 0,
      })),
    [systems]
  );

  if (rows.length === 0) return null;

  // A row of three dashes says nothing, and there can be 25 of them. Piles with
  // activity lead; the rest collapse behind a count that still answers
  // "which haven't started?" when you open it.
  const startedRows = rows.filter(r => r.started);
  const notStartedRows = rows.filter(r => !r.started);
  const visibleRows = showNotStarted ? [...startedRows, ...notStartedRows] : startedRows;

  const stageDone = (id: string) =>
    rows.filter(r => r.stages.some(s => s.def.id === id && s.done)).length;

  const total = rows.length;
  const germDone = stageDone('germination');
  const beanDone = stageDone('growth-test');

  return (
    <div className="pt-2">
      <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 px-1">
        Trial protocol
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Sprout size={14} className="text-purple-600 shrink-0" />
            <h3 className="font-semibold text-gray-900 text-sm">Protocol progress</h3>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            {germDone} of {total} pile{total === 1 ? '' : 's'} {germDone === 1 ? 'has' : 'have'} completed
            the germination test · {beanDone} {beanDone === 1 ? 'has' : 'have'} completed the broad bean test.
          </p>
        </div>

        <div className="divide-y divide-gray-50">
          {visibleRows.map(({ system, stages }) => (
            <button
              key={system.id}
              onClick={() => navigate(`/analyse/${system.id}`)}
              className="w-full px-3 py-2.5 text-left active:bg-gray-50 transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-gray-900 truncate flex-1 min-w-0">
                  {system.name}
                </span>
                <ChevronRight size={16} className="text-gray-300 shrink-0" />
              </div>

              <div className="grid grid-cols-3 gap-1.5 mt-1.5">
                {stages.map(stage => {
                  const cell = cellFor(stage);
                  return (
                    <div
                      key={stage.def.id}
                      className="min-w-0 rounded-lg border border-gray-100 bg-gray-50/70 px-1.5 py-1"
                    >
                      <div className="text-[9px] uppercase tracking-wide text-gray-400 truncate">
                        {stage.def.short}
                      </div>
                      <div className={`text-[11px] leading-tight break-words ${TONE_CLASS[cell.tone]}`}>
                        {cell.text}
                      </div>
                      {cell.sub && (
                        <div className="text-[10px] leading-tight text-gray-500 break-words">
                          {cell.sub}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </button>
          ))}
        </div>

        {notStartedRows.length > 0 && (
          <button
            onClick={() => setShowNotStarted(o => !o)}
            className="w-full px-4 py-2.5 flex items-center justify-center gap-1.5 text-xs text-gray-500 border-t border-gray-100 hover:bg-gray-50 transition-colors"
          >
            {showNotStarted ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            {notStartedRows.length} pile{notStartedRows.length === 1 ? '' : 's'} {notStartedRows.length === 1 ? 'has' : 'have'} no trials yet
          </button>
        )}
      </div>
    </div>
  );
}
