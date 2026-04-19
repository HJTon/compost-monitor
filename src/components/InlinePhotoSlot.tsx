import { useCallback, useEffect, useState } from 'react';
import { PhotoSlot } from './PhotoSlot';
import { PHOTO_SLOTS, type MediaIndexItem } from '@/utils/photoSlots';

interface InlinePhotoSlotProps {
  systemName: string;
  slotId: string;
  heightClass?: string;
  hideLabel?: boolean;
}

/**
 * Self-fetching single-slot photo area for use next to a data section.
 * Use one per slot inline with the page's data blocks.
 */
export function InlinePhotoSlot({ systemName, slotId, heightClass, hideLabel }: InlinePhotoSlotProps) {
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

  const slot = PHOTO_SLOTS.find(s => s.id === slotId);
  if (!slot) return null;

  if (loading) {
    return <div className="h-56 rounded-xl bg-gray-50 animate-pulse" />;
  }

  return (
    <PhotoSlot
      slot={slot}
      systemName={systemName}
      items={items}
      onChange={load}
      heightClass={heightClass}
      hideLabel={hideLabel}
    />
  );
}
