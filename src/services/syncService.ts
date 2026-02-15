import type { DailyEntry, SyncQueueItem } from '@/types';
import { getEntry, saveEntry, addToSyncQueue, getPendingSyncItems, updateSyncItem, removeSyncItem } from './db';
import { generateId } from '@/utils/config';

const MAX_RETRIES = 5;

export async function queueEntrySync(entry: DailyEntry): Promise<void> {
  const item: SyncQueueItem = {
    id: generateId(),
    entryId: entry.id,
    type: 'entry',
    status: 'pending',
    retryCount: 0,
    lastAttempt: null,
    createdAt: new Date().toISOString(),
  };
  await addToSyncQueue(item);
}

export async function queueMediaSync(entryId: string, mediaId: string): Promise<void> {
  const item: SyncQueueItem = {
    id: generateId(),
    entryId: mediaId, // for media, entryId field holds the mediaId
    type: 'media',
    status: 'pending',
    retryCount: 0,
    lastAttempt: null,
    createdAt: new Date().toISOString(),
  };
  await addToSyncQueue(item);
  // Suppress unused var warning - entryId is used for context
  void entryId;
}

async function syncEntryToSheet(entry: DailyEntry): Promise<boolean> {
  try {
    const probeValues = entry.probes.map(p => p.value);

    const res = await fetch('/.netlify/functions/compost-sheets-write', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tab: entry.systemId,
        date: entry.date,
        time: entry.time,
        weather: entry.weather,
        ambientMin: entry.ambientMin,
        ambientMax: entry.ambientMax,
        moisture: entry.moisture,
        odour: entry.odour,
        probes: probeValues,
        ventTemps: entry.ventTemps,
        visualNotes: entry.visualNotes,
        generalNotes: entry.generalNotes,
        mediaIds: entry.mediaIds,
      }),
    });

    if (!res.ok) {
      console.error('Sheet write failed:', await res.text());
      return false;
    }

    return true;
  } catch (err) {
    console.error('Sync error:', err);
    return false;
  }
}

export async function processSyncQueue(): Promise<{ synced: number; failed: number }> {
  const pending = await getPendingSyncItems();
  let synced = 0;
  let failed = 0;

  for (const item of pending) {
    if (item.retryCount >= MAX_RETRIES) {
      await updateSyncItem({ ...item, status: 'failed' });
      failed++;
      continue;
    }

    await updateSyncItem({ ...item, status: 'syncing', lastAttempt: new Date().toISOString() });

    let success = false;

    if (item.type === 'entry') {
      const entry = await getEntry(item.entryId);
      if (entry) {
        success = await syncEntryToSheet(entry);
        if (success) {
          await saveEntry({ ...entry, synced: true });
        }
      } else {
        // Entry was deleted, remove from queue
        await removeSyncItem(item.id);
        continue;
      }
    }
    // Media sync handled separately via mediaService

    if (success) {
      await removeSyncItem(item.id);
      synced++;
    } else {
      await updateSyncItem({
        ...item,
        status: 'pending',
        retryCount: item.retryCount + 1,
        lastAttempt: new Date().toISOString(),
      });
      failed++;
    }
  }

  return { synced, failed };
}

export function getPendingCount(): Promise<number> {
  return getPendingSyncItems().then(items => items.length);
}
