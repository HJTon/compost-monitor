import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getSystemById } from '@/utils/config';
import { useCompost } from '@/contexts/CompostContext';
import { PHOTO_SLOTS, type MediaIndexItem } from '@/utils/photoSlots';
import { PhotoGallery } from '@/components/PhotoGallery';

interface SummaryData {
  startDate: string | null;
  dayCount: number;
  readingCount: number;
  peakTemp: number | null;
  avgPeak: number | null;
}

export function PrintReportPage() {
  const { systemId } = useParams<{ systemId: string }>();
  const { getSystem } = useCompost();
  const system = (systemId && (getSystem(systemId) || getSystemById(systemId))) || null;

  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [mediaItems, setMediaItems] = useState<MediaIndexItem[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!system) return;

    async function load() {
      if (!system) return;
      const [historyRes, mediaRes] = await Promise.all([
        fetch(`/.netlify/functions/compost-sheets-history?tab=${encodeURIComponent(system.sheetTab)}&limit=365`).then(r => r.ok ? r.json() : { entries: [] }).catch(() => ({ entries: [] })),
        fetch(`/.netlify/functions/compost-media-index?system=${encodeURIComponent(system.name)}`).then(r => r.ok ? r.json() : { items: [] }).catch(() => ({ items: [] })),
      ]);

      const entries = historyRes.entries || [];
      if (entries.length > 0) {
        const first = entries[0];
        const peaks: number[] = entries.map((e: { peak?: number | null }) => e.peak).filter((v: number | null | undefined): v is number => typeof v === 'number');
        setSummary({
          startDate: first.date,
          dayCount: entries.length,
          readingCount: entries.length,
          peakTemp: peaks.length > 0 ? Math.max(...peaks) : null,
          avgPeak: peaks.length > 0 ? Math.round(peaks.reduce((a, b) => a + b, 0) / peaks.length) : null,
        });
      }

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

      {/* Summary */}
      {summary && (
        <section className="mb-6 grid grid-cols-3 gap-4 break-inside-avoid">
          {summary.startDate && (
            <div>
              <div className="text-xs text-gray-500 uppercase tracking-wide">Start date</div>
              <div className="font-semibold">{summary.startDate}</div>
            </div>
          )}
          <div>
            <div className="text-xs text-gray-500 uppercase tracking-wide">Days tracked</div>
            <div className="font-semibold">{summary.dayCount}</div>
          </div>
          {summary.peakTemp != null && (
            <div>
              <div className="text-xs text-gray-500 uppercase tracking-wide">Peak temperature</div>
              <div className="font-semibold">{summary.peakTemp}°F</div>
            </div>
          )}
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
