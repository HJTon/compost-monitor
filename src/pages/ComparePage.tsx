import { useState, useMemo, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { CheckSquare, Square, Loader2, RotateCw, FlaskConical } from 'lucide-react';
import { Header } from '@/components/Header';
import { Button } from '@/components/Button';
import { useCompost } from '@/contexts/CompostContext';
import { calcVolumeLitres, formatVolume, volumeChangePercent } from '@/utils/volume';
import { KILL_TEMP_F } from '@/utils/config';
import type { CompostSystem, ReadinessCheck } from '@/types';

// ── Fixed high-contrast palette for comparison lines ─────────────────────────
const LINE_COLOURS = [
  '#2563EB', // blue
  '#DC2626', // red
  '#16A34A', // green
  '#9333EA', // purple
  '#EA580C', // orange
];
const LINE_COLOURS_LIGHT = [
  '#93C5FD', // blue-300
  '#FCA5A5', // red-300
  '#86EFAC', // green-300
  '#C4B5FD', // purple-300
  '#FDBA74', // orange-300
];

// ── Types ────────────────────────────────────────────────────────────────────

interface SheetEntry {
  date: string;
  average: number | null;
  peak: number | null;
  height: number | null;
  turn: boolean;
  sample: string;
}

interface BuildSeries {
  system: CompostSystem;
  entries: SheetEntry[];
  colour: string;
  colourLight: string;
}

type Metric = 'peak' | 'avg' | 'both';

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseEntryDate(s: string): Date | null {
  if (!s) return null;
  const dm = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (dm) return new Date(Number(dm[3]), Number(dm[2]) - 1, Number(dm[1]));
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  return null;
}

/** Convert raw entries to day-indexed series (Day 1, Day 2, ...) */
function toDaySeries(entries: SheetEntry[]): { day: number; avg: number | null; peak: number | null; height: number | null; turn: boolean; sample: string }[] {
  // Parse dates and sort
  const dated = entries
    .map(e => ({ e, d: parseEntryDate(e.date) }))
    .filter((x): x is { e: SheetEntry; d: Date } => x.d !== null)
    .sort((a, b) => a.d.getTime() - b.d.getTime());

  if (dated.length === 0) return [];

  const firstDay = dated[0].d;
  firstDay.setHours(0, 0, 0, 0);

  // Dedupe by day number (last one wins, merge turns)
  const byDay = new Map<number, { avg: number | null; peak: number | null; height: number | null; turn: boolean; sample: string }>();
  for (const { e, d } of dated) {
    d.setHours(0, 0, 0, 0);
    const dayNum = Math.round((d.getTime() - firstDay.getTime()) / 86400000) + 1;
    const existing = byDay.get(dayNum);
    byDay.set(dayNum, {
      avg: e.average,
      peak: e.peak,
      height: e.height,
      turn: e.turn || (existing?.turn ?? false),
      sample: e.sample || existing?.sample || '',
    });
  }

  // Build continuous range from day 1 to max day
  const maxDay = Math.max(...byDay.keys());
  const result: { day: number; avg: number | null; peak: number | null; height: number | null; turn: boolean; sample: string }[] = [];
  for (let d = 1; d <= maxDay; d++) {
    const entry = byDay.get(d);
    result.push({
      day: d,
      avg: entry?.avg ?? null,
      peak: entry?.peak ?? null,
      height: entry?.height ?? null,
      turn: entry?.turn ?? false,
      sample: entry?.sample || '',
    });
  }
  return result;
}

// ── Component ────────────────────────────────────────────────────────────────

export function ComparePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const isPublicView = location.pathname.startsWith('/view');
  const { allSystems, settings } = useCompost();

  // All systems (active first, then retired)
  const systemList = useMemo(() => {
    const active = allSystems.filter(s => settings.activeSystems.includes(s.id));
    const retired = allSystems.filter(s => !settings.activeSystems.includes(s.id));
    return [...active, ...retired];
  }, [allSystems, settings.activeSystems]);

  // Selection state
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [comparing, setComparing] = useState(false);

  // Data state
  const [buildData, setBuildData] = useState<BuildSeries[]>([]);
  const [loading, setLoading] = useState(false);

  // Chart controls
  const [metric, setMetric] = useState<Metric>('both');
  const [showTurns, setShowTurns] = useState(true);
  const [showVolume, setShowVolume] = useState(true);
  const [showKillLine, setShowKillLine] = useState(true);
  const [showSamples, setShowSamples] = useState(true);
  const [showReadiness, setShowReadiness] = useState(true);

  // Readiness checks for compared builds
  const [allChecks, setAllChecks] = useState<ReadinessCheck[]>([]);

  useEffect(() => {
    fetch('/.netlify/functions/compost-readiness-read')
      .then(r => r.ok ? r.json() : { checks: [] })
      .then(data => setAllChecks(data.checks || []))
      .catch(() => {});
  }, []);

  // Readiness checks grouped by compared builds (latest per build)
  const readinessComparison = useMemo(() => {
    if (!comparing || buildData.length === 0) return [];
    return buildData.map(bd => {
      const checks = allChecks
        .filter(c => c.systemId === bd.system.id)
        .sort((a, b) => b.date.localeCompare(a.date));
      return { system: bd.system, colour: bd.colour, check: checks[0] || null };
    });
  }, [comparing, buildData, allChecks]);

  function toggleSystem(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < 5) next.add(id);
      return next;
    });
  }

  async function handleCompare() {
    if (selected.size < 2) return;
    setLoading(true);

    const selectedSystems = systemList.filter(s => selected.has(s.id));
    const results: BuildSeries[] = [];

    await Promise.all(selectedSystems.map(async (system, i) => {
      try {
        const res = await fetch(`/.netlify/functions/compost-sheets-history?tab=${encodeURIComponent(system.sheetTab)}&limit=365`);
        if (!res.ok) return;
        const data = await res.json();
        results.push({
          system,
          entries: data.entries || [],
          colour: LINE_COLOURS[i % LINE_COLOURS.length],
          colourLight: LINE_COLOURS_LIGHT[i % LINE_COLOURS_LIGHT.length],
        });
      } catch { /* skip this build */ }
    }));

    // Sort results in same order as selectedSystems
    results.sort((a, b) => selectedSystems.indexOf(a.system) - selectedSystems.indexOf(b.system));
    setBuildData(results);
    setComparing(true);
    setLoading(false);
  }

  // Build merged chart data (all builds aligned to Day 1)
  const { chartData, maxDay, turnMarkers, sampleMarkers } = useMemo(() => {
    if (buildData.length === 0) return { chartData: [], maxDay: 0, turnMarkers: [] as { day: number; dayLabel: string; colour: string; name: string }[], sampleMarkers: [] as { day: number; dayLabel: string; colour: string; name: string }[] };

    const allSeries = buildData.map(bd => ({
      ...bd,
      days: toDaySeries(bd.entries),
    }));

    const maxD = Math.max(...allSeries.map(s => s.days.length), 0);
    const turns: { day: number; dayLabel: string; colour: string; name: string }[] = [];
    const samples: { day: number; dayLabel: string; colour: string; name: string }[] = [];

    const points: Record<string, any>[] = [];
    for (let d = 1; d <= maxD; d++) {
      const dayLabel = `D${d}`;
      const point: Record<string, any> = { day: d, dayLabel };
      for (const series of allSeries) {
        const entry = series.days.find(e => e.day === d);
        const prefix = series.system.id;
        point[`${prefix}_avg`] = entry?.avg ?? null;
        point[`${prefix}_peak`] = entry?.peak ?? null;
        point[`${prefix}_height`] = entry?.height ?? null;
        point[`${prefix}_turn`] = !!entry?.turn;
        if (entry?.turn) {
          turns.push({ day: d, dayLabel, colour: series.colour, name: series.system.name });
        }
        if (entry?.sample) {
          samples.push({ day: d, dayLabel, colour: series.colour, name: series.system.name });
        }
      }
      points.push(point);
    }

    return { chartData: points, maxDay: maxD, turnMarkers: turns, sampleMarkers: samples };
  }, [buildData]);

  // Volume summary per build
  const volumeData = useMemo(() => {
    return buildData
      .filter(bd => {
        const dims = (bd.system as any).dimensions;
        return dims && calcVolumeLitres(dims) !== null;
      })
      .map(bd => {
        const dims = (bd.system as any).dimensions;
        const initial = calcVolumeLitres(dims)!;
        const daySeries = toDaySeries(bd.entries);
        const heights = daySeries.filter(d => d.height !== null);
        const latestH = heights.length > 0 ? heights[heights.length - 1].height : null;
        const current = latestH !== null ? calcVolumeLitres(dims, latestH) : null;
        const pct = current !== null ? volumeChangePercent(initial, current) : null;
        return { system: bd.system, colour: bd.colour, initial, current, pct };
      });
  }, [buildData]);

  // Volume chart data (only builds with dimensions)
  const volumeChartData = useMemo(() => {
    const volBuilds = buildData.filter(bd => {
      const dims = (bd.system as any).dimensions;
      return dims && calcVolumeLitres(dims) !== null;
    });
    if (volBuilds.length === 0) return [];

    const allSeries = volBuilds.map(bd => ({
      ...bd,
      dims: (bd.system as any).dimensions,
      days: toDaySeries(bd.entries),
    }));
    const maxD = Math.max(...allSeries.map(s => s.days.length), 0);

    const points: Record<string, any>[] = [];
    for (let d = 1; d <= maxD; d++) {
      const point: Record<string, any> = { day: d, dayLabel: `D${d}` };
      for (const series of allSeries) {
        const entry = series.days.find(e => e.day === d);
        const h = entry?.height;
        if (h !== null && h !== undefined) {
          point[`${series.system.id}_vol`] = calcVolumeLitres(series.dims, h);
        } else {
          point[`${series.system.id}_vol`] = null;
        }
      }
      points.push(point);
    }
    return points;
  }, [buildData]);

  // Stats table
  const statsData = useMemo(() => {
    return buildData.map(bd => {
      const daySeries = toDaySeries(bd.entries);
      const peaks = daySeries.map(d => d.peak).filter((v): v is number => v !== null);
      const avgs = daySeries.map(d => d.avg).filter((v): v is number => v !== null);
      const turns = daySeries.filter(d => d.turn).length;

      // Kill cycle: longest streak of peak >= KILL_TEMP_F
      let longestKill = 0, currentKill = 0;
      for (const d of daySeries) {
        if (d.peak !== null && d.peak >= KILL_TEMP_F) {
          currentKill++;
          longestKill = Math.max(longestKill, currentKill);
        } else {
          currentKill = 0;
        }
      }

      // Days to reach kill temp
      let daysToKill: number | null = null;
      for (let i = 0; i < daySeries.length; i++) {
        if (daySeries[i].peak !== null && daySeries[i].peak! >= KILL_TEMP_F) {
          daysToKill = i + 1;
          break;
        }
      }

      const samples = daySeries.filter(d => d.sample).length;

      return {
        system: bd.system,
        colour: bd.colour,
        totalDays: daySeries.length,
        readings: peaks.length,
        peakMax: peaks.length > 0 ? Math.max(...peaks) : null,
        avgOfAvg: avgs.length > 0 ? Math.round(avgs.reduce((a, b) => a + b, 0) / avgs.length) : null,
        longestKill,
        daysToKill,
        turns,
        samples,
      };
    });
  }, [buildData]);

  // ── Render: Selection Mode ─────────────────────────────────────────────────
  if (!comparing) {
    return (
      <div className="min-h-screen bg-green-50/50 pb-32">
        <Header title="Let's Compare" showBack onBack={() => navigate(isPublicView ? '/view' : '/analyse')} />
        <div className="p-4 space-y-3">
          <p className="text-sm text-gray-500">
            Select 2–5 builds to compare. Graphs will be aligned by day of build (Day 1, Day 2, …).
          </p>

          {systemList.map(system => {
            const isSelected = selected.has(system.id);
            const isRetired = !settings.activeSystems.includes(system.id);
            return (
              <button
                key={system.id}
                onClick={() => toggleSystem(system.id)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-colors ${
                  isSelected
                    ? 'bg-green-50 border-green-200'
                    : 'bg-white border-gray-100 active:bg-gray-50'
                }`}
              >
                <div className="shrink-0 text-green-primary">
                  {isSelected
                    ? <CheckSquare size={20} />
                    : <Square size={20} className="text-gray-300" />
                  }
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium truncate ${isRetired ? 'text-gray-500' : 'text-gray-800'}`}>
                    {system.name}
                  </p>
                  {isRetired && <p className="text-xs text-gray-400">Retired</p>}
                </div>
              </button>
            );
          })}

          {systemList.length === 0 && (
            <p className="text-center py-12 text-gray-400 text-sm">No builds found.</p>
          )}
        </div>

        <div className="fixed bottom-0 left-0 right-0 p-4 bg-white border-t border-gray-200 shadow-lg">
          <Button
            fullWidth
            size="lg"
            onClick={handleCompare}
            disabled={selected.size < 2 || loading}
          >
            <div className="flex items-center justify-center gap-2">
              {loading
                ? <Loader2 size={20} className="animate-spin" />
                : null
              }
              {loading ? 'Loading…' : `Compare ${selected.size} build${selected.size !== 1 ? 's' : ''}`}
            </div>
          </Button>
          {selected.size < 2 && (
            <p className="text-xs text-center text-gray-400 mt-2">Select at least 2 builds</p>
          )}
          {selected.size >= 5 && (
            <p className="text-xs text-center text-amber-500 mt-2">Maximum 5 builds</p>
          )}
        </div>
      </div>
    );
  }

  // ── Render: Comparison View ────────────────────────────────────────────────

  const xInterval = Math.max(0, Math.floor(maxDay / 10) - 1);

  return (
    <div className="min-h-screen bg-green-50/50 pb-8">
      <Header
        title="Compare"
        showBack
        onBack={() => setComparing(false)}
      />

      <div className="p-4 space-y-4">

        {/* ── Controls ──────────────────────────────────────────────── */}
        <div className="flex flex-wrap gap-1.5">
          {/* Metric toggle */}
          {(['peak', 'avg', 'both'] as const).map(m => (
            <button
              key={m}
              onClick={() => setMetric(m)}
              className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${
                metric === m
                  ? 'bg-green-primary text-white'
                  : 'bg-gray-100 text-gray-600'
              }`}
            >
              {m === 'peak' ? 'Peak' : m === 'avg' ? 'Average' : 'Both'}
            </button>
          ))}
          <button
            onClick={() => setShowTurns(t => !t)}
            className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors flex items-center gap-1 ${
              showTurns ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
            }`}
          >
            <RotateCw size={12} />
            Turns
          </button>
          <button
            onClick={() => setShowSamples(s => !s)}
            className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${
              showSamples ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'
            }`}
          >
            🧪 Samples
          </button>
          <button
            onClick={() => setShowKillLine(k => !k)}
            className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${
              showKillLine ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-500'
            }`}
          >
            Kill line
          </button>
          {volumeChartData.length > 0 && (
            <button
              onClick={() => setShowVolume(v => !v)}
              className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${
                showVolume ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'
              }`}
            >
              Volume
            </button>
          )}
          {readinessComparison.some(r => r.check) && (
            <button
              onClick={() => setShowReadiness(r => !r)}
              className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors flex items-center gap-1 ${
                showReadiness ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-500'
              }`}
            >
              <FlaskConical size={12} />
              Readiness
            </button>
          )}
        </div>

        {/* ── Legend ─────────────────────────────────────────────────── */}
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {buildData.map(bd => (
            <div key={bd.system.id} className="flex items-center gap-1.5 text-xs text-gray-700">
              <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: bd.colour }} />
              <span className="font-medium">{bd.system.name}</span>
            </div>
          ))}
          {metric === 'both' && (
            <span className="text-[10px] text-gray-400 ml-1">solid = peak · dashed = avg</span>
          )}
        </div>

        {/* ── Temperature chart ──────────────────────────────────────── */}
        <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
          <h3 className="font-semibold text-gray-900 mb-3">
            Temperature
            <span className="text-xs font-normal text-gray-400 ml-2">{maxDay} days max</span>
          </h3>

          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis
                  dataKey="dayLabel"
                  tick={{ fontSize: 11 }}
                  interval={xInterval}
                />
                <YAxis tick={{ fontSize: 11 }} domain={[0, 'auto']} />
                <Tooltip
                  labelFormatter={(_v, payload) => {
                    const p = payload?.[0]?.payload;
                    return p ? `Day ${p.day}` : '';
                  }}
                  formatter={(value: any, name: string) => {
                    const sysId = name.replace(/_peak$|_avg$/, '');
                    const bd = buildData.find(b => b.system.id === sysId);
                    const label = bd ? bd.system.name : sysId;
                    const suffix = name.endsWith('_peak') ? ' Peak' : ' Avg';
                    return [`${value}°F`, `${label}${suffix}`];
                  }}
                  contentStyle={{ fontSize: 12 }}
                />

                {/* Kill line */}
                {showKillLine && (
                  <ReferenceLine
                    y={KILL_TEMP_F}
                    stroke="#EF4444"
                    strokeDasharray="5 5"
                    label={{ value: `${KILL_TEMP_F}°F`, fill: '#EF4444', fontSize: 10 }}
                  />
                )}

                {/* Turn markers — small circular-arrow icon in each build's colour
                    rendered as a customized dot on an invisible line, sitting on
                    that build's avg series so it follows the line */}
                {showTurns && buildData.map(bd => {
                  const id = bd.system.id;
                  return (
                    <Line
                      key={`${id}_turn`}
                      type="monotone"
                      dataKey={`${id}_avg`}
                      stroke="none"
                      strokeWidth={0}
                      isAnimationActive={false}
                      legendType="none"
                      name={`${id}_turn`}
                      connectNulls
                      dot={(props: { cx?: number; cy?: number; index?: number }) => {
                        const { cx, cy, index } = props;
                        if (cx == null || cy == null || index == null) return <g />;
                        if (!chartData[index]?.[`${id}_turn`]) return <g />;
                        return (
                          <g key={`turn-${id}-${index}`}>
                            <circle cx={cx} cy={cy} r={9} fill={bd.colour} opacity={0.95} />
                            <path
                              d={`M${cx - 4},${cy - 1} A4,4 0 1,1 ${cx + 3},${cy + 3}`}
                              fill="none" stroke="white" strokeWidth={1.5} strokeLinecap="round"
                            />
                            <path
                              d={`M${cx + 1},${cy + 1} L${cx + 3},${cy + 3} L${cx + 5},${cy + 1}`}
                              fill="none" stroke="white" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"
                            />
                          </g>
                        );
                      }}
                    />
                  );
                })}

                {/* Sample markers — vertical blue dashed lines */}
                {showSamples && sampleMarkers.map((s, i) => (
                  <ReferenceLine
                    key={`sample-${i}`}
                    x={s.dayLabel}
                    stroke="#3B82F6"
                    strokeWidth={2}
                    strokeDasharray="4 4"
                    label={{ value: '🧪', fontSize: 12, position: 'top' }}
                  />
                ))}

                {/* Data lines */}
                {buildData.map(bd => {
                  const id = bd.system.id;
                  return [
                    (metric === 'peak' || metric === 'both') && (
                      <Line
                        key={`${id}_peak`}
                        type="monotone"
                        dataKey={`${id}_peak`}
                        stroke={bd.colour}
                        strokeWidth={2}
                        dot={false}
                        connectNulls
                        isAnimationActive={false}
                        name={`${id}_peak`}
                      />
                    ),
                    (metric === 'avg' || metric === 'both') && (
                      <Line
                        key={`${id}_avg`}
                        type="monotone"
                        dataKey={`${id}_avg`}
                        stroke={metric === 'both' ? bd.colour : bd.colour}
                        strokeWidth={metric === 'both' ? 1.5 : 2}
                        strokeDasharray={metric === 'both' ? '6 3' : undefined}
                        dot={false}
                        connectNulls
                        isAnimationActive={false}
                        name={`${id}_avg`}
                      />
                    ),
                  ];
                })}
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[250px] flex items-center justify-center text-gray-400 text-sm">
              No temperature data found
            </div>
          )}
        </div>

        {/* ── Volume chart ───────────────────────────────────────────── */}
        {showVolume && volumeChartData.length > 0 && (
          <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
            <h3 className="font-semibold text-gray-900 mb-3">Volume</h3>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={volumeChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis
                  dataKey="dayLabel"
                  tick={{ fontSize: 11 }}
                  interval={xInterval}
                />
                <YAxis tick={{ fontSize: 11 }} domain={[0, 'auto']} unit="L" />
                <Tooltip
                  labelFormatter={(_v, payload) => {
                    const p = payload?.[0]?.payload;
                    return p ? `Day ${p.day}` : '';
                  }}
                  formatter={(value: any, name: string) => {
                    const sysId = name.replace(/_vol$/, '');
                    const bd = buildData.find(b => b.system.id === sysId);
                    return [value !== null ? `${Math.round(value)} L` : '—', bd?.system.name || sysId];
                  }}
                  contentStyle={{ fontSize: 12 }}
                />
                {buildData
                  .filter(bd => (bd.system as any).dimensions && calcVolumeLitres((bd.system as any).dimensions) !== null)
                  .map(bd => (
                    <Line
                      key={`${bd.system.id}_vol`}
                      type="monotone"
                      dataKey={`${bd.system.id}_vol`}
                      stroke={bd.colour}
                      strokeWidth={2}
                      dot={false}
                      connectNulls
                      isAnimationActive={false}
                      name={`${bd.system.id}_vol`}
                    />
                  ))
                }
              </LineChart>
            </ResponsiveContainer>

            {/* Volume summary */}
            {volumeData.length > 0 && (
              <div className="mt-3 pt-3 border-t border-gray-100">
                <div className="grid gap-2">
                  {volumeData.map(v => (
                    <div key={v.system.id} className="flex items-center gap-2 text-xs">
                      <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: v.colour }} />
                      <span className="font-medium text-gray-700 min-w-[80px]">{v.system.name}</span>
                      <span className="text-gray-500">{formatVolume(v.initial)}</span>
                      <span className="text-gray-400">→</span>
                      <span className="text-gray-500">{v.current !== null ? formatVolume(v.current) : '—'}</span>
                      {v.pct !== null && (
                        <span className={v.pct < 0 ? 'text-amber-600' : 'text-green-600'}>
                          ({v.pct > 0 ? '+' : ''}{v.pct}%)
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Stats comparison table ─────────────────────────────────── */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <h3 className="font-semibold text-gray-900">Stats</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50/80">
                  <th className="text-left px-3 py-2 font-medium text-gray-500 sticky left-0 bg-gray-50/80">Metric</th>
                  {statsData.map(s => (
                    <th key={s.system.id} className="text-center px-3 py-2 font-medium min-w-[80px]">
                      <div className="flex items-center justify-center gap-1">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: s.colour }} />
                        <span className="text-gray-700 truncate max-w-[70px]">{s.system.name}</span>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                <tr>
                  <td className="px-3 py-2 text-gray-500 sticky left-0 bg-white">Total days</td>
                  {statsData.map(s => <td key={s.system.id} className="text-center px-3 py-2 text-gray-700">{s.totalDays}</td>)}
                </tr>
                <tr>
                  <td className="px-3 py-2 text-gray-500 sticky left-0 bg-white">Readings</td>
                  {statsData.map(s => <td key={s.system.id} className="text-center px-3 py-2 text-gray-700">{s.readings}</td>)}
                </tr>
                <tr>
                  <td className="px-3 py-2 text-gray-500 sticky left-0 bg-white">Highest peak</td>
                  {statsData.map(s => <td key={s.system.id} className="text-center px-3 py-2 text-gray-700 font-mono">{s.peakMax !== null ? `${s.peakMax}°F` : '—'}</td>)}
                </tr>
                <tr>
                  <td className="px-3 py-2 text-gray-500 sticky left-0 bg-white">Mean avg temp</td>
                  {statsData.map(s => <td key={s.system.id} className="text-center px-3 py-2 text-gray-700 font-mono">{s.avgOfAvg !== null ? `${s.avgOfAvg}°F` : '—'}</td>)}
                </tr>
                <tr>
                  <td className="px-3 py-2 text-gray-500 sticky left-0 bg-white">Days to kill temp</td>
                  {statsData.map(s => <td key={s.system.id} className="text-center px-3 py-2 text-gray-700">{s.daysToKill ?? '—'}</td>)}
                </tr>
                <tr>
                  <td className="px-3 py-2 text-gray-500 sticky left-0 bg-white">Longest kill streak</td>
                  {statsData.map(s => (
                    <td key={s.system.id} className={`text-center px-3 py-2 font-medium ${s.longestKill >= 3 ? 'text-green-600' : 'text-gray-700'}`}>
                      {s.longestKill} day{s.longestKill !== 1 ? 's' : ''}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="px-3 py-2 text-gray-500 sticky left-0 bg-white">Turns</td>
                  {statsData.map(s => <td key={s.system.id} className="text-center px-3 py-2 text-gray-700">{s.turns}</td>)}
                </tr>
                <tr>
                  <td className="px-3 py-2 text-gray-500 sticky left-0 bg-white">Samples</td>
                  {statsData.map(s => <td key={s.system.id} className="text-center px-3 py-2 text-gray-700">{s.samples}</td>)}
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Readiness Check comparison ──────────────────────────────── */}
        {showReadiness && readinessComparison.some(r => r.check) && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
              <FlaskConical size={14} className="text-purple-600" />
              <h3 className="font-semibold text-gray-900">Readiness Check</h3>
              <span className="text-xs text-gray-400 ml-auto">Latest per build</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-50/80">
                    <th className="text-left px-3 py-2 font-medium text-gray-500 sticky left-0 bg-gray-50/80">Metric</th>
                    {readinessComparison.map(r => (
                      <th key={r.system.id} className="text-center px-3 py-2 font-medium min-w-[80px]">
                        <div className="flex items-center justify-center gap-1">
                          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: r.colour }} />
                          <span className="text-gray-700 truncate max-w-[70px]">{r.system.name}</span>
                        </div>
                        {r.check && (
                          <div className="text-[10px] text-gray-400 font-normal mt-0.5">{r.check.date}</div>
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {/* Key readiness metrics */}
                  {[
                    { label: 'Bacterial Biomass', key: 'bacterialBiomass' as const, unit: 'ug/g', cat: 'beneficial' },
                    { label: 'Fungal Biomass', key: 'fungalBiomass' as const, unit: 'ug/g', cat: 'beneficial' },
                    { label: 'F:B Ratio', key: 'fbRatio' as const, unit: '', cat: 'ratio' },
                    { label: 'Actinobacteria', key: 'actinobacterialBiomass' as const, unit: 'ug/g', cat: 'beneficial' },
                    { label: 'Total Protozoa', key: 'totalProtozoa' as const, unit: '/g', cat: 'beneficial' },
                    { label: 'Flagellates', key: 'flagellates' as const, unit: '/g', cat: 'beneficial' },
                    { label: 'Amoebae', key: 'amoebae' as const, unit: '/g', cat: 'beneficial' },
                    { label: 'Bact. Nematodes', key: 'bacterialFeedingNematodes' as const, unit: '/g', cat: 'beneficial' },
                    { label: 'Oomycetes', key: 'oomycetesBiomass' as const, unit: 'ug/g', cat: 'detrimental' },
                    { label: 'Ciliates', key: 'ciliates' as const, unit: '/g', cat: 'detrimental' },
                    { label: 'Root-feeding Nem.', key: 'rootFeedingNematodes' as const, unit: '/g', cat: 'detrimental' },
                  ].map(row => (
                    <tr key={row.key}>
                      <td className={`px-3 py-2 sticky left-0 bg-white font-medium ${
                        row.cat === 'detrimental' ? 'text-red-500' : 'text-gray-500'
                      }`}>{row.label}</td>
                      {readinessComparison.map(r => {
                        const val = r.check?.results[row.key];
                        const display = val !== null && val !== undefined
                          ? (row.key === 'fbRatio' ? val.toFixed(3) : val.toLocaleString())
                          : '—';
                        return (
                          <td key={r.system.id} className={`text-center px-3 py-2 font-mono ${
                            row.cat === 'detrimental' && val && val > 0 ? 'text-red-600' : 'text-gray-700'
                          }`}>
                            {display}
                            {val !== null && val !== undefined && row.unit && (
                              <span className="text-gray-400 text-[10px] ml-0.5">{row.unit}</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Back to selection */}
        <button
          onClick={() => setComparing(false)}
          className="w-full text-center text-sm text-green-primary font-medium py-3"
        >
          ← Change selection
        </button>

      </div>
    </div>
  );
}
