import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { EditableSelect } from './EditableSelect';
import { useCompost } from '@/contexts/CompostContext';
import {
  DEFAULT_CONTAINER_TYPES,
  DEFAULT_PLACEMENTS,
  DEFAULT_COVER_TYPES,
  getNZDate,
  generateId,
} from '@/utils/config';
import {
  TRIAL_TYPES,
  BROAD_BEAN_CROP,
  hasCompletedGermination,
  trialStatus,
  trialTypeDef,
} from '@/utils/trials';
import { PROTOCOL_RUN_DEFAULTS } from '@/utils/trialFields';
import { pileCountsByRun, runAsTrial } from '@/utils/trialRuns';
import { formatNiceDate } from './BuildVitals';
import type { CompostSystem, MaturationInfo, GrowTrial, TrialRun, TrialType } from '@/types';

interface Props {
  system: CompostSystem;
  mode: 'toMaturation' | 'toGrow' | 'addTrial';
  onClose: () => void;
}

/** Which run this trial joins: none, an existing one (by id), or a brand new one. */
type RunChoice = { kind: 'none' } | { kind: 'existing'; runId: string } | { kind: 'new' };

export function PhaseModal({ system, mode, onClose }: Props) {
  const {
    settings,
    updateSettings,
    setSystemPhase,
    addToast,
    trialMethods,
    trialCrops,
    addTrialMethod,
    addTrialCrop,
    allSystems,
    trialRuns,
    saveTrialRun,
  } = useCompost();

  // Maturation state
  const [containerType, setContainerType] = useState(system.maturation?.containerType || '');
  const [placement, setPlacement] = useState(system.maturation?.placement || '');
  const [coverType, setCoverType] = useState(system.maturation?.coverType || '');

  // Shared date (auto-filled to today, editable — lets us back-date transitions)
  const [date, setDate] = useState(getNZDate());

  // Trial state
  const [trialType, setTrialType] = useState<TrialType>('germination');
  const [plannedDays, setPlannedDays] = useState<string>('5');
  const [method, setMethod] = useState('');
  const [crop, setCrop] = useState('');
  const [notes, setNotes] = useState('');

  // Run state — a trial can join an existing protocol run, start one, or stand alone.
  const [runChoice, setRunChoice] = useState<RunChoice>({ kind: 'none' });
  const [seedsSown, setSeedsSown] = useState<string>(
    PROTOCOL_RUN_DEFAULTS['germination'].seedsSown != null
      ? String(PROTOCOL_RUN_DEFAULTS['germination'].seedsSown)
      : ''
  );

  const existingTrials = system.grow?.trials ?? [];
  // Non-blocking protocol nudge — germination usually comes first.
  const showProtocolNudge =
    (trialType === 'growth-test' || trialType === 'crop') &&
    !hasCompletedGermination(existingTrials);

  /** How many piles already sit in each run — shown against every option. */
  const pilesInRun = useMemo(() => pileCountsByRun(allSystems), [allSystems]);

  // Runs this trial could join: same stage, newest first. A run this build is
  // already in still shows — a pile can be re-tested in a later run.
  const runsForType = useMemo(
    () => trialRuns
      .filter(r => r.type === trialType)
      .slice()
      .sort((a, b) => (b.startDate || '').localeCompare(a.startDate || '')),
    [trialRuns, trialType]
  );

  const selectedRun: TrialRun | null =
    runChoice.kind === 'existing'
      ? trialRuns.find(r => r.runId === runChoice.runId) || null
      : null;

  const pickTrialType = (type: TrialType) => {
    setTrialType(type);
    const def = TRIAL_TYPES.find(t => t.id === type);
    setPlannedDays(def?.days != null ? String(def.days) : '');
    // Broad bean test defaults its crop — still changeable.
    if (type === 'growth-test' && !crop) setCrop(BROAD_BEAN_CROP);
    // Runs belong to one stage, so a run picked for the old type can't carry over.
    setRunChoice({ kind: 'none' });
    const sown = PROTOCOL_RUN_DEFAULTS[type].seedsSown;
    setSeedsSown(sown != null ? String(sown) : '');
  };

  /** Joining a run adopts its start date and duration. */
  const pickRun = (choice: RunChoice) => {
    setRunChoice(choice);
    if (choice.kind === 'existing') {
      const run = trialRuns.find(r => r.runId === choice.runId);
      if (run) {
        if (run.startDate) setDate(run.startDate);
        setPlannedDays(run.plannedDays != null ? String(run.plannedDays) : '');
      }
    }
  };

  const [saving, setSaving] = useState(false);

  const containerOptions = [...DEFAULT_CONTAINER_TYPES, ...(settings.customContainerTypes || [])];
  const placementOptions = [...DEFAULT_PLACEMENTS, ...(settings.customPlacements || [])];
  const coverOptions = [...DEFAULT_COVER_TYPES, ...(settings.customCoverTypes || [])];
  // Trial methods/crops are shared across devices via the Google Sheet.
  const methodOptions = trialMethods;
  const cropOptions = trialCrops;

  const addCustom = (key: keyof typeof settings, value: string) =>
    updateSettings({ [key]: [...((settings[key] as string[] | undefined) || []), value] });

  const handleSaveMaturation = async () => {
    if (!containerType || !placement || !coverType) {
      addToast('error', 'Please fill in all three dropdowns');
      return;
    }
    setSaving(true);
    const info: MaturationInfo = {
      containerType,
      placement,
      coverType,
      startedAt: date,
    };
    await setSystemPhase(system.id, 'maturation', {
      maturation: info,
      transitionNote: `→ Maturation (${date}): ${containerType} · ${placement} · ${coverType}`,
    });
    addToast('success', `${system.name} moved to Maturation`);
    onClose();
  };

  const handleMoveToGrow = async () => {
    setSaving(true);
    await setSystemPhase(system.id, 'grow', {
      grow: system.grow || { startedAt: date, trials: [] },
      transitionNote: `→ Grow phase started (${date})`,
    });
    addToast('success', `${system.name} moved to Grow phase`);
    onClose();
  };

  const handleAddTrial = async () => {
    if (!method || !crop) {
      addToast('error', 'Pick a method and a crop');
      return;
    }
    setSaving(true);

    // Resolve the run first — a new one has to exist before a trial points at it.
    let runId: string | undefined;
    let startDate = date;
    let days = plannedDays.trim() ? parseInt(plannedDays, 10) : NaN;

    if (runChoice.kind === 'existing' && selectedRun) {
      runId = selectedRun.runId;
      // Inherit the run's shared schedule so every pile in it lines up.
      startDate = selectedRun.startDate || date;
      days = selectedRun.plannedDays ?? NaN;
    } else if (runChoice.kind === 'new') {
      runId = generateId();
      const sown = seedsSown.trim() ? Number(seedsSown) : NaN;
      await saveTrialRun({
        runId,
        type: trialType,
        startDate: date,
        plannedDays: Number.isFinite(days) && days > 0 ? days : null,
        seedsSown: Number.isFinite(sown) ? sown : null,
        controls: [],
        notes: '',
        updatedAt: new Date().toISOString(),
      });
    }

    const replicates = PROTOCOL_RUN_DEFAULTS[trialType].replicates;
    const trial: GrowTrial = {
      id: generateId(),
      method,
      crop,
      notes: notes.trim() || undefined,
      createdAt: `${startDate}T00:00:00`,
      trialType,
      startedAt: startDate,
      plannedDays: Number.isFinite(days) && days > 0 ? days : null,
      runId,
      replicates: runId && replicates != null ? replicates : undefined,
    };
    const current = system.grow || { startedAt: startDate, trials: [] };
    const next = { ...current, trials: [...current.trials, trial] };
    const typeLabel = TRIAL_TYPES.find(t => t.id === trialType)?.label || 'Trial';
    await setSystemPhase(system.id, 'grow', {
      grow: next,
      transitionNote: `+ ${typeLabel} (${startDate}): ${method} · ${crop}`,
    });
    addToast('success', runId ? 'Trial added to the run' : 'Trial added');
    onClose();
  };

  const title =
    mode === 'toMaturation' ? `Move ${system.name} to Maturation` :
    mode === 'toGrow' ? `Move ${system.name} to Grow phase` :
    `Add trial to ${system.name}`;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 sticky top-0 bg-white">
          <h2 className="font-semibold text-gray-900">{title}</h2>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600">
            <X size={18} />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <div>
            <label className="text-xs font-medium text-gray-500 block mb-1">
              {mode === 'addTrial' ? 'Trial start date' : 'Transition date'}
            </label>
            <input
              type="date"
              value={date}
              max={getNZDate()}
              disabled={mode === 'addTrial' && !!selectedRun}
              onChange={e => setDate(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-green-primary disabled:bg-gray-50 disabled:text-gray-400"
            />
            <p className="text-xs text-gray-400 mt-1">
              {mode === 'addTrial' && selectedRun
                ? 'Inherited from the run this trial joins.'
                : "Defaults to today — change it if you're recording this after the fact."}
            </p>
          </div>

          {mode === 'toMaturation' && (
            <>
              <p className="text-sm text-gray-600">
                Capture how the pile is set up for maturation. You can add new options to any dropdown with the + button.
              </p>
              <EditableSelect
                label="Container"
                value={containerType}
                options={containerOptions}
                onChange={setContainerType}
                onAddOption={v => addCustom('customContainerTypes', v)}
              />
              <EditableSelect
                label="Placement"
                value={placement}
                options={placementOptions}
                onChange={setPlacement}
                onAddOption={v => addCustom('customPlacements', v)}
              />
              <EditableSelect
                label="Cover"
                value={coverType}
                options={coverOptions}
                onChange={setCoverType}
                onAddOption={v => addCustom('customCoverTypes', v)}
              />
              <div className="pt-2 flex gap-2">
                <button
                  onClick={onClose}
                  className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg text-gray-600"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveMaturation}
                  disabled={saving}
                  className="flex-1 px-3 py-2 text-sm bg-amber-600 text-white rounded-lg font-medium disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Move to Maturation'}
                </button>
              </div>
            </>
          )}

          {mode === 'toGrow' && (
            <>
              <p className="text-sm text-gray-600">
                The Grow phase is where you test how the compost performs. Once moved, you can set up multiple trials on this build.
              </p>
              <div className="pt-2 flex gap-2">
                <button
                  onClick={onClose}
                  className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg text-gray-600"
                >
                  Cancel
                </button>
                <button
                  onClick={handleMoveToGrow}
                  disabled={saving}
                  className="flex-1 px-3 py-2 text-sm bg-purple-600 text-white rounded-lg font-medium disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Move to Grow phase'}
                </button>
              </div>
            </>
          )}

          {mode === 'addTrial' && (
            <>
              {/* Protocol stage — pick this first, it prefills the rest */}
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">Trial type</label>
                <div className="space-y-1.5">
                  {TRIAL_TYPES.map(t => {
                    const active = trialType === t.id;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => pickTrialType(t.id)}
                        className={`w-full text-left px-3 py-2 rounded-lg border transition-colors ${
                          active
                            ? 'border-purple-400 bg-purple-50'
                            : 'border-gray-200 bg-white hover:border-purple-200'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className={`text-sm font-medium ${active ? 'text-purple-900' : 'text-gray-800'}`}>
                            {t.label}
                          </span>
                          <span className="text-[11px] text-gray-400 shrink-0">
                            {t.days != null ? `${t.days} days` : 'open-ended'}
                          </span>
                        </div>
                        <p className="text-xs text-gray-500 mt-0.5">{t.hint}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {showProtocolNudge && (
                <p className="text-xs text-purple-700 bg-purple-50 border border-purple-100 rounded-lg px-3 py-2">
                  Tip: the 5-day germination test usually comes first.
                </p>
              )}

              {/* ── Protocol run ────────────────────────────────────────────
                  One experiment spans many piles: joining a run shares its
                  start date, duration and — critically — its control pots. */}
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">Protocol run</label>
                <div className="space-y-1.5">
                  {runsForType.map(run => {
                    const active = runChoice.kind === 'existing' && runChoice.runId === run.runId;
                    const status = trialStatus(runAsTrial(run));
                    const piles = pilesInRun.get(run.runId) || 0;
                    return (
                      <button
                        key={run.runId}
                        type="button"
                        onClick={() => pickRun({ kind: 'existing', runId: run.runId })}
                        className={`w-full text-left px-3 py-2 rounded-lg border transition-colors ${
                          active ? 'border-purple-400 bg-purple-50' : 'border-gray-200 bg-white hover:border-purple-200'
                        }`}
                      >
                        <div className="text-sm font-medium text-gray-800">
                          {trialTypeDef(run.type).label}
                          <span className="font-normal text-gray-500">
                            {' · '}started {formatNiceDate(run.startDate) || run.startDate || '—'}
                          </span>
                        </div>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {piles} pile{piles === 1 ? '' : 's'} · {status.label}
                          {run.seedsSown != null ? ` · ${run.seedsSown} seeds sown` : ''}
                        </p>
                      </button>
                    );
                  })}

                  <button
                    type="button"
                    onClick={() => pickRun({ kind: 'new' })}
                    className={`w-full text-left px-3 py-2 rounded-lg border transition-colors ${
                      runChoice.kind === 'new' ? 'border-purple-400 bg-purple-50' : 'border-gray-200 bg-white hover:border-purple-200'
                    }`}
                  >
                    <div className="text-sm font-medium text-gray-800">Start a new run</div>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Controls are added afterwards on the run page.
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => pickRun({ kind: 'none' })}
                    className={`w-full text-left px-3 py-2 rounded-lg border transition-colors ${
                      runChoice.kind === 'none' ? 'border-purple-400 bg-purple-50' : 'border-gray-200 bg-white hover:border-purple-200'
                    }`}
                  >
                    <div className="text-sm font-medium text-gray-800">Not part of a run</div>
                    <p className="text-xs text-gray-500 mt-0.5">
                      A one-off trial on this pile — no shared controls, so no pass/check verdict.
                    </p>
                  </button>
                </div>
              </div>

              {selectedRun && (
                <p className="text-xs text-gray-500 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2">
                  Start date and planned days come from the run
                  {selectedRun.startDate ? ` (${formatNiceDate(selectedRun.startDate) || selectedRun.startDate})` : ''}.
                </p>
              )}

              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">Planned days (optional)</label>
                <input
                  type="number"
                  min={1}
                  value={plannedDays}
                  disabled={!!selectedRun}
                  onChange={e => setPlannedDays(e.target.value)}
                  placeholder="Leave blank for open-ended"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-green-primary disabled:bg-gray-50 disabled:text-gray-400"
                />
              </div>

              {runChoice.kind === 'new' && (
                <div>
                  <label className="text-xs font-medium text-gray-500 block mb-1">Seeds sown per pot</label>
                  <input
                    type="number"
                    min={1}
                    value={seedsSown}
                    onChange={e => setSeedsSown(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-green-primary"
                  />
                  <p className="text-xs text-gray-400 mt-1">
                    Protocol: 25 mustard seeds per pot, 1 broad bean per pot.
                  </p>
                </div>
              )}

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
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">Notes (optional)</label>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  rows={2}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-green-primary"
                  placeholder="e.g. South bed, row 2"
                />
              </div>
              <div className="pt-2 flex gap-2">
                <button
                  onClick={onClose}
                  className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg text-gray-600"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddTrial}
                  disabled={saving}
                  className="flex-1 px-3 py-2 text-sm bg-purple-600 text-white rounded-lg font-medium disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Add trial'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
