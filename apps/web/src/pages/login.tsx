import { t } from '@telocc/i18n';
import type { FormEvent } from 'react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Label } from '@/components/ui/label.tsx';
import { requestMagicLink } from '@/lib/api.ts';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function LegalFooter() {
  return (
    <nav aria-label={t('nav.legalNavigation')} className="mt-4 flex gap-4 text-sm text-neutral-500">
      <Link to="/legal/privacy" className="underline">
        {t('legal.privacyTitle')}
      </Link>
      <Link to="/legal/terms" className="underline">
        {t('legal.termsTitle')}
      </Link>
    </nav>
  );
}

/** Magic-link sign-in (design.md §6, brief "login"): email → `POST
 * /api/auth/sign-in/magic-link` → enumeration-safe "check your email" screen. Clicking
 * the emailed link is a plain browser navigation to the API's verify endpoint (it sets
 * the session cookie directly, design.md §6/§9.4) — there is no dedicated SPA callback
 * route to build here. */
export function LoginPage() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'sent' | 'error'>('idle');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!EMAIL_PATTERN.test(email)) {
      setStatus('error');
      return;
    }
    setStatus('submitting');
    try {
      await requestMagicLink(email);
      setStatus('sent');
    } catch {
      // Enumeration-safe: the API responds success-shaped even for unknown addresses
      // (design.md §6), so an error here means a real request failure (network, rate
      // limit) — still shown as the same "check your email" copy would be misleading,
      // so surface it plainly instead.
      setStatus('error');
    }
  }

  if (status === 'sent') {
    return (
      <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6">
        <h1 className="text-2xl font-semibold">{t('auth.checkEmailTitle')}</h1>
        <p className="text-neutral-600">{t('auth.checkEmailBody')}</p>
        <Button variant="outline" onClick={() => setStatus('idle')}>
          {t('auth.sendAnother')}
        </Button>
        <LegalFooter />
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6">
      <h1 className="text-2xl font-semibold">{t('auth.signInTitle')}</h1>
      <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
        <div className="flex flex-col gap-1">
          <Label htmlFor="email">{t('auth.emailLabel')}</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={status === 'error'}
            aria-describedby={status === 'error' ? 'email-error' : undefined}
          />
          {status === 'error' && (
            <p id="email-error" role="alert" className="text-sm text-red-700">
              {t('auth.emailInvalid')}
            </p>
          )}
        </div>
        <Button type="submit" disabled={status === 'submitting'}>
          {status === 'submitting' ? t('common.loading') : t('auth.sendMagicLink')}
        </Button>
      </form>
      <LegalFooter />
    </main>
  );
}
