export type BuildShape = 'cuboid' | 'cylinder';

export interface BuildDimensions {
  shape: BuildShape;
  /** Length in cm (cuboid only) */
  lengthCm?: number;
  /** Width in cm (cuboid only) */
  widthCm?: number;
  /** Diameter at widest point in cm (cylinder only) */
  diameterCm?: number;
  /** Initial height in cm */
  heightCm?: number;
}

export interface CompostSystem {
  id: string;
  name: string;
  shortName: string;
  sheetTab: string;
  active: boolean;
  probeLabels: string[];
  /** Build type e.g. "Standard Johnson Su" */
  buildType?: string;
  /** Number of wheelie bins of mulch added */
  mulchBins?: number;
  /** Mulch type e.g. "fine", "medium", "chunky" */
  mulchType?: string;
  /** Shape and initial dimensions for volume calculation */
  dimensions?: BuildDimensions;
}

export interface ProbeReading {
  probeIndex: number;
  label: string;
  value: number | null;
}

export type WeatherCondition = 'Sunny' | 'Cloudy' | 'Overcast' | 'Rain' | 'Wind' | 'Frost' | 'Fog' | 'Storm';
export type MoistureLevel = 'Dry' | 'Good' | 'Wet';
export type OdourLevel = '1' | '2' | '3' | '4' | '5';
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
  /** Pile height in cm — optional, prompted every 2 weeks */
  height: number | null;
  /** Whether this entry marks a turn */
  turn?: boolean;
  /** New bay width in cm — recorded when turn changes dimensions */
  newWidth?: number | null;
  /** New bay length in cm — recorded when turn changes dimensions */
  newLength?: number | null;
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
  /** User-defined build types (dropdown options) */
  customBuildTypes?: string[];
  /** User-defined mulch types (dropdown options) */
  customMulchTypes?: string[];
}

export interface ContaminationRecord {
  id: string;
  businessName: string;
  binSerial: string;
  collectionDate: string;
  photoBase64: string | null;
  reportedAt: string;
}

export interface BusinessInfo {
  /** The business name as it appears in Bin Tracker "Content from" */
  name: string;
  /** 'business' or 'event' — defaults to 'business' */
  category: 'business' | 'event';
  /** Category of business e.g. Cafe, Hotel, Office, Restaurant */
  businessType: string;
  /** Type of waste this business produces e.g. Food scraps, Coffee grounds */
  wasteType: string;
  /** Hidden from the list (soft-deleted to clean up duplicates/misspellings) */
  hidden?: boolean;
  /** Contamination incidents */
  contaminations: ContaminationRecord[];
}

export interface ReadinessResults {
  bacterialBiomass: number | null;
  bacterialStdDev: number | null;
  bacterialStdDevPct: number | null;
  actinobacterialBiomass: number | null;
  actinobacterialStdDev: number | null;
  fungalBiomass: number | null;
  fungalStdDev: number | null;
  fungalStdDevPct: number | null;
  fungalDiameter: number | null;
  fbRatio: number | null;
  totalProtozoa: number | null;
  flagellates: number | null;
  flagellatesStdDev: number | null;
  amoebae: number | null;
  amoebaeStdDev: number | null;
  bacterialFeedingNematodes: number | null;
  fungalFeedingNematodes: number | null;
  predatoryNematodes: number | null;
  // Detrimental
  oomycetesBiomass: number | null;
  ciliates: number | null;
  ciliatesStdDev: number | null;
  rootFeedingNematodes: number | null;
}

export interface ReadinessCheck {
  id: string;
  systemId: string;
  date: string; // YYYY-MM-DD
  label?: string; // optional label e.g. "Pre-turn", "Final"
  results: ReadinessResults;
  createdAt: string;
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
