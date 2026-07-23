import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, X, Trash2, Plus, ImageOff, MoreHorizontal, Type, Crop, Check, Calendar, Tag } from 'lucide-react';
import type { MediaIndexItem, PhotoTransform } from '@/utils/photoSlots';
import { PHOTO_TAGS } from '@/utils/photoSlots';
import { bigThumb, parseTransform, transformToStyle } from '@/utils/photoSlots';
import { FrameEditor } from './FrameEditor';

interface PhotoGalleryProps {
  items: MediaIndexItem[];
  heightClass?: string;
  onAdd: () => void;
  onRemove?: (item: MediaIndexItem) => void;
  onReplace?: () => void;
  onCaptionChange?: (item: MediaIndexItem, caption: string) => void | Promise<void>;
  onTransformChange?: (item: MediaIndexItem, t: PhotoTransform) => void | Promise<void>;
  onEventDateChange?: (item: MediaIndexItem, eventDate: string) => void | Promise<void>;
  onTagsChange?: (item: MediaIndexItem, tags: string) => void | Promise<void>;
  singleSlot?: boolean;
  printMode?: boolean;
  /** Public view — photos are viewable but every mutation control is hidden */
  readOnly?: boolean;
}

function imageSrc(it: MediaIndexItem, size = 1600): string {
  return bigThumb(it.thumbnailUrl, size) || `https://drive.google.com/thumbnail?id=${it.fileId}&sz=w${size}`;
}

function isVideo(it: MediaIndexItem): boolean {
  return (it.mimeType || '').startsWith('video/');
}

/** Drive's embeddable player — streams/plays the file for anyone-with-link. */
function videoEmbedSrc(it: MediaIndexItem): string {
  return `https://drive.google.com/file/d/${it.fileId}/preview`;
}

/**
 * Ordered list of URLs to try for a given image. Google's
 * `lh3.googleusercontent.com` thumbnails sometimes 403 or return a blank
 * placeholder — especially at large sizes — so we chain progressively
 * simpler URLs and let the <img onError> walk down the list.
 */
function imageSrcChain(it: MediaIndexItem): string[] {
  const chain: string[] = [];
  const thumb1600 = bigThumb(it.thumbnailUrl, 1600);
  const thumb1000 = bigThumb(it.thumbnailUrl, 1000);
  if (thumb1600) chain.push(thumb1600);
  if (thumb1000 && thumb1000 !== thumb1600) chain.push(thumb1000);
  chain.push(`https://drive.google.com/thumbnail?id=${it.fileId}&sz=w1600`);
  chain.push(`https://drive.google.com/thumbnail?id=${it.fileId}&sz=w800`);
  return chain;
}

