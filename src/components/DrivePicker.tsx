import { useEffect, useRef, useState } from 'react';
import { X, Upload, Image as ImageIcon, Loader2, Check, FolderPlus } from 'lucide-react';
import type { DriveFile } from '@/utils/photoSlots';
import { bigThumb, PHOTO_TAGS } from '@/utils/photoSlots';
import { compressImage } from '@/utils/imageCompress';

interface Subfolder { id: string; name: string }

interface DrivePickerProps {
  systemName: string;
  slotLabel: string;
  allowMultiple?: boolean;
  defaultTag?: string; // seed tag based on the slot
  onClose: () => void;
  onPick: (files: DriveFile[], meta?: { tags?: string[] }) => void | Promise<void>;
}

type Tab = 'pick' | 'upload';

export function DrivePicker({ systemName, slotLabel, allowMultiple = true, defaultTag, onClose, onPick }: DrivePickerProps) {
  const [tab, setTab] = useState<Tab>('pick');
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [subfolders, setSubfolders] = useState<Subfolder[]>([]);
  const [currentSubfolder, setCurrentSubfolder] = useState<string>(''); // '' = build root
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Tags that will be applied to the picked/uploaded files. Seeded by the
  // slot default so common case is zero extra taps.
  const [pickTags, setPickTags] = useState<string[]>(defaultTag ? [defaultTag] : []);
  const uploadRef = useRef<HTMLInputElement>(null);

  function toggleTag(id: string) {
    setPickTags(prev => prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]);
  }

  async function loadFiles(subfolder: string = currentSubfolder) {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ systemName });
      if (subfolder) qs.set('subfolder', subfolder);
      const res = await fetch(`/.netlify/functions/compost-media-list?${qs.toString()}`);
      const data = await res.json();
      if (data.success) {
        setFiles(data.files || []);
        setSubfolders(data.subfolders || []);
      } else {
        setError(data.error || 'Failed to load');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadFiles(''); setCurrentSubfolder(''); setSelected(new Set()); }, [systemName]);

  function handleSubfolderChange(value: string) {
    setCurrentSubfolder(value);
    setSelected(new Set());
    loadFiles(value);
  }

  async function handleCreateFolder() {
    const name = newFolderName.trim();
    if (!name) return;
    // Creating a folder is implicit: just switch into it and the next upload
    // will create it via compost-media-upload's getOrCreateSubfolder.
    // But we also want it to appear in the dropdown even before upload, so
    // trigger a zero-file upload? Simpler: add it optimistically to the list
    // and switch to it — it'll materialise on first upload.
    setSubfolders(prev => prev.some(s => s.name === name) ? prev : [...prev, { id: `pending-${name}`, name }]);
    setNewFolderName('');
    setShowNewFolder(false);
    handleSubfolderChange(name);
    setTab('upload');
  }

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
      await onPick(picked, { tags: pickTags });
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
        const compressed = await compressImage(file);
        if (compressed.compressed) {
          console.log(`Compressed ${file.name}: ${(compressed.originalBytes / 1024 / 1024).toFixed(1)} MB → ${(compressed.finalBytes / 1024 / 1024).toFixed(1)} MB`);
        }
        const res = await fetch('/.netlify/functions/compost-media-upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mediaData: compressed.base64,
            mimeType: compressed.mimeType,
            filename: file.name,
            systemName,
            subfolder: currentSubfolder || undefined,
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

          {(tab === 'pick' || tab === 'upload') && (
            <div className="mb-4 flex items-center gap-2 flex-wrap">
              <label className="text-xs text-gray-500">Folder:</label>
              <select
                value={currentSubfolder}
                onChange={e => handleSubfolderChange(e.target.value)}
                className="text-sm border border-gray-300 rounded-lg px-2 py-1 bg-white"
              >
                <option value="">{systemName} (root)</option>
                {subfolders.map(sf => (
                  <option key={sf.id} value={sf.name}>{sf.name}</option>
                ))}
              </select>
              {showNewFolder ? (
                <div className="flex items-center gap-1">
                  <input
                    autoFocus
                    value={newFolderName}
                    onChange={e => setNewFolderName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleCreateFolder(); if (e.key === 'Escape') { setShowNewFolder(false); setNewFolderName(''); } }}
                    placeholder="Folder name"
                    className="text-sm border border-gray-300 rounded-lg px-2 py-1"
                  />
                  <button onClick={handleCreateFolder} className="text-xs px-2 py-1 rounded-lg bg-green-primary text-white">Create</button>
                  <button onClick={() => { setShowNewFolder(false); setNewFolderName(''); }} className="text-xs px-2 py-1 rounded-lg text-gray-500 hover:bg-gray-100">Cancel</button>
                </div>
              ) : (
                <button
                  onClick={() => setShowNewFolder(true)}
                  className="text-xs flex items-center gap-1 px-2 py-1 rounded-lg text-gray-600 hover:bg-gray-100"
                  title="New subfolder"
                >
                  <FolderPlus size={14} /> New
                </button>
              )}
            </div>
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
          <div className="p-4 border-t space-y-3">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-gray-400 mb-1.5">Tag these photos</div>
              <div className="flex flex-wrap gap-1.5">
                {PHOTO_TAGS.map(t => {
                  const active = pickTags.includes(t.id);
                  return (
                    <button
                      key={t.id}
                      onClick={() => toggleTag(t.id)}
                      className={`text-xs px-2.5 py-1 rounded-full font-medium transition-all ${active ? 'bg-green-primary text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                    >
                      {t.emoji} {t.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex items-center justify-between">
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
          </div>
        )}
      </div>
    </div>
  );
}

