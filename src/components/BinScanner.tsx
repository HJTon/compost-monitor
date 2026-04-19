import { useRef, useState, useEffect, useCallback } from 'react';
import { RefreshCw, X, Loader2, CheckCircle2, XCircle, MinusCircle } from 'lucide-react';
import { recognizeSerialNumber, formatSerialNumber } from '@/services/ocrService';

export type ScanOutcome = 'selected' | 'deselected' | 'not_found' | 'no_text';

type ScanPhase = 'scanning' | 'processing' | 'result';

interface ScanResult {
  outcome: ScanOutcome;
  serial: string;
}

interface BinScannerProps {
  /** Called when a serial is read — look it up and toggle, return the outcome */
  onScanSerial: (serial: string) => Exclude<ScanOutcome, 'no_text'>;
  onClose: () => void;
  /** Override default outcome labels (e.g. for lookup mode) */
  outcomeLabels?: Partial<Record<ScanOutcome, string>>;
  /** Called after the result overlay auto-dismisses (e.g. to auto-close scanner) */
  onResultDone?: () => void;
}

const OUTCOME_CONFIG: Record<ScanOutcome, { label: string; colour: string; icon: React.ReactNode }> = {
  selected: {
    label: 'Added to build',
    colour: 'text-green-400',
    icon: <CheckCircle2 size={40} className="text-green-400 mx-auto mb-2" />,
  },
  deselected: {
    label: 'Removed from build',
    colour: 'text-amber-400',
    icon: <MinusCircle size={40} className="text-amber-400 mx-auto mb-2" />,
  },
  not_found: {
    label: 'Bin not in list',
    colour: 'text-red-400',
    icon: <XCircle size={40} className="text-red-400 mx-auto mb-2" />,
  },
  no_text: {
    label: "Couldn't read label",
    colour: 'text-gray-400',
    icon: <XCircle size={40} className="text-gray-400 mx-auto mb-2" />,
  },
};

export function BinScanner({ onScanSerial, onClose, outcomeLabels, onResultDone }: BinScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [phase, setPhase] = useState<ScanPhase>('scanning');
  const [result, setResult] = useState<ScanResult | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  }, []);

  const startCamera = useCallback(async () => {
    try {
      setCameraError(null);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode,
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch {
      setCameraError('Unable to access camera. Please check permissions.');
    }
  }, [facingMode]);

  useEffect(() => {
    startCamera();
    return () => stopCamera();
  }, [startCamera, stopCamera]);

  const handleCapture = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current || phase !== 'scanning') return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Snapshot the current frame — camera keeps streaming
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);
    const imageData = canvas.toDataURL('image/jpeg', 0.9);

    setPhase('processing');

    try {
      const ocr = await recognizeSerialNumber(imageData);
      const serial = formatSerialNumber(ocr.suggestedSerial);

      let outcome: ScanOutcome;
      if (!serial || serial.length < 3) {
        outcome = 'no_text';
      } else {
        outcome = onScanSerial(serial);
      }

      setResult({ outcome, serial });
    } catch {
      setResult({ outcome: 'no_text', serial: '' });
    }

    setPhase('result');

    // Return to scanning after 1.5 s — camera never stopped
    setTimeout(() => {
      setResult(null);
      setPhase('scanning');
      onResultDone?.();
    }, 1500);
  }, [phase, onScanSerial]);

  const toggleCamera = useCallback(() => {
    stopCamera();
    setFacingMode(prev => (prev === 'environment' ? 'user' : 'environment'));
  }, [stopCamera]);

  const handleClose = useCallback(() => {
    stopCamera();
    onClose();
  }, [stopCamera, onClose]);

  if (cameraError) {
    return (
      <div className="rounded-xl bg-gray-900 p-6 text-center">
        <p className="text-gray-300 text-sm mb-4">{cameraError}</p>
        <div className="flex gap-2 justify-center">
          <button
            onClick={handleClose}
            className="px-4 py-2 text-sm text-gray-300 border border-gray-600 rounded-lg"
          >
            Cancel
          </button>
          <button
            onClick={startCamera}
            className="px-4 py-2 text-sm text-white bg-green-primary rounded-lg"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl overflow-hidden bg-gray-900 shadow-lg">
      {/* ── Video feed ─────────────────────────────────────── */}
      <div className="relative">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="w-full h-auto"
        />

        {/* Targeting guide */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="border-2 border-white/50 rounded-lg w-3/4 h-16 flex items-center justify-center">
            <span className="text-white/70 text-sm bg-black/30 px-2 py-1 rounded">
              Align serial number here
            </span>
          </div>
        </div>

        {/* Processing overlay */}
        {phase === 'processing' && (
          <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
            <div className="text-center">
              <Loader2 size={32} className="text-white animate-spin mx-auto mb-2" />
              <p className="text-white text-sm">Reading label…</p>
            </div>
          </div>
        )}

        {/* Result overlay */}
        {phase === 'result' && result && (() => {
          const cfg = OUTCOME_CONFIG[result.outcome];
          const label = outcomeLabels?.[result.outcome] ?? cfg.label;
          return (
            <div className="absolute inset-0 bg-black/70 flex items-center justify-center">
              <div className="text-center px-4">
                {cfg.icon}
                {result.serial && (
                  <p className="text-white font-mono font-bold text-lg mb-1">
                    #{result.serial}
                  </p>
                )}
                <p className={`text-sm font-medium ${cfg.colour}`}>{label}</p>
              </div>
            </div>
          );
        })()}

        {/* Close */}
        <button
          onClick={handleClose}
          className="absolute top-2 right-2 p-2 bg-black/50 text-white rounded-full hover:bg-black/70"
        >
          <X size={20} />
        </button>

        {/* Switch camera */}
        <button
          onClick={toggleCamera}
          className="absolute top-2 left-2 p-2 bg-black/50 text-white rounded-full hover:bg-black/70"
        >
          <RefreshCw size={20} />
        </button>
      </div>

      {/* Hidden canvas for frame capture */}
      <canvas ref={canvasRef} className="hidden" />

      {/* ── Capture button ─────────────────────────────────── */}
      <div className="py-5 flex justify-center">
        <button
          onClick={handleCapture}
          disabled={phase !== 'scanning'}
          className="w-16 h-16 bg-white rounded-full border-4 border-green-primary flex items-center justify-center active:scale-95 transition-transform disabled:opacity-40"
          aria-label="Capture"
        >
          <div className="w-12 h-12 bg-green-primary rounded-full" />
        </button>
      </div>
    </div>
  );
}
