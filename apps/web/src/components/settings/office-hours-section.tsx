import { useQueryClient } from '@tanstack/react-query';
import { t } from '@telocc/i18n';
import { useEffect, useState } from 'react';
import { Alert } from '@/components/ui/alert.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Card, CardTitle } from '@/components/ui/card.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Label } from '@/components/ui/label.tsx';
import type { OfficeHoursDto, OfficeHoursRuleDto } from '@/lib/api.ts';
import { putOfficeHours } from '@/lib/api.ts';
import { queryKeys, useOfficeHours } from '@/lib/queries.ts';

const MODES = ['schedule', 'always_open', 'always_closed'] as const;
const MODE_LABEL_KEY = {
  schedule: 'settings.officeHoursModeSchedule',
  always_open: 'settings.officeHoursModeAlwaysOpen',
  always_closed: 'settings.officeHoursModeAlwaysClosed',
} as const;

type WeekdaySettingsKey =
  | 'weekdayMonday'
  | 'weekdayTuesday'
  | 'weekdayWednesday'
  | 'weekdayThursday'
  | 'weekdayFriday'
  | 'weekdaySaturday'
  | 'weekdaySunday';

const WEEKDAYS: { value: number; labelKey: WeekdaySettingsKey }[] = [
  { value: 0, labelKey: 'weekdayMonday' },
  { value: 1, labelKey: 'weekdayTuesday' },
  { value: 2, labelKey: 'weekdayWednesday' },
  { value: 3, labelKey: 'weekdayThursday' },
  { value: 4, labelKey: 'weekdayFriday' },
  { value: 5, labelKey: 'weekdaySaturday' },
  { value: 6, labelKey: 'weekdaySunday' },
];

function weekdayLabel(weekday: number): string {
  const entry = WEEKDAYS.find((w) => w.value === weekday);
  return entry ? t(`settings.${entry.labelKey}`) : String(weekday);
}

export function OfficeHoursSection() {
  const officeHours = useOfficeHours();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<OfficeHoursDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (officeHours.data && !draft) setDraft(officeHours.data);
  }, [officeHours.data, draft]);

  if (!draft) {
    return (
      <Card>
        <CardTitle>{t('settings.officeHours')}</CardTitle>
        <p className="mt-3 text-neutral-500">{t('common.loading')}</p>
      </Card>
    );
  }

  function updateDraft(patch: Partial<OfficeHoursDto>) {
    setDraft((prev) => (prev ? { ...prev, ...patch } : prev));
    setSaved(false);
  }

  function updateRule(weekday: number, patch: Partial<OfficeHoursRuleDto>) {
    setDraft((prev) =>
      prev
        ? {
            ...prev,
            rules: prev.rules.map((r) => (r.weekday === weekday ? { ...r, ...patch } : r)),
          }
        : prev,
    );
    setSaved(false);
  }

  function addRule() {
    setDraft((prev) => {
      if (!prev) return prev;
      const used = new Set(prev.rules.map((r) => r.weekday));
      const next = WEEKDAYS.find((w) => !used.has(w.value));
      if (!next) return prev;
      return {
        ...prev,
        rules: [...prev.rules, { weekday: next.value, opensAt: '09:00', closesAt: '17:00' }],
      };
    });
    setSaved(false);
  }

  function removeRule(weekday: number) {
    setDraft((prev) =>
      prev ? { ...prev, rules: prev.rules.filter((r) => r.weekday !== weekday) } : prev,
    );
    setSaved(false);
  }

  async function handleSave() {
    if (!draft) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const updated = await putOfficeHours(draft);
      setDraft(updated);
      queryClient.setQueryData(queryKeys.officeHours, updated);
      setSaved(true);
    } catch {
      setError(t('settings.officeHoursInvalid'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardTitle>{t('settings.officeHours')}</CardTitle>
      <div className="mt-4 flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <Label htmlFor="office-hours-mode">{t('settings.officeHoursModeLabel')}</Label>
          <select
            id="office-hours-mode"
            className="h-10 rounded-md border border-neutral-300 bg-white px-3 text-sm"
            value={draft.mode}
            onChange={(e) => updateDraft({ mode: e.target.value as OfficeHoursDto['mode'] })}
          >
            {MODES.map((mode) => (
              <option key={mode} value={mode}>
                {t(MODE_LABEL_KEY[mode])}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="office-hours-timezone">{t('settings.officeHoursTimezoneLabel')}</Label>
          <Input
            id="office-hours-timezone"
            value={draft.timezone}
            onChange={(e) => updateDraft({ timezone: e.target.value })}
          />
        </div>

        {draft.mode === 'schedule' && (
          <div className="flex flex-col gap-3">
            {draft.rules
              .slice()
              .sort((a, b) => a.weekday - b.weekday)
              .map((rule) => (
                <div key={rule.weekday} className="flex items-end gap-3">
                  <span className="w-28 text-sm font-medium">{weekdayLabel(rule.weekday)}</span>
                  <div className="flex flex-col gap-1">
                    <Label htmlFor={`opens-${rule.weekday}`} className="sr-only">
                      {t('settings.officeHoursOpensAt')} {weekdayLabel(rule.weekday)}
                    </Label>
                    <Input
                      id={`opens-${rule.weekday}`}
                      type="time"
                      value={rule.opensAt.slice(0, 5)}
                      onChange={(e) => updateRule(rule.weekday, { opensAt: e.target.value })}
                    />
                  </div>
                  <span aria-hidden="true">–</span>
                  <div className="flex flex-col gap-1">
                    <Label htmlFor={`closes-${rule.weekday}`} className="sr-only">
                      {t('settings.officeHoursClosesAt')} {weekdayLabel(rule.weekday)}
                    </Label>
                    <Input
                      id={`closes-${rule.weekday}`}
                      type="time"
                      value={rule.closesAt.slice(0, 5)}
                      onChange={(e) => updateRule(rule.weekday, { closesAt: e.target.value })}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removeRule(rule.weekday)}
                  >
                    {t('settings.officeHoursRemoveRule')}
                  </Button>
                </div>
              ))}
            {draft.rules.length < 7 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addRule}
                className="self-start"
              >
                {t('settings.officeHoursAddRule')}
              </Button>
            )}
          </div>
        )}

        {saved && <Alert variant="success">{t('settings.officeHoursSaved')}</Alert>}
        {error && <Alert variant="danger">{error}</Alert>}

        <Button type="button" onClick={handleSave} disabled={busy} className="self-start">
          {busy ? t('common.loading') : t('common.save')}
        </Button>
      </div>
    </Card>
  );
}
