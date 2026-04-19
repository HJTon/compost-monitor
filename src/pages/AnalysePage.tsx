import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, TrendingUp, GitCompareArrows } from 'lucide-react';
import { Header } from '@/components/Header';
import { useCompost } from '@/contexts/CompostContext';
import type { CompostSystem } from '@/types';

interface BuildSummary {
  startDate: string | null;
  dayCount: number;
  readingCount: number;
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

function BuildCard({ system, summary }: { system: CompostSystem; summary?: BuildSummary }) {
  const parts: string[] = [];

  // Start date
  if (summary?.startDate) {
    const d = parseDate(summary.startDate);
    if (d) parts.push(`Started ${formatShortDate(d)}`);
  }

  // Day count
  if (summary && summary.dayCount > 0) {
    parts.push(`${summary.dayCount} day${summary.dayCount !== 1 ? 's' : ''}`);
  }

  // Build type
  if (system.buildType) {
    parts.push(system.buildType);
  }

  // Probes
  parts.push(`${system.probeLabels.length} probes`);

  return (
    <div className="text-xs text-gray-400 mt-0.5 flex flex-wrap gap-x-1.5">
      {parts.map((p, i) => (
        <span key={i}>
          {i > 0 && <span className="mr-1.5">·</span>}
          {p}
        </span>
      ))}
    </div>
  );
}

export function AnalysePage() {
  const navigate = useNavigate();
  const { settings, allSystems } = useCompost();

  const activeSystems = allSystems.filter(s =>
    settings.activeSystems.includes(s.id)
  );

  // Fetch summary data from spreadsheet for each system
  const [summaries, setSummaries] = useState<Record<string, BuildSummary>>({});

  useEffect(() => {
    const abortController = new AbortController();

    async function loadSummaries() {
      const results: Record<string, BuildSummary> = {};
      await Promise.all(
        activeSystems.map(async (system) => {
          try {
            const res = await fetch(
              `/.netlify/functions/compost-sheets-history?tab=${encodeURIComponent(system.sheetTab)}&limit=365`,
              { signal: abortController.signal }
            );
            if (!res.ok) return;
            const data = await res.json();
            const entries = data.entries || [];
            if (entries.length > 0) {
              const first = entries[0];
              const last = entries[entries.length - 1];
              const firstDate = parseDate(first.date);
              const lastDate = parseDate(last.date);
              const dayCount = firstDate && lastDate
                ? Math.round((lastDate.getTime() - firstDate.getTime()) / 86400000) + 1
                : entries.length;
              results[system.id] = {
                startDate: first.date,
                dayCount,
                readingCount: entries.length,
              };
            }
          } catch { /* skip */ }
        })
      );
      if (!abortController.signal.aborted) {
        setSummaries(results);
      }
    }

    if (activeSystems.length > 0) loadSummaries();
    return () => abortController.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSystems.length]);

  return (
    <div className="min-h-screen bg-green-50/50 pb-8">
      <Header title="Let's Analyse" showBack onBack={() => navigate('/')} />

      <div className="p-4 space-y-3">
        {/* Compare button */}
        <button
          onClick={() => navigate('/compare')}
          className="w-full bg-white rounded-xl p-4 shadow-sm border border-green-200 text-left active:scale-[0.98] transition-transform flex items-center gap-4"
        >
          <div className="w-10 h-10 rounded-lg bg-green-primary/10 flex items-center justify-center shrink-0">
            <GitCompareArrows size={20} className="text-green-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-green-primary">Let's Compare</div>
            <div className="text-xs text-gray-400 mt-0.5">
              Overlay graphs from multiple builds side by side
            </div>
          </div>
          <ChevronRight size={18} className="text-green-300 shrink-0" />
        </button>

        <p className="text-sm text-gray-500 mb-1">
          Or select a system to view its individual analysis.
        </p>

        {activeSystems.map(system => (
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
              <BuildCard system={system} summary={summaries[system.id]} />
            </div>

            <ChevronRight size={18} className="text-gray-300 shrink-0" />
          </button>
        ))}

        {activeSystems.length === 0 && (
          <div className="text-center py-12 text-gray-400 text-sm">
            No active systems. Enable systems in Settings.
          </div>
        )}
      </div>
    </div>
  );
}
