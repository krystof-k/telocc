import { useQueryClient } from '@tanstack/react-query';
import { t } from '@telocc/i18n';
import { Link, NavLink, Outlet, useNavigate } from 'react-router';
import { signOut } from '@/lib/api.ts';
import { cn } from '@/lib/utils.ts';

const navLinkClasses = ({ isActive }: { isActive: boolean }) =>
  cn(
    'rounded-md px-3 py-2 text-sm font-medium transition-colors',
    isActive ? 'bg-neutral-900 text-white' : 'text-neutral-700 hover:bg-neutral-100',
  );

/** Authenticated app shell: skip link, top nav (dashboard/calls/settings/sign-out), and
 * the routed page in a `<main>` landmark (ER-ACC-1: semantic landmarks + visible focus). */
export function AppShell() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  async function handleSignOut() {
    await signOut();
    queryClient.clear();
    navigate('/login', { replace: true });
  }

  return (
    <div className="min-h-screen bg-neutral-50">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-white focus:px-4 focus:py-2 focus:shadow"
      >
        {t('nav.skipToContent')}
      </a>
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 p-4">
          <span className="text-lg font-semibold text-neutral-900">{t('common.appName')}</span>
          <nav aria-label={t('nav.primaryNavigation')} className="flex items-center gap-1">
            <NavLink to="/" end className={navLinkClasses}>
              {t('nav.dashboard')}
            </NavLink>
            <NavLink to="/calls" className={navLinkClasses}>
              {t('nav.calls')}
            </NavLink>
            <NavLink to="/settings" className={navLinkClasses}>
              {t('nav.settings')}
            </NavLink>
            <button
              type="button"
              onClick={handleSignOut}
              className="rounded-md px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-100"
            >
              {t('common.signOut')}
            </button>
          </nav>
        </div>
      </header>
      <main id="main-content" className="mx-auto max-w-4xl p-6">
        <Outlet />
      </main>
      <footer className="mx-auto max-w-4xl p-6">
        <nav aria-label={t('nav.legalNavigation')} className="flex gap-4 text-sm text-neutral-500">
          <Link to="/legal/privacy" className="underline">
            {t('legal.privacyTitle')}
          </Link>
          <Link to="/legal/terms" className="underline">
            {t('legal.termsTitle')}
          </Link>
        </nav>
      </footer>
    </div>
  );
}
