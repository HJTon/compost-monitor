import { createContext, useContext, useState, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import type { DailyEntry, AppSettings, CompostSystem, BusinessInfo, BuildPhase, MaturationInfo, GrowInfo } from '@/types';
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
import { DEFAULT_SETTINGS, DEFAULT_BUILD_TYPES, generateId, getNZDate, getNZTime, COMPOST_SYSTEMS } from '@/utils/config';

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
  setSystemPhase: (id: string, phase: BuildPhase, patch?: { maturation?: MaturationInfo; grow?: GrowInfo; transitionNote?: string }) => Promise<void>;

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

  // Build types (shared across all devices via Google Sheet)
  buildTypes: string[];
  addBuildType: (name: string) => Promise<void>;

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
  const [buildTypes, setBuildTypes] = useState<string[]>(DEFAULT_BUILD_TYPES);

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
        phase: c.phase ?? s.phase,
        maturation: c.maturation ?? s.maturation,
        grow: c.grow ?? s.grow,
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
      // Purge any stored custom systems that are actually shared-meta sheet
      // tabs (Build Info, Sampling Log, Media, etc.) — older installs may have
      // auto-discovered them as "builds" before the exclude list was extended.
      const EXCLUDED_NAMES = new Set([
        'build info', 'build phases', 'sampling log', 'media',
        'bin tracker', 'system setup', 'score card', 'scorecard', 'template',
      ]);
      const cleanCustomSystems: CompostSystem[] = [];
      const purgedIds: string[] = [];
      for (const s of storedCustomSystems) {
        const key = (s.sheetTab || s.name || '').toLowerCase().trim();
        if (EXCLUDED_NAMES.has(key)) {
          purgedIds.push(s.id);
          await deleteCustomSystem(s.id);
        } else {
          cleanCustomSystems.push(s);
        }
      }
      if (purgedIds.length > 0) {
        appSettings.activeSystems = appSettings.activeSystems.filter(id => !purgedIds.includes(id));
        await dbSaveSettings(appSettings);
      }

      // Migrate users still on the old coastal default coords (-39.1672, 174.0955)
      // to the actual farm location up the mountain.
      if (Math.abs(appSettings.farmLatitude - (-39.1672)) < 1e-4
          && Math.abs(appSettings.farmLongitude - 174.0955) < 1e-4) {
        appSettings.farmLatitude = -39.18598;
        appSettings.farmLongitude = 174.078433;
        await dbSaveSettings(appSettings);
      }

      setEntries(allEntries);
      setSettings(appSettings);
      setPendingCount(count);
      setCustomSystems(cleanCustomSystems);
      setBusinesses(storedBusinesses);

      // Load phase data from the Build Phases sheet tab (when online)
      if (navigator.onLine) {
        try {
          const res = await fetch('/.netlify/functions/compost-build-phase');
          if (res.ok) {
            const data = await res.json();
            const phases: Array<{ system: string; phase: string; maturation: unknown; grow: unknown }> = data.phases || [];
            if (phases.length > 0) {
              // Merge phase data into custom systems (keyed by system name)
              const byName = new Map(phases.map(p => [p.system, p]));
              const updated: CompostSystem[] = [];
              // Hardcoded + already-stored systems may need phase data merged in
              const knownSystems = [...COMPOST_SYSTEMS, ...cleanCustomSystems];
              const customById = new Map(cleanCustomSystems.map(s => [s.id, s]));
              for (const sys of knownSystems) {
                const p = byName.get(sys.name);
                if (!p) continue;
                const existing = customById.get(sys.id) || { ...sys };
                const next: CompostSystem = {
                  ...existing,
                  phase: (p.phase as BuildPhase) || 'thermophilic',
                  maturation: (p.maturation as MaturationInfo) || undefined,
                  grow: (p.grow as GrowInfo) || undefined,
                };
                await saveCustomSystem(next);
                updated.push(next);
              }
              if (updated.length > 0) {
                setCustomSystems(prev => {
                  const next = [...prev];
                  for (const u of updated) {
                    const idx = next.findIndex(s => s.id === u.id);
                    if (idx === -1) next.push(u);
                    else next[idx] = u;
                  }
                  return next;
                });
              }
            }
          }
        } catch {
          // Phase load failed — use whatever is in IndexedDB
        }
      }

      // Load shared build info (mulch, dimensions, buildType, probeLabels) from
      // the Build Info sheet tab, and push up any local-only data so devices
      // that have historic entries (e.g. Caroline's mulch amounts) seed the
      // shared record for everyone else.
      if (navigator.onLine) {
        try {
          const res = await fetch('/.netlify/functions/compost-build-info');
          if (res.ok) {
            const data = await res.json();
            const infos: Array<{
              system: string; buildType: string; mulchBins: number | null;
              mulchType: string; dimensions: unknown; probeLabels: string[] | null;
            }> = data.infos || [];
            const byName = new Map(infos.map(i => [i.system, i]));
            const knownSystems = [...COMPOST_SYSTEMS, ...cleanCustomSystems];
            const customById = new Map(cleanCustomSystems.map(s => [s.id, s]));

            // 1) Merge sheet → local where sheet has data
            const merged: CompostSystem[] = [];
            for (const sys of knownSystems) {
              const sheetInfo = byName.get(sys.name);
              if (!sheetInfo) continue;
              const base = customById.get(sys.id) || { ...sys };
              const next: CompostSystem = {
                ...base,
                buildType: sheetInfo.buildType || base.buildType,
                mulchBins: sheetInfo.mulchBins ?? base.mulchBins,
                mulchType: sheetInfo.mulchType || base.mulchType,
                dimensions: (sheetInfo.dimensions as CompostSystem['dimensions']) || base.dimensions,
                probeLabels: (sheetInfo.probeLabels && sheetInfo.probeLabels.length > 0)
                  ? sheetInfo.probeLabels
                  : base.probeLabels,
              };
              if (JSON.stringify(next) !== JSON.stringify(customById.get(sys.id))) {
                await saveCustomSystem(next);
                merged.push(next);
              }
            }
            if (merged.length > 0) {
              setCustomSystems(prev => {
                const next = [...prev];
                for (const m of merged) {
                  const idx = next.findIndex(s => s.id === m.id);
                  if (idx === -1) next.push(m);
                  else next[idx] = m;
                }
                return next;
              });
            }

            // 2) Push local → sheet where local has data and sheet is blank
            const allCurrent = [...COMPOST_SYSTEMS, ...await getAllCustomSystems()];
            for (const sys of allCurrent) {
              const hasLocal = !!(sys.buildType || sys.mulchBins != null || sys.mulchType
                || sys.dimensions || (sys.probeLabels && sys.probeLabels.length > 0));
              if (!hasLocal) continue;
              const sheetInfo = byName.get(sys.name);
              const sheetHas = !!(sheetInfo && (
                sheetInfo.buildType || sheetInfo.mulchBins != null || sheetInfo.mulchType
                || sheetInfo.dimensions
                || (sheetInfo.probeLabels && sheetInfo.probeLabels.length > 0)
              ));
              if (sheetHas) continue;
              fetch('/.netlify/functions/compost-build-info', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  system: sys.name,
                  buildType: sys.buildType || '',
                  mulchBins: sys.mulchBins ?? null,
                  mulchType: sys.mulchType || '',
                  dimensions: sys.dimensions || null,
                  probeLabels: sys.probeLabels || null,
                }),
              }).catch(() => { /* offline retry on next open */ });
            }
          }
        } catch {
          // Build info load failed — local IndexedDB still works
        }
      }

      // Auto-discover systems from the spreadsheet (when online)
      if (navigator.onLine) {
        try {
          const res = await fetch('/.netlify/functions/compost-discover-systems', { cache: 'no-store' });
          if (res.ok) {
            const data = await res.json();
            const discovered: { tabName: string; probeCount: number }[] = data.systems || [];
            const discoveredTabSet = new Set(discovered.map(d => d.tabName.trim()));

            // Full sync: purge any local custom system whose sheet tab is no
            // longer in the discovered list AND isn't one of the hardcoded
            // 11 systems. This keeps every device agreeing on the same build
            // list even if an earlier install accumulated stale entries.
            const hardcodedTabs = new Set(COMPOST_SYSTEMS.map(s => s.sheetTab.trim()));
            const stalePurgeIds: string[] = [];
            const survivingCustom: CompostSystem[] = [];
            for (const s of cleanCustomSystems) {
              const tab = s.sheetTab.trim();
              if (discoveredTabSet.has(tab) || hardcodedTabs.has(tab)) {
                survivingCustom.push(s);
              } else {
                stalePurgeIds.push(s.id);
                await deleteCustomSystem(s.id);
              }
            }
            if (stalePurgeIds.length > 0) {
              setCustomSystems(prev => prev.filter(s => !stalePurgeIds.includes(s.id)));
              appSettings.activeSystems = appSettings.activeSystems.filter(id => !stalePurgeIds.includes(id));
              await dbSaveSettings(appSettings);
              setSettings(appSettings);
            }

            // Build a set of all tab names we already know about
            const knownTabs = new Set<string>();
            for (const s of COMPOST_SYSTEMS) knownTabs.add(s.sheetTab.trim());
            for (const s of survivingCustom) knownTabs.add(s.sheetTab.trim());

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

  // Fetch shared build types from Google Sheet on mount (falls back to defaults offline)
  useEffect(() => {
    if (!navigator.onLine) return;
    fetch('/.netlify/functions/compost-build-types')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.types && Array.isArray(data.types) && data.types.length > 0) {
          setBuildTypes(data.types);
        }
      })
      .catch(() => { /* keep defaults */ });
  }, []);

  const addBuildType = useCallback(async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    // Optimistic update
    setBuildTypes(prev => prev.includes(trimmed) ? prev : [...prev, trimmed]);
    try {
      const res = await fetch('/.netlify/functions/compost-build-types', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data?.types && Array.isArray(data.types)) setBuildTypes(data.types);
      }
    } catch (err) {
      console.warn('Could not sync build type to sheet:', err);
      addToast('error', 'Could not save new build type — will retry when online');
    }
  }, [addToast]);

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

    // Fire-and-forget push to shared Build Info sheet so every device sees the
    // same mulch amount, dimensions, probe count, and build type.
    if (navigator.onLine) {
      fetch('/.netlify/functions/compost-build-info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system: system.name,
          buildType: system.buildType || '',
          mulchBins: system.mulchBins ?? null,
          mulchType: system.mulchType || '',
          dimensions: system.dimensions || null,
          probeLabels: system.probeLabels || null,
        }),
      }).catch(err => console.warn('Build info sync failed:', err));
    }
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

  const setSystemPhase = useCallback(async (
    id: string,
    phase: BuildPhase,
    patch?: { maturation?: MaturationInfo; grow?: GrowInfo; transitionNote?: string },
  ) => {
    const current = allSystems.find(s => s.id === id);
    if (!current) return;

    const hardcoded = COMPOST_SYSTEMS.find(s => s.id === id);
    const existingCustom = customSystems.find(s => s.id === id);
    const base: CompostSystem = existingCustom || { ...(hardcoded || current) };

    const updated: CompostSystem = {
      ...base,
      phase,
      maturation: patch?.maturation ?? (phase === 'thermophilic' ? undefined : base.maturation),
      grow: patch?.grow ?? (phase === 'grow' ? base.grow : base.grow),
    };

    await saveCustomSystem(updated);
    setCustomSystems(prev => {
      const idx = prev.findIndex(s => s.id === id);
      if (idx === -1) return [...prev, updated];
      const next = [...prev];
      next[idx] = updated;
      return next;
    });

    // Fire-and-forget sync to Google Sheets
    fetch('/.netlify/functions/compost-build-phase', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system: current.name,
        sheetTab: current.sheetTab,
        phase,
        maturation: updated.maturation,
        grow: updated.grow,
        transitionNote: patch?.transitionNote || '',
      }),
    }).catch(err => console.warn('Phase sync failed:', err));
  }, [allSystems, customSystems]);

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
        setSystemPhase,
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
        buildTypes,
        addBuildType,
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
