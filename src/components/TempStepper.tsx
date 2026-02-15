import { useState, useRef, useEffect } from 'react';
import type { ProbeReading } from '@/types';
import { getTempColor, getTempBorderColor } from '@/utils/config';

interface TempStepperProps {
  probes: ProbeReading[];
  onChange: (probes: ProbeReading[]) => void;
}

export function TempStepper({ probes, onChange }: TempStepperProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const enteredCount = probes.filter(p => p.value !== null).length;
  const validValues = probes.filter(p => p.value !== null).map(p => p.value as number);
  const runningAvg = validValues.length > 0 ? Math.round(validValues.reduce((a, b) => a + b, 0) / validValues.length) : null;

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [currentIndex]);

  const handleValueChange = (value: string) => {
    const numValue = value === '' ? null : parseFloat(value);
    const updated = probes.map((p, i) =>
      i === currentIndex ? { ...p, value: numValue } : p
    );
    onChange(updated);
  };

  const handleNext = () => {
    if (currentIndex < probes.length - 1) {
      setCurrentIndex(currentIndex + 1);
    }
  };

  const handlePrev = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleNext();
    }
  };

  const current = probes[currentIndex];
  const currentValue = current?.value;
  const colorClass = currentValue !== null && currentValue !== undefined
    ? getTempColor(currentValue)
    : '';
  const borderClass = currentValue !== null && currentValue !== undefined
    ? getTempBorderColor(currentValue)
    : 'border-gray-200';

  return (
    <div className="space-y-4">
      {/* Progress dots */}
      <div className="flex justify-center gap-2">
        {probes.map((p, i) => (
          <button
            key={i}
            onClick={() => setCurrentIndex(i)}
            className={`w-3 h-3 rounded-full transition-all ${
              i === currentIndex
                ? 'bg-green-primary scale-125'
                : p.value !== null
                ? 'bg-green-400'
                : 'bg-gray-300'
            }`}
          />
        ))}
      </div>

      {/* Probe label */}
      <div className="text-center">
        <div className="text-sm text-gray-500">Probe {currentIndex + 1} of {probes.length}</div>
        <div className="text-lg font-semibold text-gray-900">{current?.label}</div>
      </div>

      {/* Large number input */}
      <div className={`mx-auto max-w-[200px] border-2 rounded-2xl overflow-hidden ${borderClass} ${colorClass}`}>
        <input
          ref={inputRef}
          type="number"
          inputMode="decimal"
          value={currentValue ?? ''}
          onChange={e => handleValueChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="---"
          className="w-full text-center text-5xl font-bold py-6 bg-transparent outline-none placeholder-gray-300 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        />
        <div className="text-center text-sm text-gray-500 pb-2">°F</div>
      </div>

      {/* Nav buttons */}
      <div className="flex gap-3 justify-center">
        <button
          onClick={handlePrev}
          disabled={currentIndex === 0}
          className="px-6 py-3 rounded-lg bg-gray-100 text-gray-700 font-medium disabled:opacity-30 active:scale-95 transition-all"
        >
          Prev
        </button>
        <button
          onClick={handleNext}
          disabled={currentIndex === probes.length - 1}
          className="px-6 py-3 rounded-lg bg-green-primary text-white font-medium disabled:opacity-30 active:scale-95 transition-all"
        >
          Next
        </button>
      </div>

      {/* Running summary */}
      <div className="text-center text-sm text-gray-500">
        {enteredCount} of {probes.length} entered
        {runningAvg !== null && ` · Avg: ${runningAvg}°F`}
      </div>
    </div>
  );
}
