import { t } from '@telocc/i18n';
import { type FormEvent, useState } from 'react';
import { Alert } from '@/components/ui/alert.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Label } from '@/components/ui/label.tsx';
import { ApiError, createOrg } from '@/lib/api.ts';

/**
 * Org creation (design.md §6 step 1). `POST /api/orgs` requires
 * `businessCapacityDeclared: true` literally; under `COMPLIANCE_POSTURE=nbics_provider`
 * it also requires `waiverAccepted: true` — the API alone knows the active posture
 * (there is no client-visible config route exposing it), so this submits without the
 * waiver first and only reveals the § 63a contract-summary/waiver copy if the API
 * comes back with `waiver_required`, then resubmits with it accepted.
 */
export function OrgStep({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('');
  const [declared, setDeclared] = useState(false);
  const [needsWaiver, setNeedsWaiver] = useState(false);
  const [waiverAccepted, setWaiverAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(withWaiver: boolean) {
    setSubmitting(true);
    setError(null);
    try {
      await createOrg({
        name: name.trim(),
        businessCapacityDeclared: true,
        ...(withWaiver ? { waiverAccepted: true } : {}),
      });
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'waiver_required') {
        setNeedsWaiver(true);
      } else {
        setError(t('common.somethingWentWrong'));
      }
    } finally {
      setSubmitting(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) {
      setError(t('onboarding.orgNameRequired'));
      return;
    }
    if (!declared) {
      setError(t('onboarding.declarationRequired'));
      return;
    }
    if (needsWaiver && !waiverAccepted) {
      setError(t('onboarding.waiverRequired'));
      return;
    }
    void submit(needsWaiver);
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
      <h2 className="text-xl font-semibold">{t('onboarding.createOrgTitle')}</h2>
      <div className="flex flex-col gap-1">
        <Label htmlFor="org-name">{t('onboarding.orgNameLabel')}</Label>
        <Input
          id="org-name"
          required
          maxLength={120}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <label className="flex items-start gap-2 text-sm text-neutral-700">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={declared}
          onChange={(e) => setDeclared(e.target.checked)}
        />
        {t('onboarding.businessCapacityDeclaration')}
      </label>
      {needsWaiver && (
        <div className="flex flex-col gap-2 rounded-md border border-amber-300 bg-amber-50 p-4">
          <h3 className="font-medium">{t('onboarding.waiverTitle')}</h3>
          <p className="text-sm text-neutral-700">{t('onboarding.waiverBody')}</p>
          <label className="flex items-start gap-2 text-sm text-neutral-700">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={waiverAccepted}
              onChange={(e) => setWaiverAccepted(e.target.checked)}
            />
            {t('onboarding.waiverAccept')}
          </label>
        </div>
      )}
      {error && <Alert variant="danger">{error}</Alert>}
      <Button type="submit" disabled={submitting}>
        {submitting ? t('common.loading') : t('common.continue')}
      </Button>
    </form>
  );
}
