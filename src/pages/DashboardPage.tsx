import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Thermometer, CheckCircle, Clock, FlaskConical, Leaf } from 'lucide-react';
import { Header } from '@/components/Header';
import { SyncStatusBar } from '@/components/SyncStatusBar';
import { useCompost } from '@/contexts/CompostContext';
import { getNZDate } from '@/utils/config';
import type { DailyEntry } from '@/types';

type Tab = 'measure' | 'sample';

interface SystemCardData {
  systemId: string;
  name: string;
  shortName: string;
  lastEntry: DailyEntry | null;
  hasToday: boolean;
  isMaturation: boolean;
}

export function DashboardPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { entries, settings, allSystems } = useCompost();
  const [cards, setCards] = useState<SystemCardData[]>([]);
  const today = getNZDate();

  const activeTab: Tab = searchParams.get('tab') === 'sample' ? 'sample' : 'measure';
  const setTab = (tab: Tab) => {
    setSearchParams(tab === 'measure' ? {} : { tab });
  };

  useEffect(() => {
    // Hide grow-phase builds from the Measure screen entirely
    const activeSystems = allSystems.filter(s =>
      settings.activeSystems.includes(s.id) && (s.phase || 'thermophilic') !== 'grow'
    );

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
        isMaturation: sys.phase === 'maturation',
      };
    });

    setCards(cardData);
  }, [entries, settings.activeSystems, allSystems, today]);

  const isSample = activeTab === 'sample';

  return (
    <div className={`min-h-screen ${isSample ? 'bg-blue-50/50' : 'bg-green-50/50'}`}>
      <Header title="Compost Monitor" />
      <SyncStatusBar />

      <div className="p-4 space-y-3">
        {/* Tab toggle */}
        <div className="flex bg-white rounded-xl p-1 shadow-sm border border-gray-100">
          <button
            onClick={() => setTab('measure')}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all ${
              !isSample
                ? 'bg-green-600 text-white shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <Thermometer size={16} />
            Measure
          </button>
          <button
            onClick={() => setTab('sample')}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all ${
              isSample
                ? 'bg-blue-500 text-white shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <FlaskConical size={16} />
            Sample
          </button>
        </div>

        {/* Quick nav (measure mode only) */}
        {!isSample && (
          <button
            onClick={() => navigate('/history')}
            className="w-full bg-white rounded-lg p-3 shadow-sm border border-gray-100 flex items-center gap-2 text-gray-600 text-sm active:scale-95 transition-transform"
          >
            <Clock size={18} />
            History
          </button>
        )}

        {/* System cards */}
        <div className="space-y-3">
          {cards.map(card => {
            const maturationTint = !isSample && card.isMaturation;
            return (
            <button
              key={card.systemId}
              onClick={() => navigate(isSample ? `/sample/${card.systemId}` : `/entry/${card.systemId}`)}
              className={`w-full rounded-xl p-4 shadow-sm border text-left active:scale-[0.98] transition-transform ${
                isSample
                  ? 'bg-white border-blue-100'
                  : maturationTint
                    ? 'bg-amber-50 border-amber-200'
                    : 'bg-white border-gray-100'
              }`}
            >
              {maturationTint && (
                <div className="mb-2 inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-amber-600 text-white">
                  <Leaf size={11} /> In Maturation
                </div>
              )}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                    isSample ? 'bg-blue-100' : maturationTint ? 'bg-amber-100' : 'bg-green-100'
                  }`}>
                    {isSample ? (
                      <FlaskConical size={20} className="text-blue-500" />
                    ) : maturationTint ? (
                      <Leaf size={20} className="text-amber-700" />
                    ) : (
                      <Thermometer size={20} className="text-green-primary" />
                    )}
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">{card.name}</h3>
                    {!isSample && card.lastEntry && (
                      <p className="text-xs text-gray-500">
                        Last: {card.lastEntry.date}
                        {card.lastEntry.averageTemp !== null && ` - Avg: ${card.lastEntry.averageTemp}°F`}
                      </p>
                    )}
                    {!isSample && !card.lastEntry && (
                      <p className="text-xs text-gray-400">No entries yet</p>
                    )}
                    {isSample && (
                      <p className="text-xs text-blue-400">Tap to log a sample</p>
                    )}
                  </div>
                </div>

                {!isSample && (
                  card.hasToday ? (
                    <div className="flex items-center gap-1.5 text-green-600 text-sm font-medium">
                      <CheckCircle size={20} />
                      <span>Done</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 text-gray-400 text-sm">
                      <div className="w-5 h-5 rounded-full border-2 border-gray-300" />
                      <span>Not yet</span>
                    </div>
                  )
                )}

                {isSample && (
                  <FlaskConical size={18} className="text-blue-300" />
                )}
              </div>
            </button>
            );
          })}
        </div>

        {cards.length === 0 && (
          <div className="text-center py-12 text-gray-400">
            {isSample ? (
              <>
                <FlaskConical size={48} className="mx-auto mb-3 opacity-50" />
                <p>No active systems</p>
                <p className="text-sm">Enable systems in Settings to log samples</p>
              </>
            ) : (
              <>
                <Thermometer size={48} className="mx-auto mb-3 opacity-50" />
                <p>No active systems</p>
                <p className="text-sm">Enable systems in Settings</p>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
