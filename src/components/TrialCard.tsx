import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Save, Trash2, CheckCircle2 } from 'lucide-react';
import { EditableSelect } from './EditableSelect';
import { InlinePhotoSlot } from './InlinePhotoSlot';
import { useCompost } from '@/contexts/CompostContext';
import {
  DEFAULT_TRIAL_METHODS,
  DEFAULT_TRIAL_CROPS,
  getNZDate,
} from '@/utils/config';
import {
  TRIAL_TYPES,
  TRIAL_TYPE_BADGE,
  trialStatus,
  trialStart,
  trialTypeDef,
  trialTypeOf,
} from '@/utils/trials';
import { formatNiceDate } from './BuildVitals';
import type { PhotoSlotDef } from '@/utils/photoSlots';
import type { CompostSystem, GrowTrial, TrialType } from '@/types';

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

/**
 * Expandable grow-trial card — the fix for "I added trial details but can't
 * seem to access this". Collapsed it shows type / crop / method / status;
 * expanded it's a full editor with dates, result and per-trial photos.
 */
export function TrialCard({ system, trial, readOnly, onChange, onRemove, defaultExpanded }: TrialCardProps) {
  const { settings, updateSettings, addToast } = useCompost();
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trialSignature]);

  const methodOptions = [...DEFAULT_TRIAL_METHODS, ...(settings.customTrialMethods || [])];
  const cropOptions = [...DEFAULT_TRIAL_CROPS, ...(settings.customTrialCrops || [])];

  const addCustom = (key: 'customTrialMethods' | 'customTrialCrops', value: string) =>
    updateSettings({ [key]: [...((settings[key] as string[] | undefined) || []), value] });

  const status = trialStatus(trial);
  const def = trialTypeDef(trialTypeOf(trial));
  const start = trialStart(trial);

  const slotId = `trial-${trial.id}`;
  const slotDef: PhotoSlotDef = {
    id: slotId,
    label: 'Trial photos',
    description: `${def.label} — ${trial.crop || 'trial'}`,
    kind: 'gallery',
  };

  /** Build the next trial from the drafts, keeping every untouched field. */
  const buildNext = (overrides: Partial<GrowTrial> = {}): GrowTrial => {
    const days = plannedDays.trim() ? parseInt(plannedDays, 10) : NaN;
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
              </div>
              {trial.notes && (
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-gray-400">Notes</div>
                  <p className="whitespace-pre-wrap">{trial.notes}</p>
                </div>
              )}
              {trial.result && (
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-gray-400">Result</div>
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
                onAddOption={v => addCustom('customTrialMethods', v)}
              />
              <EditableSelect
                label="Crop"
                value={crop}
                options={cropOptions}
                onChange={setCrop}
                onAddOption={v => addCustom('customTrialCrops', v)}
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
                <label className="text-xs font-medium text-gray-500 block mb-1">Result</label>
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
