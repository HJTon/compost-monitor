import { createContext, useContext, useState, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import type { DailyEntry, AppSettings, CompostSystem, BusinessInfo } from '@/types';
import type { ToastMessage as ToastMsg } from '@/components/Toast';
import {
  getAllEntries,
  getEntriesByDate,
  getEntriesBySystem,
  getEntryBySystemDate,
  saveEntry as dbSaveEntry,
  getSettings,
  saveSettings as dbSaveSettings,
  clearSyncQueue,
  getAllCustomSystems,
  saveCustomSystem,
  deleteCustomSystem,
  getAllBusinesses,
  saveBusiness as dbSaveBusiness,
  deleteBusiness as dbDeleteBusiness,
} from '@/services/db';
import { processSyncQueue, getPendingCount, queueEntrySync } from '@/services/syncService';
import { DEFAULT_SETTINGS, generateId, getNZDate, getNZTime, COMPOST_SYSTEMS } from '@/utils/config';

interface CompostContextType {
  entries: DailyEntry[];
  settings: AppSettings;
  isOnline: boolean;
  isSyncing: boolean;
  pendingCount: number;
  toasts: ToastMsg[];

  // Systems
  allSystems: CompostSystem[];
  getSystem: (id: string) => CompostSystem | undefined;
  addCustomSystem: (system: CompostSystem) => Promise<void>;
  updateCustomSystem: (system: CompostSystem) => Promise<void>;
  removeCustomSystem: (id: string) => Promise<void>;
  setSystemActive: (id: string, active: boolean) => Promise<void>;

  // Entry operations
  saveEntry: (entry: DailyEntry) => Promise<void>;
  getEntryForSystemDate: (systemId: string, date: string) => Promise<DailyEntry | undefined>;
  getSystemEntries: (systemId: string) => Promise<DailyEntry[]>;
  getDateEntries: (date: string) => Promise<DailyEntry[]>;
  createBlankEntry: (systemId: string) => DailyEntry;

  // Sync
  syncNow: () => Promise<void>;
  discardPending: () => Promise<void>;

  // Settings
  updateSettings: (settings: Partial<AppSettings>) => Promise<void>;

  // Toast
  addToast: (type: ToastMsg['type'], message: string, action?: ToastMsg['action']) => void;
  dismissToast: (id: string) => void;

  // Businesses
  businesses: BusinessInfo[];
  saveBusiness: (business: BusinessInfo) => Promise<void>;
  deleteBusiness: (name: string) => Promise<void>;
  refreshBusinesses: () => Promise<void>;

  // Refresh
  refreshEntries: () => Promise<void>;
}

const CompostContext = createContext<CompostContextType | null>(null);

export function CompostProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<DailyEntry[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [customSystems, setCustomSystems] = useState<CompostSystem[]>([]);
  const [businesses, setBusinesses] = useState<BusinessInfo[]>([]);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isSyncing, setIsSyncing] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [toasts, setToasts] = useState<ToastMsg[]>([]);

  // Merge hardcoded + custom so fields saved via Manage (buildType, dimensions,
  // mulchBins, etc.) augment the hardcoded 11 systems. Custom entries with IDs
  // not matching any hardcoded system are appended as-is.
  //
  // CRITICAL: hardcoded wins on structural fields (id, name, sheetTab) so a
  // stale/partial custom entry can't clobber the real sheet tab — notably
  // `'Carbon Cube Cycle 1 '` (with trailing space). Custom only overrides the
  // fields that Manage actually edits.
  const allSystems = useMemo(() => {
    const customMap = new Map(customSystems.map(s => [s.id, s]));
    const merged = COMPOST_SYSTEMS.map(s => {
      const c = customMap.get(s.id);
      customMap.delete(s.id);
      if (!c) return s;
      return {
        ...s,
        // editable overrides from Manage
        buildType: c.buildType ?? s.buildType,
        mulchBins: c.mulchBins ?? s.mulchBins,
        mulchType: c.mulchType ?? s.mulchType,
        dimensions: c.dimensions ?? s.dimensions,
        probeLabels: c.probeLabels && c.probeLabels.length > 0 ? c.probeLabels : s.probeLabels,
      };
    });
    return [...merged, ...customMap.values()];
  }, [customSystems]);

  const addToast = useCallback((type: ToastMsg['type'], message: string, action?: ToastMsg['action']) => {
    const id = generateId();
    setToasts(prev => [...prev, { id, type, message, action }]);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  // Online/offline detection
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Load initial data + auto-discover systems from spreadsheet
  useEffect(() => {
    async function init() {
      const [allEntries, appSettings, count, storedCustomSystems, storedBusinesses] = await Promise.all([
        getAllEntries(),
        getSettings(),
        getPendingCount(),
        getAllCustomSystems(),
        getAllBusinesses(),
      ]);
      setEntries(allEntries);
      setSettings(appSettings);
      setPendingCount(count);
      setCustomSystems(storedCustomSystems);
      setBusinesses(storedBusinesses);

      // Auto-discover systems from the spreadsheet (when online)
      if (navigator.onLine) {
        try {
          const res = await fetch('/.netlify/functions/compost-discover-systems');
          if (res.ok) {
            const data = await res.json();
            const discovered: { tabName: string; probeCount: number }[] = data.systems || [];

            // Build a set of all tab names we already know about
            const knownTabs = new Set<string>();
            for (const s of COMPOST_SYSTEMS) knownTabs.add(s.sheetTab.trim());
            for (const s of storedCustomSystems) knownTabs.add(s.sheetTab.trim());

            const newSystems: CompostSystem[] = [];
            for (const d of discovered) {
              if (knownTabs.has(d.tabName.trim())) continue;

              // Auto-generate an id and shortName from the tab name
              const id = d.tabName
                .toLowerCase()
                .replace(/#/g, '')
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-|-$/g, '');
              const firstLetter = d.tabName.replace(/[^a-zA-Z]/, '').charAt(0).toUpperCase();
              const numbers = d.tabName.replace(/[^0-9]/g, '');
              const shortName = (firstLetter + numbers) || d.tabName.slice(0, 3).toUpperCase();

              const system: CompostSystem = {
                id,
                name: d.tabName,
                shortName,
                sheetTab: d.tabName,
                active: true,
                probeLabels: Array.from({ length: d.probeCount }, (_, i) => String(i + 1)),
              };

              await saveCustomSystem(system);
              newSystems.push(system);
              knownTabs.add(d.tabName.trim());
            }

            if (newSystems.length > 0) {
              setCustomSystems(prev => [...prev, ...newSystems]);
              // Add new systems to active list
              const newActiveIds = newSystems.map(s => s.id);
              const newSettings = {
                ...appSettings,
                activeSystems: [...appSettings.activeSystems, ...newActiveIds],
              };
              await dbSaveSettings(newSettings);
              setSettings(newSettings);
            }
          }
        } catch {
          // Discovery failed — no problem, hardcoded + stored systems still work
        }
      }
    }
    init();
  }, []);

  // Auto-sync when coming online
  useEffect(() => {
    if (isOnline && pendingCount > 0) {
      syncNow();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline]);

  const refreshEntries = useCallback(async () => {
    const allEntries = await getAllEntries();
    setEntries(allEntries);
    const count = await getPendingCount();
    setPendingCount(count);
  }, []);

  const saveEntry = useCallback(async (entry: DailyEntry) => {
    const updated = { ...entry, updatedAt: new Date().toISOString() };
    await dbSaveEntry(updated);
    await queueEntrySync(updated);

    setEntries(prev => {
      const idx = prev.findIndex(e => e.id === updated.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = updated;
        return next;
      }
      return [...prev, updated];
    });

    const count = await getPendingCount();
    setPendingCount(count);

    // Try immediate sync if online
    if (navigator.onLine) {
      syncNow();
    }
  }, []);

  const syncNow = useCallback(async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    try {
      const result = await processSyncQueue();
      const count = await getPendingCount();
      setPendingCount(count);

      if (result.synced > 0) {
        addToast('success', `Synced ${result.synced} entr${result.synced === 1 ? 'y' : 'ies'}`);
        await refreshEntries();
      }
      if (result.failed > 0) {
        addToast('error', `${result.failed} entr${result.failed === 1 ? 'y' : 'ies'} failed to sync`, {
          label: 'Retry',
          onClick: () => { syncNow(); },
        });
      }
    } catch (err) {
      console.error('Sync failed:', err);
    } finally {
      setIsSyncing(false);
    }
  }, [isSyncing, addToast, refreshEntries]);

  const discardPending = useCallback(async () => {
    await clearSyncQueue();
    setPendingCount(0);
    addToast('success', 'Pending items cleared');
  }, [addToast]);

  const getSystem = useCallback((id: string): CompostSystem | undefined => {
    return allSystems.find(s => s.id === id);
  }, [allSystems]);

  const addCustomSystem = useCallback(async (system: CompostSystem) => {
    await saveCustomSystem(system);
    setCustomSystems(prev => [...prev, system]);
    // Automatically add to active systems so it appears in Measure + Analyse
    const newSettings = {
      ...settings,
      activeSystems: [...settings.activeSystems, system.id],
    };
    await dbSaveSettings(newSettings);
    setSettings(newSettings);
  }, [settings]);

  const updateCustomSystem = useCallback(async (system: CompostSystem) => {
    await saveCustomSystem(system);
    setCustomSystems(prev => {
      const idx = prev.findIndex(s => s.id === system.id);
      if (idx === -1) return [...prev, system];
      const next = [...prev];
      next[idx] = system;
      return next;
    });
  }, []);

  const removeCustomSystem = useCallback(async (id: string) => {
    await deleteCustomSystem(id);
    setCustomSystems(prev => prev.filter(s => s.id !== id));
    const newSettings = {
      ...settings,
      activeSystems: settings.activeSystems.filter(sid => sid !== id),
    };
    await dbSaveSettings(newSettings);
    setSettings(newSettings);
  }, [settings]);

  const setSystemActive = useCallback(async (id: string, active: boolean) => {
    const newActiveSystems = active
      ? [...settings.activeSystems.filter(sid => sid !== id), id]
      : settings.activeSystems.filter(sid => sid !== id);
    const newSettings = { ...settings, activeSystems: newActiveSystems };
    await dbSaveSettings(newSettings);
    setSettings(newSettings);
  }, [settings]);

  const getEntryForSystemDate = useCallback(async (systemId: string, date: string) => {
    return getEntryBySystemDate(systemId, date);
  }, []);

  const getSystemEntries = useCallback(async (systemId: string) => {
    return getEntriesBySystem(systemId);
  }, []);

  const getDateEntries = useCallback(async (date: string) => {
    return getEntriesByDate(date);
  }, []);

  const createBlankEntry = useCallback((systemId: string): DailyEntry => {
    const system = allSystems.find(s => s.id === systemId);
    const probeLabels = system?.probeLabels || [];

    return {
      id: generateId(),
      systemId,
      date: getNZDate(),
      time: getNZTime(),
      weather: null,
      weatherAuto: false,
      ambientMin: null,
      ambientMax: null,
      ambientMinAuto: false,
      ambientMaxAuto: false,
      moisture: null,
      odour: null,
      probes: probeLabels.map((label, i) => ({
        probeIndex: i,
        label,
        value: null,
      })),
      averageTemp: null,
      peakTemp: null,
      height: null,
      turn: false,
      newWidth: null,
      newLength: null,
      killCycleDays: 0,
      ventTemps: '',
      visualNotes: '',
      generalNotes: '',
      mediaIds: [],
      synced: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }, [allSystems]);

  const saveBusiness = useCallback(async (business: BusinessInfo) => {
    await dbSaveBusiness(business);
    setBusinesses(prev => {
      const idx = prev.findIndex(b => b.name === business.name);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = business;
        return next;
      }
      return [...prev, business];
    });
  }, []);

  const deleteBusiness = useCallback(async (name: string) => {
    await dbDeleteBusiness(name);
    setBusinesses(prev => prev.filter(b => b.name !== name));
  }, []);

  const refreshBusinesses = useCallback(async () => {
    const all = await getAllBusinesses();
    setBusinesses(all);
  }, []);

  const updateSettings = useCallback(async (partial: Partial<AppSettings>) => {
    const newSettings = { ...settings, ...partial };
    await dbSaveSettings(newSettings);
    setSettings(newSettings);
  }, [settings]);

  return (
    <CompostContext.Provider
      value={{
        entries,
        settings,
        isOnline,
        isSyncing,
        pendingCount,
        toasts,
        allSystems,
        getSystem,
        addCustomSystem,
        updateCustomSystem,
        removeCustomSystem,
        setSystemActive,
        saveEntry,
        getEntryForSystemDate,
        getSystemEntries,
        getDateEntries,
        createBlankEntry,
        syncNow,
        discardPending,
        updateSettings,
        addToast,
        dismissToast,
        businesses,
        saveBusiness,
        deleteBusiness,
        refreshBusinesses,
        refreshEntries,
      }}
    >
      {children}
    </CompostContext.Provider>
  );
}

export function useCompost() {
  const context = useContext(CompostContext);
  if (!context) {
    throw new Error('useCompost must be used within a CompostProvider');
  }
  return context;
}
