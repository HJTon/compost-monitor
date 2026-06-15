import { useMemo, useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Legend,
} from 'recharts';
import { Loader2, ArrowRight } from 'lucide-react';
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
  /** [{ day: N, peakF: 105 }, ...] — aligned to day 0 = first reading */
  points: { day: number; peakF: number | null }[];
  daysToKill: number | null;
  peakMax: number | null;
  readingCount: number;
}

interface CohortStats {
  n: number;
  reachedKill: number;
  avgDaysToKill: number | null;
  avgPeakF: number | null;
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

function toDisplay(f: number | null, useCelsius: boolean): number | null {
  if (f === null) return null;
  return useCelsius ? fToC(f) : Math.round(f);
}

async function loadCurves(systems: CompostSystem[], signal: AbortSignal): Promise<BuildCurve[]> {
  const results = await Promise.all(
    systems.map(async (system): Promise<BuildCurve | null> => {
      try {
        const res = await fetch(
          `/.netlify/functions/compost-sheets-history?tab=${encodeURIComponent(system.sheetTab)}&limit=365`,
          { signal }
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
        const points = dated.map(e => ({ day: dayDelta(e.date, day0), peakF: e.peak }));

        let daysToKill: number | null = null;
        let peakMax: number | null = null;
        for (const p of points) {
          if (p.peakF !== null) {
            if (peakMax === null || p.peakF > peakMax) peakMax = p.peakF;
            if (daysToKill === null && p.peakF >= KILL_TEMP_F) daysToKill = p.day;
          }
        }

        return { system, points, daysToKill, peakMax, readingCount: points.length };
      } catch { return null; }
    })
  );
  return results.filter((r): r is BuildCurve => r !== null);
}

function computeStats(curves: BuildCurve[]): CohortStats {
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
}

function meanCurve(curves: BuildCurve[]): { day: number; peakF: number | null }[] {
  if (curves.length === 0) return [];
  const maxDay = Math.max(...curves.map(c =>
    c.points.length > 0 ? c.points[c.points.length - 1].day : 0
  ));
  const out: { day: number; peakF: number | null }[] = [];
  for (let d = 0; d <= maxDay; d++) {
    const vals: number[] = [];
    for (const c of curves) {
      const match = c.points.find(p => p.day === d);
      if (match?.peakF != null) vals.push(match.peakF);
    }
    out.push({
      day: d,
      peakF: vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null,
    });
  }
  return out;
}

const A_COLOUR = '#15803D';  // green-700
const B_COLOUR = '#7E22CE';  // purple-700

export function TypeVsTypePage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { allSystems, settings } = useCompost();
  const [useCelsius, setUseCelsius] = useState((settings.tempUnit ?? 'C') === 'C');
  const [loading, setLoading] = useState(false);
  const [curvesA, setCurvesA] = useState<BuildCurve[]>([]);
  const [curvesB, setCurvesB] = useState<BuildCurve[]>([]);

  const buildsWithType = useMemo(
    () => allSystems.filter(s =>
      settings.activeSystems.includes(s.id) && s.buildType && s.buildType.trim() !== ''
    ),
    [allSystems, settings.activeSystems]
  );

  const buildTypes = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of buildsWithType) {
      if (s.buildType) counts.set(s.buildType, (counts.get(s.buildType) || 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count);
  }, [buildsWithType]);

  // Defaults: A = most common, B = second-most (or same if only one)
  const typeA = searchParams.get('a') || buildTypes[0]?.type || '';
  const typeB = searchParams.get('b') || buildTypes[1]?.type || buildTypes[0]?.type || '';

  const buildsA = useMemo(
    () => buildsWithType.filter(s => s.buildType === typeA),
    [buildsWithType, typeA]
  );
  const buildsB = useMemo(
    () => buildsWithType.filter(s => s.buildType === typeB),
    [buildsWithType, typeB]
  );

  useEffect(() => {
    if (typeA === '' && typeB === '') { setCurvesA([]); setCurvesB([]); return; }
    const abort = new AbortController();
    setLoading(true);
    (async () => {
      const [a, b] = await Promise.all([
        loadCurves(buildsA, abort.signal),
        typeB === typeA ? Promise.resolve([]) : loadCurves(buildsB, abort.signal),
      ]);
      if (!abort.signal.aborted) {
        setCurvesA(a);
        setCurvesB(b);
        setLoading(false);
      }
    })();
    return () => abort.abort();
  }, [buildsA, buildsB, typeA, typeB]);

  const statsA = useMemo(() => computeStats(curvesA), [curvesA]);
  const statsB = useMemo(() => computeStats(curvesB), [curvesB]);

