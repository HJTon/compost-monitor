import { Wifi, WifiOff, RefreshCw, Check } from 'lucide-react';
import { useCompost } from '@/contexts/CompostContext';

export function SyncStatusBar() {
  const { pendingCount, isOnline, isSyncing, syncNow } = useCompost();

  if (isSyncing) {
    return (
      <div className="bg-blue-50 border-b border-blue-200 px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-2 text-blue-700 text-sm">
          <RefreshCw size={16} className="animate-spin" />
          <span>Syncing...</span>
        </div>
      </div>
    );
  }

  if (!isOnline) {
    return (
      <div className="bg-red-50 border-b border-red-200 px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-2 text-red-700 text-sm">
          <WifiOff size={16} />
          <span>Offline{pendingCount > 0 ? ` - ${pendingCount} pending` : ''}</span>
        </div>
      </div>
    );
  }

  if (pendingCount > 0) {
    return (
      <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-2 text-amber-700 text-sm">
          <RefreshCw size={16} />
          <span>{pendingCount} pending</span>
        </div>
        <button
          onClick={syncNow}
          className="text-amber-700 text-sm font-medium underline"
        >
          Sync now
        </button>
      </div>
    );
  }

  return (
    <div className="bg-green-50 border-b border-green-200 px-4 py-2 flex items-center gap-2 text-green-700 text-sm">
      <Check size={16} />
      <Wifi size={16} />
      <span>All synced</span>
    </div>
  );
}
