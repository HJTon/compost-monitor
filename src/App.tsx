import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { CompostProvider, useCompost } from '@/contexts/CompostContext';
import { ToastContainer } from '@/components/Toast';
import { LandingPage } from '@/pages/LandingPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { DailyEntryPage } from '@/pages/DailyEntryPage';
import { SystemDetailPage } from '@/pages/SystemDetailPage';
import { HistoryPage } from '@/pages/HistoryPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { UnderDevelopmentPage } from '@/pages/UnderDevelopmentPage';
import { AnalysePage } from '@/pages/AnalysePage';
import { SystemAnalysePage } from '@/pages/SystemAnalysePage';

function AppRoutes() {
  const { toasts, dismissToast } = useCompost();

  return (
    <>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/entry/:systemId" element={<DailyEntryPage />} />
        <Route path="/system/:systemId" element={<SystemDetailPage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/build" element={<UnderDevelopmentPage />} />
        <Route path="/analyse" element={<AnalysePage />} />
        <Route path="/analyse/:systemId" element={<SystemAnalysePage />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
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
