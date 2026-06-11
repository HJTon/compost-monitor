import { useRef, useEffect } from 'react';
import { X, Camera, Video } from 'lucide-react';
import { saveMedia } from '@/services/db';
import { generateId } from '@/utils/config';
import { useCompost } from '@/contexts/CompostContext';
import type { MediaItem } from '@/types';

/** Server rejects uploads over 4 MB (Netlify function body limit). Photos are
 * compressed below this automatically; videos can't be, so check up front. */
const MAX_VIDEO_BYTES = 4 * 1024 * 1024;

interface MediaCaptureProps {
  entryId: string;
  systemId: string;
  systemName?: string;
  date: string;
  mode?: 'photo' | 'video';
  onCapture: (item: MediaItem) => void;
  onClose: () => void;
}

export function MediaCapture({ entryId, systemId, systemName: _systemName, date, mode, onCapture, onClose }: MediaCaptureProps) {
  const photoInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const { addToast } = useCompost();

  // When a specific mode is provided, skip the menu and trigger the input directly
  useEffect(() => {
    if (mode === 'photo') {
      const t = setTimeout(() => photoInputRef.current?.click(), 50);
      return () => clearTimeout(t);
    }
    if (mode === 'video') {
      const t = setTimeout(() => videoInputRef.current?.click(), 50);
      return () => clearTimeout(t);
    }
  }, [mode]);

  const handlePhotoCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Resize photo to max 1600px and compress to stay under upload limits
    const base64 = await resizePhoto(file, 1600, 0.8);
    const thumbnail = await generateThumbnail(base64);
    const safeName = systemId.replace(/[^a-zA-Z0-9]/g, '-');
    const timestamp = Date.now().toString(36);

    const item: MediaItem = {
      id: generateId(),
      entryId,
      type: 'photo',
      mimeType: file.type || 'image/jpeg',
      blob: null,
      base64,
      thumbnailBase64: thumbnail,
      driveUrl: null,
      driveFileId: null,
      filename: `${date}_${safeName}_photo_${timestamp}.jpg`,
      synced: false,
      createdAt: new Date().toISOString(),
    };

    await saveMedia(item);
    onCapture(item);
    onClose();
  };

  const handleVideoCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Reject oversized videos at capture time with a clear explanation,
    // rather than letting the upload fail silently in the sync queue later.
    if (file.size > MAX_VIDEO_BYTES) {
      const mb = (file.size / 1024 / 1024).toFixed(1);
      addToast('error', `That video is ${mb} MB — uploads are limited to 4 MB (roughly 10–15 seconds). Please record a shorter clip.`);
      e.target.value = '';
      onClose();
      return;
    }

    const safeName = systemId.replace(/[^a-zA-Z0-9]/g, '-');
    const timestamp = Date.now().toString(36);

    const item: MediaItem = {
      id: generateId(),
      entryId,
      type: 'video',
      mimeType: file.type || 'video/mp4',
      blob: file,
      base64: null,
      thumbnailBase64: null,
      driveUrl: null,
      driveFileId: null,
      filename: `${date}_${safeName}_video_${timestamp}.mp4`,
      synced: false,
      createdAt: new Date().toISOString(),
    };

    // Try to generate video thumbnail
    try {
      const thumbUrl = await generateVideoThumbnail(file);
      item.thumbnailBase64 = thumbUrl;
    } catch {
      // Thumbnail generation failed, that's ok
    }

    await saveMedia(item);
    onCapture(item);
    onClose();
  };

  // Hidden inputs always rendered so refs are available for the useEffect trigger
  const inputs = (
    <>
      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handlePhotoCapture}
        className="hidden"
      />
      <input
        ref={videoInputRef}
        type="file"
        accept="video/*"
        capture="environment"
        onChange={handleVideoCapture}
        className="hidden"
      />
    </>
  );

  // When a specific mode was requested, skip the menu — the input is triggered via useEffect
  if (mode) {
    return inputs;
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end">
      <div className="bg-white w-full rounded-t-2xl p-6 animate-slide-up">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold">Add Media</h3>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100">
            <X size={20} />
          </button>
        </div>

        <div className="space-y-3">
          <button
            onClick={() => photoInputRef.current?.click()}
            className="w-full py-4 rounded-xl bg-green-50 border border-green-200 text-green-700 font-medium flex items-center justify-center gap-3 active:scale-[0.98] transition-transform"
          >
            <Camera size={24} />
            Take Photo
          </button>

          <button
            onClick={() => videoInputRef.current?.click()}
            className="w-full py-4 rounded-xl bg-blue-50 border border-blue-200 text-blue-700 font-medium flex items-center justify-center gap-3 active:scale-[0.98] transition-transform"
          >
            <Video size={24} />
            Record Video
          </button>
        </div>

        {inputs}
      </div>
    </div>
  );
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function generateThumbnail(base64: string, maxSize = 200): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const scale = Math.min(maxSize / img.width, maxSize / img.height);
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.7));
    };
    img.src = base64;
  });
}

async function resizePhoto(file: File, maxDim = 1600, quality = 0.8): Promise<string> {
  const dataUrl = await fileToBase64(file);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const scale = Math.min(maxDim / width, maxDim / height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.src = dataUrl;
  });
}

async function generateVideoThumbnail(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;

    video.onloadeddata = () => {
      video.currentTime = 0.5;
    };

    video.onseeked = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 200;
      canvas.height = (200 / video.videoWidth) * video.videoHeight;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(video.src);
      resolve(canvas.toDataURL('image/jpeg', 0.7));
    };

    video.onerror = () => {
      URL.revokeObjectURL(video.src);
      reject(new Error('Video thumbnail failed'));
    };

    video.src = URL.createObjectURL(file);
  });
}
