import { t } from '@telocc/i18n';
import { Link } from 'react-router';

/** Static legal placeholder (design.md §7 "Legal pages... rendering the drafted
 * markdown"). The drafted text lands in `docs/legal/privacy-notice.md` (M8); this
 * route links it rather than duplicating it, per the M7 brief ("keep copy minimal"). */
export function PrivacyPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-4 p-6">
      <Link to="/" className="text-sm underline">
        {t('common.appName')}
      </Link>
      <h1 className="text-2xl font-semibold">{t('legal.privacyTitle')}</h1>
      <p className="text-neutral-600">{t('legal.privacyPlaceholder')}</p>
    </main>
  );
}
