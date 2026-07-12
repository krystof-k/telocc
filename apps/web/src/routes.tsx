import { Route, Routes } from 'react-router';
import { AppShell } from '@/components/app-shell.tsx';
import { RedirectIfSignedIn, RequireOrg, RequireSessionOnly } from '@/components/route-guards.tsx';
import { SimulatorPage } from '@/dev/simulator-page.tsx';
import { CallsPage } from '@/pages/calls.tsx';
import { DashboardPage } from '@/pages/dashboard.tsx';
import { PrivacyPage } from '@/pages/legal/privacy.tsx';
import { TermsPage } from '@/pages/legal/terms.tsx';
import { LoginPage } from '@/pages/login.tsx';
import { OnboardingPage } from '@/pages/onboarding.tsx';
import { SettingsPage } from '@/pages/settings.tsx';

/** `VITE_ENABLE_SIM=1` compiles the dev simulator route in (M10, design.md §11 "Dev
 * simulator page" — double-gated: the server half, `ENABLE_DEV_ROUTES=1`, 404s every
 * `/dev/*` route it calls regardless of this flag). Set by `scripts/demo.mjs` and the
 * e2e webServer; never set in a production build. */
const SIM_ENABLED = import.meta.env.VITE_ENABLE_SIM === '1';

/**
 * react-router v7, library mode (decisions.md #17, design.md §11). Route guards
 * (`route-guards.tsx`) implement design.md §6's session/org gating: no session →
 * `/login`; session but no org → `/onboarding`. The simulator page (`/dev/simulator`,
 * M10) is intentionally outside those guards — it drives telephony events that have
 * nothing to do with who (if anyone) is signed in in this browser tab.
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

      {SIM_ENABLED && <Route path="/dev/simulator" element={<SimulatorPage />} />}

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
