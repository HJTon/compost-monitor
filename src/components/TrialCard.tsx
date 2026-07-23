import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronRight, Save, Trash2, CheckCircle2 } from 'lucide-react';
import { EditableSelect } from './EditableSelect';
import { InlinePhotoSlot } from './InlinePhotoSlot';
import { MeasurementInput, normaliseMeasurements } from './MeasurementInput';
import { useCompost } from '@/contexts/CompostContext';
import { getNZDate } from '@/utils/config';
import {
  TRIAL_TYPES,
  TRIAL_TYPE_BADGE,
  VERDICT_BADGE,
  PASS_THRESHOLD_PCT,
  percentOfControl,
  protocolVerdict,
  trialStatus,
  trialStart,
  trialTypeDef,
  trialTypeOf,
} from '@/utils/trials';
import {
  VISUAL_OBSERVATIONS,
  displayValue,
  fieldsFor,
  observationLabel,
} from '@/utils/trialFields';
import { formatNiceDate } from './BuildVitals';
import type { PhotoSlotDef } from '@/utils/photoSlots';
import type { CompostSystem, GrowTrial, TrialMeasurements, TrialType } from '@/types';

interface TrialCardProps {
  system: CompostSystem;
  trial: GrowTrial;
  /** Public / print view — view only, no editing or photo uploads */
  readOnly: boolean;
  /** Parent rebuilds GrowInfo and persists via setSystemPhase */
  onChange: (next: GrowTrial) => Promise<void> | void;
  onRemove?: (trial: GrowTrial) => void;
  /** Start expanded (used when linking straight to a trial) */
  defaultExpanded?: boolean;
}

