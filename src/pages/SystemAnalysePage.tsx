import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { Ruler, BarChart3 } from 'lucide-react';
import { Header } from '@/components/Header';
import { getSystemById, KILL_TEMP_F, KILL_DAYS_REQUIRED } from '@/utils/config';

interface SheetEntry {
  date: string;
  average: number | null;
  peak: number | null;
}

interface ChartPoint {
  date: string;
  avg: number | null;
  peak: number | null;
}

export function SystemAnalysePage() {
  const { systemId } = useParams<{ systemId: string }>();
  const navigate = useNavigate();
  const system = systemId ? getSystemById(systemId) : undefined;

  const [chartData, setChartData] = useState<ChartPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentStreak, setCurrentStreak] = useState(0);
  const [longestStreak, setLongestStreak] = useState(0);
  const [totalEntries, setTotalEntries] = useState(0);

  useEffect(() => {
    if (!system?.sheetTab) return;
    setLoading(true);
    fetch(`/.netlify/functions/compost-sheets-history?tab=${encodeURIComponent(system.sheetTab)}&limit=365`)
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(data => {
        if (data.entries?.length) {
          const entries: SheetEntry[] = data.entries;
          setTotalEntries(entries.length);

          // Chart data (oldest → newest for left-to-right display)
          setChartData(entries.map(e => ({
            date: e.date.length >= 7 ? e.date.slice(5) : e.date,
            avg: e.average,
            peak: e.peak,
          })));

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

  if (!system) {
    return (
      <div className="min-h-screen bg-green-50/50">
        <Header title="Not Found" showBack />
        <div className="p-4 text-center text-gray-500">System not found</div>
      </div>
    );
  }

  const xAxisInterval = Math.max(0, Math.floor(chartData.length / 8) - 1);

  return (
    <div className="min-h-screen bg-green-50/50 pb-8">
      <Header title={system.name} showBack onBack={() => navigate('/analyse')} />

      <div className="p-4 space-y-4">

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
            <h3 className="font-semibold text-gray-900">Temperature</h3>
            {!loading && chartData.length > 0 && (
              <span className="text-xs text-gray-400">{chartData.length} days</span>
            )}
          </div>
          {loading ? (
            <div className="h-[250px] flex items-center justify-center">
              <div className="w-6 h-6 border-2 border-green-600 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} interval={xAxisInterval} />
                <YAxis tick={{ fontSize: 11 }} domain={[0, 'auto']} />
                <Tooltip />
                <ReferenceLine
                  y={KILL_TEMP_F}
                  stroke="#EF4444"
                  strokeDasharray="5 5"
                  label={{ value: `${KILL_TEMP_F}°F Kill`, fill: '#EF4444', fontSize: 11 }}
                />
                <Line type="monotone" dataKey="avg" stroke="#2D8B4E" strokeWidth={2} name="Average" dot={{ r: chartData.length > 60 ? 0 : 3 }} />
                <Line type="monotone" dataKey="peak" stroke="#F59E0B" strokeWidth={2} name="Peak" dot={{ r: chartData.length > 60 ? 0 : 3 }} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[250px] flex items-center justify-center text-gray-400 text-sm">
              No data in spreadsheet yet
            </div>
          )}
        </div>

        {/* Height chart — placeholder */}
        <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-900">Height</h3>
            <span className="text-xs bg-amber-100 text-amber-600 font-medium px-2 py-0.5 rounded-full">Coming soon</span>
          </div>
          <div className="h-[160px] flex flex-col items-center justify-center gap-3 border-2 border-dashed border-gray-100 rounded-xl">
            <Ruler size={32} className="text-gray-200" />
            <p className="text-sm text-gray-400 text-center">
              Height tracking will appear here
            </p>
          </div>
        </div>

        {/* Additional charts — placeholder */}
        <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-900">More Graphs</h3>
            <span className="text-xs bg-amber-100 text-amber-600 font-medium px-2 py-0.5 rounded-full">Coming soon</span>
          </div>
          <div className="h-[120px] flex flex-col items-center justify-center gap-3 border-2 border-dashed border-gray-100 rounded-xl">
            <BarChart3 size={28} className="text-gray-200" />
            <p className="text-sm text-gray-400 text-center">
              Additional analysis graphs coming soon
            </p>
          </div>
        </div>

      </div>
    </div>
  );
}
