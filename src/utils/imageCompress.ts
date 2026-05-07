/**
 * Client-side image resize + re-compress so uploads stay under the Netlify
 * function body limit (~6 MB raw → ~4 MB after base64 overhead).
 *
 * Typical phone photos come in at 3–8 MB and 4000+ px wide. Scaling to a
 * 2400 px long edge and re-encoding as JPEG 0.85 drops them to 300–800 KB
 * with no visible quality loss for compost documentation.
 *
 * HEIC / videos / unsupported types pass through untouched — the server
 * will reject them with its own 4 MB error if they're too big.
 */

const DEFAULT_MAX_EDGE = 2400;
const DEFAULT_QUALITY = 0.85;
const TARGET_MAX_BYTES = 3.5 * 1024 * 1024; // stay comfortably under server's 4 MB cap
const COMPRESSIBLE = /^image\/(jpeg|jpg|png|webp)$/i;

export interface CompressResult {
  base64: string;       // data URL
  mimeType: string;     // always image/jpeg after compression, else original
  originalBytes: number;
  finalBytes: number;
  compressed: boolean;
}

export async function compressImage(
  file: File | Blob,
  opts: { maxEdge?: number; quality?: number } = {},
): Promise<CompressResult> {
  const maxEdge = opts.maxEdge ?? DEFAULT_MAX_EDGE;
  const quality = opts.quality ?? DEFAULT_QUALITY;
  const originalBytes = file.size;
  const mimeType = file.type || 'application/octet-stream';

  // Skip non-image and unsupported image formats (HEIC, gif, etc.)
  if (!COMPRESSIBLE.test(mimeType)) {
    return {
      base64: await blobToDataUrl(file),
      mimeType,
      originalBytes,
      finalBytes: originalBytes,
      compressed: false,
    };
  }

  // Already small enough → skip work
  if (originalBytes <= TARGET_MAX_BYTES) {
    // Still worth a pass if it's a huge-pixel PNG, but size-based is fine default
    return {
      base64: await blobToDataUrl(file),
      mimeType,
      originalBytes,
      finalBytes: originalBytes,
      compressed: false,
    };
  }

  try {
    const img = await loadImage(file);
    const { width, height } = scaleToFit(img.naturalWidth, img.naturalHeight, maxEdge);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    ctx.drawImage(img, 0, 0, width, height);

    // Try progressively harder if first pass is still over the cap
    let q = quality;
    let blob = await canvasToBlob(canvas, 'image/jpeg', q);
    while (blob && blob.size > TARGET_MAX_BYTES && q > 0.5) {
      q -= 0.1;
      blob = await canvasToBlob(canvas, 'image/jpeg', q);
    }

    if (!blob) throw new Error('Canvas encoding failed');

    return {
      base64: await blobToDataUrl(blob),
      mimeType: 'image/jpeg',
      originalBytes,
      finalBytes: blob.size,
      compressed: true,
    };
  } catch (err) {
    console.warn('Image compression failed, uploading original:', err);
    return {
      base64: await blobToDataUrl(file),
      mimeType,
      originalBytes,
      finalBytes: originalBytes,
      compressed: false,
    };
  }
}

function scaleToFit(w: number, h: number, maxEdge: number): { width: number; height: number } {
  const longest = Math.max(w, h);
  if (longest <= maxEdge) return { width: w, height: h };
  const scale = maxEdge / longest;
  return { width: Math.round(w * scale), height: Math.round(h * scale) };
}

function loadImage(file: File | Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise(resolve => canvas.toBlob(resolve, type, quality));
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
