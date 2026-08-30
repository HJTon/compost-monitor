import { Info } from 'lucide-react';
import type { TrialRun } from '@/types';
import {
  EMPTY_VALUE,
} from '@/utils/trialFields';
import {
  bandLabel,
  runSizeBands,
  runThreshold,
  type TreatmentSummary,
  type Verdict,
} from '@/utils/trialPots';

interface Props {
  summary: TreatmentSummary;
  verdict: Verdict;
  run: TrialRun;
  isControl?: boolean;
  /** Hide the interpretation paragraph in dense lists */
  compact?: boolean;
}

const pct = (n: number | null) => (n === null ? EMPTY_VALUE : `${n}%`);

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50/70 px-2.5 py-2">
      <div className="text-[10px] uppercase tracking-wide text-gray-400">{label}</div>
      <div className="text-sm font-semibold text-gray-900">{value}</div>
      {sub && <div className="text-[10px] text-gray-400 leading-tight">{sub}</div>}
    </div>
  );
}

/**
 * The Report Summary sheet's row for one treatment, as a card.
 *
 * The screening verdict is always shown with its plain-English meaning and the
 * caveat that follows it. That pairing is deliberate: the sheet's own note is
 * that this "identifies a plant-response concern, not its cause", and a verdict
 * chip on its own invites exactly the diagnosis it can't support.
 */
export function TrialVerdictCard({ summary, verdict, run, isControl, compact }: Props) {
  const threshold = runThreshold(run);
  const bands = runSizeBands(run);
  const upperBands = bands.slice(-2);

  return (
    <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`text-[11px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded border ${verdict.chipClass}`}>
          {verdict.label}
        </span>
        {isControl && (
          <span className="text-[10px] uppercase tracking-wide text-amber-600">Baseline</span>
        )}
        <span className="text-xs text-gray-400 ml-auto">
          {summary.assessedPots}/{summary.pots.length} pots counted
        </span>
      </div>

      <p className="text-xs text-gray-600 mt-2">{verdict.meaning}</p>

      <div className="grid grid-cols-2 gap-2 mt-3">
        <Stat
          label="Germination"
          value={pct(summary.overallGerminationPct)}
          sub={
            summary.overallGerminationPct === null
              ? 'needs every pot'
              : `${summary.totalGerminated} of ${summary.totalSeeds} seeds`
          }
        />
        <Stat
          label="vs control"
          value={pct(verdict.vsControlGermination)}
          sub={`${threshold}% is the alert line`}
        />
        <Stat
          label="Upper-size seedlings"
          value={pct(summary.upperSizePct)}
          sub={upperBands.map(b => bandLabel(b)).join(' + ')}
        />
        <Stat
          label="Growth vs control"
          value={pct(verdict.vsControlGrowth)}
          sub={`${threshold}% is the alert line`}
        />
        <Stat
          label="Consistency"
          value={pct(summary.consistencyPct)}
          sub={
            summary.rangePP === null
              ? 'best minus worst pot'
              : `range ${summary.rangePP} pp${summary.sdPotPct !== null ? ` · SD ${summary.sdPotPct}` : ''}`
          }
        />
        <Stat
          label="Days to first up"
          value={summary.daysToFirstGermination === null ? EMPTY_VALUE : String(summary.daysToFirstGermination)}
          sub={summary.dominantLateralRoots ? `roots: ${summary.dominantLateralRoots.toLowerCase()}` : 'from sowing'}
        />
      </div>

      {(summary.sparsePots > 0 || summary.fragilePots > 0 || summary.stressPots > 0
        || summary.potsWithBadCounts > 0 || (summary.brokenPct ?? 0) > 0) && (
        <div className="flex flex-wrap gap-1.5 mt-3">
          {summary.potsWithBadCounts > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full border bg-orange-50 text-orange-700 border-orange-200">
              {summary.potsWithBadCounts} pot{summary.potsWithBadCounts === 1 ? '' : 's'} with count mismatch
            </span>
          )}
          {summary.sparsePots > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full border bg-gray-50 text-gray-600 border-gray-200">
              {summary.sparsePots} sparse-root
            </span>
          )}
          {summary.fragilePots > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full border bg-amber-50 text-amber-700 border-amber-200">
              {summary.fragilePots} fragile-root
            </span>
          )}
          {summary.stressPots > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full border bg-amber-50 text-amber-700 border-amber-200">
              {summary.stressPots} with stress symptoms
            </span>
          )}
          {(summary.brokenPct ?? 0) > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full border bg-gray-50 text-gray-600 border-gray-200">
              {summary.brokenPct}% broken roots
            </span>
          )}
        </div>
      )}

      {!compact && verdict.interpretation && (
        <div className="flex gap-1.5 mt-3 pt-3 border-t border-gray-100">
          <Info size={12} className="text-gray-400 shrink-0 mt-0.5" />
          <p className="text-[11px] text-gray-500 leading-snug">{verdict.interpretation}</p>
        </div>
      )}
    </div>
  );
}
