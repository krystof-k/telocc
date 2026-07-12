import { t } from '@telocc/i18n';
import { useEffect, useState } from 'react';
import { Alert } from '@/components/ui/alert.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Label } from '@/components/ui/label.tsx';
import { type CallDto, EXPORT_CSV_PATH, listCalls } from '@/lib/api.ts';

function statusVariant(status: string): 'success' | 'warning' | 'danger' | 'neutral' {
  if (status === 'answered') return 'success';
  if (status === 'missed' || status === 'declined') return 'warning';
  return 'danger';
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Call log (design.md §11): timestamp/direction/duration/status, newest first,
 * cursor-paginated ("load more" appends the next page), with a direction filter and a
 * CSV download link (the DSR export route — plain fetch/native download per the M7
 * brief's compile-coupling rule). Fetches directly (not via TanStack Query) so
 * "load more" can append to an accumulated list rather than replace a page window. */
export function CallsPage() {
  const [direction, setDirection] = useState<'inbound' | 'outbound' | ''>('');
  const [items, setItems] = useState<CallDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listCalls({ direction: direction || undefined })
      .then((res) => {
        if (cancelled) return;
        setItems(res.items);
        setNextCursor(res.nextCursor);
      })
      .catch(() => {
        if (!cancelled) setError(t('common.somethingWentWrong'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [direction]);

  async function handleLoadMore() {
    if (!nextCursor) return;
    setLoading(true);
    try {
      const res = await listCalls({ direction: direction || undefined, cursor: nextCursor });
      setItems((prev) => [...prev, ...res.items]);
      setNextCursor(res.nextCursor);
    } catch {
      setError(t('common.somethingWentWrong'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t('calls.title')}</h1>
        <a
          href={EXPORT_CSV_PATH}
          className="rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium hover:bg-neutral-100"
        >
          {t('calls.exportCsv')}
        </a>
      </div>

      <div className="flex items-end gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="direction-filter">{t('calls.directionLabel')}</Label>
          <select
            id="direction-filter"
            className="h-10 rounded-md border border-neutral-300 bg-white px-3 text-sm"
            value={direction}
            onChange={(e) => setDirection(e.target.value as 'inbound' | 'outbound' | '')}
          >
            <option value="">{t('calls.directionAll')}</option>
            <option value="inbound">{t('calls.directionInbound')}</option>
            <option value="outbound">{t('calls.directionOutbound')}</option>
          </select>
        </div>
      </div>

      {error && <Alert variant="danger">{error}</Alert>}

      <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-neutral-200 bg-neutral-50">
            <tr>
              <th scope="col" className="p-3 font-medium">
                {t('calls.columnTime')}
              </th>
              <th scope="col" className="p-3 font-medium">
                {t('calls.columnDirection')}
              </th>
              <th scope="col" className="p-3 font-medium">
                {t('calls.columnDuration')}
              </th>
              <th scope="col" className="p-3 font-medium">
                {t('calls.columnStatus')}
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((call) => (
              <tr key={call.id} className="border-b border-neutral-100 last:border-0">
                <td className="p-3">{new Date(call.startedAt).toLocaleString()}</td>
                <td className="p-3">
                  {call.direction === 'inbound'
                    ? t('calls.directionInbound')
                    : t('calls.directionOutbound')}
                </td>
                <td className="p-3">{formatDuration(call.durationSeconds)}</td>
                <td className="p-3">
                  <Badge variant={statusVariant(call.status)}>
                    {t(`calls.status.${call.status}`)}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && items.length === 0 && (
          <p className="p-4 text-sm text-neutral-500">{t('calls.empty')}</p>
        )}
      </div>

      {nextCursor && (
        <Button type="button" variant="outline" onClick={handleLoadMore} disabled={loading}>
          {loading ? t('common.loading') : t('calls.loadMore')}
        </Button>
      )}
    </div>
  );
}
