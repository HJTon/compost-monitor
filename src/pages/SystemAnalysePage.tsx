import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { Upload, FlaskConical, ChevronDown, ChevronUp, Printer } from 'lucide-react';
import { Header } from '@/components/Header';
import { InlinePhotoSlot } from '@/components/InlinePhotoSlot';
import { BuildDescription } from '@/components/BuildDescription';
import { getSystemById, KILL_TEMP_F, KILL_DAYS_REQUIRED, generateId } from '@/utils/config';
import { useCompost } from '@/contexts/CompostContext';
import { calcVolumeLitres, formatVolume, volumeChangePercent } from '@/utils/volume';
import { parseReadinessCSV, extractDateFromFilename, getReadinessSummary } from '@/utils/readinessParser';
import type { ReadinessCheck } from '@/types';

function fToC(f: number | null): number | null {
  if (f === null) return null;
  return Math.round(((f - 32) * 5) / 9 * 10) / 10;
}

interface SheetEntry {
  date: string;
  average: number | null;
  peak: number | null;
  height: number | null;
  turn?: boolean;
  sample?: string;
  visualNotes?: string;
  generalNotes?: string;
  /** Ambient min (°C) as recorded in the sheet */
  ambientMin?: number | null;
  /** Ambient max (°C) as recorded in the sheet */
  ambientMax?: number | null;
}

function cToF(c: number | null | undefined): number | null {
  if (c === null || c === undefined) return null;
  return Math.round((c * 9) / 5 + 32);
}

interface ChartPoint {
  date: string;
  avg: number | null;
  peak: number | null;
  avgEst: number | null;
  peakEst: number | null;
  height: number | null;
  turn: boolean;
  sample: string;
  visualNotes: string;
  generalNotes: string;
  isEstimate: boolean;
  /** Ambient min/max stored in °F for display consistency; converted in useCelsius branch */
  ambientMinF: number | null;
  ambientMaxF: number | null;
}

interface CompositionItem {
  source: string;
  percentage: number;
}

function parseEntryDate(s: string): Date | null {
  if (!s) return null;
  // DD/MM/YYYY
  const dm = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (dm) return new Date(Number(dm[3]), Number(dm[2]) - 1, Number(dm[1]));
  // YYYY-MM-DD
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  return null;
}

