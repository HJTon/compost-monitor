import { useEffect, useState } from 'react';
import { Check, Loader2, Sparkles } from 'lucide-react';
import type { CompostSystem } from '@/types';

interface BuildDescriptionProps {
  system: CompostSystem;
  readOnly?: boolean;
}

interface BuildInfoDoc {
  system: string;
  notes: string;
  summary: string;
  updatedAt: string;
}

export function BuildDescription({ system, readOnly }: BuildDescriptionProps) {
  const [info, setInfo] = useState<BuildInfoDoc | null>(null);
  const [notesDraft, setNotesDraft] = useState('');
  const [summaryDraft, setSummaryDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingNotes, setSavingNotes] = useState(false);
  const [savingSummary, setSavingSummary] = useState(false);
  const [justSaved, setJustSaved] = useState<'notes' | 'summary' | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const res = await fetch(`/.netlify/functions/compost-build-info?system=${encodeURIComponent(system.name)}`);
        const data = await res.json();
        if (cancelled) return;
        if (data.success) {
          setInfo(data.info);
          setNotesDraft(data.info.notes || '');
          setSummaryDraft(data.info.summary || '');
        }
      } catch { /* silent */ }
      finally { if (!cancelled) setLoading(false); }
    }
    load();
    return () => { cancelled = true; };
  }, [system.name]);

  async function save(field: 'notes' | 'summary', value: string) {
    const setSaving = field === 'notes' ? setSavingNotes : setSavingSummary;
    setSaving(true);
    try {
      const res = await fetch('/.netlify/functions/compost-build-info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ system: system.name, [field]: value }),
      });
      const data = await res.json();
      if (data.success) {
        setInfo(data.info);
        setJustSaved(field);
        setTimeout(() => setJustSaved(v => (v === field ? null : v)), 1500);
      }
    } finally {
      setSaving(false);
    }
  }

  const notesChanged = info !== null && notesDraft !== (info.notes || '');
  const summaryChanged = info !== null && summaryDraft !== (info.summary || '');

  return (
    <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 space-y-4">
      {/* Top: build type + summary probe/volume hints */}
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
          <h3 className="font-semibold text-gray-900">Pile description</h3>
          {system.buildType && (
            <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-green-50 border border-green-200 text-green-700 text-xs font-medium">
              {system.buildType}
            </span>
          )}
        </div>
      </div>

      {/* Meta chips */}
      <div className="flex flex-wrap gap-1.5 text-xs">
        <span className="px-2 py-1 rounded-md bg-gray-50 border border-gray-100 text-gray-600">
          {system.probeLabels.length} probe{system.probeLabels.length !== 1 ? 's' : ''}
        </span>
        {system.dimensions && (
          <>
            {system.dimensions.widthCm != null && system.dimensions.lengthCm != null && (
              <span className="px-2 py-1 rounded-md bg-gray-50 border border-gray-100 text-gray-600">
                {system.dimensions.widthCm}×{system.dimensions.lengthCm} cm
              </span>
            )}
            {system.dimensions.diameterCm != null && (
              <span className="px-2 py-1 rounded-md bg-gray-50 border border-gray-100 text-gray-600">
                Ø {system.dimensions.diameterCm} cm
              </span>
            )}
            {system.dimensions.heightCm != null && (
              <span className="px-2 py-1 rounded-md bg-gray-50 border border-gray-100 text-gray-600">
                h {system.dimensions.heightCm} cm
              </span>
            )}
          </>
        )}
        {system.mulchBins != null && system.mulchBins > 0 && (
          <span className="px-2 py-1 rounded-md bg-amber-50 border border-amber-100 text-amber-700">
            {system.mulchBins} bin{system.mulchBins !== 1 ? 's' : ''} mulch{system.mulchType ? ` · ${system.mulchType}` : ''}
          </span>
        )}
      </div>

      {/* Notes */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Build notes</label>
          {justSaved === 'notes' && (
            <span className="text-xs text-green-600 flex items-center gap-1"><Check size={12} /> Saved</span>
          )}
        </div>
        <textarea
          value={notesDraft}
          onChange={e => setNotesDraft(e.target.value)}
          placeholder={readOnly ? 'No notes recorded' : ''}
          rows={4}
          readOnly={readOnly || loading}
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:border-green-primary resize-y disabled:bg-gray-50 read-only:bg-gray-50 read-only:cursor-default"
        />
        {!readOnly && notesChanged && (
          <div className="mt-2 flex justify-end">
            <button
              onClick={() => save('notes', notesDraft)}
              disabled={savingNotes}
              className="px-3 py-1.5 rounded-lg bg-green-primary text-white text-sm flex items-center gap-1.5 disabled:opacity-50"
            >
              {savingNotes ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              Save notes
            </button>
          </div>
        )}
      </div>

      {/* Summary */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide flex items-center gap-1.5">
            Summary
            <span className="inline-flex items-center gap-0.5 text-[10px] text-gray-400 font-medium"><Sparkles size={10} /> AI assistant coming soon</span>
          </label>
          {justSaved === 'summary' && (
            <span className="text-xs text-green-600 flex items-center gap-1"><Check size={12} /> Saved</span>
          )}
        </div>
        <textarea
          value={summaryDraft}
          onChange={e => setSummaryDraft(e.target.value)}
          placeholder={readOnly ? 'No summary recorded' : ''}
          rows={4}
          readOnly={readOnly || loading}
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:border-green-primary resize-y disabled:bg-gray-50 read-only:bg-gray-50 read-only:cursor-default"
        />
        {!readOnly && summaryChanged && (
          <div className="mt-2 flex justify-end">
            <button
              onClick={() => save('summary', summaryDraft)}
              disabled={savingSummary}
              className="px-3 py-1.5 rounded-lg bg-green-primary text-white text-sm flex items-center gap-1.5 disabled:opacity-50"
            >
              {savingSummary ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              Save summary
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
