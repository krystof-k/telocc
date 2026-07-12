import { t } from '@telocc/i18n';
import { Alert } from '@/components/ui/alert.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import { Card, CardTitle } from '@/components/ui/card.tsx';
import type { BusinessNumberDto } from '@/lib/api.ts';

function statusVariant(status: string): 'success' | 'warning' | 'danger' | 'neutral' {
  if (status === 'active') return 'success';
  if (status === 'rejected' || status === 'released') return 'danger';
  if (status === 'requested' || status === 'docs_pending' || status === 'bundle_submitted') {
    return 'warning';
  }
  return 'neutral';
}

export function BusinessNumberSection({
  businessNumber,
}: {
  businessNumber: BusinessNumberDto | null;
}) {
  return (
    <Card>
      <CardTitle>{t('settings.businessNumberTitle')}</CardTitle>
      {businessNumber ? (
        <dl className="mt-3 flex flex-col gap-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-neutral-500">{t('settings.businessNumberTitle')}</dt>
            <dd className="font-mono">{businessNumber.e164}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-neutral-500">{t('settings.businessNumberStatus')}</dt>
            <dd>
              <Badge variant={statusVariant(businessNumber.status)}>{businessNumber.status}</Badge>
            </dd>
          </div>
          {businessNumber.activatedAt && (
            <div className="flex justify-between">
              <dt className="text-neutral-500">{t('settings.businessNumberActivatedAt')}</dt>
              <dd>{new Date(businessNumber.activatedAt).toLocaleString()}</dd>
            </div>
          )}
          {businessNumber.deliverabilityWarning && (
            <Alert variant="warning">{t('dashboard.deliverabilityWarning')}</Alert>
          )}
          {businessNumber.status === 'rejected' && businessNumber.providerRejectionReason && (
            <Alert variant="danger">
              <p className="font-medium">{t('settings.businessNumberRejected')}</p>
              <p className="mt-1">
                {t('settings.businessNumberRejectionReasonLabel')}:{' '}
                {businessNumber.providerRejectionReason}
              </p>
              <p className="mt-1">{t('settings.businessNumberRejectionRemediation')}</p>
            </Alert>
          )}
        </dl>
      ) : (
        <p className="mt-3 text-neutral-500">{t('settings.businessNumberNone')}</p>
      )}
    </Card>
  );
}
