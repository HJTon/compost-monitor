import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { CompostProvider, useCompost } from '@/contexts/CompostContext';
import { ToastContainer } from '@/components/Toast';
import { UpdatePrompt } from '@/components/UpdatePrompt';
import { PasswordGate } from '@/components/PasswordGate';
import { LandingPage } from '@/pages/LandingPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { DailyEntryPage } from '@/pages/DailyEntryPage';
import { SystemDetailPage } from '@/pages/SystemDetailPage';
import { HistoryPage } from '@/pages/HistoryPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { BuildPage } from '@/pages/BuildPage';
import { ManagePage } from '@/pages/ManagePage';
import { BuildDetailPage } from '@/pages/BuildDetailPage';
import { AnalysePage } from '@/pages/AnalysePage';
import { SystemAnalysePage } from '@/pages/SystemAnalysePage';
import { ComparePage } from '@/pages/ComparePage';
import { PublicViewPage } from '@/pages/PublicViewPage';
import { SampleEntryPage } from '@/pages/SampleEntryPage';
import { PrintReportPage } from '@/pages/PrintReportPage';

function AppRoutes() {
  const { toasts, dismissToast } = useCompost();

  return (
    <>
      <Routes>
        {/* Public read-only routes — no password needed */}
        <Route path="/view" element={<PublicViewPage />} />
        <Route path="/view/:systemId" element={<SystemAnalysePage />} />
        <Route path="/view/compare" element={<ComparePage />} />

        {/* Protected routes — password required */}
        <Route path="/*" element={
          <PasswordGate>
            <Routes>
              <Route path="/" element={<LandingPage />} />
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/entry/:systemId" element={<DailyEntryPage />} />
              <Route path="/sample/:systemId" element={<SampleEntryPage />} />
              <Route path="/system/:systemId" element={<SystemDetailPage />} />
              <Route path="/history" element={<HistoryPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/build" element={<BuildPage />} />
              <Route path="/manage" element={<ManagePage />} />
              <Route path="/manage/:systemId" element={<BuildDetailPage />} />
              <Route path="/analyse" element={<AnalysePage />} />
              <Route path="/analyse/:systemId" element={<SystemAnalysePage />} />
              <Route path="/analyse/:systemId/print" element={<PrintReportPage />} />
              <Route path="/compare" element={<ComparePage />} />
              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Routes>
          </PasswordGate>
        } />
      </Routes>
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
      <UpdatePrompt />
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
