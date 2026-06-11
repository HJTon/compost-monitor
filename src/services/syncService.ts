import type { DailyEntry, SyncQueueItem } from '@/types';
import { getEntry, saveEntry, getMediaItem, getMediaByEntry, saveMedia, addToSyncQueue, getSyncQueue, updateSyncItem, removeSyncItem, getAllCustomSystems } from './db';
import { generateId, COMPOST_SYSTEMS } from '@/utils/config';
import { compressImage } from '@/utils/imageCompress';

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

/** An item stuck in 'syncing' longer than this is assumed orphaned (app was
 * closed mid-sync) and gets picked up again. */
const SYNCING_STALE_MS = 3 * 60 * 1000;

/** Per-attempt fetch timeouts — a hung request on spotty rural internet must
 * not block the whole queue. Media gets longer because uploads are large. */
const ENTRY_TIMEOUT_MS = 30_000;
const MEDIA_TIMEOUT_MS = 120_000;

/** Exponential backoff between retries for an individual item: 30s, 1m, 2m,
 * 4m … capped at 10 minutes. Items are NEVER permanently abandoned for
 * transient failures — they just wait longer between attempts. */
function backoffMs(retryCount: number): number {
  return Math.min(30_000 * Math.pow(2, retryCount), 10 * 60_000);
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

type AttemptResult =
  | { outcome: 'ok' }
  | { outcome: 'retry'; error?: string }
  | { outcome: 'permanent'; error: string }
  /** The underlying record no longer exists — drop the queue item silently. */
  | { outcome: 'drop' };

/** Classify a non-OK HTTP response: 4xx (other than 404/408/429) can never
 * succeed by retrying; everything else is transient. 404 is kept retryable
 * because a transient routing gap (e.g. mid-deploy) must not cause data to
 * be permanently abandoned. */
function classifyHttpFailure(status: number, bodyText: string): AttemptResult {
  const isPermanent = status >= 400 && status < 500 && status !== 404 && status !== 408 && status !== 429;
  let detail = '';
  try {
    const json = JSON.parse(bodyText);
    detail = json.error || json.details || '';
  } catch { /* not JSON */ }
  const error = detail || `HTTP ${status}`;
  return isPermanent ? { outcome: 'permanent', error } : { outcome: 'retry', error };
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return res.blob();
}

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

/** Queue a batch of sampling-log rows for offline-safe delivery to the
 * Sampling Log sheet tab. `sampleId` is only used for display/debugging. */
export async function queueSampleSync(sampleId: string, rows: unknown[]): Promise<void> {
  const item: SyncQueueItem = {
    id: generateId(),
    entryId: sampleId,
    type: 'sample',
    status: 'pending',
    retryCount: 0,
    lastAttempt: null,
    createdAt: new Date().toISOString(),
    payload: { rows },
  };
  await addToSyncQueue(item);
}

async function syncMediaToDrive(mediaId: string): Promise<AttemptResult> {
  let media;
  try {
    media = await getMediaItem(mediaId);
  } catch (err) {
    return { outcome: 'retry', error: String(err) };
  }
  // Media record was deleted — nothing to upload, clear the queue item.
  if (!media) return { outcome: 'drop' };

  try {
    let mediaData: string;
    let mimeType: string = media.mimeType;

    // Prefer compressing from the raw blob; fall back to the base64 if that's all we have.
    // Skip compression for videos — we only downscale still images.
    const isImage = media.mimeType?.startsWith('image/');
    if (media.blob && isImage) {
      const compressed = await compressImage(media.blob);
      if (compressed.compressed) {
        console.log(`Compressed ${media.filename}: ${(compressed.originalBytes / 1024 / 1024).toFixed(1)} MB → ${(compressed.finalBytes / 1024 / 1024).toFixed(1)} MB`);
      }
      mediaData = compressed.base64;
      mimeType = compressed.mimeType;
    } else if (media.base64 && isImage) {
      // Convert base64 → blob → compress, so offline-queued entries benefit too
      const blob = await dataUrlToBlob(media.base64);
      const compressed = await compressImage(blob);
      if (compressed.compressed) {
        console.log(`Compressed ${media.filename}: ${(compressed.originalBytes / 1024 / 1024).toFixed(1)} MB → ${(compressed.finalBytes / 1024 / 1024).toFixed(1)} MB`);
      }
      mediaData = compressed.base64;
      mimeType = compressed.mimeType;
    } else if (media.base64) {
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
      return { outcome: 'drop' };
    }

    // Look up the system name so uploads land in a per-system subfolder on Drive
    const entry = await getEntry(media.entryId);
    const systemName = entry ? await resolveSystemName(entry.systemId) : null;

    const res = await fetchWithTimeout('/.netlify/functions/compost-media-upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mediaData,
        mimeType,
        filename: media.filename,
        ...(systemName ? { systemName } : {}),
      }),
    }, MEDIA_TIMEOUT_MS);

    if (!res.ok) {
      const errorText = await res.text();
      console.error('Media upload failed:', res.status, errorText);
      if (res.status === 413) {
        return {
          outcome: 'permanent',
          error: `${media.type === 'video' ? 'Video' : 'Photo'} "${media.filename}" is too large to upload (4 MB max — about 10–15 seconds of video)`,
        };
      }
      return classifyHttpFailure(res.status, errorText);
    }

    const result = await res.json();
    await saveMedia({
      ...media,
      driveFileId: result.fileId,
      driveUrl: result.webViewLink,
      synced: true,
    });

    // If the entry's sheet row was already written before this photo finished
    // uploading, re-queue the entry: the server upserts by entry id, so the
    // existing row gets its Media Links column filled in rather than a
    // duplicate row appended.
    if (entry?.synced) {
      const queue = await getSyncQueue();
      const alreadyQueued = queue.some(q => q.type === 'entry' && q.entryId === entry.id);
      if (!alreadyQueued) await queueEntrySync(entry);
    }

    return { outcome: 'ok' };
  } catch (err) {
    console.error('Media sync error:', err);
    return { outcome: 'retry', error: err instanceof Error ? err.message : String(err) };
  }
}

