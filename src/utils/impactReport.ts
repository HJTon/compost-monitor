// Types + helpers for the public business impact report page (/impact/:code).
// Data comes live from the Green Loop collector app's public endpoint, which
// computes it from the sheets on each request (5 minute cache).

export const IMPACT_API = 'https://green-loop-collections.netlify.app/.netlify/functions/business-impact';

export interface MonthRow {
  month: string; // YYYY-MM
  pickups: number;
  bins: number;
  buckets: number;
  litres: number;
  kg: number;
  co2eVsLandfillKg: number;
  co2eLandfillKg: number;
  co2eTransportKg: number;
  co2eVsGreenBinKg: number;
  co2eVsLandfillBokashiKg?: number; // Green Loop estimate: red-bin figure without composting methane
  measuredLitres: number;
  estimatedLitres: number;
}

export interface PileRow {
  pile: string;
  batchingDate: string | null;
  firstCollection: string;
  lastCollection: string;
  containers: number;
}

export interface ImpactReport {
  business: string;
  settings: {
    kgPerFullBin: number;
    kgPerFullBinIsDefault: boolean;
    avgFullnessPct: number;
    fullnessSource: 'business' | 'fleet';
    fullnessMeasuredContainers: number;
    fleetAvgFullnessPct: number;
    yearStartMonth: number;
  };
  months: MonthRow[]; // oldest first
  totals: Omit<MonthRow, 'month'> & { measuredSharePct: number };
  firstCollection: string | null;
  latestCollection: string | null;
  piles: PileRow[];
  stillMaturing: number;
  methodology: {
    litresPerBin: number;
    litresPerBucket: number;
    kgPerFullBin: number;
    factors: {
      foodWasteLandfillGasRecoveryKgCo2ePerKg: number;
      gardenWasteLandfillGasRecoveryKgCo2ePerKg: number;
      compostingKgCo2ePerKg: number;
      truckKgCo2ePerTonneKm: number;
      redBinLandfillKm: number;
      councilFoodScrapsKm: number;
      redBinTransportKgCo2ePerKg: number;
      councilTransportKgCo2ePerKg: number;
      greenLoopTransportKgCo2ePerKg: number;
      avoidedVsLandfillPerKgFood: number;
      avoidedVsLandfillPerKgGarden: number;
      avoidedVsGreenBinPerKg: number;
      bokashiCompostingKgCo2ePerKg?: number;
      avoidedVsLandfillBokashiPerKgFood?: number;
    };
    sources: { label: string; url: string }[];
    assumptions: string[];
    invoicingStart: string | null;
  };
  generatedAt: string;
}

export type FetchResult =
  | { status: 'ok'; report: ImpactReport }
  | { status: 'notfound' }
  | { status: 'error' };

export async function fetchImpact(code: string, signal?: AbortSignal): Promise<FetchResult> {
  try {
    const res = await fetch(`${IMPACT_API}?code=${encodeURIComponent(code)}`, { signal });
    if (res.status === 404) return { status: 'notfound' };
    if (!res.ok) return { status: 'error' };
    return { status: 'ok', report: (await res.json()) as ImpactReport };
  } catch {
    return { status: 'error' };
  }
}

// ───────────── year grouping (client-side, any start month) ─────────────

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export interface YearGroup {
  label: string;
  startYear: number;
  pickups: number;
  litres: number;
  kg: number;
  co2eVsLandfillKg: number; // conservative: official MfE composting factor
  co2eOurKg: number; // headline: Green Loop bokashi estimate
}

/** Headline CO2e: the bokashi estimate, falling back to the official figure for older API responses. */
export const ourCo2e = (r: { co2eVsLandfillKg: number; co2eVsLandfillBokashiKg?: number }) =>
  r.co2eVsLandfillBokashiKg ?? r.co2eVsLandfillKg;

export function groupByYear(months: MonthRow[], startMonth: number): YearGroup[] {
  const map = new Map<number, YearGroup>();
  for (const m of months) {
    const y = Number(m.month.slice(0, 4));
    const mo = Number(m.month.slice(5, 7));
    const startYear = mo >= startMonth ? y : y - 1;
    let g = map.get(startYear);
    if (!g) {
      const endMonth = startMonth === 1 ? 12 : startMonth - 1;
      const label = startMonth === 1
        ? String(startYear)
        : `${MONTH_SHORT[startMonth - 1]} ${startYear} – ${MONTH_SHORT[endMonth - 1]} ${startYear + 1}`;
      g = { label, startYear, pickups: 0, litres: 0, kg: 0, co2eVsLandfillKg: 0, co2eOurKg: 0 };
      map.set(startYear, g);
    }
    g.pickups += m.pickups;
    g.litres += m.litres;
    g.kg += m.kg;
    g.co2eVsLandfillKg += m.co2eVsLandfillKg;
    g.co2eOurKg += ourCo2e(m);
  }
  return [...map.values()].sort((a, b) => b.startYear - a.startYear); // newest first
}

// ───────────── formatting ─────────────

const nf0 = new Intl.NumberFormat('en-NZ', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('en-NZ', { maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('en-NZ', { maximumFractionDigits: 2 });

export const fmtInt = (n: number) => nf0.format(n);
export const fmt1 = (n: number) => nf1.format(n);
export const fmtKg = (kg: number) => `${nf0.format(kg)} kg`;
export const fmtTonnes = (kg: number) => `${nf2.format(kg / 1000)} t`;
/** "4,673 kg" or, from 1000 kg, "4.67 t". */
export const fmtMass = (kg: number) => (kg >= 1000 ? fmtTonnes(kg) : fmtKg(kg));

export function fmtMonth(ym: string): string {
  return `${MONTH_SHORT[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
}

export function fmtDate(iso: string | null): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTH_SHORT[m - 1]} ${y}`;
}

export function slugify(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'business';
}

// ───────────── year-start preference (per viewer) ─────────────

const lsKey = (code: string) => `impact-year-start:${code}`;

export function readStoredYearStart(code: string): number | null {
  try {
    const v = Number(localStorage.getItem(lsKey(code)));
    return v >= 1 && v <= 12 ? v : null;
  } catch {
    return null;
  }
}

export function storeYearStart(code: string, m: number): void {
  try {
    localStorage.setItem(lsKey(code), String(m));
  } catch { /* storage unavailable: preference just isn't remembered */ }
}

/**
 * The Green Loop logo, cropped to the roundel and shrunk for embedding (the source file is ~360 KB).
 * Drawn as a white disc on `bg` so it sits cleanly on a coloured header (JPEG has no transparency).
 */
export async function loadLogoDataUrl(size = 240, bg = '#2d8b4e'): Promise<string> {
  const img = new Image();
  img.src = '/green-loop-logo.jpg';
  await img.decode();
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('no canvas');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.clip();
  // The 1688px source has a wide white margin; the roundel sits in the middle ~1360px.
  const crop = img.naturalWidth * 0.806;
  const off = (img.naturalWidth - crop) / 2;
  ctx.drawImage(img, off, off, crop, crop, 0, 0, size, size);
  return c.toDataURL('image/jpeg', 0.9);
}
