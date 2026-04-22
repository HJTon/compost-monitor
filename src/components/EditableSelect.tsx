import { useState } from 'react';
import { Plus, Check, X } from 'lucide-react';

interface EditableSelectProps {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
  onAddOption: (newOption: string) => Promise<void> | void;
  placeholder?: string;
}

/**
 * Select dropdown with an inline "+ Add new" affordance.
 * When the user adds a new option it's persisted via onAddOption and then
 * set as the current value.
 */
export function EditableSelect({
  label,
  value,
  options,
  onChange,
  onAddOption,
  placeholder = 'Select…',
}: EditableSelectProps) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');

  const handleSubmitNew = async () => {
    const v = draft.trim();
    if (!v) return;
    if (!options.includes(v)) {
      await onAddOption(v);
    }
    onChange(v);
    setDraft('');
    setAdding(false);
  };

  return (
    <div>
      <label className="text-xs font-medium text-gray-500 block mb-1">{label}</label>
      {!adding ? (
        <div className="flex gap-2">
          <select
            value={value}
            onChange={e => onChange(e.target.value)}
            className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-green-primary"
          >
            <option value="">{placeholder}</option>
            {options.map(opt => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="px-3 py-2 text-sm border border-gray-200 rounded-lg text-green-primary hover:bg-green-50"
            title="Add new option"
          >
            <Plus size={16} />
          </button>
        </div>
      ) : (
        <div className="flex gap-2">
          <input
            autoFocus
            type="text"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') handleSubmitNew();
              if (e.key === 'Escape') { setAdding(false); setDraft(''); }
            }}
            placeholder={`New ${label.toLowerCase()}…`}
            className="flex-1 px-3 py-2 text-sm border border-green-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-green-primary"
          />
          <button
            type="button"
            onClick={handleSubmitNew}
            className="px-3 py-2 text-sm bg-green-primary text-white rounded-lg"
            title="Save new option"
          >
            <Check size={16} />
          </button>
          <button
            type="button"
            onClick={() => { setAdding(false); setDraft(''); }}
            className="px-3 py-2 text-sm border border-gray-200 rounded-lg text-gray-500"
            title="Cancel"
          >
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
