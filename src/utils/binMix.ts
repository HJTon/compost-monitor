// Bokashi mix per Bin Tracker row: all Zing, or contains some chaffed pickle (CP).
//
// The collector app shades a business's "Content from" cell bright yellow when their bokashi had
// been refilled with chaffed pickle; `compost-sheets-read?tab=Bin%20Tracker&cp=1` returns those
// names per row index as `cp`. `null` means the colour read failed, so the mix is unknown.

export const BIN_TRACKER_URL = '/.netlify/functions/compost-sheets-read?tab=Bin%20Tracker&cp=1';

export type CpByRow = Record<number, string[]> | null;

export interface BinMix {
  /** Businesses whose share of this bin carried chaffed pickle. Empty = all Zing. */
  cpSources: string[];
}

/** Reads the `cp` field of a Bin Tracker response. */
export function readCpByRow(json: { cp?: Record<string, string[]> | null }): CpByRow {
  if (!json.cp) return null;
  const out: Record<number, string[]> = {};
  for (const [k, v] of Object.entries(json.cp)) out[Number(k)] = v;
  return out;
}

/** Mix for one row (index into the `data` array, header = 0); undefined when unknown. */
export function mixForRow(cp: CpByRow, rowIndex: number): BinMix | undefined {
  if (!cp) return undefined;
  return { cpSources: cp[rowIndex] ?? [] };
}
