import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChevronDown, ChevronUp, Plus, Settings2, Trash2, X } from 'lucide-react';
import { Header } from '@/components/Header';
import { formatNiceDate } from '@/components/BuildVitals';
import { MeasurementInput, normaliseMeasurements } from '@/components/MeasurementInput';
import { useCompost } from '@/contexts/CompostContext';
import { generateId, getNZDate } from '@/utils/config';
import {
  PASS_THRESHOLD_PCT,
  VERDICT_BADGE,
  controlStrikeRate,
  percentOfControl,
  protocolVerdict,
  runControlStrikeRate,
  trialStatus,
  trialStrikeRate,
  trialTypeDef,
  BROAD_BEAN_CROP,
} from '@/utils/trials';
import {
  EMPTY_VALUE,
  PROTOCOL_RUN_DEFAULTS,
  displayValue,
  fieldsFor,
} from '@/utils/trialFields';
import { runAsTrial, runMembers } from '@/utils/trialRuns';
import type {
  CompostSystem,
  GrowTrial,
  TrialControl,
  TrialMeasurements,
  TrialType,
} from '@/types';

/** Crop prefilled when a pile is added straight from the run table. */
const RUN_CROP: Record<TrialType, string> = {
  'germination': 'Mustard',
  'growth-test': BROAD_BEAN_CROP,
  'crop': '',
};

