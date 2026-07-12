import { t } from '@telocc/i18n';

/** Placeholder dashboard shell — the real dashboard (number status, hours, recent
 * calls) lands in M7 once the API surface it depends on exists. */
export function DashboardPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-4 p-6">
      <h1 className="text-2xl font-semibold">{t('common.appName')}</h1>
      <p className="text-neutral-500">Scaffold shell — product pages land in M7.</p>
    </main>
  );
}
