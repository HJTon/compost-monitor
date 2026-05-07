import { useRef, useState } from 'react';
import { X, RotateCcw, Check } from 'lucide-react';
import type { PhotoTransform } from '@/utils/photoSlots';
import { DEFAULT_TRANSFORM, bigThumb } from '@/utils/photoSlots';

interface FrameEditorProps {
  imageUrl: string;
  thumbnailUrl?: string;
  fileId?: string;
  initial: PhotoTransform;
  onCancel: () => void;
  onSave: (t: PhotoTransform) => void | Promise<void>;
}

/**
 * Focal-point + zoom editor.
 * Drag on the preview to pick which part of the photo is centred in the frame;
 * use the slider (or mouse-wheel/pinch) to zoom.
 * Stored as {fx, fy, zoom} — non-destructive, the original Drive image is untouched.
 */
export function FrameEditor({ imageUrl, thumbnailUrl, fileId, initial, onCancel, onSave }: FrameEditorProps) {
  const [t, setT] = useState<PhotoTransform>(initial);
  const [saving, setSaving] = useState(false);
  const [srcStep, setSrcStep] = useState(0);
  const frameRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  // Ordered URL chain. The lh3.googleusercontent.com URLs sometimes 403
  // (especially at large sizes), which would leave the editor showing a
  // black frame. onError below walks down this list.
  const srcChain = [
    imageUrl,
    bigThumb(thumbnailUrl, 1600),
    bigThumb(thumbnailUrl, 1000),
    fileId ? `https://drive.google.com/thumbnail?id=${fileId}&sz=w1600` : '',
    fileId ? `https://drive.google.com/thumbnail?id=${fileId}&sz=w800` : '',
  ].filter(Boolean);
  const src = srcChain[Math.min(srcStep, srcChain.length - 1)] || '';

  function updateFocal(clientX: number, clientY: number) {
    const el = frameRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const fx = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const fy = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    setT(prev => ({ ...prev, fx, fy }));
  }

  function onPointerDown(e: React.PointerEvent) {
    draggingRef.current = true;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    updateFocal(e.clientX, e.clientY);
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!draggingRef.current) return;
    updateFocal(e.clientX, e.clientY);
  }
  function onPointerUp() {
    draggingRef.current = false;
  }

  function onWheel(e: React.WheelEvent) {
    e.preventDefault();
    setT(prev => ({
      ...prev,
      zoom: Math.max(1, Math.min(4, prev.zoom + (e.deltaY < 0 ? 0.1 : -0.1))),
    }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      await onSave(t);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-3xl overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between p-4 border-b">
          <div>
            <h3 className="font-semibold">Adjust frame</h3>
            <p className="text-xs text-gray-500">Drag to pick the centre point. Scroll or slide to zoom.</p>
          </div>
          <button onClick={onCancel} className="p-2 rounded-lg hover:bg-gray-100"><X size={20} /></button>
        </div>

        <div className="p-4 space-y-4">
          {/* Preview: the ACTUAL frame that will be shown on the analysis page */}
          <div
            ref={frameRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onWheel={onWheel}
            className="relative w-full h-80 rounded-xl bg-gray-900 overflow-hidden cursor-grab active:cursor-grabbing select-none touch-none"
          >
            {src && (
              <img
                key={srcStep}
                src={src}
                alt="Preview"
                className="w-full h-full pointer-events-none"
                style={{
                  objectFit: 'cover',
                  objectPosition: `${t.fx * 100}% ${t.fy * 100}%`,
                  transform: t.zoom > 1 ? `scale(${t.zoom})` : undefined,
                  transformOrigin: `${t.fx * 100}% ${t.fy * 100}%`,
                }}
                referrerPolicy="no-referrer"
                draggable={false}
                onError={() => {
                  setSrcStep(prev => (prev + 1 < srcChain.length ? prev + 1 : prev));
                }}
              />
            )}
            {/* Cross-hair showing focal point */}
            <div
              className="absolute w-6 h-6 border-2 border-white rounded-full pointer-events-none shadow-lg"
              style={{
                left: `calc(${t.fx * 100}% - 12px)`,
                top: `calc(${t.fy * 100}% - 12px)`,
                background: 'radial-gradient(circle, rgba(255,255,255,0.4) 0, transparent 70%)',
              }}
            />
          </div>

          {/* Zoom slider */}
          <div>
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span>Zoom</span>
              <span>{t.zoom.toFixed(1)}×</span>
            </div>
            <input
              type="range"
              min="1"
              max="4"
              step="0.1"
              value={t.zoom}
              onChange={e => setT(prev => ({ ...prev, zoom: Number(e.target.value) }))}
              className="w-full accent-green-primary"
            />
          </div>
        </div>

        <div className="p-4 border-t flex items-center justify-between">
          <button
            onClick={() => setT({ ...DEFAULT_TRANSFORM })}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700"
          >
            <RotateCcw size={14} /> Reset
          </button>
          <div className="flex gap-2">
            <button onClick={onCancel} className="px-4 py-2 rounded-lg text-gray-600 hover:bg-gray-100">Cancel</button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 rounded-lg bg-green-primary text-white flex items-center gap-2 disabled:opacity-50"
            >
              <Check size={16} /> {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
