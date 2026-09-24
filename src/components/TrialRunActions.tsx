import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RotateCcw, Trash2 } from 'lucide-react';
import { useCompost } from '@/contexts/CompostContext';
import { useTrialBase } from '@/contexts/SandboxProvider';
import { generateId, getNZDate } from '@/utils/config';
import { repeatRun, repeatTrial, runMembers, type RunMember } from '@/utils/trialRuns';
import { trialTypeDef } from '@/utils/trials';
import type { CompostSystem, GrowTrial, TrialRun } from '@/types';

/** Members grouped by build, so each build's GrowJSON is written exactly once. */
function bySystem(members: RunMember[]): Array<{ system: CompostSystem; trials: GrowTrial[] }> {
  const groups = new Map<string, { system: CompostSystem; trials: GrowTrial[] }>();
  for (const m of members) {
    const g = groups.get(m.system.id);
    if (g) g.trials.push(m.trial);
    else groups.set(m.system.id, { system: m.system, trials: [m.trial] });
  }
  return [...groups.values()];
}

/**
 * Repeat or delete a whole run, from the bottom of the run header.
 *
 * Runs fail — the compost wasn't ready, the seed was poor — and get redone
 * later. Repeating starts a NEW run with the same protocol, controls and piles
 * and leaves the failed one as its own record; delete is for a run that
 * shouldn't be kept at all, and takes each pile's results for it with it.
 * Hidden in the practice space, which holds exactly one run.
 */
export function TrialRunActions({ run }: { run: TrialRun }) {
  const navigate = useNavigate();
  const { base, sandbox } = useTrialBase();
  const { allSystems, saveTrialRun, deleteTrialRun, setSystemPhase, addToast } = useCompost();

  const [mode, setMode] = useState<'repeat' | 'delete' | null>(null);
  const [startDate, setStartDate] = useState(getNZDate());
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  if (sandbox) return null;

  const groups = bySystem(runMembers(allSystems, run.runId));
  const def = trialTypeDef(run.type);

  const toggle = (id: string) => setExcluded(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const handleRepeat = async () => {
    setBusy(true);
    const newRunId = generateId();
    await saveTrialRun(repeatRun(run, startDate, newRunId));
    for (const { system, trials } of groups) {
      if (excluded.has(system.id)) continue;
      const grow = system.grow || { startedAt: startDate, trials: [] };
      await setSystemPhase(system.id, system.phase || 'grow', {
        grow: { ...grow, trials: [...grow.trials, repeatTrial(trials[0], startDate, newRunId)] },
        transitionNote: `+ ${def.label} (${startDate}): repeat run`,
      });
    }
    addToast('success', 'Repeat run started');
    setBusy(false);
    setMode(null);
    navigate(`${base}/${newRunId}`);
  };

  const handleDelete = async () => {
    setBusy(true);
    for (const { system } of groups) {
      if (!system.grow) continue;
      await setSystemPhase(system.id, system.phase || 'grow', {
        grow: { ...system.grow, trials: system.grow.trials.filter(t => t.runId !== run.runId) },
        transitionNote: `− ${def.label} run deleted`,
      });
    }
    await deleteTrialRun(run.runId);
    addToast('success', 'Run deleted');
    navigate(base);
  };

  const pileCount = groups.length;
  const repeatCount = groups.filter(g => !excluded.has(g.system.id)).length;

  return (
    <div className="mt-3 pt-3 border-t border-gray-100">
      {mode === null && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setMode('repeat')}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border border-purple-200 text-purple-700 font-medium hover:bg-purple-50"
          >
            <RotateCcw size={12} />
            Repeat this run
          </button>
          <button
            onClick={() => setMode('delete')}
            className="ml-auto flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border border-gray-200 text-gray-500 hover:text-red-500 hover:border-red-200"
          >
            <Trash2 size={12} />
            Delete run
          </button>
        </div>
      )}

      {mode === 'repeat' && (
        <div className="space-y-2">
          <p className="text-xs text-gray-600">
            Starts a new run with the same settings and controls, with nothing recorded yet.
            This run stays as it is, so you keep a record of the attempt.
          </p>
          <div>
            <label className="text-xs font-medium text-gray-500 block mb-1">New start date</label>
            <input
              type="date"
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
              className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-green-primary"
            />
          </div>
          {pileCount > 0 && (
            <div>
              <div className="text-xs font-medium text-gray-500 mb-1">Piles to include</div>
              <div className="flex flex-wrap gap-1.5">
                {groups.map(({ system }) => {
                  const on = !excluded.has(system.id);
                  return (
                    <button
                      key={system.id}
                      type="button"
                      onClick={() => toggle(system.id)}
                      className={`text-xs px-2.5 py-1 rounded-full border ${
                        on
                          ? 'border-purple-400 bg-purple-100 text-purple-800'
                          : 'border-gray-200 bg-white text-gray-400 line-through'
                      }`}
                    >
                      {system.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <div className="flex gap-2 pt-1">
            <button
              onClick={() => setMode(null)}
              className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg text-gray-600"
            >
              Cancel
            </button>
            <button
              onClick={handleRepeat}
              disabled={busy || !startDate}
              className="flex-1 px-3 py-2 text-sm bg-purple-600 text-white rounded-lg font-medium disabled:opacity-50"
            >
              {busy ? 'Starting…' : `Start repeat${pileCount ? ` (${repeatCount} pile${repeatCount === 1 ? '' : 's'})` : ''}`}
            </button>
          </div>
        </div>
      )}

      {mode === 'delete' && (
        <div className="space-y-2">
          <p className="text-xs text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
            This deletes the run, its {run.controls.length} control{run.controls.length === 1 ? '' : 's'}
            {pileCount > 0 ? ` and the results recorded for it on ${pileCount} pile${pileCount === 1 ? '' : 's'}` : ''}.
            It can't be undone. To redo a failed run and keep this one as a record, use
            Repeat instead.
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setMode(null)}
              className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg text-gray-600"
            >
              Cancel
            </button>
            <button
              onClick={handleDelete}
              disabled={busy}
              className="flex-1 px-3 py-2 text-sm bg-red-600 text-white rounded-lg font-medium disabled:opacity-50"
            >
              {busy ? 'Deleting…' : 'Delete run'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
