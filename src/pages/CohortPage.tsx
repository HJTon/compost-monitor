import { useMemo, useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Legend,
} from 'recharts';
import { Loader2 } from 'lucide-react';
import { Header } from '@/components/Header';
import { useCompost } from '@/contexts/CompostContext';
import { KILL_TEMP_F } from '@/utils/config';
import type { CompostSystem } from '@/types';

interface SheetEntry {
  date: string;
  peak: number | null;
}

interface BuildCurve {
  system: CompostSystem;
  /** [{ day: 0, peakF: 105 }, ...] — aligned to day 0 = first reading */
  points: { day: number; peakF: number | null }[];
  startDate: string | null;
  daysToKill: number | null; // first day peak ≥ 131°F
  peakMax: number | null;
  readingCount: number;
}

function parseEntryDate(s: string): Date | null {
  if (!s) return null;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const dm = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (dm) return new Date(Number(dm[3]), Number(dm[2]) - 1, Number(dm[1]));
  return null;
}

function dayDelta(a: Date, b: Date): number {
  return Math.round((a.getTime() - b.getTime()) / 86400000);
}

function fToC(f: number): number {
  return Math.round(((f - 32) * 5) / 9);
}

const CURVE_COLOURS = [
  '#60A5FA', '#F87171', '#4ADE80', '#C084FC', '#FB923C',
  '#22D3EE', '#FACC15', '#F472B6', '#A3E635', '#818CF8',
];