async function syncEntryToSheet(entry: DailyEntry): Promise<AttemptResult> {
  try {
    const probeValues = entry.probes.map(p => p.value);
    const sheetTab = await resolveSheetTab(entry.systemId);

    // Collect Drive URLs for any media already uploaded for this entry
    const mediaItems = await getMediaByEntry(entry.id);
    const mediaLinks = mediaItems
      .filter(m => m.synced && m.driveUrl)
      .map(m => m.driveUrl!);

    const res = await fetchWithTimeout('/.netlify/functions/compost-sheets-write', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // The server uses entryId to upsert: retries and "update today's
        // reading" update the existing row instead of appending a duplicate.
        entryId: entry.id,
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
        observations: entry.observations
          ? {
              'Fruit Flies': entry.observations.fruitFlies || 0,
              'Flies':       entry.observations.flies      || 0,
              'Mites':       entry.observations.mites      || 0,
              'Birds':       entry.observations.birds      || 0,
              'Rats':        entry.observations.rats       || 0,
              'Ink Caps':    entry.observations.inkyCaps   || 0,
              'Mushrooms':   entry.observations.mushrooms  || 0,
              'Fungus':      entry.observations.fungus     || 0,
              'Seedlings':   entry.observations.seedlings  || 0,
            }
          : undefined,
      }),
    }, ENTRY_TIMEOUT_MS);

    if (!res.ok) {
      const errorText = await res.text();
      console.error('Sheet write failed:', res.status, errorText);
      return classifyHttpFailure(res.status, errorText);
    }

    return { outcome: 'ok' };
  } catch (err) {
    console.error('Sync error:', err);
    return { outcome: 'retry', error: err instanceof Error ? err.message : String(err) };
  }
}

async function syncSampleRows(item: SyncQueueItem): Promise<AttemptResult> {
  const payload = item.payload as { rows?: unknown[] } | undefined;
  if (!payload?.rows || payload.rows.length === 0) return { outcome: 'drop' };
  try {
    const res = await fetchWithTimeout('/.netlify/functions/compost-sampling-write', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: payload.rows }),
    }, ENTRY_TIMEOUT_MS);

    if (!res.ok) {
      const errorText = await res.text();
      console.error('Sample write failed:', res.status, errorText);
      return classifyHttpFailure(res.status, errorText);
    }
    return { outcome: 'ok' };
  } catch (err) {
    console.error('Sample sync error:', err);
    return { outcome: 'retry', error: err instanceof Error ? err.message : String(err) };
  }
}

export interface SyncResult {
  synced: number;
  failed: number;
  /** Items that can never succeed (e.g. video too large) — surfaced once, then excluded from retries. */
  permanentErrors: string[];
}

