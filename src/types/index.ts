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

export type BuildPhase = 'thermophilic' | 'maturation' | 'grow';

export interface MaturationInfo {
  /** Container type e.g. "Volumatic bin", "IBC" */
  containerType: string;
  /** Placement: "In-ground", "On-ground", "Above-ground" */
  placement: string;
  /** Cover: "Open", "Closed" */
  coverType: string;
  /** When maturation phase started (YYYY-MM-DD) */
  startedAt: string;
}

export interface GrowTrial {
  id: string;
  /** Method e.g. "As mulch", "Top dress", "Trench at side", "Plant directly in" */
  method: string;
  /** Crop e.g. "Pumpkin", "Potatoes", "Comfrey" */
  crop: string;
  /** Optional free-form notes about the trial */
  notes?: string;
  createdAt: string;
}

export interface GrowInfo {
  /** When grow phase started (YYYY-MM-DD) */
  startedAt: string;
  trials: GrowTrial[];
}

export interface CompostSystem {
  id: string;
  name: string;
  shortName: string;
  sheetTab: string;
  active: boolean;
  probeLabels: string[];
  /** Date the pile was physically built (YYYY-MM-DD). Canonical; editable. */
  buildDate?: string;
  /** Build type e.g. "Standard Johnson Su" */
  buildType?: string;
  /** Number of wheelie bins of mulch added */
  mulchBins?: number;
  /** Mulch type e.g. "fine", "medium", "chunky" */
  mulchType?: string;
  /** Shape and initial dimensions for volume calculation */
  dimensions?: BuildDimensions;
  /** Current phase of the build. Default is 'thermophilic'. */
  phase?: BuildPhase;
  /** Maturation-phase metadata — set when phase moves to 'maturation' */
  maturation?: MaturationInfo;
  /** Grow-phase metadata — set when phase moves to 'grow' */
  grow?: GrowInfo;
}

export interface ProbeReading {
  probeIndex: number;
  label: string;
  value: number | null;
}

export type WeatherCondition = 'Sunny' | 'Cloudy' | 'Overcast' | 'Rain' | 'Wind' | 'Frost' | 'Fog' | 'Storm';

/** Observation intensity: 0 = absent/not recorded; 1 = present; 2 = +; 3 = ++; 4 = +++ */
export type ObservationIntensity = 0 | 1 | 2 | 3 | 4;

export type ObservationKey =
  | 'fruitFlies' | 'flies' | 'mites' | 'birds' | 'rats'
  | 'inkyCaps' | 'mushrooms' | 'fungus' | 'seedlings';

export type Observations = Partial<Record<ObservationKey, ObservationIntensity>>;
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
  /** Wildlife + plant/fungi observations for this day */
  observations?: Observations;
  synced: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SyncQueueItem {
  id: string;
  /** For 'entry' items: the DailyEntry id. For 'media' items: the MediaItem id. For 'sample' items: the sample id (e.g. "S9"). */
  entryId: string;
  type: 'entry' | 'media' | 'sample';
  status: 'pending' | 'syncing' | 'failed';
  retryCount: number;
  lastAttempt: string | null;
  createdAt: string;
  /** Don't attempt again before this time (exponential backoff). Manual "Sync now" ignores it. */
  nextAttemptAt?: string | null;
  /** True when the failure can never succeed (e.g. file too large) — excluded from retries and pending count. */
  permanent?: boolean;
  /** Human-readable reason for the last failure. */
  lastError?: string;
  /** Type-specific data — for 'sample' items, { rows: [...] } for compost-sampling-write. */
  payload?: unknown;
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
  /** Display/input unit for probe temperatures on the Let's Measure page. Defaults to 'C'. Internal storage stays in °F. */
  tempUnit?: 'F' | 'C';
  activeSystems: string[];
  farmLatitude: number;
  farmLongitude: number;
  lastSyncTime: string | null;
  /** User-defined build types (dropdown options) */
  customBuildTypes?: string[];
  /** User-defined mulch types (dropdown options) */
  customMulchTypes?: string[];
  /** User-defined maturation container types (added to the default list) */
  customContainerTypes?: string[];
  /** User-defined maturation placement options (added to the defaults) */
  customPlacements?: string[];
  /** User-defined maturation cover options (added to the defaults) */
  customCoverTypes?: string[];
  /** User-defined grow-trial methods (added to the defaults) */
  customTrialMethods?: string[];
  /** User-defined grow-trial crops (added to the defaults) */
  customTrialCrops?: string[];
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
