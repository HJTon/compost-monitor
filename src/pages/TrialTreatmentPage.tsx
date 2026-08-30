import { useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, Check, ChevronDown, ChevronUp, Ruler } from 'lucide-react';
import { Header } from '@/components/Header';
import { formatNiceDate } from '@/components/BuildVitals';
import { InlinePhotoSlot } from '@/components/InlinePhotoSlot';
import { MeasurementInput } from '@/components/MeasurementInput';
import { TrialVerdictCard } from '@/components/TrialVerdictCard';
import { useCompost } from '@/contexts/CompostContext';
import {
  BROKEN_FIELD,
  POT_FLAG_CLASS,
  POT_FLAG_LABEL,
  bandLabel,
  classifiedTotal,
  controlBaseline,
  countCheck,
  countOn,
  finalGerminated,
  potFields,
  potFlag,
  potGerminationPct,
  potSeedsSown,
  runObservationDates,
  runPotCount,
  runSizeBands,
  sizeClassField,
  treatmentSummary,
  treatmentVerdict,
} from '@/utils/trialPots';
import { findTreatment, savePots, withCount, withPot } from '@/utils/trialTreatments';
import { useTrialBase } from '@/contexts/SandboxProvider';
import type { PhotoSlotDef } from '@/utils/photoSlots';
import type { TrialMeasurements, TrialPot } from '@/types';

/**
 * One compost (or control) in a run, pot by pot — the endpoint autopsy screen.
 *
 * Caroline pulls a treatment's pots apart in one sitting: wash the roots, sort
 * the intact seedlings into length bands, score the roots, note the symptoms.
 * So the unit of this page is the treatment, and everything for one pot sits in
 * one expandable block rather than spread across a wide table.
 *
 * The count check ("do the size classes account for every seedling that came
 * up?") is shown live inside each pot, because catching a miscount while the
 * seedlings are still on the bench is the only time it can actually be fixed.
 */
