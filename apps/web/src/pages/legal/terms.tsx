import { t } from '@telocc/i18n';
import { Link } from 'react-router';

/** Static legal placeholder — see the header comment in `./privacy.tsx`. */
export function TermsPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-4 p-6">
      <Link to="/" className="text-sm underline">
        {t('common.appName')}
      </Link>
      <h1 className="text-2xl font-semibold">{t('legal.termsTitle')}</h1>
      <p className="text-neutral-600">{t('legal.termsPlaceholder')}</p>
    </main>
  );
}
