import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Camera, Video, Grid3x3, List, Save, ChevronRight, Info } from 'lucide-react';
import { Header } from '@/components/Header';
import { Button } from '@/components/Button';
import { TempStepper } from '@/components/TempStepper';
import { TempGrid } from '@/components/TempGrid';
import { MediaCapture } from '@/components/MediaCapture';
import { useCompost } from '@/contexts/CompostContext';
import { queueMediaSync } from '@/services/syncService';
import { fetchWeather } from '@/services/weatherService';
import { getSystemById, getNZDate, getNZTime, KILL_TEMP_F, getTempColor } from '@/utils/config';
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

export function DailyEntryPage() {
  const { systemId } = useParams<{ systemId: string }>();
  const navigate = useNavigate();
  const { settings, saveEntry, getEntryForSystemDate, createBlankEntry, addToast } = useCompost();

  const system = systemId ? getSystemById(systemId) : undefined;
  const [entry, setEntry] = useState<DailyEntry | null>(null);
  const [isStepper, setIsStepper] = useState(settings.entryMode === 'stepper');
  const [saving, setSaving] = useState(false);
  const [showMedia, setShowMedia] = useState(false);
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([]);
  const [viewingMedia, setViewingMedia] = useState<MediaItem | null>(null);

  // Load or create entry
  useEffect(() => {
    if (!systemId) return;
    async function load() {
      const today = getNZDate();
      const existing = await getEntryForSystemDate(systemId!, today);
      if (existing) {
        // Re-map probe labels from current config in case they changed
        const sys = getSystemById(systemId!);
        const currentLabels = sys?.probeLabels || [];
        setEntry({
          ...existing,
          probes: existing.probes.map((p, i) => ({
            ...p,
            label: currentLabels[i] ?? p.label,
          })),
        });
      } else {
        setEntry(createBlankEntry(systemId!));
      }
    }
    load();
  }, [systemId, getEntryForSystemDate, createBlankEntry]);

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

  const handleSave = async () => {
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
    }
  };

  const handleMediaCaptured = async (item: MediaItem) => {
    setMediaItems(prev => [...prev, item]);
    updateEntry({ mediaIds: [...(entry?.mediaIds || []), item.id] });
    await queueMediaSync(entry?.id || '', item.id);
  };

  if (!system) {
    return (
      <div className="min-h-screen bg-green-50/50">
        <Header title="Not Found" showBack />
        <div className="p-4 text-center text-gray-500">System not found</div>
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
            <TempStepper probes={entry.probes} onChange={handleProbeChange} />
          ) : (
            <TempGrid probes={entry.probes} onChange={handleProbeChange} />
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
              onClick={() => setShowMedia(true)}
              className="flex-1 py-3 rounded-lg bg-gray-100 text-gray-700 font-medium flex items-center justify-center gap-2 active:scale-95 transition-all"
            >
              <Camera size={18} />
              Add Photo
            </button>
            <button
              onClick={() => setShowMedia(true)}
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

        {/* View charts link */}
        <button
          onClick={() => navigate(`/system/${systemId}`)}
          className="w-full bg-white rounded-xl p-4 shadow-sm border border-gray-100 flex items-center justify-between text-gray-700 active:scale-[0.98] transition-transform"
        >
          <span className="font-medium">View Temperature Charts</span>
          <ChevronRight size={20} />
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

      {/* Media capture modal */}
      {showMedia && (
        <MediaCapture
          entryId={entry.id}
          systemId={entry.systemId}
          date={entry.date}
          onCapture={handleMediaCaptured}
          onClose={() => setShowMedia(false)}
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
