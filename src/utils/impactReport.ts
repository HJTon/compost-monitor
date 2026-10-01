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
  containers: number | null; // this business's own bins + buckets (null: only older, unmeasured records)
  litres?: number;
  estimated?: boolean;
  stage?: string; // "Hot composting" | "Maturing" | "Finished compost, in use"; absent when unknown
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
  compostDestination?: { kind: 'food' | 'garden'; names: string[] }; // absent on older API responses
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
  start: string; // YYYY-MM-DD, first day of the reporting year
  end: string; // YYYY-MM-DD, last day of the reporting year (may be in the future)
  pickups: number;
  bins: number;
  buckets: number;
  litres: number;
  measuredLitres: number;
  estimatedLitres: number;
  kg: number;
  scope3Kg: number; // Scope 3 Cat. 5: kg x official MfE composting factor (an inventory figure)
  co2eVsLandfillKg: number; // conservative: official MfE composting factor
  co2eOurKg: number; // headline: Green Loop bokashi estimate
}

/** Headline CO2e: the bokashi estimate, falling back to the official figure for older API responses. */
export const ourCo2e = (r: { co2eVsLandfillKg: number; co2eVsLandfillBokashiKg?: number }) =>
  r.co2eVsLandfillBokashiKg ?? r.co2eVsLandfillKg;

/** Official MfE composting factor (kg CO2e per kg), used when an older API response lacks it. */
export const DEFAULT_COMPOSTING_FACTOR = 0.1756;

/** Scope 3 (GHG Protocol Category 5, waste generated in operations): kg x the OFFICIAL composting factor. */
export const scope3Of = (kg: number, factor: number) => kg * factor;

const pad2 = (n: number) => String(n).padStart(2, '0');
const todayLocal = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };

export function groupByYear(months: MonthRow[], startMonth: number, factor = DEFAULT_COMPOSTING_FACTOR): YearGroup[] {
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
      const endY = startMonth === 1 ? startYear : startYear + 1;
      const lastDay = new Date(Date.UTC(endY, endMonth, 0)).getUTCDate();
      g = {
        label, startYear,
        start: `${startYear}-${pad2(startMonth)}-01`,
        end: `${endY}-${pad2(endMonth)}-${pad2(lastDay)}`,
        pickups: 0, bins: 0, buckets: 0, litres: 0, measuredLitres: 0, estimatedLitres: 0, kg: 0, scope3Kg: 0, co2eVsLandfillKg: 0, co2eOurKg: 0,
      };
      map.set(startYear, g);
    }
    g.pickups += m.pickups;
    g.bins += m.bins;
    g.buckets += m.buckets;
    g.litres += m.litres;
    g.measuredLitres += m.measuredLitres;
    g.estimatedLitres += m.estimatedLitres;
    g.kg += m.kg;
    g.scope3Kg += scope3Of(m.kg, factor);
    g.co2eVsLandfillKg += m.co2eVsLandfillKg;
    g.co2eOurKg += ourCo2e(m);
  }
  return [...map.values()].sort((a, b) => b.startYear - a.startYear); // newest first
}

/** Default statement year: the most recent COMPLETE reporting year if any, else the newest (in progress). */
export function defaultStatementYear(years: YearGroup[], today = todayLocal()): YearGroup | undefined {
  return years.find((g) => g.end < today) ?? years[0];
}
export const isToDate = (g: YearGroup, today = todayLocal()) => g.end >= today;
/** Period end shown to readers: capped at today. */
export const periodEnd = (g: YearGroup, today = todayLocal()) => (g.end > today ? today : g.end);

// ───────────── shared wording ─────────────

const joinNames = (names: string[]) => (names.length <= 1 ? names[0] ?? '' : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

/** "Where your compost goes" sentence, driven by the API's compostDestination (null if the API doesn't send it). */
export function compostDestinationLine(report: ImpactReport): string | null {
  const d = report.compostDestination;
  if (!d || !d.names.length) return null;
  const names = joinNames(d.names);
  return d.kind === 'garden'
    ? `Your green waste is composted at ${names}.`
    : `Finished compost from your food waste goes to ${names}, where it builds soil for growing.`;
}

export const DIVERSION_NOTE = 'To work out your overall diversion rate, add this to your other diverted streams (recycling, etc.) and divide by your total waste (diverted plus landfill).';
export const SDG_TITLE = 'UN Sustainable Development Goals';
export const SDG_TAGS = ['12.3 Halve food waste', '12.5 Reduce waste generation', '13 Climate action', '15 Life on land (soil health)'];
export const SCOPE3_TITLE = 'Your emissions from food waste (Scope 3, Category 5: waste generated in operations)';
export const SCOPE3_NOTE = 'This is the figure to include in your carbon inventory. The "emissions avoided" figure is for your sustainability story and must not be subtracted from your footprint.';

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

// ───────────── CSV download ─────────────

const csvCell = (v: string | number) => {
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const num = (n: number, dp: number) => String(Number(n.toFixed(dp)));

export function buildImpactCsv(report: ImpactReport): string {
  const factor = report.methodology.factors.compostingKgCo2ePerKg ?? DEFAULT_COMPOSTING_FACTOR;
  const inv = report.methodology.invoicingStart?.slice(0, 7) ?? null;
  const rows: (string | number)[][] = [[
    'Month (YYYY-MM)', 'Collections', 'Wheelie bins', 'Buckets', 'Litres', 'Kg', 'Measured litres', 'Estimated litres', 'Data basis',
    'Scope 3 emissions kg CO2e (MfE composting factor)', 'Emissions avoided vs landfill kg CO2e (MfE factors)', 'Emissions avoided incl. bokashi kg CO2e (Green Loop estimate)',
  ]];
  for (const m of report.months) { // oldest first
    rows.push([
      m.month, m.pickups, num(m.bins, 2), num(m.buckets, 2), num(m.litres, 1), num(m.kg, 1), num(m.measuredLitres, 1), num(m.estimatedLitres, 1),
      inv && m.month < inv ? 'estimated from farm records' : 'measured+estimated',
      num(scope3Of(m.kg, factor), 2), num(m.co2eVsLandfillKg, 1), num(ourCo2e(m), 1),
    ]);
  }
  return '\ufeff' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export function downloadImpactCsv(report: ImpactReport): void {
  const blob = new Blob([buildImpactCsv(report)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `green-loop-impact-${slugify(report.business)}-${todayLocal()}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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

/** Piles table cells: the business's own bins/buckets and litres in the pile ("~" = estimated). */
export const pileContainers = (p: { containers: number | null }) => (p.containers == null ? '—' : fmt1(p.containers));
export const pileLitres = (p: { litres?: number; estimated?: boolean }) =>
  p.litres == null ? '—' : `${p.estimated ? '~' : ''}${fmtInt(p.litres)}`;
