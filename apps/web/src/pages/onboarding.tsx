import { useQueryClient } from '@tanstack/react-query';
import { t } from '@telocc/i18n';
import { useEffect, useState } from 'react';
import { DoneStep } from '@/components/onboarding/done-step.tsx';
import { KycStep } from '@/components/onboarding/kyc-step.tsx';
import { NumberStep } from '@/components/onboarding/number-step.tsx';
import { OrgStep } from '@/components/onboarding/org-step.tsx';
import { VerifyStep } from '@/components/onboarding/verify-step.tsx';
import { FullPageSpinner } from '@/components/route-guards.tsx';
import { getBusinessNumber, getKyc } from '@/lib/api.ts';
import { queryKeys, useMe } from '@/lib/queries.ts';

type Step = 'org' | 'verify' | 'kyc' | 'number' | 'done';

const STEPS: {
  id: Step;
  labelKey:
    | 'onboarding.stepOrg'
    | 'onboarding.stepVerify'
    | 'onboarding.stepKyc'
    | 'onboarding.stepNumber';
}[] = [
  { id: 'org', labelKey: 'onboarding.stepOrg' },
  { id: 'verify', labelKey: 'onboarding.stepVerify' },
  { id: 'kyc', labelKey: 'onboarding.stepKyc' },
  { id: 'number', labelKey: 'onboarding.stepNumber' },
];

/**
 * The onboarding wizard (design.md §6, §11; brief "onboarding"): create org → verify
 * personal number → KYC → pick a business number. `/onboarding` only requires a
 * session (`RequireSessionOnly`, routes.tsx) — the dashboard itself is reachable once
 * an org exists (design.md §6 "dashboard is reachable after step 1"), so this page's
 * own job is just to resume wherever an already-partially-onboarded org left off.
 *
 * Known gap: there is no API route exposing personal-number verification status
 * (`memberships.personalNumberVerifiedAt` is never returned to the client — see the
 * header comment in `lib/api.ts`), so a returning user always lands back on the
 * "verify" step rather than skipping it. Re-verifying is idempotent and harmless.
 */
export function OnboardingPage() {
  const me = useMe();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step | null>(null);

  useEffect(() => {
    if (step !== null || me.isPending) return;
    void (async () => {
      if (!me.data?.org) {
        setStep('org');
        return;
      }
      const businessNumber = await getBusinessNumber();
      if (businessNumber) {
        setStep('done');
        return;
      }
      const kyc = await getKyc();
      setStep(kyc ? 'number' : 'verify');
    })();
  }, [me.data, me.isPending, step]);

  if (step === null) return <FullPageSpinner />;

  const currentIndex = STEPS.findIndex((s) => s.id === step);

  function goTo(next: Step) {
    // Every step transition follows a successful API write (org create, PIN confirm,
    // KYC save, number provision) — refresh cached session/org data so the app shell
    // and dashboard see the update immediately if the user navigates away mid-wizard.
    queryClient.invalidateQueries({ queryKey: queryKeys.me });
    queryClient.invalidateQueries({ queryKey: queryKeys.kyc });
    queryClient.invalidateQueries({ queryKey: queryKeys.businessNumber });
    setStep(next);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-6 p-6">
      <h1 className="sr-only">{t('common.appName')}</h1>
      {step !== 'done' && currentIndex >= 0 && (
        <ol
          className="flex items-center gap-2 text-xs text-neutral-500"
          aria-label={t('onboarding.stepLabel')}
        >
          {STEPS.map((s, i) => (
            <li
              key={s.id}
              aria-current={i === currentIndex ? 'step' : undefined}
              className={i === currentIndex ? 'font-semibold text-neutral-900' : undefined}
            >
              {i + 1}. {t(s.labelKey)}
              {i < STEPS.length - 1 ? ' →' : ''}
            </li>
          ))}
        </ol>
      )}

      {step === 'org' && <OrgStep onDone={() => goTo('verify')} />}
      {step === 'verify' && <VerifyStep onDone={() => goTo('kyc')} />}
      {step === 'kyc' && <KycStep onDone={() => goTo('number')} />}
      {step === 'number' && <NumberStep onDone={() => goTo('done')} />}
      {step === 'done' && <DoneStep />}
    </main>
  );
}
