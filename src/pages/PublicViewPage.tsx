import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { TrendingUp, GitCompareArrows, ChevronRight, Lock } from 'lucide-react';
import { useCompost } from '@/contexts/CompostContext';

interface BuildSummary {
  startDate: string | null;
  dayCount: number;
}

function parseDate(s: string): Date | null {
  if (!s) return null;
  const dm = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (dm) return new Date(Number(dm[3]), Number(dm[2]) - 1, Number(dm[1]));
  return null;
}

function formatShortDate(d: Date): string {
  return `${d.getDate()} ${d.toLocaleString('en-NZ', { month: 'short', year: 'numeric' })}`;
}

export function PublicViewPage() {
  const navigate = useNavigate();
  const { settings, allSystems } = useCompost();

  const activeSystems = allSystems.filter(s =>
    settings.activeSystems.includes(s.id)
  );

  const [summaries, setSummaries] = useState<Record<string, BuildSummary>>({});

  useEffect(() => {
    const ac = new AbortController();
    async function load() {
      const results: Record<string, BuildSummary> = {};
      await Promise.all(activeSystems.map(async (sys) => {
        try {
          const res = await fetch(`/.netlify/functions/compost-sheets-history?tab=${encodeURIComponent(sys.sheetTab)}&limit=365`, { signal: ac.signal });
          if (!res.ok) return;
          const data = await res.json();
          const entries = data.entries || [];
          if (entries.length > 0) {
            const firstDate = parseDate(entries[0].date);
            const lastDate = parseDate(entries[entries.length - 1].date);
            results[sys.id] = {
              startDate: entries[0].date,
              dayCount: firstDate && lastDate ? Math.round((lastDate.getTime() - firstDate.getTime()) / 86400000) + 1 : entries.length,
            };
          }
        } catch { /* skip */ }
      }));
      if (!ac.signal.aborted) setSummaries(results);
    }
    if (activeSystems.length > 0) load();
    return () => ac.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSystems.length]);

  return (
    <div className="min-h-screen bg-green-50/50 pb-8">
      {/* Header */}
      <div className="bg-green-primary text-white px-4 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img
            src="/fuller-light-logo.jpg"
            alt="Fuller Light Ltd."
            className="w-8 h-8 rounded-lg object-contain bg-white p-0.5"
          />
          <div>
            <h1 className="font-bold text-lg leading-tight">Compost Monitor</h1>
            <p className="text-white/60 text-xs">Read-only view</p>
          </div>
        </div>
        <a
          href="/"
          className="flex items-center gap-1 text-xs text-white/50 hover:text-white/80 transition-colors"
        >
          <Lock size={12} />
          Staff login
        </a>
      </div>

      <div className="p-4 space-y-3">
        {/* Compare button */}
        <button
          onClick={() => navigate('/view/compare')}
          className="w-full bg-white rounded-xl p-4 shadow-sm border border-green-200 text-left active:scale-[0.98] transition-transform flex items-center gap-4"
        >
          <div className="w-10 h-10 rounded-lg bg-green-primary/10 flex items-center justify-center shrink-0">
            <GitCompareArrows size={20} className="text-green-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-green-primary">Compare Builds</div>
            <div className="text-xs text-gray-400 mt-0.5">
              Overlay graphs from multiple builds side by side
            </div>
          </div>
          <ChevronRight size={18} className="text-green-300 shrink-0" />
        </button>

        <p className="text-sm text-gray-500 mb-1">
          Select a system to view its analysis.
        </p>

        {activeSystems.map(system => {
          return (
            <button
              key={system.id}
              onClick={() => navigate(`/view/${system.id}`)}
              className="w-full bg-white rounded-xl p-4 shadow-sm border border-gray-100 text-left active:scale-[0.98] transition-transform flex items-center gap-4"
            >
              <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center shrink-0">
                <TrendingUp size={20} className="text-green-primary" />
              </div>

              <div className="flex-1 min-w-0">
                <div className="font-semibold text-gray-900">{system.name}</div>
                <div className="text-xs text-gray-400 mt-0.5">
                  {(() => {
                    const s = summaries[system.id];
                    const parts: string[] = [];
                    if (s?.startDate) {
                      const d = parseDate(s.startDate);
                      if (d) parts.push(`Started ${formatShortDate(d)}`);
                    }
                    if (s && s.dayCount > 0) parts.push(`${s.dayCount} days`);
                    parts.push(`${system.probeLabels.length} probes`);
                    return parts.join(' · ');
                  })()}
                </div>
              </div>

              <ChevronRight size={18} className="text-gray-300 shrink-0" />
            </button>
          );
        })}

        {activeSystems.length === 0 && (
          <div className="text-center py-12 text-gray-400 text-sm">
            No active systems.
          </div>
        )}
      </div>
    </div>
  );
}
