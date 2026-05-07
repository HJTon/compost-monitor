import { useEffect, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import type { CompostSystem } from '@/types';
import { fetchJsonWithRetry } from '@/utils/fetchRetry';

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
  const [loading, setLoading] = useState(true);
  const [savingNotes, setSavingNotes] = useState(false);
  const [justSaved, setJustSaved] = useState<'notes' | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const data = await fetchJsonWithRetry<{ success?: boolean; info?: BuildInfoDoc }>(
          `/.netlify/functions/compost-build-info?system=${encodeURIComponent(system.name)}`
        );
        if (cancelled) return;
        if (data.success && data.info) {
          setInfo(data.info);
          setNotesDraft(data.info.notes || '');
        }
      } catch { /* silent */ }
      finally { if (!cancelled) setLoading(false); }
    }
    load();
    return () => { cancelled = true; };
  }, [system.name]);

  async function save(field: 'notes', value: string) {
    setSavingNotes(true);
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
      setSavingNotes(false);
    }
  }

  const notesChanged = info !== null && notesDraft !== (info.notes || '');

  return (
    <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 space-y-4">
      {system.buildType && (
        <div className="flex">
          <span className="inline-flex items-center px-3 py-1 rounded-full bg-green-50 border border-green-200 text-green-700 text-sm font-medium">
            {system.buildType}
          </span>
        </div>
      )}

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
          rows={8}
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
        {info?.updatedAt && (
          <div className="mt-2 text-[11px] text-gray-400 text-right">
            Last updated {formatUpdatedAt(info.updatedAt)}
          </div>
        )}
      </div>

    </div>
  );
}

function formatUpdatedAt(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric' });
}
