import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { FlaskConical, Plus, Trash2, Save, ChevronDown, ChevronUp } from 'lucide-react';
import { Header } from '@/components/Header';
import { SaveConfirmModal, type SaveConfirmIssue } from '@/components/SaveConfirmModal';
import { useCompost } from '@/contexts/CompostContext';
import { getNZDate, TEMP_UPPER_LIMIT_F, TEMP_ABSOLUTE_LOWER_F } from '@/utils/config';

const METHOD_OPTIONS = ['New tool', 'Auger', 'Layered', 'Dug', 'Other'] as const;

interface ProbeSample {
  id: string;
  probe: string;
  subSample: string;
  temperature: string;
  depth: string;
  notes: string;
}

let sampleCounter = 0;
function newProbeSample(probe = '', sub = ''): ProbeSample {
  return {
    id: `ps-${Date.now()}-${sampleCounter++}`,
    probe,
    subSample: sub,
    temperature: '',
    depth: '',
    notes: '',
  };
}

export function SampleEntryPage() {
  const { systemId } = useParams<{ systemId: string }>();
  const navigate = useNavigate();
  const { getSystem, addToast } = useCompost();

  const system = systemId ? getSystem(systemId) : undefined;

  // Form state
  const [date, setDate] = useState(getNZDate());
  const [sampleId, setSampleId] = useState('');
  const [loadingId, setLoadingId] = useState(true);
  const [turn, setTurn] = useState('');
  const [height, setHeight] = useState('');
  const [method, setMethod] = useState<string>('New tool');
  const [handling, setHandling] = useState('');
  const [samples, setSamples] = useState<ProbeSample[]>([]);
  const [saving, setSaving] = useState(false);
  const [pendingIssues, setPendingIssues] = useState<SaveConfirmIssue[] | null>(null);
  const [expandedSample, setExpandedSample] = useState<string | null>(null);
  /** Sample IDs + temp strings the user has explicitly confirmed as correct. */
  const [confirmedTemps, setConfirmedTemps] = useState<Map<string, string>>(new Map());
  const [probeCheck, setProbeCheck] = useState<
    { sampleId: string; issue: SaveConfirmIssue } | null
  >(null);

  // Fetch next sample ID on mount
  useEffect(() => {
    fetch('/.netlify/functions/compost-sampling-next-id')
      .then(r => r.json())
      .then(data => {
        setSampleId(data.nextId || 'S1');
        setLoadingId(false);
      })
      .catch(() => {
        setSampleId('S?');
        setLoadingId(false);
      });
  }, []);

  // Add a quick set of probes (common patterns)
  const addProbeSet = useCallback((probes: string[], subs: string[]) => {
    const newSamples: ProbeSample[] = [];
    for (const p of probes) {
      if (subs.length > 0) {
        for (const s of subs) {
          newSamples.push(newProbeSample(p, s));
        }
      } else {
        newSamples.push(newProbeSample(p));
      }
    }
    setSamples(prev => [...prev, ...newSamples]);
  }, []);

  const addSingleProbe = useCallback(() => {
    const ps = newProbeSample();
    setSamples(prev => [...prev, ps]);
    setExpandedSample(ps.id);
  }, []);

  const removeProbe = useCallback((id: string) => {
    setSamples(prev => prev.filter(s => s.id !== id));
  }, []);

  const updateProbe = useCallback((id: string, field: keyof ProbeSample, value: string) => {
    setSamples(prev => prev.map(s => s.id === id ? { ...s, [field]: value } : s));
  }, []);

  /** Run the extreme-temperature check as soon as a sample row's temp field is committed. */
  const handleTempBlur = useCallback((sampleId: string) => {
    const sample = samples.find(s => s.id === sampleId);
    if (!sample || !sample.temperature.trim()) return;
    // Skip if user already confirmed this exact value
    if (confirmedTemps.get(sampleId) === sample.temperature) return;
    const value = parseFloat(sample.temperature);
    if (Number.isNaN(value)) return;
    const label = sample.probe
      ? `Probe ${sample.probe}${sample.subSample ? ` (${sample.subSample})` : ''}`
      : 'Sample';
    if (value > TEMP_UPPER_LIMIT_F) {
      setProbeCheck({
        sampleId,
        issue: { type: 'too_high', label, value, limit: TEMP_UPPER_LIMIT_F },
      });
    } else if (value < TEMP_ABSOLUTE_LOWER_F) {
      setProbeCheck({
        sampleId,
        issue: { type: 'too_low', label, value, limit: TEMP_ABSOLUTE_LOWER_F },
      });
    }
  }, [samples, confirmedTemps]);

  const performSave = async () => {
    if (!system || samples.length === 0) return;
    setSaving(true);

    try {
      // Format date as DD/MM/YYYY
      const [y, m, d] = date.split('-');
      const formattedDate = `${d}/${m}/${y}`;

      const rows = samples.map(s => ({
        date: formattedDate,
        sampleId,
        system: system.name,
        turn,
        height,
        probe: s.probe,
        subSample: s.subSample,
        temperature: s.temperature,
        depth: s.depth,
        method,
        handling,
        notes: s.notes,
      }));

      const res = await fetch('/.netlify/functions/compost-sampling-write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows }),
      });

      if (!res.ok) throw new Error('Failed to save');

      const data = await res.json();
      addToast('success', `Sample ${sampleId} logged — ${data.rowsWritten} rows saved`);
      navigate('/dashboard?tab=sample');
    } catch {
      addToast('error', 'Failed to save sample data');
    } finally {
      setSaving(false);
      setPendingIssues(null);
    }
  };

  const handleSave = () => {
    if (!system || samples.length === 0) return;
    // Only check samples that the user has started filling in (has a probe label).
    // A row with a probe label but no temp = skipped.
    const issues: SaveConfirmIssue[] = [];
    for (const s of samples) {
      if (!s.probe.trim()) continue;
      const label = `Probe ${s.probe}${s.subSample ? ` (${s.subSample})` : ''}`;
      if (!s.temperature.trim()) {
        issues.push({ type: 'skipped', label });
        continue;
      }
      const value = parseFloat(s.temperature);
      if (Number.isNaN(value)) continue;
      // Out-of-range temps the user already confirmed per-probe are not re-raised
      if (confirmedTemps.get(s.id) === s.temperature) continue;
      if (value > TEMP_UPPER_LIMIT_F) {
        issues.push({ type: 'too_high', label, value, limit: TEMP_UPPER_LIMIT_F });
      } else if (value < TEMP_ABSOLUTE_LOWER_F) {
        issues.push({ type: 'too_low', label, value, limit: TEMP_ABSOLUTE_LOWER_F });
      }
    }
    if (issues.length > 0) {
      setPendingIssues(issues);
      return;
    }
    performSave();
  };

  if (!system) {
    return (
      <div className="min-h-screen bg-blue-50/50">
        <Header title="Log Sample" />
        <div className="p-4 text-center text-gray-400 mt-12">System not found</div>
      </div>
    );
  }

  const filledCount = samples.filter(s => s.probe).length;

  return (
    <div className="min-h-screen bg-blue-50/50 pb-24">
      <Header title="Log Sample" />

      <div className="p-4 space-y-4">
        {/* System name banner */}
        <div className="bg-blue-500 text-white rounded-xl p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-white/20 flex items-center justify-center">
            <FlaskConical size={22} />
          </div>
          <div>
            <h2 className="font-semibold text-lg">{system.name}</h2>
            <p className="text-blue-100 text-sm">Sample collection</p>
          </div>
        </div>

        {/* Sample ID + Date */}
        <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1">Sample ID</label>
              <input
                type="text"
                value={loadingId ? '...' : sampleId}
                onChange={e => setSampleId(e.target.value)}
                className="w-full px-3 py-2.5 text-sm border border-blue-200 rounded-lg bg-blue-50/50 font-mono font-bold text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1">Date</label>
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1">Turn number</label>
              <input
                type="text"
                value={turn}
                onChange={e => setTurn(e.target.value)}
                placeholder="e.g. 2"
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1">System height (cm)</label>
              <input
                type="text"
                value={height}
                onChange={e => setHeight(e.target.value)}
                placeholder="e.g. 52"
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
            </div>
          </div>
        </div>

        {/* Sampling method */}
        <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
          <label className="text-xs font-medium text-gray-500 block mb-2">Sampling method</label>
          <div className="flex flex-wrap gap-2">
            {METHOD_OPTIONS.map(opt => (
              <button
                key={opt}
                onClick={() => setMethod(opt)}
                className={`px-3 py-2 text-sm rounded-lg border transition-colors ${
                  method === opt
                    ? 'bg-blue-500 border-blue-500 text-white font-medium'
                    : 'bg-white border-gray-200 text-gray-600 hover:border-blue-300'
                }`}
              >
                {opt}
              </button>
            ))}
          </div>
        </div>

        {/* Probe samples */}
        <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-gray-900">Probe Samples</h3>
              <p className="text-xs text-gray-400">{samples.length} sample{samples.length !== 1 ? 's' : ''} added</p>
            </div>
          </div>

          {/* Quick-add buttons */}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => addProbeSet(['1', '3', '6', '7'], ['a', 'b', 'c'])}
              className="text-xs px-3 py-1.5 rounded-lg bg-blue-50 text-blue-600 border border-blue-200 font-medium active:scale-95 transition-transform"
            >
              + Probes 1,3,6,7 (a,b,c)
            </button>
            <button
              onClick={() => addProbeSet(['1', '3', '5', '6', '7', '9'], [])}
              className="text-xs px-3 py-1.5 rounded-lg bg-blue-50 text-blue-600 border border-blue-200 font-medium active:scale-95 transition-transform"
            >
              + Probes 1,3,5,6,7,9
            </button>
            <button
              onClick={() => addProbeSet(['1', '3', '5', '6', '7', '9', '10'], [])}
              className="text-xs px-3 py-1.5 rounded-lg bg-blue-50 text-blue-600 border border-blue-200 font-medium active:scale-95 transition-transform"
            >
              + All 7 probes
            </button>
            <button
              onClick={addSingleProbe}
              className="text-xs px-3 py-1.5 rounded-lg bg-gray-50 text-gray-600 border border-gray-200 font-medium active:scale-95 transition-transform"
            >
              <Plus size={12} className="inline mr-1" />
              Custom
            </button>
          </div>

          {/* Sample list */}
          {samples.length > 0 && (
            <div className="space-y-2 pt-1">
              {samples.map(s => {
                const isExpanded = expandedSample === s.id;
                const label = s.probe
                  ? `Probe ${s.probe}${s.subSample ? ` (${s.subSample})` : ''}`
                  : 'New sample';
                const detail = [
                  s.temperature ? `${s.temperature}°F` : null,
                  s.depth ? `${s.depth}cm` : null,
                ].filter(Boolean).join(', ');

                return (
                  <div key={s.id} className="border border-gray-100 rounded-lg overflow-hidden">
                    <button
                      onClick={() => setExpandedSample(isExpanded ? null : s.id)}
                      className="w-full flex items-center gap-2 px-3 py-2.5 bg-gray-50/50 text-left"
                    >
                      <FlaskConical size={14} className="text-blue-500 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium text-gray-800">{label}</span>
                        {detail && <span className="ml-2 text-xs text-gray-400">{detail}</span>}
                      </div>
                      <button
                        onClick={e => { e.stopPropagation(); removeProbe(s.id); }}
                        className="p-1 text-gray-300 hover:text-red-400 transition-colors shrink-0"
                      >
                        <Trash2 size={14} />
                      </button>
                      {isExpanded ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
                    </button>

                    {isExpanded && (
                      <div className="px-3 py-3 space-y-2 border-t border-gray-100">
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-xs text-gray-500 block mb-0.5">Probe</label>
                            <input
                              type="text"
                              value={s.probe}
                              onChange={e => updateProbe(s.id, 'probe', e.target.value)}
                              placeholder="e.g. 1, 6, 10"
                              className="w-full px-2.5 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-300"
                              autoFocus
                            />
                          </div>
                          <div>
                            <label className="text-xs text-gray-500 block mb-0.5">Sub-sample</label>
                            <input
                              type="text"
                              value={s.subSample}
                              onChange={e => updateProbe(s.id, 'subSample', e.target.value)}
                              placeholder="a, b, c, d"
                              className="w-full px-2.5 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-300"
                            />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-xs text-gray-500 block mb-0.5">Temp (°F)</label>
                            <input
                              type="number"
                              value={s.temperature}
                              onChange={e => updateProbe(s.id, 'temperature', e.target.value)}
                              onBlur={() => handleTempBlur(s.id)}
                              placeholder="e.g. 130"
                              className="w-full px-2.5 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-300"
                            />
                          </div>
                          <div>
                            <label className="text-xs text-gray-500 block mb-0.5">Depth (cm)</label>
                            <input
                              type="number"
                              value={s.depth}
                              onChange={e => updateProbe(s.id, 'depth', e.target.value)}
                              placeholder="e.g. 35"
                              className="w-full px-2.5 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-300"
                            />
                          </div>
                        </div>
                        <div>
                          <label className="text-xs text-gray-500 block mb-0.5">Notes</label>
                          <input
                            type="text"
                            value={s.notes}
                            onChange={e => updateProbe(s.id, 'notes', e.target.value)}
                            placeholder="e.g. Top, base of unit"
                            className="w-full px-2.5 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-300"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Handling */}
        <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
          <label className="text-xs font-medium text-gray-500 block mb-1">Handling & transport</label>
          <input
            type="text"
            value={handling}
            onChange={e => setHandling(e.target.value)}
            placeholder="e.g. Frozen. Posted on ice"
            className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300"
          />
        </div>
      </div>

      {/* Fixed save button */}
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-white/95 backdrop-blur border-t border-gray-100">
        <button
          onClick={handleSave}
          disabled={saving || filledCount === 0}
          className={`w-full flex items-center justify-center gap-2 py-3.5 rounded-xl text-white font-semibold text-base transition-all ${
            saving || filledCount === 0
              ? 'bg-gray-300 cursor-not-allowed'
              : 'bg-blue-500 active:scale-[0.98] shadow-lg shadow-blue-500/25'
          }`}
        >
          <Save size={20} />
          {saving ? 'Saving...' : `Save Sample (${filledCount} probe${filledCount !== 1 ? 's' : ''})`}
        </button>
      </div>

      {/* Per-probe guardrail (fires as soon as an extreme reading is entered) */}
      {probeCheck && (
        <SaveConfirmModal
          issues={[probeCheck.issue]}
          title="Check this reading"
          subtitle="That temperature looks unusual — is the value correct?"
          primaryLabel="Let me fix it"
          secondaryLabel="Yes, keep it"
          onGoBack={() => {
            // Clear the temp so the user can re-enter
            updateProbe(probeCheck.sampleId, 'temperature', '');
            setProbeCheck(null);
          }}
          onSaveAnyway={() => {
            const sample = samples.find(s => s.id === probeCheck.sampleId);
            if (sample) {
              setConfirmedTemps(prev => {
                const next = new Map(prev);
                next.set(probeCheck.sampleId, sample.temperature);
                return next;
              });
            }
            setProbeCheck(null);
          }}
        />
      )}

      {/* Pre-save guardrail confirmation */}
      {pendingIssues && (
        <SaveConfirmModal
          issues={pendingIssues}
          saving={saving}
          onGoBack={() => setPendingIssues(null)}
          onSaveAnyway={performSave}
        />
      )}
    </div>
  );
}
