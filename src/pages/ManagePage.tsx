import { useState, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Trash2, ScanLine, Search, X, ChevronDown, ChevronUp, Camera, AlertTriangle, Store, CalendarDays, Flame, Leaf, Sprout, ArrowRight, Plus } from 'lucide-react';
import { Header } from '@/components/Header';
import { useCompost } from '@/contexts/CompostContext';
import { COMPOST_SYSTEMS, generateId } from '@/utils/config';
import { BinScanner, type ScanOutcome } from '@/components/BinScanner';
import { formatSerialNumber } from '@/services/ocrService';
import { PhaseModal } from '@/components/PhaseModal';
import type { BusinessInfo, ContaminationRecord, CompostSystem, BuildPhase, GrowTrial } from '@/types';

interface BinDetails {
  collectionDate: string;
  source1: string;
  source2: string;
  source3: string;
  source4: string;
  source5: string;
  serialNumber: string;
  colour: string;
  maturationDate: string;
  batchingDate: string;
  batch: string;
  notes: string;
}

function rowToBinDetails(row: string[]): BinDetails {
  return {
    collectionDate: row[0] || '',
    source1: row[1] || '',
    source2: row[2] || '',
    source3: row[3] || '',
    source4: row[4] || '',
    source5: row[5] || '',
    serialNumber: row[6] || '',
    colour: row[7] || '',
    maturationDate: row[8] || '',
    batchingDate: row[9] || '',
    batch: row[10] || '',
    notes: row[11] || '',
  };
}

