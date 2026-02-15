import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Header } from '@/components/Header';
import { useCompost } from '@/contexts/CompostContext';
import { getSystemById, getTempColor } from '@/utils/config';
import type { DailyEntry } from '@/types';

export function HistoryPage() {
  const navigate = useNavigate();
  const { getDateEntries } = useCompost();
  const [selectedDate, setSelectedDate] = useState(() => {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Pacific/Auckland' });
  });
  const [entries, setEntries] = useState<DailyEntry[]>([]);

  useEffect(() => {
    getDateEntries(selectedDate).then(setEntries);
  }, [selectedDate, getDateEntries]);

  const changeDate = (days: number) => {
    const date = new Date(selectedDate + 'T00:00:00');
    date.setDate(date.getDate() + days);
    setSelectedDate(date.toISOString().split('T')[0]);
  };

  return (
    <div className="min-h-screen bg-green-50/50">
      <Header title="History" showBack />

      <div className="p-4 space-y-4">
        {/* Date picker */}
        <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between">
            <button
              onClick={() => changeDate(-1)}
              className="p-2 rounded-lg bg-gray-100 active:scale-95 transition-all"
            >
              <ChevronLeft size={20} />
            </button>

            <input
              type="date"
              value={selectedDate}
              onChange={e => setSelectedDate(e.target.value)}
              className="text-center font-semibold text-lg bg-transparent outline-none"
            />

            <button
              onClick={() => changeDate(1)}
              className="p-2 rounded-lg bg-gray-100 active:scale-95 transition-all"
            >
              <ChevronRight size={20} />
            </button>
          </div>
        </div>

        {/* Entries for this date */}
        <div className="space-y-3">
          {entries.map(entry => {
            const system = getSystemById(entry.systemId);
            const avgColor = entry.averageTemp !== null ? getTempColor(entry.averageTemp).split(' ')[0] : 'text-gray-400';

            return (
              <button
                key={entry.id}
                onClick={() => navigate(`/entry/${entry.systemId}`)}
                className="w-full bg-white rounded-xl p-4 shadow-sm border border-gray-100 text-left active:scale-[0.98] transition-transform"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold text-gray-900">{system?.name || entry.systemId}</h3>
                    <div className="text-sm text-gray-500 mt-1">
                      {entry.time} · {entry.weather || '--'} · {entry.moisture || '--'}
                    </div>
                    <div className="text-xs text-gray-400 mt-1">
                      {entry.probes.filter(p => p.value !== null).length}/9 probes
                      {entry.synced ? ' · Synced' : ' · Pending'}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`text-2xl font-bold ${avgColor}`}>
                      {entry.averageTemp !== null ? `${entry.averageTemp}°` : '--'}
                    </div>
                    <div className="text-xs text-gray-400">
                      Peak: {entry.peakTemp !== null ? `${entry.peakTemp}°` : '--'}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}

          {entries.length === 0 && (
            <div className="text-center py-12 text-gray-400">
              <p className="text-lg">No entries for this date</p>
              <p className="text-sm mt-1">Use the arrows to browse other dates</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
