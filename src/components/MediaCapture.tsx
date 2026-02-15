import { useRef } from 'react';
import { X, Camera, Video } from 'lucide-react';
import { saveMedia } from '@/services/db';
import { generateId } from '@/utils/config';
import type { MediaItem } from '@/types';

interface MediaCaptureProps {
  entryId: string;
  systemId: string;
  date: string;
  onCapture: (item: MediaItem) => void;
  onClose: () => void;
}

export function MediaCapture({ entryId, systemId, date, onCapture, onClose }: MediaCaptureProps) {
  const photoInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

  const handlePhotoCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const base64 = await fileToBase64(file);
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
