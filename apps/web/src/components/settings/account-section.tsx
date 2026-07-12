import { useQueryClient } from '@tanstack/react-query';
import { t } from '@telocc/i18n';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Card, CardTitle } from '@/components/ui/card.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Label } from '@/components/ui/label.tsx';
import { type OrgDto, updateOrg } from '@/lib/api.ts';
import { queryKeys } from '@/lib/queries.ts';

export interface AccountSectionProps {
  org: OrgDto;
  email: string | null;
  personalNumberE164: string | null;
  personalNumberVerifiedAt: string | null;
  emergencyAckAt: string | null;
}

export function AccountSection({
  org,
  email,
  personalNumberE164,
  personalNumberVerifiedAt,
  emergencyAckAt,
}: AccountSectionProps) {
  const [name, setName] = useState(org.name);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const queryClient = useQueryClient();

  async function handleSave() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await updateOrg({ name: name.trim() });
      await queryClient.invalidateQueries({ queryKey: queryKeys.me });
      setSaved(true);
    } catch {
      setError(t('common.somethingWentWrong'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardTitle>{t('settings.accountTitle')}</CardTitle>
      <div className="mt-3 flex flex-col gap-1">
        <Label>{t('settings.accountEmailLabel')}</Label>
        <p className="text-sm text-neutral-700">{email ?? '—'}</p>
      </div>
      <div className="mt-3 flex flex-col gap-1">
        <Label>{t('settings.accountPersonalNumberLabel')}</Label>
        {personalNumberE164 ? (
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm text-neutral-700">{personalNumberE164}</span>
            {personalNumberVerifiedAt && (
              <Badge variant="success">{t('settings.accountPersonalNumberVerified')}</Badge>
            )}
          </div>
        ) : (
          <p className="text-sm text-neutral-500">{t('settings.accountPersonalNumberNone')}</p>
        )}
        {emergencyAckAt && (
          <p className="text-xs text-neutral-500">{t('settings.accountEmergencyAckLabel')}</p>
        )}
      </div>
      <div className="mt-4 flex flex-col gap-2">
        <Label htmlFor="account-org-name">{t('settings.accountOrgName')}</Label>
        <div className="flex gap-2">
          <Input
            id="account-org-name"
            value={name}
            maxLength={120}
            onChange={(e) => {
              setName(e.target.value);
              setSaved(false);
            }}
          />
          <Button type="button" onClick={handleSave} disabled={busy || !name.trim()}>
            {t('common.save')}
          </Button>
        </div>
        {saved && <Alert variant="success">{t('settings.accountSaved')}</Alert>}
        {error && <Alert variant="danger">{error}</Alert>}
      </div>
    </Card>
  );
}
