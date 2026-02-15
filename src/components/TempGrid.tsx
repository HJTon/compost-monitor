import { useRef } from 'react';
import type { ProbeReading } from '@/types';
import { getTempColor, getTempBorderColor } from '@/utils/config';

interface TempGridProps {
  probes: ProbeReading[];
  onChange: (probes: ProbeReading[]) => void;
}

// 3x3 grid mapping: rows are Core/Mid/Edge, cols are Left/Centre/Right
// But data order is: Core Centre, Core Left, Core Right, Mid Centre, Mid Left, Mid Right, Edge Centre, Edge Left, Edge Right
// Grid layout:
//   Left    Centre   Right
//   [1]     [0]      [2]     <- Core
//   [4]     [3]      [5]     <- Mid
//   [7]     [6]      [8]     <- Edge
const GRID_ORDER = [1, 0, 2, 4, 3, 5, 7, 6, 8];
const ROW_LABELS = ['Core', 'Mid', 'Edge'];
const COL_LABELS = ['Left', 'Centre', 'Right'];

export function TempGrid({ probes, onChange }: TempGridProps) {
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const handleValueChange = (probeIndex: number, value: string) => {
    const numValue = value === '' ? null : parseFloat(value);
    const updated = probes.map((p, i) =>
      i === probeIndex ? { ...p, value: numValue } : p
    );
    onChange(updated);
  };

  const handleKeyDown = (e: React.KeyboardEvent, gridPos: number) => {
    if (e.key === 'Enter' && gridPos < 8) {
      e.preventDefault();
      inputRefs.current[gridPos + 1]?.focus();
      inputRefs.current[gridPos + 1]?.select();
    }
  };

  return (
    <div className="space-y-2">
      {/* Column headers */}
      <div className="grid grid-cols-[60px_1fr_1fr_1fr] gap-1">
        <div />
        {COL_LABELS.map(label => (
          <div key={label} className="text-center text-xs text-gray-500 font-medium">{label}</div>
        ))}
      </div>

      {/* Grid rows */}
      {ROW_LABELS.map((rowLabel, row) => (
        <div key={rowLabel} className="grid grid-cols-[60px_1fr_1fr_1fr] gap-1">
          <div className="text-xs text-gray-500 font-medium flex items-center">{rowLabel}</div>
          {[0, 1, 2].map(col => {
            const gridPos = row * 3 + col;
            const probeIndex = GRID_ORDER[gridPos];
            const probe = probes[probeIndex];
            const value = probe?.value;
            const colorClass = value !== null && value !== undefined ? getTempColor(value) : 'bg-white';
            const borderClass = value !== null && value !== undefined ? getTempBorderColor(value) : 'border-gray-200';

            return (
              <div key={col} className={`border rounded-lg overflow-hidden ${borderClass} ${colorClass}`}>
                <input
                  ref={el => { inputRefs.current[gridPos] = el; }}
                  type="number"
                  inputMode="decimal"
                  value={value ?? ''}
                  onChange={e => handleValueChange(probeIndex, e.target.value)}
                  onKeyDown={e => handleKeyDown(e, gridPos)}
                  onFocus={e => e.target.select()}
                  placeholder="---"
                  className="w-full text-center text-lg font-bold py-3 bg-transparent outline-none placeholder-gray-300 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
