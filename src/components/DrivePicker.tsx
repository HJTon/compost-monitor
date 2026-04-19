import { useEffect, useRef, useState } from 'react';
import { X, Upload, Image as ImageIcon, Loader2, Check } from 'lucide-react';
import type { DriveFile } from '@/utils/photoSlots';
import { bigThumb } from '@/utils/photoSlots';

interface DrivePickerProps {
  systemName: string;
  slotLabel: string;
  allowMultiple?: boolean;
  onClose: () => void;
  onPick: (files: DriveFile[]) => void | Promise<void>;
}

type Tab = 'pick' | 'upload';

export function DrivePicker({ systemName, slotLabel, allowMultiple = true, onClose, onPick }: DrivePickerProps) {
  const [tab, setTab] = useState<Tab>('pick');
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);

  async function loadFiles() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/.netlify/functions/compost-media-list?systemName=${encodeURIComponent(systemName)}`);
      const data = await res.json();
      if (data.success) setFiles(data.files || []);
      else setError(data.error || 'Failed to load');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadFiles(); }, [systemName]);

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (allowMultiple) next.add(id);
      else { next.clear(); next.add(id); }
      return next;
    });
  }

  async function handleConfirm() {
    const picked = files.filter(f => selected.has(f.id!));
    if (picked.length === 0) return;
    setSaving(true);
    try {
      await onPick(picked);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
      setSaving(false);
    }
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const inputFiles = Array.from(e.target.files || []);
    if (inputFiles.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      const uploaded: DriveFile[] = [];
      for (const file of inputFiles) {
        const base64 = await fileToBase64(file);
        const res = await fetch('/.netlify/functions/compost-media-upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mediaData: base64,
            mimeType: file.type || 'image/jpeg',
            filename: file.name,
            systemName,
          }),
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.error || 'Upload failed');
        uploaded.push({
          id: data.fileId,
          name: file.name,
          mimeType: file.type,
          webViewLink: data.webViewLink,
        });
      }
      // Refresh listing so the uploaded files show up with thumbnails
      await loadFiles();
      // Auto-select newly uploaded
      setSelected(prev => {
        const next = new Set(prev);
        uploaded.forEach(u => { if (u.id) next.add(u.id); });
        return next;
      });
      setTab('pick');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (uploadRef.current) uploadRef.current.value = '';
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b">
          <div>
            <div className="text-xs text-gray-400">{systemName}</div>
            <h3 className="font-semibold">{slotLabel}</h3>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100"><X size={20} /></button>
        </div>

        <div className="flex border-b">
          <button
            onClick={() => setTab('pick')}
            className={`flex-1 py-3 text-sm font-medium flex items-center justify-center gap-2 ${tab === 'pick' ? 'text-green-primary border-b-2 border-green-primary' : 'text-gray-500'}`}
          >
            <ImageIcon size={16} /> Pick from Drive
          </button>
          <button
            onClick={() => setTab('upload')}
            className={`flex-1 py-3 text-sm font-medium flex items-center justify-center gap-2 ${tab === 'upload' ? 'text-green-primary border-b-2 border-green-primary' : 'text-gray-500'}`}
          >
            <Upload size={16} /> Upload new
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {error && (
            <div className="mb-3 p-3 rounded-lg bg-red-50 text-red-700 text-sm">{error}</div>
          )}

          {tab === 'pick' && (
            loading ? (
              <div className="flex items-center justify-center py-16 text-gray-400">
                <Loader2 size={24} className="animate-spin" />
              </div>
            ) : files.length === 0 ? (
              <div className="text-center py-16 text-gray-400 text-sm">
                No photos in this build's Drive folder yet. Try the Upload tab.
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
                {files.map(f => {
                  const isSelected = selected.has(f.id!);
                  const isVideo = f.mimeType?.startsWith('video/');
                  const w = Number(f.width) || 0;
                  const h = Number(f.height) || 0;
                  const isPortrait = w && h ? h > w : false;
                  const isLandscape = w && h ? w > h : false;
                  const ratio = w && h ? w / h : 1;
                  return (
                    <button
                      key={f.id}
                      onClick={() => toggle(f.id!)}
                      className={`relative rounded-lg overflow-hidden border-2 transition bg-gray-50 ${isSelected ? 'border-green-primary ring-2 ring-green-primary/30' : 'border-transparent hover:border-gray-300'}`}
                      style={{ aspectRatio: ratio > 0 ? ratio : 1 }}
                    >
                      {f.thumbnailLink ? (
                        <img
                          src={bigThumb(f.thumbnailLink, 400)}
                          alt={f.name}
                          className="w-full h-full object-contain"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <div className="w-full h-full bg-gray-100 flex items-center justify-center text-gray-400 text-xs p-2 text-center">
                          {f.name}
                        </div>
                      )}
                      {(isPortrait || isLandscape) && (
                        <div className="absolute top-1 left-1 bg-black/70 text-white text-[9px] px-1.5 py-0.5 rounded font-medium tracking-wide uppercase">
                          {isPortrait ? 'Portrait' : 'Landscape'}
                        </div>
                      )}
                      {isVideo && (
                        <div className="absolute bottom-1 right-1 bg-black/70 text-white text-[10px] px-1.5 py-0.5 rounded">VIDEO</div>
                      )}
                      {isSelected && (
                        <div className="absolute top-1 right-1 w-6 h-6 rounded-full bg-green-primary text-white flex items-center justify-center">
                          <Check size={14} />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )
          )}

          {tab === 'upload' && (
            <div className="py-8">
              <button
                onClick={() => uploadRef.current?.click()}
                disabled={uploading}
                className="w-full border-2 border-dashed border-gray-300 rounded-xl p-8 text-center hover:border-green-primary hover:bg-green-50/50 transition disabled:opacity-50"
              >
                {uploading ? (
                  <div className="flex items-center justify-center gap-2 text-gray-500">
                    <Loader2 size={20} className="animate-spin" /> Uploading…
                  </div>
                ) : (
                  <>
                    <Upload size={28} className="mx-auto text-gray-400 mb-2" />
                    <div className="font-medium text-gray-700">Click to upload photos</div>
                    <div className="text-xs text-gray-400 mt-1">Max 4 MB each · multiple allowed</div>
                  </>
                )}
              </button>
              <input
                ref={uploadRef}
                type="file"
                accept="image/*,video/*"
                multiple={allowMultiple}
                onChange={handleUpload}
                className="hidden"
              />
            </div>
          )}
        </div>

        {tab === 'pick' && (
          <div className="p-4 border-t flex items-center justify-between">
            <div className="text-sm text-gray-500">
              {selected.size > 0 ? `${selected.size} selected` : 'Select photos to add'}
            </div>
            <div className="flex gap-2">
              <button onClick={onClose} className="px-4 py-2 rounded-lg text-gray-600 hover:bg-gray-100">Cancel</button>
              <button
                onClick={handleConfirm}
                disabled={selected.size === 0 || saving}
                className="px-4 py-2 rounded-lg bg-green-primary text-white disabled:opacity-40 flex items-center gap-2"
              >
                {saving && <Loader2 size={14} className="animate-spin" />}
                Add {selected.size > 0 ? selected.size : ''}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
