import type { ComponentType } from 'react';
import type { ObservationKey } from '@/types';

// Custom SVG icons for observations — replaces emoji so every browser /
// OS renders the exact same silhouettes. Each icon is an <svg> element
// that can either stand alone (HTML) or be nested inside Recharts' SVG
// (pass x/y to position inside a parent SVG).

export interface IconProps {
  size?: number;
  x?: number;
  y?: number;
  opacity?: number;
  className?: string;
  title?: string;
  /** Optional override used by icons that vary by count (fruit flies). */
  count?: number;
}

function svgProps(p: IconProps, size: number) {
  return {
    x: p.x,
    y: p.y,
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    opacity: p.opacity,
    className: p.className,
    style: { overflow: 'visible' as const },
  };
}

// ---- Wildlife ---------------------------------------------------------

// Deterministic "jittered" positions for up to 9 dots (intensity 1..4 → 3,5,7,9).
// Hand-picked to look natural and stay inside the 24×24 viewBox.
const FRUIT_FLY_DOTS: Array<[number, number]> = [
  [8, 9], [15, 7], [12, 14],           // 3 — base
  [5, 14], [18, 13],                   // +2 → 5
  [10, 5], [17, 18],                   // +2 → 7
  [6, 19], [20, 5],                    // +2 → 9
];

export const FruitFlyIcon: ComponentType<IconProps> = (p) => {
  const s = p.size ?? 24;
  const n = Math.max(3, Math.min(FRUIT_FLY_DOTS.length, p.count ?? 3));
  const r = n > 7 ? 1.4 : n > 5 ? 1.6 : 1.8;
  return (
    <svg {...svgProps(p, s)}>
      {p.title && <title>{p.title}</title>}
      {FRUIT_FLY_DOTS.slice(0, n).map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r={r} fill="#1A1A1A" />
      ))}
    </svg>
  );
};

export const FlyIcon: ComponentType<IconProps> = (p) => {
  const s = p.size ?? 24;
  return (
    <svg {...svgProps(p, s)}>
      {p.title && <title>{p.title}</title>}
      {/* bigger iridescent wings */}
      <ellipse cx="5" cy="9" rx="4.2" ry="2" fill="#B9D7EA" opacity="0.7" transform="rotate(-28 5 9)" />
      <ellipse cx="19" cy="9" rx="4.2" ry="2" fill="#B9D7EA" opacity="0.7" transform="rotate(28 19 9)" />
      {/* dark blue-black body, fatter than fruit fly */}
      <ellipse cx="12" cy="13.5" rx="4.2" ry="5.2" fill="#2B2B33" />
      <ellipse cx="12" cy="10.5" rx="2.8" ry="2.2" fill="#3A3A46" />
      {/* red-orange compound eyes (common blowfly) */}
      <ellipse cx="10.3" cy="9" rx="1.3" ry="1.6" fill="#C94A1A" />
      <ellipse cx="13.7" cy="9" rx="1.3" ry="1.6" fill="#C94A1A" />
      {/* body stripes */}
      <path d="M 9 13 Q 12 14.2 15 13" stroke="#0F0F14" strokeWidth="0.7" fill="none" />
      <path d="M 9 15.5 Q 12 16.5 15 15.5" stroke="#0F0F14" strokeWidth="0.7" fill="none" />
    </svg>
  );
};

export const MiteIcon: ComponentType<IconProps> = (p) => {
  const s = p.size ?? 24;
  return (
    <svg {...svgProps(p, s)}>
      {p.title && <title>{p.title}</title>}
      {/* 8 legs radiating */}
      {[
        [3, 6], [2, 10], [2.5, 14], [4, 18],
        [21, 6], [22, 10], [21.5, 14], [20, 18],
      ].map(([x2, y2], i) => (
        <line key={i} x1="12" y1="12" x2={x2} y2={y2} stroke="#3A2817" strokeWidth="1" strokeLinecap="round" />
      ))}
      {/* round red-brown body */}
      <circle cx="12" cy="12" r="5" fill="#A0522D" />
      <circle cx="12" cy="12" r="5" fill="none" stroke="#6D3A17" strokeWidth="0.7" />
      <circle cx="10.5" cy="10.5" r="0.9" fill="#F2D6B3" opacity="0.8" />
    </svg>
  );
};

