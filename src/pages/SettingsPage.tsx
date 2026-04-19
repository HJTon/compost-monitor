import { useState, useEffect } from 'react';
import { RefreshCw, MapPin, Download, CheckCircle, Share, Package } from 'lucide-react';
import { Header } from '@/components/Header';
import { Button } from '@/components/Button';
import { useCompost } from '@/contexts/CompostContext';

const APP_VERSION = __APP_VERSION__;
const BUILD_TIME = __BUILD_TIME__;

function formatBuildTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function SettingsPage() {
  const { settings, updateSettings, syncNow, discardPending, isSyncing, pendingCount, addToast } = useCompost();
  const [lat, setLat] = useState(settings.farmLatitude.toString());
  const [lon, setLon] = useState(settings.farmLongitude.toString());
  const [installPrompt, setInstallPrompt] = useState<any>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [updateChecking, setUpdateChecking] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<string | null>(null);
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);

  useEffect(() => {
    const standalone = window.matchMedia('(display-mode: standalone)').matches
      || (navigator as any).standalone === true;
    setIsInstalled(standalone);

    const handler = (e: Event) => { e.preventDefault(); setInstallPrompt(e); };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === 'accepted') { setInstallPrompt(null); setIsInstalled(true); }
  };

  const handleEntryModeToggle = () => {
    const newMode = settings.entryMode === 'stepper' ? 'grid' : 'stepper';
    updateSettings({ entryMode: newMode });
    addToast('success', `Switched to ${newMode} mode`);
  };

  const handleCheckForUpdates = async () => {
    setUpdateChecking(true);
    setUpdateStatus(null);
    try {
      if (!('serviceWorker' in navigator)) {
        setUpdateStatus('Service workers not supported on this browser');
        return;
      }
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) {
        setUpdateStatus('No service worker registered yet — try reloading the app');
        return;
      }
      await reg.update();
      // Give the browser a moment to detect a waiting worker, then check state
      await new Promise(r => setTimeout(r, 800));
      if (reg.waiting || reg.installing) {
        // A new version is available — apply it immediately via the global
        // hook set by UpdatePrompt. This triggers skipWaiting + reload.
        const apply = (window as unknown as { __applyUpdate?: () => void }).__applyUpdate;
        if (apply) {
          setUpdateStatus('New version found — applying…');
          apply();
        } else {
          setUpdateStatus('New version found — please reload the app');
        }
      } else {
        setUpdateStatus('You are on the latest version');
      }
    } catch (err) {
      setUpdateStatus(`Check failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setUpdateChecking(false);
    }
  };

  const handleSaveCoords = () => {
    const latNum = parseFloat(lat);
    const lonNum = parseFloat(lon);
    if (!isNaN(latNum) && !isNaN(lonNum)) {
      updateSettings({ farmLatitude: latNum, farmLongitude: lonNum });
      addToast('success', 'Farm location updated');
    }
  };

  return (
    <div className="min-h-screen bg-green-50/50">
      <Header title="Settings" showBack />

      <div className="p-4 space-y-4">
        {/* App version */}
        <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
          <div className="flex items-center gap-2 mb-3">
            <Package size={18} className="text-green-primary" />
            <h3 className="font-semibold text-gray-900">App Version</h3>
          </div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm text-gray-600">Version</span>
            <span className="font-mono text-sm font-medium text-gray-900">v{APP_VERSION}</span>
          </div>
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-gray-600">Built</span>
            <span className="text-xs text-gray-500">{formatBuildTime(BUILD_TIME)}</span>
          </div>
          <Button
            fullWidth
            variant="outline"
            size="sm"
            onClick={handleCheckForUpdates}
            disabled={updateChecking}
          >
            <div className="flex items-center justify-center gap-2">
              <RefreshCw size={16} className={updateChecking ? 'animate-spin' : ''} />
              {updateChecking ? 'Checking…' : 'Check for Updates'}
            </div>
          </Button>
          {updateStatus && (
            <p className="mt-2 text-xs text-gray-600 text-center">{updateStatus}</p>
          )}
        </div>

        {/* Install */}
        <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
          <h3 className="font-semibold text-gray-900 mb-3">Add to Home Screen</h3>
          {isInstalled ? (
            <div className="flex items-center gap-2 text-green-600 text-sm">
              <CheckCircle size={16} />
              <span>Already installed on this device</span>
            </div>
          ) : isIOS ? (
            <div className="space-y-2">
              <p className="text-sm text-gray-600">To install on iPhone or iPad:</p>
              <div className="flex items-start gap-3 bg-gray-50 rounded-lg p-3">
                <Share size={18} className="text-blue-500 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-gray-700">
                  Tap the <strong>Share</strong> button in Safari, then tap <strong>"Add to Home Screen"</strong>
                </p>
              </div>
            </div>
          ) : installPrompt ? (
            <Button fullWidth onClick={handleInstall}>
              <div className="flex items-center justify-center gap-2">
                <Download size={18} />
                Add to Home Screen
              </div>
            </Button>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-gray-600">To install on Android or desktop:</p>
              <div className="flex items-start gap-3 bg-gray-50 rounded-lg p-3">
                <Download size={18} className="text-green-600 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-gray-700">
                  Tap the <strong>menu (⋮)</strong> in your browser and select <strong>"Add to Home Screen"</strong> or <strong>"Install app"</strong>
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Sync */}
        <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
          <h3 className="font-semibold text-gray-900 mb-3">Sync</h3>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-600">Pending items</span>
            <span className="font-medium">{pendingCount}</span>
          </div>
          {settings.lastSyncTime && (
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-gray-600">Last sync</span>
              <span className="text-sm text-gray-500">{new Date(settings.lastSyncTime).toLocaleString()}</span>
            </div>
          )}
          <div className="flex gap-2">
            <Button
              fullWidth
              variant="outline"
              onClick={syncNow}
              disabled={isSyncing || pendingCount === 0}
            >
              <div className="flex items-center justify-center gap-2">
                <RefreshCw size={18} className={isSyncing ? 'animate-spin' : ''} />
                {isSyncing ? 'Syncing...' : 'Sync Now'}
              </div>
            </Button>
            {pendingCount > 0 && (
              <Button
                variant="outline"
                onClick={() => {
                  if (window.confirm(`Discard ${pendingCount} unsynced item${pendingCount === 1 ? '' : 's'}? They will stay saved locally but won't be sent to the spreadsheet.`)) {
                    discardPending();
                  }
                }}
                disabled={isSyncing}
              >
                Discard
              </Button>
            )}
          </div>
        </div>

        {/* Entry mode */}
        <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
          <h3 className="font-semibold text-gray-900 mb-3">Temperature Entry Mode</h3>
          <div className="flex gap-2">
            <button
              onClick={() => settings.entryMode !== 'stepper' && handleEntryModeToggle()}
              className={`flex-1 py-3 rounded-lg text-sm font-medium transition-all ${
                settings.entryMode === 'stepper'
                  ? 'bg-green-primary text-white'
                  : 'bg-gray-100 text-gray-700'
              }`}
            >
              Stepper
            </button>
            <button
              onClick={() => settings.entryMode !== 'grid' && handleEntryModeToggle()}
              className={`flex-1 py-3 rounded-lg text-sm font-medium transition-all ${
                settings.entryMode === 'grid'
                  ? 'bg-green-primary text-white'
                  : 'bg-gray-100 text-gray-700'
              }`}
            >
              Grid
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-2">
            {settings.entryMode === 'stepper'
              ? 'One probe at a time with large input (best for one-handed use)'
              : 'All 9 probes visible in a 3x3 grid'}
          </p>
        </div>

        {/* Farm location */}
        <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
          <div className="flex items-center gap-2 mb-3">
            <MapPin size={18} className="text-green-primary" />
            <h3 className="font-semibold text-gray-900">Farm Location (for weather)</h3>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm text-gray-500">Latitude</label>
              <input
                type="number"
                step="0.01"
                value={lat}
                onChange={e => setLat(e.target.value)}
                className="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg outline-none focus:border-green-primary [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
            </div>
            <div>
              <label className="text-sm text-gray-500">Longitude</label>
              <input
                type="number"
                step="0.01"
                value={lon}
                onChange={e => setLon(e.target.value)}
                className="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg outline-none focus:border-green-primary [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
            </div>
          </div>
          <Button
            fullWidth
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={handleSaveCoords}
          >
            Save Location
          </Button>
          <p className="text-xs text-gray-400 mt-2">Default: Taranaki (-39.06, 174.08)</p>
        </div>
      </div>
    </div>
  );
}
