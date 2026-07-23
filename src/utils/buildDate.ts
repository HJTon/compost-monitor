import type { CompostSystem } from '@/types';

/**
 * Shared build-date logic.
 *
 * The canonical `system.buildDate` (YYYY-MM-DD) lives in the `Build Info` sheet
 * tab. Saving it also rewrites "Date of Batching" (Bin Tracker col J) for every
 * bin in that build. Both the single-build panel on `BuildDetailPage` and the
 * `BuildDatesPage` sweep screen go through `persistBuildDate` so the two stay
 * in step.
 */

// ── Bin Tracker column indices (0-based) ────────────────────────────────────
const COL_BATCHING_DATE = 9;
const COL_BUILD_NAME = 10;

/** Parse a Bin Tracker date (`DD-MMM-YYYY`) into a local Date, or null. */
export function parseTrackerDate(dateStr: string): Date | null {
  if (!dateStr?.trim()) return null;
  const m = dateStr.trim().match(/^(\d{1,2})-([A-Za-z]{3,})-(\d{4})$/);
  if (m) {
    const d = new Date(`${m[2]} ${parseInt(m[1])}, ${m[3]}`);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/** Local Date → YYYY-MM-DD (no UTC shift) */
export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** True for a well-formed YYYY-MM-DD string. */
export function isISODate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/** Earliest "Date of Batching" across a set of tracker date strings, as ISO. */
export function earliestBatchingISO(batchingDates: string[]): string {
  const dates = batchingDates
    .map(parseTrackerDate)
    .filter((d): d is Date => d !== null)
    .sort((a, b) => a.getTime() - b.getTime());
  return dates.length > 0 ? toISODate(dates[0]) : '';
}

/**
 * One read of the whole Bin Tracker tab → `{ [buildName]: earliest batching ISO }`.
 * The tab is the same source `BuildDetailPage` uses for `assignedBins`, so the
 * suggestion matches what a single build's page would prefill.
 */
export async function fetchSuggestedBuildDates(): Promise<Record<string, string>> {
  const res = await fetch('/.netlify/functions/compost-sheets-read?tab=Bin%20Tracker');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json: unknown = await res.json();
  const rows: string[][] =
    json && typeof json === 'object' && Array.isArray((json as { data?: unknown }).data)
      ? ((json as { data: string[][] }).data)
      : [];

  const byBuild = new Map<string, string[]>();
  rows.forEach((row, arrayIndex) => {
    if (arrayIndex === 0) return; // header
    const build = (row[COL_BUILD_NAME] || '').trim();
    if (!build) return;
    const batching = (row[COL_BATCHING_DATE] || '').trim();
    if (!batching) return;
    const list = byBuild.get(build);
    if (list) list.push(batching);
    else byBuild.set(build, [batching]);
  });

  const out: Record<string, string> = {};
  byBuild.forEach((dates, build) => {
    const iso = earliestBatchingISO(dates);
    if (iso) out[build] = iso;
  });
  return out;
}

/** Thrown when the local/Build Info write fails — nothing was saved. */
export class BuildDateLocalError extends Error {}
/** Thrown when the Bin Tracker rewrite fails — the build date itself did save. */
export class BuildDateSheetError extends Error {}

/**
 * Save a build date: local + `Build Info` sheet first, then the Bin Tracker
 * batching dates. Resolves with the number of bin rows updated.
 */
export async function persistBuildDate(
  system: CompostSystem,
  buildDate: string,
  updateCustomSystem: (system: CompostSystem) => Promise<void>,
): Promise<number> {
  try {
    // 1. Local + Build Info sheet
    await updateCustomSystem({ ...system, buildDate });
  } catch (err) {
    console.error('Save build date (local) error:', err);
    throw new BuildDateLocalError('Failed to save the build date');
  }

  try {
    // 2. Bin Tracker col J for every bin in this build
    const res = await fetch('/.netlify/functions/compost-build-date', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ buildName: system.name, buildDate }),
    });
    if (!res.ok) {
      const err: { details?: string; error?: string } = await res.json().catch(() => ({}));
      throw new Error(err.details || err.error || `HTTP ${res.status}`);
    }
    const data: { binsUpdated?: number } = await res.json();
    return typeof data.binsUpdated === 'number' ? data.binsUpdated : 0;
  } catch (err) {
    console.error('Save build date (sheet) error:', err);
    throw new BuildDateSheetError(
      'Build date saved, but the spreadsheet bins did not update — try saving again',
    );
  }
}
