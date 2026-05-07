import { useState } from 'react';
import type { MediaIndexItem, PhotoSlotDef, DriveFile, PhotoTransform } from '@/utils/photoSlots';
import { DrivePicker } from './DrivePicker';
import { PhotoGallery } from './PhotoGallery';

interface PhotoSlotProps {
  slot: PhotoSlotDef;
  systemName: string;
  items: MediaIndexItem[];
  onChange: () => void;  // parent refetches after any mutation
  heightClass?: string;
  printMode?: boolean;
  hideLabel?: boolean;
}

export function PhotoSlot({ slot, systemName, items, onChange, heightClass, printMode, hideLabel }: PhotoSlotProps) {
  const [picking, setPicking] = useState(false);

  async function handlePick(files: DriveFile[], meta?: { tags?: string[] }) {
    // For single slots, first remove any existing photos
    if (slot.kind === 'single') {
      for (const existing of items) {
        await fetch('/.netlify/functions/compost-media-index', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'remove',
            system: systemName,
            slot: slot.id,
            fileId: existing.fileId,
          }),
        });
      }
    }

    // Merge the slot's default tag with any user-picked tags — dedup + lowercase
    const tagSet = new Set<string>([slot.id, ...(meta?.tags || [])].map(t => t.trim().toLowerCase()).filter(Boolean));
    const tagsCsv = [...tagSet].join(',');

    const toAdd = slot.kind === 'single' ? files.slice(0, 1) : files;
    for (const f of toAdd) {
      const eventDate = f.createdTime ? f.createdTime.slice(0, 10) : '';
      await fetch('/.netlify/functions/compost-media-index', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'add',
          system: systemName,
          slot: slot.id,
          fileId: f.id,
          thumbnailUrl: f.thumbnailLink || '',
          webViewLink: f.webViewLink || '',
          mimeType: f.mimeType || '',
          caption: '',
          date: eventDate,
          eventDate,
          tags: tagsCsv,
        }),
      });
    }
    onChange();
  }

  async function handleCaption(item: MediaIndexItem, caption: string) {
    await fetch('/.netlify/functions/compost-media-index', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'updateCaption',
        system: systemName,
        slot: slot.id,
        fileId: item.fileId,
        caption,
      }),
    });
    onChange();
  }

  async function handleTransform(item: MediaIndexItem, t: PhotoTransform) {
    await fetch('/.netlify/functions/compost-media-index', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'updateTransform',
        system: systemName,
        slot: slot.id,
        fileId: item.fileId,
        transform: JSON.stringify(t),
      }),
    });
    onChange();
  }

  async function handleEventDate(item: MediaIndexItem, eventDate: string) {
    await fetch('/.netlify/functions/compost-media-index', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'updateEventDate',
        system: systemName,
        slot: slot.id,
        fileId: item.fileId,
        eventDate,
      }),
    });
    onChange();
  }

  async function handleTags(item: MediaIndexItem, tags: string) {
    await fetch('/.netlify/functions/compost-media-index', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'updateTags',
        system: systemName,
        slot: slot.id,
        fileId: item.fileId,
        tags,
      }),
    });
    onChange();
  }

  async function handleRemove(item: MediaIndexItem) {
    if (!confirm('Remove this photo from the report?')) return;
    await fetch('/.netlify/functions/compost-media-index', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'remove',
        system: systemName,
        slot: slot.id,
        fileId: item.fileId,
      }),
    });
    onChange();
  }

  const singleSlot = slot.kind === 'single';

  return (
    <div className={`space-y-3 break-inside-avoid flex flex-col ${printMode ? '' : 'bg-white rounded-xl p-4 md:p-5 shadow-sm border border-gray-100 h-full'}`}>
      {!hideLabel && (
        <div>
          <h3 className="font-semibold text-gray-900">{slot.label}</h3>
          {!printMode && <p className="text-xs text-gray-500">{slot.description}</p>}
        </div>
      )}

      <div className="flex-1 min-h-0 flex flex-col">
      <PhotoGallery
        items={items}
        heightClass={heightClass || (singleSlot ? 'h-72 md:h-[28rem]' : 'h-56 md:h-80')}
        singleSlot={singleSlot}
        printMode={printMode}
        onAdd={() => setPicking(true)}
        onReplace={singleSlot ? () => setPicking(true) : undefined}
        onRemove={printMode ? undefined : handleRemove}
        onCaptionChange={printMode ? undefined : handleCaption}
        onTransformChange={printMode ? undefined : handleTransform}
        onEventDateChange={printMode ? undefined : handleEventDate}
        onTagsChange={printMode ? undefined : handleTags}
      />
      </div>

      {picking && (
        <DrivePicker
          systemName={systemName}
          slotLabel={slot.label}
          allowMultiple={!singleSlot}
          defaultTag={slot.id}
          onClose={() => setPicking(false)}
          onPick={handlePick}
        />
      )}
    </div>
  );
}
