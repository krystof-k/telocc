import { t } from '@telocc/i18n';
import { type FormEvent, useState } from 'react';
import { Alert } from '@/components/ui/alert.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Label } from '@/components/ui/label.tsx';
import { ApiError, confirmVerification, issueVerification } from '@/lib/api.ts';

const E164_PATTERN = /^\+[1-9][0-9]{1,14}$/;

/** SMS-PIN personal-number verification (design.md §6 step 2, §9.3). The emergency
 * disclosure is shown before sending the code; confirming a valid PIN stamps
 * `emergency_ack_at` server-side (core/verification.ts) — there is no separate
 * acknowledgement checkbox to submit. */
export function VerifyStep({ onDone }: { onDone: () => void }) {
  const [phone, setPhone] = useState('');
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!E164_PATTERN.test(phone)) {
      setError(t('verification.phoneInvalid'));
      return;
    }
    setBusy(true);
    try {
      const result = await issueVerification(phone);
      setChallengeId(result.id);
    } catch (err) {
      setError(err instanceof ApiError ? mapIssueError(err.code) : t('common.somethingWentWrong'));
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
      onDone();
    } catch (err) {
      setError(
        err instanceof ApiError ? mapConfirmError(err.code) : t('common.somethingWentWrong'),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-xl font-semibold">{t('verification.title')}</h2>
      <Alert variant="warning">{t('verification.emergencyDisclosure')}</Alert>
      <p className="text-sm text-neutral-600">{t('onboarding.verifyIntro')}</p>

      {!challengeId ? (
        <form className="flex flex-col gap-4" onSubmit={handleSend} noValidate>
          <div className="flex flex-col gap-1">
            <Label htmlFor="phone">{t('verification.phoneLabel')}</Label>
            <Input
              id="phone"
              required
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
            <p className="text-xs text-neutral-500">{t('onboarding.verifySendCode')}</p>
          </div>
          {error && <Alert variant="danger">{error}</Alert>}
          <Button type="submit" disabled={busy}>
            {busy ? t('common.loading') : t('verification.sendPin')}
          </Button>
        </form>
      ) : (
        <form className="flex flex-col gap-4" onSubmit={handleConfirm} noValidate>
          <div className="flex flex-col gap-1">
            <Label htmlFor="pin">{t('verification.pinLabel')}</Label>
            <Input
              id="pin"
              required
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value)}
            />
          </div>
          {error && <Alert variant="danger">{error}</Alert>}
          <div className="flex gap-2">
            <Button type="submit" disabled={busy || pin.length !== 6}>
              {busy ? t('common.loading') : t('verification.confirm')}
            </Button>
            <Button type="button" variant="outline" onClick={() => setChallengeId(null)}>
              {t('common.back')}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

function mapIssueError(code: string): string {
  if (code === 'invalid_phone') return t('verification.phoneInvalid');
  if (code === 'rate_limited') return t('common.rateLimited');
  return t('common.somethingWentWrong');
}

function mapConfirmError(code: string): string {
  if (code === 'attempts_exceeded') return t('verification.attemptsExceeded');
  if (code === 'invalid_pin') return t('verification.pinInvalid');
  if (code === 'expired' || code === 'not_found') return t('verification.expiredOrInvalid');
  return t('common.somethingWentWrong');
}
