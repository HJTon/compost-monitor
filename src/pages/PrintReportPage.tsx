import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getSystemById, formatTempF } from '@/utils/config';
import { useCompost } from '@/contexts/CompostContext';
import { PHOTO_SLOTS, type MediaIndexItem } from '@/utils/photoSlots';
import { PhotoGallery } from '@/components/PhotoGallery';
import { formatNiceDate, daysBetween } from '@/components/BuildVitals';
import { sortTrials, trialStart, trialStatus, trialTypeDef, trialTypeOf } from '@/utils/trials';
import { getNZDate } from '@/utils/config';
import type { ReadinessCheck } from '@/types';

interface SummaryData {
  /** YYYY-MM-DD — canonical build date, or the first reading's date */
  startIso: string | null;
  /** True when startIso came from the first reading rather than system.buildDate */
  startApprox: boolean;
  dayCount: number;
  readingCount: number;
  peakTemp: number | null;
  avgPeak: number | null;
}

/** DD/MM/YYYY (sheet format) → YYYY-MM-DD. Returns '' if unparseable. */
function displayDateToIso(s: string): string {
  const dm = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (dm) return `${dm[3]}-${dm[2].padStart(2, '0')}-${dm[1].padStart(2, '0')}`;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso ? iso[0] : '';
}

