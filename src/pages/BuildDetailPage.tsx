import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Hammer, CheckSquare, Square, Loader2, Package, ScanLine,
  Trash2, Plus, Palette, Pencil, RotateCw, Ruler, Save, Thermometer, Minus,
} from 'lucide-react';
import { Header } from '@/components/Header';
import { Button } from '@/components/Button';
import { BinScanner } from '@/components/BinScanner';
import type { ScanOutcome } from '@/components/BinScanner';
import { useCompost } from '@/contexts/CompostContext';
import { getNZDate, DEFAULT_BUILD_TYPES, DEFAULT_MULCH_TYPES } from '@/utils/config';
import { calcVolumeLitres, formatVolume } from '@/utils/volume';
import type { BuildShape, BuildDimensions } from '@/types';

// ── Types ────────────────────────────────────────────────────────────────────

interface AssignedBin {
  arrayIndex: number;
  serialNumber: string;
  collectionDate: string;
  maturationDate: string;
  batchingDate: string;
  sources: string[];
  colour: string;
}

interface AvailableBin {
  arrayIndex: number;
  collectionDate: string;
  sources: string[];
  serialNumber: string;
  colour: string;
  maturationDate: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseTrackerDate(dateStr: string): Date | null {
  if (!dateStr?.trim()) return null;
  const m = dateStr.trim().match(/^(\d{1,2})-([A-Za-z]{3,})-(\d{4})$/);
  if (m) {
    const d = new Date(`${m[2]} ${parseInt(m[1])}, ${m[3]}`);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

const COLOUR_MAP: Record<string, string> = {
  red: 'bg-red-100 text-red-700',
  yellow: 'bg-yellow-100 text-yellow-700',
  green: 'bg-green-100 text-green-700',
  blue: 'bg-blue-100 text-blue-700',
  orange: 'bg-orange-100 text-orange-700',
  purple: 'bg-purple-100 text-purple-700',
  pink: 'bg-pink-100 text-pink-700',
  teal: 'bg-teal-100 text-teal-700',
};

const ALL_COLOURS = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink'];

const COLOUR_BG: Record<string, string> = {
  red: 'bg-red-400',
  orange: 'bg-orange-400',
  yellow: 'bg-yellow-400',
  green: 'bg-green-500',
  teal: 'bg-teal-400',
  blue: 'bg-blue-500',
  purple: 'bg-purple-500',
  pink: 'bg-pink-400',
};

function colourBadge(colour: string): string {
  return COLOUR_MAP[colour.toLowerCase()] ?? 'bg-gray-100 text-gray-600';
}

// ── Component ─────────────────────────────────────────────────────────────────

export function BuildDetailPage() {
  const navigate = useNavigate();
  const { systemId } = useParams<{ systemId: string }>();
  const { getSystem, addToast, settings, updateSettings, updateCustomSystem } = useCompost();

  const system = systemId ? getSystem(systemId) : undefined;

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [assignedBins, setAssignedBins] = useState<AssignedBin[]>([]);
  const [availableBins, setAvailableBins] = useState<AvailableBin[]>([]);
  const [currentColour, setCurrentColour] = useState<string>('');
  const [usedColours, setUsedColours] = useState<Set<string>>(new Set());

  // Remove confirm/loading state per bin
  const [removingSerial, setRemovingSerial] = useState<string | null>(null);
  const [confirmRemoveSerial, setConfirmRemoveSerial] = useState<string | null>(null);

  // Add-bins mode
  const [addMode, setAddMode] = useState(false);
  const [addSelected, setAddSelected] = useState<Set<number>>(new Set());
  const [scanMode, setScanMode] = useState(false);
  const [addingBins, setAddingBins] = useState(false);

  // Recolour
  const [recolourOpen, setRecolourOpen] = useState(false);
  const [recolourPending, setRecolourPending] = useState<string | null>(null);
  const [recolouring, setRecolouring] = useState(false);

  // Log turn
  const [turnOpen, setTurnOpen] = useState(false);
  const [turnDate, setTurnDate] = useState(getNZDate()); // YYYY-MM-DD
  const [loggingTurn, setLoggingTurn] = useState(false);

  // Dimensions editing
  const [dimsOpen, setDimsOpen] = useState(false);
  const [dimShape, setDimShape] = useState<BuildShape>(system?.dimensions?.shape || 'cuboid');
  const [dimLength, setDimLength] = useState(String(system?.dimensions?.lengthCm || ''));
  const [dimWidth, setDimWidth] = useState(String(system?.dimensions?.widthCm || ''));
  const [dimDiameter, setDimDiameter] = useState(String(system?.dimensions?.diameterCm || ''));
  const [dimHeight, setDimHeight] = useState(String(system?.dimensions?.heightCm || ''));
  const [savingDims, setSavingDims] = useState(false);

  // Probe count editing
  const [probesOpen, setProbesOpen] = useState(false);
  const [probeCountInput, setProbeCountInput] = useState(system?.probeLabels.length ?? 0);
  const [savingProbes, setSavingProbes] = useState(false);

  // Build metadata editing
  const [metaOpen, setMetaOpen] = useState(false);
  const [editBuildType, setEditBuildType] = useState(system?.buildType || '');
  const [editMulchBins, setEditMulchBins] = useState(String(system?.mulchBins ?? ''));
  const [editMulchType, setEditMulchType] = useState(system?.mulchType || '');
  const [addingBuildType, setAddingBuildType] = useState(false);
  const [newBuildType, setNewBuildType] = useState('');
  const [addingMulchType, setAddingMulchType] = useState(false);
  const [newMulchType, setNewMulchType] = useState('');
  const [savingMeta, setSavingMeta] = useState(false);
  const allBuildTypes = [...DEFAULT_BUILD_TYPES, ...(settings.customBuildTypes || [])];
  const allMulchTypes = [...DEFAULT_MULCH_TYPES, ...(settings.customMulchTypes || [])];

  const reload = useCallback(async () => {
    if (!system) return;
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch('/.netlify/functions/compost-sheets-read?tab=Bin%20Tracker');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const rows: string[][] = json.data || [];

      const todayStr = getNZDate();
      const today = new Date(todayStr + 'T00:00:00');

      const assigned: AssignedBin[] = [];
      const available: AvailableBin[] = [];
      const taken = new Set<string>();
      let detectedColour = '';

      rows.forEach((row, arrayIndex) => {
        if (arrayIndex === 0) return;

        const rowColour = (row[5] || '').trim().toLowerCase();
        if (rowColour) taken.add(rowColour);

        const batch = (row[8] || '').trim();
        const sources = [row[1], row[2], row[3]]
          .map(v => (v || '').trim())
          .filter(Boolean);

        if (batch === system.name) {
          assigned.push({
            arrayIndex,
            serialNumber: (row[4] || '').trim(),
            collectionDate: (row[0] || '').trim(),
            maturationDate: (row[6] || '').trim(),
            batchingDate: (row[7] || '').trim(),
            sources,
            colour: rowColour,
          });
          if (rowColour && !detectedColour) detectedColour = rowColour;
          return;
        }

        if (batch !== '') return; // assigned to a different build
        const matDate = parseTrackerDate(row[6] || '');
        if (!matDate || matDate > today) return; // not matured

        available.push({
          arrayIndex,
          collectionDate: (row[0] || '').trim(),
          sources,
          serialNumber: (row[4] || '').trim(),
          colour: rowColour,
          maturationDate: (row[6] || '').trim(),
        });
      });

      setAssignedBins(assigned);
      setAvailableBins(available);
      setCurrentColour(detectedColour);
      // Used colours = all colours in the tracker except the one we already own
      const free = new Set(taken);
      if (detectedColour) free.delete(detectedColour);
      setUsedColours(free);
    } catch (err) {
      console.error('BuildDetail load error:', err);
      setLoadError('Could not load bins. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, [system]);

  useEffect(() => {
    reload();
  }, [reload]);

  if (!system) {
    return (
      <div className="min-h-screen bg-green-50/50">
        <Header title="Build" showBack onBack={() => navigate('/manage')} />
        <div className="p-6 text-center text-gray-500">
          <p>Build not found.</p>
          <button
            onClick={() => navigate('/manage')}
            className="mt-3 text-green-primary underline text-sm"
          >
            Back to Manage
          </button>
        </div>
      </div>
    );
  }

  // ── Remove a single bin ─────────────────────────────────────────────────────
  async function handleRemoveBin(serial: string) {
    if (!system) return;
    setRemovingSerial(serial);
    try {
      const res = await fetch('/.netlify/functions/compost-build-bins-remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ buildName: system.name, binSerials: [serial] }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.details || err.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      addToast('success', `Bin #${serial} removed (${data.binsCleared} cleared)`);
      setConfirmRemoveSerial(null);
      await reload();
    } catch (err) {
      console.error('Remove bin error:', err);
      addToast('error', err instanceof Error ? err.message : 'Failed to remove bin');
    } finally {
      setRemovingSerial(null);
    }
  }

  // ── Add more bins ───────────────────────────────────────────────────────────
  function toggleAddBin(arrayIndex: number) {
    setAddSelected(prev => {
      const next = new Set(prev);
      if (next.has(arrayIndex)) next.delete(arrayIndex);
      else next.add(arrayIndex);
      return next;
    });
  }

  const handleScanSerial = useCallback((serial: string): Exclude<ScanOutcome, 'no_text'> => {
    const normalised = serial.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    const bin = availableBins.find(
      b => b.serialNumber.replace(/[^A-Za-z0-9]/g, '').toUpperCase() === normalised
    );
    if (!bin) return 'not_found';
    const wasSelected = addSelected.has(bin.arrayIndex);
    setAddSelected(prev => {
      const next = new Set(prev);
      if (next.has(bin.arrayIndex)) next.delete(bin.arrayIndex);
      else next.add(bin.arrayIndex);
      return next;
    });
    return wasSelected ? 'deselected' : 'selected';
  }, [availableBins, addSelected]);

  async function handleAddBins() {
    if (!system || addSelected.size === 0 || addingBins) return;
    setAddingBins(true);
    try {
      const res = await fetch('/.netlify/functions/compost-build-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          buildName: system.name,
          probeCount: system.probeLabels.length, // required by backend but tab already exists
          binRowIndices: Array.from(addSelected),
          buildDate: getNZDate(),
          ...(currentColour ? { colour: currentColour } : {}),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.details || err.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      addToast('success', `${data.binsAssigned} bin${data.binsAssigned === 1 ? '' : 's'} added to ${system.name}`);
      setAddSelected(new Set());
      setAddMode(false);
      setScanMode(false);
      await reload();
    } catch (err) {
      console.error('Add bins error:', err);
      addToast('error', err instanceof Error ? err.message : 'Failed to add bins');
    } finally {
      setAddingBins(false);
    }
  }

  // ── Recolour ────────────────────────────────────────────────────────────────
  async function handleRecolour(colour: string | null) {
    if (!system || recolouring) return;
    setRecolouring(true);
    setRecolourPending(colour);
    try {
      const res = await fetch('/.netlify/functions/compost-build-recolour', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ buildName: system.name, colour }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.details || err.error || `HTTP ${res.status}`);
      }
      addToast('success', colour ? `Recoloured to ${colour}` : 'Colour cleared');
      setRecolourOpen(false);
      await reload();
    } catch (err) {
      console.error('Recolour error:', err);
      addToast('error', err instanceof Error ? err.message : 'Failed to recolour');
    } finally {
      setRecolouring(false);
      setRecolourPending(null);
    }
  }

  // ── Log a turn ──────────────────────────────────────────────────────────
  async function handleLogTurn() {
    if (!system || loggingTurn) return;
    setLoggingTurn(true);
    try {
      // Convert YYYY-MM-DD to DD/MM/YYYY for the backend
      const [y, m, d] = turnDate.split('-');
      const dateForApi = `${d}/${m}/${y}`;
      const res = await fetch('/.netlify/functions/compost-build-log-turn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ buildName: system.name, date: dateForApi }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.details || err.error || `HTTP ${res.status}`);
      }
      addToast('success', `Turn logged for ${system.name} on ${dateForApi}`);
      setTurnOpen(false);
    } catch (err) {
      console.error('Log turn error:', err);
      addToast('error', err instanceof Error ? err.message : 'Failed to log turn');
    } finally {
      setLoggingTurn(false);
    }
  }

  // ── Save dimensions ────────────────────────────────────────────────────
  async function handleSaveDimensions() {
    if (!system) return;
    setSavingDims(true);
    try {
      const dimensions: BuildDimensions = {
        shape: dimShape,
        ...(dimShape === 'cuboid'
          ? {
              lengthCm: dimLength.trim() ? parseFloat(dimLength) : undefined,
              widthCm: dimWidth.trim() ? parseFloat(dimWidth) : undefined,
            }
          : {
              diameterCm: dimDiameter.trim() ? parseFloat(dimDiameter) : undefined,
            }),
        heightCm: dimHeight.trim() ? parseFloat(dimHeight) : undefined,
      };
      const updated = { ...system, dimensions };
      await updateCustomSystem(updated);
      addToast('success', 'Dimensions saved');
      setDimsOpen(false);
    } catch (err) {
      console.error('Save dims error:', err);
      addToast('error', 'Failed to save dimensions');
    } finally {
      setSavingDims(false);
    }
  }

  // ── Save probe count ──────────────────────────────────────────────────
  async function handleSaveProbes() {
    if (!system || savingProbes) return;
    const n = Math.max(1, Math.min(20, Math.floor(probeCountInput)));
    if (n === system.probeLabels.length) {
      setProbesOpen(false);
      return;
    }
    setSavingProbes(true);
    try {
      // Preserve existing labels where possible, pad with positional numbers
      const newLabels: string[] = [];
      for (let i = 0; i < n; i++) {
        newLabels.push(system.probeLabels[i] ?? String(i + 1));
      }
      const updated = { ...system, probeLabels: newLabels };
      await updateCustomSystem(updated);
      addToast('success', `Probe count set to ${n}`);
      setProbesOpen(false);
    } catch (err) {
      console.error('Save probes error:', err);
      addToast('error', 'Failed to save probe count');
    } finally {
      setSavingProbes(false);
    }
  }

  // ── Save metadata ─────────────────────────────────────────────────────
  async function handleSaveMeta() {
    if (!system) return;
    setSavingMeta(true);
    try {
      const updated = {
        ...system,
        buildType: editBuildType || undefined,
        mulchBins: editMulchBins.trim() ? parseFloat(editMulchBins) : undefined,
        mulchType: editMulchType || undefined,
      };
      await updateCustomSystem(updated);
      addToast('success', 'Build details saved');
      setMetaOpen(false);
    } catch (err) {
      console.error('Save meta error:', err);
      addToast('error', 'Failed to save details');
    } finally {
      setSavingMeta(false);
    }
  }

  // Volume calculation from current dimensions
  const initialVolume = system?.dimensions ? calcVolumeLitres(system.dimensions) : null;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-green-50/50 pb-32">
      <Header title={system.name} showBack onBack={() => navigate('/manage')} />

      <div className="p-4 space-y-4">

        {/* ── Summary card ────────────────────────────────────────────── */}
        <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-xs text-gray-400 uppercase tracking-wide">Build</p>
              <p className="text-lg font-semibold text-gray-900 truncate">{system.name}</p>
              <p className="text-sm text-gray-500 mt-0.5">
                {assignedBins.length} bin{assignedBins.length === 1 ? '' : 's'} · {system.probeLabels.length} probes
              </p>
              {/* Metadata summary */}
              {(system.buildType || system.mulchType || initialVolume) && (
                <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-400">
                  {system.buildType && <span>{system.buildType}</span>}
                  {system.mulchBins != null && <span>{system.mulchBins} bins mulch{system.mulchType ? ` (${system.mulchType})` : ''}</span>}
                  {initialVolume != null && <span>Vol: {formatVolume(initialVolume)}</span>}
                </div>
              )}
            </div>
            {currentColour && (
              <span className={`text-xs px-2.5 py-1 rounded-full font-medium shrink-0 ${colourBadge(currentColour)}`}>
                {currentColour}
              </span>
            )}
          </div>

          {/* Action row */}
          <div className="flex flex-wrap gap-2 mt-4">
            <button
              onClick={() => { setAddMode(m => !m); setAddSelected(new Set()); setScanMode(false); }}
              disabled={loading || !!loadError}
              className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border transition-colors ${
                addMode
                  ? 'border-green-primary text-green-primary bg-green-50'
                  : 'border-gray-200 text-gray-600 hover:border-green-300 hover:text-green-700'
              }`}
            >
              <Plus size={14} />
              {addMode ? 'Cancel add' : 'Add bins'}
            </button>
            <button
              onClick={() => setRecolourOpen(o => !o)}
              disabled={loading || !!loadError}
              className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border transition-colors ${
                recolourOpen
                  ? 'border-green-primary text-green-primary bg-green-50'
                  : 'border-gray-200 text-gray-600 hover:border-green-300 hover:text-green-700'
              }`}
            >
              <Palette size={14} />
              Recolour
            </button>
            <button
              onClick={() => { setTurnOpen(o => !o); setTurnDate(getNZDate()); }}
              disabled={loading || !!loadError}
              className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border transition-colors ${
                turnOpen
                  ? 'border-green-primary text-green-primary bg-green-50'
                  : 'border-gray-200 text-gray-600 hover:border-green-300 hover:text-green-700'
              }`}
            >
              <RotateCw size={14} />
              Log turn
            </button>
            <button
              onClick={() => setDimsOpen(o => !o)}
              disabled={loading || !!loadError}
              className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border transition-colors ${
                dimsOpen
                  ? 'border-green-primary text-green-primary bg-green-50'
                  : 'border-gray-200 text-gray-600 hover:border-green-300 hover:text-green-700'
              }`}
            >
              <Ruler size={14} />
              Dimensions
            </button>
            <button
              onClick={() => setMetaOpen(o => !o)}
              disabled={loading || !!loadError}
              className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border transition-colors ${
                metaOpen
                  ? 'border-green-primary text-green-primary bg-green-50'
                  : 'border-gray-200 text-gray-600 hover:border-green-300 hover:text-green-700'
              }`}
            >
              <Pencil size={14} />
              Details
            </button>
            <button
              onClick={() => {
                setProbesOpen(o => !o);
                setProbeCountInput(system?.probeLabels.length ?? 0);
              }}
              disabled={loading || !!loadError}
              className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border transition-colors ${
                probesOpen
                  ? 'border-green-primary text-green-primary bg-green-50'
                  : 'border-gray-200 text-gray-600 hover:border-green-300 hover:text-green-700'
              }`}
            >
              <Thermometer size={14} />
              Probes
            </button>
          </div>

          {/* Recolour picker */}
          {recolourOpen && (
            <div className="mt-3 pt-3 border-t border-gray-100">
              <p className="text-xs text-gray-500 mb-2">Pick a new colour (or clear):</p>
              <div className="flex gap-2 flex-wrap items-center">
                {ALL_COLOURS.map(c => {
                  const taken = usedColours.has(c);
                  const isCurrent = currentColour === c;
                  const disabled = taken || recolouring;
                  return (
                    <button
                      key={c}
                      onClick={() => handleRecolour(c)}
                      disabled={disabled}
                      title={taken ? `${c} — in use` : c}
                      className={`w-9 h-9 rounded-full transition-all ${COLOUR_BG[c]} ${
                        isCurrent
                          ? 'ring-2 ring-offset-2 ring-gray-500 scale-110'
                          : taken
                            ? 'opacity-25 cursor-not-allowed'
                            : 'opacity-80 hover:opacity-100'
                      } ${recolourPending === c ? 'animate-pulse' : ''}`}
                    />
                  );
                })}
                <button
                  onClick={() => handleRecolour(null)}
                  disabled={recolouring || !currentColour}
                  className="text-xs px-3 py-1.5 rounded-full border border-gray-200 text-gray-500 disabled:opacity-40"
                >
                  Clear
                </button>
              </div>
            </div>
          )}

          {/* Turn logging panel */}
          {turnOpen && (
            <div className="mt-3 pt-3 border-t border-gray-100 space-y-3">
              <p className="text-xs text-gray-500 font-medium">Record a pile turn</p>
              <div>
                <label className="text-xs text-gray-400">Date of turn</label>
                <input
                  type="date"
                  value={turnDate}
                  onChange={e => setTurnDate(e.target.value)}
                  className="w-full mt-0.5 px-2 py-2 border border-gray-200 rounded-lg text-sm focus:border-green-primary outline-none"
                />
              </div>
              <button
                onClick={handleLogTurn}
                disabled={loggingTurn}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-green-primary text-white font-medium disabled:opacity-50"
              >
                <RotateCw size={12} className={loggingTurn ? 'animate-spin' : ''} />
                {loggingTurn ? 'Logging…' : 'Log turn'}
              </button>
            </div>
          )}

          {/* Dimensions panel */}
          {dimsOpen && (
            <div className="mt-3 pt-3 border-t border-gray-100 space-y-3">
              <p className="text-xs text-gray-500 font-medium">Shape & dimensions</p>
              <div className="flex gap-2">
                {(['cuboid', 'cylinder'] as const).map(s => (
                  <button
                    key={s}
                    onClick={() => setDimShape(s)}
                    className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all capitalize ${
                      dimShape === s ? 'bg-green-primary text-white' : 'bg-gray-100 text-gray-700'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {dimShape === 'cuboid' ? (
                  <>
                    <div>
                      <label className="text-xs text-gray-400">Length (cm)</label>
                      <input type="number" inputMode="decimal" value={dimLength} onChange={e => setDimLength(e.target.value)} placeholder="200" min={0} className="w-full mt-0.5 px-2 py-2 border border-gray-200 rounded-lg text-sm focus:border-green-primary outline-none" />
                    </div>
                    <div>
                      <label className="text-xs text-gray-400">Width (cm)</label>
                      <input type="number" inputMode="decimal" value={dimWidth} onChange={e => setDimWidth(e.target.value)} placeholder="150" min={0} className="w-full mt-0.5 px-2 py-2 border border-gray-200 rounded-lg text-sm focus:border-green-primary outline-none" />
                    </div>
                  </>
                ) : (
                  <div className="col-span-2">
                    <label className="text-xs text-gray-400">Diameter at widest (cm)</label>
                    <input type="number" inputMode="decimal" value={dimDiameter} onChange={e => setDimDiameter(e.target.value)} placeholder="180" min={0} className="w-full mt-0.5 px-2 py-2 border border-gray-200 rounded-lg text-sm focus:border-green-primary outline-none" />
                  </div>
                )}
                <div className={dimShape === 'cuboid' ? 'col-span-2' : 'col-span-2'}>
                  <label className="text-xs text-gray-400">Initial height (cm)</label>
                  <input type="number" inputMode="decimal" value={dimHeight} onChange={e => setDimHeight(e.target.value)} placeholder="120" min={0} className="w-full mt-0.5 px-2 py-2 border border-gray-200 rounded-lg text-sm focus:border-green-primary outline-none" />
                </div>
              </div>
              <button
                onClick={handleSaveDimensions}
                disabled={savingDims}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-green-primary text-white font-medium disabled:opacity-50"
              >
                <Save size={12} />
                {savingDims ? 'Saving…' : 'Save dimensions'}
              </button>
            </div>
          )}

          {/* Build metadata panel */}
          {metaOpen && (
            <div className="mt-3 pt-3 border-t border-gray-100 space-y-3">
              <p className="text-xs text-gray-500 font-medium">Build details</p>
              <div>
                <label className="text-xs text-gray-400">Build type</label>
                {addingBuildType ? (
                  <div className="flex gap-1 mt-0.5">
                    <input type="text" value={newBuildType} onChange={e => setNewBuildType(e.target.value)} placeholder="New type…" className="flex-1 px-2 py-2 border border-gray-200 rounded-lg text-sm focus:border-green-primary outline-none" />
                    <button onClick={() => { if (newBuildType.trim()) { updateSettings({ customBuildTypes: [...(settings.customBuildTypes || []), newBuildType.trim()] }); setEditBuildType(newBuildType.trim()); setNewBuildType(''); } setAddingBuildType(false); }} className="px-2 py-1 text-xs text-green-primary font-medium">Add</button>
                    <button onClick={() => setAddingBuildType(false)} className="px-1 text-xs text-gray-400">Cancel</button>
                  </div>
                ) : (
                  <div className="flex gap-1 mt-0.5">
                    <select value={editBuildType} onChange={e => setEditBuildType(e.target.value)} className="flex-1 px-2 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:border-green-primary outline-none">
                      <option value="">Select…</option>
                      {allBuildTypes.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <button onClick={() => setAddingBuildType(true)} className="px-2 text-xs text-gray-500 border border-gray-200 rounded-lg">+ New</button>
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-gray-400">Mulch bins</label>
                  <input type="number" inputMode="decimal" value={editMulchBins} onChange={e => setEditMulchBins(e.target.value)} placeholder="3" min={0} className="w-full mt-0.5 px-2 py-2 border border-gray-200 rounded-lg text-sm focus:border-green-primary outline-none" />
                </div>
                <div>
                  <label className="text-xs text-gray-400">Mulch type</label>
                  {addingMulchType ? (
                    <div className="flex gap-1 mt-0.5">
                      <input type="text" value={newMulchType} onChange={e => setNewMulchType(e.target.value)} placeholder="Type" className="flex-1 min-w-0 px-2 py-2 border border-gray-200 rounded-lg text-sm focus:border-green-primary outline-none" />
                      <button onClick={() => { if (newMulchType.trim()) { updateSettings({ customMulchTypes: [...(settings.customMulchTypes || []), newMulchType.trim()] }); setEditMulchType(newMulchType.trim()); setNewMulchType(''); } setAddingMulchType(false); }} className="px-1 text-xs text-green-primary">Add</button>
                    </div>
                  ) : (
                    <div className="flex gap-1 mt-0.5">
                      <select value={editMulchType} onChange={e => setEditMulchType(e.target.value)} className="flex-1 min-w-0 px-2 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:border-green-primary outline-none">
                        <option value="">Select…</option>
                        {allMulchTypes.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                      <button onClick={() => setAddingMulchType(true)} className="px-1 text-xs text-gray-500 border border-gray-200 rounded-lg shrink-0">+</button>
                    </div>
                  )}
                </div>
              </div>
              <button
                onClick={handleSaveMeta}
                disabled={savingMeta}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-green-primary text-white font-medium disabled:opacity-50"
              >
                <Save size={12} />
                {savingMeta ? 'Saving…' : 'Save details'}
              </button>
            </div>
          )}

          {/* Probe count panel */}
          {probesOpen && (
            <div className="mt-3 pt-3 border-t border-gray-100 space-y-3">
              <div>
                <p className="text-xs text-gray-500 font-medium">Number of probes</p>
                <p className="text-[11px] text-gray-400 mt-0.5 leading-tight">
                  Reduce once the whole pile is out of the kill zone and fewer
                  readings are useful. Past entries keep their existing probe data.
                </p>
              </div>

              <div className="flex items-center justify-center gap-4">
                <button
                  onClick={() => setProbeCountInput(n => Math.max(1, n - 1))}
                  disabled={probeCountInput <= 1 || savingProbes}
                  className="w-10 h-10 rounded-full bg-gray-100 text-gray-700 flex items-center justify-center active:scale-95 transition-transform disabled:opacity-40"
                >
                  <Minus size={18} />
                </button>
                <div className="text-3xl font-bold text-gray-900 w-14 text-center tabular-nums">
                  {probeCountInput}
                </div>
                <button
                  onClick={() => setProbeCountInput(n => Math.min(20, n + 1))}
                  disabled={probeCountInput >= 20 || savingProbes}
                  className="w-10 h-10 rounded-full bg-gray-100 text-gray-700 flex items-center justify-center active:scale-95 transition-transform disabled:opacity-40"
                >
                  <Plus size={18} />
                </button>
              </div>

              {probeCountInput < (system?.probeLabels.length ?? 0) && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
                  Probes {probeCountInput + 1}–{system?.probeLabels.length} will no
                  longer be measured in future readings for this build.
                </div>
              )}

              <button
                onClick={handleSaveProbes}
                disabled={savingProbes || probeCountInput === (system?.probeLabels.length ?? 0)}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-green-primary text-white font-medium disabled:opacity-50"
              >
                <Save size={12} />
                {savingProbes ? 'Saving…' : 'Save probe count'}
              </button>
            </div>
          )}
        </div>

        {/* ── Loading / error ─────────────────────────────────────────── */}
        {loading && (
          <div className="flex items-center justify-center py-12 gap-3 text-gray-400">
            <Loader2 size={20} className="animate-spin" />
            <span className="text-sm">Loading bins…</span>
          </div>
        )}

        {!loading && loadError && (
          <div className="bg-white rounded-xl p-4 border border-red-200 text-red-600 text-sm">
            <p>{loadError}</p>
            <button
              onClick={reload}
              className="mt-2 text-xs underline"
            >
              Try again
            </button>
          </div>
        )}

        {/* ── Add-bins picker ─────────────────────────────────────────── */}
        {!loading && !loadError && addMode && (
          <div className="bg-white rounded-xl shadow-sm border border-green-200 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-green-50/40">
              <h2 className="font-semibold text-gray-900">
                Add bins
                {availableBins.length > 0 && (
                  <span className="ml-2 text-sm font-normal text-gray-400">
                    {addSelected.size} of {availableBins.length}
                  </span>
                )}
              </h2>
              {availableBins.length > 0 && (
                <button
                  onClick={() => setScanMode(s => !s)}
                  title={scanMode ? 'Close scanner' : 'Scan bin labels'}
                  className={`flex items-center gap-1.5 text-sm font-medium ${
                    scanMode ? 'text-green-primary' : 'text-gray-400 hover:text-gray-700'
                  }`}
                >
                  <ScanLine size={18} />
                  <span className="hidden sm:inline">{scanMode ? 'Scanning' : 'Scan'}</span>
                </button>
              )}
            </div>

            {scanMode && availableBins.length > 0 && (
              <div className="p-3 border-b border-gray-100">
                <BinScanner
                  onScanSerial={handleScanSerial}
                  onClose={() => setScanMode(false)}
                />
              </div>
            )}

            {availableBins.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-gray-400 gap-2">
                <Package size={32} className="opacity-40" />
                <p className="text-sm">No matured bins available</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-50 max-h-96 overflow-y-auto">
                {availableBins.map(bin => {
                  const isSelected = addSelected.has(bin.arrayIndex);
                  return (
                    <button
                      key={bin.arrayIndex}
                      onClick={() => toggleAddBin(bin.arrayIndex)}
                      className={`w-full flex items-start gap-3 px-4 py-3 text-left transition-colors ${
                        isSelected ? 'bg-green-50' : 'active:bg-gray-50'
                      }`}
                    >
                      <div className="mt-0.5 shrink-0 text-green-primary">
                        {isSelected
                          ? <CheckSquare size={20} />
                          : <Square size={20} className="text-gray-300" />
                        }
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          {bin.serialNumber && bin.serialNumber !== '0' && (
                            <span className="font-mono text-sm font-semibold text-gray-800">
                              #{bin.serialNumber}
                            </span>
                          )}
                          {bin.colour && (
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${colourBadge(bin.colour)}`}>
                              {bin.colour}
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-gray-600 mt-0.5">
                          {bin.sources.length > 0
                            ? bin.sources.join(' · ')
                            : <span className="text-gray-400 italic">Unknown source</span>
                          }
                        </p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          Collected {bin.collectionDate} · Matured {bin.maturationDate}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Current bins list ───────────────────────────────────────── */}
        {!loading && !loadError && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900">Current bins</h2>
              <p className="text-xs text-gray-400 mt-0.5">
                {assignedBins.length === 0
                  ? 'This build has no bins assigned'
                  : `${assignedBins.length} bin${assignedBins.length === 1 ? '' : 's'} in this build`}
              </p>
            </div>

            {assignedBins.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-gray-400 gap-2">
                <Package size={32} className="opacity-40" />
                <p className="text-sm">No bins yet — tap "Add bins" above</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-50">
                {assignedBins.map(bin => {
                  const isRemoving = removingSerial === bin.serialNumber;
                  const isConfirming = confirmRemoveSerial === bin.serialNumber;
                  return (
                    <div key={bin.arrayIndex} className="flex items-start gap-3 px-4 py-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          {bin.serialNumber && bin.serialNumber !== '0' && (
                            <span className="font-mono text-sm font-semibold text-gray-800">
                              #{bin.serialNumber}
                            </span>
                          )}
                          {bin.colour && (
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${colourBadge(bin.colour)}`}>
                              {bin.colour}
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-gray-600 mt-0.5">
                          {bin.sources.length > 0
                            ? bin.sources.join(' · ')
                            : <span className="text-gray-400 italic">Unknown source</span>
                          }
                        </p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          Collected {bin.collectionDate || '—'}
                          {bin.batchingDate ? ` · Batched ${bin.batchingDate}` : ''}
                        </p>
                      </div>
                      <div className="shrink-0">
                        {isRemoving ? (
                          <span className="text-xs text-gray-400 animate-pulse px-2">Removing…</span>
                        ) : isConfirming ? (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => handleRemoveBin(bin.serialNumber)}
                              className="text-xs px-2.5 py-1 rounded-full font-medium bg-red-100 text-red-600"
                            >
                              Confirm?
                            </button>
                            <button
                              onClick={() => setConfirmRemoveSerial(null)}
                              className="text-xs px-2 py-1 text-gray-400"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setConfirmRemoveSerial(bin.serialNumber)}
                            className="p-1.5 text-gray-300 hover:text-red-500 transition-colors"
                            title="Remove from build"
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

      </div>

      {/* ── Footer (only in add mode) ────────────────────────────────── */}
      {addMode && (
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-white border-t border-gray-200 shadow-lg">
          {addSelected.size > 0 && (
            <p className="text-xs text-center text-gray-400 mb-2">
              Adding {addSelected.size} bin{addSelected.size !== 1 ? 's' : ''} to "{system.name}"
            </p>
          )}
          <Button
            fullWidth
            size="lg"
            onClick={handleAddBins}
            disabled={addSelected.size === 0 || addingBins}
          >
            <div className="flex items-center justify-center gap-2">
              {addingBins
                ? <Loader2 size={20} className="animate-spin" />
                : <Hammer size={20} />
              }
              {addingBins ? 'Adding…' : 'Add to build'}
            </div>
          </Button>
        </div>
      )}
    </div>
  );
}