  const chartData = useMemo(() => {
    const mA = meanCurve(curvesA);
    const mB = meanCurve(curvesB);
    const maxDay = Math.max(
      mA.length > 0 ? mA[mA.length - 1].day : 0,
      mB.length > 0 ? mB[mB.length - 1].day : 0
    );
    const rows: { day: number; meanA: number | null; meanB: number | null }[] = [];
    for (let d = 0; d <= maxDay; d++) {
      const a = mA.find(p => p.day === d)?.peakF ?? null;
      const b = mB.find(p => p.day === d)?.peakF ?? null;
      rows.push({
        day: d,
        meanA: toDisplay(a, useCelsius),
        meanB: toDisplay(b, useCelsius),
      });
    }
    return rows;
  }, [curvesA, curvesB, useCelsius]);

  const killThreshold = useCelsius ? 55 : KILL_TEMP_F;
  const unitLabel = useCelsius ? '°C' : '°F';

  const sameType = typeA === typeB && typeA !== '';

  // Delta helpers
  const deltaPeak = statsA.avgPeakF !== null && statsB.avgPeakF !== null
    ? statsA.avgPeakF - statsB.avgPeakF
    : null;
  const deltaDays = statsA.avgDaysToKill !== null && statsB.avgDaysToKill !== null
    ? statsA.avgDaysToKill - statsB.avgDaysToKill
    : null;
  const deltaKillRate = statsA.n > 0 && statsB.n > 0
    ? (statsA.reachedKill / statsA.n) - (statsB.reachedKill / statsB.n)
    : null;

  function setType(which: 'a' | 'b', value: string) {
    const p = new URLSearchParams(searchParams);
    p.set(which, value);
    // keep the other param if it was already set
    const other = which === 'a' ? 'b' : 'a';
    if (!p.get(other)) {
      const fallback = which === 'a' ? typeB : typeA;
      if (fallback) p.set(other, fallback);
    }
    setSearchParams(p);
  }