export const BirdIcon: ComponentType<IconProps> = (p) => {
  const s = p.size ?? 24;
  return (
    <svg {...svgProps(p, s)}>
      {p.title && <title>{p.title}</title>}
      {/* body */}
      <path d="M 4 15 Q 7 8 14 9 Q 19 9.5 20 12 Q 19 15 14 15.5 Q 9 16 4 15 Z" fill="#6B4F3A" />
      {/* wing */}
      <path d="M 9 11 Q 13 10 16 12 Q 13 13.5 9 13 Z" fill="#4A3628" />
      {/* beak */}
      <path d="M 20 12 L 23 11.5 L 20 13 Z" fill="#E8A23B" />
      {/* eye */}
      <circle cx="18.2" cy="11.2" r="0.6" fill="#fff" />
      <circle cx="18.2" cy="11.2" r="0.3" fill="#000" />
      {/* legs */}
      <line x1="10" y1="16" x2="10" y2="19" stroke="#6B4F3A" strokeWidth="0.8" />
      <line x1="13" y1="16" x2="13" y2="19" stroke="#6B4F3A" strokeWidth="0.8" />
    </svg>
  );
};

export const RatIcon: ComponentType<IconProps> = (p) => {
  const s = p.size ?? 24;
  return (
    <svg {...svgProps(p, s)}>
      {p.title && <title>{p.title}</title>}
      {/* tail */}
      <path d="M 18 14 Q 22 13 22 17 Q 21.5 18.5 20 18.5" stroke="#8A7666" strokeWidth="1.2" fill="none" strokeLinecap="round" />
      {/* body */}
      <ellipse cx="12" cy="14" rx="6.5" ry="4" fill="#7D6B5D" />
      {/* head */}
      <circle cx="5.5" cy="12.5" r="3.2" fill="#8A7666" />
      {/* ears */}
      <circle cx="4.2" cy="9.8" r="1.6" fill="#A69182" />
      <circle cx="4.2" cy="9.8" r="0.8" fill="#F2C4B8" />
      {/* eye */}
      <circle cx="5" cy="12" r="0.6" fill="#000" />
      {/* nose */}
      <circle cx="2.8" cy="13" r="0.5" fill="#1A1A1A" />
      {/* whiskers */}
      <line x1="3" y1="13" x2="1" y2="12.5" stroke="#3A2A20" strokeWidth="0.4" />
      <line x1="3" y1="13.2" x2="1" y2="13.5" stroke="#3A2A20" strokeWidth="0.4" />
      {/* feet */}
      <ellipse cx="9" cy="17.5" rx="1" ry="0.6" fill="#5A4838" />
      <ellipse cx="15" cy="17.5" rx="1" ry="0.6" fill="#5A4838" />
    </svg>
  );
};

// ---- Plant / Fungi ----------------------------------------------------

export const InkCapIcon: ComponentType<IconProps> = (p) => {
  const s = p.size ?? 24;
  return (
    <svg {...svgProps(p, s)}>
      {p.title && <title>{p.title}</title>}
      {/* tall narrow black bell-shaped cap */}
      <path d="M 10 2.5 Q 12 1.5 14 2.5 Q 15.5 7 15 12 Q 12 13 9 12 Q 8.5 7 10 2.5 Z" fill="#1F1F24" />
      {/* shaggy texture dashes down the cap */}
      <line x1="11" y1="5" x2="11" y2="11" stroke="#4A4A55" strokeWidth="0.5" />
      <line x1="12" y1="4" x2="12" y2="11.5" stroke="#4A4A55" strokeWidth="0.5" />
      <line x1="13" y1="5" x2="13" y2="11" stroke="#4A4A55" strokeWidth="0.5" />
      {/* ink-drip at rim */}
      <path d="M 9 12 Q 9.5 14 9 15.5" stroke="#1F1F24" strokeWidth="0.7" fill="none" />
      <path d="M 15 12 Q 14.5 14 15 15.5" stroke="#1F1F24" strokeWidth="0.7" fill="none" />
      {/* thin pale stem */}
      <rect x="11.25" y="12" width="1.5" height="9" fill="#E8E2D0" />
    </svg>
  );
};

