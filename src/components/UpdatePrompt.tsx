import { useEffect } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { RefreshCw, X } from 'lucide-react';

// How often to silently check for a new service worker while the app is open.
// Once a day is enough: the browser already auto-checks on every app boot when
// the service worker registers, so this interval only matters for unusually
// long-running sessions. Settings also has a manual "Check for Updates" button
// for when you want an immediate check.
const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      // Periodically ask the browser to check for a new SW. If one is found it
      // will download in the background and flip `needRefresh` to true.
      setInterval(() => {
        if (registration.installing || !navigator.onLine) return;
        registration.update().catch(() => {
          // offline or transient failure — ignore, will retry next interval
        });
      }, UPDATE_CHECK_INTERVAL_MS);
    },
  });

  // Expose a global hook so the Settings "Check for updates" button can trigger
  // an immediate apply without importing the virtual module in multiple places.
  useEffect(() => {
    (window as unknown as { __applyUpdate?: () => void }).__applyUpdate = () => {
      updateServiceWorker(true);
    };
    return () => {
      delete (window as unknown as { __applyUpdate?: () => void }).__applyUpdate;
    };
  }, [updateServiceWorker]);

  if (!needRefresh) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 z-50 pointer-events-none flex justify-center">
      <div className="pointer-events-auto bg-green-primary text-white rounded-xl shadow-lg border border-green-dark max-w-md w-full p-4 flex items-center gap-3">
        <RefreshCw size={20} className="flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm">New version available</div>
          <div className="text-xs opacity-90">Tap update to get the latest features and fixes</div>
        </div>
        <button
          onClick={() => updateServiceWorker(true)}
          className="flex-shrink-0 bg-white text-green-primary font-semibold text-sm px-3 py-1.5 rounded-lg hover:bg-green-50 active:scale-95 transition-all"
        >
          Update
        </button>
        <button
          onClick={() => setNeedRefresh(false)}
          aria-label="Dismiss"
          className="flex-shrink-0 opacity-70 hover:opacity-100 transition-opacity"
        >
          <X size={18} />
        </button>
      </div>
    </div>
  );
}
