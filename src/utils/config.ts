import type { CompostSystem, AppSettings } from '@/types';

// The 9 probe positions in walking order for the stepper
const STANDARD_PROBES = [
  'Core Centre',
  'Core Left',
  'Core Right',
  'Mid Centre',
  'Mid Left',
  'Mid Right',
  'Edge Centre',
  'Edge Left',
  'Edge Right',
];

export const COMPOST_SYSTEMS: CompostSystem[] = [
  { id: 'pivot-1', name: 'Pivot #1', shortName: 'P1', sheetTab: 'Pivot #1', active: true, probeLabels: STANDARD_PROBES },
  { id: 'pivot-2', name: 'Pivot #2', shortName: 'P2', sheetTab: 'Pivot #2', active: true, probeLabels: STANDARD_PROBES },
  { id: 'pivot-3', name: 'Pivot #3', shortName: 'P3', sheetTab: 'Pivot #3', active: true, probeLabels: STANDARD_PROBES },
  { id: 'pivot-4', name: 'Pivot #4', shortName: 'P4', sheetTab: 'Pivot #4', active: true, probeLabels: STANDARD_PROBES },
  { id: 'carbon-cube-2', name: 'Carbon Cube Cycle 2', shortName: 'CC2', sheetTab: 'Carbon Cube Cycle 2', active: true, probeLabels: STANDARD_PROBES },
  { id: 'cylinder-1', name: 'Cylinder #1', shortName: 'C1', sheetTab: 'Cylinder #1', active: true, probeLabels: STANDARD_PROBES },
  { id: 'cylinder-2', name: 'Cylinder #2', shortName: 'C2', sheetTab: 'Cylinder #2', active: true, probeLabels: STANDARD_PROBES },
  { id: 'cylinder-3', name: 'Cylinder #3', shortName: 'C3', sheetTab: 'Cylinder #3', active: true, probeLabels: STANDARD_PROBES },
  { id: 'batch-1', name: 'Batch 1', shortName: 'B1', sheetTab: 'Batch 1', active: true, probeLabels: STANDARD_PROBES },
  { id: 'batch-2', name: 'Batch 2', shortName: 'B2', sheetTab: 'Batch 2', active: true, probeLabels: STANDARD_PROBES },
  { id: 'batch-3', name: 'Batch 3', shortName: 'B3', sheetTab: 'Batch 3', active: true, probeLabels: STANDARD_PROBES },
];

// Kill cycle threshold: 131°F (55°C) for 3 consecutive days
export const KILL_TEMP_F = 131;
export const KILL_TEMP_C = 55;
export const KILL_DAYS_REQUIRED = 3;

// Temperature colour thresholds (in °F)
export const TEMP_COLD_MAX = 100;
export const TEMP_WARM_MAX = 130;
export const TEMP_HOT_MAX = 160;

// Default settings
export const DEFAULT_SETTINGS: AppSettings = {
  entryMode: 'stepper',
  activeSystems: COMPOST_SYSTEMS.map(s => s.id),
  farmLatitude: -39.06,
  farmLongitude: 174.08,
  lastSyncTime: null,
};

// Spreadsheet ID
export const SPREADSHEET_ID = '1dY7TxghJegPDWUZF51QRmLhWUXVFBcdK5BYzOLsbNAo';

// Weather code mapping (WMO standard)
export const WMO_CODE_MAP: Record<number, string> = {
  0: 'Sunny', 1: 'Sunny',
  2: 'Cloudy', 3: 'Overcast',
  45: 'Fog', 48: 'Fog',
  51: 'Rain', 53: 'Rain', 55: 'Rain',
  56: 'Rain', 57: 'Rain',
  61: 'Rain', 63: 'Rain', 65: 'Rain',
  66: 'Rain', 67: 'Rain',
  71: 'Frost', 73: 'Frost', 75: 'Frost',
  77: 'Frost',
  80: 'Rain', 81: 'Rain', 82: 'Rain',
  85: 'Frost', 86: 'Frost',
  95: 'Storm', 96: 'Storm', 99: 'Storm',
};

export function getSystemById(id: string): CompostSystem | undefined {
  return COMPOST_SYSTEMS.find(s => s.id === id);
}

export function getTempColor(tempF: number): string {
  if (tempF < TEMP_COLD_MAX) return 'text-temp-cold bg-blue-50';
  if (tempF <= TEMP_WARM_MAX) return 'text-temp-warm bg-green-50';
  if (tempF <= TEMP_HOT_MAX) return 'text-temp-hot bg-amber-50';
  return 'text-temp-danger bg-red-50';
}

export function getTempBorderColor(tempF: number): string {
  if (tempF < TEMP_COLD_MAX) return 'border-blue-300';
  if (tempF <= TEMP_WARM_MAX) return 'border-green-300';
  if (tempF <= TEMP_HOT_MAX) return 'border-amber-300';
  return 'border-red-300';
}

// Get NZ timezone date string
export function getNZDate(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Pacific/Auckland' });
}

export function getNZTime(): string {
  return new Date().toLocaleTimeString('en-GB', {
    timeZone: 'Pacific/Auckland',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
