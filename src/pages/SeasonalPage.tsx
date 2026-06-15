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

// ── NZ seasons (Southern Hemisphere) ─────────────────────────────────────────
type Season = 'summer' | 'autumn' | 'winter' | 'spring';
const SEASONS: Season[] = ['summer', 'autumn', 'winter', 'spring'];
const SEASON_LABEL: Record<Season, string> = {
  summer: 'Summer (Dec–Feb)',
  autumn: 'Autumn (Mar–May)',
  winter: 'Winter (Jun–Aug)',
  spring: 'Spring (Sep–Nov)',
};
const SEASON_COLOUR: Record<Season, string> = {
  summer: '#D97706', // amber-600
  autumn: '#C2410C', // orange-700
  winter: '#1D4ED8', // blue-700
  spring: '#15803D', // green-700
};
function monthToSeason(month: number): Season {
  // month is 0-indexed
  if (month === 11 || month <= 1) return 'summer';
  if (month <= 4) return 'autumn';
  if (month <= 7) return 'winter';
  return 'spring';
}

// ── Data shapes ──────────────────────────────────────────────────────────────
interface SheetEntry {
  date: string;
  peak: number | null;
  ambientMin: number | null;
  ambientMax: number | null;
}

interface BuildCurve {
  system: CompostSystem;
  season: Season;
  startDate: string | null;
  points: {
    day: number;
    peakF: number | null;
    ambientMinC: number | null;
    ambientMaxC: number | null;
  }[];
  daysToKill: number | null;
  peakMax: number | null;
}

