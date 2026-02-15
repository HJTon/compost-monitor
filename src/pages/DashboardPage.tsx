import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Thermometer, CheckCircle, Clock, BarChart3 } from 'lucide-react';
import { Header } from '@/components/Header';
import { SyncStatusBar } from '@/components/SyncStatusBar';
import { useCompost } from '@/contexts/CompostContext';
import { COMPOST_SYSTEMS, getNZDate, KILL_TEMP_F, KILL_DAYS_REQUIRED } from '@/utils/config';
import type { DailyEntry } from '@/types';

interface SystemCardData {
  systemId: string;
  name: string;
  shortName: string;
  lastEntry: DailyEntry | null;
  hasToday: boolean;
  killDays: number;
  killComplete: boolean;
}

export function DashboardPage() {
  const navigate = useNavigate();
  const { entries, settings } = useCompost();
  const [cards, setCards] = useState<SystemCardData[]>([]);
  const today = getNZDate();

  useEffect(() => {
    const activeSystems = COMPOST_SYSTEMS.filter(s => settings.activeSystems.includes(s.id));

    const cardData: SystemCardData[] = activeSystems.map(sys => {
      const systemEntries = entries
        .filter(e => e.systemId === sys.id)
        .sort((a, b) => b.date.localeCompare(a.date));

      const lastEntry = systemEntries[0] || null;
      const hasToday = systemEntries.some(e => e.date === today);

      // Calculate kill cycle: count consecutive days where peak >= KILL_TEMP_F
      let killDays = 0;
      for (const entry of systemEntries) {
        if (entry.peakTemp !== null && entry.peakTemp >= KILL_TEMP_F) {
          killDays++;
        } else {
          break;
        }
      }

      return {
        systemId: sys.id,
        name: sys.name,
        shortName: sys.shortName,
        lastEntry,
        hasToday,
        killDays,
        killComplete: killDays >= KILL_DAYS_REQUIRED,
      };
    });

    setCards(cardData);
  }, [entries, settings.activeSystems, today]);

  return (
    <div className="min-h-screen bg-green-50/50">
      <Header title="Compost Monitor" />
      <SyncStatusBar />

      <div className="p-4 space-y-3">
        {/* Quick nav */}
        <div className="flex gap-2">
          <button
            onClick={() => navigate('/history')}
            className="flex-1 bg-white rounded-lg p-3 shadow-sm border border-gray-100 flex items-center gap-2 text-gray-600 text-sm active:scale-95 transition-transform"
          >
            <Clock size={18} />
            History
          </button>
          <button
            onClick={() => navigate('/settings')}
            className="flex-1 bg-white rounded-lg p-3 shadow-sm border border-gray-100 flex items-center gap-2 text-gray-600 text-sm active:scale-95 transition-transform"
          >
            <BarChart3 size={18} />
            Settings
          </button>
        </div>

        {/* System cards */}
        <div className="space-y-3">
          {cards.map(card => (
            <button
              key={card.systemId}
              onClick={() => navigate(`/entry/${card.systemId}`)}
              className="w-full bg-white rounded-xl p-4 shadow-sm border border-gray-100 text-left active:scale-[0.98] transition-transform"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center">
                    <Thermometer size={20} className="text-green-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">{card.name}</h3>
                    {card.lastEntry && (
                      <p className="text-xs text-gray-500">
                        Last: {card.lastEntry.date}
                        {card.lastEntry.averageTemp !== null && ` - Avg: ${card.lastEntry.averageTemp}°F`}
                      </p>
                    )}
                    {!card.lastEntry && (
                      <p className="text-xs text-gray-400">No entries yet</p>
                    )}
                  </div>
                </div>

                {card.hasToday ? (
                  <div className="flex items-center gap-1 text-green-600">
                    <CheckCircle size={20} />
                  </div>
                ) : (
                  <div className="w-3 h-3 rounded-full bg-gray-300" />
                )}
              </div>

              {/* Kill cycle progress */}
              <div className="mt-2">
                <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                  <span>Kill cycle</span>
                  <span>{card.killDays} / {KILL_DAYS_REQUIRED} days</span>
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      card.killComplete ? 'bg-green-500' : card.killDays > 0 ? 'bg-amber-400' : 'bg-gray-200'
                    }`}
                    style={{ width: `${Math.min(100, (card.killDays / KILL_DAYS_REQUIRED) * 100)}%` }}
                  />
                </div>
              </div>
            </button>
          ))}
        </div>

        {cards.length === 0 && (
          <div className="text-center py-12 text-gray-400">
            <Thermometer size={48} className="mx-auto mb-3 opacity-50" />
            <p>No active systems</p>
            <p className="text-sm">Enable systems in Settings</p>
          </div>
        )}
      </div>
    </div>
  );
}
