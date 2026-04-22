import type { ObservationKey } from '@/types';

export interface ObservationDef {
  key: ObservationKey;
  /** Header text used on the Google Sheet column AND as a match seed for parsing notes. */
  sheetHeader: string;
  /** Short user-facing label shown under the tap button. */
  label: string;
  /** Emoji used as the visual icon on the entry buttons and chart overlay. */
  icon: string;
  /** Category for grouping in UI. */
  category: 'wildlife' | 'plantfungi';
  /**
   * Keyword aliases used when parsing freeform notes during backfill. Always
   * matched as lowercase substrings. Put longer/more specific phrases first so
   * "fruit fly" is matched before "fly".
   */
  aliases: string[];
}

export const OBSERVATIONS: ObservationDef[] = [
  // Wildlife
  { key: 'fruitFlies', sheetHeader: 'Fruit Flies', label: 'Fruit flies', icon: '🐝', category: 'wildlife',
    aliases: ['fruit flies', 'fruit fly', 'fruitflies'] },
  { key: 'flies',      sheetHeader: 'Flies',       label: 'Flies',       icon: '🐛', category: 'wildlife',
    aliases: ['flies', 'fly'] }, // checked AFTER fruitFlies
  { key: 'mites',      sheetHeader: 'Mites',       label: 'Mites',       icon: '🕷', category: 'wildlife',
    aliases: ['mites', 'mite'] },
  { key: 'birds',      sheetHeader: 'Birds',       label: 'Birds',       icon: '🐦', category: 'wildlife',
    aliases: ['birds', 'bird'] },
  { key: 'rats',       sheetHeader: 'Rats',        label: 'Rats',        icon: '🐀', category: 'wildlife',
    aliases: ['rats', 'rat', 'rodent', 'rodents'] },
  // Plant / fungi
  { key: 'inkyCaps',   sheetHeader: 'Ink Caps',    label: 'Ink caps',    icon: '🎩', category: 'plantfungi',
    aliases: ['ink caps', 'ink cap', 'inkcap', 'inky caps', 'inky cap', 'inkycap', 'coprinus'] },
  { key: 'mushrooms',  sheetHeader: 'Mushrooms',   label: 'Mushrooms',   icon: '🍄', category: 'plantfungi',
    aliases: ['mushrooms', 'mushroom'] },
  { key: 'fungus',     sheetHeader: 'Fungus',      label: 'Fungus',      icon: '🍂', category: 'plantfungi',
    aliases: ['fungus', 'fungi', 'mycelium', 'hyphae'] },
  { key: 'seedlings',  sheetHeader: 'Seedlings',   label: 'Seedlings',   icon: '🌱', category: 'plantfungi',
    aliases: ['seedlings', 'seedling', 'sprouts', 'sprouting'] },
];

export const OBSERVATIONS_BY_KEY: Record<ObservationKey, ObservationDef> =
  OBSERVATIONS.reduce((acc, o) => { acc[o.key] = o; return acc; }, {} as Record<ObservationKey, ObservationDef>);

export const WILDLIFE_OBS = OBSERVATIONS.filter(o => o.category === 'wildlife');
export const PLANTFUNGI_OBS = OBSERVATIONS.filter(o => o.category === 'plantfungi');

export const MAX_INTENSITY = 4; // 0..4 — 1 = present, 4 = +++

/** Display suffix: "", "+", "++", "+++". Intensity of 1 has no suffix. */
export function intensitySuffix(intensity: number): string {
  if (intensity <= 1) return '';
  return '+'.repeat(intensity - 1);
}

/**
 * Extract observation intensities from a block of freeform notes. Counts
 * trailing +/plus symbols or "x2"/"x3" suffixes against each alias.
 * Returns only keys where intensity > 0.
 */
export function parseObservationsFromNotes(notes: string): Partial<Record<ObservationKey, number>> {
  if (!notes) return {};
  const lower = notes.toLowerCase();
  const out: Partial<Record<ObservationKey, number>> = {};

  for (const def of OBSERVATIONS) {
    let bestIntensity = 0;
    for (const alias of def.aliases) {
      let idx = 0;
      while ((idx = lower.indexOf(alias, idx)) !== -1) {
        // Ensure the alias is not part of a longer word — check char before/after
        const before = idx > 0 ? lower[idx - 1] : ' ';
        const afterStart = idx + alias.length;
        const after = afterStart < lower.length ? lower[afterStart] : ' ';
        const isWordBoundary = (c: string) => !/[a-z]/.test(c);
        if (!isWordBoundary(before)) { idx = afterStart; continue; }
        // ...and the next char must not be an alphabetic (so "flies" doesn't
        // match inside "butterflies")
        if (!isWordBoundary(after) && after !== 's') { idx = afterStart; continue; }

        // Count trailing + signs or x2/x3 markers
        let intensity = 1;
        // skip the trailing 's' if present
        let tail = afterStart + (after === 's' ? 1 : 0);
        // skip spaces
        while (tail < lower.length && lower[tail] === ' ') tail++;
        // count +s
        let plusCount = 0;
        while (tail < lower.length && lower[tail] === '+') { plusCount++; tail++; }
        if (plusCount > 0) intensity = Math.min(MAX_INTENSITY, 1 + plusCount);
        // also support "x2", "x3"
        if (plusCount === 0 && tail < lower.length - 1 && lower[tail] === 'x') {
          const n = parseInt(lower[tail + 1], 10);
          if (!isNaN(n) && n >= 2 && n <= 4) intensity = n;
        }

        if (intensity > bestIntensity) bestIntensity = intensity;
        idx = afterStart;
      }
    }
    if (bestIntensity > 0) out[def.key] = bestIntensity;
  }
  return out;
}
