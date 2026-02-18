import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Thermometer, CheckCircle, Clock, BarChart3 } from 'lucide-react';
import { Header } from '@/components/Header';
import { SyncStatusBar } from '@/components/SyncStatusBar';
import { useCompost } from '@/contexts/CompostContext';
import { COMPOST_SYSTEMS, getNZDate } from '@/utils/config';
import type { DailyEntry } from '@/types';

interface SystemCardData {
  systemId: string;
  name: string;
  shortName: string;
  lastEntry: DailyEntry | null;
  hasToday: boolean;
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

      return {
        systemId: sys.id,
        name: sys.name,
        shortName: sys.shortName,
        lastEntry,
        hasToday,
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
                  <div className="flex items-center gap-1.5 text-green-600 text-sm font-medium">
                    <CheckCircle size={20} />
                    <span>Done</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 text-gray-400 text-sm">
                    <div className="w-5 h-5 rounded-full border-2 border-gray-300" />
                    <span>Not yet</span>
                  </div>
                )}
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