export function PhotoGallery({
  items, heightClass = 'h-64 md:h-96', onAdd, onRemove, onReplace,
  onCaptionChange, onTransformChange, onEventDateChange, onTagsChange, singleSlot, printMode,
  readOnly,
}: PhotoGalleryProps) {
  const [index, setIndex] = useState(0);
  const [lightbox, setLightbox] = useState<MediaIndexItem | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editingCaption, setEditingCaption] = useState(false);
  const [captionDraft, setCaptionDraft] = useState('');
  const [savingCaption, setSavingCaption] = useState(false);
  const [editingFrame, setEditingFrame] = useState(false);
  const [editingDate, setEditingDate] = useState(false);
  const [dateDraft, setDateDraft] = useState('');
  const [editingTags, setEditingTags] = useState(false);
  const [tagsDraft, setTagsDraft] = useState<string[]>([]);
  const [aspects, setAspects] = useState<Record<string, number>>({});
  // Per-file index into the fallback URL chain — bumped on <img> onError.
  const [srcStep, setSrcStep] = useState<Record<string, number>>({});

  useEffect(() => {
    if (index >= items.length) setIndex(Math.max(0, items.length - 1));
  }, [items.length, index]);

  useEffect(() => {
    if (printMode) return;
    function onKey(e: KeyboardEvent) {
      if (lightbox) {
        if (e.key === 'Escape') setLightbox(null);
        return;
      }
      if (editingCaption || editingFrame || editingDate || editingTags || menuOpen) return;
      if (items.length <= 1) return;
      if (e.key === 'ArrowLeft') setIndex(i => (i - 1 + items.length) % items.length);
      if (e.key === 'ArrowRight') setIndex(i => (i + 1) % items.length);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [items.length, lightbox, menuOpen, editingCaption, editingFrame, editingDate, editingTags, printMode]);

  // Empty slot — show "Add photo" placeholder
  if (items.length === 0) {
    if (printMode || readOnly) return null;
    return (
      <button
        onClick={onAdd}
        className={`w-full ${heightClass} rounded-xl border-2 border-dashed border-gray-300 bg-gray-50/50 flex flex-col items-center justify-center gap-2 text-gray-400 hover:border-green-primary hover:text-green-primary hover:bg-green-50/50 transition`}
      >
        <ImageOff size={32} />
        <div className="text-sm font-medium">Add photo</div>
      </button>
    );
  }

  // Print-mode: stacked, no slideshow, so every photo lands in the PDF
  if (printMode) {
    return (
      <div className="space-y-4 print:space-y-2">
        {items.map(it => {
          const t = parseTransform(it.transform);
          const video = isVideo(it);
          return (
            <figure key={it.fileId} className="break-inside-avoid">
              <div className="relative w-full aspect-[4/3] overflow-hidden rounded-lg">
                {/* A PDF can't play video, so a video prints as its poster frame. */}
                <img
                  src={imageSrc(it, 1600)}
                  alt={it.caption || ''}
                  loading="eager"
                  className="w-full h-full"
                  style={transformToStyle(t)}
                  referrerPolicy="no-referrer"
                />
                {video && (
                  <div className="absolute bottom-1 right-1 bg-black/70 text-white text-[9px] px-1.5 py-0.5 rounded uppercase tracking-wide">Video</div>
                )}
              </div>
              {it.caption && <figcaption className="text-xs text-gray-600 mt-1">{it.caption}</figcaption>}
            </figure>
          );
        })}
      </div>
    );
  }

  const current = items[index];
  const currentTransform = parseTransform(current.transform);
  const multiple = items.length > 1;
  // aspect ratio is still tracked via onLoad (used elsewhere e.g. by print
  // mode). Photos now fit the fixed heightClass frame via object-cover, so
  // we no longer expand the container for portrait photos.
  void aspects;

  function openCaption() {
    setMenuOpen(false);
    setCaptionDraft(current.caption || '');
    setEditingCaption(true);
  }

  function openFrame() {
    setMenuOpen(false);
    setEditingFrame(true);
  }

  function openDate() {
    setMenuOpen(false);
    setDateDraft((current.eventDate || '').slice(0, 10));
    setEditingDate(true);
  }

  function openTags() {
    setMenuOpen(false);
    setTagsDraft((current.tags || '').split(',').map(t => t.trim()).filter(Boolean));
    setEditingTags(true);
  }

  async function saveDate() {
    if (onEventDateChange) await onEventDateChange(current, dateDraft);
    setEditingDate(false);
  }

  async function saveTags() {
    if (onTagsChange) {
      const joined = [...new Set(tagsDraft.map(t => t.trim().toLowerCase()).filter(Boolean))].join(',');
      await onTagsChange(current, joined);
    }
    setEditingTags(false);
  }

  function toggleTag(id: string) {
    setTagsDraft(prev => prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]);
  }

  async function saveCaption() {
    if (!onCaptionChange) { setEditingCaption(false); return; }
    setSavingCaption(true);
    try {
      await onCaptionChange(current, captionDraft.trim());
      setEditingCaption(false);
    } finally {
      setSavingCaption(false);
    }
  }

  async function saveTransform(t: PhotoTransform) {
    if (onTransformChange) await onTransformChange(current, t);
    setEditingFrame(false);
  }

  return (
    <>
      <div
        className={`relative w-full rounded-xl overflow-hidden bg-gray-100 group ${heightClass}`}
      >
        {(() => {
          const chain = imageSrcChain(current);
          const step = srcStep[current.fileId] || 0;
          const src = chain[Math.min(step, chain.length - 1)];
          const video = isVideo(current);
          return (
            <>
              <img
                key={`${current.fileId}-${step}`}
                src={src}
                alt={current.caption || ''}
                className="w-full h-full cursor-zoom-in"
                style={transformToStyle(currentTransform)}
                referrerPolicy="no-referrer"
                onClick={() => setLightbox(current)}
                onLoad={(e) => {
                  const el = e.currentTarget;
                  if (el.naturalWidth && el.naturalHeight) {
                    const ratio = el.naturalWidth / el.naturalHeight;
                    setAspects(prev => prev[current.fileId] === ratio ? prev : { ...prev, [current.fileId]: ratio });
                  }
                }}
                onError={() => {
                  // Walk down the URL chain on failure. Only bump if there's a
                  // next URL to try, otherwise we'd loop forever.
                  setSrcStep(prev => {
                    const cur = prev[current.fileId] || 0;
                    if (cur + 1 >= chain.length) return prev;
                    return { ...prev, [current.fileId]: cur + 1 };
                  });
                }}
              />
              {/* Video: poster frame above, with a play overlay that opens the
                  Drive player in the lightbox. */}
              {video && (
                <button
                  onClick={() => setLightbox(current)}
                  className="absolute inset-0 flex items-center justify-center bg-black/10 hover:bg-black/20 transition-colors cursor-pointer"
                  title="Play video"
                >
                  <span className="w-14 h-14 rounded-full bg-black/60 flex items-center justify-center shadow-lg">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z" /></svg>
                  </span>
                  <span className="absolute bottom-2 left-2 bg-black/70 text-white text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wide">Video</span>
                </button>
              )}
            </>
          );
        })()}

        {/* Top-right action cluster — hidden entirely in read-only (public) view */}
        {!readOnly && (
        <div className="absolute top-2 right-2 flex gap-2 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
          {singleSlot && onReplace && (
            <button
              onClick={onReplace}
              className="bg-white/90 backdrop-blur rounded-full px-3 py-1.5 text-xs font-medium shadow hover:bg-white"
            >
              Replace
            </button>
          )}
          {!singleSlot && (
            <button
              onClick={onAdd}
              className="bg-white/90 backdrop-blur rounded-full w-8 h-8 flex items-center justify-center shadow hover:bg-white"
              title="Add more"
            >
              <Plus size={16} />
            </button>
          )}
          {/* Menu toggle */}
          <div className="relative">
            <button
              onClick={(e) => { e.stopPropagation(); setMenuOpen(v => !v); }}
              className="bg-white/90 backdrop-blur rounded-full w-8 h-8 flex items-center justify-center shadow hover:bg-white"
              title="More"
            >
              <MoreHorizontal size={16} />
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 top-10 bg-white rounded-xl shadow-xl border border-gray-100 py-1 min-w-[160px] z-20">
                  <button
                    onClick={openCaption}
                    className="w-full px-3 py-2 text-left text-sm flex items-center gap-2 hover:bg-gray-50"
                  >
                    <Type size={14} /> Edit caption
                  </button>
                  <button
                    onClick={openFrame}
                    className="w-full px-3 py-2 text-left text-sm flex items-center gap-2 hover:bg-gray-50"
                  >
                    <Crop size={14} /> Adjust frame
                  </button>
                  {onEventDateChange && (
                    <button
                      onClick={openDate}
                      className="w-full px-3 py-2 text-left text-sm flex items-center gap-2 hover:bg-gray-50"
                    >
                      <Calendar size={14} /> Adjust date
                    </button>
                  )}
                  {onTagsChange && (
                    <button
                      onClick={openTags}
                      className="w-full px-3 py-2 text-left text-sm flex items-center gap-2 hover:bg-gray-50"
                    >
                      <Tag size={14} /> Edit tags
                    </button>
                  )}
                  {onRemove && (
                    <button
                      onClick={() => { setMenuOpen(false); onRemove(current); }}
                      className="w-full px-3 py-2 text-left text-sm flex items-center gap-2 hover:bg-gray-50 text-red-600"
                    >
                      <Trash2 size={14} /> Remove photo
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
        )}

        {/* Prev / Next */}
        {multiple && (
          <>
            <button
              onClick={() => setIndex((index - 1 + items.length) % items.length)}
              className="absolute left-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white/80 backdrop-blur flex items-center justify-center shadow hover:bg-white"
            >
              <ChevronLeft size={20} />
            </button>
            <button
              onClick={() => setIndex((index + 1) % items.length)}
              className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white/80 backdrop-blur flex items-center justify-center shadow hover:bg-white"
            >
              <ChevronRight size={20} />
            </button>
          </>
        )}

        {/* Dots */}
        {multiple && (
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1.5">
            {items.map((_, i) => (
              <button
                key={i}
                onClick={() => setIndex(i)}
                className={`w-2 h-2 rounded-full transition-all ${i === index ? 'bg-white w-6' : 'bg-white/60'}`}
              />
            ))}
          </div>
        )}

        {/* Caption overlay */}
        {!editingCaption && current.caption && (
          <button
            onClick={openCaption}
            className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent text-white text-sm p-3 pt-10 text-left hover:from-black/80"
            title="Click to edit caption"
          >
            {current.caption}
          </button>
        )}
        {!editingCaption && !current.caption && onCaptionChange && (
          <button
            onClick={openCaption}
            className="absolute bottom-2 left-2 opacity-0 group-hover:opacity-100 bg-white/90 backdrop-blur rounded-full px-2.5 py-1 text-xs shadow hover:bg-white flex items-center gap-1"
          >
            <Type size={12} /> Add caption
          </button>
        )}

        {/* Inline date editor */}
        {editingDate && (
          <div className="absolute bottom-0 left-0 right-0 bg-white border-t shadow-lg p-3 flex gap-2 items-center">
            <Calendar size={16} className="text-gray-400" />
            <input
              type="date"
              autoFocus
              value={dateDraft}
              onChange={e => setDateDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') saveDate();
                if (e.key === 'Escape') setEditingDate(false);
              }}
              className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:border-green-primary"
            />
            <button onClick={saveDate} className="w-9 h-9 rounded-lg bg-green-primary text-white flex items-center justify-center"><Check size={16} /></button>
            <button onClick={() => setEditingDate(false)} className="w-9 h-9 rounded-lg bg-gray-100 text-gray-600 flex items-center justify-center"><X size={16} /></button>
          </div>
        )}

        {/* Inline tags editor */}
        {editingTags && (
          <div className="absolute bottom-0 left-0 right-0 bg-white border-t shadow-lg p-3 space-y-2">
            <div className="flex flex-wrap gap-1.5">
              {PHOTO_TAGS.map(t => {
                const active = tagsDraft.includes(t.id);
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
            <div className="flex justify-end gap-2">
              <button onClick={() => setEditingTags(false)} className="text-sm px-3 py-1.5 rounded-lg text-gray-600 hover:bg-gray-100">Cancel</button>
              <button onClick={saveTags} className="text-sm px-3 py-1.5 rounded-lg bg-green-primary text-white">Save</button>
            </div>
          </div>
        )}

        {/* Inline caption editor */}
        {editingCaption && (
          <div className="absolute bottom-0 left-0 right-0 bg-white border-t shadow-lg p-3 flex gap-2 items-start">
            <input
              type="text"
              autoFocus
              value={captionDraft}
              onChange={e => setCaptionDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') saveCaption();
                if (e.key === 'Escape') setEditingCaption(false);
              }}
              placeholder="Caption for this photo…"
              className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:border-green-primary"
            />
            <button
              onClick={saveCaption}
              disabled={savingCaption}
              className="w-9 h-9 rounded-lg bg-green-primary text-white flex items-center justify-center disabled:opacity-50"
            >
              <Check size={16} />
            </button>
            <button
              onClick={() => setEditingCaption(false)}
              className="w-9 h-9 rounded-lg bg-gray-100 text-gray-600 flex items-center justify-center"
            >
              <X size={16} />
            </button>
          </div>
        )}
      </div>

      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4"
          onClick={() => setLightbox(null)}
        >
          <button className="absolute top-4 right-4 text-white p-2 z-10" onClick={() => setLightbox(null)}>
            <X size={24} />
          </button>
          {isVideo(lightbox) ? (
            <iframe
              src={videoEmbedSrc(lightbox)}
              title={lightbox.caption || 'Video'}
              className="w-[90vw] h-[80vh] max-w-5xl rounded-lg bg-black"
              allow="autoplay; fullscreen"
              allowFullScreen
              onClick={e => e.stopPropagation()}
            />
          ) : (
            <img
              src={imageSrc(lightbox, 2400)}
              alt={lightbox.caption || ''}
              className="max-w-full max-h-full object-contain"
              referrerPolicy="no-referrer"
            />
          )}
        </div>
      )}

      {/* Frame editor */}
      {editingFrame && (
        <FrameEditor
          imageUrl={imageSrc(current, 1600)}
          thumbnailUrl={current.thumbnailUrl}
          fileId={current.fileId}
          initial={currentTransform}
          onCancel={() => setEditingFrame(false)}
          onSave={saveTransform}
        />
      )}
    </>
  );
}
