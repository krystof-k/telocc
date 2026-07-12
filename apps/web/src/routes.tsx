import { Route, Routes } from 'react-router';
import { AppShell } from '@/components/app-shell.tsx';
import { RedirectIfSignedIn, RequireOrg, RequireSessionOnly } from '@/components/route-guards.tsx';
import { CallsPage } from '@/pages/calls.tsx';
import { DashboardPage } from '@/pages/dashboard.tsx';
import { PrivacyPage } from '@/pages/legal/privacy.tsx';
import { TermsPage } from '@/pages/legal/terms.tsx';
import { LoginPage } from '@/pages/login.tsx';
import { OnboardingPage } from '@/pages/onboarding.tsx';
import { SettingsPage } from '@/pages/settings.tsx';

/**
 * react-router v7, library mode (decisions.md #17, design.md §11). Route guards
 * (`route-guards.tsx`) implement design.md §6's session/org gating: no session →
 * `/login`; session but no org → `/onboarding`; the simulator page (`/dev/*`) is M10's
 * scope, not built here.
 */
export function AppRoutes() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <RedirectIfSignedIn>
            <LoginPage />
          </RedirectIfSignedIn>
        }
      />
      <Route path="/legal/privacy" element={<PrivacyPage />} />
      <Route path="/legal/terms" element={<TermsPage />} />

      <Route element={<RequireSessionOnly />}>
        <Route path="/onboarding" element={<OnboardingPage />} />
      </Route>

      <Route element={<RequireOrg />}>
        <Route element={<AppShell />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/calls" element={<CallsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
