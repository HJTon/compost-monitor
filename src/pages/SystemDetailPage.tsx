import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { Header } from '@/components/Header';
import { Button } from '@/components/Button';
import { useCompost } from '@/contexts/CompostContext';
import { getSystemById, KILL_TEMP_F, KILL_DAYS_REQUIRED, getTempColor } from '@/utils/config';
import type { DailyEntry } from '@/types';

export function SystemDetailPage() {
  const { systemId } = useParams<{ systemId: string }>();
  const navigate = useNavigate();
  const { getSystemEntries } = useCompost();
  const system = systemId ? getSystemById(systemId) : undefined;
  const [entries, setEntries] = useState<DailyEntry[]>([]);

  useEffect(() => {
    if (!systemId) return;
    getSystemEntries(systemId).then(data => {
      setEntries(data.sort((a, b) => a.date.localeCompare(b.date)));
    });
  }, [systemId, getSystemEntries]);

  if (!system) {
    return (
      <div className="min-h-screen bg-green-50/50">
        <Header title="Not Found" showBack />
        <div className="p-4 text-center text-gray-500">System not found</div>
      </div>
    );
  }

  // Calculate kill cycle streaks from local entries
  let currentStreak = 0;
  let longestStreak = 0;
  const reversedEntries = [...entries].reverse();
  for (const entry of reversedEntries) {
    if (entry.peakTemp !== null && entry.peakTemp >= KILL_TEMP_F) {
      currentStreak++;
      longestStreak = Math.max(longestStreak, currentStreak);
    } else {
      currentStreak = 0;
    }
  }

  return (
    <div className="min-h-screen bg-green-50/50 pb-20">
      <Header title={system.name} showBack />

      <div className="p-4 space-y-4">
        {/* Kill cycle summary */}
        <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
          <h3 className="font-semibold text-gray-900 mb-3">Kill Cycle</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="text-center">
              <div className="text-sm text-gray-500">Current Streak</div>
              <div className={`text-3xl font-bold ${currentStreak >= KILL_DAYS_REQUIRED ? 'text-green-600' : 'text-amber-500'}`}>
                {currentStreak}
              </div>
              <div className="text-xs text-gray-400">consecutive days</div>
            </div>
            <div className="text-center">
              <div className="text-sm text-gray-500">Longest Streak</div>
              <div className="text-3xl font-bold text-gray-700">{longestStreak}</div>
              <div className="text-xs text-gray-400">days</div>
            </div>
          </div>
        </div>

        {/* Recent entries */}
        <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
          <h3 className="font-semibold text-gray-900 mb-3">Recent Entries</h3>
          <div className="space-y-2">
            {[...entries].reverse().slice(0, 10).map(entry => {
              const avgColor = entry.averageTemp !== null ? getTempColor(entry.averageTemp).split(' ')[0] : 'text-gray-400';
              return (
                <div key={entry.id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                  <div>
                    <div className="font-medium text-sm">{entry.date}</div>
                    <div className="text-xs text-gray-400">{entry.weather || '--'} · {entry.moisture || '--'}</div>
                  </div>
                  <div className="text-right">
                    <div className={`font-bold ${avgColor}`}>
                      {entry.averageTemp !== null ? `${entry.averageTemp}°F` : '--'}
                    </div>
                    <div className="text-xs text-gray-400">
                      Peak: {entry.peakTemp !== null ? `${entry.peakTemp}°F` : '--'}
                    </div>
                  </div>
                </div>
              );
            })}
            {entries.length === 0 && (
              <div className="text-center py-6 text-gray-400 text-sm">No entries yet</div>
            )}
          </div>
        </div>
      </div>

      {/* Add entry button */}
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-white border-t border-gray-200 shadow-lg">
        <Button fullWidth size="lg" onClick={() => navigate(`/entry/${systemId}`)}>
          <div className="flex items-center justify-center gap-2">
            <Plus size={20} />
            New Entry
          </div>
        </Button>
      </div>
    </div>
  );
}
