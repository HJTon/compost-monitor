import type { BuildDimensions } from '@/types';

/**
 * Calculate volume in litres from dimensions.
 * - Cuboid: L × W × H
 * - Cylinder: π × (D/2)² × H
 * All inputs are in cm, output is litres (1 litre = 1000 cm³).
 */
export function calcVolumeLitres(dims: BuildDimensions, heightOverrideCm?: number): number | null {
  const h = heightOverrideCm ?? dims.heightCm;
  if (h == null || h <= 0) return null;

  if (dims.shape === 'cuboid') {
    if (!dims.lengthCm || !dims.widthCm) return null;
    return (dims.lengthCm * dims.widthCm * h) / 1000;
  }

  if (dims.shape === 'cylinder') {
    if (!dims.diameterCm) return null;
    const r = dims.diameterCm / 2;
    return (Math.PI * r * r * h) / 1000;
  }

  return null;
}

/**
 * Format litres for display.
 * < 1000 L → "450 L"
 * >= 1000 L → "1.2 m³"  (1 m³ = 1000 L)
 */
export function formatVolume(litres: number): string {
  if (litres >= 1000) {
    return `${(litres / 1000).toFixed(2)} m³`;
  }
  return `${Math.round(litres)} L`;
}

/**
 * Calculate percentage change between two volumes.
 */
export function volumeChangePercent(initial: number, current: number): number {
  if (initial <= 0) return 0;
  return Math.round(((current - initial) / initial) * 100);
}
