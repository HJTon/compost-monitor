import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Check, Sprout } from 'lucide-react';
import { Header } from '@/components/Header';
import { formatNiceDate } from '@/components/BuildVitals';
import { useCompost } from '@/contexts/CompostContext';
import { getNZDate } from '@/utils/config';
import { dayDiff } from '@/utils/trials';
import {
  countOn,
  potSeedsSown,
  runObservationDates,
  runPotCount,
} from '@/utils/trialPots';
import { runTreatments, savePots, withCount, withPot } from '@/utils/trialTreatments';
import { useTrialBase } from '@/contexts/SandboxProvider';
import type { TrialControl, TrialPot } from '@/types';

/**
 * A counting day: one date, every pot in the run, one number box each.
 *
 * This is the walk-the-bench screen. Caroline counts cumulative germinated
 * seeds pot by pot, so the fastest possible shape is a flat list with a numeric
 * keypad and no navigation — the alternative (opening each compost in turn)
 * makes a five-minute job into twenty taps.
 *
 * Counts are cumulative, not incremental: today's number is the total up so
 * far, which is what every one of the protocol sheets records.
 */
export function TrialCountDayPage() {
  const { runId } = useParams<{ runId: string }>();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { allSystems, getTrialRun, saveTrialRun, setSystemPhase, addToast } = useCompost();

  const { base } = useTrialBase();

  const run = runId ? getTrialRun(runId) : undefined;

  const [date, setDate] = useState(params.get('date') || getNZDate());
  // Keyed `<treatmentKey>|<pot>`; only touched pots appear, so a background
  // refresh can't overwrite a box being typed into.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const treatments = useMemo(
    () => (run ? runTreatments(allSystems, run) : []),
    [allSystems, run]
  );

  // Switching date abandons drafts for the old date — they belong to it.
  useEffect(() => { setDrafts({}); }, [date]);

  if (!run) {
    return (
      <div className="min-h-screen bg-green-50/50">
        <Header title="Count day" showBack onBack={() => navigate(base)} />
        <div className="p-4 text-center text-sm text-gray-500">
          This run isn't loaded on this device.
        </div>
      </div>
    );
  }

  const potCount = runPotCount(run);
  const dayNumber = run.startDate ? dayDiff(run.startDate, date) : null;
  const knownDates = runObservationDates(run);

  const draftKey = (key: string, pot: number) => `${key}|${pot}`;

  const valueFor = (key: string, pot: TrialPot): string => {
    const dk = draftKey(key, pot.pot);
    if (dk in drafts) return drafts[dk];
    const stored = countOn(pot, date);
    return stored === null ? '' : String(stored);
  };

  const dirtyCount = Object.keys(drafts).length;

  /**
   * Write every touched pot, then record the date on the run so it becomes a
   * column everywhere else.
   *
   * Build saves go one at a time — each is a read-modify-write of that build's
   * GrowJSON cell, and firing them together would have them clobber each other.
   */
  const saveAll = async () => {
    setSaving(true);
    let written = 0;
    try {
      // Controls all share one JSON cell, so they're accumulated and written once.
      let controls: TrialControl[] = run.controls;

      for (const treatment of treatments) {
        const touched = treatment.pots.filter(p => draftKey(treatment.key, p.pot) in drafts);
        if (touched.length === 0) continue;

        let pots = treatment.pots;
        for (const pot of touched) {
          const raw = drafts[draftKey(treatment.key, pot.pot)].trim();
          const n = raw === '' ? null : Number(raw);
          if (raw !== '' && !Number.isFinite(n)) continue;
          pots = withPot(pots, withCount(pot, date, n));
          written++;
        }

        if (treatment.kind === 'control' && treatment.control) {
          const id = treatment.control.id;
          controls = controls.map(c => (c.id === id ? { ...c, pots } : c));
        } else {
          await savePots(treatment, pots, run, { setSystemPhase, saveTrialRun });
        }
      }

      const dates = [...new Set([...knownDates, date])].sort();
      await saveTrialRun({
        ...run,
        controls,
        settings: { ...(run.settings || {}), observationDates: dates },
        updatedAt: new Date().toISOString(),
      });

      setDrafts({});
      addToast('success', `${written} pot${written === 1 ? '' : 's'} counted`);
      navigate(`${base}/${run.runId}`);
    } catch {
      addToast('error', 'Could not save every pot — check the connection and try again');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-green-50/50 pb-28">
      <Header title="Count day" showBack onBack={() => navigate(`${base}/${run.runId}`)} />

      <div className="p-4 space-y-4">
        <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
          <label className="text-xs font-medium text-gray-500 block mb-1">Counting date</label>
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            className="w-full px-2 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-green-primary"
          />
          <p className="text-[11px] text-gray-500 mt-2">
            {dayNumber !== null
              ? `Day ${dayNumber} since sowing on ${formatNiceDate(run.startDate) || run.startDate}.`
              : 'Set a start date on the run to see the day number.'}
            {' '}Enter the <strong>total</strong> germinated so far in each pot, not just today's new ones.
          </p>
          {knownDates.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {knownDates.map(d => (
                <button
                  key={d}
                  onClick={() => setDate(d)}
                  className={`text-[10px] px-2 py-0.5 rounded-full border ${
                    d === date
                      ? 'bg-purple-100 text-purple-700 border-purple-200'
                      : 'bg-gray-50 text-gray-500 border-gray-200'
                  }`}
                >
                  {formatNiceDate(d) || d}
                </button>
              ))}
            </div>
          )}
        </div>

        {treatments.map(treatment => (
          <div
            key={treatment.key}
            className={`rounded-xl shadow-sm border overflow-hidden ${
              treatment.kind === 'control'
                ? 'bg-amber-50/60 border-amber-200'
                : 'bg-white border-gray-100'
            }`}
          >
            <div className="px-4 py-2.5 flex items-center gap-2 border-b border-black/5">
              <Sprout size={14} className={treatment.kind === 'control' ? 'text-amber-600' : 'text-green-primary'} />
              <span className="text-sm font-medium text-gray-900 flex-1 min-w-0 truncate">
                {treatment.label}
              </span>
              {treatment.kind === 'control' && (
                <span className="text-[10px] uppercase tracking-wide text-amber-600">Control</span>
              )}
            </div>

            <div className="divide-y divide-black/5">
              {treatment.pots.slice(0, potCount).map(pot => {
                const sown = potSeedsSown(pot, run);
                return (
                  <div key={pot.pot} className="flex items-center gap-3 px-4 py-2">
                    <span className="text-xs text-gray-500 w-12 shrink-0">Pot {pot.pot}</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={valueFor(treatment.key, pot)}
                      onChange={e => setDrafts(d => ({
                        ...d,
                        [draftKey(treatment.key, pot.pot)]: e.target.value,
                      }))}
                      placeholder="—"
                      className="w-20 px-2 py-1.5 text-sm text-center border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-purple-400"
                    />
                    <span className="text-xs text-gray-400">
                      of {sown ?? '—'} sown
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {treatments.length === 0 && (
          <div className="text-center py-10 text-sm text-gray-400">
            Nothing in this run to count yet — add a compost or a control first.
          </div>
        )}

        <p className="text-[11px] text-gray-400 px-1">
          Leave a pot blank if you didn't look at it. Enter <strong>0</strong> when you looked and
          nothing had come up — the two mean different things, and only 0 counts as a result.
        </p>
      </div>

      {/* Save bar — pinned, because the list is longer than a phone screen. */}
      <div className="fixed bottom-0 inset-x-0 bg-white border-t border-gray-200 px-4 py-3 flex items-center gap-3">
        <span className="text-xs text-gray-500 flex-1">
          {dirtyCount === 0 ? 'No changes yet' : `${dirtyCount} pot${dirtyCount === 1 ? '' : 's'} edited`}
        </span>
        <button
          onClick={saveAll}
          disabled={dirtyCount === 0 || saving}
          className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-green-primary text-white text-sm font-medium disabled:opacity-40"
        >
          <Check size={15} />
          {saving ? 'Saving…' : 'Save counts'}
        </button>
      </div>
    </div>
  );
}
