/**
 * The dev simulator page (docs/design.md §11 "Dev simulator page", §12 "Demo
 * mechanics"; docs/brief.md "Local demo"). Mounted at `/dev/simulator`, only when the
 * web build is compiled with `VITE_ENABLE_SIM=1` (routes.tsx) — the server-side half of
 * the double gate is `ENABLE_DEV_ROUTES=1` on every `/dev/*` route it calls
 * (`apps/api/src/routes/dev/index.ts`), which 404s in production regardless.
 *
 * Gives a no-handset way to fire every core telephony flow through the mock provider
 * and watch the routing + call log fill in: an in-hours inbound call, a forced
 * out-of-hours call, and the full appless outbound path (dial-in → DTMF → bridge),
 * plus panels for the dev mailbox (magic links), the SMS outbox (PIN codes), and the raw
 * event log.
 */
import { Card, CardTitle } from '@/components/ui/card.tsx';
import { getDemoInfo } from '@/dev/api.ts';
import { DialinPanel } from '@/dev/components/dialin-panel.tsx';
import { InboundCallPanel, OutOfHoursPanel } from '@/dev/components/inbound-panel.tsx';
import {
  CallLogPanel,
  EventLogPanel,
  MailboxPanel,
  SmsOutboxPanel,
} from '@/dev/components/log-panels.tsx';
import { usePolling } from '@/dev/use-polling.ts';

function DemoInfoCard() {
  const { data, error } = usePolling(getDemoInfo, 5000);

  if (error) {
    return (
      <Card data-testid="sim-demo-info">
        <CardTitle>Demo state</CardTitle>
        <p className="mt-2 text-sm text-red-700">
          Could not reach the API. Is <code>pnpm demo</code> running?
        </p>
      </Card>
    );
  }

  if (!data) {
    return (
      <Card data-testid="sim-demo-info">
        <CardTitle>Demo state</CardTitle>
        <p className="mt-2 text-sm text-neutral-500">
          No org yet — run <code>pnpm demo</code> to seed one, or complete onboarding.
        </p>
      </Card>
    );
  }

  return (
    <Card data-testid="sim-demo-info">
      <CardTitle>Demo state</CardTitle>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-neutral-500">Org</dt>
          <dd className="font-medium">{data.name}</dd>
        </div>
        <div>
          <dt className="text-neutral-500">Business number</dt>
          <dd className="font-mono">{data.businessNumberE164 ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-neutral-500">Verified personal number</dt>
          <dd className="font-mono">{data.personalNumberE164 ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-neutral-500">Office hours</dt>
          <dd className="font-medium">{data.officeHoursMode}</dd>
        </div>
      </dl>
    </Card>
  );
}

export function SimulatorPage() {
  const { data: demo } = usePolling(getDemoInfo, 5000);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Telocc demo simulator</h1>
        <p className="mt-1 text-sm text-neutral-600">
          A dev-only page (never shipped in production) for firing telephony events through the mock
          provider without a real phone. Log in as the demo user via the mailbox panel below, then
          try each flow.
        </p>
      </div>

      <DemoInfoCard />

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <InboundCallPanel businessNumberE164={demo?.businessNumberE164 ?? null} />
        <OutOfHoursPanel businessNumberE164={demo?.businessNumberE164 ?? null} />
      </div>

      <DialinPanel
        businessNumberE164={demo?.businessNumberE164 ?? null}
        personalNumberE164={demo?.personalNumberE164 ?? null}
      />

      <CallLogPanel />

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <MailboxPanel />
        <SmsOutboxPanel />
      </div>

      <EventLogPanel />
    </div>
  );
}