interface SeasonStats {
  n: number;
  reachedKill: number;
  avgDaysToKill: number | null;
  avgPeakF: number | null;
  avgAmbientMaxC: number | null;
  avgAmbientMinC: number | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
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

function cToF(c: number): number {
  return Math.round((c * 9) / 5 + 32);
}

async function loadBuildCurve(system: CompostSystem, signal: AbortSignal): Promise<BuildCurve | null> {
  try {
    const res = await fetch(
      `/.netlify/functions/compost-sheets-history?tab=${encodeURIComponent(system.sheetTab)}&limit=365`,
      { signal }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const entries: SheetEntry[] = (data.entries || []).map((e: SheetEntry) => ({
      date: e.date, peak: e.peak, ambientMin: e.ambientMin, ambientMax: e.ambientMax,
    }));
    if (entries.length === 0) return null;

    const dated = entries
      .map(e => ({ ...e, parsedDate: parseEntryDate(e.date) }))
      .filter((e): e is SheetEntry & { parsedDate: Date } => e.parsedDate !== null)
      .map(e => ({ date: e.parsedDate, peak: e.peak, ambientMin: e.ambientMin, ambientMax: e.ambientMax }));
    if (dated.length === 0) return null;

    dated.sort((a, b) => a.date.getTime() - b.date.getTime());
    const day0 = dated[0].date;
    const season = monthToSeason(day0.getMonth());
    const points = dated.map(e => ({
      day: dayDelta(e.date, day0),
      peakF: e.peak,
      ambientMinC: e.ambientMin,
      ambientMaxC: e.ambientMax,
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
      season,
      startDate: day0.toISOString().slice(0, 10),
      points,
      daysToKill,
      peakMax,
    };
  } catch { return null; }
}

function computeSeasonStats(curves: BuildCurve[]): SeasonStats {
  const withKill = curves.filter(c => c.daysToKill !== null);
  const avgDaysToKill = withKill.length > 0
    ? withKill.reduce((a, c) => a + (c.daysToKill || 0), 0) / withKill.length
    : null;
  const withPeak = curves.filter(c => c.peakMax !== null);
  const avgPeakF = withPeak.length > 0
    ? withPeak.reduce((a, c) => a + (c.peakMax || 0), 0) / withPeak.length
    : null;

  // Ambient averages across all points in cohort
  const ambMaxVals: number[] = [];
  const ambMinVals: number[] = [];
  for (const c of curves) {
    for (const p of c.points) {
      if (p.ambientMaxC !== null) ambMaxVals.push(p.ambientMaxC);
      if (p.ambientMinC !== null) ambMinVals.push(p.ambientMinC);
    }
  }

  return {
    n: curves.length,
    reachedKill: withKill.length,
    avgDaysToKill,
    avgPeakF,
    avgAmbientMaxC: ambMaxVals.length > 0
      ? ambMaxVals.reduce((a, b) => a + b, 0) / ambMaxVals.length : null,
    avgAmbientMinC: ambMinVals.length > 0
      ? ambMinVals.reduce((a, b) => a + b, 0) / ambMinVals.length : null,
  };
}

function meanPeakBySeason(bySeasons: Record<Season, BuildCurve[]>): Record<Season, Map<number, number>> {
  const out: Record<Season, Map<number, number>> = {
    summer: new Map(), autumn: new Map(), winter: new Map(), spring: new Map(),
  };
  for (const s of SEASONS) {
    const curves = bySeasons[s];
    if (curves.length === 0) continue;
    const dayVals = new Map<number, number[]>();
    for (const c of curves) {
      for (const p of c.points) {
        if (p.peakF !== null) {
          const arr = dayVals.get(p.day) || [];
          arr.push(p.peakF);
          dayVals.set(p.day, arr);
        }
      }
    }
    for (const [day, vals] of dayVals) {
      out[s].set(day, vals.reduce((a, b) => a + b, 0) / vals.length);
    }
  }
  return out;
}

// ── Component ────────────────────────────────────────────────────────────────
export function SeasonalPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { allSystems, settings } = useCompost();
  const [useCelsius, setUseCelsius] = useState((settings.tempUnit ?? 'C') === 'C');
  const [showAmbient, setShowAmbient] = useState(false);
  const [loading, setLoading] = useState(false);
  const [allCurves, setAllCurves] = useState<BuildCurve[]>([]);

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

  const selectedType = searchParams.get('type') || buildTypes[0]?.type || '';
  const selectedBuilds = useMemo(
    () => buildsWithType.filter(s => s.buildType === selectedType),
    [buildsWithType, selectedType]
  );

  useEffect(() => {
    if (selectedBuilds.length === 0) { setAllCurves([]); return; }
    const abort = new AbortController();
    setLoading(true);
    (async () => {
      const results = await Promise.all(selectedBuilds.map(s => loadBuildCurve(s, abort.signal)));
      if (!abort.signal.aborted) {
        setAllCurves(results.filter((r): r is BuildCurve => r !== null));
        setLoading(false);
      }
    })();
    return () => abort.abort();
  }, [selectedBuilds]);

  const bySeasons = useMemo(() => {
    const out: Record<Season, BuildCurve[]> = {
      summer: [], autumn: [], winter: [], spring: [],
    };
    for (const c of allCurves) out[c.season].push(c);
    return out;
  }, [allCurves]);

  const seasonStats = useMemo(() => {
    const out: Record<Season, SeasonStats> = {} as Record<Season, SeasonStats>;
    for (const s of SEASONS) out[s] = computeSeasonStats(bySeasons[s]);
    return out;
  }, [bySeasons]);

  const seasonsWithData = useMemo(
    () => SEASONS.filter(s => bySeasons[s].length > 0),
    [bySeasons]
  );

  const chartData = useMemo(() => {
    const meansBySeason = meanPeakBySeason(bySeasons);
    let maxDay = 0;
    for (const s of SEASONS) {
      for (const day of meansBySeason[s].keys()) {
        if (day > maxDay) maxDay = day;
      }
    }
    const rows: Array<Record<string, number | null> & { day: number }> = [];
    for (let d = 0; d <= maxDay; d++) {
      const row: Record<string, number | null> & { day: number } = { day: d };
      for (const s of SEASONS) {
        const v = meansBySeason[s].get(d) ?? null;
        row[s] = v !== null ? (useCelsius ? fToC(v) : Math.round(v)) : null;
      }
      rows.push(row);
    }
    return rows;
  }, [bySeasons, useCelsius]);

  const killThreshold = useCelsius ? 55 : KILL_TEMP_F;
  const unitLabel = useCelsius ? '°C' : '°F';

  const headline = useMemo(() => {
    if (allCurves.length === 0) return `No ${selectedType || '—'} builds yet.`;
    const counts = seasonsWithData.map(s => `${bySeasons[s].length} in ${s}`).join(', ');
    return `${selectedType} builds — ${counts}.`;
  }, [allCurves, selectedType, seasonsWithData, bySeasons]);

  return (
    <div className="min-h-screen bg-green-50/50 pb-12">
      <Header title="Seasonal split" showBack onBack={() => navigate('/analyse')} />

      <div className="p-4 space-y-4">
        {buildTypes.length === 0 ? (
          <div className="bg-white rounded-xl p-6 text-center text-sm text-gray-500 border border-gray-100">
            No builds have a build type set yet. Add a build type on the Manage page.
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
              <p className="text-sm text-gray-700">{headline}</p>
              {seasonsWithData.length > 1 && (
                <p className="text-xs text-gray-500 mt-1">
                  Each coloured line is the mean peak temperature for builds that started in that season.
                </p>
              )}
            </div>

            {/* Chart */}
            <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
              <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                <div className="text-sm font-semibold text-gray-700">
                  Peak temperature by day since build start
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowAmbient(v => !v)}
                    className={`text-xs px-2.5 py-1 rounded-md border transition-colors ${
                      showAmbient
                        ? 'bg-sky-50 text-sky-700 border-sky-200'
                        : 'bg-white text-gray-700 border-gray-200 hover:border-green-primary'
                    }`}
                    title="Show cohort ambient temperature averages"
                  >
                    Ambient
                  </button>
                  <button
                    onClick={() => setUseCelsius(v => !v)}
                    className="text-xs px-2.5 py-1 rounded-md border border-gray-200 bg-white text-gray-700 hover:border-green-primary"
                  >
                    {useCelsius ? '°C → °F' : '°F → °C'}
                  </button>
                </div>
              </div>

              {loading ? (
                <div className="h-64 flex items-center justify-center text-gray-400">
                  <Loader2 size={20} className="animate-spin" />
                </div>
              ) : seasonsWithData.length === 0 ? (
                <div className="h-64 flex items-center justify-center text-sm text-gray-400">
                  No readings recorded yet.
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
                    {seasonsWithData.map(s => (
                      <Line
                        key={s}
                        type="monotone"
                        dataKey={s}
                        name={SEASON_LABEL[s]}
                        stroke={SEASON_COLOUR[s]}
                        strokeWidth={2.5}
                        dot={false}
                        connectNulls
                        isAnimationActive={false}
                      />
                    ))}
                    <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                  </LineChart>
                </ResponsiveContainer>
              )}

              {showAmbient && seasonsWithData.length > 0 && (
                <div className="mt-3 pt-3 border-t border-gray-100 text-xs text-gray-600">
                  <div className="font-medium text-gray-700 mb-1.5">Cohort ambient averages</div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    {seasonsWithData.map(s => {
                      const st = seasonStats[s];
                      const fmt = (c: number | null) => {
                        if (c === null) return '—';
                        return useCelsius ? `${Math.round(c)}°C` : `${cToF(c)}°F`;
                      };
                      return (
                        <div key={s} className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: SEASON_COLOUR[s] }} />
                          <div>
                            <div className="font-medium text-gray-800 capitalize">{s}</div>
                            <div className="text-gray-500">
                              {fmt(st.avgAmbientMinC)} – {fmt(st.avgAmbientMaxC)}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Per-season summary table */}
            {seasonsWithData.length > 0 && (
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                <div className="px-4 py-3 text-sm font-semibold text-gray-700 border-b border-gray-100">
                  How each season performed
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-500 bg-gray-50">
                      <th className="text-left px-4 py-2 font-medium">Season</th>
                      <th className="text-right px-3 py-2 font-medium">Builds</th>
                      <th className="text-right px-3 py-2 font-medium">Reached kill</th>
                      <th className="text-right px-3 py-2 font-medium">Avg peak</th>
                      <th className="text-right px-4 py-2 font-medium">Avg days to kill</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {seasonsWithData.map(s => {
                      const st = seasonStats[s];
                      return (
                        <tr key={s}>
                          <td className="px-4 py-2">
                            <span className="inline-flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: SEASON_COLOUR[s] }} />
                              <span className="capitalize">{s}</span>
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right text-gray-900">{st.n}</td>
                          <td className="px-3 py-2 text-right text-gray-900">
                            {st.reachedKill}/{st.n}
                          </td>
                          <td className="px-3 py-2 text-right text-gray-900">
                            {st.avgPeakF !== null
                              ? `${useCelsius ? fToC(st.avgPeakF) : Math.round(st.avgPeakF)}${unitLabel}`
                              : '—'}
                          </td>
                          <td className="px-4 py-2 text-right text-gray-900">
                            {st.avgDaysToKill !== null ? st.avgDaysToKill.toFixed(1) : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Per-season build lists */}
            {seasonsWithData.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {seasonsWithData.map(s => (
                  <div key={s} className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: SEASON_COLOUR[s] }} />
                      <div className="text-sm font-semibold text-gray-700 capitalize">{s}</div>
                      <span className="text-xs text-gray-400">· {bySeasons[s].length}</span>
                    </div>
                    <div className="divide-y divide-gray-100">
                      {bySeasons[s].map(c => (
                        <button
                          key={c.system.id}
                          onClick={() => navigate(`/analyse/${c.system.id}`)}
                          className="w-full py-2 flex items-center gap-2 text-left hover:bg-gray-50 rounded-lg px-2 -mx-2"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="text-sm text-gray-900 truncate">{c.system.name}</div>
                            <div className="text-xs text-gray-500 mt-0.5">
                              {c.startDate && <>started {c.startDate} · </>}
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
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
