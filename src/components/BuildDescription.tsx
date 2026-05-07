import { useEffect, useState } from 'react';
import { Check, Loader2, Pencil, X } from 'lucide-react';
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
  const [editing, setEditing] = useState(false);

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

  async function save(value: string) {
    setSavingNotes(true);
    try {
      const res = await fetch('/.netlify/functions/compost-build-info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ system: system.name, notes: value }),
      });
      const data = await res.json();
      if (data.success) {
        setInfo(data.info);
        setJustSaved('notes');
        setEditing(false);
        setTimeout(() => setJustSaved(v => (v === 'notes' ? null : v)), 1500);
      }
    } finally {
      setSavingNotes(false);
    }
  }

  const notesChanged = info !== null && notesDraft !== (info.notes || '');
  const hasNotes = !!(info?.notes && info.notes.trim().length > 0);

  return (
    <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 space-y-3">
      {system.buildType && (
        <div className="flex">
          <span className="inline-flex items-center px-3 py-1 rounded-full bg-green-50 border border-green-200 text-green-700 text-sm font-medium">
            {system.buildType}
          </span>
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Build notes</label>
          <div className="flex items-center gap-2">
            {justSaved === 'notes' && (
              <span className="text-xs text-green-600 flex items-center gap-1"><Check size={12} /> Saved</span>
            )}
            {!readOnly && !editing && hasNotes && (
              <button
                onClick={() => setEditing(true)}
                className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1"
                title="Edit notes"
              >
                <Pencil size={12} /> Edit
              </button>
            )}
          </div>
        </div>

        {editing || (!hasNotes && !readOnly) ? (
          <>
            <textarea
              value={notesDraft}
              onChange={e => setNotesDraft(e.target.value)}
              placeholder={readOnly ? 'No notes recorded' : 'Use **Section:** content for bold inline labels'}
              rows={10}
              readOnly={readOnly || loading}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono outline-none focus:border-green-primary resize-y leading-snug disabled:bg-gray-50 read-only:bg-gray-50 read-only:cursor-default"
            />
            {!readOnly && (
              <div className="mt-2 flex justify-end gap-2">
                {editing && (
                  <button
                    onClick={() => { setNotesDraft(info?.notes || ''); setEditing(false); }}
                    disabled={savingNotes}
                    className="px-3 py-1.5 rounded-lg text-gray-600 text-sm flex items-center gap-1.5 hover:bg-gray-100"
                  >
                    <X size={14} /> Cancel
                  </button>
                )}
                {notesChanged && (
                  <button
                    onClick={() => save(notesDraft)}
                    disabled={savingNotes}
                    className="px-3 py-1.5 rounded-lg bg-green-primary text-white text-sm flex items-center gap-1.5 disabled:opacity-50"
                  >
                    {savingNotes ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                    Save notes
                  </button>
                )}
              </div>
            )}
          </>
        ) : hasNotes ? (
          <div className="px-3 py-2 border border-gray-200 rounded-lg bg-gray-50/40 leading-snug text-sm text-gray-800">
            {renderNotes(notesDraft)}
          </div>
        ) : (
          <div className="px-3 py-4 border border-gray-200 border-dashed rounded-lg text-sm text-gray-400 italic">
            No notes recorded
          </div>
        )}

        {info?.updatedAt && (
          <div className="mt-1.5 text-[11px] text-gray-400 text-right">
            Last updated {formatUpdatedAt(info.updatedAt)}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Render notes with `**Label:** content` markdown shorthand.
 * - Splits on blank lines (paragraphs)
 * - Bolds the leading `**X:**` and keeps the rest inline on the same line
 * - Tight half-row spacing between paragraphs (`mb-1.5`)
 */
function renderNotes(notes: string) {
  const paras = notes.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  return paras.map((p, i) => {
    const m = p.match(/^\*\*([^*]+)\*\*\s*(.*)$/s);
    if (m) {
      return (
        <p key={i} className="mb-1.5 last:mb-0">
          <strong className="text-gray-900">{m[1]}</strong> {m[2]}
        </p>
      );
    }
    return <p key={i} className="mb-1.5 last:mb-0">{p}</p>;
  });
}

function formatUpdatedAt(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric' });
}
