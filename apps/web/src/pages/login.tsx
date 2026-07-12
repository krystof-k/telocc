import { t } from '@telocc/i18n';
import { Button } from '@/components/ui/button';

/** Placeholder login page shell — the real magic-link form lands in M7. */
export function LoginPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6">
      <h1 className="text-2xl font-semibold">{t('auth.signInTitle')}</h1>
      <label className="flex flex-col gap-1 text-sm" htmlFor="email">
        {t('auth.emailLabel')}
        <input
          id="email"
          type="email"
          className="rounded-md border border-neutral-300 px-3 py-2"
          disabled
        />
      </label>
      <Button disabled>{t('auth.sendMagicLink')}</Button>
    </main>
  );
}