export function PrintReportPage() {
  const { systemId } = useParams<{ systemId: string }>();
  const { getSystem, settings } = useCompost();
  const tempUnit = settings.tempUnit ?? 'C';
  const system = (systemId && (getSystem(systemId) || getSystemById(systemId))) || null;

  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [mediaItems, setMediaItems] = useState<MediaIndexItem[]>([]);
  const [latestFbRatio, setLatestFbRatio] = useState<number | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!system) return;

    async function load() {
      if (!system) return;
      const [historyRes, mediaRes, readinessRes] = await Promise.all([
        fetch(`/.netlify/functions/compost-sheets-history?tab=${encodeURIComponent(system.sheetTab)}&limit=365`).then(r => r.ok ? r.json() : { entries: [] }).catch(() => ({ entries: [] })),
        fetch(`/.netlify/functions/compost-media-index?system=${encodeURIComponent(system.name)}`).then(r => r.ok ? r.json() : { items: [] }).catch(() => ({ items: [] })),
        fetch(`/.netlify/functions/compost-readiness-read?system=${encodeURIComponent(system.id)}`).then(r => r.ok ? r.json() : { checks: [] }).catch(() => ({ checks: [] })),
      ]);

      const entries = historyRes.entries || [];
      if (entries.length > 0) {
        const first = entries[0];
        const peaks: number[] = entries.map((e: { peak?: number | null }) => e.peak).filter((v: number | null | undefined): v is number => typeof v === 'number');
        setSummary({
          // Canonical build date wins; fall back to the first reading's date
          startIso: system.buildDate || displayDateToIso(first.date) || null,
          startApprox: !system.buildDate,
          dayCount: entries.length,
          readingCount: entries.length,
          peakTemp: peaks.length > 0 ? Math.max(...peaks) : null,
          avgPeak: peaks.length > 0 ? Math.round(peaks.reduce((a, b) => a + b, 0) / peaks.length) : null,
        });
      }

      const checks: ReadinessCheck[] = (readinessRes.checks || [])
        .slice()
        .sort((a: ReadinessCheck, b: ReadinessCheck) => a.date.localeCompare(b.date));
      setLatestFbRatio(checks.length > 0 ? (checks[checks.length - 1].results?.fbRatio ?? null) : null);

      setMediaItems(mediaRes.items || []);
      setReady(true);
    }
    load();
  }, [system]);

  useEffect(() => {
    if (!ready) return;
    // Give images a beat to render before firing the dialog
    const t = setTimeout(() => {
      window.print();
    }, 800);
    return () => clearTimeout(t);
  }, [ready]);

  if (!system) {
    return <div className="p-8">System not found</div>;
  }

  const today = new Date().toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric' });

  // Build vitals (static — no star tapping in print)
  const startIso = summary?.startIso || '';
  const age = startIso ? daysBetween(startIso, getNZDate()) : null;
  const maturationStart = system.maturation?.startedAt || '';
  const daysToMaturation = startIso && maturationStart
    ? daysBetween(startIso, maturationStart)
    : null;
  const trials = system.grow?.trials ?? [];
  const cropList = trials.map(t => t.crop).filter(Boolean).join(', ');
  const rating = system.performanceRating ?? 0;

  return (
    <div className="max-w-4xl mx-auto p-8 print:p-0 bg-white text-gray-900 print:text-black">
      <style>{`
        @media print {
          @page { size: A4; margin: 14mm; }
          body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
          .break-before { break-before: page; }
          .break-inside-avoid { break-inside: avoid; }
          button, .no-print { display: none !important; }
        }
      `}</style>

      <header className="border-b pb-4 mb-6">
        <div className="text-sm text-gray-500">Compost build report</div>
        <h1 className="text-3xl font-bold">{system.name}</h1>
        <div className="text-sm text-gray-600 mt-1">Generated {today}</div>
      </header>

      {/* Build vitals — static print version of the Analyse page strip */}
      {summary && (
        <section className="mb-6 flex flex-wrap gap-x-8 gap-y-3 break-inside-avoid">
          {summary.startIso && (
            <div>
              <div className="text-xs text-gray-500 uppercase tracking-wide">Built</div>
              <div className="font-semibold">
                {summary.startApprox ? '~' : ''}{formatNiceDate(summary.startIso) || summary.startIso}
              </div>
            </div>
          )}
          {age !== null && (
            <div>
              <div className="text-xs text-gray-500 uppercase tracking-wide">Age</div>
              <div className="font-semibold">{age} days</div>
            </div>
          )}
          <div>
            <div className="text-xs text-gray-500 uppercase tracking-wide">Maturation</div>
            <div className="font-semibold">
              {daysToMaturation !== null
                ? `${daysToMaturation} days`
                : (maturationStart ? formatNiceDate(maturationStart) || maturationStart : '—')}
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-500 uppercase tracking-wide">Growing</div>
            <div className="font-semibold">{cropList || '—'}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500 uppercase tracking-wide">Rating</div>
            <div className="font-semibold">
              {rating > 0 ? `${'★'.repeat(rating)}${'☆'.repeat(5 - rating)}` : '—'}
            </div>
          </div>
          {latestFbRatio != null && (
            <div>
              <div className="text-xs text-gray-500 uppercase tracking-wide">F:B ratio</div>
              <div className="font-semibold">{latestFbRatio}</div>
            </div>
          )}
          <div>
            <div className="text-xs text-gray-500 uppercase tracking-wide">Days tracked</div>
            <div className="font-semibold">{summary.dayCount}</div>
          </div>
          {summary.peakTemp != null && (
            <div>
              <div className="text-xs text-gray-500 uppercase tracking-wide">Peak temperature</div>
              <div className="font-semibold">{formatTempF(summary.peakTemp, tempUnit)}</div>
            </div>
          )}
        </section>
      )}

      {/* Growth trials — compact static list (no photos in v1 print) */}
      {trials.length > 0 && (
        <section className="mb-8 break-inside-avoid">
          <h2 className="text-xl font-semibold border-b pb-1 mb-3">Growth trials</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="py-1 pr-3 font-medium">Type</th>
                <th className="py-1 pr-3 font-medium">Crop</th>
                <th className="py-1 pr-3 font-medium">Method</th>
                <th className="py-1 pr-3 font-medium">Dates</th>
                <th className="py-1 pr-3 font-medium">Status</th>
                <th className="py-1 font-medium">Result</th>
              </tr>
            </thead>
            <tbody>
              {sortTrials(trials).map(t => {
                const start = trialStart(t);
                const status = trialStatus(t);
                return (
                  <tr key={t.id} className="border-t align-top break-inside-avoid">
                    <td className="py-1.5 pr-3">{trialTypeDef(trialTypeOf(t)).label}</td>
                    <td className="py-1.5 pr-3">{t.crop || '—'}</td>
                    <td className="py-1.5 pr-3">{t.method || '—'}</td>
                    <td className="py-1.5 pr-3 whitespace-nowrap">
                      {formatNiceDate(start) || start || '—'}
                      {t.endedAt ? ` → ${formatNiceDate(t.endedAt) || t.endedAt}` : ''}
                    </td>
                    <td className="py-1.5 pr-3 whitespace-nowrap">{status.label}</td>
                    <td className="py-1.5">{t.result || t.notes || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      {/* Photo sections — each non-hero slot rendered with section heading + all photos stacked */}
      {PHOTO_SLOTS.filter(s => s.id !== 'hero').map(slot => {
        const items = mediaItems.filter(m => m.slot === slot.id);
        if (items.length === 0) return null;
        return (
          <section key={slot.id} className="mb-8 break-inside-avoid">
            <h2 className="text-xl font-semibold border-b pb-1 mb-3">{slot.label}</h2>
            <PhotoGallery items={items} printMode onAdd={() => {}} />
          </section>
        );
      })}

      <footer className="mt-10 pt-4 border-t text-xs text-gray-400 no-print">
        <button
          onClick={() => window.print()}
          className="px-4 py-2 bg-green-primary text-white rounded-lg"
        >
          Print / Save as PDF
        </button>
      </footer>
    </div>
  );
}
