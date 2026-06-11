import { Plus } from 'lucide-react';
import type { ProbeReading } from '@/types';
import { getTempColor, getTempBorderColor, fToC, cToF } from '@/utils/config';

/**
 * 3x3 mini-map of probe positions shown alongside the temperature entry UI.
 *
 * Cells follow the same spatial convention as TempGrid: rows are
 * Core / Mid / Edge (top to bottom), columns are Left / Centre / Right.
 * The system's standard probes occupy a fixed pattern for their count
 * (9 = all cells, 5 = corners + middle, 3 = diagonal) and fill with colour
 * as readings are entered below. Any cell not covered by a standard probe
 * can be tapped to add a one-off EXTRA reading for this entry — e.g. when
 * one spot reads unusually hot or cold and more measurements are wanted.
 *
 * Extra readings are stored on the entry's probes array with a label of
 * '+N' (N = cell number 1-9) and are typed directly into the mini-map cell.
 * They count toward this entry's average/peak (and the sheet's formulas)
 * but do not change the build's standard probe count.
 */

// Cell index (0-8, row-major) → probe array index, for each standard count.
// 9 mirrors TempGrid's GRID_ORDER; 5 is corners + middle; 3 is the diagonal.
const CELL_PATTERNS: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
  7: [0, 2, 3, 4, 5, 6, 8],
  8: [0, 1, 2, 3, 5, 6, 7, 8],
  9: [1, 0, 2, 4, 3, 5, 7, 6, 8].map((_, i) => i), // placeholder, handled below
};

/** For 9-probe systems, cell c maps to probe GRID_ORDER[c] (TempGrid layout).
 * For smaller counts, the pattern lists which CELLS the probes occupy, in
 * probe order. Returns cellIndex → probeArrayIndex (standard probes only). */
function standardCellMap(standardCount: number): Map<number, number> {
  const map = new Map<number, number>();
  if (standardCount >= 9) {
    const GRID_ORDER = [1, 0, 2, 4, 3, 5, 7, 6, 8];
    for (let cell = 0; cell < 9; cell++) map.set(cell, GRID_ORDER[cell]);
    return map;
  }
  const cells = CELL_PATTERNS[standardCount] || Array.from({ length: standardCount }, (_, i) => i);
  cells.forEach((cell, probeIdx) => map.set(cell, probeIdx));
  return map;
}

interface ProbeMiniMapProps {
  probes: ProbeReading[];
  /** Number of standard probes for this build (system.probeLabels.length). */
  standardCount: number;
  onChange: (probes: ProbeReading[]) => void;
  /** Guardrail hook — fired when an extra reading's input is committed. */
  onProbeCommit?: (probeIndex: number) => void;
  unit?: 'F' | 'C';
}

export function ProbeMiniMap({ probes, standardCount, onChange, onProbeCommit, unit = 'F' }: ProbeMiniMapProps) {
  const cellToStandard = standardCellMap(standardCount);

  // Extras live at the end of the probes array with labels '+1'..'+9'
  const extraByCell = new Map<number, number>(); // cellIndex → probe array index
  probes.forEach((p, i) => {
    const m = p.label?.match(/^\+(\d)$/);
    if (m) extraByCell.set(parseInt(m[1], 10) - 1, i);
  });

  const toDisplay = (f: number | null | undefined): string => {
    if (f === null || f === undefined) return '';
    return String(unit === 'C' ? Math.round(fToC(f) * 10) / 10 : Math.round(f * 10) / 10);
  };

  const setValue = (probeIndex: number, raw: string) => {
    let numValue: number | null;
    if (raw === '') {
      numValue = null;
    } else {
      const parsed = parseFloat(raw);
      numValue = Number.isNaN(parsed) ? null : (unit === 'C' ? cToF(parsed) : parsed);
    }
    onChange(probes.map((p, i) => i === probeIndex ? { ...p, value: numValue } : p));
  };

  const addExtra = (cellIdx: number) => {
    onChange([
      ...probes,
      { probeIndex: probes.length, label: `+${cellIdx + 1}`, value: null },
    ]);
  };

  const removeExtra = (probeIndex: number) => {
    onChange(
      probes
        .filter((_, i) => i !== probeIndex)
        .map((p, i) => ({ ...p, probeIndex: i }))
    );
  };

  const allOccupied = Array.from({ length: 9 }, (_, c) => c)
    .every(c => cellToStandard.has(c) || extraByCell.has(c));

  return (
    <div className="w-full max-w-[220px]">
      <div className="flex items-baseline justify-between gap-2 mb-1.5">
        <span className="text-xs font-medium text-gray-500 shrink-0">Probe map</span>
        {!allOccupied && (
          <span className="text-[10px] text-gray-400 text-right">tap a square to add a reading</span>
        )}
      </div>
      <div className="grid grid-cols-3 gap-1">
        {Array.from({ length: 9 }, (_, cell) => {
          const stdIdx = cellToStandard.get(cell);
          const extraIdx = extraByCell.get(cell);

          if (stdIdx !== undefined && probes[stdIdx]) {
            // Standard probe cell — mirrors the value entered below
            const p = probes[stdIdx];
            const filled = p.value !== null && p.value !== undefined;
            return (
              <div
                key={cell}
                className={`h-12 rounded-md border flex flex-col items-center justify-center ${
                  filled
                    ? `${getTempBorderColor(p.value!)} ${getTempColor(p.value!)}`
                    : 'border-gray-300 bg-gray-50'
                }`}
              >
                <span className={`text-xs font-bold leading-none ${filled ? '' : 'text-gray-300'}`}>
                  {filled ? toDisplay(p.value) : '·'}
                </span>
                <span className="text-[9px] text-gray-400 leading-none mt-0.5">{p.label}</span>
              </div>
            );
          }

          if (extraIdx !== undefined && probes[extraIdx]) {
            // Extra reading cell — editable in place
            const p = probes[extraIdx];
            const filled = p.value !== null && p.value !== undefined;
            return (
              <div
                key={cell}
                className={`h-12 rounded-md border-2 border-dashed flex flex-col items-center justify-center ${
                  filled
                    ? `${getTempBorderColor(p.value!)} ${getTempColor(p.value!)}`
                    : 'border-green-400 bg-green-50/50'
                }`}
              >
                <input
                  type="number"
                  inputMode="decimal"
                  autoFocus={!filled}
                  value={toDisplay(p.value)}
                  onChange={e => setValue(extraIdx, e.target.value)}
                  onBlur={() => {
                    // Abandoned empty extras tidy themselves away
                    if (p.value === null) removeExtra(extraIdx);
                    else onProbeCommit?.(extraIdx);
                  }}
                  placeholder="--"
                  className="w-full text-center text-xs font-bold bg-transparent outline-none placeholder-gray-300 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <span className="text-[9px] text-green-600 font-medium leading-none mt-0.5">extra</span>
              </div>
            );
          }

          // Empty cell — tap to add an extra reading here
          return (
            <button
              key={cell}
              onClick={() => addExtra(cell)}
              className="h-12 rounded-md border border-dashed border-gray-200 flex items-center justify-center text-gray-300 hover:border-green-300 hover:text-green-400 active:scale-95 transition-all"
              title="Add extra reading"
            >
              <Plus size={14} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
