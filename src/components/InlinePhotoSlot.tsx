import { useCallback, useEffect, useState } from 'react';
import { PhotoSlot } from './PhotoSlot';
import { PHOTO_SLOTS, type MediaIndexItem, type PhotoSlotDef } from '@/utils/photoSlots';

interface InlinePhotoSlotProps {
  systemName: string;
  slotId: string;
  heightClass?: string;
  hideLabel?: boolean;
  /** Public view — photos render but nothing can be added or edited */
  readOnly?: boolean;
  /**
   * Slot definition for dynamic slots that aren't in PHOTO_SLOTS
   * (e.g. per-trial slots, `trial-<trialId>`).
   */
  slotDef?: PhotoSlotDef;
  /** Canonical tag for uploads — defaults to the slot id */
  defaultTag?: string;
}

/**
 * Self-fetching single-slot photo area for use next to a data section.
 * Use one per slot inline with the page's data blocks.
 */
export function InlinePhotoSlot({
  systemName, slotId, heightClass, hideLabel, readOnly, slotDef, defaultTag,
}: InlinePhotoSlotProps) {
  const [items, setItems] = useState<MediaIndexItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/.netlify/functions/compost-media-index?system=${encodeURIComponent(systemName)}`);
      const data = await res.json();
      if (data.success) {
        setItems((data.items || []).filter((i: MediaIndexItem) => i.slot === slotId));
      }
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [systemName, slotId]);

  useEffect(() => { load(); }, [load]);

  const slot = slotDef || PHOTO_SLOTS.find(s => s.id === slotId);
  if (!slot) return null;

  if (loading) {
    return <div className="h-56 rounded-xl bg-gray-50 animate-pulse" />;
  }

  // Nothing to show and nothing can be added — don't leave an empty frame.
  if (readOnly && items.length === 0) return null;

  return (
    <PhotoSlot
      slot={slot}
      systemName={systemName}
      items={items}
      onChange={load}
      heightClass={heightClass}
      hideLabel={hideLabel}
      readOnly={readOnly}
      defaultTag={defaultTag}
    />
  );
}
