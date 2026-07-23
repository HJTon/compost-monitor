import { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef, type ReactNode } from 'react';
import type { DailyEntry, AppSettings, CompostSystem, BusinessInfo, BuildPhase, MaturationInfo, GrowInfo, TrialRun } from '@/types';
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
import {
  DEFAULT_SETTINGS,
  DEFAULT_BUILD_TYPES,
  DEFAULT_TRIAL_METHODS,
  DEFAULT_TRIAL_CROPS,
  generateId,
  getNZDate,
  getNZTime,
  COMPOST_SYSTEMS,
} from '@/utils/config';

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
  syncNow: (silent?: boolean) => Promise<void>;
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

  // Grow-trial options (shared across all devices via Google Sheet)
  trialMethods: string[];
  trialCrops: string[];
  addTrialMethod: (name: string) => Promise<void>;
  addTrialCrop: (name: string) => Promise<void>;

  // Trial runs (shared/global protocol experiments — Trial Runs sheet tab)
  trialRuns: TrialRun[];
  saveTrialRun: (run: TrialRun) => Promise<void>;
  getTrialRun: (runId: string) => TrialRun | undefined;

  // Refresh
  refreshEntries: () => Promise<void>;
}

const CompostContext = createContext<CompostContextType | null>(null);

/**
 * Append `extra` to `base`, skipping case-insensitive duplicates and keeping
 * the first-seen spelling. Used to fold a device's locally-added trial
 * options into the shared list without ever dropping one.
 */
function mergeUnique(base: string[], extra: string[]): string[] {
  const seen = new Set(base.map(v => v.toLowerCase()));
  const out = [...base];
  for (const v of extra) {
    const key = v.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(v.trim());
  }
  return out;
}

/**
 * Replace the FIRST run with this id, or append when it's new.
 *
 * First-wins deliberately: compost-trial-runs.ts POSTs into the first sheet row
 * whose RunId matches, so every client-side lookup has to resolve to that same
 * row. See "Shared-tab gotcha" in CLAUDE.md — the equivalent Build Info lookup
 * was silently reading back a different row than the one it wrote.
 */
