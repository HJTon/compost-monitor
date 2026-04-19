import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Camera, Video, Grid3x3, List, Save, TrendingUp, Info, CheckCircle, PlusCircle, RefreshCw, Ruler, ArrowRightLeft } from 'lucide-react';

import { Header } from '@/components/Header';
import { Button } from '@/components/Button';
import { TempStepper } from '@/components/TempStepper';
import { TempGrid } from '@/components/TempGrid';
import { MediaCapture } from '@/components/MediaCapture';
import { SaveConfirmModal, type SaveConfirmIssue } from '@/components/SaveConfirmModal';
import { useCompost } from '@/contexts/CompostContext';
import { queueMediaSync } from '@/services/syncService';
import { fetchWeather } from '@/services/weatherService';
import {
  getNZDate, getNZTime, KILL_TEMP_F, getTempColor,
  getTempLowerLimitF, TEMP_UPPER_LIMIT_F,
} from '@/utils/config';
import type { DailyEntry, WeatherCondition, MoistureLevel, OdourLevel, ProbeReading, MediaItem } from '@/types';

const WEATHER_OPTIONS: WeatherCondition[] = ['Sunny', 'Cloudy', 'Overcast', 'Rain', 'Wind', 'Frost'];
const MOISTURE_OPTIONS: MoistureLevel[] = ['Dry', 'Good', 'Wet'];
const ODOUR_OPTIONS: { value: OdourLevel; emoji: string; label: string }[] = [
  { value: '1', emoji: '\u{1F600}', label: 'Inoffensive' },
  { value: '2', emoji: '\u{1F610}', label: 'Slight' },
  { value: '3', emoji: '\u{1F627}', label: 'Moderate' },
  { value: '4', emoji: '\u{1F922}', label: 'Strong' },
  { value: '5', emoji: '\u{1F92E}', label: 'Disgusting' },
];

function parseHeightDate(s: string): Date | null {
  if (!s) return null;
  const dm = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (dm) return new Date(Number(dm[3]), Number(dm[2]) - 1, Number(dm[1]));
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  return null;
}

