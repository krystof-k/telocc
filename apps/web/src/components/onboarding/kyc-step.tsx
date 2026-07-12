import { useQuery } from '@tanstack/react-query';
import { t } from '@telocc/i18n';
import { type ChangeEvent, type FormEvent, useState } from 'react';
import { Alert } from '@/components/ui/alert.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Label } from '@/components/ui/label.tsx';
import { getKycRequirements, type KycDocumentDto, putKyc, uploadKycDocument } from '@/lib/api.ts';

const PO_BOX_PATTERN = /\bp\.?\s*o\.?\s*box\b/i;

/** Business KYC record + document upload (design.md §6 step 3, §7). `GET
 * /api/kyc/requirements` names the document types the (mock) provider wants; the
 * upload form loops over them so the catalog step's `submitBundle` call has something
 * to send (the mock provider auto-approves regardless of exact document count). */
export function KycStep({ onDone }: { onDone: () => void }) {
  const requirements = useQuery({
    queryKey: ['kyc-requirements'],
    queryFn: getKycRequirements,
  });

  const [legalName, setLegalName] = useState('');
  const [ico, setIco] = useState('');
  const [street, setStreet] = useState('');
  const [city, setCity] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [savedEndUser, setSavedEndUser] = useState(false);
  const [uploaded, setUploaded] = useState<KycDocumentDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSaveDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (
      !legalName.trim() ||
      !/^\d{8}$/.test(ico) ||
      !street.trim() ||
      !city.trim() ||
      !postalCode.trim()
    ) {
      setError(t('common.somethingWentWrong'));
      return;
    }
    if (PO_BOX_PATTERN.test(street)) {
      setError(t('onboarding.poBoxRejected'));
      return;
    }
    setBusy(true);
    try {
      await putKyc({
        legalName: legalName.trim(),
        ico,
        street: street.trim(),
        city: city.trim(),
        postalCode: postalCode.trim(),
        country: 'CZ',
      });
      setSavedEndUser(true);
    } catch {
      // The server re-validates independently (zod + PO-box regex, apps/api/src/routes/kyc.ts) —
      // this branch is the generic network/unexpected-shape fallback.
      setError(t('common.somethingWentWrong'));
    } finally {
      setBusy(false);
    }
  }

  async function handleUpload(type: string, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const doc = await uploadKycDocument(file, type);
      setUploaded((prev) => [...prev, doc]);
    } catch {
      setError(t('common.somethingWentWrong'));
    } finally {
      setBusy(false);
      event.target.value = '';
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-xl font-semibold">{t('onboarding.kycIntro')}</h2>

      {!savedEndUser ? (
        <form className="flex flex-col gap-4" onSubmit={handleSaveDetails} noValidate>
          <div className="flex flex-col gap-1">
            <Label htmlFor="legal-name">{t('onboarding.legalNameLabel')}</Label>
            <Input
              id="legal-name"
              required
              value={legalName}
              onChange={(e) => setLegalName(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="ico">{t('onboarding.icoLabel')}</Label>
            <Input
              id="ico"
              required
              inputMode="numeric"
              pattern="\d{8}"
              maxLength={8}
              value={ico}
              onChange={(e) => setIco(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="street">{t('onboarding.streetLabel')}</Label>
            <Input
              id="street"
              required
              value={street}
              onChange={(e) => setStreet(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1">
              <Label htmlFor="city">{t('onboarding.cityLabel')}</Label>
              <Input id="city" required value={city} onChange={(e) => setCity(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="postal-code">{t('onboarding.postalCodeLabel')}</Label>
              <Input
                id="postal-code"
                required
                value={postalCode}
                onChange={(e) => setPostalCode(e.target.value)}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="country">{t('onboarding.countryLabel')}</Label>
            <Input id="country" value="Czechia (CZ)" disabled />
          </div>
          {error && <Alert variant="danger">{error}</Alert>}
          <Button type="submit" disabled={busy}>
            {busy ? t('common.loading') : t('common.continue')}
          </Button>
        </form>
      ) : (
        <div className="flex flex-col gap-4">
          <h3 className="font-medium">{t('onboarding.documentsTitle')}</h3>
          <ul className="flex flex-col gap-3">
            {(requirements.data ?? []).map((req) => {
              const already = uploaded.find((d) => d.type === req.type);
              return (
                <li
                  key={req.type}
                  className="flex items-center justify-between gap-3 rounded-md border border-neutral-200 p-3"
                >
                  <span className="text-sm">{req.label}</span>
                  {already ? (
                    <span className="text-sm text-emerald-700">
                      {t('onboarding.documentUploaded')}: {already.filename}
                    </span>
                  ) : (
                    <input
                      type="file"
                      aria-label={req.label}
                      accept="application/pdf,image/png,image/jpeg"
                      disabled={busy}
                      onChange={(e) => handleUpload(req.type, e)}
                      className="text-sm"
                    />
                  )}
                </li>
              );
            })}
          </ul>
          {error && <Alert variant="danger">{error}</Alert>}
          <Button type="button" onClick={onDone}>
            {t('common.continue')}
          </Button>
        </div>
      )}
    </div>
  );
}
