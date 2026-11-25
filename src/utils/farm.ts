// Which farm a Bin Tracker bin was dropped at (col O, written by the Green Loop collector app).
//
// Rows from before the Farm column existed are blank; they all went to Eudaimonia, which is also
// what the collector app's impact reports assume (DEFAULT_FARM in green-loop-app _lib/impact.ts).

export const DEFAULT_FARM = 'Eudaimonia';
const COL_FARM = 14; // O

export function farmOfRow(row: string[]): string {
  return (row[COL_FARM] || '').trim() || DEFAULT_FARM;
}

/** Each farm among `bins`, with how many bins are there, busiest first. */
export function farmCounts(bins: { farm: string }[]): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const b of bins) counts.set(b.farm, (counts.get(b.farm) ?? 0) + 1);
  return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** Bins at `farm`; every bin when no farm is chosen. */
export function atFarm<T extends { farm: string }>(bins: T[], farm: string | undefined): T[] {
  return farm ? bins.filter(b => b.farm === farm) : bins;
}
