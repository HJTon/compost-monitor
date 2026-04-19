import { openDB, type IDBPDatabase } from 'idb';
import type { DailyEntry, SyncQueueItem, MediaItem, WeatherCache, AppSettings, CompostSystem, BusinessInfo, ReadinessCheck } from '@/types';
import { DEFAULT_SETTINGS } from '@/utils/config';

const DB_NAME = 'compost-monitor';
const DB_VERSION = 4;

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          // Entries store
          const entryStore = db.createObjectStore('entries', { keyPath: 'id' });
          entryStore.createIndex('by-system', 'systemId');
          entryStore.createIndex('by-date', 'date');
          entryStore.createIndex('by-system-date', ['systemId', 'date']);

          // Sync queue
          const syncStore = db.createObjectStore('syncQueue', { keyPath: 'id' });
          syncStore.createIndex('by-status', 'status');
          syncStore.createIndex('by-entry', 'entryId');

          // Media
          const mediaStore = db.createObjectStore('media', { keyPath: 'id' });
          mediaStore.createIndex('by-entry', 'entryId');

          // Weather cache
          db.createObjectStore('weatherCache', { keyPath: 'id' });

          // Settings (single row)
          db.createObjectStore('settings', { keyPath: 'id' });
        }
        if (oldVersion < 2) {
          // Custom compost systems created via "Let's Build"
          db.createObjectStore('customSystems', { keyPath: 'id' });
        }
        if (oldVersion < 3) {
          // Business observations (waste type + contamination records)
          db.createObjectStore('businesses', { keyPath: 'name' });
        }
        if (oldVersion < 4) {
          // Readiness check lab results per system
          const rcStore = db.createObjectStore('readinessChecks', { keyPath: 'id' });
          rcStore.createIndex('by-system', 'systemId');
        }
      },
    });
  }
  return dbPromise;
}

// ============ ENTRIES ============

export async function saveEntry(entry: DailyEntry): Promise<void> {
  const db = await getDB();
  await db.put('entries', entry);
}

export async function getEntry(id: string): Promise<DailyEntry | undefined> {
  const db = await getDB();
  return db.get('entries', id);
}

export async function getEntryBySystemDate(systemId: string, date: string): Promise<DailyEntry | undefined> {
  const db = await getDB();
  return db.getFromIndex('entries', 'by-system-date', [systemId, date]);
}

export async function getEntriesBySystem(systemId: string): Promise<DailyEntry[]> {
  const db = await getDB();
  return db.getAllFromIndex('entries', 'by-system', systemId);
}

export async function getEntriesByDate(date: string): Promise<DailyEntry[]> {
  const db = await getDB();
  return db.getAllFromIndex('entries', 'by-date', date);
}

export async function getAllEntries(): Promise<DailyEntry[]> {
  const db = await getDB();
  return db.getAll('entries');
}

export async function deleteEntry(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('entries', id);
}

// ============ SYNC QUEUE ============

export async function addToSyncQueue(item: SyncQueueItem): Promise<void> {
  const db = await getDB();
  await db.put('syncQueue', item);
}

export async function getSyncQueue(): Promise<SyncQueueItem[]> {
  const db = await getDB();
  return db.getAll('syncQueue');
}

export async function getPendingSyncItems(): Promise<SyncQueueItem[]> {
  const db = await getDB();
  return db.getAllFromIndex('syncQueue', 'by-status', 'pending');
}

export async function updateSyncItem(item: SyncQueueItem): Promise<void> {
  const db = await getDB();
  await db.put('syncQueue', item);
}

export async function removeSyncItem(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('syncQueue', id);
}

export async function clearSyncQueue(): Promise<void> {
  const db = await getDB();
  await db.clear('syncQueue');
}

// ============ MEDIA ============

export async function saveMedia(item: MediaItem): Promise<void> {
  const db = await getDB();
  await db.put('media', item);
}

export async function getMediaByEntry(entryId: string): Promise<MediaItem[]> {
  const db = await getDB();
  return db.getAllFromIndex('media', 'by-entry', entryId);
}

export async function getMediaItem(id: string): Promise<MediaItem | undefined> {
  const db = await getDB();
  return db.get('media', id);
}

export async function deleteMedia(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('media', id);
}

// ============ WEATHER CACHE ============

export async function cacheWeather(cache: WeatherCache): Promise<void> {
  const db = await getDB();
  await db.put('weatherCache', cache);
}

export async function getCachedWeather(date: string): Promise<WeatherCache | undefined> {
  const db = await getDB();
  return db.get('weatherCache', date);
}

// ============ SETTINGS ============

export async function getSettings(): Promise<AppSettings> {
  const db = await getDB();
  const stored = await db.get('settings', 'app-settings');
  if (stored) {
    const { id: _id, ...settings } = stored;
    return { ...DEFAULT_SETTINGS, ...settings } as AppSettings;
  }
  return { ...DEFAULT_SETTINGS };
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  const db = await getDB();
  await db.put('settings', { id: 'app-settings', ...settings });
}

// ============ CUSTOM SYSTEMS ============

export async function saveCustomSystem(system: CompostSystem): Promise<void> {
  const db = await getDB();
  await db.put('customSystems', system);
}

export async function getAllCustomSystems(): Promise<CompostSystem[]> {
  const db = await getDB();
  return db.getAll('customSystems');
}

export async function deleteCustomSystem(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('customSystems', id);
}

// ============ BUSINESSES ============

export async function getAllBusinesses(): Promise<BusinessInfo[]> {
  const db = await getDB();
  return db.getAll('businesses');
}

export async function saveBusiness(business: BusinessInfo): Promise<void> {
  const db = await getDB();
  await db.put('businesses', business);
}

export async function getBusiness(name: string): Promise<BusinessInfo | undefined> {
  const db = await getDB();
  return db.get('businesses', name);
}

export async function deleteBusiness(name: string): Promise<void> {
  const db = await getDB();
  await db.delete('businesses', name);
}

// ============ READINESS CHECKS ============

export async function saveReadinessCheck(check: ReadinessCheck): Promise<void> {
  const db = await getDB();
  await db.put('readinessChecks', check);
}

export async function getReadinessChecksBySystem(systemId: string): Promise<ReadinessCheck[]> {
  const db = await getDB();
  return db.getAllFromIndex('readinessChecks', 'by-system', systemId);
}

export async function getAllReadinessChecks(): Promise<ReadinessCheck[]> {
  const db = await getDB();
  return db.getAll('readinessChecks');
}

export async function deleteReadinessCheck(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('readinessChecks', id);
}
