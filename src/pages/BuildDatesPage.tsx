import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CalendarDays, Loader2, Save, Check, Wand2, ChevronDown, ChevronUp, RefreshCw,
} from 'lucide-react';
import { Header } from '@/components/Header';
import { useCompost } from '@/contexts/CompostContext';
import { getNZDate } from '@/utils/config';
import {
  fetchSuggestedBuildDates,
  isISODate,
  persistBuildDate,
  BuildDateLocalError,
} from '@/utils/buildDate';
import type { CompostSystem } from '@/types';

type RowStatus = 'idle' | 'saving' | 'saved' | 'error';

interface RowState {
  value: string;
  status: RowStatus;
  message: string;
}

const EMPTY_ROW: RowState = { value: '', status: 'idle', message: '' };

interface BuildRowProps {
  system: CompostSystem;
  row: RowState;
  /** Earliest "Date of Batching" across this build's bins, or '' if none */
  suggestion: string;
  suggestionsLoading: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
}

/**
 * Kept at module scope (not nested in `BuildDatesPage`) so the row — and the
 * date input inside it — keeps its identity across parent re-renders.
 */
function BuildRow({ system, row, suggestion, suggestionsLoading, onChange, onSave }: BuildRowProps) {
  const saving = row.status === 'saving';
  const canUseSuggestion = !!suggestion && suggestion !== row.value;

  return (
    <div className="px-4 py-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-gray-800 break-words min-w-0 flex-1">
          {system.name}
        </p>
        {row.status === 'saved' && (
          <span className="flex items-center gap-1 text-xs text-green-700 shrink-0">
            <Check size={14} />
            Saved
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="date"
          value={row.value}
          max={getNZDate()}
          disabled={saving}
          onChange={e => onChange(e.target.value)}
          className="flex-1 min-w-0 px-2 py-2 border border-gray-200 rounded-lg text-sm focus:border-green-primary outline-none disabled:opacity-50"
        />
        <button
          onClick={onSave}
          disabled={saving || !row.value}
          className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-full bg-green-primary text-white font-medium disabled:opacity-40 shrink-0"
        >
          {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      {suggestion && (
        <button
          onClick={() => onChange(suggestion)}
          disabled={saving || !canUseSuggestion}
          className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border border-gray-200 text-gray-600 hover:border-green-300 hover:text-green-700 transition-colors disabled:opacity-40"
        >
          <Wand2 size={12} />
          Use suggested · {suggestion}
        </button>
      )}

      {!suggestion && !suggestionsLoading && (
        <p className="text-[11px] text-gray-400">No batching date on this build's bins</p>
      )}

      {row.message && (
        <p
          className={`text-[11px] leading-tight ${
            row.status === 'error' ? 'text-red-500' : 'text-green-700'
          }`}
        >
          {row.message}
        </p>
      )}
    </div>
  );
}

export function BuildDatesPage() {
  const navigate = useNavigate();
  const { allSystems, updateCustomSystem } = useCompost();

  const [suggestions, setSuggestions] = useState<Record<string, string>>({});
  const [loadingSuggestions, setLoadingSuggestions] = useState(true);
  const [suggestionError, setSuggestionError] = useState<string | null>(null);

  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [showAlreadySet, setShowAlreadySet] = useState(false);

  // Builds whose date was cleared in this session stay visible with a success
  // state instead of vanishing mid-scroll.
  const [justSaved, setJustSaved] = useState<Set<string>>(new Set());

  const loadSuggestions = useCallback(async () => {
    setLoadingSuggestions(true);
    setSuggestionError(null);
    try {
      setSuggestions(await fetchSuggestedBuildDates());
    } catch (err) {
      console.error('Build date suggestions load error:', err);
      setSuggestionError('Could not load suggested dates from the Bin Tracker.');
      setSuggestions({});
    } finally {
      setLoadingSuggestions(false);
    }
  }, []);

  useEffect(() => {
    loadSuggestions();
  }, [loadSuggestions]);

  const sortByName = useCallback(
    (a: CompostSystem, b: CompostSystem) => a.name.localeCompare(b.name),
    [],
  );

  const missing = useMemo(
    () => allSystems.filter(s => !s.buildDate && !justSaved.has(s.id)).sort(sortByName),
    [allSystems, justSaved, sortByName],
  );

  // Saved this session — keep them on screen, above the collapsed section.
  const savedThisSession = useMemo(
    () => allSystems.filter(s => justSaved.has(s.id)).sort(sortByName),
    [allSystems, justSaved, sortByName],
  );

  const alreadySet = useMemo(
    () => allSystems.filter(s => s.buildDate && !justSaved.has(s.id)).sort(sortByName),
    [allSystems, justSaved, sortByName],
  );

  const missingCount = missing.length;

  function rowFor(system: CompostSystem): RowState {
    return rows[system.id] ?? { ...EMPTY_ROW, value: system.buildDate || '' };
  }

  function setRow(id: string, patch: Partial<RowState>) {
    setRows(prev => ({
      ...prev,
      [id]: { ...(prev[id] ?? EMPTY_ROW), ...patch },
    }));
  }

  async function handleSave(system: CompostSystem) {
    const current = rowFor(system);
    if (current.status === 'saving') return;
    const date = current.value.trim();
    if (!isISODate(date)) {
      setRow(system.id, { status: 'error', message: 'Pick a valid date first' });
      return;
    }

    setRow(system.id, { status: 'saving', message: '' });
    try {
      const n = await persistBuildDate(system, date, updateCustomSystem);
      setRow(system.id, {
        status: 'saved',
        message: `Saved · ${n} bin${n === 1 ? '' : 's'} updated`,
      });
      setJustSaved(prev => new Set(prev).add(system.id));
    } catch (err) {
      setRow(system.id, {
        status: 'error',
        message:
          err instanceof BuildDateLocalError
            ? 'Failed to save — try again'
            : 'Saved, but the spreadsheet bins did not update — try again',
      });
      // The build date itself did land for a sheet-only failure, so still move
      // the row out of "missing" once React state reflects it.
      if (!(err instanceof BuildDateLocalError)) {
        setJustSaved(prev => new Set(prev).add(system.id));
      }
    }
  }

  const renderRow = (system: CompostSystem) => (
    <BuildRow
      key={system.id}
      system={system}
      row={rowFor(system)}
      suggestion={suggestions[system.name] || ''}
      suggestionsLoading={loadingSuggestions}
      onChange={value => setRow(system.id, { value, status: 'idle', message: '' })}
      onSave={() => handleSave(system)}
    />
  );

  return (
    <div className="min-h-screen bg-green-50/50 pb-8 overflow-x-hidden">
      <Header title="Build dates" showBack onBack={() => navigate('/manage')} />

      <div className="p-4 space-y-4">

        {/* ── Intro ─────────────────────────────────────────────────── */}
        <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
          <div className="flex items-start gap-2">
            <CalendarDays size={18} className="text-green-primary shrink-0 mt-0.5" />
            <div className="min-w-0">
              <h2 className="font-semibold text-gray-900">
                {missingCount === 0
                  ? 'Every build has a date'
                  : `${missingCount} build${missingCount === 1 ? '' : 's'} with no build date`}
              </h2>
              <p className="text-xs text-gray-400 mt-0.5 leading-tight">
                {missingCount === 0
                  ? 'Nothing left to fill in. Dates can still be corrected below.'
                  : 'Set them here in one go. Each save also rewrites the batching date on that build\'s bins in the spreadsheet.'}
              </p>
            </div>
          </div>

          {loadingSuggestions && (
            <p className="flex items-center gap-2 text-xs text-gray-400 mt-3">
              <Loader2 size={14} className="animate-spin" />
              Loading suggested dates from the Bin Tracker…
            </p>
          )}

          {suggestionError && (
            <div className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
              <p>{suggestionError} You can still type dates in by hand.</p>
              <button
                onClick={loadSuggestions}
                className="mt-1.5 flex items-center gap-1 underline"
              >
                <RefreshCw size={11} />
                Try again
              </button>
            </div>
          )}
        </div>

        {/* ── Missing ───────────────────────────────────────────────── */}
        {missingCount > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900">Needs a date ({missingCount})</h2>
              <p className="text-xs text-gray-400 mt-0.5">
                Analyse shows an approximate <span className="font-mono">~</span> date for these
              </p>
            </div>
            <div className="divide-y divide-gray-50">
              {missing.map(renderRow)}
            </div>
          </div>
        )}

        {/* ── Saved in this session ─────────────────────────────────── */}
        {savedThisSession.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-green-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 bg-green-50/40">
              <h2 className="font-semibold text-gray-900">
                Done just now ({savedThisSession.length})
              </h2>
            </div>
            <div className="divide-y divide-gray-50">
              {savedThisSession.map(renderRow)}
            </div>
          </div>
        )}

        {/* ── Already set ───────────────────────────────────────────── */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <button
            onClick={() => setShowAlreadySet(o => !o)}
            className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left hover:bg-gray-50 transition-colors"
          >
            <div className="min-w-0">
              <h2 className="font-semibold text-gray-900">
                Already set ({alreadySet.length})
              </h2>
              <p className="text-xs text-gray-400 mt-0.5">Tap to correct a wrong date</p>
            </div>
            {showAlreadySet
              ? <ChevronUp size={16} className="text-gray-400 shrink-0" />
              : <ChevronDown size={16} className="text-gray-400 shrink-0" />}
          </button>

          {showAlreadySet && (
            alreadySet.length === 0 ? (
              <p className="px-4 py-6 text-sm text-gray-400 text-center border-t border-gray-100">
                No builds have a date yet
              </p>
            ) : (
              <div className="divide-y divide-gray-50 border-t border-gray-100">
                {alreadySet.map(renderRow)}
              </div>
            )
          )}
        </div>

      </div>
    </div>
  );
}
