import { MapPin } from 'lucide-react';

interface FarmPickerProps {
  /** Farms that have bins in the list, with their counts. */
  farms: { name: string; count: number }[];
  /** Total bins across every farm. */
  total: number;
  /** The chosen farm; empty = all farms. */
  value: string | undefined;
  onChange: (farm: string) => void;
}

/** "Which farm are you at?" chips. The choice is remembered on this device. */
export function FarmPicker({ farms, total, value, onChange }: FarmPickerProps) {
  // Keep a remembered farm visible even when it has no bins ready right now.
  const options = value && !farms.some(f => f.name === value) ? [...farms, { name: value, count: 0 }] : farms;
  const chip = (active: boolean) =>
    `px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
      active ? 'bg-green-primary text-white border-green-primary' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
    }`;

  return (
    <div className="px-4 py-3 border-b border-gray-100">
      <p className="flex items-center gap-1.5 text-xs font-medium text-gray-500 mb-2">
        <MapPin size={14} /> Which farm are you at?
      </p>
      <div className="flex flex-wrap gap-2">
        {options.map(f => (
          <button key={f.name} onClick={() => onChange(f.name)} className={chip(value === f.name)}>
            {f.name} <span className={value === f.name ? 'text-white/80' : 'text-gray-400'}>{f.count}</span>
          </button>
        ))}
        <button onClick={() => onChange('')} className={chip(!value)}>
          All farms <span className={!value ? 'text-white/80' : 'text-gray-400'}>{total}</span>
        </button>
      </div>
    </div>
  );
}