function upsertRun(list: TrialRun[], run: TrialRun): TrialRun[] {
  const idx = list.findIndex(r => r.runId === run.runId);
  if (idx === -1) return [...list, run];
  const next = [...list];
  next[idx] = run;
  return next;
}

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
  const [trialMethods, setTrialMethods] = useState<string[]>(DEFAULT_TRIAL_METHODS);
  const [trialCrops, setTrialCrops] = useState<string[]>(DEFAULT_TRIAL_CROPS);
  const [trialRuns, setTrialRuns] = useState<TrialRun[]>([]);

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
        buildDate: c.buildDate ?? s.buildDate,
        performanceRating: c.performanceRating ?? s.performanceRating,
      };
    });
    return [...merged, ...customMap.values()];
  }, [customSystems]);

  const addToast = useCallback((type: ToastMsg['type'], message: string, action?: ToastMsg['action']) => {
    const id = generateId();
    // Dedupe: don't stack a second copy of a message that's already showing —
    // repeated sync retries on a flaky connection were filling the screen.
    setToasts(prev => prev.some(t => t.message === message) ? prev : [...prev, { id, type, message, action }]);
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

      // Kick a quiet sync on app open if anything is still waiting — this
      // also recovers items that were stuck mid-sync when the app was last
      // closed (they sit in 'syncing' status and would otherwise wait for
      // an online/offline transition that may never fire).
      if (count > 0 && navigator.onLine) {
        setTimeout(() => syncNowRef.current(true), 2000);
      }

      // Load phase data from the Build Phases sheet tab (when online)
      if (navigator.onLine) {
        try {
          const res = await fetch('/.netlify/functions/compost-build-phase');
          if (res.ok) {
            const data = await res.json();
            const phases: Array<{ system: string; phase: string; maturation: unknown; grow: unknown }> = data.phases || [];
            if (phases.length > 0) {
              // Merge phase data into custom systems (keyed by system name).
              // First occurrence wins: compost-build-phase's POST updates the
              // first matching row, so reads must resolve to that same row. A
              // plain Map would keep the LAST duplicate and silently read back
              // a different row than the one being written.
              const byName = new Map<string, (typeof phases)[number]>();
              for (const p of phases) {
                if (!byName.has(p.system)) byName.set(p.system, p);
              }
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
              buildDate?: string;
              performanceRating?: number | null;
            }> = data.infos || [];
            // FIRST occurrence wins, deliberately.
            //
            // The Build Info tab can contain duplicate rows for the same system
            // (historic bug). The POST handler in compost-build-info.ts scans
            // from the top and updates the FIRST matching row, so the read path
            // must resolve to the first row too. Building this with
            // `new Map(infos.map(i => [i.system, i]))` makes the LAST duplicate
            // win — then a value saved on one device is written to the first row
            // but read back from the last, and never propagates. Don't
            // "simplify" it back.
            const byName = new Map<string, (typeof infos)[number]>();
            for (const info of infos) {
              if (!byName.has(info.system)) byName.set(info.system, info);
            }
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
                buildDate: sheetInfo.buildDate || base.buildDate,
                performanceRating: sheetInfo.performanceRating ?? base.performanceRating,
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
                || sys.dimensions || sys.buildDate || sys.performanceRating != null
                || (sys.probeLabels && sys.probeLabels.length > 0));
              if (!hasLocal) continue;
              const sheetInfo = byName.get(sys.name);
              const sheetHas = !!(sheetInfo && (
                sheetInfo.buildType || sheetInfo.mulchBins != null || sheetInfo.mulchType
                || sheetInfo.dimensions || sheetInfo.buildDate
                || sheetInfo.performanceRating != null
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
                  buildDate: sys.buildDate || '',
                  performanceRating: sys.performanceRating ?? null,
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

  // Fetch shared grow-trial methods/crops from the Google Sheet on mount.
  //
  // These used to live only in per-device settings, so a crop Caroline added on
  // her tablet didn't exist anywhere else. The sheet is now the shared list; any
  // locally-stored customs are merged in (so nothing added offline disappears
  // from that device's own dropdown) and pushed up so everyone else gets them.
  useEffect(() => {
    let cancelled = false;

    async function loadTrialOptions() {
      const stored = await getSettings();
      const localMethods = stored.customTrialMethods || [];
      const localCrops = stored.customTrialCrops || [];

      if (!navigator.onLine) {
        if (!cancelled) {
          setTrialMethods(prev => mergeUnique(prev, localMethods));
          setTrialCrops(prev => mergeUnique(prev, localCrops));
        }
        return;
      }

      let sheetMethods: string[] = [];
      let sheetCrops: string[] = [];
      try {
        const res = await fetch('/.netlify/functions/compost-trial-options');
        if (!res.ok) return;
        const data = await res.json();
        sheetMethods = Array.isArray(data?.methods) ? data.methods : [];
        sheetCrops = Array.isArray(data?.crops) ? data.crops : [];
      } catch {
        // Offline / function unavailable — keep defaults + local customs
        if (!cancelled) {
          setTrialMethods(prev => mergeUnique(prev, localMethods));
          setTrialCrops(prev => mergeUnique(prev, localCrops));
        }
        return;
      }

      if (!cancelled) {
        if (sheetMethods.length > 0) setTrialMethods(mergeUnique(sheetMethods, localMethods));
        if (sheetCrops.length > 0) setTrialCrops(mergeUnique(sheetCrops, localCrops));
      }

      // Push local-only customs up so other devices see them next time.
      // Sequential (not Promise.all) so parallel appends can't race on the
      // same tab. Failures are ignored — retried on the next app open.
      const pushUp = async (kind: 'method' | 'crop', local: string[], sheet: string[]) => {
        const known = new Set(sheet.map(v => v.toLowerCase()));
        for (const name of local) {
          const trimmed = name.trim();
          if (!trimmed || known.has(trimmed.toLowerCase())) continue;
          known.add(trimmed.toLowerCase());
          try {
            await fetch('/.netlify/functions/compost-trial-options', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ kind, name: trimmed }),
            });
          } catch {
            // offline retry on next open
          }
        }
      };
      await pushUp('method', localMethods, sheetMethods);
      await pushUp('crop', localCrops, sheetCrops);
    }

    loadTrialOptions();
    return () => { cancelled = true; };
  }, []);

  /**
   * Add a trial method or crop: optimistic local update, POST to the shared
   * sheet, adopt the returned list on success. On failure the value is kept
   * locally AND written to settings so it survives a reload and gets pushed up
   * on a later app open.
   */
  const addTrialOption = useCallback(async (kind: 'method' | 'crop', name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const setLocal = kind === 'method' ? setTrialMethods : setTrialCrops;
    setLocal(prev => mergeUnique(prev, [trimmed]));

    try {
      const res = await fetch('/.netlify/functions/compost-trial-options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, name: trimmed }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      // Adopt the sheet's list, but keep any local-only values still waiting to
      // be pushed up so they don't vanish from this device's dropdown.
      if (Array.isArray(data?.methods) && data.methods.length > 0) {
        setTrialMethods(prev => mergeUnique(data.methods as string[], prev));
      }
      if (Array.isArray(data?.crops) && data.crops.length > 0) {
        setTrialCrops(prev => mergeUnique(data.crops as string[], prev));
      }
    } catch (err) {
      console.warn('Could not sync trial option to sheet:', err);
      // Persist to per-device settings so the value survives a reload and can
      // reach the sheet on a later attempt. Read fresh from IndexedDB rather
      // than the settings state so a concurrent update can't clobber it.
      const key = kind === 'method' ? 'customTrialMethods' : 'customTrialCrops';
      try {
        const current = await getSettings();
        const existing = current[key] || [];
        if (!existing.some(v => v.toLowerCase() === trimmed.toLowerCase())) {
          const next: AppSettings = { ...current, [key]: [...existing, trimmed] };
          await dbSaveSettings(next);
          setSettings(next);
        }
      } catch (dbErr) {
        console.warn('Could not store trial option locally:', dbErr);
      }
      addToast('error', `Could not save new ${kind} — saved on this device, will retry when online`);
    }
  }, [addToast]);

  const addTrialMethod = useCallback((name: string) => addTrialOption('method', name), [addTrialOption]);
  const addTrialCrop = useCallback((name: string) => addTrialOption('crop', name), [addTrialOption]);

  // ── Trial runs ─────────────────────────────────────────────────────────────
  //
  // Runs are shared/global protocol experiments (one start date, one set of
  // controls, many piles), stored in the `Trial Runs` sheet tab. They are NOT
  // per-build, so they deliberately don't go into IndexedDB custom systems —
  // offline devices simply see an empty list until they reconnect.

  // Fetch shared trial runs on mount (online only; empty list is a fine fallback)
  useEffect(() => {
    if (!navigator.onLine) return;
    let cancelled = false;
    fetch('/.netlify/functions/compost-trial-runs')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (cancelled) return;
        if (Array.isArray(data?.runs)) setTrialRuns(data.runs as TrialRun[]);
      })
      .catch(() => { /* offline / function unavailable — no runs */ });
    return () => { cancelled = true; };
  }, []);

  /**
   * Save a run: optimistic local update, POST to the shared sheet, then adopt
   * the server's merged copy (it owns `updatedAt` and normalises the controls).
   */
  const saveTrialRun = useCallback(async (run: TrialRun) => {
    setTrialRuns(prev => upsertRun(prev, run));
    try {
      const res = await fetch('/.netlify/functions/compost-trial-runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(run),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data?.run) setTrialRuns(prev => upsertRun(prev, data.run as TrialRun));
    } catch (err) {
      console.warn('Could not save trial run to sheet:', err);
      addToast('error', 'Could not save the trial run — check your connection and try again');
    }
  }, [addToast]);

  /** First run with this id (first-wins, see `upsertRun`). */
  const getTrialRun = useCallback((runId: string): TrialRun | undefined => {
    return trialRuns.find(r => r.runId === runId);
  }, [trialRuns]);

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

  const syncNow = useCallback(async (silent?: boolean) => {
    // Guard against event objects being passed via onClick={syncNow}
    const quiet = silent === true;
    if (!navigator.onLine) return;
    setIsSyncing(true);
    try {
      // processSyncQueue has its own module-level lock, so overlapping calls
      // can't double-process the queue. Manual syncs (non-quiet) bypass
      // per-item backoff timers.
      const result = await processSyncQueue(!quiet);
      const count = await getPendingCount();
      setPendingCount(count);

      if (result.synced > 0) {
        await refreshEntries();
        if (!quiet || count === 0) {
          addToast('success', count === 0
            ? `Synced ${result.synced} item${result.synced === 1 ? '' : 's'} — all up to date`
            : `Synced ${result.synced} item${result.synced === 1 ? '' : 's'}`);
        }
      }
      // Permanent failures (e.g. a video over the size limit) are reported
      // once with the actual reason, then never retried.
      for (const msg of result.permanentErrors) {
        addToast('error', msg);
      }
      if (result.failed > 0 && !quiet) {
        addToast('info', 'Connection is patchy — everything is saved on this device and will sync automatically');
      }
    } catch (err) {
      console.error('Sync failed:', err);
    } finally {
      setIsSyncing(false);
    }
  }, [addToast, refreshEntries]);

  // Background retry: while items are pending, retry roughly every 45s
  // without toasting (the status bar already shows the pending count).
  // Catches items whose backoff has elapsed and connections that recover
  // without firing an 'online' event (common with weak rural signal).
  const syncNowRef = useRef(syncNow);
  useEffect(() => { syncNowRef.current = syncNow; }, [syncNow]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (!navigator.onLine) return;
      getPendingCount().then(count => {
        if (count > 0) syncNowRef.current(true);
      });
    }, 45_000);
    return () => clearInterval(timer);
  }, []);

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

    // Seed the shared Build Info row immediately so other devices pick up the
    // build date and metadata without waiting for a blank-row push-up.
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
          buildDate: system.buildDate || '',
          performanceRating: system.performanceRating ?? null,
        }),
      }).catch(err => console.warn('Build info sync failed:', err));
    }
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
          buildDate: system.buildDate || '',
          performanceRating: system.performanceRating ?? null,
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
        // The sheet treats an omitted field as "leave alone", so only send an
        // explicit null where clearing is actually intended. Sending undefined
        // when we simply don't have the data yet (phases sync still in flight)
        // would otherwise wipe the richer record already stored.
        maturation: phase === 'thermophilic' ? null : updated.maturation,
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
        trialMethods,
        trialCrops,
        addTrialMethod,
        addTrialCrop,
        trialRuns,
        saveTrialRun,
        getTrialRun,
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
