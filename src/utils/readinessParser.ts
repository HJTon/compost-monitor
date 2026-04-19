import type { ReadinessResults } from '@/types';

/**
 * Parse a readiness check CSV (from soil biology lab) into structured results.
 * The CSV format is: "Metric Name,Value" with two sections separated by
 * "Detrimental Microorganisms,".
 */
export function parseReadinessCSV(csvText: string): ReadinessResults {
  const results: ReadinessResults = {
    bacterialBiomass: null,
    bacterialStdDev: null,
    bacterialStdDevPct: null,
    actinobacterialBiomass: null,
    actinobacterialStdDev: null,
    fungalBiomass: null,
    fungalStdDev: null,
    fungalStdDevPct: null,
    fungalDiameter: null,
    fbRatio: null,
    totalProtozoa: null,
    flagellates: null,
    flagellatesStdDev: null,
    amoebae: null,
    amoebaeStdDev: null,
    bacterialFeedingNematodes: null,
    fungalFeedingNematodes: null,
    predatoryNematodes: null,
    oomycetesBiomass: null,
    ciliates: null,
    ciliatesStdDev: null,
    rootFeedingNematodes: null,
  };

  const lines = csvText.split('\n').map(l => l.trim()).filter(Boolean);

  for (const line of lines) {
    // Split on first comma only
    const commaIdx = line.indexOf(',');
    if (commaIdx < 0) continue;
    const key = line.slice(0, commaIdx).trim().toLowerCase();
    const rawVal = line.slice(commaIdx + 1).trim();
    const val = parseFloat(rawVal.replace('%', ''));
    if (isNaN(val) && rawVal !== '0') continue;
    const num = isNaN(val) ? 0 : val;

    if (key.startsWith('bacterial biomass')) results.bacterialBiomass = num;
    else if (key.startsWith('bacterial standard deviation biomass')) results.bacterialStdDev = num;
    else if (key.startsWith('bacterial standard deviation as')) results.bacterialStdDevPct = num;
    else if (key.startsWith('actinobacterial biomass')) results.actinobacterialBiomass = num;
    else if (key.startsWith('actinobacterial standard deviation')) results.actinobacterialStdDev = num;
    else if (key.startsWith('fungal biomass')) results.fungalBiomass = num;
    else if (key.startsWith('fungal standard deviation biomass')) results.fungalStdDev = num;
    else if (key.startsWith('fungal standard deviation as')) results.fungalStdDevPct = num;
    else if (key.startsWith('fungal average diameter')) results.fungalDiameter = num;
    else if (key.startsWith('f:b ratio')) results.fbRatio = num;
    else if (key.startsWith('total beneficial protozoa') && !key.includes('standard')) results.totalProtozoa = num;
    else if (key.startsWith('flagellates') && !key.includes('standard')) results.flagellates = num;
    else if (key.startsWith('flagellates standard')) results.flagellatesStdDev = num;
    else if (key.startsWith('amoebae') && !key.includes('standard')) results.amoebae = num;
    else if (key.startsWith('amoebae standard deviation (')) results.amoebaeStdDev = num;
    else if (key.startsWith('bacterial-feeding')) results.bacterialFeedingNematodes = num;
    else if (key.startsWith('fungal-feeding')) results.fungalFeedingNematodes = num;
    else if (key.startsWith('predatory nematodes')) results.predatoryNematodes = num;
    else if (key.startsWith('oomycetes biomass') || key.startsWith('oomycete biomass')) results.oomycetesBiomass = num;
    else if (key.startsWith('ciliates') && !key.includes('standard')) results.ciliates = num;
    else if (key.startsWith('ciliates standard')) results.ciliatesStdDev = num;
    else if (key.startsWith('root-feeding')) results.rootFeedingNematodes = num;
  }

  return results;
}

/**
 * Try to extract a date from the CSV filename (e.g. "Results_2026-04-06.csv")
 */
export function extractDateFromFilename(filename: string): string | null {
  const m = filename.match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

/** Key metrics for the summary cards */
export interface ReadinessSummary {
  label: string;
  value: string;
  unit: string;
  category: 'beneficial' | 'detrimental' | 'ratio';
}

export function getReadinessSummary(r: ReadinessResults): ReadinessSummary[] {
  const fmt = (v: number | null, decimals = 0) =>
    v === null ? '—' : v.toLocaleString('en-NZ', { maximumFractionDigits: decimals });

  return [
    { label: 'Bacterial Biomass', value: fmt(r.bacterialBiomass, 0), unit: 'ug/g', category: 'beneficial' },
    { label: 'Fungal Biomass', value: fmt(r.fungalBiomass, 0), unit: 'ug/g', category: 'beneficial' },
    { label: 'F:B Ratio', value: fmt(r.fbRatio, 3), unit: '', category: 'ratio' },
    { label: 'Actinobacteria', value: fmt(r.actinobacterialBiomass, 1), unit: 'ug/g', category: 'beneficial' },
    { label: 'Total Protozoa', value: fmt(r.totalProtozoa, 0), unit: '/g', category: 'beneficial' },
    { label: 'Flagellates', value: fmt(r.flagellates, 0), unit: '/g', category: 'beneficial' },
    { label: 'Amoebae', value: fmt(r.amoebae, 0), unit: '/g', category: 'beneficial' },
    { label: 'Bact. Nematodes', value: fmt(r.bacterialFeedingNematodes, 0), unit: '/g', category: 'beneficial' },
    { label: 'Fungal Nematodes', value: fmt(r.fungalFeedingNematodes, 0), unit: '/g', category: 'beneficial' },
    { label: 'Predatory Nematodes', value: fmt(r.predatoryNematodes, 0), unit: '/g', category: 'beneficial' },
    { label: 'Oomycetes', value: fmt(r.oomycetesBiomass, 0), unit: 'ug/g', category: 'detrimental' },
    { label: 'Ciliates', value: fmt(r.ciliates, 0), unit: '/g', category: 'detrimental' },
    { label: 'Root-feeding Nem.', value: fmt(r.rootFeedingNematodes, 0), unit: '/g', category: 'detrimental' },
  ];
}
