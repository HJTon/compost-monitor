export type PhotoSlotKind = 'single' | 'gallery';

export interface PhotoSlotDef {
  id: string;
  label: string;
  description: string;
  kind: PhotoSlotKind;
}

export const PHOTO_SLOTS: PhotoSlotDef[] = [
  { id: 'hero',      label: 'Hero photo',       description: 'The signature shot of this build', kind: 'single' },
  { id: 'start',     label: 'Build start',      description: 'How the pile looked at day zero', kind: 'gallery' },
  { id: 'readiness', label: 'Readiness check',  description: 'Photos from the readiness assessment', kind: 'gallery' },
  { id: 'quality',   label: 'Compost quality / lab', description: 'Nematodes, protozoa, microscopy — stack up as many as you like', kind: 'gallery' },
  { id: 'soil',      label: 'Soil performance', description: 'How the compost performs once applied', kind: 'gallery' },
  { id: 'harvest',   label: 'Harvest / outcome', description: 'What grew and how well', kind: 'gallery' },
];

export interface PhotoTransform {
  fx: number;   // focal x (0..1), 0.5 = centred
  fy: number;   // focal y (0..1)
  zoom: number; // 1 = cover, >1 zoomed in
}

export const DEFAULT_TRANSFORM: PhotoTransform = { fx: 0.5, fy: 0.5, zoom: 1 };

export function parseTransform(raw: string | undefined): PhotoTransform {
  if (!raw) return { ...DEFAULT_TRANSFORM };
  try {
    const p = JSON.parse(raw);
    return {
      fx: typeof p.fx === 'number' ? Math.max(0, Math.min(1, p.fx)) : 0.5,
      fy: typeof p.fy === 'number' ? Math.max(0, Math.min(1, p.fy)) : 0.5,
      zoom: typeof p.zoom === 'number' ? Math.max(1, Math.min(4, p.zoom)) : 1,
    };
  } catch {
    return { ...DEFAULT_TRANSFORM };
  }
}

export function transformToStyle(t: PhotoTransform): import('react').CSSProperties {
  return {
    objectFit: 'cover',
    objectPosition: `${t.fx * 100}% ${t.fy * 100}%`,
    transform: t.zoom > 1 ? `scale(${t.zoom})` : undefined,
    transformOrigin: `${t.fx * 100}% ${t.fy * 100}%`,
  };
}

export interface MediaIndexItem {
  system: string;
  slot: string;
  order: number;
  fileId: string;
  thumbnailUrl: string;
  webViewLink: string;
  mimeType: string;
  caption: string;
  date: string;
  addedAt: string;
  transform: string;
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  thumbnailLink?: string;
  webContentLink?: string;
  webViewLink?: string;
  createdTime?: string;
  width?: number;
  height?: number;
}

/**
 * Best-effort direct-view URL for a Drive image.
 * `thumbnailLink` uses `=s220` by default — we bump it so on-page rendering is sharp.
 */
export function bigThumb(url: string | undefined, size = 1200): string {
  if (!url) return '';
  return url.replace(/=s\d+(-[a-z]+)?$/, `=s${size}`);
}

export function driveViewUrl(fileId: string): string {
  return `https://drive.google.com/uc?export=view&id=${fileId}`;
}