export function DailyEntryPage() {
  const { systemId } = useParams<{ systemId: string }>();
  const navigate = useNavigate();
  const { settings, saveEntry, getEntryForSystemDate, createBlankEntry, addToast, getSystem } = useCompost();

  const system = systemId ? getSystem(systemId) : undefined;
  const [entry, setEntry] = useState<DailyEntry | null>(null);
  const [todayExisting, setTodayExisting] = useState<DailyEntry | null>(null);
  const [showChoice, setShowChoice] = useState(false);
  const [isStepper, setIsStepper] = useState(settings.entryMode === 'stepper');
  const [saving, setSaving] = useState(false);
  const [pendingIssues, setPendingIssues] = useState<SaveConfirmIssue[] | null>(null);
  /** Probe values the user has explicitly confirmed as out-of-range but correct. */
  const [confirmedValues, setConfirmedValues] = useState<Map<number, number>>(new Map());
  /** Per-probe guardrail popup (fires as soon as an extreme reading is committed). */
  const [probeCheck, setProbeCheck] = useState<{ probeIndex: number; issue: SaveConfirmIssue } | null>(null);
  const [captureMode, setCaptureMode] = useState<'photo' | 'video' | null>(null);
  const [captureKey, setCaptureKey] = useState(0);

  const openCapture = (mode: 'photo' | 'video') => {
    setCaptureMode(mode);
    setCaptureKey(k => k + 1);
  };
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([]);
  const [viewingMedia, setViewingMedia] = useState<MediaItem | null>(null);

  // Height measurement
  const [heightOpen, setHeightOpen] = useState(false);
  const [heightDue, setHeightDue] = useState(false);

  // Load or create entry
  useEffect(() => {
    if (!systemId) return;
    async function load() {
      const today = getNZDate();
      const existing = await getEntryForSystemDate(systemId!, today);
      if (existing) {
        setTodayExisting(existing);
        setShowChoice(true);
      } else {
        setEntry(createBlankEntry(systemId!));
      }
    }
    load();
  }, [systemId, getEntryForSystemDate, createBlankEntry]);

  // Check if height measurement is due (every 2 weeks)
  useEffect(() => {
    if (!system?.sheetTab) return;
    fetch(`/.netlify/functions/compost-sheets-history?tab=${encodeURIComponent(system.sheetTab)}&limit=60`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data?.entries?.length) {
          // No history — height is due
          setHeightDue(true);
          setHeightOpen(true);
          return;
        }
        // Find most recent entry with a height value
        const withHeight = data.entries.filter((e: any) => e.height !== null && e.height !== undefined);
        if (withHeight.length === 0) {
          setHeightDue(true);
          setHeightOpen(true);
          return;
        }
        const lastHeight = withHeight[withHeight.length - 1];
        const lastDate = parseHeightDate(lastHeight.date);
        if (!lastDate) {
          setHeightDue(true);
          setHeightOpen(true);
          return;
        }
        const daysSince = Math.floor((Date.now() - lastDate.getTime()) / 86400000);
        if (daysSince >= 14) {
          setHeightDue(true);
          setHeightOpen(true);
        }
      })
      .catch(() => {}); // fail silently
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [system?.sheetTab]);

  // Auto-fill weather
  useEffect(() => {
    if (!entry || entry.weatherAuto) return;
    async function loadWeather() {
      const data = await fetchWeather(settings.farmLatitude, settings.farmLongitude, entry!.date);
      if (data && entry) {
        setEntry(prev => prev ? {
          ...prev,
          weather: prev.weather || data.condition,
          weatherAuto: !prev.weather,
          ambientMin: prev.ambientMin ?? data.minTemp,
          ambientMax: prev.ambientMax ?? data.maxTemp,
          ambientMinAuto: prev.ambientMin === null,
          ambientMaxAuto: prev.ambientMax === null,
        } : prev);
      }
    }
    loadWeather();
    // Only run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry?.date]);

  const updateEntry = useCallback((updates: Partial<DailyEntry>) => {
    setEntry(prev => {
      if (!prev) return prev;
      const updated = { ...prev, ...updates };

      // Recalculate averages
      const validProbes = updated.probes.filter(p => p.value !== null);
      if (validProbes.length > 0) {
        const values = validProbes.map(p => p.value as number);
        updated.averageTemp = Math.round(values.reduce((a, b) => a + b, 0) / values.length);
        updated.peakTemp = Math.max(...values);
      } else {
        updated.averageTemp = null;
        updated.peakTemp = null;
      }

      return updated;
    });
  }, []);

  const handleProbeChange = useCallback((probes: ProbeReading[]) => {
    updateEntry({ probes });
  }, [updateEntry]);

  /** Called when the user commits a probe value (moves on in stepper, blurs in grid). */
  const handleProbeCommit = useCallback((probeIndex: number) => {
    setEntry(prev => {
      if (!prev) return prev;
      const probe = prev.probes[probeIndex];
      if (!probe || probe.value === null) return prev;
      // Skip if this exact value was already confirmed by the user
      if (confirmedValues.get(probeIndex) === probe.value) return prev;
      const lowerLimit = getTempLowerLimitF(prev.ambientMax);
      const upperLimit = TEMP_UPPER_LIMIT_F;
      const label = `Probe ${probe.label}`;
      if (probe.value > upperLimit) {
        setProbeCheck({
          probeIndex,
          issue: { type: 'too_high', label, value: probe.value, limit: upperLimit },
        });
      } else if (probe.value < lowerLimit) {
        setProbeCheck({
          probeIndex,
          issue: { type: 'too_low', label, value: probe.value, limit: lowerLimit },
        });
      }
      return prev;
    });
  }, [confirmedValues]);

  const performSave = async () => {
    if (!entry) return;
    setSaving(true);
    try {
      await saveEntry({ ...entry, time: getNZTime() });
      addToast('success', `${system?.name || 'Entry'} saved`);
      navigate('/dashboard');
    } catch (err) {
      console.error('Save failed:', err);
      addToast('error', 'Failed to save entry');
    } finally {
      setSaving(false);
      setPendingIssues(null);
    }
  };

  const handleSave = () => {
    if (!entry) return;
    // Build list of guardrail issues before saving
    const lowerLimit = getTempLowerLimitF(entry.ambientMax);
    const upperLimit = TEMP_UPPER_LIMIT_F;
    const issues: SaveConfirmIssue[] = [];
    entry.probes.forEach((p, i) => {
      const label = `Probe ${p.label}`;
      if (p.value === null) {
        issues.push({ type: 'skipped', label });
        return;
      }
      // Out-of-range values that the user already explicitly confirmed
      // per-probe don't need to be re-raised at save time.
      if (confirmedValues.get(i) === p.value) return;
      if (p.value > upperLimit) {
        issues.push({ type: 'too_high', label, value: p.value, limit: upperLimit });
      } else if (p.value < lowerLimit) {
        issues.push({ type: 'too_low', label, value: p.value, limit: lowerLimit });
      }
    });
    if (issues.length > 0) {
      setPendingIssues(issues);
      return;
    }
    performSave();
  };

  const handleMediaCaptured = async (item: MediaItem) => {
    setMediaItems(prev => [...prev, item]);
    updateEntry({ mediaIds: [...(entry?.mediaIds || []), item.id] });
    await queueMediaSync(entry?.id || '', item.id);
  };

  const handleReplaceReading = () => {
    if (!todayExisting || !systemId) return;
    const sys = getSystem(systemId);
    const currentLabels = sys?.probeLabels || [];
    setEntry({
      ...todayExisting,
      probes: todayExisting.probes.map((p, i) => ({
        ...p,
        label: currentLabels[i] ?? p.label,
      })),
    });
    setShowChoice(false);
  };

  const handleAddReading = () => {
    setEntry(createBlankEntry(systemId!));
    setShowChoice(false);
  };

  if (!system) {
    return (
      <div className="min-h-screen bg-green-50/50">
        <Header title="Not Found" showBack />
        <div className="p-4 text-center text-gray-500">System not found</div>
      </div>
    );
  }

  if (showChoice && todayExisting) {
    return (
      <div className="min-h-screen bg-green-50/50">
        <Header title={system.name} showBack />
        <div className="p-4 space-y-4">
          <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100 text-center">
            <CheckCircle size={44} className="text-green-500 mx-auto mb-3" />
            <h3 className="font-semibold text-gray-900 text-lg mb-1">Already measured today</h3>
            {todayExisting.time && (
              <p className="text-sm text-gray-400 mb-2">{todayExisting.time}</p>
            )}
            {todayExisting.averageTemp !== null && (
              <p className="text-sm text-gray-500">
                Avg {todayExisting.averageTemp}°F · Peak {todayExisting.peakTemp}°F
              </p>
            )}
          </div>

          <button
            onClick={handleReplaceReading}
            className="w-full bg-white rounded-xl p-4 shadow-sm border border-gray-100 flex items-center gap-4 active:scale-[0.98] transition-transform text-left"
          >
            <div className="w-10 h-10 rounded-lg bg-amber-50 flex items-center justify-center flex-shrink-0">
              <RefreshCw size={20} className="text-amber-500" />
            </div>
            <div>
              <div className="font-semibold text-gray-900">Update today's reading</div>
              <div className="text-sm text-gray-500">Edit and replace the existing measurement</div>
            </div>
          </button>

          <button
            onClick={handleAddReading}
            className="w-full bg-white rounded-xl p-4 shadow-sm border border-gray-100 flex items-center gap-4 active:scale-[0.98] transition-transform text-left"
          >
            <div className="w-10 h-10 rounded-lg bg-green-50 flex items-center justify-center flex-shrink-0">
              <PlusCircle size={20} className="text-green-600" />
            </div>
            <div>
              <div className="font-semibold text-gray-900">Log a second reading</div>
              <div className="text-sm text-gray-500">Record another measurement for today</div>
            </div>
          </button>
        </div>
      </div>
    );
  }

  if (!entry) {
    return (
      <div className="min-h-screen bg-green-50/50">
        <Header title={system.name} showBack />
        <div className="p-4 text-center text-gray-500">Loading...</div>
      </div>
    );
  }

  const filledProbes = entry.probes.filter(p => p.value !== null).length;
  const isAboveKill = entry.peakTemp !== null && entry.peakTemp >= KILL_TEMP_F;

  return (
    <div className="min-h-screen bg-green-50/50 pb-24">
      <Header title={system.name} showBack />

      <div className="p-4 space-y-5">
        {/* Date & Time */}
        <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-gray-500">Date</div>
              <div className="font-semibold">{entry.date}</div>
            </div>
            <div className="text-right">
              <div className="text-sm text-gray-500">Time</div>
              <div className="font-semibold">{entry.time}</div>
            </div>
          </div>
        </div>

        {/* Weather */}
        <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-900">Weather</h3>
            {entry.weatherAuto && (
              <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full flex items-center gap-1">
                <Info size={10} /> auto
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {WEATHER_OPTIONS.map(w => (
              <button
                key={w}
                onClick={() => updateEntry({ weather: w, weatherAuto: false })}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                  entry.weather === w
                    ? 'bg-green-primary text-white'
                    : 'bg-gray-100 text-gray-700'
                }`}
              >
                {w}
              </button>
            ))}
          </div>
        </div>

        {/* Ambient Temps */}
        <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
          <h3 className="font-semibold text-gray-900 mb-3">Ambient Temperature</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm text-gray-500 flex items-center gap-1">
                Min °C
                {entry.ambientMinAuto && (
                  <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full">auto</span>
                )}
              </label>
              <input
                type="number"
                inputMode="decimal"
                value={entry.ambientMin ?? ''}
                onChange={e => updateEntry({
                  ambientMin: e.target.value === '' ? null : parseFloat(e.target.value),
                  ambientMinAuto: false,
                })}
                className="w-full mt-1 px-3 py-2.5 border border-gray-200 rounded-lg text-lg font-semibold outline-none focus:border-green-primary [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                placeholder="--"
              />
            </div>
            <div>
              <label className="text-sm text-gray-500 flex items-center gap-1">
                Max °C
                {entry.ambientMaxAuto && (
                  <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full">auto</span>
                )}
              </label>
              <input
                type="number"
                inputMode="decimal"
                value={entry.ambientMax ?? ''}
                onChange={e => updateEntry({
                  ambientMax: e.target.value === '' ? null : parseFloat(e.target.value),
                  ambientMaxAuto: false,
                })}
                className="w-full mt-1 px-3 py-2.5 border border-gray-200 rounded-lg text-lg font-semibold outline-none focus:border-green-primary [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                placeholder="--"
              />
            </div>
          </div>
        </div>

        {/* Moisture & Odour */}
        <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
          <div className="space-y-4">
            <div>
              <h3 className="font-semibold text-gray-900 mb-2">Moisture</h3>
              <div className="flex gap-2">
                {MOISTURE_OPTIONS.map(m => (
                  <button
                    key={m}
                    onClick={() => updateEntry({ moisture: m })}
                    className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all ${
                      entry.moisture === m
                        ? 'bg-green-primary text-white'
                        : 'bg-gray-100 text-gray-700'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 mb-2">Odour</h3>
              <div className="flex gap-1.5">
                {ODOUR_OPTIONS.map(o => (
                  <button
                    key={o.value}
                    onClick={() => updateEntry({ odour: o.value })}
                    className={`flex-1 py-2 rounded-lg text-center transition-all ${
                      entry.odour === o.value
                        ? 'bg-green-primary text-white ring-2 ring-green-primary ring-offset-1'
                        : 'bg-gray-100 text-gray-700'
                    }`}
                  >
                    <div className="text-xl">{o.emoji}</div>
                    <div className="text-[10px] leading-tight mt-0.5">{o.label}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Temperature Entry */}
        <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900">Probe Temperatures (°F)</h3>
            <button
              onClick={() => setIsStepper(!isStepper)}
              className="p-2 rounded-lg bg-gray-100 text-gray-600 active:scale-95 transition-all"
              title={isStepper ? 'Switch to grid' : 'Switch to stepper'}
            >
              {isStepper ? <Grid3x3 size={18} /> : <List size={18} />}
            </button>
          </div>

          {isStepper ? (
            <TempStepper probes={entry.probes} onChange={handleProbeChange} onProbeCommit={handleProbeCommit} />
          ) : (
            <TempGrid probes={entry.probes} onChange={handleProbeChange} onProbeCommit={handleProbeCommit} />
          )}
        </div>

        {/* Summary */}
        {filledProbes > 0 && (
          <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
            <h3 className="font-semibold text-gray-900 mb-3">Summary</h3>
            <div className="grid grid-cols-3 gap-3">
              <div className="text-center">
                <div className="text-sm text-gray-500">Average</div>
                <div className={`text-2xl font-bold ${entry.averageTemp !== null ? getTempColor(entry.averageTemp).split(' ')[0] : 'text-gray-400'}`}>
                  {entry.averageTemp !== null ? `${entry.averageTemp}°` : '--'}
                </div>
              </div>
              <div className="text-center">
                <div className="text-sm text-gray-500">Peak</div>
                <div className={`text-2xl font-bold ${entry.peakTemp !== null ? getTempColor(entry.peakTemp).split(' ')[0] : 'text-gray-400'}`}>
                  {entry.peakTemp !== null ? `${entry.peakTemp}°` : '--'}
                </div>
              </div>
              <div className="text-center">
                <div className="text-sm text-gray-500">Kill Cycle</div>
                <div className={`text-2xl font-bold ${isAboveKill ? 'text-green-600' : 'text-gray-400'}`}>
                  {isAboveKill ? 'Active' : 'Below'}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Height measurement */}
        <div className={`bg-white rounded-xl shadow-sm border transition-colors ${
          heightDue && !entry.height
            ? 'border-amber-300 ring-2 ring-amber-200'
            : 'border-gray-100'
        }`}>
          <button
            onClick={() => setHeightOpen(o => !o)}
            className="w-full p-4 flex items-center justify-between"
          >
            <div className="flex items-center gap-3">
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${
                heightDue && !entry.height ? 'bg-amber-100' : 'bg-gray-100'
              }`}>
                <Ruler size={18} className={heightDue && !entry.height ? 'text-amber-600' : 'text-gray-600'} />
              </div>
              <div className="text-left">
                <div className={`font-semibold ${heightDue && !entry.height ? 'text-amber-700' : 'text-gray-900'}`}>
                  Measure Height
                  {heightDue && !entry.height && (
                    <span className="ml-2 text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">
                      Due
                    </span>
                  )}
                </div>
                <div className="text-xs text-gray-400">
                  {entry.height !== null ? `${entry.height} cm recorded` : 'Pile height in cm'}
                </div>
              </div>
            </div>
            <div className={`text-sm transition-transform ${heightOpen ? 'rotate-90' : ''}`}>
              ›
            </div>
          </button>

          {heightOpen && (
            <div className="px-4 pb-4 pt-0">
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  inputMode="decimal"
                  value={entry.height ?? ''}
                  onChange={e => updateEntry({
                    height: e.target.value === '' ? null : parseFloat(e.target.value),
                  })}
                  className="flex-1 px-3 py-2.5 border border-gray-200 rounded-lg text-lg font-semibold outline-none focus:border-green-primary [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  placeholder="Height in cm"
                  min={0}
                />
                <span className="text-sm text-gray-500 font-medium">cm</span>
              </div>
              {heightDue && (
                <p className="text-xs text-amber-600 mt-2">
                  It's been 2+ weeks since the last height measurement. Please record one today.
                </p>
              )}
            </div>
          )}
        </div>

        {/* Turn toggle + new dimensions */}
        <div className={`bg-white rounded-xl shadow-sm border transition-colors ${
          entry.turn ? 'border-green-300 ring-2 ring-green-200' : 'border-gray-100'
        }`}>
          <button
            onClick={() => updateEntry({ turn: !entry.turn, ...(!entry.turn ? {} : { newWidth: null, newLength: null }) })}
            className="w-full p-4 flex items-center justify-between"
          >
            <div className="flex items-center gap-3">
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${
                entry.turn ? 'bg-green-100' : 'bg-gray-100'
              }`}>
                <RefreshCw size={18} className={entry.turn ? 'text-green-600' : 'text-gray-600'} />
              </div>
              <div className="text-left">
                <div className={`font-semibold ${entry.turn ? 'text-green-700' : 'text-gray-900'}`}>
                  Turn
                </div>
                <div className="text-xs text-gray-400">
                  {entry.turn ? 'This entry marks a turn' : 'Tap to mark this as a turn'}
                </div>
              </div>
            </div>
            <div className={`w-10 h-6 rounded-full transition-colors ${entry.turn ? 'bg-green-500' : 'bg-gray-300'}`}>
              <div className={`w-5 h-5 bg-white rounded-full shadow-sm transform transition-transform mt-0.5 ${entry.turn ? 'translate-x-4.5 ml-0.5' : 'translate-x-0.5'}`} />
            </div>
          </button>

          {entry.turn && (
            <div className="px-4 pb-4 pt-0 space-y-3">
              <div className="flex items-center gap-2 text-sm text-green-700">
                <ArrowRightLeft size={14} />
                <span className="font-medium">New bay dimensions (optional)</span>
              </div>
              <p className="text-xs text-gray-400">If the compost moved to a different bay, enter the new dimensions</p>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="text-xs text-gray-500 mb-1 block">Width (cm)</label>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={entry.newWidth ?? ''}
                    onChange={e => updateEntry({
                      newWidth: e.target.value === '' ? null : parseFloat(e.target.value),
                    })}
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-lg font-semibold outline-none focus:border-green-primary [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    placeholder="Width"
                    min={0}
                  />
                </div>
                <div className="flex-1">
                  <label className="text-xs text-gray-500 mb-1 block">Length (cm)</label>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={entry.newLength ?? ''}
                    onChange={e => updateEntry({
                      newLength: e.target.value === '' ? null : parseFloat(e.target.value),
                    })}
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-lg font-semibold outline-none focus:border-green-primary [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    placeholder="Length"
                    min={0}
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Notes */}
        <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 space-y-3">
          <h3 className="font-semibold text-gray-900">Notes</h3>
          <div>
            <label className="text-sm text-gray-500">Vent Temps</label>
            <input
              type="text"
              value={entry.ventTemps}
              onChange={e => updateEntry({ ventTemps: e.target.value })}
              className="w-full mt-1 px-3 py-2.5 border border-gray-200 rounded-lg outline-none focus:border-green-primary"
              placeholder="e.g. In: 45, Out: 62"
            />
          </div>
          <div>
            <label className="text-sm text-gray-500">Visual Notes</label>
            <textarea
              value={entry.visualNotes}
              onChange={e => updateEntry({ visualNotes: e.target.value })}
              className="w-full mt-1 px-3 py-2.5 border border-gray-200 rounded-lg outline-none focus:border-green-primary resize-none"
              rows={2}
              placeholder="Appearance, steam, insects..."
            />
          </div>
          <div>
            <label className="text-sm text-gray-500">General Notes</label>
            <textarea
              value={entry.generalNotes}
              onChange={e => updateEntry({ generalNotes: e.target.value })}
              className="w-full mt-1 px-3 py-2.5 border border-gray-200 rounded-lg outline-none focus:border-green-primary resize-none"
              rows={2}
              placeholder="Any other observations..."
            />
          </div>
        </div>

        {/* Media */}
        <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-900">Media</h3>
            <span className="text-xs text-gray-400">{mediaItems.length} items</span>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => openCapture('photo')}
              className="flex-1 py-3 rounded-lg bg-gray-100 text-gray-700 font-medium flex items-center justify-center gap-2 active:scale-95 transition-all"
            >
              <Camera size={18} />
              Add Photo
            </button>
            <button
              onClick={() => openCapture('video')}
              className="flex-1 py-3 rounded-lg bg-gray-100 text-gray-700 font-medium flex items-center justify-center gap-2 active:scale-95 transition-all"
            >
              <Video size={18} />
              Record Video
            </button>
          </div>

          {/* Thumbnail gallery */}
          {mediaItems.length > 0 && (
            <div className="mt-3 flex gap-2 overflow-x-auto hide-scrollbar">
              {mediaItems.map(item => (
                <button
                  key={item.id}
                  onClick={() => setViewingMedia(item)}
                  className="w-16 h-16 rounded-lg bg-gray-200 flex-shrink-0 overflow-hidden"
                >
                  {item.thumbnailBase64 && (
                    <img src={item.thumbnailBase64} alt="" className="w-full h-full object-cover" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* View analysis link */}
        <button
          onClick={() => navigate(`/analyse/${systemId}`)}
          className="w-full bg-white rounded-xl p-4 shadow-sm border border-gray-100 flex items-center justify-between text-gray-700 active:scale-[0.98] transition-transform"
        >
          <div className="flex items-center gap-3">
            <TrendingUp size={18} className="text-green-600" />
            <span className="font-medium">View Analysis</span>
          </div>
          <div className="text-xs text-gray-400">Let's Analyse →</div>
        </button>
      </div>

      {/* Fixed save button */}
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-white border-t border-gray-200 shadow-lg">
        <Button
          fullWidth
          size="lg"
          onClick={handleSave}
          disabled={saving || filledProbes === 0}
        >
          <div className="flex items-center justify-center gap-2">
            <Save size={20} />
            {saving ? 'Saving...' : `Save Entry (${filledProbes}/${entry.probes.length} probes)`}
          </div>
        </Button>
      </div>

      {/* Media capture — mode drives straight to photo or video without a menu */}
      {captureMode && (
        <MediaCapture
          key={captureKey}
          mode={captureMode}
          systemName={system?.name ?? ''}
          entryId={entry.id}
          systemId={entry.systemId}
          date={entry.date}
          onCapture={handleMediaCaptured}
          onClose={() => setCaptureMode(null)}
        />
      )}

      {/* Per-probe guardrail (fires as soon as an extreme reading is entered) */}
      {probeCheck && (
        <SaveConfirmModal
          issues={[probeCheck.issue]}
          title="Check this reading"
          subtitle="That temperature looks unusual — is the value correct?"
          primaryLabel="Let me fix it"
          secondaryLabel="Yes, keep it"
          onGoBack={() => {
            // Clear the probe so the user can re-enter
            if (entry) {
              const updated = entry.probes.map((p, i) =>
                i === probeCheck.probeIndex ? { ...p, value: null } : p
              );
              handleProbeChange(updated);
            }
            setProbeCheck(null);
          }}
          onSaveAnyway={() => {
            // Mark this value as user-confirmed so it doesn't get re-flagged
            const probe = entry?.probes[probeCheck.probeIndex];
            if (probe && probe.value !== null) {
              setConfirmedValues(prev => {
                const next = new Map(prev);
                next.set(probeCheck.probeIndex, probe.value as number);
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
          onReduceProbes={() => {
            setPendingIssues(null);
            navigate(`/manage/${systemId}`);
          }}
        />
      )}

      {/* Full-screen media viewer */}
      {viewingMedia && (
        <div
          className="fixed inset-0 bg-black z-50 flex items-center justify-center"
          onClick={() => setViewingMedia(null)}
        >
          <button
            className="absolute top-4 right-4 text-white text-3xl font-bold z-10"
            onClick={() => setViewingMedia(null)}
          >
            &times;
          </button>
          {viewingMedia.type === 'photo' ? (
            <img
              src={viewingMedia.driveUrl || viewingMedia.base64 || ''}
              alt={viewingMedia.filename}
              className="max-w-full max-h-full object-contain"
            />
          ) : (
            <video
              src={viewingMedia.driveUrl || (viewingMedia.blob ? URL.createObjectURL(viewingMedia.blob) : '')}
              controls
              autoPlay
              className="max-w-full max-h-full"
              onClick={e => e.stopPropagation()}
            />
          )}
        </div>
      )}
    </div>
  );
}
