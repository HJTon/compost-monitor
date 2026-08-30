import type {
  BuildPhase,
  CompostSystem,
  GrowInfo,
  GrowTrial,
  MaturationInfo,
  TrialControl,
  TrialPot,
  TrialRun,
} from '@/types';
import { potsOf, potsFromLegacyControl, potsFromLegacyTrial } from './trialPots';

// ── One list of everything in a run ──────────────────────────────────────────
//
// A run holds two kinds of row that are stored in completely different places:
// a compost's trial lives in its build's GrowJSON, a control lives on the run.
// Every screen wants to treat them alike — same pots, same measurements, same
// rollups — so this module flattens both into a `Treatment` and knows how to
// write each one back.

export type TreatmentKind = 'build' | 'control';

export interface Treatment {
  /** Stable route/React key: `b:<systemId>` or `c:<controlId>` */
  key: string;
  kind: TreatmentKind;
  label: string;
  /** Present when kind === 'build' */
  system?: CompostSystem;
  trial?: GrowTrial;
  /** Present when kind === 'control' */
  control?: TrialControl;
  /** Pots, padded to the run's pot count */
  pots: TrialPot[];
}

export const buildKey = (systemId: string) => `b:${systemId}`;
export const controlKey = (controlId: string) => `c:${controlId}`;

/**
 * Every compost and control in the run, composts first.
 *
 * Pots come from storage where they exist, and are otherwise reconstructed
 * from a pre-pot-level record so an older run still shows its numbers instead
 * of appearing empty.
 */
export function runTreatments(systems: CompostSystem[], run: TrialRun): Treatment[] {
  const out: Treatment[] = [];

  for (const system of systems) {
    for (const trial of system.grow?.trials ?? []) {
      if (trial.runId !== run.runId) continue;
      const seeded = { pots: potsFromLegacyTrial(trial, run) };
      out.push({
        key: buildKey(system.id),
        kind: 'build',
        label: system.name,
        system,
        trial,
        pots: potsOf(trial.pots?.length ? trial : seeded, run),
      });
    }
  }

  for (const control of run.controls) {
    const seeded = { pots: potsFromLegacyControl(control, run) };
    out.push({
      key: controlKey(control.id),
      kind: 'control',
      label: control.label,
      control,
      pots: potsOf(control.pots?.length ? control : seeded, run),
    });
  }

  return out;
}

export function findTreatment(
  systems: CompostSystem[],
  run: TrialRun,
  key: string,
): Treatment | undefined {
  return runTreatments(systems, run).find(t => t.key === key);
}

/** The context calls a save needs. Passed in so this stays a plain module. */
export interface TreatmentSaveApi {
  setSystemPhase: (
    id: string,
    phase: BuildPhase,
    patch?: { maturation?: MaturationInfo; grow?: GrowInfo; transitionNote?: string },
  ) => Promise<void>;
  saveTrialRun: (run: TrialRun) => Promise<void>;
}

/**
 * Write one treatment's pots back to wherever that treatment lives.
 *
 * `controls` is passed explicitly for control saves: the whole controls array
 * is a single JSON cell, so the caller has to hand over the array it wants
 * persisted or two quick edits will drop each other.
 */
export async function savePots(
  treatment: Treatment,
  pots: TrialPot[],
  run: TrialRun,
  api: TreatmentSaveApi,
  controls?: TrialControl[],
): Promise<void> {
  if (treatment.kind === 'build') {
    const { system, trial } = treatment;
    if (!system || !trial) return;
    const grow = system.grow;
    if (!grow) return;
    const next: GrowTrial = { ...trial, pots };
    await api.setSystemPhase(system.id, system.phase || 'grow', {
      grow: { ...grow, trials: grow.trials.map(t => (t.id === next.id ? next : t)) },
    });
    return;
  }

  const control = treatment.control;
  if (!control) return;
  const current = controls && controls.length > 0 ? controls : run.controls;
  await api.saveTrialRun({
    ...run,
    controls: current.map(c => (c.id === control.id ? { ...c, pots } : c)),
    updatedAt: new Date().toISOString(),
  });
}

/** Replace one pot in a list, by pot number. */
export function withPot(pots: TrialPot[], pot: TrialPot): TrialPot[] {
  const found = pots.some(p => p.pot === pot.pot);
  return found
    ? pots.map(p => (p.pot === pot.pot ? pot : p))
    : [...pots, pot].sort((a, b) => a.pot - b.pot);
}

/**
 * Set one pot's count for one date.
 *
 * A blank count REMOVES that date's entry rather than storing 0 — the protocol
 * distinguishes "observed, none up" from "not assessed", and only an explicit
 * 0 means the former.
 */
export function withCount(pot: TrialPot, date: string, count: number | null): TrialPot {
  const rest = (pot.counts || []).filter(c => c.date !== date);
  const counts = count === null ? rest : [...rest, { date, count }];
  return { ...pot, counts: counts.sort((a, b) => a.date.localeCompare(b.date)) };
}
