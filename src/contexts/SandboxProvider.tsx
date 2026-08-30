import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { CompostContext, useCompost, type CompostContextType } from './CompostContext';
import { buildSandboxScenario } from '@/utils/sandboxTrial';
import type { CompostSystem, GrowInfo, TrialRun } from '@/types';

// ── The practice space ───────────────────────────────────────────────────────
//
// The sandbox runs the REAL trial pages against fake data. That is the whole
// point: what Caroline learns here has to be the thing she does on the bench,
// not a simplified imitation of it that behaves differently.
//
// It works by wrapping the real context value and swapping out only the trial
// pieces — systems, runs, and the two save functions — for in-memory state.
// Everything else (toasts, settings, online status) passes straight through, so
// the pages behave normally. Nothing here touches IndexedDB or the network.

interface TrialBase {
  /** URL prefix for trial links — '/trials' normally, '/sandbox/trials' here. */
  base: string;
  /** True inside the practice space. Pages use it to hide links out to real builds. */
  sandbox: boolean;
}

const TrialBaseContext = createContext<TrialBase>({ base: '/trials', sandbox: false });

/**
 * Where trial links should point. Defaults to the real routes, so every page
 * works unchanged outside the sandbox and no caller has to opt in.
 */
export function useTrialBase(): TrialBase {
  return useContext(TrialBaseContext);
}

export function SandboxProvider({ children }: { children: ReactNode }) {
  const real = useCompost();
  const [scenario, setScenario] = useState(() => buildSandboxScenario());
  // Bumped by `reset`, and used to remount the tree so any page-level draft
  // state is thrown away along with the data it was editing.
  const [generation, setGeneration] = useState(0);

  const reset = useCallback(() => {
    setScenario(buildSandboxScenario());
    setGeneration(g => g + 1);
    real.addToast('success', 'Sandbox reset');
  }, [real]);

  const setSystemPhase = useCallback(async (
    id: string,
    phase: CompostSystem['phase'] & string,
    patch?: { grow?: GrowInfo },
  ) => {
    setScenario(prev => ({
      ...prev,
      systems: prev.systems.map(s =>
        s.id === id ? { ...s, phase, grow: patch?.grow ?? s.grow } : s),
    }));
  }, []);

  const saveTrialRun = useCallback(async (run: TrialRun) => {
    setScenario(prev => ({ ...prev, run: { ...run, updatedAt: new Date().toISOString() } }));
  }, []);

  const getTrialRun = useCallback((runId: string): TrialRun | undefined => {
    return scenario.run.runId === runId ? scenario.run : undefined;
  }, [scenario.run]);

  const value = useMemo<CompostContextType>(() => ({
    ...real,
    allSystems: scenario.systems,
    getSystem: (id: string) => scenario.systems.find(s => s.id === id),
    trialRuns: [scenario.run],
    // The run page filters its "add a pile" list by active systems, so every
    // demo pile has to look active here.
    settings: { ...real.settings, activeSystems: scenario.systems.map(s => s.id) },
    setSystemPhase: setSystemPhase as CompostContextType['setSystemPhase'],
    saveTrialRun,
    getTrialRun,
  }), [real, scenario, setSystemPhase, saveTrialRun, getTrialRun]);

  const base = useMemo(() => ({ base: '/sandbox/trials', sandbox: true }), []);

  return (
    <TrialBaseContext.Provider value={base}>
      <CompostContext.Provider value={value}>
        <SandboxResetContext.Provider value={reset}>
          <div key={generation} className="contents">{children}</div>
        </SandboxResetContext.Provider>
      </CompostContext.Provider>
    </TrialBaseContext.Provider>
  );
}

const SandboxResetContext = createContext<() => void>(() => {});

/** Restore the practice data to how it started. */
export function useSandboxReset(): () => void {
  return useContext(SandboxResetContext);
}
