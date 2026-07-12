import { t } from '@telocc/i18n';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Label } from '@/components/ui/label.tsx';
import { type CatalogNumberDto, getNumberCatalog, provisionNumber } from '@/lib/api.ts';

/** Prague catalog is the seeded/demo default region (decisions.md #5); brief scopes
 * onboarding to "business number pick from Prague catalog" specifically. There is no
 * `GET /api/regions` route (the region list isn't part of the frozen API surface), so
 * this mirrors the fixed seed list from `packages/db/src/seed/regions.ts`. */
const REGIONS = [
  'Prague',
  'Central Bohemia',
  'South Bohemia / South Moravia',
  'West Bohemia',
  'North Bohemia',
  'East Bohemia',
  'North Moravia',
];

export function NumberStep({ onDone }: { onDone: () => void }) {
  const [region, setRegion] = useState('Prague');
  const [numbers, setNumbers] = useState<CatalogNumberDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [provisioningE164, setProvisioningE164] = useState<string | null>(null);

  async function handleBrowse() {
    setBusy(true);
    setError(null);
    setNumbers(null);
    try {
      const results = await getNumberCatalog(region);
      setNumbers(results);
    } catch {
      setError(t('common.somethingWentWrong'));
    } finally {
      setBusy(false);
    }
  }

  async function handleChoose(e164: string) {
    setProvisioningE164(e164);
    setError(null);
    try {
      await provisionNumber(e164);
      onDone();
    } catch {
      setError(t('onboarding.provisionFailed'));
      setProvisioningE164(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-xl font-semibold">{t('onboarding.numberIntro')}</h2>
      <div className="flex items-end gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="region">{t('onboarding.regionLabel')}</Label>
          <select
            id="region"
            className="h-10 rounded-md border border-neutral-300 bg-white px-3 text-sm"
            value={region}
            onChange={(e) => setRegion(e.target.value)}
          >
            {REGIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
        <Button type="button" onClick={handleBrowse} disabled={busy}>
          {busy ? t('common.loading') : t('common.continue')}
        </Button>
      </div>

      {error && <Alert variant="danger">{error}</Alert>}

      {numbers && numbers.length === 0 && (
        <Alert variant="info">{t('onboarding.catalogEmpty')}</Alert>
      )}

      {numbers && numbers.length > 0 && (
        <ul className="flex flex-col gap-2">
          {numbers.map((n) => (
            <li
              key={n.e164}
              className="flex items-center justify-between rounded-md border border-neutral-200 p-3"
            >
              <span className="font-mono text-sm">{n.e164}</span>
              <Button
                type="button"
                size="sm"
                disabled={provisioningE164 !== null}
                onClick={() => handleChoose(n.e164)}
              >
                {provisioningE164 === n.e164
                  ? t('onboarding.provisioning')
                  : t('onboarding.chooseNumber')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
