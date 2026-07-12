import { t } from '@telocc/i18n';
import type { ReactNode } from 'react';
import { Navigate, Outlet } from 'react-router';
import { useMe } from '@/lib/queries.ts';

export function FullPageSpinner() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <p className="text-neutral-500" role="status">
        {t('common.loading')}
      </p>
    </div>
  );
}

/** Session gate for `/onboarding`: requires a session but deliberately does not
 * require (or redirect away from) an org — design.md §6 walks org creation itself as
 * onboarding's first step, and later steps stay reachable to finish setup even though
 * the dashboard is already unlocked (design.md §6 "dashboard is reachable after step 1"). */
export function RequireSessionOnly() {
  const me = useMe();

  if (me.isPending) return <FullPageSpinner />;
  if (me.isError) return <Navigate to="/login" replace />;
  return <Outlet />;
}

/** Session + org gate for the dashboard/calls/settings shell: no session → `/login`;
 * session but no org yet → `/onboarding` (design.md §6). */
export function RequireOrg() {
  const me = useMe();

  if (me.isPending) return <FullPageSpinner />;
  if (me.isError) return <Navigate to="/login" replace />;
  if (!me.data?.org) return <Navigate to="/onboarding" replace />;
  return <Outlet />;
}

/** `/login` itself: bounce an already-signed-in user straight to `/` (which itself
 * redirects to `/onboarding` if they have no org yet). */
export function RedirectIfSignedIn({ children }: { children: ReactNode }) {
  const me = useMe();

  if (me.isPending) return <FullPageSpinner />;
  if (me.data) return <Navigate to="/" replace />;
  return <>{children}</>;
}