export function CohortPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { allSystems, settings } = useCompost();
  const [useCelsius, setUseCelsius] = useState(false);
  const [loading, setLoading] = useState(false);
  const [curves, setCurves] = useState<BuildCurve[]>([]);

  // All active builds that have a build type
  const buildsWithType = useMemo(
    () => allSystems.filter(s =>
      settings.activeSystems.includes(s.id) && s.buildType && s.buildType.trim() !== ''
    ),
    [allSystems, settings.activeSystems]
  );

  // Unique build types with counts
  const buildTypes = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of buildsWithType) {
      if (s.buildType) counts.set(s.buildType, (counts.get(s.buildType) || 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count);
  }, [buildsWithType]);

  const selectedType = searchParams.get('type') || buildTypes[0]?.type || '';
  const selectedBuilds = useMemo(
    () => buildsWithType.filter(s => s.buildType === selectedType),
    [buildsWithType, selectedType]
  );

  // Fetch history for each selected build and align to day 0
  useEffect(() => {
    if (selectedBuilds.length === 0) { setCurves([]); return; }
    const abort = new AbortController();
    setLoading(true);

    async function load() {
      const results = await Promise.all(
        selectedBuilds.map(async (system): Promise<BuildCurve | null> => {
          try {
            const res = await fetch(
              `/.netlify/functions/compost-sheets-history?tab=${encodeURIComponent(system.sheetTab)}&limit=365`,
              { signal: abort.signal }
            );
            if (!res.ok) return null;
            const data = await res.json();
            const entries: SheetEntry[] = (data.entries || []).map((e: SheetEntry) => ({
              date: e.date, peak: e.peak,
            }));
            if (entries.length === 0) return null;

            const dated = entries
              .map(e => ({ date: parseEntryDate(e.date), peak: e.peak }))
              .filter((e): e is { date: Date; peak: number | null } => e.date !== null);
            if (dated.length === 0) return null;

            dated.sort((a, b) => a.date.getTime() - b.date.getTime());
            const day0 = dated[0].date;

            const points = dated.map(e => ({
              day: dayDelta(e.date, day0),
              peakF: e.peak,
            }));

            let daysToKill: number | null = null;
            let peakMax: number | null = null;
            for (const p of points) {
              if (p.peakF !== null) {
                if (peakMax === null || p.peakF > peakMax) peakMax = p.peakF;
                if (daysToKill === null && p.peakF >= KILL_TEMP_F) daysToKill = p.day;
              }
            }

            return {
              system,
              points,
              startDate: dated[0].date.toISOString().slice(0, 10),
              daysToKill,
              peakMax,
              readingCount: points.length,
            };
          } catch { return null; }
        })
      );
      if (!abort.signal.aborted) {
        setCurves(results.filter((r): r is BuildCurve => r !== null));
        setLoading(false);
      }
    }
    load();
    return () => abort.abort();
  }, [selectedBuilds]);

  // Build mean curve — for each day index, average across builds that have data
  const chartData = useMemo(() => {
    if (curves.length === 0) return [];
    const maxDay = Math.max(...curves.map(c =>
      c.points.length > 0 ? c.points[c.points.length - 1].day : 0
    ));
    const rows: Record<string, number | null>[] = [];
    for (let d = 0; d <= maxDay; d++) {
      const row: Record<string, number | null> & { day: number } = { day: d };
      const vals: number[] = [];
      for (const c of curves) {
        const match = c.points.find(p => p.day === d);
        const v = match?.peakF ?? null;
        const display = v !== null && useCelsius ? fToC(v) : v;
        row[`b_${c.system.id}`] = display;
        if (v !== null) vals.push(v);
      }
      if (vals.length > 0) {
        const meanF = vals.reduce((a, b) => a + b, 0) / vals.length;
        row.mean = useCelsius ? fToC(meanF) : Math.round(meanF);
      } else {
        row.mean = null;
      }
      rows.push(row);
    }
    return rows;
  }, [curves, useCelsius]);

  // Cohort summary stats
  const stats = useMemo(() => {
    const withKill = curves.filter(c => c.daysToKill !== null);
    const avgDaysToKill = withKill.length > 0
      ? withKill.reduce((a, c) => a + (c.daysToKill || 0), 0) / withKill.length
      : null;
    const withPeak = curves.filter(c => c.peakMax !== null);
    const avgPeakF = withPeak.length > 0
      ? withPeak.reduce((a, c) => a + (c.peakMax || 0), 0) / withPeak.length
      : null;
    return {
      n: curves.length,
      reachedKill: withKill.length,
      avgDaysToKill,
      avgPeakF,
    };
  }, [curves]);

  const killThreshold = useCelsius ? 55 : KILL_TEMP_F;
  const unitLabel = useCelsius ? '°C' : '°F';

  const headlineSentence = useMemo(() => {
    if (stats.n === 0) return 'No builds in this cohort yet.';
    const parts: string[] = [];
    if (stats.avgDaysToKill !== null) {
      parts.push(`reach ${killThreshold}${unitLabel} in ${stats.avgDaysToKill.toFixed(1)} days on average`);
    }
    if (stats.avgPeakF !== null) {
      const peak = useCelsius ? fToC(stats.avgPeakF) : Math.round(stats.avgPeakF);
      parts.push(`averaging a peak of ${peak}${unitLabel}`);
    }
    const lead = `${selectedType} builds (n=${stats.n})`;
    return parts.length ? `${lead} ${parts.join(', ')}.` : `${lead} have no peak data recorded yet.`;
  }, [stats, selectedType, killThreshold, unitLabel, useCelsius]);

  return (
    <div className="min-h-screen bg-green-50/50 pb-12">
      <Header title="Build-type cohorts" showBack onBack={() => navigate('/analyse')} />

      <div className="p-4 space-y-4">
        {buildTypes.length === 0 ? (
          <div className="bg-white rounded-xl p-6 text-center text-sm text-gray-500 border border-gray-100">
            No builds have a build type set yet. Add a build type on the Manage page to group builds into cohorts.
          </div>
        ) : (
          <>
            {/* Type selector */}
            <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
              <div className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">
                Build type
              </div>
              <div className="flex flex-wrap gap-2">
                {buildTypes.map(({ type, count }) => {
                  const active = type === selectedType;
                  return (
                    <button
                      key={type}
                      onClick={() => setSearchParams({ type })}
                      className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                        active
                          ? 'bg-green-primary text-white border-green-primary'
                          : 'bg-white text-gray-700 border-gray-200 hover:border-green-primary'
                      }`}
                    >
                      {type} <span className={active ? 'text-white/80' : 'text-gray-400'}>· {count}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Headline */}
            <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
              <p className="text-base text-gray-800 leading-relaxed">{headlineSentence}</p>
              {stats.n > 0 && (
                <div className="mt-3 grid grid-cols-3 gap-3 text-center">
                  <div className="bg-gray-50 rounded-lg py-2">
                    <div className="text-xs text-gray-500 uppercase tracking-wide">Builds</div>
                    <div className="text-xl font-semibold text-gray-900">{stats.n}</div>
                  </div>
                  <div className="bg-gray-50 rounded-lg py-2">
                    <div className="text-xs text-gray-500 uppercase tracking-wide">Reached kill</div>
                    <div className="text-xl font-semibold text-gray-900">
                      {stats.reachedKill}/{stats.n}
                    </div>
                  </div>
                  <div className="bg-gray-50 rounded-lg py-2">
                    <div className="text-xs text-gray-500 uppercase tracking-wide">Avg peak</div>
                    <div className="text-xl font-semibold text-gray-900">
                      {stats.avgPeakF !== null
                        ? `${useCelsius ? fToC(stats.avgPeakF) : Math.round(stats.avgPeakF)}${unitLabel}`
                        : '—'}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Chart */}
            <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
              <div className="flex items-center justify-between mb-3">
                <div className="text-sm font-semibold text-gray-700">
                  Peak temperature by day since build start
                </div>
                <button
                  onClick={() => setUseCelsius(v => !v)}
                  className="text-xs px-2.5 py-1 rounded-md border border-gray-200 bg-white text-gray-700 hover:border-green-primary"
                >
                  {useCelsius ? '°C → °F' : '°F → °C'}
                </button>
              </div>

              {loading ? (
                <div className="h-64 flex items-center justify-center text-gray-400">
                  <Loader2 size={20} className="animate-spin" />
                </div>
              ) : chartData.length === 0 ? (
                <div className="h-64 flex items-center justify-center text-sm text-gray-400">
                  No readings recorded yet for this cohort.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={320}>
                  <LineChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                    <XAxis
                      dataKey="day"
                      tick={{ fontSize: 11 }}
                      label={{ value: 'Days since start', position: 'insideBottom', offset: -2, fontSize: 11 }}
                    />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      label={{ value: `Peak ${unitLabel}`, angle: -90, position: 'insideLeft', fontSize: 11 }}
                    />
                    <Tooltip
                      formatter={(value) =>
                        value === null || value === undefined ? '—' : `${value}${unitLabel}`
                      }
                      labelFormatter={(label) => `Day ${label}`}
                      contentStyle={{ fontSize: 12 }}
                    />
                    <ReferenceLine
                      y={killThreshold}
                      stroke="#DC2626"
                      strokeDasharray="4 4"
                      label={{ value: `Kill ${killThreshold}${unitLabel}`, fontSize: 10, fill: '#DC2626', position: 'insideTopRight' }}
                    />
                    {curves.map((c, i) => (
                      <Line
                        key={c.system.id}
                        type="monotone"
                        dataKey={`b_${c.system.id}`}
                        name={c.system.name}
                        stroke={CURVE_COLOURS[i % CURVE_COLOURS.length]}
                        strokeWidth={1}
                        strokeOpacity={0.45}
                        dot={false}
                        connectNulls
                        isAnimationActive={false}
                      />
                    ))}
                    <Line
                      type="monotone"
                      dataKey="mean"
                      name="Cohort mean"
                      stroke="#15803D"
                      strokeWidth={2.5}
                      dot={false}
                      connectNulls
                      isAnimationActive={false}
                    />
                    <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Per-build list */}
            {curves.length > 0 && (
              <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
                <div className="text-sm font-semibold text-gray-700 mb-2">Builds in cohort</div>
                <div className="divide-y divide-gray-100">
                  {curves.map((c, i) => {
                    const peak = c.peakMax !== null
                      ? `${useCelsius ? fToC(c.peakMax) : Math.round(c.peakMax)}${unitLabel}`
                      : '—';
                    return (
                      <button
                        key={c.system.id}
                        onClick={() => navigate(`/analyse/${c.system.id}`)}
                        className="w-full py-2.5 flex items-center gap-3 text-left hover:bg-gray-50 rounded-lg px-2 -mx-2"
                      >
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: CURVE_COLOURS[i % CURVE_COLOURS.length] }}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-gray-900">{c.system.name}</div>
                          <div className="text-xs text-gray-500 mt-0.5">
                            {c.startDate && <>Started {c.startDate} · </>}
                            {c.readingCount} readings · peak {peak}
                            {c.daysToKill !== null && <> · kill on day {c.daysToKill}</>}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
