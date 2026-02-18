import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import type { DailyEntry, AppSettings } from '@/types';
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

  // Refresh
  refreshEntries: () => Promise<void>;
}

const CompostContext = createContext<CompostContextType | null>(null);

export function CompostProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<DailyEntry[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isSyncing, setIsSyncing] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [toasts, setToasts] = useState<ToastMsg[]>([]);

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

  // Load initial data
  useEffect(() => {
    async function init() {
      const [allEntries, appSettings, count] = await Promise.all([
        getAllEntries(),
        getSettings(),
        getPendingCount(),
      ]);
      setEntries(allEntries);
      setSettings(appSettings);
      setPendingCount(count);
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
    const system = COMPOST_SYSTEMS.find(s => s.id === systemId);
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
      killCycleDays: 0,
      ventTemps: '',
      visualNotes: '',
      generalNotes: '',
      mediaIds: [],
      synced: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
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