export function TrialTreatmentPage() {
  const { runId, key } = useParams<{ runId: string; key: string }>();
  const navigate = useNavigate();
  const { allSystems, getTrialRun, saveTrialRun, setSystemPhase, addToast } = useCompost();

  const { base, sandbox } = useTrialBase();

  const run = runId ? getTrialRun(runId) : undefined;
  const treatment = useMemo(
    () => (run && key ? findTreatment(allSystems, run, decodeURIComponent(key)) : undefined),
    [allSystems, run, key]
  );

  const [open, setOpen] = useState<number | null>(1);
  const [saving, setSaving] = useState<number | null>(null);
  // Pending edits per pot number. The ref mirrors it so a select or checkbox,
  // which commits in the same tick it changes, still sees the latest draft.
  const [drafts, setDrafts] = useState<Record<number, TrialPot>>({});
  const draftsRef = useRef<Record<number, TrialPot>>({});

  const back = () => navigate(`${base}/${runId}`);

  if (!run || !treatment) {
    return (
      <div className="min-h-screen bg-green-50/50">
        <Header title="Treatment" showBack onBack={back} />
        <div className="p-4 text-center text-sm text-gray-500">
          {run ? "That treatment isn't in this run any more." : "This run isn't loaded on this device."}
        </div>
      </div>
    );
  }

  const fields = potFields(run);
  const bands = runSizeBands(run);
  const potCount = runPotCount(run);
  const dates = runObservationDates(run);
  const control = controlBaseline(run);
  const isControl = treatment.kind === 'control';

  const potsWithDrafts = treatment.pots
    .slice(0, potCount)
    .map(p => drafts[p.pot] ?? p);

  const summary = treatmentSummary({ pots: potsWithDrafts }, run);
  const verdict = treatmentVerdict(summary, control, run, isControl);

  const setDraft = (pot: TrialPot) => {
    draftsRef.current = { ...draftsRef.current, [pot.pot]: pot };
    setDrafts(draftsRef.current);
  };

  const current = (pot: TrialPot): TrialPot => draftsRef.current[pot.pot] ?? drafts[pot.pot] ?? pot;

  const editMeasurement = (pot: TrialPot, fieldId: string, value: TrialMeasurements[string]) => {
    const base = current(pot);
    setDraft({ ...base, measurements: { ...(base.measurements || {}), [fieldId]: value } });
  };

  const editCount = (pot: TrialPot, date: string, raw: string) => {
    const trimmed = raw.trim();
    const n = trimmed === '' ? null : Number(trimmed);
    if (trimmed !== '' && !Number.isFinite(n)) return;
    setDraft(withCount(current(pot), date, n));
  };

  /** Persist one pot. Values are stored as typed; blanks are dropped. */
  const commit = async (potNumber: number) => {
    const draft = draftsRef.current[potNumber];
    if (!draft) return;
    const cleaned: TrialPot = {
      ...draft,
      measurements: Object.fromEntries(
        Object.entries(draft.measurements || {})
          .filter(([, v]) => v !== null && v !== undefined && v !== '')
          .map(([k, v]) => {
            const field = fields.find(f => f.id === k);
            if (field?.kind === 'number' && typeof v === 'string') {
              const n = Number(v.trim());
              return [k, Number.isFinite(n) ? n : v];
            }
            return [k, v];
          })
      ),
    };

    const pots = withPot(treatment.pots, cleaned);
    setSaving(potNumber);
    try {
      await savePots(treatment, pots, run, { setSystemPhase, saveTrialRun });
      const next = { ...draftsRef.current };
      delete next[potNumber];
      draftsRef.current = next;
      setDrafts(next);
    } catch {
      addToast('error', `Could not save pot ${potNumber}`);
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="min-h-screen bg-green-50/50 pb-10">
      <Header title={treatment.label} showBack onBack={back} />

      <div className="p-4 space-y-4">
        <TrialVerdictCard summary={summary} verdict={verdict} run={run} isControl={isControl} />

        {dates.length === 0 && (
          <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 text-xs text-blue-800">
            No counting days recorded yet.{' '}
            <button onClick={() => navigate(`${base}/${run.runId}/count`)} className="font-semibold underline">
              Record one
            </button>{' '}
            to start the germination series.
          </div>
        )}

        {potsWithDrafts.map(pot => {
          const expanded = open === pot.pot;
          const flag = potFlag(pot, run);
          const germinated = finalGerminated(pot);
          const pct = potGerminationPct(pot, run);
          const check = countCheck(pot, run);
          const classified = classifiedTotal(pot, run);
          const dirty = pot.pot in drafts;

          return (
            <div key={pot.pot} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <button
                onClick={() => setOpen(expanded ? null : pot.pot)}
                className="w-full px-4 py-3 flex items-center gap-2 text-left"
              >
                <span className="text-sm font-semibold text-gray-900">Pot {pot.pot}</span>
                <span className="text-xs text-gray-500">
                  {germinated === null
                    ? 'not counted'
                    : `${germinated}/${potSeedsSown(pot, run) ?? '—'}${pct !== null ? ` · ${pct}%` : ''}`}
                </span>
                {flag !== 'none' && (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${POT_FLAG_CLASS[flag]}`}>
                    {POT_FLAG_LABEL[flag]}
                  </span>
                )}
                <span className="ml-auto flex items-center gap-2">
                  {saving === pot.pot && <span className="text-[10px] text-gray-400">saving…</span>}
                  {dirty && saving !== pot.pot && (
                    <span className="text-[10px] text-amber-600">unsaved</span>
                  )}
                  {expanded ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
                </span>
              </button>

              {expanded && (
                <div className="px-4 pb-4 space-y-4 border-t border-gray-100 pt-3">

                  {/* Germination series */}
                  {dates.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold text-gray-700 mb-1.5">Germination counts</h4>
                      <div className="overflow-x-auto -mx-1 px-1">
                        <div className="flex gap-2 min-w-min">
                          {dates.map(d => (
                            <div key={d} className="w-20 shrink-0">
                              <div className="text-[10px] text-gray-400 mb-1 truncate">
                                {formatNiceDate(d) || d}
                              </div>
                              <input
                                type="text"
                                inputMode="numeric"
                                value={(() => {
                                  const v = countOn(pot, d);
                                  return v === null ? '' : String(v);
                                })()}
                                onChange={e => editCount(pot, d, e.target.value)}
                                onBlur={() => commit(pot.pot)}
                                placeholder="—"
                                className="w-full px-2 py-1.5 text-sm text-center border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-purple-400"
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                      <p className="text-[10px] text-gray-400 mt-1">
                        Cumulative totals. Blank = not assessed; 0 = looked, nothing up.
                      </p>
                    </div>
                  )}

                  {/* Size-class distribution + live count check */}
                  <div>
                    <h4 className="text-xs font-semibold text-gray-700 mb-1.5">
                      Whole-seedling size classes
                    </h4>
                    <div className="grid grid-cols-2 gap-2">
                      {bands.map(band => {
                        const field = fields.find(f => f.id === sizeClassField(band.cls));
                        if (!field) return null;
                        return (
                          <div key={band.cls}>
                            <label className="text-[11px] text-gray-500 block mb-0.5">
                              Class {band.cls}
                              <span className="text-gray-400"> · {bandLabel(band)}</span>
                            </label>
                            <MeasurementInput
                              field={field}
                              value={pot.measurements?.[field.id]}
                              onChange={v => editMeasurement(pot, field.id, v)}
                              onCommit={() => commit(pot.pot)}
                            />
                          </div>
                        );
                      })}
                      <div>
                        <label className="text-[11px] text-gray-500 block mb-0.5">
                          Broken<span className="text-gray-400"> · unclassifiable</span>
                        </label>
                        <MeasurementInput
                          field={fields.find(f => f.id === BROKEN_FIELD)!}
                          value={pot.measurements?.[BROKEN_FIELD]}
                          onChange={v => editMeasurement(pot, BROKEN_FIELD, v)}
                          onCommit={() => commit(pot.pot)}
                        />
                      </div>
                    </div>

                    <div
                      className={`mt-2 flex items-center gap-1.5 text-[11px] px-2 py-1.5 rounded-lg border ${
                        check === 'ok'
                          ? 'bg-green-50 border-green-100 text-green-700'
                          : check === 'mismatch'
                            ? 'bg-orange-50 border-orange-100 text-orange-700'
                            : 'bg-gray-50 border-gray-100 text-gray-500'
                      }`}
                    >
                      {check === 'ok' ? <Check size={12} /> : check === 'mismatch' ? <AlertTriangle size={12} /> : null}
                      {check === 'pending'
                        ? germinated === null
                          ? 'Count this pot first — the classes are checked against its germination count.'
                          : `${germinated} germinated. Sort them into the bands above and the totals will be checked.`
                        : `${classified} sorted vs ${germinated} germinated${check === 'ok' ? ' — matches' : ' — these should agree'}`}
                    </div>

                    <p className="text-[10px] text-gray-400 mt-1">
                      Measure each intact seedling root tip → shoot tip and drop it in a band.
                      Bands are set per run in the run's settings.
                    </p>
                  </div>

                  {/* Endpoint observations */}
                  <div>
                    <h4 className="text-xs font-semibold text-gray-700 mb-1.5">At the endpoint</h4>
                    <div className="grid grid-cols-2 gap-2">
                      {fields
                        .filter(f => !f.id.startsWith('sizeClass') && f.id !== BROKEN_FIELD)
                        .map(field => (
                          <div key={field.id} className={field.kind === 'text' ? 'col-span-2' : ''}>
                            <label className="text-[11px] text-gray-500 block mb-0.5" title={field.hint}>
                              {field.label}
                              {field.unit ? <span className="text-gray-400"> ({field.unit})</span> : null}
                            </label>
                            {field.id === 'endpointDate' ? (
                              <input
                                type="date"
                                value={String(pot.measurements?.endpointDate ?? '')}
                                onChange={e => editMeasurement(pot, 'endpointDate', e.target.value)}
                                onBlur={() => commit(pot.pot)}
                                className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-green-primary"
                              />
                            ) : (
                              <MeasurementInput
                                field={field}
                                value={pot.measurements?.[field.id]}
                                onChange={v => editMeasurement(pot, field.id, v)}
                                onCommit={() => commit(pot.pot)}
                              />
                            )}
                            {field.hint && field.kind === 'choice' && (
                              <p className="text-[10px] text-gray-400 mt-0.5 leading-tight">{field.hint}</p>
                            )}
                          </div>
                        ))}
                    </div>
                  </div>

                  {/* Notes */}
                  <div>
                    <label className="text-[11px] text-gray-500 block mb-0.5">Pot notes</label>
                    <textarea
                      value={pot.notes ?? ''}
                      onChange={e => setDraft({ ...current(pot), notes: e.target.value })}
                      onBlur={() => commit(pot.pot)}
                      rows={2}
                      className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-green-primary"
                    />
                  </div>

                  {/* Photos — build treatments only. The media index is keyed by
                      system name, and a control isn't a build, so it has no key. */}
                  {treatment.kind === 'build' && treatment.system && treatment.trial && (
                    <div>
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <Ruler size={12} className="text-gray-400" />
                        <h4 className="text-xs font-semibold text-gray-700">Pot {pot.pot} photos</h4>
                      </div>
                      <p className="text-[10px] text-gray-500 mb-1.5">
                        Lay the seedlings out with a ruler in the frame, shot straight down.
                        A consistent top-down shot is what makes canopy comparable between pots.
                      </p>
                      {/* Photos are the one thing the sandbox can't fake. Uploads go
                          to Drive and write a row to the shared Media tab keyed by
                          system name — from a demo pile that would be a real row for
                          a build that doesn't exist. */}
                      {sandbox ? (
                        <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50/60 px-3 py-3 text-[11px] text-gray-500">
                          Photos are switched off in the practice space — they'd be saved
                          for real, and these piles don't exist. On a real trial, this is
                          where the pot's photos go.
                        </div>
                      ) : (
                        <InlinePhotoSlot
                          systemName={treatment.system.name}
                          slotId={`trial-${treatment.trial.id}-pot${pot.pot}`}
                          slotDef={{
                            id: `trial-${treatment.trial.id}-pot${pot.pot}`,
                            label: `Pot ${pot.pot}`,
                            description: `${treatment.label} — pot ${pot.pot}`,
                            kind: 'gallery',
                          } satisfies PhotoSlotDef}
                          defaultTag="trial"
                          heightClass="h-40"
                        />
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
