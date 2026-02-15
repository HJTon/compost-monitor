import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { CompostProvider, useCompost } from '@/contexts/CompostContext';
import { ToastContainer } from '@/components/Toast';
import { DashboardPage } from '@/pages/DashboardPage';
import { DailyEntryPage } from '@/pages/DailyEntryPage';
import { SystemDetailPage } from '@/pages/SystemDetailPage';
import { HistoryPage } from '@/pages/HistoryPage';
import { SettingsPage } from '@/pages/SettingsPage';

function AppRoutes() {
  const { toasts, dismissToast } = useCompost();

  return (
    <>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/entry/:systemId" element={<DailyEntryPage />} />
        <Route path="/system/:systemId" element={<SystemDetailPage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </>
  );
}

function App() {
  return (
    <BrowserRouter>
      <CompostProvider>
        <AppRoutes />
      </CompostProvider>
    </BrowserRouter>
  );
}

export default App;
