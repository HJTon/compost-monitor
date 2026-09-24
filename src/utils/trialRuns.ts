import type { CompostSystem, GrowTrial, TrialRun } from '@/types';
import { fieldsFor } from './trialFields';
import { trialTypeOf } from './trials';
import { generateId } from './config';
import { formatNiceDate } from '@/components/BuildVitals';

// Membership helpers for the run pages. A run holds no list of its piles —
// the link lives on each `GrowTrial.runId` — so "who is in this run?" is always
// a scan across builds.

export interface RunMember {
  system: CompostSystem;
  trial: GrowTrial;
}

/** Every build/trial pair pointing at this run, in build order. */
export function runMembers(systems: CompostSystem[], runId: string): RunMember[] {
  const out: RunMember[] = [];
  for (const system of systems) {
    for (const trial of system.grow?.trials ?? []) {
      if (trial.runId === runId) out.push({ system, trial });
    }
  }
  return out;
}

/** How many piles are in each run, keyed by runId. */
export function pileCountsByRun(systems: CompostSystem[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const system of systems) {
    for (const trial of system.grow?.trials ?? []) {
      if (trial.runId) counts.set(trial.runId, (counts.get(trial.runId) || 0) + 1);
    }
  }
  return counts;
}

/**
 * True when anything has been recorded against this trial — "has anyone
 * filled this row in yet?".
 *
 * Pot-level trials keep everything on their pots, so a germination trial with
 * five counted pots and an empty `measurements` still counts as having
 * results. Derived fields never count: they're computed, so they'd make an
 * empty row look complete.
 */
export function hasMeasurements(trial: GrowTrial): boolean {
  if (trial.pots?.some(p => (p.counts?.length ?? 0) > 0
    || Object.values(p.measurements || {}).some(v => v !== null && v !== undefined && v !== ''))) {
    return true;
  }
  const m = trial.measurements;
  if (!m) return false;
  return fieldsFor(trialTypeOf(trial)).some(f => {
    if (f.derived) return false;
    const v = m[f.id];
    return v !== undefined && v !== null && v !== '';
  });
}

/** A run as a trial-shaped object, so `trialStatus` can derive "Day N of M". */
export function runAsTrial(run: TrialRun): GrowTrial {
  return {
    id: run.runId,
    method: '',
    crop: '',
    createdAt: '',
    trialType: run.type,
    startedAt: run.startDate,
    plannedDays: run.plannedDays,
  };
}

/**
 * A fresh copy of a run for a redo — usually because the first attempt failed
 * (the compost wasn't ready, the seed was bad). Same protocol and same control
 * labels, but nothing measured: the old run stays behind as its own record.
 * Observation dates are dropped because they belong to the old sowing.
 */
export function repeatRun(run: TrialRun, startDate: string, newRunId: string): TrialRun {
  const { observationDates: _dates, ...settings } = run.settings || {};
  return {
    runId: newRunId,
    type: run.type,
    startDate,
    plannedDays: run.plannedDays,
    seedsSown: run.seedsSown,
    controls: run.controls.map(c => ({
      id: generateId(),
      label: c.label,
      measurements: {},
      ...(c.pots ? { pots: [] } : {}),
    })),
    notes: `Repeat of the run started ${formatNiceDate(run.startDate) || run.startDate || 'earlier'}.`,
    updatedAt: new Date().toISOString(),
    settings: run.settings ? settings : undefined,
  };
}

/**
 * A new trial with the same stage, method and crop as `trial`, starting on
 * `startDate` with nothing recorded. `runId` is the run it joins, if any.
 */
export function repeatTrial(trial: GrowTrial, startDate: string, runId?: string): GrowTrial {
  return {
    id: generateId(),
    method: trial.method,
    crop: trial.crop,
    createdAt: `${startDate}T00:00:00`,
    trialType: trialTypeOf(trial),
    startedAt: startDate,
    plannedDays: trial.plannedDays ?? null,
    runId,
    replicates: runId ? trial.replicates : undefined,
  };
}