  return (
    <div className="min-h-screen bg-green-50/50 pb-12">
      <Header title="Type vs type" showBack onBack={() => navigate('/analyse')} />

      <div className="p-4 space-y-4">
        {buildTypes.length < 2 ? (
          <div className="bg-white rounded-xl p-6 text-center text-sm text-gray-500 border border-gray-100">
            Need at least two different build types to compare. Add build types on the Manage page.
          </div>
        ) : (
          <>
            {/* Type selectors */}
            <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 space-y-3">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-3 h-3 rounded-full" style={{ backgroundColor: A_COLOUR }} />
                  <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
                    Type A
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {buildTypes.map(({ type, count }) => {
                    const active = type === typeA;
                    return (
                      <button
                        key={type}
                        onClick={() => setType('a', type)}
                        className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                          active
                            ? 'text-white border-transparent'
                            : 'bg-white text-gray-700 border-gray-200 hover:border-green-primary'
                        }`}
                        style={active ? { backgroundColor: A_COLOUR } : {}}
                      >
                        {type} <span className={active ? 'text-white/80' : 'text-gray-400'}>· {count}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-3 h-3 rounded-full" style={{ backgroundColor: B_COLOUR }} />
                  <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
                    Type B
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {buildTypes.map(({ type, count }) => {
                    const active = type === typeB;
                    return (
                      <button
                        key={type}
                        onClick={() => setType('b', type)}
                        className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                          active
                            ? 'text-white border-transparent'
                            : 'bg-white text-gray-700 border-gray-200 hover:border-green-primary'
                        }`}
                        style={active ? { backgroundColor: B_COLOUR } : {}}
                      >
                        {type} <span className={active ? 'text-white/80' : 'text-gray-400'}>· {count}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {sameType && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
                You've picked the same type on both sides. Choose a different Type B to see the comparison.
              </div>
            )}

            {/* Chart */}
            <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
              <div className="flex items-center justify-between mb-3">
                <div className="text-sm font-semibold text-gray-700">
                  Mean peak temperature by day since build start
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
              ) : chartData.every(p => p.meanA === null && p.meanB === null) ? (
                <div className="h-64 flex items-center justify-center text-sm text-gray-400">
                  No readings recorded yet for either side.
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
                    <Line
                      type="monotone"
                      dataKey="meanA"
                      name={typeA}
                      stroke={A_COLOUR}
                      strokeWidth={2.5}
                      dot={false}
                      connectNulls
                      isAnimationActive={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="meanB"
                      name={typeB}
                      stroke={B_COLOUR}
                      strokeWidth={2.5}
                      dot={false}
                      connectNulls
                      isAnimationActive={false}
                    />
                    <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Delta table */}
            {!sameType && (statsA.n > 0 || statsB.n > 0) && (
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                <div className="px-4 py-3 text-sm font-semibold text-gray-700 border-b border-gray-100">
                  How they compare
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-500 bg-gray-50">
                      <th className="text-left px-4 py-2 font-medium">Metric</th>
                      <th className="text-right px-3 py-2 font-medium">
                        <span className="inline-flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: A_COLOUR }} />
                          Type A
                        </span>
                      </th>
                      <th className="text-right px-3 py-2 font-medium">
                        <span className="inline-flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: B_COLOUR }} />
                          Type B
                        </span>
                      </th>
                      <th className="text-right px-4 py-2 font-medium">Δ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    <tr>
                      <td className="px-4 py-2 text-gray-600">Builds in cohort</td>
                      <td className="px-3 py-2 text-right text-gray-900">{statsA.n}</td>
                      <td className="px-3 py-2 text-right text-gray-900">{statsB.n}</td>
                      <td className="px-4 py-2 text-right text-gray-400">—</td>
                    </tr>
                    <tr>
                      <td className="px-4 py-2 text-gray-600">Reached kill</td>
                      <td className="px-3 py-2 text-right text-gray-900">
                        {statsA.n > 0 ? `${statsA.reachedKill}/${statsA.n}` : '—'}
                      </td>
                      <td className="px-3 py-2 text-right text-gray-900">
                        {statsB.n > 0 ? `${statsB.reachedKill}/${statsB.n}` : '—'}
                      </td>
                      <td className="px-4 py-2 text-right">
                        {deltaKillRate !== null ? (
                          <span className={deltaKillRate >= 0 ? 'text-green-700' : 'text-red-600'}>
                            {deltaKillRate >= 0 ? '+' : ''}{(deltaKillRate * 100).toFixed(0)}%
                          </span>
                        ) : <span className="text-gray-400">—</span>}
                      </td>
                    </tr>
                    <tr>
                      <td className="px-4 py-2 text-gray-600">Avg peak</td>
                      <td className="px-3 py-2 text-right text-gray-900">
                        {statsA.avgPeakF !== null
                          ? `${useCelsius ? fToC(statsA.avgPeakF) : Math.round(statsA.avgPeakF)}${unitLabel}`
                          : '—'}
                      </td>
                      <td className="px-3 py-2 text-right text-gray-900">
                        {statsB.avgPeakF !== null
                          ? `${useCelsius ? fToC(statsB.avgPeakF) : Math.round(statsB.avgPeakF)}${unitLabel}`
                          : '—'}
                      </td>
                      <td className="px-4 py-2 text-right">
                        {deltaPeak !== null ? (
                          <span className={deltaPeak >= 0 ? 'text-green-700' : 'text-red-600'}>
                            {deltaPeak >= 0 ? '+' : ''}
                            {useCelsius
                              ? (Math.round((deltaPeak * 5 / 9) * 10) / 10)
                              : Math.round(deltaPeak)}
                            {unitLabel}
                          </span>
                        ) : <span className="text-gray-400">—</span>}
                      </td>
                    </tr>
                    <tr>
                      <td className="px-4 py-2 text-gray-600">Avg days to kill</td>
                      <td className="px-3 py-2 text-right text-gray-900">
                        {statsA.avgDaysToKill !== null ? statsA.avgDaysToKill.toFixed(1) : '—'}
                      </td>
                      <td className="px-3 py-2 text-right text-gray-900">
                        {statsB.avgDaysToKill !== null ? statsB.avgDaysToKill.toFixed(1) : '—'}
                      </td>
                      <td className="px-4 py-2 text-right">
                        {deltaDays !== null ? (
                          // faster (fewer days) is better → negative delta = green
                          <span className={deltaDays <= 0 ? 'text-green-700' : 'text-red-600'}>
                            {deltaDays >= 0 ? '+' : ''}{deltaDays.toFixed(1)} days
                          </span>
                        ) : <span className="text-gray-400">—</span>}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}

            {/* Per-side build lists */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {[
                { label: typeA, curves: curvesA, colour: A_COLOUR },
                { label: typeB, curves: curvesB, colour: B_COLOUR },
              ].map((side, idx) => (
                <div key={idx} className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: side.colour }} />
                    <div className="text-sm font-semibold text-gray-700 truncate">{side.label}</div>
                    <span className="text-xs text-gray-400">· {side.curves.length}</span>
                  </div>
                  {side.curves.length === 0 ? (
                    <div className="text-xs text-gray-400 py-2">No builds with readings yet.</div>
                  ) : (
                    <div className="divide-y divide-gray-100">
                      {side.curves.map(c => (
                        <button
                          key={c.system.id}
                          onClick={() => navigate(`/analyse/${c.system.id}`)}
                          className="w-full py-2 flex items-center gap-2 text-left hover:bg-gray-50 rounded-lg px-2 -mx-2"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="text-sm text-gray-900 truncate">{c.system.name}</div>
                            <div className="text-xs text-gray-500 mt-0.5">
                              peak {c.peakMax !== null
                                ? `${useCelsius ? fToC(c.peakMax) : Math.round(c.peakMax)}${unitLabel}`
                                : '—'}
                              {c.daysToKill !== null && <> · kill day {c.daysToKill}</>}
                            </div>
                          </div>
                          <ArrowRight size={14} className="text-gray-300 shrink-0" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
