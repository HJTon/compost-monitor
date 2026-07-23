import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Hammer, CheckSquare, Square, AlertCircle, Loader2, Package, ScanLine } from 'lucide-react';
import { Header } from '@/components/Header';
import { Button } from '@/components/Button';
import { BinScanner } from '@/components/BinScanner';
import type { ScanOutcome } from '@/components/BinScanner';
import { useCompost } from '@/contexts/CompostContext';
import { getNZDate, DEFAULT_MULCH_TYPES } from '@/utils/config';
import type { CompostSystem, BuildShape, BuildDimensions } from '@/types';

// ── Types ────────────────────────────────────────────────────────────────────

interface BinRow {
  arrayIndex: number; // 0-based index in the fetched data array (header = 0, first data = 1)
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

// "Pivot #5" → "pivot-5",  "Batch 4" → "batch-4"
function nameToId(name: string): string {
  return name
    .toLowerCase()
    .replace(/#/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// "Pivot #5" → "P5",  "Batch 4" → "B4",  "New Carbon Cube" → "NCC"
function nameToShortName(name: string): string {
  const firstLetter = name.replace(/[^a-zA-Z]/, '').charAt(0).toUpperCase();
  const numbers = name.replace(/[^0-9]/g, '');
  return (firstLetter + numbers) || name.slice(0, 3).toUpperCase();
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

// All colours available for assignment to a new build
const ALL_COLOURS = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink'];

// Solid background for the colour picker circles
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

export function BuildPage() {
  const navigate = useNavigate();
  const { addCustomSystem, addToast, settings, updateSettings, buildTypes, addBuildType } = useCompost();

  const [bins, setBins] = useState<BinRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [usedColours, setUsedColours] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [buildName, setBuildName] = useState('');
  const [shortName, setShortName] = useState('');
  const [probeCount, setProbeCount] = useState<3 | 5 | 9>(9);
  const [selectedColour, setSelectedColour] = useState<string | null>(null);
  const [heightCm, setHeightCm] = useState('');
  const [buildDate, setBuildDate] = useState(getNZDate()); // YYYY-MM-DD, defaults to today
  const [creating, setCreating] = useState(false);
  const [scanMode, setScanMode] = useState(false);

  // Build type
  const [buildType, setBuildType] = useState('');
  const [addingBuildType, setAddingBuildType] = useState(false);
  const [newBuildType, setNewBuildType] = useState('');
  const allBuildTypes = buildTypes;

  // Mulch
  const [mulchBins, setMulchBins] = useState('');
  const [mulchType, setMulchType] = useState('');
  const [addingMulchType, setAddingMulchType] = useState(false);
  const [newMulchType, setNewMulchType] = useState('');
  const allMulchTypes = [...DEFAULT_MULCH_TYPES, ...(settings.customMulchTypes || [])];

  // Dimensions
  const [buildShape, setBuildShape] = useState<BuildShape>('cuboid');
  const [dimLength, setDimLength] = useState('');
  const [dimWidth, setDimWidth] = useState('');
  const [dimDiameter, setDimDiameter] = useState('');

  // Load available bins from Bin Tracker
  useEffect(() => {
    async function load() {
      setLoading(true);
      setLoadError(null);
      try {
        const res = await fetch('/.netlify/functions/compost-sheets-read?tab=Bin%20Tracker');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        const rows: string[][] = json.data || [];

        const todayStr = getNZDate(); // YYYY-MM-DD
        const today = new Date(todayStr + 'T00:00:00');

        const available: BinRow[] = [];
        const taken = new Set<string>();

        rows.forEach((row, arrayIndex) => {
          if (arrayIndex === 0) return; // skip header

          // Collect all colours in use across the whole tracker
          const rowColour = (row[7] || '').trim().toLowerCase();
          if (rowColour) taken.add(rowColour);

          const batch = (row[10] || '').trim();
          if (batch !== '') return; // already assigned
          const matDate = parseTrackerDate(row[8] || '');
          if (!matDate || matDate > today) return; // not yet matured

          const sources = [row[1], row[2], row[3], row[4], row[5]]
            .map(v => (v || '').trim())
            .filter(Boolean);

          available.push({
            arrayIndex,
            collectionDate: (row[0] || '').trim(),
            sources,
            serialNumber: (row[6] || '').trim(),
            colour: rowColour,
            maturationDate: (row[8] || '').trim(),
          });
        });

        setUsedColours(taken);
        setBins(available);
      } catch (err) {
        setLoadError('Could not load bins. Check your connection and try again.');
        console.error('Bin Tracker load error:', err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // Auto-fill short name when build name changes
  useEffect(() => {
    if (buildName.trim()) {
      setShortName(nameToShortName(buildName.trim()));
    } else {
      setShortName('');
    }
  }, [buildName]);

  function toggleBin(index: number) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === bins.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(bins.map(b => b.arrayIndex)));
    }
  }

  // Called by BinScanner after OCR reads a serial — find the bin and toggle it
  const handleScanSerial = useCallback((serial: string): Exclude<ScanOutcome, 'no_text'> => {
    const normalised = serial.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    const bin = bins.find(
      b => b.serialNumber.replace(/[^A-Za-z0-9]/g, '').toUpperCase() === normalised
    );
    if (!bin) return 'not_found';
    const wasSelected = selected.has(bin.arrayIndex);
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(bin.arrayIndex)) next.delete(bin.arrayIndex);
      else next.add(bin.arrayIndex);
      return next;
    });
    return wasSelected ? 'deselected' : 'selected';
  }, [bins, selected]);

  async function handleCreate() {
    if (!buildName.trim() || selected.size === 0 || creating) return;

    setCreating(true);
    try {
      const parsedHeight = heightCm.trim() ? parseFloat(heightCm) : undefined;
      const res = await fetch('/.netlify/functions/compost-build-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          buildName: buildName.trim(),
          probeCount,
          binRowIndices: Array.from(selected),
          buildDate,
          ...(selectedColour ? { colour: selectedColour } : {}),
          ...(parsedHeight != null && !isNaN(parsedHeight) ? { height: parsedHeight } : {}),
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.details || err.error || `HTTP ${res.status}`);
      }

      // Build dimensions object
      const dimensions: BuildDimensions | undefined = (() => {
        const h = heightCm.trim() ? parseFloat(heightCm) : undefined;
        if (buildShape === 'cuboid') {
          const l = dimLength.trim() ? parseFloat(dimLength) : undefined;
          const w = dimWidth.trim() ? parseFloat(dimWidth) : undefined;
          if (l || w || h) return { shape: 'cuboid' as BuildShape, lengthCm: l, widthCm: w, heightCm: h };
        } else {
          const d = dimDiameter.trim() ? parseFloat(dimDiameter) : undefined;
          if (d || h) return { shape: 'cylinder' as BuildShape, diameterCm: d, heightCm: h };
        }
        return undefined;
      })();

      // Save the new system to IndexedDB + add to active systems
      const probeLabels = Array.from({ length: probeCount }, (_, i) => String(i + 1));
      const system: CompostSystem = {
        id: nameToId(buildName.trim()),
        name: buildName.trim(),
        shortName: shortName.trim() || nameToShortName(buildName.trim()),
        sheetTab: buildName.trim(),
        active: true,
        probeLabels,
        buildDate,
        buildType: buildType || undefined,
        mulchBins: mulchBins.trim() ? parseFloat(mulchBins) : undefined,
        mulchType: mulchType || undefined,
        dimensions,
      };
      await addCustomSystem(system);

      addToast('success', `"${buildName.trim()}" created with ${selected.size} bin${selected.size !== 1 ? 's' : ''}`);
      navigate('/dashboard');
    } catch (err) {
      console.error('Build create error:', err);
      addToast('error', err instanceof Error ? err.message : 'Failed to create build');
    } finally {
      setCreating(false);
    }
  }

  const canCreate = buildName.trim().length > 0 && selected.size > 0 && !creating;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-green-50/50 pb-32">
      <Header title="Let's Build" showBack onBack={() => navigate('/')} />

      <div className="p-4 space-y-4">

        {/* ── Build config ─────────────────────────────────────────────── */}
        <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 space-y-4">
          <h2 className="font-semibold text-gray-900">New Build</h2>

          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 sm:col-span-1">
              <label className="text-sm text-gray-500">Build name</label>
              <input
                type="text"
                value={buildName}
                onChange={e => setBuildName(e.target.value)}
                placeholder="e.g. Pivot #5, Batch 4…"
                className="w-full mt-1 px-3 py-2.5 border border-gray-200 rounded-lg outline-none focus:border-green-primary text-base"
              />
            </div>
            <div className="col-span-2 sm:col-span-1">
              <label className="text-sm text-gray-500">Date of build</label>
              <input
                type="date"
                value={buildDate}
                max={getNZDate()}
                onChange={e => setBuildDate(e.target.value)}
                className="w-full mt-1 px-3 py-2.5 border border-gray-200 rounded-lg outline-none focus:border-green-primary text-base"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm text-gray-500">Short name</label>
              <input
                type="text"
                value={shortName}
                onChange={e => setShortName(e.target.value.toUpperCase().slice(0, 4))}
                placeholder="e.g. P5"
                maxLength={4}
                className="w-full mt-1 px-3 py-2.5 border border-gray-200 rounded-lg outline-none focus:border-green-primary text-base font-mono"
              />
            </div>
            <div>
              <label className="text-sm text-gray-500 block mb-1">Probes</label>
              <div className="flex gap-2 mt-1">
                {([3, 5, 9] as const).map(n => (
                  <button
                    key={n}
                    onClick={() => setProbeCount(n)}
                    className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                      probeCount === n
                        ? 'bg-green-primary text-white'
                        : 'bg-gray-100 text-gray-700'
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <label className="text-sm text-gray-500 block mb-2">
              Build colour <span className="text-gray-400">— optional</span>
            </label>
            <div className="flex gap-2 flex-wrap">
              {ALL_COLOURS.filter(c => !usedColours.has(c)).map(colour => (
                <button
                  key={colour}
                  onClick={() => setSelectedColour(prev => prev === colour ? null : colour)}
                  title={colour}
                  className={`w-9 h-9 rounded-full transition-all ${COLOUR_BG[colour]} ${
                    selectedColour === colour
                      ? 'ring-2 ring-offset-2 ring-gray-500 scale-110'
                      : 'opacity-70 hover:opacity-100'
                  }`}
                />
              ))}
              {ALL_COLOURS.every(c => usedColours.has(c)) && (
                <span className="text-sm text-gray-400 italic">All colours are in use</span>
              )}
            </div>
          </div>

          {/* ── Build type ─────────────────────────────────────────── */}
          <div>
            <label className="text-sm text-gray-500">Build type</label>
            {addingBuildType ? (
              <div className="flex gap-2 mt-1">
                <input
                  type="text"
                  value={newBuildType}
                  onChange={e => setNewBuildType(e.target.value)}
                  placeholder="New build type…"
                  className="flex-1 px-3 py-2.5 border border-gray-200 rounded-lg outline-none focus:border-green-primary text-base"
                />
                <button
                  onClick={() => {
                    const trimmed = newBuildType.trim();
                    if (trimmed) {
                      addBuildType(trimmed);
                      setBuildType(trimmed);
                      setNewBuildType('');
                    }
                    setAddingBuildType(false);
                  }}
                  className="px-3 py-2 text-sm font-medium text-green-primary bg-green-50 rounded-lg"
                >
                  Add
                </button>
                <button onClick={() => setAddingBuildType(false)} className="px-2 py-2 text-sm text-gray-400">
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex gap-2 mt-1">
                <select
                  value={buildType}
                  onChange={e => setBuildType(e.target.value)}
                  className="flex-1 px-3 py-2.5 border border-gray-200 rounded-lg outline-none focus:border-green-primary text-base bg-white"
                >
                  <option value="">Select type…</option>
                  {allBuildTypes.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <button
                  onClick={() => setAddingBuildType(true)}
                  className="px-3 py-2 text-xs font-medium text-gray-500 border border-gray-200 rounded-lg hover:text-green-primary"
                  title="Add new type"
                >
                  + New
                </button>
              </div>
            )}
          </div>

          {/* ── Mulch ─────────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm text-gray-500">Mulch wheelie bins</label>
              <input
                type="number"
                inputMode="decimal"
                value={mulchBins}
                onChange={e => setMulchBins(e.target.value)}
                placeholder="e.g. 3"
                min={0}
                className="w-full mt-1 px-3 py-2.5 border border-gray-200 rounded-lg outline-none focus:border-green-primary text-base"
              />
            </div>
            <div>
              <label className="text-sm text-gray-500">Mulch type</label>
              {addingMulchType ? (
                <div className="flex gap-1 mt-1">
                  <input
                    type="text"
                    value={newMulchType}
                    onChange={e => setNewMulchType(e.target.value)}
                    placeholder="Type…"
                    className="flex-1 min-w-0 px-2 py-2.5 border border-gray-200 rounded-lg outline-none focus:border-green-primary text-sm"
                  />
                  <button
                    onClick={() => {
                      if (newMulchType.trim()) {
                        updateSettings({ customMulchTypes: [...(settings.customMulchTypes || []), newMulchType.trim()] });
                        setMulchType(newMulchType.trim());
                        setNewMulchType('');
                      }
                      setAddingMulchType(false);
                    }}
                    className="px-2 py-1 text-xs font-medium text-green-primary"
                  >
                    Add
                  </button>
                </div>
              ) : (
                <div className="flex gap-1 mt-1">
                  <select
                    value={mulchType}
                    onChange={e => setMulchType(e.target.value)}
                    className="flex-1 min-w-0 px-3 py-2.5 border border-gray-200 rounded-lg outline-none focus:border-green-primary text-base bg-white"
                  >
                    <option value="">Select…</option>
                    {allMulchTypes.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <button
                    onClick={() => setAddingMulchType(true)}
                    className="px-2 py-2 text-xs font-medium text-gray-500 border border-gray-200 rounded-lg shrink-0"
                    title="Add mulch type"
                  >
                    +
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* ── Shape & Dimensions ────────────────────────────────────── */}
          <div>
            <label className="text-sm text-gray-500 block mb-1">Build shape</label>
            <div className="flex gap-2">
              {(['cuboid', 'cylinder'] as const).map(s => (
                <button
                  key={s}
                  onClick={() => setBuildShape(s)}
                  className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all capitalize ${
                    buildShape === s
                      ? 'bg-green-primary text-white'
                      : 'bg-gray-100 text-gray-700'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {buildShape === 'cuboid' ? (
              <>
                <div>
                  <label className="text-sm text-gray-500">Length (cm)</label>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={dimLength}
                    onChange={e => setDimLength(e.target.value)}
                    placeholder="e.g. 200"
                    min={0}
                    className="w-full mt-1 px-3 py-2.5 border border-gray-200 rounded-lg outline-none focus:border-green-primary text-base"
                  />
                </div>
                <div>
                  <label className="text-sm text-gray-500">Width (cm)</label>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={dimWidth}
                    onChange={e => setDimWidth(e.target.value)}
                    placeholder="e.g. 150"
                    min={0}
                    className="w-full mt-1 px-3 py-2.5 border border-gray-200 rounded-lg outline-none focus:border-green-primary text-base"
                  />
                </div>
              </>
            ) : (
              <div className="col-span-2">
                <label className="text-sm text-gray-500">Diameter at widest point (cm)</label>
                <input
                  type="number"
                  inputMode="decimal"
                  value={dimDiameter}
                  onChange={e => setDimDiameter(e.target.value)}
                  placeholder="e.g. 180"
                  min={0}
                  className="w-full mt-1 px-3 py-2.5 border border-gray-200 rounded-lg outline-none focus:border-green-primary text-base"
                />
              </div>
            )}
          </div>

          <div>
            <label className="text-sm text-gray-500">
              Initial height (cm)
            </label>
            <input
              type="number"
              inputMode="decimal"
              value={heightCm}
              onChange={e => setHeightCm(e.target.value)}
              placeholder="e.g. 120"
              min={0}
              className="w-full mt-1 px-3 py-2.5 border border-gray-200 rounded-lg outline-none focus:border-green-primary text-base"
            />
          </div>
        </div>

        {/* ── Bin selection ────────────────────────────────────────────── */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">
              Select Bins
              {bins.length > 0 && (
                <span className="ml-2 text-sm font-normal text-gray-400">
                  {selected.size} of {bins.length} selected
                </span>
              )}
            </h2>
            {bins.length > 0 && (
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setScanMode(prev => !prev)}
                  title={scanMode ? 'Close scanner' : 'Scan bin labels'}
                  className={`flex items-center gap-1.5 text-sm font-medium transition-colors ${
                    scanMode ? 'text-green-primary' : 'text-gray-400 hover:text-gray-700'
                  }`}
                >
                  <ScanLine size={18} />
                  <span className="hidden sm:inline">{scanMode ? 'Scanning' : 'Scan'}</span>
                </button>
                <button
                  onClick={toggleAll}
                  className="text-sm text-green-primary font-medium"
                >
                  {selected.size === bins.length ? 'Deselect all' : 'Select all'}
                </button>
              </div>
            )}
          </div>

          {/* ── Scanner ──────────────────────────────────────────────────── */}
          {scanMode && !loading && !loadError && bins.length > 0 && (
            <div className="p-3 border-b border-gray-100">
              <BinScanner
                onScanSerial={handleScanSerial}
                onClose={() => setScanMode(false)}
              />
            </div>
          )}

          {loading && (
            <div className="flex items-center justify-center py-12 gap-3 text-gray-400">
              <Loader2 size={20} className="animate-spin" />
              <span className="text-sm">Loading bins…</span>
            </div>
          )}

          {!loading && loadError && (
            <div className="flex items-center gap-3 p-4 text-red-600">
              <AlertCircle size={18} className="shrink-0" />
              <div>
                <p className="text-sm font-medium">{loadError}</p>
                <button
                  onClick={() => window.location.reload()}
                  className="text-xs text-red-500 underline mt-0.5"
                >
                  Reload page
                </button>
              </div>
            </div>
          )}

          {!loading && !loadError && bins.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-gray-400 gap-2">
              <Package size={36} className="opacity-40" />
              <p className="text-sm">No matured bins available</p>
              <p className="text-xs">All bins are either assigned or still maturing</p>
            </div>
          )}

          {!loading && !loadError && bins.length > 0 && (
            <div className="divide-y divide-gray-50">
              {bins.map(bin => {
                const isSelected = selected.has(bin.arrayIndex);
                return (
                  <button
                    key={bin.arrayIndex}
                    onClick={() => toggleBin(bin.arrayIndex)}
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

      </div>

      {/* ── Fixed footer ────────────────────────────────────────────────── */}
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-white border-t border-gray-200 shadow-lg">
        {selected.size > 0 && buildName.trim() && (
          <p className="text-xs text-center text-gray-400 mb-2">
            Creating "{buildName.trim()}" with {selected.size} bin{selected.size !== 1 ? 's' : ''} · {probeCount} probes{heightCm.trim() ? ` · ${heightCm} cm tall` : ''}
          </p>
        )}
        <Button
          fullWidth
          size="lg"
          onClick={handleCreate}
          disabled={!canCreate}
        >
          <div className="flex items-center justify-center gap-2">
            {creating
              ? <Loader2 size={20} className="animate-spin" />
              : <Hammer size={20} />
            }
            {creating ? 'Creating…' : 'Create Build'}
          </div>
        </Button>
      </div>
    </div>
  );
}
