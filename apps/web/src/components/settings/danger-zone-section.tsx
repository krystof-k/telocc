import { t } from '@telocc/i18n';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Alert } from '@/components/ui/alert.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Card, CardTitle } from '@/components/ui/card.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Label } from '@/components/ui/label.tsx';
import { deleteAccount, EXPORT_CSV_PATH, EXPORT_JSON_PATH } from '@/lib/api.ts';

/** Danger zone (design.md §11, §10.2/§10.3): data export (JSON/CSV downloads, plain
 * `<a>` navigation so the browser handles the download with the session cookie) and
 * account deletion (`POST /api/account/delete`, org-name confirmation). No modal —
 * the confirm-by-typing-the-name input is itself the confirmation step. */
export function DangerZoneSection({ orgName }: { orgName: string }) {
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleDelete() {
    if (confirmText !== orgName) {
      setError(t('settings.deleteConfirmMismatch'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await deleteAccount(confirmText);
      navigate('/login', { replace: true });
    } catch {
      setError(t('common.somethingWentWrong'));
      setBusy(false);
    }
  }

  return (
    <Card className="border-red-200">
      <CardTitle>{t('settings.dangerZone')}</CardTitle>
      <p className="mt-2 text-sm text-neutral-600">{t('settings.dangerZoneBody')}</p>

      <div className="mt-4 flex flex-wrap gap-2">
        <a
          href={EXPORT_JSON_PATH}
          className="w-fit rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium hover:bg-neutral-100"
        >
          {t('settings.exportJson')}
        </a>
        <a
          href={EXPORT_CSV_PATH}
          className="w-fit rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium hover:bg-neutral-100"
        >
          {t('settings.exportCallsCsv')}
        </a>
      </div>

      <div className="mt-6 border-t border-red-200 pt-4">
        <p className="mb-3 text-sm text-neutral-700">{t('settings.deleteAccountBody')}</p>
        {!confirming ? (
          <Button type="button" variant="outline" onClick={() => setConfirming(true)}>
            {t('settings.deleteAccount')}
          </Button>
        ) : (
          <div className="flex flex-col gap-2">
            <Label htmlFor="confirm-org-name">
              {t('settings.deleteConfirmLabel')} ({orgName})
            </Label>
            <Input
              id="confirm-org-name"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
            />
            {error && <Alert variant="danger">{error}</Alert>}
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={busy || confirmText !== orgName}
                onClick={handleDelete}
                className="border-red-400 text-red-700 hover:bg-red-50"
              >
                {busy ? t('common.loading') : t('settings.deleteConfirmButton')}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setConfirming(false)}>
                {t('common.cancel')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
