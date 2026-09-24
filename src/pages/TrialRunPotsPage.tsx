import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChevronRight, ClipboardList, Plus, Settings2, Trash2, X } from 'lucide-react';
import { Header } from '@/components/Header';
import { formatNiceDate } from '@/components/BuildVitals';
import { TrialVerdictCard } from '@/components/TrialVerdictCard';
import { TrialRunActions } from '@/components/TrialRunActions';
import { useCompost } from '@/contexts/CompostContext';
import { generateId, getNZDate } from '@/utils/config';
import { EMPTY_VALUE } from '@/utils/trialFields';
import { trialStatus, trialTypeDef } from '@/utils/trials';
import { runAsTrial } from '@/utils/trialRuns';
import {
  DEFAULT_PASS_THRESHOLD_PCT,
  DEFAULT_POTS_PER_TREATMENT,
  DEFAULT_SEEDS_SOWN,
  DEFAULT_SIZE_BANDS,
  bandLabel,
  controlBaseline,
  runObservationDates,
  runPotCount,
  runSizeBands,
  runThreshold,
  treatmentSummary,
  treatmentVerdict,
} from '@/utils/trialPots';
import { runTreatments } from '@/utils/trialTreatments';
import { useTrialBase } from '@/contexts/SandboxProvider';
import type { CompostSystem, GrowTrial, SizeBand, TrialControl } from '@/types';

