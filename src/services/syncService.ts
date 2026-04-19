import type { DailyEntry, SyncQueueItem } from '@/types';
import { getEntry, saveEntry, getMediaItem, getMediaByEntry, saveMedia, addToSyncQueue, getPendingSyncItems, updateSyncItem, removeSyncItem, getAllCustomSystems } from './db';
import { generateId, COMPOST_SYSTEMS } from '@/utils/config';

// Resolve the Google Sheet tab name for a system ID.
// Checks hardcoded systems first, then custom systems in IndexedDB.
// Falls back to the system ID itself (handled server-side by SYSTEM_TAB_MAP).
async function resolveSheetTab(systemId: string): Promise<string> {
  const hardcoded = COMPOST_SYSTEMS.find(s => s.id === systemId);
  if (hardcoded) return hardcoded.sheetTab;
  const custom = await getAllCustomSystems();
  const customSys = custom.find(s => s.id === systemId);
  if (customSys) return customSys.sheetTab;
  return systemId;
}

async function resolveSystemName(systemId: string): Promise<string | null> {
  const hardcoded = COMPOST_SYSTEMS.find(s => s.id === systemId);
  if (hardcoded) return hardcoded.name;
  const custom = await getAllCustomSystems();
  const customSys = custom.find(s => s.id === systemId);
  if (customSys) return customSys.name;
  return null;
}

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

async function syncMediaToDrive(mediaId: string): Promise<boolean> {
  try {
    const media = await getMediaItem(mediaId);
    if (!media) return false;

    let mediaData: string;
    if (media.base64) {
      mediaData = media.base64;
    } else if (media.blob) {
      mediaData = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(media.blob!);
      });
    } else {
      console.error('No media data available for', mediaId);
      return false;
    }

    // Look up the system name so uploads land in a per-system subfolder on Drive
    const entry = await getEntry(media.entryId);
    const systemName = entry ? await resolveSystemName(entry.systemId) : null;

    const res = await fetch('/.netlify/functions/compost-media-upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mediaData,
        mimeType: media.mimeType,
        filename: media.filename,
        ...(systemName ? { systemName } : {}),
      }),
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error('Media upload failed:', res.status, errorText);
      return false;
    }

    const result = await res.json();
    await saveMedia({
      ...media,
      driveFileId: result.fileId,
      driveUrl: result.webViewLink,
      synced: true,
    });

    return true;
  } catch (err) {
    console.error('Media sync error:', err);
    return false;
  }
}

async function syncEntryToSheet(entry: DailyEntry): Promise<boolean> {
  try {
    const probeValues = entry.probes.map(p => p.value);
    const sheetTab = await resolveSheetTab(entry.systemId);

    // Collect Drive URLs for any media already uploaded for this entry
    const mediaItems = await getMediaByEntry(entry.id);
    const mediaLinks = mediaItems
      .filter(m => m.synced && m.driveUrl)
      .map(m => m.driveUrl!);

    const res = await fetch('/.netlify/functions/compost-sheets-write', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tab: sheetTab,
        probeCount: entry.probes.length,
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
        mediaLinks,
        height: entry.height,
        turn: entry.turn || false,
        newWidth: entry.newWidth ?? null,
        newLength: entry.newLength ?? null,
      }),
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error('Sheet write failed:', res.status, errorText);
      try {
        const errorJson = JSON.parse(errorText);
        console.error('Error details:', errorJson.details || errorJson.error);
      } catch { /* not JSON */ }
      return false;
    }

    return true;
  } catch (err) {
    console.error('Sync error:', err);
    return false;
  }
}

export async function processSyncQueue(): Promise<{ synced: number; failed: number }> {
  const pendingRaw = await getPendingSyncItems();
  // Process media uploads before entry sheet writes so Drive URLs are
  // available when the entry row is written to the Sheet
  const pending = [...pendingRaw].sort((a, b) => {
    if (a.type === 'media' && b.type !== 'media') return -1;
    if (a.type !== 'media' && b.type === 'media') return 1;
    return 0;
  });
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
    } else if (item.type === 'media') {
      success = await syncMediaToDrive(item.entryId); // entryId holds mediaId for media items
    }

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