function formatDayLabel(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Build a continuous day-by-day series from sparse entries, interpolating gaps. */
function buildContinuousSeries(entries: SheetEntry[]): ChartPoint[] {
  const dated = entries
    .map(e => ({ e, d: parseEntryDate(e.date) }))
    .filter((x): x is { e: SheetEntry; d: Date } => x.d !== null);

  if (dated.length === 0) return [];

  // Dedupe to one entry per day (last one wins, but merge turn flag)
  const byDay = new Map<number, SheetEntry>();
  for (const { e, d } of dated) {
    d.setHours(0, 0, 0, 0);
    const existing = byDay.get(d.getTime());
    const merged = {
      ...e,
      turn: (e.turn || existing?.turn) ?? false,
      sample: e.sample || existing?.sample || '',
      visualNotes: e.visualNotes || existing?.visualNotes || '',
      generalNotes: e.generalNotes || existing?.generalNotes || '',
    };
    byDay.set(d.getTime(), merged);
  }

  const keys = [...byDay.keys()].sort((a, b) => a - b);
  const first = new Date(keys[0]);
  const last = new Date(keys[keys.length - 1]);
  const totalDays = Math.round((last.getTime() - first.getTime()) / 86400000);

  const points: ChartPoint[] = [];
  for (let i = 0; i <= totalDays; i++) {
    const d = new Date(first);
    d.setDate(first.getDate() + i);
    const known = byDay.get(d.getTime());
    points.push({
      date: formatDayLabel(d),
      avg: known ? known.average : null,
      peak: known ? known.peak : null,
      avgEst: null,
      peakEst: null,
      height: known ? known.height : null,
      turn: known?.turn ?? false,
      sample: known?.sample || '',
      visualNotes: known?.visualNotes || '',
      generalNotes: known?.generalNotes || '',
      isEstimate: !known,
      ambientMinF: known ? cToF(known.ambientMin) : null,
      ambientMaxF: known ? cToF(known.ambientMax) : null,
    });
  }

  // Linearly interpolate gaps for a given field and write into `estKey`.
  // Real-data days also get the real value in estKey so the dashed line connects
  // cleanly through gap boundaries.
  const fillGaps = (key: 'avg' | 'peak', estKey: 'avgEst' | 'peakEst') => {
    const len = points.length;
    const leftIdx: number[] = new Array(len).fill(-1);
    const rightIdx: number[] = new Array(len).fill(-1);
    let last = -1;
    for (let i = 0; i < len; i++) {
      if (points[i][key] !== null) last = i;
      leftIdx[i] = last;
    }
    let next = -1;
    for (let i = len - 1; i >= 0; i--) {
      if (points[i][key] !== null) next = i;
      rightIdx[i] = next;
    }
    for (let i = 0; i < len; i++) {
      const real = points[i][key];
      if (real !== null) {
        points[i][estKey] = real;
      } else {
        const l = leftIdx[i];
        const r = rightIdx[i];
        if (l >= 0 && r >= 0 && l !== r) {
          const lv = points[l][key] as number;
          const rv = points[r][key] as number;
          const t = (i - l) / (r - l);
          points[i][estKey] = Math.round((lv + (rv - lv) * t) * 10) / 10;
        }
      }
    }
  };
  fillGaps('avg', 'avgEst');
  fillGaps('peak', 'peakEst');

  return points;
}

interface TooltipPayloadItem {
  payload: ChartPoint;
}

function ChartTooltip({ active, payload, label, useCelsius, showAmbient }: { active?: boolean; payload?: TooltipPayloadItem[]; label?: string; useCelsius?: boolean; showAmbient?: boolean }) {
  if (!active || !payload || !payload.length) return null;
  const point = payload[0].payload;
  const isEst = point.isEstimate;
  const avg = isEst ? point.avgEst : point.avg;
  const peak = isEst ? point.peakEst : point.peak;
  const unit = useCelsius ? '°C' : '°F';
  if (avg === null && peak === null) return null;
  const ambMax = useCelsius ? fToC(point.ambientMaxF) : point.ambientMaxF;
  const ambMin = useCelsius ? fToC(point.ambientMinF) : point.ambientMinF;
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-sm px-3 py-2 text-xs">
      <div className="font-medium text-gray-900 mb-1">
        {label}{isEst && <span className="text-gray-400"> · estimated</span>}
        {point.turn && <span className="text-green-600 font-bold"> 🔄 Turn</span>}
        {point.sample && <span className="text-blue-600 font-bold"> 🧪 Sample</span>}
      </div>
      {avg !== null && (
        <div className="text-green-700">Average: {avg}{unit}</div>
      )}
      {peak !== null && (
        <div className="text-amber-600">Peak: {peak}{unit}</div>
      )}
      {showAmbient && (ambMax !== null || ambMin !== null) && (
        <div className="mt-0.5 text-sky-700">
          Ambient: {ambMin !== null ? `${ambMin}${unit}` : '—'} / {ambMax !== null ? `${ambMax}${unit}` : '—'}
        </div>
      )}
      {!isEst && (point.generalNotes || point.visualNotes) && (
        <div className="mt-1.5 pt-1.5 border-t border-gray-100 text-gray-600 max-w-[240px] whitespace-pre-wrap">
          {point.generalNotes && <div>{point.generalNotes}</div>}
          {point.visualNotes && (
            <div className={point.generalNotes ? 'mt-1 text-gray-500 italic' : 'text-gray-600'}>
              {point.visualNotes}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function SystemAnalysePage() {
  const { systemId } = useParams<{ systemId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const isPublicView = location.pathname.startsWith('/view');
  const { getSystem, businesses } = useCompost();
  const hardcoded = systemId ? getSystemById(systemId) : undefined;
  const custom = systemId ? getSystem(systemId) : undefined;
  const system = custom || hardcoded;

  const [chartData, setChartData] = useState<ChartPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentStreak, setCurrentStreak] = useState(0);
  const [longestStreak, setLongestStreak] = useState(0);
  const [totalEntries, setTotalEntries] = useState(0);
  const [composition, setComposition] = useState<CompositionItem[]>([]);
  const [binCount, setBinCount] = useState(0);
  const [compLoading, setCompLoading] = useState(true);
  const [useCelsius, setUseCelsius] = useState(false);
  const [showAmbient, setShowAmbient] = useState(false);
  const [sheetDimensions, setSheetDimensions] = useState<{ heightCm: number | null; widthCm: number | null; lengthCm: number | null } | null>(null);

  // Readiness checks
  const [readinessChecks, setReadinessChecks] = useState<ReadinessCheck[]>([]);
  const [readinessLoading, setReadinessLoading] = useState(false);
  const [readinessExpanded, setReadinessExpanded] = useState<string | null>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);
  const { addToast } = useCompost();

  useEffect(() => {
    if (!systemId) return;
    setReadinessLoading(true);
    fetch(`/.netlify/functions/compost-readiness-read?system=${encodeURIComponent(systemId)}`)
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(data => {
        const checks: ReadinessCheck[] = (data.checks || []).sort(
          (a: ReadinessCheck, b: ReadinessCheck) => a.date.localeCompare(b.date)
        );
        setReadinessChecks(checks);
      })
      .catch(() => {})
      .finally(() => setReadinessLoading(false));
  }, [systemId]);

  const handleCSVUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !systemId) return;

    try {
      const text = await file.text();
      const results = parseReadinessCSV(text);
      const date = extractDateFromFilename(file.name) || new Date().toISOString().slice(0, 10);

      const check: ReadinessCheck = {
        id: generateId(),
        systemId,
        date,
        results,
        createdAt: new Date().toISOString(),
      };

      // Save to spreadsheet
      const res = await fetch('/.netlify/functions/compost-readiness-write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(check),
      });

      if (!res.ok) throw new Error('Failed to save');

      setReadinessChecks(prev => [...prev, check].sort((a, b) => a.date.localeCompare(b.date)));
      addToast('success', `Readiness check imported for ${date}`);
    } catch {
      addToast('error', 'Failed to import CSV');
    }

    // Reset input so same file can be re-uploaded
    e.target.value = '';
  }, [systemId, addToast]);

  useEffect(() => {
    if (!system?.sheetTab) return;
    setLoading(true);
    fetch(`/.netlify/functions/compost-sheets-history?tab=${encodeURIComponent(system.sheetTab)}&limit=365`)
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(data => {
        // Store sheet-reported dimensions (from metadata row) as fallback for volume calc
        if (data.sheetDimensions) {
          setSheetDimensions(data.sheetDimensions);
        }
        if (data.entries?.length) {
          const entries: SheetEntry[] = data.entries;
          setTotalEntries(entries.length);

          // Chart data: continuous day-by-day with interpolated estimates in gaps
          const series = buildContinuousSeries(entries);

          // Inject initial build height into the first chart point if no entries have height data
          // but the sheet has an initial height on the metadata row (e.g. CC3: Height=100)
          if (data.sheetDimensions?.heightCm != null && series.length > 0) {
            const hasAnyHeight = series.some(p => p.height !== null);
            if (!hasAnyHeight) {
              series[0] = { ...series[0], height: data.sheetDimensions.heightCm };
            }
          }

          setChartData(series);

          // Current streak — consecutive days from most recent backwards
          let current = 0;
          for (const entry of [...entries].reverse()) {
            if (entry.peak !== null && entry.peak >= KILL_TEMP_F) {
              current++;
            } else {
              break;
            }
          }
          setCurrentStreak(current);

          // Longest streak — scan full history
          let longest = 0;
          let running = 0;
          for (const entry of entries) {
            if (entry.peak !== null && entry.peak >= KILL_TEMP_F) {
              running++;
              longest = Math.max(longest, running);
            } else {
              running = 0;
            }
          }
          setLongestStreak(longest);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [system?.sheetTab]);

  useEffect(() => {
    if (!system?.sheetTab) return;
    setCompLoading(true);
    fetch(`/.netlify/functions/compost-bin-composition?system=${encodeURIComponent(system.sheetTab.trim())}`)
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(data => {
        if (data.composition) {
          setComposition(data.composition);
          setBinCount(data.binCount ?? 0);
        }
      })
      .catch(() => {})
      .finally(() => setCompLoading(false));
  }, [system?.sheetTab]);

  const displayData = useMemo(() => {
    if (!useCelsius) return chartData;
    return chartData.map(pt => ({
      ...pt,
      avg: fToC(pt.avg),
      peak: fToC(pt.peak),
      avgEst: fToC(pt.avgEst),
      peakEst: fToC(pt.peakEst),
      ambientMinF: fToC(pt.ambientMinF),
      ambientMaxF: fToC(pt.ambientMaxF),
    }));
  }, [chartData, useCelsius]);

  const killLineValue = useCelsius ? fToC(KILL_TEMP_F)! : KILL_TEMP_F;
  const tempUnit = useCelsius ? '°C' : '°F';

  if (!system) {
    return (
      <div className="min-h-screen bg-green-50/50">
        <Header title="Not Found" showBack />
        <div className="p-4 text-center text-gray-500">System not found</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-green-50/50 pb-8">
      <Header title={system.name} showBack onBack={() => navigate(isPublicView ? '/view' : '/analyse')} />

      <div className="p-4 space-y-4">

        {/* Print button */}
        {!isPublicView && (
          <div className="flex justify-end">
            <button
              onClick={() => window.open(`/analyse/${systemId}/print`, '_blank')}
              className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-green-primary px-2 py-1 rounded"
            >
              <Printer size={14} /> Print / Save as PDF
            </button>
          </div>
        )}

        {/* Pile description — build type, notes, summary */}
        <BuildDescription system={system} readOnly={isPublicView} />

        {/* Composition + Build-start photos */}
        <div className="grid md:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
          <h3 className="font-semibold text-gray-900 mb-3">Composition</h3>
          {compLoading ? (
            <div className="flex justify-center py-4">
              <div className="w-5 h-5 border-2 border-green-600 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : composition.length > 0 ? (
            <div className="space-y-2">
              {composition.map(({ source, percentage }) => {
                const biz = businesses.find(b => b.name === source);
                return (
                <div key={source}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-gray-700">
                      {source}
                      {(biz?.businessType || biz?.wasteType) && (
                        <span className="ml-1.5 text-xs text-gray-400 font-normal">
                          ({[biz?.businessType, biz?.wasteType].filter(Boolean).join(' — ')})
                        </span>
                      )}
                    </span>
                    <span className="font-medium text-gray-900">{percentage}%</span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-2">
                    <div
                      className="bg-green-500 h-2 rounded-full"
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                </div>
                );
              })}
              <p className="text-xs text-gray-400 mt-3">
                Estimated from {binCount} bin{binCount !== 1 ? 's' : ''} · weighted by fill position
              </p>
              {system.mulchBins != null && system.mulchBins > 0 && (
                <div className="mt-3 pt-3 border-t border-gray-100">
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-gray-700">
                      Mulch{system.mulchType ? ` (${system.mulchType})` : ''}
                    </span>
                    <span className="font-medium text-gray-900">
                      {binCount > 0
                        ? `${Math.round((system.mulchBins / (binCount + system.mulchBins)) * 100)}%`
                        : `${system.mulchBins} bin${system.mulchBins !== 1 ? 's' : ''}`
                      }
                    </span>
                  </div>
                  {binCount > 0 && (
                    <div className="w-full bg-gray-100 rounded-full h-2">
                      <div
                        className="bg-amber-500 h-2 rounded-full"
                        style={{ width: `${Math.round((system.mulchBins / (binCount + system.mulchBins)) * 100)}%` }}
                      />
                    </div>
                  )}
                  <p className="text-xs text-gray-400 mt-1">
                    {system.mulchBins} bin{system.mulchBins !== 1 ? 's' : ''} of mulch added to build
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-4 text-gray-400 text-sm">No bin data found</div>
          )}
        </div>
          <InlinePhotoSlot systemName={system.name} slotId="start" heightClass="h-full min-h-56" />
        </div>

        {/* Kill cycle summary */}
        <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
          <h3 className="font-semibold text-gray-900 mb-3">Kill Cycle</h3>
          {loading ? (
            <div className="flex justify-center py-4">
              <div className="w-5 h-5 border-2 border-green-600 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              <div className="text-center">
                <div className="text-sm text-gray-500">Current</div>
                <div className={`text-3xl font-bold ${currentStreak >= KILL_DAYS_REQUIRED ? 'text-green-600' : 'text-amber-500'}`}>
                  {currentStreak}
                </div>
                <div className="text-xs text-gray-400">day streak</div>
              </div>
              <div className="text-center">
                <div className="text-sm text-gray-500">Longest</div>
                <div className="text-3xl font-bold text-gray-700">{longestStreak}</div>
                <div className="text-xs text-gray-400">days</div>
              </div>
              <div className="text-center">
                <div className="text-sm text-gray-500">Readings</div>
                <div className="text-3xl font-bold text-gray-700">{totalEntries}</div>
                <div className="text-xs text-gray-400">total</div>
              </div>
            </div>
          )}
        </div>

        {/* Temperature chart */}
        <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-gray-900">Temperature</h3>
              <button
                onClick={() => setUseCelsius(c => !c)}
                className="text-xs px-2.5 py-1 rounded-full font-medium bg-gray-100 text-gray-600 active:scale-95 transition-all"
              >
                {useCelsius ? '°C → °F' : '°F → °C'}
              </button>
              <button
                onClick={() => setShowAmbient(v => !v)}
                className={`text-xs px-2.5 py-1 rounded-full font-medium active:scale-95 transition-all ${showAmbient ? 'bg-sky-100 text-sky-700 border border-sky-200' : 'bg-gray-100 text-gray-600'}`}
                title="Toggle ambient high/low temperatures"
              >
                Ambient
              </button>
            </div>
            {!loading && chartData.length > 0 && (
              <span className="text-xs text-gray-400">
                {chartData[0].date} → {chartData[chartData.length - 1].date} · {chartData.length} days
              </span>
            )}
          </div>
          {loading ? (
            <div className="h-[250px] flex items-center justify-center">
              <div className="w-6 h-6 border-2 border-green-600 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : displayData.length > 0 ? (
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={displayData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} interval="preserveStartEnd" minTickGap={40} />
                <YAxis tick={{ fontSize: 11 }} domain={[0, 'auto']} />
                <Tooltip content={<ChartTooltip useCelsius={useCelsius} showAmbient={showAmbient} />} />
                <ReferenceLine
                  y={killLineValue}
                  stroke="#EF4444"
                  strokeDasharray="5 5"
                  label={{ value: `${killLineValue}${tempUnit} Kill`, fill: '#EF4444', fontSize: 11 }}
                />
                {system.maturation?.startedAt && displayData.some(d => d.date >= system.maturation!.startedAt) && (
                  <ReferenceLine
                    x={system.maturation.startedAt}
                    stroke="#D97706"
                    strokeDasharray="3 3"
                    label={{ value: 'Maturation', fill: '#D97706', fontSize: 11, position: 'insideTopRight' }}
                  />
                )}
                {/* Turn icons rendered via customized dot on an invisible line */}
                <Line
                  type="monotone"
                  dataKey="avg"
                  stroke="none"
                  strokeWidth={0}
                  isAnimationActive={false}
                  dot={(props: { cx?: number; cy?: number; index?: number }) => {
                    const { cx, cy, index } = props;
                    if (cx == null || cy == null || index == null) return <g />;
                    if (!displayData[index]?.turn) return <g />;
                    return (
                      <g key={`turn-${index}`}>
                        {/* Green circle */}
                        <circle cx={cx} cy={cy} r={10} fill="#22C55E" opacity={0.9} />
                        {/* Circular arrow icon */}
                        <path
                          d={`M${cx - 4},${cy - 1} A4,4 0 1,1 ${cx + 3},${cy + 3}`}
                          fill="none"
                          stroke="white"
                          strokeWidth={1.5}
                          strokeLinecap="round"
                        />
                        {/* Arrowhead */}
                        <path
                          d={`M${cx + 1},${cy + 1} L${cx + 3},${cy + 3} L${cx + 5},${cy + 1}`}
                          fill="none"
                          stroke="white"
                          strokeWidth={1.5}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </g>
                    );
                  }}
                  legendType="none"
                  name=""
                  connectNulls
                />
                {/* Sample icons: dashed line up from data point with icon at top */}
                <Line
                  type="monotone"
                  dataKey="peak"
                  stroke="none"
                  strokeWidth={0}
                  isAnimationActive={false}
                  dot={(props: { cx?: number; cy?: number; index?: number }) => {
                    const { cx, cy, index } = props;
                    if (cx == null || cy == null || index == null) return <g />;
                    if (!displayData[index]?.sample) return <g />;
                    const stemHeight = 35;
                    const iconY = Math.max(cy - stemHeight, 22);
                    return (
                      <g key={`sample-${index}`}>
                        {/* Dashed vertical stem */}
                        <line
                          x1={cx} y1={cy} x2={cx} y2={iconY + 10}
                          stroke="#3B82F6" strokeWidth={1.5} strokeDasharray="3 3"
                        />
                        {/* Blue circle with test tube icon */}
                        <circle cx={cx} cy={iconY} r={9} fill="#3B82F6" opacity={0.9} />
                        <rect x={cx - 2.5} y={iconY - 5} width={5} height={8} rx={1.5} fill="none" stroke="white" strokeWidth={1.3} />
                        <line x1={cx - 2.5} y1={iconY - 2} x2={cx + 2.5} y2={iconY - 2} stroke="white" strokeWidth={1} />
                        <line x1={cx} y1={iconY + 3} x2={cx} y2={iconY + 5} stroke="white" strokeWidth={1.3} strokeLinecap="round" />
                      </g>
                    );
                  }}
                  legendType="none"
                  name=""
                  connectNulls
                />
                {/* Dashed estimate lines — drawn first so solid lines sit on top */}
                <Line type="monotone" dataKey="avgEst" stroke="#2D8B4E" strokeWidth={2} strokeDasharray="4 4" dot={false} name="Average (est.)" connectNulls isAnimationActive={false} />
                <Line type="monotone" dataKey="peakEst" stroke="#F59E0B" strokeWidth={2} strokeDasharray="4 4" dot={false} name="Peak (est.)" connectNulls isAnimationActive={false} />
                {/* Solid actual-data lines on top, with gaps where no data */}
                <Line type="monotone" dataKey="avg" stroke="#2D8B4E" strokeWidth={2} name="Average" dot={{ r: chartData.length > 60 ? 0 : 3 }} isAnimationActive={false} />
                <Line type="monotone" dataKey="peak" stroke="#F59E0B" strokeWidth={2} name="Peak" dot={{ r: chartData.length > 60 ? 0 : 3 }} isAnimationActive={false} />
                {showAmbient && (
                  <>
                    <Line type="monotone" dataKey="ambientMaxF" stroke="#0EA5E9" strokeWidth={1.5} strokeDasharray="2 3" dot={false} name="Ambient max" connectNulls isAnimationActive={false} />
                    <Line type="monotone" dataKey="ambientMinF" stroke="#38BDF8" strokeWidth={1.5} strokeDasharray="2 3" dot={false} name="Ambient min" connectNulls isAnimationActive={false} />
                  </>
                )}
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[250px] flex items-center justify-center text-gray-400 text-sm">
              No data in spreadsheet yet
            </div>
          )}
          {/* Chart legend */}
          {displayData.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 px-1">
              <span className="flex items-center gap-1.5 text-xs text-gray-500">
                <span className="w-4 h-0.5 bg-[#2D8B4E] inline-block rounded" /> Average
              </span>
              <span className="flex items-center gap-1.5 text-xs text-gray-500">
                <span className="w-4 h-0.5 bg-[#F59E0B] inline-block rounded" /> Peak
              </span>
              <span className="flex items-center gap-1.5 text-xs text-gray-500">
                <span className="w-4 h-0.5 border-t-2 border-dashed border-[#EF4444] inline-block" /> Kill line
              </span>
              <span className="flex items-center gap-1.5 text-xs text-gray-500">
                <svg width="14" height="14" viewBox="0 0 20 20" className="inline-block shrink-0">
                  <circle cx="10" cy="10" r="9" fill="#22C55E" opacity="0.9" />
                  <path d="M6,9 A4,4 0 1,1 13,13" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
                  <path d="M11,11 L13,13 L15,11" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Turn
              </span>
              <span className="flex items-center gap-1.5 text-xs text-gray-500">
                <svg width="14" height="14" viewBox="0 0 20 20" className="inline-block shrink-0">
                  <circle cx="10" cy="10" r="9" fill="#3B82F6" opacity="0.9" />
                  <rect x="7.5" y="5" width="5" height="8" rx="1.5" fill="none" stroke="white" strokeWidth="1.3" />
                  <line x1="7.5" y1="8" x2="12.5" y2="8" stroke="white" strokeWidth="1" />
                  <line x1="10" y1="13" x2="10" y2="15" stroke="white" strokeWidth="1.3" strokeLinecap="round" />
                </svg>
                Sample
              </span>
            </div>
          )}
        </div>

        {/* Height chart */}
        {(() => {
          const heightReadings = chartData.filter(d => d.height !== null);
          return (
            <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-gray-900">Height</h3>
                {heightReadings.length > 0 && (
                  <span className="text-xs text-gray-400">{heightReadings.length} readings</span>
                )}
              </div>
              {loading ? (
                <div className="h-[200px] flex items-center justify-center">
                  <div className="w-6 h-6 border-2 border-green-600 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : heightReadings.length > 0 ? (
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} interval="preserveStartEnd" minTickGap={40} />
                    <YAxis tick={{ fontSize: 11 }} domain={[0, 'auto']} unit="cm" />
                    <Tooltip
                      formatter={(v: any) => v !== null && v !== undefined ? [`${v} cm`, 'Height'] : []}
                      labelFormatter={(label) => label}
                    />
                    {/* Dashed line connecting all readings through gaps */}
                    <Line
                      type="monotone"
                      dataKey="height"
                      stroke="#2D8B4E"
                      strokeWidth={2}
                      strokeDasharray="6 3"
                      dot={false}
                      connectNulls
                      isAnimationActive={false}
                      name="Height (projected)"
                    />
                    {/* Solid dots on actual data points only */}
                    <Line
                      type="monotone"
                      dataKey="height"
                      stroke="#2D8B4E"
                      strokeWidth={0}
                      dot={{ r: 4, fill: '#2D8B4E', stroke: '#fff', strokeWidth: 2 }}
                      isAnimationActive={false}
                      name="Height"
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[200px] flex items-center justify-center text-gray-400 text-sm">
                  No height data recorded for this system
                </div>
              )}
            </div>
          );
        })()}

        {/* Volume tracking */}
        {(() => {
          // Use IndexedDB dimensions first, fall back to sheet-reported dimensions
          const idbDims = system && 'dimensions' in system ? (system as any).dimensions : undefined;
          const dims = idbDims || (sheetDimensions && (sheetDimensions.widthCm || sheetDimensions.lengthCm)
            ? { shape: 'cuboid' as const, lengthCm: sheetDimensions.lengthCm, widthCm: sheetDimensions.widthCm, heightCm: sheetDimensions.heightCm }
            : undefined);
          const initialVol = dims ? calcVolumeLitres(dims) : null;

          // Find the most recent height reading
          const heightData = chartData.filter(d => d.height !== null);
          const latestHeight = heightData.length > 0 ? heightData[heightData.length - 1].height : null;
          const currentVol = latestHeight !== null && dims ? calcVolumeLitres(dims, latestHeight) : null;
          const pctChange = initialVol !== null && currentVol !== null ? volumeChangePercent(initialVol, currentVol) : null;

          // Dimensions description text
          const dimsDesc = dims
            ? (dims.shape === 'cuboid'
                ? `${dims.lengthCm} × ${dims.widthCm} cm base`
                : `${dims.diameterCm} cm diameter`)
            : null;

          return (
            <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
              <h3 className="font-semibold text-gray-900 mb-3">Volume</h3>
              {initialVol !== null ? (
                <>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="text-center">
                      <div className="text-sm text-gray-500">Start</div>
                      <div className="text-lg font-bold text-gray-700">{formatVolume(initialVol)}</div>
                    </div>
                    <div className="text-center">
                      <div className="text-sm text-gray-500">Current</div>
                      <div className="text-lg font-bold text-gray-700">
                        {currentVol !== null ? formatVolume(currentVol) : '—'}
                      </div>
                    </div>
                    <div className="text-center">
                      <div className="text-sm text-gray-500">Change</div>
                      <div className={`text-lg font-bold ${
                        pctChange !== null
                          ? pctChange < 0 ? 'text-amber-600' : pctChange > 0 ? 'text-green-600' : 'text-gray-500'
                          : 'text-gray-400'
                      }`}>
                        {pctChange !== null ? `${pctChange > 0 ? '+' : ''}${pctChange}%` : '—'}
                      </div>
                    </div>
                  </div>
                  <p className="text-xs text-gray-400 mt-2 text-center">
                    {dimsDesc}
                    {latestHeight !== null ? ` · latest height ${latestHeight} cm` : ''}
                  </p>
                </>
              ) : (
                <div className="h-[80px] flex flex-col items-center justify-center text-gray-400 text-sm">
                  <span>No dimensions set</span>
                </div>
              )}
            </div>
          );
        })()}

        {/* Readiness Check + Readiness photos + Quality photos */}
        <div className="grid md:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <FlaskConical size={16} className="text-purple-600" />
              <h3 className="font-semibold text-gray-900">Readiness Check</h3>
            </div>
            {!isPublicView && (
              <>
                <input
                  ref={csvInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={handleCSVUpload}
                />
                <button
                  onClick={() => csvInputRef.current?.click()}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-purple-50 text-purple-700 font-medium active:scale-95 transition-all"
                >
                  <Upload size={12} />
                  Import CSV
                </button>
              </>
            )}
          </div>

          {readinessLoading ? (
            <div className="flex justify-center py-6">
              <div className="w-5 h-5 border-2 border-purple-600 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : readinessChecks.length === 0 ? (
            <div className="text-center py-6 text-gray-400 text-sm">
              <FlaskConical size={24} className="mx-auto mb-2 text-gray-300" />
              <p>No readiness checks yet</p>
            </div>
          ) : (
            <div className="space-y-3">
              {readinessChecks.map(check => {
                const summary = getReadinessSummary(check.results);
                const beneficial = summary.filter(s => s.category === 'beneficial' || s.category === 'ratio');
                const detrimental = summary.filter(s => s.category === 'detrimental');
                const isExpanded = readinessExpanded === check.id;
                const dateLabel = new Date(check.date + 'T00:00:00').toLocaleDateString('en-NZ', {
                  day: 'numeric', month: 'short', year: 'numeric',
                });

                return (
                  <div key={check.id} className="border border-purple-100 rounded-lg overflow-hidden">
                    <button
                      onClick={() => setReadinessExpanded(isExpanded ? null : check.id)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-purple-50/30 transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800">
                          {dateLabel}
                          {check.label && <span className="text-gray-400 ml-1.5">· {check.label}</span>}
                        </p>
                        <div className="flex gap-3 mt-0.5 text-xs text-gray-400">
                          <span>F:B {check.results.fbRatio ?? '—'}</span>
                          <span>Bact. {check.results.bacterialBiomass?.toLocaleString() ?? '—'}</span>
                          <span>Fungi {check.results.fungalBiomass?.toLocaleString() ?? '—'}</span>
                        </div>
                      </div>
                      {isExpanded ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
                    </button>

                    {isExpanded && (
                      <div className="px-3 pb-3 space-y-3">
                        {/* Beneficial */}
                        <div>
                          <p className="text-xs font-semibold text-green-700 uppercase tracking-wide mb-1.5">Beneficial</p>
                          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                            {beneficial.map(item => (
                              <div key={item.label} className="flex justify-between text-sm">
                                <span className="text-gray-600 truncate mr-2">{item.label}</span>
                                <span className="font-medium text-gray-900 whitespace-nowrap">
                                  {item.value}{item.unit && <span className="text-xs text-gray-400 ml-0.5">{item.unit}</span>}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Detrimental */}
                        <div>
                          <p className="text-xs font-semibold text-red-600 uppercase tracking-wide mb-1.5">Detrimental</p>
                          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                            {detrimental.map(item => (
                              <div key={item.label} className="flex justify-between text-sm">
                                <span className="text-gray-600 truncate mr-2">{item.label}</span>
                                <span className={`font-medium whitespace-nowrap ${
                                  item.value !== '0' && item.value !== '—' ? 'text-red-600' : 'text-gray-900'
                                }`}>
                                  {item.value}{item.unit && <span className="text-xs text-gray-400 ml-0.5">{item.unit}</span>}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>

                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
          <div className="space-y-4">
            <InlinePhotoSlot systemName={system.name} slotId="readiness" heightClass="h-56 md:h-64" />
            <InlinePhotoSlot systemName={system.name} slotId="quality" heightClass="h-56 md:h-64" />
          </div>
        </div>

        {/* Soil + Harvest — data not tracked yet, placeholder cards on left */}
        <div className="grid md:grid-cols-2 gap-4">
          <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 flex flex-col justify-center">
            <h3 className="font-semibold text-gray-900">Soil performance</h3>
          </div>
          <InlinePhotoSlot systemName={system.name} slotId="soil" heightClass="h-56 md:h-64" />
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 flex flex-col justify-center">
            <h3 className="font-semibold text-gray-900">Harvest / outcome</h3>
          </div>
          <InlinePhotoSlot systemName={system.name} slotId="harvest" heightClass="h-56 md:h-64" />
        </div>

      </div>
    </div>
  );
}