/** A number typed into a text box, or null when it's blank / not a number. */
function toNum(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/** Small PASS / CHECK chip. Renders nothing when there's no verdict. */
function VerdictBadge({ verdict, pct }: { verdict: 'pass' | 'check' | null; pct: number | null }) {
  if (!verdict) return null;
  return (
    <span
      className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border ${VERDICT_BADGE[verdict]}`}
      title={pct !== null ? `${pct}% of the control (pass at ${PASS_THRESHOLD_PCT}%)` : undefined}
    >
      {verdict === 'pass' ? 'Pass' : 'Check'}
    </span>
  );
}

/**
 * Expandable grow-trial card — the fix for "I added trial details but can't
 * seem to access this". Collapsed it shows type / crop / method / status;
 * expanded it's a full editor with dates, the protocol's measured fields for
 * this trial's stage, visual observations, per-trial photos and free-text notes.
 */
export function TrialCard({ system, trial, readOnly, onChange, onRemove, defaultExpanded }: TrialCardProps) {
  const {
    addToast,
    trialMethods,
    trialCrops,
    addTrialMethod,
    addTrialCrop,
    getTrialRun,
  } = useCompost();
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(!!defaultExpanded);

  // Draft state — only pushed to the parent on Save so a half-edited card
  // never overwrites the stored trial.
  const [method, setMethod] = useState(trial.method || '');
  const [crop, setCrop] = useState(trial.crop || '');
  const [type, setType] = useState<TrialType>(trialTypeOf(trial));
  const [startedAt, setStartedAt] = useState(trialStart(trial));
  const [endedAt, setEndedAt] = useState(trial.endedAt || '');
  const [plannedDays, setPlannedDays] = useState(
    trial.plannedDays != null ? String(trial.plannedDays) : ''
  );
  const [notes, setNotes] = useState(trial.notes || '');
  const [result, setResult] = useState(trial.result || '');
  const [measurements, setMeasurements] = useState<TrialMeasurements>({ ...(trial.measurements || {}) });
  const [observations, setObservations] = useState<string[]>(trial.observations || []);
  const [replicates, setReplicates] = useState(trial.replicates != null ? String(trial.replicates) : '');
  const [ph, setPh] = useState(trial.phAtStart != null ? String(trial.phAtStart) : '');
  const [saving, setSaving] = useState(false);

  const resultRef = useRef<HTMLTextAreaElement>(null);

  // Keep drafts in step when the stored trial actually changes underneath us.
  // Keyed on the serialised trial (not object identity) so an unrelated context
  // re-render can't wipe half-typed edits.
  const trialSignature = JSON.stringify(trial);
  useEffect(() => {
    setMethod(trial.method || '');
    setCrop(trial.crop || '');
    setType(trialTypeOf(trial));
    setStartedAt(trialStart(trial));
    setEndedAt(trial.endedAt || '');
    setPlannedDays(trial.plannedDays != null ? String(trial.plannedDays) : '');
    setNotes(trial.notes || '');
    setResult(trial.result || '');
    setMeasurements({ ...(trial.measurements || {}) });
    setObservations(trial.observations || []);
    setReplicates(trial.replicates != null ? String(trial.replicates) : '');
    setPh(trial.phAtStart != null ? String(trial.phAtStart) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trialSignature]);

  // Shared across devices via the Trial Methods / Trial Crops sheet tabs.
  const methodOptions = trialMethods;
  const cropOptions = trialCrops;

  const status = trialStatus(trial);
  const def = trialTypeDef(trialTypeOf(trial));
  const start = trialStart(trial);

  // The run supplies the controls the pass rule compares against, and the
  // seeds-sown denominator when the pot's own count wasn't entered.
  const run = trial.runId ? getTrialRun(trial.runId) : undefined;

  // Fields follow the *draft* type, so switching stage swaps the editor live.
  const editFields = fieldsFor(type);
  const storedFields = fieldsFor(trialTypeOf(trial));
  const replicateNum = toNum(replicates);

  const draftMeasurements = useMemo(
    () => normaliseMeasurements(editFields, measurements),
    [editFields, measurements]
  );

  // Verdict shown while editing follows the drafts; the collapsed header shows
  // what is actually stored.
  const draftTrial: GrowTrial = {
    ...trial,
    trialType: type,
    measurements: draftMeasurements,
    replicates: replicateNum ?? undefined,
  };
  const liveVerdict = protocolVerdict(draftTrial, run);
  const livePct = percentOfControl(draftTrial, run);
  const storedVerdict = protocolVerdict(trial, run);
  const storedPct = percentOfControl(trial, run);

  const computeCtx = { replicates: replicateNum, seedsSown: run?.seedsSown ?? null };
  const storedCtx = { replicates: trial.replicates ?? null, seedsSown: run?.seedsSown ?? null };

  const slotId = `trial-${trial.id}`;
  const slotDef: PhotoSlotDef = {
    id: slotId,
    label: 'Trial photos',
    description: `${def.label} — ${trial.crop || 'trial'}`,
    kind: 'gallery',
  };

  const setMeasurement = (fieldId: string, value: TrialMeasurements[string]) =>
    setMeasurements(prev => ({ ...prev, [fieldId]: value }));

  const toggleObservation = (id: string) =>
    setObservations(prev => (prev.includes(id) ? prev.filter(o => o !== id) : [...prev, id]));

  /** Build the next trial from the drafts, keeping every untouched field. */
  const buildNext = (overrides: Partial<GrowTrial> = {}): GrowTrial => {
    const days = plannedDays.trim() ? parseInt(plannedDays, 10) : NaN;
    const phNum = toNum(ph);
    return {
      ...trial,
      method: method.trim() || trial.method,
      crop: crop.trim() || trial.crop,
      trialType: type,
      startedAt: startedAt || trialStart(trial),
      endedAt: endedAt || undefined,
      plannedDays: Number.isFinite(days) && days > 0 ? days : null,
      notes: notes.trim() || undefined,
      result: result.trim() || undefined,
      replicates: replicateNum ?? undefined,
      phAtStart: ph.trim() ? phNum : undefined,
      measurements: Object.keys(draftMeasurements).length > 0 ? draftMeasurements : undefined,
      observations: observations.length > 0 ? observations : undefined,
      ...overrides,
    };
  };

  const persist = async (next: GrowTrial, message: string) => {
    setSaving(true);
    try {
      await onChange(next);
      addToast('success', message);
    } catch {
      addToast('error', 'Could not save the trial');
    } finally {
      setSaving(false);
    }
  };

  const handleSave = () => persist(buildNext(), 'Trial saved');

  const handleMarkComplete = async () => {
    const today = getNZDate();
    setEndedAt(today);
    await persist(buildNext({ endedAt: today }), 'Trial marked complete');
    // Nudge the user straight into writing up the outcome.
    setTimeout(() => resultRef.current?.focus(), 50);
  };

  return (
    <div className="border border-purple-100 rounded-xl bg-purple-50/40 overflow-hidden">
      {/* Collapsed header — always visible */}
      <button
        type="button"
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-purple-50 transition-colors"
      >
        <span className="text-purple-400 shrink-0">
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border ${TRIAL_TYPE_BADGE[trialTypeOf(trial)]}`}>
              {def.short}
            </span>
            <span className="text-xs font-medium text-purple-900 truncate">
              {trial.crop || '—'}{trial.method ? ` · ${trial.method}` : ''}
            </span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${status.chipClass}`}>
              {status.label}
            </span>
            <VerdictBadge verdict={storedVerdict} pct={storedPct} />
          </div>
          <p className="text-[11px] text-gray-500 mt-0.5">
            Started {formatNiceDate(start) || start || '—'}
            {trial.endedAt ? ` · Ended ${formatNiceDate(trial.endedAt) || trial.endedAt}` : ''}
          </p>
        </div>
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-3 border-t border-purple-100 pt-3">
          {readOnly ? (
            // ── Read-only detail (public view) ──────────────────────────────
            <div className="space-y-2 text-xs text-gray-700">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-gray-400">Method</div>
                  <div>{trial.method || '—'}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-gray-400">Crop</div>
                  <div>{trial.crop || '—'}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-gray-400">Start</div>
                  <div>{formatNiceDate(start) || start || '—'}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-gray-400">End</div>
                  <div>{trial.endedAt ? (formatNiceDate(trial.endedAt) || trial.endedAt) : '—'}</div>
                </div>
                {trial.replicates != null && (
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-gray-400">Pots (replicates)</div>
                    <div>{trial.replicates}</div>
                  </div>
                )}
                {trial.phAtStart != null && (
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-gray-400">pH at start</div>
                    <div>{trial.phAtStart}</div>
                  </div>
                )}
              </div>

              {storedFields.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">Measurements</div>
                  <div className="grid grid-cols-2 gap-x-2 gap-y-1">
                    {storedFields.map(f => (
                      <div key={f.id} className="flex items-baseline justify-between gap-2">
                        <span className="text-[11px] text-gray-500 truncate">{f.label}</span>
                        <span className={`text-[11px] font-medium ${f.derived ? 'text-purple-700' : 'text-gray-800'}`}>
                          {displayValue(f, trial.measurements, storedCtx)}
                        </span>
                      </div>
                    ))}
                  </div>
                  {storedPct !== null && (
                    <p className="text-[11px] text-gray-500 mt-1">
                      {storedPct}% of the control · pass at {PASS_THRESHOLD_PCT}%
                    </p>
                  )}
                </div>
              )}

              {(trial.observations?.length ?? 0) > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-gray-400">Visual observations</div>
                  <p>{(trial.observations || []).map(observationLabel).join(', ')}</p>
                </div>
              )}

              {trial.notes && (
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-gray-400">Notes</div>
                  <p className="whitespace-pre-wrap">{trial.notes}</p>
                </div>
              )}
              {trial.result && (
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-gray-400">Notes on the outcome</div>
                  <p className="whitespace-pre-wrap">{trial.result}</p>
                </div>
              )}
            </div>
          ) : (
            // ── Editor ──────────────────────────────────────────────────────
            <>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">Trial type</label>
                <div className="flex flex-wrap gap-1.5">
                  {TRIAL_TYPES.map(t => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setType(t.id)}
                      className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                        type === t.id
                          ? 'border-purple-400 bg-purple-100 text-purple-800 font-medium'
                          : 'border-gray-200 bg-white text-gray-600 hover:border-purple-200'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              <EditableSelect
                label="Method"
                value={method}
                options={methodOptions}
                onChange={setMethod}
                onAddOption={addTrialMethod}
              />
              <EditableSelect
                label="Crop"
                value={crop}
                options={cropOptions}
                onChange={setCrop}
                onAddOption={addTrialCrop}
              />

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-medium text-gray-500 block mb-1">Start date</label>
                  <input
                    type="date"
                    value={startedAt}
                    onChange={e => setStartedAt(e.target.value)}
                    className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-green-primary"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 block mb-1">End date</label>
                  <input
                    type="date"
                    value={endedAt}
                    onChange={e => setEndedAt(e.target.value)}
                    className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-green-primary"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">Planned days</label>
                <input
                  type="number"
                  min={1}
                  value={plannedDays}
                  onChange={e => setPlannedDays(e.target.value)}
                  placeholder="Blank = open-ended"
                  className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-green-primary"
                />
              </div>

              {/* ── Protocol measurements ─────────────────────────────────────
                  Crop trials record no structured fields in v1, so this whole
                  block disappears and the card stays exactly as it was. */}
              {editFields.length > 0 && (
                <div className="rounded-lg border border-purple-100 bg-white/70 p-2.5 space-y-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold text-purple-900">Measurements</span>
                    <VerdictBadge verdict={liveVerdict} pct={livePct} />
                    {livePct !== null && (
                      <span className="text-[11px] text-gray-500">
                        {livePct}% of control · pass at {PASS_THRESHOLD_PCT}%
                      </span>
                    )}
                    {run ? (
                      <button
                        type="button"
                        onClick={() => navigate(`/trials/${run.runId}`)}
                        className="text-[11px] text-green-primary font-medium ml-auto"
                      >
                        Run table →
                      </button>
                    ) : (
                      <span className="text-[11px] text-gray-400">Not in a run — no control to compare against</span>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs font-medium text-gray-500 block mb-1">Pots (replicates)</label>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={replicates}
                        onChange={e => setReplicates(e.target.value)}
                        placeholder="Protocol: 3"
                        className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-green-primary"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-500 block mb-1">pH at start</label>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={ph}
                        onChange={e => setPh(e.target.value)}
                        placeholder="e.g. 7.2"
                        className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-green-primary"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    {editFields.map(f => (
                      <div key={f.id} className={f.kind === 'text' ? 'col-span-2' : ''}>
                        <label className="text-xs font-medium text-gray-500 block mb-1">
                          {f.label}
                          {f.unit ? <span className="text-gray-400"> ({f.unit})</span> : null}
                        </label>
                        {f.derived ? (
                          <div
                            className="w-full px-2 py-1.5 text-sm border border-purple-100 rounded-lg bg-purple-50 text-purple-800 font-medium"
                            title={f.hint}
                          >
                            {displayValue(f, draftMeasurements, computeCtx)}
                            <span className="text-[10px] text-purple-400 ml-1.5 font-normal">calculated</span>
                          </div>
                        ) : (
                          <MeasurementInput
                            field={f}
                            value={measurements[f.id]}
                            onChange={v => setMeasurement(f.id, v)}
                          />
                        )}
                        {f.hint && !f.derived && (
                          <p className="text-[10px] text-gray-400 mt-0.5">{f.hint}</p>
                        )}
                      </div>
                    ))}
                  </div>

                  <div>
                    <label className="text-xs font-medium text-gray-500 block mb-1">Visual observations</label>
                    <div className="grid grid-cols-2 gap-1">
                      {VISUAL_OBSERVATIONS.map(o => {
                        const on = observations.includes(o.id);
                        return (
                          <label
                            key={o.id}
                            className={`flex items-center gap-1.5 text-[11px] px-1.5 py-1 rounded-md border cursor-pointer ${
                              on
                                ? o.good
                                  ? 'border-green-200 bg-green-50 text-green-800'
                                  : 'border-amber-200 bg-amber-50 text-amber-800'
                                : 'border-gray-200 bg-white text-gray-600'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={on}
                              onChange={() => toggleObservation(o.id)}
                              className="w-3.5 h-3.5 rounded border-gray-300 text-purple-600 focus:ring-purple-400"
                            />
                            <span className="truncate">{o.label}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">Notes</label>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  rows={2}
                  placeholder="e.g. South bed, row 2"
                  className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-green-primary"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">Notes on the outcome</label>
                <textarea
                  ref={resultRef}
                  value={result}
                  onChange={e => setResult(e.target.value)}
                  rows={2}
                  placeholder="e.g. 18/20 germinated, no leaf distortion"
                  className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-green-primary"
                />
              </div>

              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-purple-600 text-white font-medium disabled:opacity-50"
                >
                  <Save size={12} />
                  {saving ? 'Saving…' : 'Save'}
                </button>
                {!trial.endedAt && (
                  <button
                    type="button"
                    onClick={handleMarkComplete}
                    disabled={saving}
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border border-green-300 text-green-700 font-medium hover:bg-green-50 disabled:opacity-50"
                  >
                    <CheckCircle2 size={12} />
                    Mark complete
                  </button>
                )}
                {onRemove && (
                  <button
                    type="button"
                    onClick={() => onRemove(trial)}
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border border-gray-200 text-gray-500 hover:text-red-500 hover:border-red-200 ml-auto"
                  >
                    <Trash2 size={12} />
                    Remove
                  </button>
                )}
              </div>
            </>
          )}

          {/* Per-trial photos — Media tab rows keyed System + Slot, no backend change */}
          <div className="pt-1">
            <InlinePhotoSlot
              systemName={system.name}
              slotId={slotId}
              slotDef={slotDef}
              defaultTag="trial"
              heightClass="h-48"
              readOnly={readOnly}
            />
          </div>
        </div>
      )}
    </div>
  );
}
