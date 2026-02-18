import { useNavigate } from 'react-router-dom';
import { ChevronRight, TrendingUp } from 'lucide-react';
import { Header } from '@/components/Header';
import { useCompost } from '@/contexts/CompostContext';
import { COMPOST_SYSTEMS } from '@/utils/config';

export function AnalysePage() {
  const navigate = useNavigate();
  const { entries, settings } = useCompost();

  const activeSystems = COMPOST_SYSTEMS.filter(s =>
    settings.activeSystems.includes(s.id)
  );

  return (
    <div className="min-h-screen bg-green-50/50 pb-8">
      <Header title="Let's Analyse" showBack onBack={() => navigate('/')} />

      <div className="p-4 space-y-3">
        <p className="text-sm text-gray-500 mb-1">
          Select a system to view its temperature history and analysis.
        </p>

        {activeSystems.map(system => {
          const systemEntries = entries
            .filter(e => e.systemId === system.id)
            .sort((a, b) => b.date.localeCompare(a.date));
          const lastEntry = systemEntries[0] || null;

          return (
            <button
              key={system.id}
              onClick={() => navigate(`/analyse/${system.id}`)}
              className="w-full bg-white rounded-xl p-4 shadow-sm border border-gray-100 text-left active:scale-[0.98] transition-transform flex items-center gap-4"
            >
              <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center shrink-0">
                <TrendingUp size={20} className="text-green-primary" />
              </div>

              <div className="flex-1 min-w-0">
                <div className="font-semibold text-gray-900">{system.name}</div>
                <div className="text-xs text-gray-400 mt-0.5">
                  {lastEntry
                    ? `Last reading: ${lastEntry.date}${lastEntry.averageTemp !== null ? ` · ${lastEntry.averageTemp}°F avg` : ''}`
                    : 'No readings yet'}
                </div>
              </div>

              <ChevronRight size={18} className="text-gray-300 shrink-0" />
            </button>
          );
        })}

        {activeSystems.length === 0 && (
          <div className="text-center py-12 text-gray-400 text-sm">
            No active systems. Enable systems in Settings.
          </div>
        )}
      </div>
    </div>
  );
}
