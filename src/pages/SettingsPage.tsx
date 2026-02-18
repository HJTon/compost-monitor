import { useState, useEffect } from 'react';
import { RefreshCw, MapPin, Download, CheckCircle, Share } from 'lucide-react';
import { Header } from '@/components/Header';
import { Button } from '@/components/Button';
import { useCompost } from '@/contexts/CompostContext';
import { COMPOST_SYSTEMS } from '@/utils/config';

export function SettingsPage() {
  const { settings, updateSettings, syncNow, discardPending, isSyncing, pendingCount, addToast } = useCompost();
  const [lat, setLat] = useState(settings.farmLatitude.toString());
  const [lon, setLon] = useState(settings.farmLongitude.toString());
  const [installPrompt, setInstallPrompt] = useState<any>(null);
  const [isInstalled, setIsInstalled] = useState(false);
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

  const handleToggleSystem = (systemId: string) => {
    const current = settings.activeSystems;
    const updated = current.includes(systemId)
      ? current.filter(id => id !== systemId)
      : [...current, systemId];
    updateSettings({ activeSystems: updated });
  };

  const handleEntryModeToggle = () => {
    const newMode = settings.entryMode === 'stepper' ? 'grid' : 'stepper';
    updateSettings({ entryMode: newMode });
    addToast('success', `Switched to ${newMode} mode`);
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

        {/* Active systems */}
        <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
          <h3 className="font-semibold text-gray-900 mb-3">Active Systems</h3>
          <div className="space-y-2">
            {COMPOST_SYSTEMS.map(sys => (
              <label key={sys.id} className="flex items-center justify-between py-2">
                <span className="text-gray-700">{sys.name}</span>
                <input
                  type="checkbox"
                  checked={settings.activeSystems.includes(sys.id)}
                  onChange={() => handleToggleSystem(sys.id)}
                  className="w-5 h-5 rounded border-gray-300 text-green-primary focus:ring-green-primary"
                />
              </label>
            ))}
          </div>
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
