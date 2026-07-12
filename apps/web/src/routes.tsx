import { Route, Routes } from 'react-router';
import { DashboardPage } from '@/pages/dashboard';
import { LoginPage } from '@/pages/login';

/**
 * react-router v7, library mode (decisions.md #17). Pages beyond the login/dashboard
 * shell (onboarding, calls, settings, legal) land in M7 alongside the rest of the
 * product UI; this is the M0 router shell.
 */
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<DashboardPage />} />
    </Routes>
  );
}
