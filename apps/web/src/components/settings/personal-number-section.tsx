import { t } from '@telocc/i18n';
import { type FormEvent, useState } from 'react';
import { Alert } from '@/components/ui/alert.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Card, CardTitle } from '@/components/ui/card.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Label } from '@/components/ui/label.tsx';
import { ApiError, confirmVerification, issueVerification } from '@/lib/api.ts';

const E164_PATTERN = /^\+[1-9][0-9]{1,14}$/;

/**
 * Personal-number (re-)verification (design.md §11 settings: "personal number +
 * re-verify flow with emergency disclosure"). There is no API route that returns the
 * currently-verified number/timestamp (see `lib/api.ts`'s header comment), so this
 * section can't show current status — it always offers the issue→confirm flow, which
 * is safe to run again even for an already-verified number.
 */
export function PersonalNumberSection() {
  const [phone, setPhone] = useState('');
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleSend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(false);
    if (!E164_PATTERN.test(phone)) {
      setError(t('verification.phoneInvalid'));
      return;
    }
    setBusy(true);
    try {
      const result = await issueVerification(phone);
      setChallengeId(result.id);
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'rate_limited'
          ? t('common.rateLimited')
          : t('common.somethingWentWrong'),
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!challengeId) return;
    setError(null);
    setBusy(true);
    try {
      await confirmVerification(challengeId, pin);
      setSuccess(true);
      setChallengeId(null);
      setPin('');
      setPhone('');
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'attempts_exceeded'
          ? t('verification.attemptsExceeded')
          : t('verification.pinInvalid'),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardTitle>{t('settings.personalNumberTitle')}</CardTitle>
      <p className="mt-2 text-sm text-neutral-600">{t('settings.personalNumberBody')}</p>
      <Alert variant="warning" className="mt-3">
        {t('verification.emergencyDisclosure')}
      </Alert>

      {success && (
        <Alert variant="success" className="mt-3">
          {t('verification.verifiedSuccess')}
        </Alert>
      )}

      {!challengeId ? (
        <form className="mt-4 flex items-end gap-3" onSubmit={handleSend} noValidate>
          <div className="flex flex-1 flex-col gap-1">
            <Label htmlFor="settings-phone">{t('verification.phoneLabel')}</Label>
            <Input
              id="settings-phone"
              required
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={busy}>
            {busy ? t('common.loading') : t('verification.sendPin')}
          </Button>
        </form>
      ) : (
        <form className="mt-4 flex items-end gap-3" onSubmit={handleConfirm} noValidate>
          <div className="flex flex-col gap-1">
            <Label htmlFor="settings-pin">{t('verification.pinLabel')}</Label>
            <Input
              id="settings-pin"
              required
              inputMode="numeric"
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={busy || pin.length !== 6}>
            {busy ? t('common.loading') : t('verification.confirm')}
          </Button>
          <Button type="button" variant="outline" onClick={() => setChallengeId(null)}>
            {t('common.cancel')}
          </Button>
        </form>
      )}
      {error && (
        <Alert variant="danger" className="mt-3">
          {error}
        </Alert>
      )}
    </Card>
  );
}
