import type { CompostSystem, GrowTrial, TrialRun } from '@/types';
import { fieldsFor } from './trialFields';
import { trialTypeOf } from './trials';

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
 * True when at least one of the stage's entered (non-derived) fields has a
 * value — "has anyone filled this row in yet?". Derived fields don't count:
 * they're computed, so they'd make an empty row look complete.
 */
export function hasMeasurements(trial: GrowTrial): boolean {
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
