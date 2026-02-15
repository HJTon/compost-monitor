export interface CompostSystem {
  id: string;
  name: string;
  shortName: string;
  sheetTab: string;
  active: boolean;
  probeLabels: string[];
}

export interface ProbeReading {
  probeIndex: number;
  label: string;
  value: number | null;
}

export type WeatherCondition = 'Sunny' | 'Cloudy' | 'Overcast' | 'Rain' | 'Wind' | 'Frost' | 'Fog' | 'Storm';
export type MoistureLevel = 'Dry' | 'Good' | 'Wet';
export type OdourLevel = 'None' | 'Mild' | 'Strong';
export type TempEntryMode = 'stepper' | 'grid';

export interface DailyEntry {
  id: string;
  systemId: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  weather: WeatherCondition | null;
  weatherAuto: boolean;
  ambientMin: number | null;
  ambientMax: number | null;
  ambientMinAuto: boolean;
  ambientMaxAuto: boolean;
  moisture: MoistureLevel | null;
  odour: OdourLevel | null;
  probes: ProbeReading[];
  averageTemp: number | null;
  peakTemp: number | null;
  killCycleDays: number;
  ventTemps: string;
  visualNotes: string;
  generalNotes: string;
  mediaIds: string[];
  synced: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SyncQueueItem {
  id: string;
  entryId: string;
  type: 'entry' | 'media';
  status: 'pending' | 'syncing' | 'failed';
  retryCount: number;
  lastAttempt: string | null;
  createdAt: string;
}

export interface MediaItem {
  id: string;
  entryId: string;
  type: 'photo' | 'video';
  mimeType: string;
  blob: Blob | null;
  base64: string | null; // photos stored as base64
  thumbnailBase64: string | null;
  driveUrl: string | null;
  driveFileId: string | null;
  filename: string;
  synced: boolean;
  createdAt: string;
}

export interface WeatherCache {
  id: string; // date string YYYY-MM-DD
  data: WeatherData;
  fetchedAt: string;
}

export interface WeatherData {
  condition: WeatherCondition;
  weatherCode: number;
  currentTemp: number;
  minTemp: number;
  maxTemp: number;
}

export interface KillCycleData {
  systemId: string;
  consecutiveDays: number;
  totalKillDays: number;
  lastKillDate: string | null;
  isActive: boolean; // currently above kill threshold
}

export interface AppSettings {
  entryMode: TempEntryMode;
  activeSystems: string[];
  farmLatitude: number;
  farmLongitude: number;
  lastSyncTime: string | null;
}

export interface SheetRowData {
  date: string;
  time: string;
  weather: string;
  ambientMin: number | null;
  ambientMax: number | null;
  moisture: string;
  odour: string;
  probes: (number | null)[];
  average: number | null;
  peak: number | null;
  ventTemps: string;
  visualNotes: string;
  generalNotes: string;
  photoLinks: string;
}