/** A number typed into a text box, or null when it's blank / not a number. */
function toNum(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/**
 * A germination run, at pot level.
 *
 * The run is the experiment; each compost and each control is a treatment with
 * its own replicate pots. This screen is the index — status, the control
 * baseline everything is scored against, and one card per treatment — with the
 * two jobs that actually happen in the field promoted to buttons: record a
 * counting day, or open a treatment and pull its pots apart.
 */
export function TrialRunPotsPage() {
  const { runId } = useParams<{ runId: string }>();
  const navigate = useNavigate();
  const {
    allSystems, settings, getTrialRun, saveTrialRun, setSystemPhase, addToast,
  } = useCompost();

  const { base } = useTrialBase();

  const run = runId ? getTrialRun(runId) : undefined;

  const [showSettings, setShowSettings] = useState(false);
  const [showAddPile, setShowAddPile] = useState(false);
  const [showAddControl, setShowAddControl] = useState(false);
  const [controlLabel, setControlLabel] = useState('');

  const [startDate, setStartDate] = useState('');
  const [plannedDays, setPlannedDays] = useState('');
  const [seedsSown, setSeedsSown] = useState('');
  const [potsPerTreatment, setPotsPerTreatment] = useState('');
  const [threshold, setThreshold] = useState('');
  const [bandDrafts, setBandDrafts] = useState<SizeBand[]>(DEFAULT_SIZE_BANDS);
  const [runNotes, setRunNotes] = useState('');

  // The controls array we last wrote — the whole array is one JSON cell, so two
  // quick control edits would otherwise drop each other.
  const controlsRef = useRef<TrialControl[]>([]);
  useEffect(() => { if (run) controlsRef.current = run.controls; }, [run]);

  const runSignature = run ? JSON.stringify(run) : '';
  useEffect(() => {
    if (!run) return;
    setStartDate(run.startDate || '');
    setPlannedDays(run.plannedDays != null ? String(run.plannedDays) : '');
    setSeedsSown(run.seedsSown != null ? String(run.seedsSown) : String(DEFAULT_SEEDS_SOWN));
    setPotsPerTreatment(String(runPotCount(run)));
    setThreshold(String(runThreshold(run)));
    setBandDrafts(runSizeBands(run));
    setRunNotes(run.notes || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runSignature]);

  const treatments = useMemo(
    () => (run ? runTreatments(allSystems, run) : []),
    [allSystems, run]
  );

  if (!run) {
    return (
      <div className="min-h-screen bg-green-50/50">
        <Header title="Trial run" showBack onBack={() => navigate(base)} />
        <div className="p-4">
          <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100 text-center">
            <p className="text-sm text-gray-600">This run isn't loaded on this device.</p>
            <p className="text-xs text-gray-400 mt-1">
              Runs are shared through the spreadsheet — reconnect and reopen the app to fetch them.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const def = trialTypeDef(run.type);
  const status = trialStatus(runAsTrial(run));
  const control = controlBaseline(run);
  const dates = runObservationDates(run);
  const potCount = runPotCount(run);
  const builds = treatments.filter(t => t.kind === 'build');
  const controls = treatments.filter(t => t.kind === 'control');

  const saveRunSettings = async () => {
    const bands = bandDrafts.map((b, i) => ({
      cls: i + 1,
      minCm: i === 0 ? null : b.minCm,
      maxCm: i === bandDrafts.length - 1 ? null : b.maxCm,
    }));
    await saveTrialRun({
      ...run,
      controls: controlsRef.current,
      startDate: startDate || run.startDate,
      plannedDays: toNum(plannedDays),
      seedsSown: toNum(seedsSown),
      notes: runNotes,
      settings: {
        ...(run.settings || {}),
        potsPerTreatment: toNum(potsPerTreatment) ?? DEFAULT_POTS_PER_TREATMENT,
        passThresholdPct: toNum(threshold) ?? DEFAULT_PASS_THRESHOLD_PCT,
        sizeBands: bands,
      },
      updatedAt: new Date().toISOString(),
    });
    addToast('success', 'Run updated');
    setShowSettings(false);
  };

  const addPile = async (system: CompostSystem) => {
    const start = run.startDate || getNZDate();
    const trial: GrowTrial = {
      id: generateId(),
      method: '',
      crop: 'Mustard',
      createdAt: `${start}T00:00:00`,
      trialType: run.type,
      startedAt: start,
      plannedDays: run.plannedDays,
      runId: run.runId,
      replicates: potCount,
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
    const next = [...controlsRef.current, { id: generateId(), label, measurements: {}, pots: [] }];
    controlsRef.current = next;
    await saveTrialRun({ ...run, controls: next, updatedAt: new Date().toISOString() });
    setControlLabel('');
    setShowAddControl(false);
  };

  const removeControl = async (controlId: string) => {
    const next = controlsRef.current.filter(c => c.id !== controlId);
    controlsRef.current = next;
    await saveTrialRun({ ...run, controls: next, updatedAt: new Date().toISOString() });
  };

  const candidates = allSystems
    .filter(s => !builds.some(b => b.system?.id === s.id))
    .sort((a, b) => {
      const aActive = settings.activeSystems.includes(a.id) ? 0 : 1;
      const bActive = settings.activeSystems.includes(b.id) ? 0 : 1;
      return aActive - bActive || a.name.localeCompare(b.name);
    });

  return (
    <div className="min-h-screen bg-green-50/50 pb-8">
      <Header title={def.label} showBack onBack={() => navigate(base)} />

      <div className="p-4 space-y-4">

        {/* ── Run header ─────────────────────────────────────────────────── */}
        <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${status.chipClass}`}>
              {status.label}
            </span>
            <span className="text-sm text-gray-700">
              Sown {formatNiceDate(run.startDate) || run.startDate || '—'}
            </span>
            <button
              onClick={() => setShowSettings(s => !s)}
              className="ml-auto flex items-center gap-1 text-xs text-gray-500 hover:text-green-primary"
            >
              <Settings2 size={13} />
              Run settings
            </button>
          </div>

          <p className="text-xs text-gray-500 mt-1.5">
            {run.seedsSown ?? DEFAULT_SEEDS_SOWN} seeds × {potCount} pots per treatment ·
            {' '}{dates.length} counting day{dates.length === 1 ? '' : 's'} ·
            {' '}alert below {runThreshold(run)}% of control
          </p>

          {run.notes && !showSettings && (
            <p className="text-xs text-gray-500 mt-2 whitespace-pre-wrap">{run.notes}</p>
          )}

          <button
            onClick={() => navigate(`${base}/${run.runId}/count`)}
            className="mt-3 w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-green-primary text-white text-sm font-medium"
          >
            <ClipboardList size={16} />
            Record a counting day
          </button>

          {showSettings && (
            <div className="mt-3 pt-3 border-t border-gray-100 space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-medium text-gray-500 block mb-1">Sowing date</label>
                  <input
                    type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                    className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-green-primary"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 block mb-1">Planned days</label>
                  <input
                    type="text" inputMode="numeric" value={plannedDays}
                    onChange={e => setPlannedDays(e.target.value)} placeholder="Blank = open-ended"
                    className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-green-primary"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 block mb-1">Seeds per pot</label>
                  <input
                    type="text" inputMode="numeric" value={seedsSown}
                    onChange={e => setSeedsSown(e.target.value)}
                    className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-green-primary"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 block mb-1">Pots per treatment</label>
                  <input
                    type="text" inputMode="numeric" value={potsPerTreatment}
                    onChange={e => setPotsPerTreatment(e.target.value)}
                    className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-green-primary"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">
                  Alert threshold (% of control)
                </label>
                <input
                  type="text" inputMode="numeric" value={threshold}
                  onChange={e => setThreshold(e.target.value)}
                  className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-green-primary"
                />
                <p className="text-[10px] text-gray-400 mt-1">
                  A treatment is flagged when its germination or growth falls below this share of
                  the control's. The protocol document says 90%; the performance assessment sheet
                  uses 80%.
                </p>
              </div>

              {/* Size bands. The assessment sheet leaves these for the site to
                  fix — they must be agreed before anyone starts sorting. */}
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">
                  Whole-seedling size bands (cm, root tip → shoot tip)
                </label>
                <div className="space-y-1.5">
                  {bandDrafts.map((band, i) => (
                    <div key={band.cls} className="flex items-center gap-2">
                      <span className="text-xs text-gray-500 w-14 shrink-0">Class {i + 1}</span>
                      <input
                        type="text" inputMode="decimal"
                        value={i === 0 ? '' : (band.minCm ?? '')}
                        disabled={i === 0}
                        placeholder={i === 0 ? 'from 0' : 'from'}
                        onChange={e => setBandDrafts(bs => bs.map((b, j) =>
                          j === i ? { ...b, minCm: toNum(e.target.value) } : b))}
                        className="w-20 px-2 py-1 text-xs border border-gray-200 rounded-md bg-white disabled:bg-gray-50 disabled:text-gray-400 focus:outline-none focus:ring-1 focus:ring-purple-400"
                      />
                      <span className="text-xs text-gray-400">to</span>
                      <input
                        type="text" inputMode="decimal"
                        value={i === bandDrafts.length - 1 ? '' : (band.maxCm ?? '')}
                        disabled={i === bandDrafts.length - 1}
                        placeholder={i === bandDrafts.length - 1 ? 'and up' : 'to'}
                        onChange={e => {
                          // Bands butt up against each other, so one boundary is
                          // two fields: this band's top and the next band's floor.
                          const boundary = toNum(e.target.value);
                          setBandDrafts(bs => bs.map((b, j) => {
                            if (j === i) return { ...b, maxCm: boundary };
                            if (j === i + 1) return { ...b, minCm: boundary };
                            return b;
                          }));
                        }}
                        className="w-20 px-2 py-1 text-xs border border-gray-200 rounded-md bg-white disabled:bg-gray-50 disabled:text-gray-400 focus:outline-none focus:ring-1 focus:ring-purple-400"
                      />
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-gray-400 mt-1">
                  Classes {bandDrafts.length - 1} and {bandDrafts.length} count as "upper size" for
                  the growth screen. Agree these before anyone starts sorting seedlings — changing
                  them later re-labels counts that were sorted under the old boundaries.
                </p>
              </div>

              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">Run notes</label>
                <textarea
                  value={runNotes} onChange={e => setRunNotes(e.target.value)} rows={2}
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

          <TrialRunActions run={run} />
        </div>

        {/* ── Control baseline ───────────────────────────────────────────── */}
        {control && (
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5 px-1">
              Control baseline
            </h3>
            <TrialVerdictCard
              summary={control}
              verdict={treatmentVerdict(control, control, run, true)}
              run={run}
              isControl
            />
          </div>
        )}

        {/* ── Treatments ────────────────────────────────────────────────── */}
        <div>
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5 px-1">
            Treatments
          </h3>
          <div className="space-y-2">
            {[...builds, ...controls].map(treatment => {
              const summary = treatmentSummary({ pots: treatment.pots }, run);
              const verdict = treatmentVerdict(summary, control, run, treatment.kind === 'control');
              return (
                <div
                  key={treatment.key}
                  className={`rounded-xl shadow-sm border ${
                    treatment.kind === 'control'
                      ? 'bg-amber-50/60 border-amber-200'
                      : 'bg-white border-gray-100'
                  }`}
                >
                  <button
                    onClick={() => navigate(`${base}/${run.runId}/t/${encodeURIComponent(treatment.key)}`)}
                    className="w-full px-4 py-3 flex items-center gap-3 text-left"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-sm font-medium text-gray-900 truncate">
                          {treatment.label}
                        </span>
                        {treatment.kind === 'control' && (
                          <span className="text-[10px] uppercase tracking-wide text-amber-600">Control</span>
                        )}
                        <span className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border ${verdict.chipClass}`}>
                          {verdict.label}
                        </span>
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        {summary.overallGerminationPct === null
                          ? `${summary.assessedPots}/${summary.pots.length} pots counted`
                          : `${summary.overallGerminationPct}% germination · consistency ${summary.consistencyPct ?? EMPTY_VALUE}%`}
                        {verdict.vsControlGermination !== null && ` · ${verdict.vsControlGermination}% of control`}
                      </div>
                    </div>
                    {treatment.kind === 'control' && (
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={e => { e.stopPropagation(); removeControl(treatment.control!.id); }}
                        onKeyDown={e => { if (e.key === 'Enter') { e.stopPropagation(); removeControl(treatment.control!.id); } }}
                        className="text-amber-400 hover:text-red-500 shrink-0"
                        title="Remove this control"
                      >
                        <Trash2 size={13} />
                      </span>
                    )}
                    <ChevronRight size={16} className="text-gray-300 shrink-0" />
                  </button>
                </div>
              );
            })}

            {treatments.length === 0 && (
              <div className="bg-white rounded-xl px-4 py-6 text-center text-sm text-gray-400 border border-gray-100">
                Nothing in this run yet — add a compost and a control below.
              </div>
            )}
          </div>
        </div>

        {/* ── Add ───────────────────────────────────────────────────────── */}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => { setShowAddPile(v => !v); setShowAddControl(false); }}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-purple-600 text-white font-medium"
          >
            <Plus size={12} /> Add a compost
          </button>
          <button
            onClick={() => { setShowAddControl(v => !v); setShowAddPile(false); }}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border border-amber-300 text-amber-700 font-medium hover:bg-amber-50"
          >
            <Plus size={12} /> Add a control
          </button>
        </div>

        {showAddPile && (
          <div className="bg-white rounded-xl p-3 shadow-sm border border-gray-100">
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
          </div>
        )}

        {showAddControl && (
          <div className="bg-white rounded-xl p-3 shadow-sm border border-gray-100">
            <label className="text-xs font-medium text-gray-600 block mb-1">Control label</label>
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
              Seed raising mix, garden compost, zone 2 soil, "Biological" — anything grown
              alongside that isn't one of the builds. Every compost is scored against these pooled.
            </p>
          </div>
        )}

        <p className="text-[11px] text-gray-400 px-1">
          Bands: {runSizeBands(run).map(b => `C${b.cls} ${bandLabel(b)}`).join(' · ')}. This is a
          screening assay — it identifies a plant-response concern, not its cause.
        </p>
      </div>
    </div>
  );
}
