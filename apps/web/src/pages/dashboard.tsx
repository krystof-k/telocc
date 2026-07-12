import { useQueryClient } from '@tanstack/react-query';
import { t } from '@telocc/i18n';
import { useState } from 'react';
import { Link } from 'react-router';
import { Alert } from '@/components/ui/alert.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import { Card, CardTitle } from '@/components/ui/card.tsx';
import { putOfficeHours } from '@/lib/api.ts';
import {
  queryKeys,
  useBusinessNumber,
  useCalls,
  useKyc,
  useMe,
  useOfficeHours,
} from '@/lib/queries.ts';

const MODES = ['always_open', 'schedule', 'always_closed'] as const;
const MODE_LABEL_KEY = {
  always_open: 'settings.officeHoursModeAlwaysOpen',
  schedule: 'settings.officeHoursModeSchedule',
  always_closed: 'settings.officeHoursModeAlwaysClosed',
} as const;

function businessNumberStatusVariant(status: string): 'success' | 'warning' | 'danger' | 'neutral' {
  if (status === 'active') return 'success';
  if (status === 'rejected' || status === 'released') return 'danger';
  if (status === 'requested' || status === 'docs_pending' || status === 'bundle_submitted') {
    return 'warning';
  }
  return 'neutral';
}

/** Dashboard (design.md §11): business number + status/capability warning, an office-
 * hours mode quick toggle, and the five most recent calls. Shows a setup banner when
 * onboarding is incomplete rather than blocking access to the page (design.md §6
 * "dashboard is reachable after step 1"). */
export function DashboardPage() {
  const me = useMe();
  const kyc = useKyc();
  const businessNumber = useBusinessNumber();
  const officeHours = useOfficeHours();
  const calls = useCalls({});
  const queryClient = useQueryClient();
  const [modeError, setModeError] = useState<string | null>(null);
  const [modeSaving, setModeSaving] = useState(false);

  const setupIncomplete = businessNumber.data?.status !== 'active' || !kyc.data;

  async function handleModeChange(mode: (typeof MODES)[number]) {
    if (!officeHours.data) return;
    setModeSaving(true);
    setModeError(null);
    try {
      await putOfficeHours({ ...officeHours.data, mode });
      await queryClient.invalidateQueries({ queryKey: queryKeys.officeHours });
    } catch {
      setModeError(t('common.somethingWentWrong'));
    } finally {
      setModeSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t('dashboard.title')}</h1>

      {setupIncomplete && (
        <Alert variant="warning">
          <p className="mb-2 font-medium">{t('dashboard.setupIncompleteTitle')}</p>
          <p className="mb-2">{t('dashboard.setupIncompleteBody')}</p>
          <Link to="/onboarding" className="font-medium underline">
            {t('dashboard.resumeSetup')}
          </Link>
        </Alert>
      )}

      <Card>
        <CardTitle>{t('dashboard.businessNumberTitle')}</CardTitle>
        {businessNumber.data ? (
          <div className="mt-3 flex flex-col gap-2">
            <div className="flex items-center gap-3">
              <span className="font-mono text-lg">{businessNumber.data.e164}</span>
              <Badge variant={businessNumberStatusVariant(businessNumber.data.status)}>
                {businessNumber.data.status}
              </Badge>
            </div>
            {businessNumber.data.deliverabilityWarning && (
              <Alert variant="warning">{t('dashboard.deliverabilityWarning')}</Alert>
            )}
            {businessNumber.data.status === 'rejected' &&
              businessNumber.data.providerRejectionReason && (
                <Alert variant="danger">
                  <p className="font-medium">{t('dashboard.businessNumberRejected')}</p>
                  <p className="mt-1">
                    {t('dashboard.businessNumberRejectionReasonLabel')}:{' '}
                    {businessNumber.data.providerRejectionReason}
                  </p>
                  <p className="mt-1">{t('dashboard.businessNumberRejectionRemediation')}</p>
                </Alert>
              )}
          </div>
        ) : (
          <p className="mt-3 text-neutral-500">{t('dashboard.businessNumberNone')}</p>
        )}
      </Card>

      <Card>
        <CardTitle>{t('dashboard.officeHoursTitle')}</CardTitle>
        <fieldset className="mt-3 flex flex-wrap gap-2 border-0 p-0">
          <legend className="sr-only">{t('dashboard.officeHoursTitle')}</legend>
          {MODES.map((mode) => {
            const active = officeHours.data?.mode === mode;
            return (
              <label
                key={mode}
                className={
                  active
                    ? 'cursor-pointer rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-neutral-900 has-[:focus-visible]:ring-offset-2'
                    : 'cursor-pointer rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-100 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-neutral-900 has-[:focus-visible]:ring-offset-2'
                }
              >
                <input
                  type="radio"
                  name="office-hours-mode-quick"
                  value={mode}
                  checked={active}
                  disabled={modeSaving || !officeHours.data}
                  onChange={() => handleModeChange(mode)}
                  className="sr-only"
                />
                {t(MODE_LABEL_KEY[mode])}
              </label>
            );
          })}
        </fieldset>
        {modeError && (
          <Alert className="mt-2" variant="danger">
            {modeError}
          </Alert>
        )}
        <Link to="/settings" className="mt-3 inline-block text-sm font-medium underline">
          {t('dashboard.officeHoursManage')}
        </Link>
      </Card>

      <Card>
        <CardTitle>{t('dashboard.recentCallsTitle')}</CardTitle>
        <ul className="mt-3 flex flex-col divide-y divide-neutral-100">
          {(calls.data?.items ?? []).slice(0, 5).map((call) => (
            <li key={call.id} className="flex items-center justify-between py-2 text-sm">
              <span>{new Date(call.startedAt).toLocaleString()}</span>
              <span className="text-neutral-500">
                {call.direction === 'inbound'
                  ? t('calls.directionInbound')
                  : t('calls.directionOutbound')}
              </span>
              <span>{t(`calls.status.${call.status}`)}</span>
            </li>
          ))}
          {calls.data && calls.data.items.length === 0 && (
            <li className="py-2 text-sm text-neutral-500">{t('calls.empty')}</li>
          )}
        </ul>
        <Link to="/calls" className="mt-3 inline-block text-sm font-medium underline">
          {t('dashboard.viewAllCalls')}
        </Link>
      </Card>

      {me.data?.org && (
        <p className="text-xs text-neutral-600">
          {me.data.org.name} · {t('common.appName')}
        </p>
      )}
    </div>
  );
}
