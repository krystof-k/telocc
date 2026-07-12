import { t } from '@telocc/i18n';
import { FullPageSpinner } from '@/components/route-guards.tsx';
import { AccountSection } from '@/components/settings/account-section.tsx';
import { BusinessNumberSection } from '@/components/settings/business-number-section.tsx';
import { DangerZoneSection } from '@/components/settings/danger-zone-section.tsx';
import { OfficeHoursSection } from '@/components/settings/office-hours-section.tsx';
import { PersonalNumberSection } from '@/components/settings/personal-number-section.tsx';
import { useBusinessNumber, useMe } from '@/lib/queries.ts';

/** Settings (design.md §11): account, personal number (re-)verification, office-hours
 * editor, business-number details, and the danger zone (export + delete). */
export function SettingsPage() {
  const me = useMe();
  const businessNumber = useBusinessNumber();

  if (me.isPending || !me.data?.org) return <FullPageSpinner />;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t('settings.title')}</h1>
      <AccountSection org={me.data.org} />
      <PersonalNumberSection />
      <OfficeHoursSection />
      <BusinessNumberSection businessNumber={businessNumber.data ?? null} />
      <DangerZoneSection orgName={me.data.org.name} />
    </div>
  );
}
