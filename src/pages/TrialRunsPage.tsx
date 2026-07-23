import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, FlaskConical } from 'lucide-react';
import { Header } from '@/components/Header';
import { formatNiceDate } from '@/components/BuildVitals';
import { useCompost } from '@/contexts/CompostContext';
import {
  TRIAL_TYPE_BADGE,
  runControlStrikeRate,
  trialStatus,
  trialTypeDef,
} from '@/utils/trials';
import { hasMeasurements, pileCountsByRun, runAsTrial, runMembers } from '@/utils/trialRuns';

/**
 * Index of protocol runs — one row per experiment, newest first.
 *
 * A run is the thing Caroline's documents call "the test": one start date, one
 * set of controls, a row per pile. This page answers "what's running, and how
 * much of it has been filled in?"; `/trials/:runId` is where the numbers go.
 */
export function TrialRunsPage() {
  const navigate = useNavigate();
  const { trialRuns, allSystems } = useCompost();

  const pileCounts = useMemo(() => pileCountsByRun(allSystems), [allSystems]);

  const runs = useMemo(
    () => trialRuns.slice().sort((a, b) => (b.startDate || '').localeCompare(a.startDate || '')),
    [trialRuns]
  );

  return (
    <div className="min-h-screen bg-green-50/50 pb-8">
      <Header title="Trial runs" showBack onBack={() => navigate('/analyse')} />

      <div className="p-4 space-y-3">
        <p className="text-sm text-gray-500">
          Each run is one protocol experiment — a shared start date, a shared set of
          controls, and a row per pile.
        </p>

        {runs.map(run => {
          const def = trialTypeDef(run.type);
          const status = trialStatus(runAsTrial(run));
          const members = runMembers(allSystems, run.runId);
          const piles = pileCounts.get(run.runId) ?? members.length;
          const withResults = members.filter(m => hasMeasurements(m.trial)).length;
          const control = runControlStrikeRate(run);

          return (
            <button
              key={run.runId}
              onClick={() => navigate(`/trials/${run.runId}`)}
              className="w-full bg-white rounded-xl p-4 shadow-sm border border-gray-100 text-left active:scale-[0.98] transition-transform flex items-center gap-3"
            >
              <div className="w-10 h-10 rounded-lg bg-purple-100 flex items-center justify-center shrink-0">
                <FlaskConical size={18} className="text-purple-600" />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border ${TRIAL_TYPE_BADGE[run.type]}`}>
                    {def.short}
                  </span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${status.chipClass}`}>
                    {status.label}
                  </span>
                </div>
                <div className="text-sm font-medium text-gray-900 mt-1">
                  Started {formatNiceDate(run.startDate) || run.startDate || '—'}
                </div>
                <div className="text-xs text-gray-500 mt-0.5">
                  {piles} pile{piles === 1 ? '' : 's'} · {withResults} with results ·{' '}
                  {run.controls.length} control{run.controls.length === 1 ? '' : 's'}
                  {control !== null ? ` · control ${control}%` : ''}
                </div>
              </div>

              <ChevronRight size={18} className="text-gray-300 shrink-0" />
            </button>
          );
        })}

        {runs.length === 0 && (
          <div className="text-center py-12 text-gray-400 text-sm px-6">
            No trial runs yet. Start one when you add a germination or broad bean trial
            to a build — the "Add trial" form offers "Start a new run".
          </div>
        )}
      </div>
    </div>
  );
}