export const MushroomIcon: ComponentType<IconProps> = (p) => {
  const s = p.size ?? 24;
  return (
    <svg {...svgProps(p, s)}>
      {p.title && <title>{p.title}</title>}
      {/* red cap */}
      <path d="M 3 12 Q 3 3 12 3 Q 21 3 21 12 Q 12 14 3 12 Z" fill="#D32F2F" />
      <path d="M 3 12 Q 12 14 21 12" stroke="#9A1F1F" strokeWidth="0.5" fill="none" />
      {/* white spots */}
      <circle cx="7" cy="7.5" r="1.4" fill="#FAFAFA" />
      <circle cx="13" cy="6" r="1.8" fill="#FAFAFA" />
      <circle cx="17" cy="9.5" r="1.1" fill="#FAFAFA" />
      <circle cx="10" cy="10" r="0.9" fill="#FAFAFA" />
      {/* cream stem */}
      <path d="M 9 12 Q 9 19 10 21 L 14 21 Q 15 19 15 12 Z" fill="#F5E6C8" />
      <path d="M 10 14 Q 10 19 11 20" stroke="#D6C199" strokeWidth="0.4" fill="none" />
    </svg>
  );
};

export const FungusIcon: ComponentType<IconProps> = (p) => {
  const s = p.size ?? 24;
  return (
    <svg {...svgProps(p, s)}>
      {p.title && <title>{p.title}</title>}
      {/* mycelium threads */}
      <path d="M 2 16 Q 8 13 14 16 T 22 15" stroke="#C8B88A" strokeWidth="0.6" fill="none" opacity="0.7" />
      <path d="M 2 19 Q 8 17 14 19 T 22 18" stroke="#C8B88A" strokeWidth="0.6" fill="none" opacity="0.5" />
      {/* colonies — fuzzy circles */}
      <circle cx="7" cy="9" r="3.4" fill="#B5D99A" />
      <circle cx="7" cy="9" r="3.4" fill="none" stroke="#7FB068" strokeWidth="0.5" strokeDasharray="1 1" />
      <circle cx="15" cy="7.5" r="2.6" fill="#E8D48A" />
      <circle cx="15" cy="7.5" r="2.6" fill="none" stroke="#B8A049" strokeWidth="0.5" strokeDasharray="1 1" />
      <circle cx="17" cy="12.5" r="3.1" fill="#9CCC65" />
      <circle cx="17" cy="12.5" r="3.1" fill="none" stroke="#669F3C" strokeWidth="0.5" strokeDasharray="1 1" />
      <circle cx="10" cy="13" r="2.1" fill="#E6F0D6" />
      <circle cx="12.5" cy="10" r="1.4" fill="#689F38" />
    </svg>
  );
};

export const SeedlingIcon: ComponentType<IconProps> = (p) => {
  const s = p.size ?? 24;
  return (
    <svg {...svgProps(p, s)}>
      {p.title && <title>{p.title}</title>}
      {/* soil */}
      <rect x="2" y="19" width="20" height="3.5" rx="1" fill="#5D4037" />
      <circle cx="5" cy="19" r="0.7" fill="#3E2723" />
      <circle cx="19" cy="19.5" r="0.6" fill="#3E2723" />
      <circle cx="12" cy="21" r="0.5" fill="#3E2723" />
      {/* stem */}
      <path d="M 12 19 Q 11.5 12 12 8" stroke="#2E7D32" strokeWidth="1.4" fill="none" strokeLinecap="round" />
      {/* two cotyledons */}
      <path d="M 12 10 Q 5 7 3 12 Q 7 13 12 11 Z" fill="#66BB6A" />
      <path d="M 12 10 Q 19 7 21 12 Q 17 13 12 11 Z" fill="#4CAF50" />
      <path d="M 6 10.5 Q 9 11 12 10.5" stroke="#2E7D32" strokeWidth="0.3" fill="none" />
      <path d="M 18 10.5 Q 15 11 12 10.5" stroke="#2E7D32" strokeWidth="0.3" fill="none" />
    </svg>
  );
};

export const OBSERVATION_ICONS: Record<ObservationKey, ComponentType<IconProps>> = {
  fruitFlies: FruitFlyIcon,
  flies:      FlyIcon,
  mites:      MiteIcon,
  birds:      BirdIcon,
  rats:       RatIcon,
  inkyCaps:   InkCapIcon,
  mushrooms:  MushroomIcon,
  fungus:     FungusIcon,
  seedlings:  SeedlingIcon,
};
