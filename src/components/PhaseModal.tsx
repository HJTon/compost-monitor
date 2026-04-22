import { useState } from 'react';
import { X } from 'lucide-react';
import { EditableSelect } from './EditableSelect';
import { useCompost } from '@/contexts/CompostContext';
import {
  DEFAULT_CONTAINER_TYPES,
  DEFAULT_PLACEMENTS,
  DEFAULT_COVER_TYPES,
  DEFAULT_TRIAL_METHODS,
  DEFAULT_TRIAL_CROPS,
  getNZDate,
  generateId,
} from '@/utils/config';
import type { CompostSystem, MaturationInfo, GrowTrial } from '@/types';

interface Props {
  system: CompostSystem;
  mode: 'toMaturation' | 'toGrow' | 'addTrial';
  onClose: () => void;
}

export function PhaseModal({ system, mode, onClose }: Props) {
  const { settings, updateSettings, setSystemPhase, addToast } = useCompost();

  // Maturation state
  const [containerType, setContainerType] = useState(system.maturation?.containerType || '');
  const [placement, setPlacement] = useState(system.maturation?.placement || '');
  const [coverType, setCoverType] = useState(system.maturation?.coverType || '');

  // Shared date (auto-filled to today, editable — lets us back-date transitions)
  const [date, setDate] = useState(getNZDate());

  // Trial state
  const [method, setMethod] = useState('');
  const [crop, setCrop] = useState('');
  const [notes, setNotes] = useState('');

  const [saving, setSaving] = useState(false);

  const containerOptions = [...DEFAULT_CONTAINER_TYPES, ...(settings.customContainerTypes || [])];
  const placementOptions = [...DEFAULT_PLACEMENTS, ...(settings.customPlacements || [])];
  const coverOptions = [...DEFAULT_COVER_TYPES, ...(settings.customCoverTypes || [])];
  const methodOptions = [...DEFAULT_TRIAL_METHODS, ...(settings.customTrialMethods || [])];
  const cropOptions = [...DEFAULT_TRIAL_CROPS, ...(settings.customTrialCrops || [])];

  const addCustom = (key: keyof typeof settings, value: string) =>
    updateSettings({ [key]: [...((settings[key] as string[] | undefined) || []), value] });

  const handleSaveMaturation = async () => {
    if (!containerType || !placement || !coverType) {
      addToast('error', 'Please fill in all three dropdowns');
      return;
    }
    setSaving(true);
    const info: MaturationInfo = {
      containerType,
      placement,
      coverType,
      startedAt: date,
    };
    await setSystemPhase(system.id, 'maturation', {
      maturation: info,
      transitionNote: `→ Maturation (${date}): ${containerType} · ${placement} · ${coverType}`,
    });
    addToast('success', `${system.name} moved to Maturation`);
    onClose();
  };

  const handleMoveToGrow = async () => {
    setSaving(true);
    await setSystemPhase(system.id, 'grow', {
      grow: system.grow || { startedAt: date, trials: [] },
      transitionNote: `→ Grow phase started (${date})`,
    });
    addToast('success', `${system.name} moved to Grow phase`);
    onClose();
  };

  const handleAddTrial = async () => {
    if (!method || !crop) {
      addToast('error', 'Pick a method and a crop');
      return;
    }
    setSaving(true);
    const trial: GrowTrial = {
      id: generateId(),
      method,
      crop,
      notes: notes.trim() || undefined,
      createdAt: `${date}T00:00:00`,
    };
    const current = system.grow || { startedAt: date, trials: [] };
    const next = { ...current, trials: [...current.trials, trial] };
    await setSystemPhase(system.id, 'grow', {
      grow: next,
      transitionNote: `+ Trial (${date}): ${method} · ${crop}`,
    });
    addToast('success', 'Trial added');
    onClose();
  };

  const title =
    mode === 'toMaturation' ? `Move ${system.name} to Maturation` :
    mode === 'toGrow' ? `Move ${system.name} to Grow phase` :
    `Add trial to ${system.name}`;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 sticky top-0 bg-white">
          <h2 className="font-semibold text-gray-900">{title}</h2>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600">
            <X size={18} />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <div>
            <label className="text-xs font-medium text-gray-500 block mb-1">
              {mode === 'addTrial' ? 'Trial date' : 'Transition date'}
            </label>
            <input
              type="date"
              value={date}
              max={getNZDate()}
              onChange={e => setDate(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-green-primary"
            />
            <p className="text-xs text-gray-400 mt-1">Defaults to today — change it if you're recording this after the fact.</p>
          </div>

          {mode === 'toMaturation' && (
            <>
              <p className="text-sm text-gray-600">
                Capture how the pile is set up for maturation. You can add new options to any dropdown with the + button.
              </p>
              <EditableSelect
                label="Container"
                value={containerType}
                options={containerOptions}
                onChange={setContainerType}
                onAddOption={v => addCustom('customContainerTypes', v)}
              />
              <EditableSelect
                label="Placement"
                value={placement}
                options={placementOptions}
                onChange={setPlacement}
                onAddOption={v => addCustom('customPlacements', v)}
              />
              <EditableSelect
                label="Cover"
                value={coverType}
                options={coverOptions}
                onChange={setCoverType}
                onAddOption={v => addCustom('customCoverTypes', v)}
              />
              <div className="pt-2 flex gap-2">
                <button
                  onClick={onClose}
                  className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg text-gray-600"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveMaturation}
                  disabled={saving}
                  className="flex-1 px-3 py-2 text-sm bg-amber-600 text-white rounded-lg font-medium disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Move to Maturation'}
                </button>
              </div>
            </>
          )}

          {mode === 'toGrow' && (
            <>
              <p className="text-sm text-gray-600">
                The Grow phase is where you test how the compost performs. Once moved, you can set up multiple trials on this build.
              </p>
              <div className="pt-2 flex gap-2">
                <button
                  onClick={onClose}
                  className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg text-gray-600"
                >
                  Cancel
                </button>
                <button
                  onClick={handleMoveToGrow}
                  disabled={saving}
                  className="flex-1 px-3 py-2 text-sm bg-purple-600 text-white rounded-lg font-medium disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Move to Grow phase'}
                </button>
              </div>
            </>
          )}

          {mode === 'addTrial' && (
            <>
              <EditableSelect
                label="Method"
                value={method}
                options={methodOptions}
                onChange={setMethod}
                onAddOption={v => addCustom('customTrialMethods', v)}
              />
              <EditableSelect
                label="Crop"
                value={crop}
                options={cropOptions}
                onChange={setCrop}
                onAddOption={v => addCustom('customTrialCrops', v)}
              />
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">Notes (optional)</label>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  rows={2}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-green-primary"
                  placeholder="e.g. South bed, row 2"
                />
              </div>
              <div className="pt-2 flex gap-2">
                <button
                  onClick={onClose}
                  className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg text-gray-600"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddTrial}
                  disabled={saving}
                  className="flex-1 px-3 py-2 text-sm bg-purple-600 text-white rounded-lg font-medium disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Add trial'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