function BinDetailCard({ bin, label, muted }: { bin: BinDetails; label?: string; muted?: boolean }) {
  const bg = muted ? 'bg-gray-50' : 'bg-green-50/60';
  const border = muted ? 'border-gray-200' : 'border-green-100';
  return (
    <div className={`${bg} rounded-lg border ${border} p-4 space-y-2.5`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <p className={`font-mono font-bold ${muted ? 'text-sm text-gray-500' : 'text-lg text-gray-900'}`}>
            #{bin.serialNumber}
          </p>
          {label && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">
              {label}
            </span>
          )}
        </div>
        {bin.colour && (
          <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-gray-100 text-gray-600">
            {bin.colour}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
        <div>
          <p className="text-gray-400 text-xs">Collected</p>
          <p className={muted ? 'text-gray-500' : 'text-gray-700'}>{bin.collectionDate || '—'}</p>
        </div>
        <div>
          <p className="text-gray-400 text-xs">Matured</p>
          <p className={muted ? 'text-gray-500' : 'text-gray-700'}>{bin.maturationDate || '—'}</p>
        </div>
        <div>
          <p className="text-gray-400 text-xs">Sources</p>
          <p className={muted ? 'text-gray-500' : 'text-gray-700'}>
            {[bin.source1, bin.source2, bin.source3, bin.source4, bin.source5].filter(Boolean).join(', ') || '—'}
          </p>
        </div>
        <div>
          <p className="text-gray-400 text-xs">Batch</p>
          <p className={muted ? 'text-gray-500' : 'text-gray-700'}>{bin.batch || 'Unassigned'}</p>
        </div>
        {bin.batchingDate && (
          <div>
            <p className="text-gray-400 text-xs">Batched on</p>
            <p className={muted ? 'text-gray-500' : 'text-gray-700'}>{bin.batchingDate}</p>
          </div>
        )}
        {bin.notes && (
          <div className="col-span-2">
            <p className="text-gray-400 text-xs">Notes</p>
            <p className={muted ? 'text-gray-500' : 'text-gray-700'}>{bin.notes}</p>
          </div>
        )}
      </div>
    </div>
  );
}

interface SourceListProps {
  names: string[];
  businesses: BusinessInfo[];
  expandedBiz: string | null;
  setExpandedBiz: (name: string | null) => void;
  editingBiz: string | null;
  setEditingBiz: (name: string | null) => void;
  categoryInput: 'business' | 'event';
  setCategoryInput: (cat: 'business' | 'event') => void;
  businessTypeInput: string;
  setBusinessTypeInput: (v: string) => void;
  wasteTypeInput: string;
  setWasteTypeInput: (v: string) => void;
  onSave: (name: string) => void;
  onDelete: (name: string) => void;
  emptyText: string;
}

function SourceList({
  names, businesses, expandedBiz, setExpandedBiz,
  editingBiz, setEditingBiz, categoryInput, setCategoryInput,
  businessTypeInput, setBusinessTypeInput, wasteTypeInput, setWasteTypeInput,
  onSave, onDelete, emptyText,
}: SourceListProps) {
  if (names.length === 0) {
    return <p className="text-sm text-gray-400 text-center py-3">{emptyText}</p>;
  }

  return (
    <div className="space-y-2">
      {names.map(name => {
        const biz = businesses.find(b => b.name === name);
        const contamCount = biz?.contaminations?.length || 0;
        const isExpanded = expandedBiz === name;
        const isEditing = editingBiz === name;
        const hasDetails = biz?.businessType || biz?.wasteType;

        return (
          <div key={name} className="border border-gray-100 rounded-lg overflow-hidden">
            {/* Dropdown header */}
            <button
              onClick={() => setExpandedBiz(isExpanded ? null : name)}
              className="w-full flex items-center gap-3 px-3 py-3 bg-gray-50/50 hover:bg-gray-50 transition-colors text-left"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800 truncate">{name}</p>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  {biz?.businessType && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-blue-50 text-blue-600">{biz.businessType}</span>
                  )}
                  {biz?.wasteType && (
                    <span className="text-xs text-gray-400">{biz.wasteType}</span>
                  )}
                  {!hasDetails && (
                    <span className="text-xs text-gray-300 italic">No details set</span>
                  )}
                  {contamCount > 0 && (
                    <span className="text-xs px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">
                      {contamCount} issue{contamCount !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>
              </div>
              {isExpanded ? (
                <ChevronUp size={16} className="text-gray-400 shrink-0" />
              ) : (
                <ChevronDown size={16} className="text-gray-400 shrink-0" />
              )}
            </button>

            {/* Expanded content */}
            {isExpanded && (
              <div className="px-3 py-3 space-y-3 border-t border-gray-100">
                {isEditing ? (
                  <div className="space-y-2">
                    <div>
                      <label className="text-xs font-medium text-gray-500 block mb-1">Category</label>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setCategoryInput('business')}
                          className={`flex-1 px-3 py-2 text-sm rounded-lg border ${categoryInput === 'business' ? 'bg-green-50 border-green-300 text-green-700 font-medium' : 'border-gray-200 text-gray-500'}`}
                        >
                          Business
                        </button>
                        <button
                          onClick={() => setCategoryInput('event')}
                          className={`flex-1 px-3 py-2 text-sm rounded-lg border ${categoryInput === 'event' ? 'bg-purple-50 border-purple-300 text-purple-700 font-medium' : 'border-gray-200 text-gray-500'}`}
                        >
                          Event
                        </button>
                      </div>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-500 block mb-1">
                        {categoryInput === 'event' ? 'Event type' : 'Business type'}
                      </label>
                      <select
                        value={businessTypeInput}
                        onChange={e => setBusinessTypeInput(e.target.value)}
                        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-green-primary"
                      >
                        <option value="">Select type...</option>
                        {categoryInput === 'business' ? (
                          <>
                            <option value="Cafe">Cafe</option>
                            <option value="Restaurant">Restaurant</option>
                            <option value="Hotel">Hotel</option>
                            <option value="Office">Office</option>
                            <option value="School">School</option>
                            <option value="Supermarket">Supermarket</option>
                            <option value="Bakery">Bakery</option>
                            <option value="Bar / Pub">Bar / Pub</option>
                            <option value="Takeaway">Takeaway</option>
                            <option value="Residential">Residential</option>
                            <option value="Farm">Farm</option>
                            <option value="Community Garden">Community Garden</option>
                            <option value="Other">Other</option>
                          </>
                        ) : (
                          <>
                            <option value="Market">Market</option>
                            <option value="Festival">Festival</option>
                            <option value="Sports Event">Sports Event</option>
                            <option value="Community Event">Community Event</option>
                            <option value="School Event">School Event</option>
                            <option value="Corporate Event">Corporate Event</option>
                            <option value="Other">Other</option>
                          </>
                        )}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-500 block mb-1">Waste produced</label>
                      <input
                        type="text"
                        value={wasteTypeInput}
                        onChange={e => setWasteTypeInput(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && onSave(name)}
                        placeholder="e.g. Coffee grounds, food scraps, cardboard"
                        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-green-primary"
                      />
                    </div>
                    <div className="flex gap-2 pt-1">
                      <button
                        onClick={() => onSave(name)}
                        className="flex-1 px-3 py-2 text-sm bg-green-primary text-white rounded-lg font-medium"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => { setEditingBiz(null); setBusinessTypeInput(''); setWasteTypeInput(''); }}
                        className="px-3 py-2 text-sm text-gray-400 border border-gray-200 rounded-lg"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-gray-400">Type:</span>
                          {biz?.businessType ? (
                            <span className="text-sm text-gray-700">{biz.businessType}</span>
                          ) : (
                            <span className="text-xs text-gray-300 italic">Not set</span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-gray-400">Waste:</span>
                          {biz?.wasteType ? (
                            <span className="text-sm text-gray-700">{biz.wasteType}</span>
                          ) : (
                            <span className="text-xs text-gray-300 italic">Not set</span>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-1.5 shrink-0">
                        <button
                          onClick={() => {
                            setEditingBiz(name);
                            setCategoryInput(biz?.category || 'business');
                            setBusinessTypeInput(biz?.businessType || '');
                            setWasteTypeInput(biz?.wasteType || '');
                          }}
                          className="text-xs px-2.5 py-1 rounded-full border border-gray-200 text-gray-500 hover:border-green-300 hover:text-green-700 transition-colors"
                        >
                          {hasDetails ? 'Edit' : 'Add details'}
                        </button>
                        <button
                          onClick={() => onDelete(name)}
                          className="text-xs px-2 py-1 rounded-full border border-gray-200 text-gray-400 hover:border-red-300 hover:text-red-500 transition-colors"
                          title="Remove from list"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Contamination records */}
                {contamCount > 0 && (
                  <div className="space-y-2 pt-1 border-t border-gray-50">
                    <p className="text-xs font-medium text-gray-500">Contamination records</p>
                    {biz!.contaminations.map(record => (
                      <div key={record.id} className="bg-amber-50/50 rounded-lg border border-amber-100 p-3">
                        <div className="flex justify-between text-xs">
                          <span className="text-gray-600">
                            Bin <span className="font-mono font-bold">#{record.binSerial}</span>
                          </span>
                          <span className="text-gray-400">
                            {record.collectionDate || new Date(record.reportedAt).toLocaleDateString('en-NZ')}
                          </span>
                        </div>
                        {record.photoBase64 && (
                          <img
                            src={record.photoBase64}
                            alt="Evidence"
                            className="mt-2 w-full rounded max-h-32 object-cover"
                          />
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {contamCount === 0 && (
                  <p className="text-xs text-gray-300 italic pt-1 border-t border-gray-50">No contamination records</p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function ManagePage() {
  const navigate = useNavigate();
  const { allSystems, settings, setSystemPhase, removeCustomSystem, addToast, businesses, saveBusiness } = useCompost();

  // Phase transition modal
  const [phaseModal, setPhaseModal] = useState<{ system: CompostSystem; mode: 'toMaturation' | 'toGrow' | 'addTrial' } | null>(null);

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Bin lookup state
  const [showScanner, setShowScanner] = useState(false);
  const [manualSerial, setManualSerial] = useState('');
  const [lookupResult, setLookupResult] = useState<BinDetails | null>(null);
  const [lookupHistory, setLookupHistory] = useState<BinDetails[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [lookupNotFound, setLookupNotFound] = useState<string | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [binTrackerData, setBinTrackerData] = useState<string[][] | null>(null);

  // Fetch Bin Tracker data (cached for the session)
  const fetchBinTracker = useCallback(async (): Promise<string[][]> => {
    if (binTrackerData) return binTrackerData;
    const res = await fetch('/.netlify/functions/compost-sheets-read?tab=Bin%20Tracker');
    const json = await res.json();
    const rows: string[][] = json.data || [];
    setBinTrackerData(rows);
    return rows;
  }, [binTrackerData]);

  // Look up a bin by serial number — find all matches, show most recent first
  const lookupBin = useCallback(async (serial: string) => {
    const formatted = formatSerialNumber(serial);
    if (!formatted || formatted.length < 2) return;

    setLookupLoading(true);
    setLookupResult(null);
    setLookupHistory([]);
    setShowHistory(false);
    setLookupNotFound(null);

    try {
      const rows = await fetchBinTracker();
      // Find ALL matching rows (skip header), keep order from sheet (oldest first)
      const matches = rows.slice(1).filter(row =>
        formatSerialNumber(row[6] || '') === formatted
      );

      if (matches.length > 0) {
        // Most recent = last match in the sheet
        setLookupResult(rowToBinDetails(matches[matches.length - 1]));
        // Previous cycles = everything except the last, in reverse chronological order
        if (matches.length > 1) {
          setLookupHistory(
            matches.slice(0, -1).reverse().map(rowToBinDetails)
          );
        }
      } else {
        setLookupNotFound(formatted);
      }
    } catch {
      addToast('error', 'Failed to fetch bin data');
    } finally {
      setLookupLoading(false);
    }
  }, [fetchBinTracker, addToast]);

  // Scanner callback — look up the scanned serial
  const handleScanSerial = useCallback((serial: string): Exclude<ScanOutcome, 'no_text'> => {
    lookupBin(serial);

    if (binTrackerData) {
      const formatted = formatSerialNumber(serial);
      const found = binTrackerData.slice(1).some(row =>
        formatSerialNumber(row[6] || '') === formatted
      );
      return found ? 'selected' : 'not_found';
    }
    return 'selected';
  }, [lookupBin, binTrackerData]);

  const handleManualSearch = () => {
    if (manualSerial.trim()) {
      lookupBin(manualSerial.trim());
    }
  };

  const clearLookup = () => {
    setLookupResult(null);
    setLookupHistory([]);
    setShowHistory(false);
    setLookupNotFound(null);
    setManualSerial('');
  };

  // Business observations state
  const [showContamScanner, setShowContamScanner] = useState(false);
  const [contamSerial, setContamSerial] = useState<string | null>(null);
  const [contamSources, setContamSources] = useState<string[]>([]);
  const [contamPickBiz, setContamPickBiz] = useState<string | null>(null);
  const [contamPhoto, setContamPhoto] = useState<string | null>(null);
  const [contamCollectionDate, setContamCollectionDate] = useState<string>('');
  const [showBusinessList, setShowBusinessList] = useState(false);
  const [showEventList, setShowEventList] = useState(false);
  const [editingBiz, setEditingBiz] = useState<string | null>(null);
  const [categoryInput, setCategoryInput] = useState<'business' | 'event'>('business');
  const [businessTypeInput, setBusinessTypeInput] = useState('');
  const [wasteTypeInput, setWasteTypeInput] = useState('');
  const [expandedBiz, setExpandedBiz] = useState<string | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

  // When a bin is scanned for contamination, find its sources from the Bin Tracker
  const handleContamScan = useCallback(async (serial: string): Promise<Exclude<ScanOutcome, 'no_text'>> => {
    const formatted = formatSerialNumber(serial);
    if (!formatted) return 'not_found';

    setContamSerial(formatted);
    setContamPickBiz(null);
    setContamPhoto(null);

    try {
      const rows = await fetchBinTracker();
      // Find all rows matching this serial
      const matches = rows.slice(1).filter(row =>
        formatSerialNumber(row[6] || '') === formatted
      );

      if (matches.length === 0) {
        setContamSources([]);
        return 'not_found';
      }

      // Get the most recent row's sources
      const latest = matches[matches.length - 1];
      const sources = [latest[1], latest[2], latest[3], latest[4], latest[5]].filter(Boolean);
      setContamSources(sources);
      // Get collection date from the most recent row
      setContamCollectionDate(latest[0] || '');
      return 'selected';
    } catch {
      setContamSources([]);
      return 'not_found';
    }
  }, [fetchBinTracker]);

  const handleSaveContamination = useCallback(async () => {
    if (!contamPickBiz || !contamSerial) return;

    const record: ContaminationRecord = {
      id: generateId(),
      businessName: contamPickBiz,
      binSerial: contamSerial,
      collectionDate: contamCollectionDate,
      photoBase64: contamPhoto,
      reportedAt: new Date().toISOString(),
    };

    // Find or create the business
    const existing = businesses.find(b => b.name === contamPickBiz);
    const updated: BusinessInfo = existing
      ? { ...existing, contaminations: [...existing.contaminations, record] }
      : { name: contamPickBiz, category: 'business', businessType: '', wasteType: '', contaminations: [record] };

    await saveBusiness(updated);
    addToast('success', `Contamination recorded for ${contamPickBiz}`);

    // Reset
    setContamSerial(null);
    setContamSources([]);
    setContamPickBiz(null);
    setContamPhoto(null);
    setContamCollectionDate('');
    setShowContamScanner(false);
  }, [contamPickBiz, contamSerial, contamCollectionDate, contamPhoto, businesses, saveBusiness, addToast]);

  const handlePhotoCapture = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setContamPhoto(reader.result as string);
    };
    reader.readAsDataURL(file);
  }, []);

  const handleSaveBusinessDetails = useCallback(async (bizName: string) => {
    const existing = businesses.find(b => b.name === bizName);
    const updated: BusinessInfo = existing
      ? { ...existing, category: categoryInput, businessType: businessTypeInput.trim(), wasteType: wasteTypeInput.trim() }
      : { name: bizName, category: categoryInput, businessType: businessTypeInput.trim(), wasteType: wasteTypeInput.trim(), contaminations: [] };
    await saveBusiness(updated);
    setEditingBiz(null);
    setCategoryInput('business');
    setBusinessTypeInput('');
    setWasteTypeInput('');
    addToast('success', `Details updated for ${bizName}`);
  }, [businesses, categoryInput, businessTypeInput, wasteTypeInput, saveBusiness, addToast]);

  const handleDeleteBiz = useCallback(async (bizName: string) => {
    // Save as hidden so it doesn't reappear from Bin Tracker
    const existing = businesses.find(b => b.name === bizName);
    const hidden: BusinessInfo = existing
      ? { ...existing, hidden: true }
      : { name: bizName, category: 'business', businessType: '', wasteType: '', hidden: true, contaminations: [] };
    await saveBusiness(hidden);
    setExpandedBiz(null);
    addToast('success', `${bizName} removed from list`);
  }, [businesses, saveBusiness, addToast]);

  const activeSystems = allSystems.filter(s => settings.activeSystems.includes(s.id));

  const getPhase = (s: CompostSystem): BuildPhase => s.phase || 'thermophilic';
  const thermoBuilds = activeSystems.filter(s => getPhase(s) === 'thermophilic');
  const maturationBuilds = activeSystems.filter(s => getPhase(s) === 'maturation');
  const growBuilds = activeSystems.filter(s => getPhase(s) === 'grow');

  const handleRemoveTrial = async (system: CompostSystem, trialId: string) => {
    if (!system.grow) return;
    const next = { ...system.grow, trials: system.grow.trials.filter(t => t.id !== trialId) };
    await setSystemPhase(system.id, 'grow', { grow: next });
  };

  // Collect unique source names, split into businesses vs events, exclude hidden
  const hiddenNames = useMemo(() => new Set(businesses.filter(b => b.hidden).map(b => b.name)), [businesses]);

  const allBusinessNames = useMemo(() => {
    const names = new Set<string>();
    businesses.filter(b => !b.hidden).forEach(b => names.add(b.name));
    if (binTrackerData) {
      binTrackerData.slice(1).forEach(row => {
        [row[1], row[2], row[3], row[4], row[5]].filter(Boolean).forEach(s => {
          if (!hiddenNames.has(s)) names.add(s);
        });
      });
    }
    return Array.from(names).sort();
  }, [businesses, binTrackerData, hiddenNames]);

  const businessNames = useMemo(() =>
    allBusinessNames.filter(name => {
      const biz = businesses.find(b => b.name === name);
      return !biz?.category || biz.category === 'business';
    }),
  [allBusinessNames, businesses]);

  const eventNames = useMemo(() =>
    allBusinessNames.filter(name => {
      const biz = businesses.find(b => b.name === name);
      return biz?.category === 'event';
    }),
  [allBusinessNames, businesses]);

  function isCustom(id: string) {
    return !COMPOST_SYSTEMS.some(s => s.id === id);
  }

  async function handleDelete(id: string, name: string) {
    setDeletingId(id);
    try {
      const res = await fetch('/.netlify/functions/compost-build-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ buildName: name }),
      });
      const data = await res.json();
      await removeCustomSystem(id);
      setConfirmDeleteId(null);
      if (data.success) {
        const parts = [`"${name}" deleted`];
        if (data.tabDeleted) parts.push('tab removed');
        if (data.binsCleared > 0) parts.push(`${data.binsCleared} bin${data.binsCleared === 1 ? '' : 's'} cleared`);
        addToast('success', parts.join(' · '));
      } else {
        addToast('success', `"${name}" removed locally`);
      }
    } catch {
      await removeCustomSystem(id);
      setConfirmDeleteId(null);
      addToast('success', `"${name}" removed locally`);
    } finally {
      setDeletingId(null);
    }
  }

  function DeleteButton({ id, name }: { id: string; name: string }) {
    if (!isCustom(id)) return null;
    if (deletingId === id) {
      return (
        <span className="text-xs px-2.5 py-1 rounded-full text-gray-400 animate-pulse">
          Deleting…
        </span>
      );
    }
    if (confirmDeleteId === id) {
      return (
        <button
          onClick={() => handleDelete(id, name)}
          className="text-xs px-2.5 py-1 rounded-full font-medium bg-red-100 text-red-600"
        >
          Confirm?
        </button>
      );
    }
    return (
      <button
        onClick={() => setConfirmDeleteId(id)}
        className="p-1 text-gray-300 hover:text-red-400 transition-colors"
        title="Delete build"
      >
        <Trash2 size={16} />
      </button>
    );
  }

  return (
    <div className="min-h-screen bg-green-50/50 pb-8">
      <Header title="Let's Manage" showBack onBack={() => navigate('/')} />

      <div className="p-4 space-y-4">

        {/* ── Bin Lookup ──────────────────────────────────────────────── */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">Bin Lookup</h2>
            <p className="text-xs text-gray-400 mt-0.5">Scan or search a bin by serial number</p>
          </div>

          <div className="p-4 space-y-3">
            {/* Search input row */}
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <input
                  type="text"
                  value={manualSerial}
                  onChange={e => setManualSerial(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleManualSearch()}
                  placeholder="Enter bin number…"
                  className="w-full px-3 py-2.5 pr-9 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-primary/30 focus:border-green-primary"
                />
                {(manualSerial || lookupResult || lookupNotFound) && (
                  <button
                    onClick={clearLookup}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-300 hover:text-gray-500"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
              <button
                onClick={handleManualSearch}
                disabled={!manualSerial.trim() || lookupLoading}
                className="px-3 py-2.5 bg-green-primary text-white rounded-lg disabled:opacity-40"
                title="Search"
              >
                <Search size={18} />
              </button>
              <button
                onClick={() => setShowScanner(true)}
                className="px-3 py-2.5 bg-gray-800 text-white rounded-lg"
                title="Scan bin label"
              >
                <ScanLine size={18} />
              </button>
            </div>

            {/* Scanner */}
            {showScanner && (
              <BinScanner
                onScanSerial={handleScanSerial}
                onClose={() => setShowScanner(false)}
                onResultDone={() => setShowScanner(false)}
                outcomeLabels={{ selected: 'Bin found!', not_found: 'Bin not found' }}
              />
            )}

            {/* Loading */}
            {lookupLoading && (
              <p className="text-sm text-gray-400 text-center py-3">Looking up bin…</p>
            )}

            {/* Not found */}
            {lookupNotFound && !lookupLoading && (
              <div className="text-center py-4">
                <p className="text-sm text-gray-500">No bin found matching <span className="font-mono font-bold">#{lookupNotFound}</span></p>
              </div>
            )}

            {/* Result card */}
            {lookupResult && !lookupLoading && (
              <div className="space-y-2">
                <BinDetailCard bin={lookupResult} label={lookupHistory.length > 0 ? 'Most recent' : undefined} />

                {/* Previous cycles */}
                {lookupHistory.length > 0 && (
                  <div>
                    <button
                      onClick={() => setShowHistory(h => !h)}
                      className="flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-700 px-1 py-1"
                    >
                      {showHistory ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      Previous cycles ({lookupHistory.length})
                    </button>

                    {showHistory && (
                      <div className="space-y-2 mt-1">
                        {lookupHistory.map((bin, i) => (
                          <BinDetailCard key={i} bin={bin} muted />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Business Observations ─────────────────────────────────── */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <Store size={16} className="text-green-primary" />
              <h2 className="font-semibold text-gray-900">Business Observations</h2>
            </div>
            <p className="text-xs text-gray-400 mt-0.5">Track waste types and contamination by business</p>
          </div>

          <div className="p-4 space-y-3">
            {/* Contamination scanner */}
            <button
              onClick={() => { setShowContamScanner(true); fetchBinTracker(); }}
              className="w-full flex items-center gap-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg text-left active:scale-[0.98] transition-transform"
            >
              <AlertTriangle size={18} className="text-amber-600 shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium text-amber-800">Report Contamination</p>
                <p className="text-xs text-amber-600/70">Scan a contaminated bin to log it</p>
              </div>
              <ScanLine size={18} className="text-amber-400 shrink-0" />
            </button>

            {/* Contamination scanner + attribution flow */}
            {showContamScanner && !contamSerial && (
              <div className="space-y-2">
                <BinScanner
                  onScanSerial={(serial) => {
                    handleContamScan(serial);
                    return 'selected';
                  }}
                  onClose={() => setShowContamScanner(false)}
                  onResultDone={() => {}}
                  outcomeLabels={{ selected: 'Bin found!', not_found: 'Bin not found' }}
                />
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Or enter bin number…"
                    className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-300 focus:border-amber-400"
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        const val = (e.target as HTMLInputElement).value.trim();
                        if (val) handleContamScan(val);
                      }
                    }}
                  />
                </div>
              </div>
            )}

            {/* Source attribution step */}
            {contamSerial && !contamPickBiz && (
              <div className="bg-amber-50 rounded-lg border border-amber-200 p-4 space-y-3">
                <p className="text-sm font-medium text-gray-800">
                  Bin <span className="font-mono font-bold">#{contamSerial}</span>
                  {contamCollectionDate && <span className="text-gray-500"> · collected {contamCollectionDate}</span>}
                </p>
                <p className="text-sm text-gray-600">Which business do you think caused the contamination?</p>
                <div className="space-y-1.5">
                  {contamSources.length > 0 ? (
                    contamSources.map(source => (
                      <button
                        key={source}
                        onClick={() => setContamPickBiz(source)}
                        className="w-full text-left px-3 py-2.5 text-sm bg-white border border-gray-200 rounded-lg hover:border-amber-400 hover:bg-amber-50 transition-colors"
                      >
                        {source}
                      </button>
                    ))
                  ) : (
                    <p className="text-xs text-gray-400">No sources found for this bin</p>
                  )}
                </div>
                <button
                  onClick={() => { setContamSerial(null); setContamSources([]); setShowContamScanner(false); }}
                  className="text-xs text-gray-400 hover:text-gray-600"
                >
                  Cancel
                </button>
              </div>
            )}

            {/* Photo + confirm step */}
            {contamPickBiz && (
              <div className="bg-amber-50 rounded-lg border border-amber-200 p-4 space-y-3">
                <p className="text-sm text-gray-800">
                  Logging contamination from <span className="font-semibold">{contamPickBiz}</span> in bin <span className="font-mono font-bold">#{contamSerial}</span>
                </p>

                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={handlePhotoCapture}
                />

                {contamPhoto ? (
                  <div className="relative">
                    <img src={contamPhoto} alt="Evidence" className="w-full rounded-lg max-h-48 object-cover" />
                    <button
                      onClick={() => setContamPhoto(null)}
                      className="absolute top-2 right-2 bg-black/50 text-white rounded-full p-1"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => photoInputRef.current?.click()}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-white border border-dashed border-gray-300 rounded-lg text-sm text-gray-500 hover:border-amber-400 hover:text-amber-600 transition-colors"
                  >
                    <Camera size={16} />
                    Take photo for evidence
                  </button>
                )}

                <div className="flex gap-2">
                  <button
                    onClick={() => { setContamPickBiz(null); setContamPhoto(null); }}
                    className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg text-gray-500"
                  >
                    Back
                  </button>
                  <button
                    onClick={handleSaveContamination}
                    className="flex-1 px-3 py-2 text-sm bg-amber-600 text-white rounded-lg font-medium"
                  >
                    Save Record
                  </button>
                </div>
              </div>
            )}

            {/* Participating Businesses toggle */}
            <button
              onClick={() => { setShowBusinessList(!showBusinessList); if (!binTrackerData) fetchBinTracker(); }}
              className="w-full flex items-center justify-between px-4 py-3 bg-green-50 border border-green-200 rounded-lg text-left active:scale-[0.98] transition-transform"
            >
              <div className="flex items-center gap-2">
                <Store size={16} className="text-green-700" />
                <span className="text-sm font-medium text-green-800">
                  Participating Businesses
                  {businessNames.length > 0 && (
                    <span className="ml-1.5 text-xs font-normal text-green-600">({businessNames.length})</span>
                  )}
                </span>
              </div>
              {showBusinessList ? (
                <ChevronUp size={16} className="text-green-500" />
              ) : (
                <ChevronDown size={16} className="text-green-500" />
              )}
            </button>

            {showBusinessList && (
              <SourceList
                names={businessNames}
                businesses={businesses}
                expandedBiz={expandedBiz}
                setExpandedBiz={setExpandedBiz}
                editingBiz={editingBiz}
                setEditingBiz={setEditingBiz}
                categoryInput={categoryInput}
                setCategoryInput={setCategoryInput}
                businessTypeInput={businessTypeInput}
                setBusinessTypeInput={setBusinessTypeInput}
                wasteTypeInput={wasteTypeInput}
                setWasteTypeInput={setWasteTypeInput}
                onSave={handleSaveBusinessDetails}
                onDelete={handleDeleteBiz}
                emptyText="Loading businesses…"
              />
            )}

            {/* Participating Events toggle */}
            <button
              onClick={() => { setShowEventList(!showEventList); if (!binTrackerData) fetchBinTracker(); }}
              className="w-full flex items-center justify-between px-4 py-3 bg-purple-50 border border-purple-200 rounded-lg text-left active:scale-[0.98] transition-transform"
            >
              <div className="flex items-center gap-2">
                <CalendarDays size={16} className="text-purple-700" />
                <span className="text-sm font-medium text-purple-800">
                  Participating Events
                  {eventNames.length > 0 && (
                    <span className="ml-1.5 text-xs font-normal text-purple-600">({eventNames.length})</span>
                  )}
                </span>
              </div>
              {showEventList ? (
                <ChevronUp size={16} className="text-purple-500" />
              ) : (
                <ChevronDown size={16} className="text-purple-500" />
              )}
            </button>

            {showEventList && (
              <SourceList
                names={eventNames}
                businesses={businesses}
                expandedBiz={expandedBiz}
                setExpandedBiz={setExpandedBiz}
                editingBiz={editingBiz}
                setEditingBiz={setEditingBiz}
                categoryInput={categoryInput}
                setCategoryInput={setCategoryInput}
                businessTypeInput={businessTypeInput}
                setBusinessTypeInput={setBusinessTypeInput}
                wasteTypeInput={wasteTypeInput}
                setWasteTypeInput={setWasteTypeInput}
                onSave={handleSaveBusinessDetails}
                onDelete={handleDeleteBiz}
                emptyText="No events yet — edit a source and change its category to Event."
              />
            )}
          </div>
        </div>

        {/* ── Thermophilic builds ─────────────────────────────────────── */}
        <PhaseSection
          title="Thermophilic"
          description="Active heating — daily probe readings"
          accent="green"
          icon={<Flame size={16} className="text-green-700" />}
          systems={thermoBuilds}
          onNavigate={id => navigate(`/manage/${id}`)}
          renderAction={system => (
            <button
              onClick={e => { e.stopPropagation(); setPhaseModal({ system, mode: 'toMaturation' }); }}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-amber-50 border border-amber-200 text-amber-700 font-medium hover:bg-amber-100 transition-colors"
            >
              <ArrowRight size={12} />
              Move to Maturation
            </button>
          )}
          DeleteButton={DeleteButton}
        />

        {/* ── Maturation builds ───────────────────────────────────────── */}
        <PhaseSection
          title="Maturation"
          description="Resting — still records readings, shown in amber"
          accent="amber"
          icon={<Leaf size={16} className="text-amber-700" />}
          systems={maturationBuilds}
          onNavigate={id => navigate(`/manage/${id}`)}
          renderMeta={system => system.maturation && (
            <p className="text-xs text-gray-500 mt-0.5 truncate">
              {system.maturation.containerType} · {system.maturation.placement} · {system.maturation.coverType}
              {system.maturation.startedAt && ` · since ${system.maturation.startedAt}`}
            </p>
          )}
          renderAction={system => (
            <button
              onClick={e => { e.stopPropagation(); setPhaseModal({ system, mode: 'toGrow' }); }}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-purple-50 border border-purple-200 text-purple-700 font-medium hover:bg-purple-100 transition-colors"
            >
              <ArrowRight size={12} />
              Move to Grow
            </button>
          )}
          DeleteButton={DeleteButton}
        />

        {/* ── Grow builds ─────────────────────────────────────────────── */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
            <Sprout size={16} className="text-purple-700" />
            <div className="flex-1">
              <h2 className="font-semibold text-gray-900">Grow</h2>
              <p className="text-xs text-gray-400 mt-0.5">Field trials — no longer in Measure</p>
            </div>
          </div>
          {growBuilds.length === 0 ? (
            <p className="px-4 py-6 text-sm text-gray-400 text-center">No builds in grow phase</p>
          ) : (
            <div className="divide-y divide-gray-50">
              {growBuilds.map(system => {
                const trials = system.grow?.trials || [];
                return (
                  <div key={system.id} className="px-4 py-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800 truncate">{system.name}</p>
                        {system.grow?.startedAt && (
                          <p className="text-xs text-gray-400 mt-0.5">Grow phase since {system.grow.startedAt}</p>
                        )}
                      </div>
                      <button
                        onClick={() => setPhaseModal({ system, mode: 'addTrial' })}
                        className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-purple-600 text-white font-medium hover:bg-purple-700 transition-colors"
                      >
                        <Plus size={12} />
                        Trial
                      </button>
                      <DeleteButton id={system.id} name={system.name} />
                    </div>

                    {trials.length > 0 && (
                      <div className="space-y-1.5 pl-2">
                        {trials.map((t: GrowTrial) => (
                          <div
                            key={t.id}
                            className="flex items-center gap-2 px-3 py-2 bg-purple-50/60 border border-purple-100 rounded-lg"
                          >
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium text-purple-900">
                                {t.method} · {t.crop}
                              </p>
                              {t.notes && (
                                <p className="text-xs text-gray-500 mt-0.5 truncate">{t.notes}</p>
                              )}
                            </div>
                            <button
                              onClick={() => handleRemoveTrial(system, t.id)}
                              className="p-1 text-gray-300 hover:text-red-400 transition-colors"
                              title="Remove trial"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    {trials.length === 0 && (
                      <p className="text-xs text-gray-400 italic pl-2">No trials yet — tap + Trial to add one</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

      </div>

      {phaseModal && (
        <PhaseModal
          system={phaseModal.system}
          mode={phaseModal.mode}
          onClose={() => setPhaseModal(null)}
        />
      )}
    </div>
  );
}

type Accent = 'green' | 'amber';

interface PhaseSectionProps {
  title: string;
  description: string;
  accent: Accent;
  icon: React.ReactNode;
  systems: CompostSystem[];
  onNavigate: (id: string) => void;
  renderAction: (system: CompostSystem) => React.ReactNode;
  renderMeta?: (system: CompostSystem) => React.ReactNode;
  DeleteButton: React.ComponentType<{ id: string; name: string }>;
}

function PhaseSection({ title, description, icon, systems, onNavigate, renderAction, renderMeta, DeleteButton }: PhaseSectionProps) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
        {icon}
        <div className="flex-1">
          <h2 className="font-semibold text-gray-900">{title}</h2>
          <p className="text-xs text-gray-400 mt-0.5">{description}</p>
        </div>
      </div>

      {systems.length === 0 ? (
        <p className="px-4 py-6 text-sm text-gray-400 text-center">None</p>
      ) : (
        <div className="divide-y divide-gray-50">
          {systems.map(system => (
            <div
              key={system.id}
              role="button"
              tabIndex={0}
              onClick={() => onNavigate(system.id)}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onNavigate(system.id);
                }
              }}
              className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 active:bg-gray-100 transition-colors"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800 truncate">{system.name}</p>
                {renderMeta ? renderMeta(system) : <p className="text-xs text-gray-400 mt-0.5">Tap to view bins</p>}
              </div>
              <div className="flex items-center gap-2 shrink-0" onClick={e => e.stopPropagation()}>
                {renderAction(system)}
                <DeleteButton id={system.id} name={system.name} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
