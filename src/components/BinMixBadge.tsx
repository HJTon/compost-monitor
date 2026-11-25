import type { BinMix } from '@/utils/binMix';

interface BinMixBadgeProps {
  mix: BinMix | undefined;
  /** `dark` for the scanner overlay, `light` for cards, `chip` for a compact list marker (CP only). */
  variant?: 'dark' | 'light' | 'chip';
}

/**
 * "All Zing" or "Contains some CP — from …". Renders nothing when the mix is unknown.
 * All Zing is purple, not green: Zing is the usual mix, not the "good" one, and CP isn't a fault.
 */
export function BinMixBadge({ mix, variant = 'light' }: BinMixBadgeProps) {
  if (!mix) return null;
  const cp = mix.cpSources.length > 0;

  if (variant === 'chip') {
    if (!cp) return null;
    return (
      <span
        title={`Contains some chaffed pickle (from ${mix.cpSources.join(', ')})`}
        className="text-[10px] px-1.5 py-0.5 rounded-full bg-yellow-300 text-yellow-900 font-semibold"
      >
        CP
      </span>
    );
  }

  if (variant === 'dark') {
    return cp ? (
      <div className="mt-2 inline-block rounded-lg bg-yellow-300 px-3 py-1.5 text-yellow-950">
        <p className="text-sm font-bold">Contains some CP</p>
        <p className="text-xs">from {mix.cpSources.join(', ')}</p>
      </div>
    ) : (
      <p className="mt-2 inline-block rounded-lg bg-purple-600/90 px-3 py-1 text-sm font-semibold text-white">All Zing</p>
    );
  }

  return cp ? (
    <div className="rounded-lg bg-yellow-100 border border-yellow-300 px-3 py-2 text-sm text-yellow-900">
      <span className="font-semibold">Contains some CP</span>
      <span className="text-yellow-800"> — chaffed pickle from {mix.cpSources.join(', ')}</span>
    </div>
  ) : (
    <div className="rounded-lg bg-purple-50 border border-purple-200 px-3 py-2 text-sm font-medium text-purple-800">
      All Zing
    </div>
  );
}
