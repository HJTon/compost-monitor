// Which farm a request is for, and which spreadsheet / Drive folder that farm's data lives in.
//
// Every farm has its own spreadsheet for its builds (one tab per pile, Build Info, Media, Build
// Phases, Trial Runs, Readiness Checks, Sampling Log) and its own Drive folder for photos.
// A few tabs are SHARED across farms and always live in the original (Eudaimonia) spreadsheet:
// the Bin Tracker (written by the Green Loop collector app, col O says which farm a bin went to)
// and the pick-lists both farms should agree on.
//
// The client says which farm it is with an `X-Farm` header (or `?farm=`). Requests without one
// are Eudaimonia, so clients from before multi-farm keep working unchanged.
//
// A farm whose env vars aren't set is an ERROR, never a fallback to Eudaimonia's sheet: falling
// back would quietly write one farm's readings into the other's spreadsheet.
//
// See docs/multi-farm-plan.md.

export const DEFAULT_FARM = 'eudaimonia';

interface FarmEnv {
  /** Display name, exactly as the collector app writes it in Bin Tracker col O. */
  name: string;
  /** Env var holding this farm's spreadsheet id. */
  sheetEnv: string;
  /** Env var holding this farm's Drive media folder id. */
  driveEnv: string;
}

const FARMS: Record<string, FarmEnv> = {
  eudaimonia: { name: 'Eudaimonia', sheetEnv: 'COMPOST_SPREADSHEET_ID', driveEnv: 'COMPOST_DRIVE_FOLDER_ID' },
  'kahu-glen': { name: 'Kahu Glen', sheetEnv: 'COMPOST_SPREADSHEET_ID_KAHU_GLEN', driveEnv: 'COMPOST_DRIVE_FOLDER_ID_KAHU_GLEN' },
};

/** Tabs that live in the shared spreadsheet whichever farm is asking. */
export const SHARED_TABS = new Set(['Bin Tracker', 'Build Types', 'Trial Methods', 'Trial Crops']);

export class FarmError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** The farm key a request is for. Throws FarmError (400) for a farm that doesn't exist. */
export function farmFrom(request: Request): string {
  const raw = request.headers.get('x-farm') || new URL(request.url).searchParams.get('farm') || '';
  const farm = raw.trim().toLowerCase() || DEFAULT_FARM;
  if (!FARMS[farm]) throw new FarmError(`Unknown farm "${raw}"`, 400);
  return farm;
}

function envOrThrow(name: string, what: string): string {
  const value = process.env[name];
  if (!value) throw new FarmError(`${what} not configured (${name})`, 500);
  return value;
}

/** The spreadsheet holding the shared tabs (Bin Tracker, pick-lists). */
export function sharedSheetId(): string {
  return envOrThrow(FARMS[DEFAULT_FARM].sheetEnv, 'Shared spreadsheet');
}

/** The spreadsheet holding this request's farm's own tabs. */
export function farmSheetId(request: Request): string {
  const farm = farmFrom(request);
  return envOrThrow(FARMS[farm].sheetEnv, `Spreadsheet for farm "${farm}"`);
}

/** The spreadsheet a given tab lives in for this request: shared tabs → shared sheet. */
export function sheetIdForTab(request: Request, tab: string): string {
  return SHARED_TABS.has(tab) ? sharedSheetId() : farmSheetId(request);
}

/** The Drive folder holding this request's farm's photos and videos. */
export function farmDriveFolderId(request: Request): string {
  const farm = farmFrom(request);
  return envOrThrow(FARMS[farm].driveEnv, `Drive folder for farm "${farm}"`);
}

/** The farm's display name, as used in Bin Tracker col O. */
export function farmName(request: Request): string {
  return FARMS[farmFrom(request)].name;
}

// ─── Bin Tracker: which farm a bin is at ─────────────────────────────────────
// Bin Tracker links a bin to its build only by build name (col K), and two farms can each
// have a build called "Pile 1". So every lookup of "this build's bins" must also check the
// bin's farm (col O, written by the collector app). Blank col O = Eudaimonia: those rows
// predate the column, and the collector app's impact reports read them the same way.
const BIN_FARM_COL = 14; // O

/** Index of the Farm column, from the header row when it has one, else col O. */
export function binFarmColumn(header: unknown[] | undefined): number {
  const i = (header || []).findIndex(h => String(h ?? '').trim().toLowerCase() === 'farm');
  return i === -1 ? BIN_FARM_COL : i;
}

/** True when the request names its farm (multi-farm client), not a pre-multi-farm one. */
export function farmIsExplicit(request: Request): boolean {
  return !!(request.headers.get('x-farm') || new URL(request.url).searchParams.get('farm'));
}

/**
 * True when a Bin Tracker row's bin is at this request's farm. A request that doesn't name a
 * farm sees every bin, exactly as before multi-farm, so the current app keeps working while
 * Kahu Glen bins are still being built from it.
 */
export function binIsAtFarm(row: unknown[], request: Request, farmCol = BIN_FARM_COL): boolean {
  if (!farmIsExplicit(request)) return true;
  const farm = String(row[farmCol] ?? '').trim() || FARMS[DEFAULT_FARM].name;
  return farm.toLowerCase() === farmName(request).toLowerCase();
}

/** Response headers so the Netlify edge cache keeps each farm's responses apart. */
export const FARM_VARY_HEADERS = {
  'Netlify-Vary': 'header=X-Farm',
  Vary: 'X-Farm',
} as const;

