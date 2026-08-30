import type { CompostSystem, TrialPot, TrialRun } from '@/types';
import { getNZDate } from './config';

// ── The practice run ─────────────────────────────────────────────────────────
//
// A made-up germination run for the sandbox. It is deliberately mid-flight and
// deliberately uneven: each demo pile sits in a different state, so every
// verdict the real assay can produce is already on screen when the page opens.
// Learning what "germination inhibition" looks like shouldn't require typing
// twelve numbers first.
//
// Names are obviously fake ("Demo pile A") so nobody mistakes a practice result
// for a real one. Dates are relative to today, so the run never looks stale.

export const SANDBOX_RUN_ID = 'sandbox-germination';

/** YYYY-MM-DD, `days` before today. */
function daysAgo(days: number): string {
  const d = new Date(`${getNZDate()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export function sandboxDates() {
  return {
    sown: daysAgo(12),
    observations: [daysAgo(9), daysAgo(8), daysAgo(6), daysAgo(2)],
  };
}

/** Fully sorted pot: classes sum to the germination count, so the check passes. */
function sortedPot(
  pot: number,
  counts: number[],
  dates: string[],
  classes: [number, number, number, number],
  broken: number,
  extra: Record<string, string> = {},
): TrialPot {
  return {
    pot,
    seedsSown: 25,
    counts: counts.map((count, i) => ({ date: dates[i], count })),
    measurements: {
      sizeClass1: classes[0],
      sizeClass2: classes[1],
      sizeClass3: classes[2],
      sizeClass4: classes[3],
      brokenUnclassifiable: broken,
      lateralRoots: 'Branched',
      rootIntegrity: 'Robust',
      rootColour: 'White / healthy',
      yellowing: 'None',
      distortion: 'None',
      stunting: 'None',
      leafStage: '4-leaf',
      ...extra,
    },
  };
}

/** Counted but not yet pulled apart — the state a run spends most of its life in. */
function countedPot(pot: number, counts: number[], dates: string[]): TrialPot {
  return {
    pot,
    seedsSown: 25,
    counts: counts.map((count, i) => ({ date: dates[i], count })),
    measurements: {},
  };
}

export interface SandboxScenario {
  run: TrialRun;
  systems: CompostSystem[];
}

/**
 * A fresh copy of the practice scenario. Called again by the Reset button, so
 * it must never return shared objects — every call builds new ones.
 */
export function buildSandboxScenario(): SandboxScenario {
  const { sown, observations: obs } = sandboxDates();

  // Demo pile A — healthy all the way through. Ends at NO CLEAR INHIBITION.
  const a: TrialPot[] = [
    sortedPot(1, [9, 16, 21, 23], obs, [2, 4, 10, 7], 0),
    sortedPot(2, [11, 18, 22, 22], obs, [1, 5, 9, 7], 0),
    sortedPot(3, [8, 15, 20, 21], obs, [2, 4, 8, 6], 1),
    sortedPot(4, [10, 17, 22, 24], obs, [1, 5, 11, 7], 0),
    sortedPot(5, [7, 14, 19, 22], obs, [2, 4, 9, 7], 0),
  ];

  // Demo pile B — germination well down on the control. GERMINATION INHIBITION.
  const b: TrialPot[] = [
    sortedPot(1, [2, 4, 6, 7], obs, [4, 2, 1, 0], 0, { yellowing: 'Moderate', lateralRoots: 'Sparse' }),
    sortedPot(2, [1, 2, 3, 4], obs, [3, 1, 0, 0], 0, { yellowing: 'Moderate', lateralRoots: 'Sparse' }),
    sortedPot(3, [0, 1, 2, 2], obs, [2, 0, 0, 0], 0, { yellowing: 'Mild', lateralRoots: 'Sparse' }),
    sortedPot(4, [3, 5, 8, 9], obs, [5, 3, 1, 0], 0, { yellowing: 'Moderate', lateralRoots: 'Sparse' }),
    sortedPot(5, [1, 3, 4, 5], obs, [3, 2, 0, 0], 0, { yellowing: 'Severe', lateralRoots: 'Sparse' }),
  ];

  // Demo pile C — counted, nobody has sorted the seedlings yet. GERMINATION OK,
  // growth screen still outstanding. This is the state to practise on.
  const c: TrialPot[] = [
    countedPot(1, [8, 15, 19, 21], obs),
    countedPot(2, [9, 16, 20, 22], obs),
    countedPot(3, [6, 13, 18, 20], obs),
    countedPot(4, [10, 17, 21, 23], obs),
    countedPot(5, [7, 14, 18, 20], obs),
  ];

  // Demo pile D — only two pots counted. INCOMPLETE, on purpose: it shows why
  // the app withholds a result until the whole treatment is in.
  const d: TrialPot[] = [
    countedPot(1, [9, 15, 20, 22], obs),
    countedPot(2, [8, 14, 19, 21], obs),
    { pot: 3, seedsSown: 25, counts: [], measurements: {} },
    { pot: 4, seedsSown: 25, counts: [], measurements: {} },
    { pot: 5, seedsSown: 25, counts: [], measurements: {} },
  ];

  const controlPots: TrialPot[] = [
    sortedPot(1, [12, 19, 23, 24], obs, [1, 3, 11, 9], 0),
    sortedPot(2, [11, 20, 24, 24], obs, [1, 2, 12, 9], 0),
    sortedPot(3, [13, 21, 24, 25], obs, [0, 3, 12, 10], 0),
    sortedPot(4, [10, 18, 23, 24], obs, [1, 3, 11, 9], 0),
    sortedPot(5, [12, 20, 24, 24], obs, [1, 2, 12, 9], 0),
  ];

  const trialFor = (suffix: string, pots: TrialPot[]) => ({
    id: `sandbox-trial-${suffix}`,
    method: 'Pot trial',
    crop: 'Mustard',
    createdAt: `${sown}T00:00:00`,
    trialType: 'germination' as const,
    startedAt: sown,
    plannedDays: 5,
    runId: SANDBOX_RUN_ID,
    replicates: 5,
    pots,
  });

  const system = (letter: string, pots: TrialPot[]): CompostSystem => ({
    id: `sandbox-${letter.toLowerCase()}`,
    name: `Demo pile ${letter}`,
    shortName: `D${letter}`,
    sheetTab: `sandbox-${letter.toLowerCase()}`,
    active: true,
    probeLabels: ['1', '2', '3'],
    phase: 'grow',
    buildDate: sown,
    grow: { startedAt: sown, trials: [trialFor(letter.toLowerCase(), pots)] },
  });

  const run: TrialRun = {
    runId: SANDBOX_RUN_ID,
    type: 'germination',
    startDate: sown,
    plannedDays: 5,
    seedsSown: 25,
    notes: 'Practice run — every number here is made up.',
    updatedAt: new Date().toISOString(),
    controls: [{
      id: 'sandbox-control',
      label: 'Seed raising mix',
      measurements: {},
      pots: controlPots,
    }],
    settings: {
      potsPerTreatment: 5,
      observationDates: obs,
      passThresholdPct: 80,
      sizeBands: [
        { cls: 1, minCm: null, maxCm: 5 },
        { cls: 2, minCm: 5, maxCm: 10 },
        { cls: 3, minCm: 10, maxCm: 15 },
        { cls: 4, minCm: 15, maxCm: null },
      ],
    },
  };

  return {
    run,
    systems: [system('A', a), system('B', b), system('C', c), system('D', d)],
  };
}