// Module-level lock: only one queue run at a time, no matter how many
// triggers fire (save, online event, periodic timer, manual button). The
// previous React-state guard had a stale-closure hole that allowed two
// concurrent runs to double-process the queue.
let inFlight: Promise<SyncResult> | null = null;

export function processSyncQueue(force = false): Promise<SyncResult> {
  if (inFlight) return inFlight;
  inFlight = doProcessQueue(force).finally(() => { inFlight = null; });
  return inFlight;
}

async function doProcessQueue(force: boolean): Promise<SyncResult> {
  const all = await getSyncQueue();
  const now = Date.now();

  const candidates = all.filter(item => {
    // Permanently failed items (e.g. oversized video) are never retried.
    if (item.status === 'failed' && item.permanent) return false;
    // 'syncing' items are orphans from an interrupted run — pick them up
    // again once they're stale. (The module lock means nothing in *this*
    // session is genuinely mid-flight while we run.)
    if (item.status === 'syncing') {
      const last = item.lastAttempt ? Date.parse(item.lastAttempt) : 0;
      if (now - last < SYNCING_STALE_MS) return false;
    }
    // Respect per-item backoff unless the user asked to sync right now.
    if (!force && item.nextAttemptAt && Date.parse(item.nextAttemptAt) > now) return false;
    return true;
  });

  // Media first so Drive URLs exist when entry rows are written,
  // then samples, then entries.
  const order = { media: 0, sample: 1, entry: 2 } as const;
  candidates.sort((a, b) => (order[a.type] ?? 3) - (order[b.type] ?? 3));

  let synced = 0;
  let failed = 0;
  const permanentErrors: string[] = [];

  for (const item of candidates) {
    if (!navigator.onLine) { failed += 1; continue; }

    await updateSyncItem({ ...item, status: 'syncing', lastAttempt: new Date().toISOString() });

    let result: AttemptResult;

    if (item.type === 'entry') {
      const entry = await getEntry(item.entryId);
      if (!entry) {
        // Entry was deleted, remove from queue
        await removeSyncItem(item.id);
        continue;
      }
      // Hold the entry back while any of its photos/videos are still queued,
      // so the sheet row is written complete with its Media Links. Media items
      // run first in this same pass, so this only defers when an upload failed
      // moments ago — the entry retries together with the media.
      const entryMedia = await getMediaByEntry(entry.id);
      const retryableMediaIds = new Set(
        (await getSyncQueue())
          .filter(q => q.type === 'media' && !(q.status === 'failed' && q.permanent))
          .map(q => q.entryId)
      );
      const waitingOnMedia = entryMedia.some(m => !m.synced && retryableMediaIds.has(m.id));
      if (waitingOnMedia) {
        await updateSyncItem({ ...item, status: 'pending' });
        failed += 1;
        continue;
      }
      result = await syncEntryToSheet(entry);
      if (result.outcome === 'ok') {
        await saveEntry({ ...entry, synced: true });
      }
    } else if (item.type === 'media') {
      result = await syncMediaToDrive(item.entryId); // entryId holds mediaId for media items
    } else if (item.type === 'sample') {
      result = await syncSampleRows(item);
    } else {
      result = { outcome: 'drop' };
    }

    if (result.outcome === 'ok' || result.outcome === 'drop') {
      await removeSyncItem(item.id);
      if (result.outcome === 'ok') synced++;
    } else if (result.outcome === 'permanent') {
      await updateSyncItem({
        ...item,
        status: 'failed',
        permanent: true,
        lastError: result.error,
        lastAttempt: new Date().toISOString(),
      });
      permanentErrors.push(result.error);
    } else {
      const retryCount = item.retryCount + 1;
      await updateSyncItem({
        ...item,
        status: 'pending',
        retryCount,
        lastError: result.error,
        lastAttempt: new Date().toISOString(),
        nextAttemptAt: new Date(now + backoffMs(retryCount)).toISOString(),
      });
      failed++;
    }
  }

  return { synced, failed, permanentErrors };
}

/** Count of items still waiting to reach the sheet/Drive — includes items in
 * backoff and orphaned 'syncing' items, excludes only permanent failures. */
export async function getPendingCount(): Promise<number> {
  const all = await getSyncQueue();
  return all.filter(item => !(item.status === 'failed' && item.permanent)).length;
}