/** A number typed into a text box, or null when it's blank / not a number. */
function toNum(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/**
 * The replacement for Caroline's Word result table.
 *
 * Rows are every pile whose trial points at this run, plus the run's own
 * control pots; columns are the stage's protocol fields; every cell edits in
 * place. The pass rule (90% of the control) is stated in the header so the
 * verdict column is never a black box.
 *
 * Layout note: the table scrolls inside its own `overflow-x-auto` box with a
 * sticky first column, so at 375px the page body never moves sideways.
 */
export function TrialRunPage() {
  const { runId } = useParams<{ runId: string }>();
  const navigate = useNavigate();
  const {
    allSystems,
    settings,
    getTrialRun,
    saveTrialRun,
    setSystemPhase,
    addToast,
  } = useCompost();

  const run = runId ? getTrialRun(runId) : undefined;

  // Per-cell drafts, keyed `t:<trialId>` / `c:<controlId>`. A key only appears
  // once that row has been touched, so a background refresh can't wipe typing
  // in a row the user isn't editing.
  const [drafts, setDrafts] = useState<Record<string, TrialMeasurements>>({});
  // Pile replicates live on the trial, not in its measurements, so they get
  // their own draft map.
  const [repDrafts, setRepDrafts] = useState<Record<string, string>>({});
  // Mirrors of both maps. A choice/checkbox cell commits in the same tick it
  // changes, before React has flushed state, so the commit path reads the refs.
  const draftsRef = useRef<Record<string, TrialMeasurements>>({});
  const repDraftsRef = useRef<Record<string, string>>({});
  const [savingRow, setSavingRow] = useState<string | null>(null);

  const [showAddPile, setShowAddPile] = useState(false);
  const [showAddControl, setShowAddControl] = useState(false);
  const [controlLabel, setControlLabel] = useState('');
  const [showSettings, setShowSettings] = useState(false);

  // Run settings drafts
  const [startDate, setStartDate] = useState('');
  const [plannedDays, setPlannedDays] = useState('');
  const [seedsSown, setSeedsSown] = useState('');
  const [runNotes, setRunNotes] = useState('');

  // The controls array we last wrote, so two quick control edits can't race and
  // drop each other (the whole array is one JSON cell in the sheet).
  const controlsRef = useRef<TrialControl[]>([]);
  useEffect(() => {
    if (run) controlsRef.current = run.controls;
  }, [run]);

  const runSignature = run ? JSON.stringify(run) : '';
  useEffect(() => {
    if (!run) return;
    setStartDate(run.startDate || '');
    setPlannedDays(run.plannedDays != null ? String(run.plannedDays) : '');
    setSeedsSown(run.seedsSown != null ? String(run.seedsSown) : '');
    setRunNotes(run.notes || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runSignature]);

  const members = useMemo(
    () => (runId ? runMembers(allSystems, runId) : []),
    [allSystems, runId]
  );

  if (!run) {
    return (
      <div className="min-h-screen bg-green-50/50">
        <Header title="Trial run" showBack onBack={() => navigate('/trials')} />
        <div className="p-4">
          <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100 text-center">
            <p className="text-sm text-gray-600">This run isn't loaded on this device.</p>
            <p className="text-xs text-gray-400 mt-1">
              Runs are shared through the spreadsheet — reconnect and reopen the app to fetch them.
            </p>
            <button
              onClick={() => navigate('/trials')}
              className="mt-4 text-sm text-green-primary font-medium"
            >
              ← All trial runs
            </button>
          </div>
        </div>
      </div>
    );
  }

  const def = trialTypeDef(run.type);
  const fields = fieldsFor(run.type);
  const status = trialStatus(runAsTrial(run));
  const control = runControlStrikeRate(run);
  const passMark = control !== null ? Math.round(control * PASS_THRESHOLD_PCT) / 100 : null;

  // ── Cell plumbing ──────────────────────────────────────────────────────────

  const measurementsFor = (key: string, stored: TrialMeasurements | undefined): TrialMeasurements =>
    drafts[key] ?? stored ?? {};

  /**
   * The pending edit for a row, from whichever store has it.
   *
   * The ref exists because choice and checkbox cells commit in the same tick
   * they change, before React has flushed state. But a commit must never be
   * skipped just because the two stores disagree: if a row shows typed values
   * and the ref has lost them, guarding on the ref alone silently throws the
   * edit away. Read both, prefer the ref, and let the render state be the
   * backstop.
   */
  const pendingDraft = (key: string): TrialMeasurements | undefined =>
    draftsRef.current[key] ?? drafts[key];

  const pendingRep = (key: string): string | undefined =>
    repDraftsRef.current[key] ?? repDrafts[key];

  const editCell = (key: string, stored: TrialMeasurements | undefined, fieldId: string, value: TrialMeasurements[string]) => {
    const row = { ...(draftsRef.current[key] ?? stored ?? {}), [fieldId]: value };
    draftsRef.current = { ...draftsRef.current, [key]: row };
    setDrafts(draftsRef.current);
  };

  const editRep = (key: string, value: string) => {
    repDraftsRef.current = { ...repDraftsRef.current, [key]: value };
    setRepDrafts(repDraftsRef.current);
  };

  /**
   * Drop a row's draft once it has been written — but only if it hasn't been
   * typed into again while the save was in flight, or the newer keystrokes
   * would snap back to the older stored value.
   */
  const clearDraft = (key: string, draftAtCommit: TrialMeasurements | undefined, repAtCommit: string | undefined) => {
    if (key in draftsRef.current && draftsRef.current[key] === draftAtCommit) {
      const next = { ...draftsRef.current };
      delete next[key];
      draftsRef.current = next;
      setDrafts(next);
    }
    if (key in repDraftsRef.current && repDraftsRef.current[key] === repAtCommit) {
      const next = { ...repDraftsRef.current };
      delete next[key];
      repDraftsRef.current = next;
      setRepDrafts(next);
    }
  };

  /** Persist one pile's row back onto its build's GrowInfo. */
  const commitTrial = async (system: CompostSystem, trial: GrowTrial) => {
    const key = `t:${trial.id}`;
    const draftAtCommit = pendingDraft(key);
    const repAtCommit = pendingRep(key);
    if (draftAtCommit === undefined && repAtCommit === undefined) return;
    const grow = system.grow;
    if (!grow) return;

    const measurements = normaliseMeasurements(fields, draftAtCommit ?? trial.measurements);
    const rep = repAtCommit !== undefined
      ? toNum(repAtCommit)
      : (trial.replicates ?? null);
    const next: GrowTrial = {
      ...trial,
      measurements: Object.keys(measurements).length > 0 ? measurements : undefined,
      replicates: rep ?? undefined,
    };

    setSavingRow(key);
    try {
      await setSystemPhase(system.id, system.phase || 'grow', {
        grow: { ...grow, trials: grow.trials.map(t => (t.id === next.id ? next : t)) },
      });
      clearDraft(key, draftAtCommit, repAtCommit);
    } catch {
      addToast('error', `Could not save ${system.name}`);
    } finally {
      setSavingRow(null);
    }
  };

  /** Persist one control row back onto the run. */
  const commitControl = async (controlId: string) => {
    const key = `c:${controlId}`;
    const draftAtCommit = pendingDraft(key);
    if (draftAtCommit === undefined) return;
    // The ref is the in-flight copy, but it starts empty and is only filled by
    // an effect, so fall back to the run's own controls.
    const current = controlsRef.current.length > 0 ? controlsRef.current : run.controls;
    const existing = current.find(c => c.id === controlId);
    if (!existing) return;

    const measurements = normaliseMeasurements(fields, draftAtCommit ?? existing.measurements);
    const controls = current.map(c => (c.id === controlId ? { ...c, measurements } : c));
    controlsRef.current = controls;

    setSavingRow(key);
    try {
      await saveTrialRun({ ...run, controls, updatedAt: new Date().toISOString() });
      clearDraft(key, draftAtCommit, undefined);
    } finally {
      setSavingRow(null);
    }
  };

  // ── Row actions ────────────────────────────────────────────────────────────

  const addPile = async (system: CompostSystem) => {
    // A run without a start date would leave the trial undatable, so fall back
    // to today rather than writing a broken `createdAt`.
    const start = run.startDate || getNZDate();
    const trial: GrowTrial = {
      id: generateId(),
      method: '',
      crop: RUN_CROP[run.type],
      createdAt: `${start}T00:00:00`,
      trialType: run.type,
      startedAt: start,
      plannedDays: run.plannedDays,
      runId: run.runId,
      replicates: PROTOCOL_RUN_DEFAULTS[run.type].replicates ?? undefined,
    };
    const grow = system.grow || { startedAt: start, trials: [] };
    await setSystemPhase(system.id, 'grow', {
      grow: { ...grow, trials: [...grow.trials, trial] },
      transitionNote: `+ ${def.label} (${start}): joined trial run`,
    });
    addToast('success', `${system.name} added to the run`);
    setShowAddPile(false);
  };

  const addControl = async () => {
    const label = controlLabel.trim();
    if (!label) return;
    const controls = [...controlsRef.current, { id: generateId(), label, measurements: {} }];
    controlsRef.current = controls;
    await saveTrialRun({ ...run, controls, updatedAt: new Date().toISOString() });
    setControlLabel('');
    setShowAddControl(false);
  };

  const removeControl = async (controlId: string) => {
    const controls = controlsRef.current.filter(c => c.id !== controlId);
    controlsRef.current = controls;
    // The row is gone, so its draft goes unconditionally.
    const nextDrafts = { ...draftsRef.current };
    delete nextDrafts[`c:${controlId}`];
    draftsRef.current = nextDrafts;
    setDrafts(nextDrafts);
    await saveTrialRun({ ...run, controls, updatedAt: new Date().toISOString() });
  };

  const saveRunSettings = async () => {
    const days = toNum(plannedDays);
    const sown = toNum(seedsSown);
    await saveTrialRun({
      ...run,
      controls: controlsRef.current,
      startDate: startDate || run.startDate,
      plannedDays: days,
      seedsSown: sown,
      notes: runNotes,
      updatedAt: new Date().toISOString(),
    });
    addToast('success', 'Run updated');
    setShowSettings(false);
  };

  // Builds that could still join — active ones first, so the common case is top.
  const candidates = allSystems
    .filter(s => !members.some(m => m.system.id === s.id))
    .sort((a, b) => {
      const aActive = settings.activeSystems.includes(a.id) ? 0 : 1;
      const bActive = settings.activeSystems.includes(b.id) ? 0 : 1;
      return aActive - bActive || a.name.localeCompare(b.name);
    });

  const colCount = fields.length + 3; // label + pots + fields + verdict

  return (
    <div className="min-h-screen bg-green-50/50 pb-8">
      <Header title={def.label} showBack onBack={() => navigate('/trials')} />

      <div className="p-4 space-y-4">

        {/* ── Run header — the pass rule, stated ────────────────────────── */}
        <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${status.chipClass}`}>
              {status.label}
            </span>
            <span className="text-sm text-gray-700">
              Started {formatNiceDate(run.startDate) || run.startDate || '—'}
            </span>
            {run.seedsSown != null && (
              <span className="text-xs text-gray-500">· {run.seedsSown} seeds sown per pot</span>
            )}
            <button
              onClick={() => setShowSettings(s => !s)}
              className="ml-auto flex items-center gap-1 text-xs text-gray-500 hover:text-green-primary"
            >
              <Settings2 size={13} />
              Run settings
              {showSettings ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-gray-100 bg-gray-50/70 px-2.5 py-2">
              <div className="text-[10px] uppercase tracking-wide text-gray-400">Control strike rate</div>
              <div className="text-sm font-semibold text-gray-900">
                {control !== null ? `${control}%` : EMPTY_VALUE}
              </div>
              <div className="text-[10px] text-gray-400">
                {run.controls.length === 0
                  ? 'No controls yet — no verdicts'
                  : `Mean of ${run.controls.length} control${run.controls.length === 1 ? '' : 's'}`}
              </div>
            </div>
            <div className="rounded-lg border border-gray-100 bg-gray-50/70 px-2.5 py-2">
              <div className="text-[10px] uppercase tracking-wide text-gray-400">Pass mark</div>
              <div className="text-sm font-semibold text-gray-900">
                {passMark !== null ? `${passMark}%` : EMPTY_VALUE}
              </div>
              <div className="text-[10px] text-gray-400">
                {PASS_THRESHOLD_PCT}% of the control strike rate
              </div>
            </div>
          </div>

          {run.notes && !showSettings && (
            <p className="text-xs text-gray-500 mt-2 whitespace-pre-wrap">{run.notes}</p>
          )}

          {showSettings && (
            <div className="mt-3 pt-3 border-t border-gray-100 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-medium text-gray-500 block mb-1">Start date</label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={e => setStartDate(e.target.value)}
                    className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-green-primary"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 block mb-1">Planned days</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={plannedDays}
                    onChange={e => setPlannedDays(e.target.value)}
                    placeholder="Blank = open-ended"
                    className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-green-primary"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 block mb-1">Seeds sown per pot</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={seedsSown}
                    onChange={e => setSeedsSown(e.target.value)}
                    className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-green-primary"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">Run notes</label>
                <textarea
                  value={runNotes}
                  onChange={e => setRunNotes(e.target.value)}
                  rows={2}
                  className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-green-primary"
                />
              </div>
              <button
                onClick={saveRunSettings}
                className="text-xs px-3 py-1.5 rounded-full bg-purple-600 text-white font-medium"
              >
                Save run settings
              </button>
            </div>
          )}
        </div>

        {/* ── Result table ──────────────────────────────────────────────── */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-center gap-2">
            <h3 className="font-semibold text-gray-900 text-sm">Results</h3>
            <span className="text-xs text-gray-400">
              {members.length} pile{members.length === 1 ? '' : 's'} · {run.controls.length} control{run.controls.length === 1 ? '' : 's'}
            </span>
            <span className="text-[11px] text-gray-400 ml-auto">Tap a cell to edit</span>
          </div>

          {/* The only horizontally scrolling box on the page. */}
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="bg-gray-50/80">
                  <th className="text-left px-3 py-2 font-medium text-gray-500 sticky left-0 bg-gray-50 z-20 min-w-[120px] border-r border-gray-100">
                    Pile
                  </th>
                  <th className="text-left px-2 py-2 font-medium text-gray-500 min-w-[70px] whitespace-nowrap">
                    Pots
                  </th>
                  {fields.map(f => (
                    <th
                      key={f.id}
                      className="text-left px-2 py-2 font-medium text-gray-500 min-w-[110px] whitespace-nowrap"
                      title={f.hint}
                    >
                      {f.label}
                      {f.unit ? <span className="text-gray-300"> ({f.unit})</span> : null}
                      {f.derived ? <span className="text-purple-400"> ƒ</span> : null}
                    </th>
                  ))}
                  <th className="text-left px-2 py-2 font-medium text-gray-500 min-w-[90px] whitespace-nowrap">
                    Verdict
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y divide-gray-50">
                {/* Piles */}
                {members.map(({ system, trial }) => {
                  const key = `t:${trial.id}`;
                  const m = measurementsFor(key, trial.measurements);
                  const repRaw = key in repDrafts
                    ? repDrafts[key]
                    : (trial.replicates != null ? String(trial.replicates) : '');
                  const rep = toNum(repRaw);
                  const ctx = { replicates: rep, seedsSown: run.seedsSown ?? null };
                  const preview: GrowTrial = {
                    ...trial,
                    measurements: normaliseMeasurements(fields, m),
                    replicates: rep ?? undefined,
                  };
                  const verdict = protocolVerdict(preview, run);
                  const pct = percentOfControl(preview, run);
                  const rate = trialStrikeRate(preview, run);

                  return (
                    <tr key={trial.id} className="align-middle">
                      <td className="px-3 py-1.5 sticky left-0 bg-white z-10 border-r border-gray-100">
                        <div className="font-medium text-gray-800 truncate max-w-[130px]">{system.name}</div>
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => navigate(`/analyse/${system.id}`)}
                            className="text-[10px] text-green-primary font-medium"
                          >
                            View →
                          </button>
                          {savingRow === key && <span className="text-[10px] text-gray-400">saving…</span>}
                        </div>
                      </td>

                      <td className="px-2 py-1.5">
                        <input
                          type="text"
                          inputMode="numeric"
                          value={repRaw}
                          onChange={e => editRep(key, e.target.value)}
                          onBlur={() => commitTrial(system, trial)}
                          className="w-full px-1.5 py-1 text-xs border border-gray-200 rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-purple-400"
                        />
                      </td>

                      {fields.map(f => (
                        <td key={f.id} className="px-2 py-1.5">
                          {f.derived ? (
                            <span className="text-purple-700 font-medium">
                              {displayValue(f, m, ctx)}
                            </span>
                          ) : (
                            <MeasurementInput
                              compact
                              field={f}
                              value={m[f.id]}
                              onChange={v => editCell(key, trial.measurements, f.id, v)}
                              onCommit={() => commitTrial(system, trial)}
                            />
                          )}
                        </td>
                      ))}

                      <td className="px-2 py-1.5 whitespace-nowrap">
                        {verdict ? (
                          <span className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border ${VERDICT_BADGE[verdict]}`}>
                            {verdict === 'pass' ? 'Pass' : 'Check'}
                          </span>
                        ) : (
                          <span className="text-gray-300">{EMPTY_VALUE}</span>
                        )}
                        {pct !== null && (
                          <div className="text-[10px] text-gray-400">{pct}% of control</div>
                        )}
                        {pct === null && rate !== null && (
                          <div className="text-[10px] text-gray-400">no control</div>
                        )}
                      </td>
                    </tr>
                  );
                })}

                {/* Controls — not builds, so they live on the run itself */}
                {run.controls.map(c => {
                  const key = `c:${c.id}`;
                  const m = measurementsFor(key, c.measurements);
                  const ctx = { replicates: null, seedsSown: run.seedsSown ?? null };
                  const rate = controlStrikeRate({ ...c, measurements: normaliseMeasurements(fields, m) }, run);

                  return (
                    <tr key={c.id} className="align-middle bg-amber-50/40">
                      <td className="px-3 py-1.5 sticky left-0 bg-amber-50 z-10 border-r border-gray-100">
                        <div className="font-medium text-amber-900 truncate max-w-[130px]">{c.label}</div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] uppercase tracking-wide text-amber-600">Control</span>
                          <button
                            onClick={() => removeControl(c.id)}
                            className="text-amber-400 hover:text-red-500"
                            title="Remove this control"
                          >
                            <Trash2 size={11} />
                          </button>
                          {savingRow === key && <span className="text-[10px] text-gray-400">saving…</span>}
                        </div>
                      </td>

                      {/* Controls carry their own pot count — the growth test
                          divides by pots, so without it there's no strike rate. */}
                      <td className="px-2 py-1.5">
                        <input
                          type="text"
                          inputMode="numeric"
                          value={m.replicates === null || m.replicates === undefined ? '' : String(m.replicates)}
                          onChange={e => editCell(key, c.measurements, 'replicates', e.target.value)}
                          onBlur={() => commitControl(c.id)}
                          className="w-full px-1.5 py-1 text-xs border border-amber-200 rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-purple-400"
                        />
                      </td>

                      {fields.map(f => (
                        <td key={f.id} className="px-2 py-1.5">
                          {f.derived ? (
                            <span className="text-purple-700 font-medium">
                              {displayValue(f, m, ctx)}
                            </span>
                          ) : (
                            <MeasurementInput
                              compact
                              field={f}
                              value={m[f.id]}
                              onChange={v => editCell(key, c.measurements, f.id, v)}
                              onCommit={() => commitControl(c.id)}
                            />
                          )}
                        </td>
                      ))}

                      <td className="px-2 py-1.5 whitespace-nowrap text-[10px] text-amber-700">
                        {rate !== null ? `baseline ${rate}%` : 'baseline —'}
                      </td>
                    </tr>
                  );
                })}

                {members.length === 0 && run.controls.length === 0 && (
                  <tr>
                    <td colSpan={colCount} className="px-3 py-6 text-center text-gray-400">
                      Nothing in this run yet — add a pile and a control below.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="px-3 py-3 border-t border-gray-100 flex flex-wrap gap-2">
            <button
              onClick={() => { setShowAddPile(v => !v); setShowAddControl(false); }}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-purple-600 text-white font-medium"
            >
              <Plus size={12} /> Add a pile
            </button>
            <button
              onClick={() => { setShowAddControl(v => !v); setShowAddPile(false); }}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border border-amber-300 text-amber-700 font-medium hover:bg-amber-50"
            >
              <Plus size={12} /> Add a control
            </button>
          </div>

          {showAddPile && (
            <div className="px-3 pb-3 border-t border-gray-100 pt-3">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-medium text-gray-600">Pick a build to add</span>
                <button onClick={() => setShowAddPile(false)} className="ml-auto text-gray-400">
                  <X size={14} />
                </button>
              </div>
              {candidates.length === 0 ? (
                <p className="text-xs text-gray-400">Every build is already in this run.</p>
              ) : (
                <div className="max-h-56 overflow-y-auto divide-y divide-gray-50 border border-gray-100 rounded-lg">
                  {candidates.map(s => (
                    <button
                      key={s.id}
                      onClick={() => addPile(s)}
                      className="w-full text-left px-3 py-2 hover:bg-gray-50 flex items-center gap-2"
                    >
                      <span className="text-xs font-medium text-gray-800 flex-1 min-w-0 truncate">{s.name}</span>
                      <span className="text-[10px] text-gray-400 shrink-0">
                        {settings.activeSystems.includes(s.id) ? (s.phase || 'thermophilic') : 'retired'}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              <p className="text-[10px] text-gray-400 mt-1.5">
                Adding a build creates a {def.label.toLowerCase()} on it, dated {formatNiceDate(run.startDate) || run.startDate || '—'},
                and moves it into the grow phase.
              </p>
            </div>
          )}

          {showAddControl && (
            <div className="px-3 pb-3 border-t border-gray-100 pt-3">
              <label className="text-xs font-medium text-gray-600 block mb-1">
                Control label
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={controlLabel}
                  onChange={e => setControlLabel(e.target.value)}
                  placeholder="e.g. Seed raising mix"
                  className="flex-1 min-w-0 px-2 py-1.5 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-green-primary"
                />
                <button
                  onClick={addControl}
                  disabled={!controlLabel.trim()}
                  className="text-xs px-3 py-1.5 rounded-full bg-amber-600 text-white font-medium disabled:opacity-50 shrink-0"
                >
                  Add
                </button>
              </div>
              <p className="text-[10px] text-gray-400 mt-1.5">
                Seed raising mix, garden compost, zone 2 soil… every pile is scored against the
                mean of these.
              </p>
            </div>
          )}
        </div>

        <p className="text-[11px] text-gray-400 px-1">
          Pass = strike rate at or above {PASS_THRESHOLD_PCT}% of the control's. Cells marked ƒ are
          calculated and can't be typed into.
        </p>
      </div>
    </div>
  );
}
