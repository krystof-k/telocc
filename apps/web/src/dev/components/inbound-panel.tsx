/**
 * Simulator flows for customer-initiated inbound calls (design.md §5.1, §11 dev
 * simulator page): (a) an in-hours call that forwards to the verified personal number,
 * and (b) a forced out-of-hours call that gets declined busy. Both drive the mock
 * telephony network through the real signed-webhook path (`/dev/sim/*`,
 * `apps/api/src/routes/dev/index.ts`) exactly as a real provider callback would.
 */
import { useState } from 'react';
import { Alert } from '@/components/ui/alert.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Card, CardTitle } from '@/components/ui/card.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Label } from '@/components/ui/label.tsx';
import {
  DevApiError,
  generateCallRef,
  getOfficeHours,
  putOfficeHours,
  simHangup,
  simIncomingCall,
  simLegAnswered,
  simLegEnded,
} from '@/dev/api.ts';

const DEFAULT_CALLER = '+420600999888';

type Phase = 'idle' | 'ringing' | 'declined' | 'done';

export function InboundCallPanel({ businessNumberE164 }: { businessNumberE164: string | null }) {
  const [caller, setCaller] = useState(DEFAULT_CALLER);
  const [phase, setPhase] = useState<Phase>('idle');
  const [callRef, setCallRef] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleCall() {
    if (!businessNumberE164) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      // Force "in hours" for the routing decision so this walkthrough works whatever
      // the real wall clock says (the seeded schedule is Mon-Fri 9-17 Europe/Prague),
      // mirroring OutOfHoursPanel's always_closed toggle. Routing is decided at
      // call.incoming; the answer/hangup events below are not office-hours-gated,
      // so restoring immediately after is safe.
      const original = await getOfficeHours();
      await putOfficeHours({ ...original, mode: 'always_open' });
      try {
        const ref = generateCallRef('sim_inbound');
        const result = await simIncomingCall({
          callRef: ref,
          to: businessNumberE164,
          from: caller,
        });
        if (result.instruction?.kind === 'forward') {
          setCallRef(ref);
          setPhase('ringing');
          setMessage('Ringing your verified personal number…');
        } else {
          setCallRef(ref);
          setPhase('declined');
          setMessage('Declined — busy signal (no greeting, no voicemail).');
        }
      } finally {
        await putOfficeHours(original);
      }
    } catch (err) {
      setError(
        err instanceof DevApiError && err.status === 401
          ? 'Sign in as the demo user first — this flow toggles office hours via your session.'
          : 'Something went wrong firing the simulated call.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleAnswer() {
    if (!callRef) return;
    setBusy(true);
    try {
      await simLegAnswered({ callRef });
      const duration = 20 + Math.floor(Math.random() * 70);
      await simHangup({ callRef, durationSeconds: duration });
      setPhase('done');
      setMessage(`Answered — call log will show "answered" (${duration}s).`);
    } finally {
      setBusy(false);
    }
  }

  async function handleNoAnswer() {
    if (!callRef) return;
    setBusy(true);
    try {
      await simLegEnded({ callRef, legStatus: 'no_answer' });
      await simHangup({ callRef, durationSeconds: 0 });
      setPhase('done');
      setMessage('Not picked up — call log will show "missed".');
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setPhase('idle');
    setCallRef(null);
    setMessage(null);
  }

  return (
    <Card data-testid="sim-inbound-panel">
      <CardTitle>Inbound customer call</CardTitle>
      <p className="mt-1 text-sm text-neutral-600">
        Simulates a customer dialling your business number during office hours (temporarily forced
        open, then restored) — it forwards to your verified personal number.
      </p>
      <div className="mt-4 flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="sim-inbound-caller">Customer's number</Label>
          <Input
            id="sim-inbound-caller"
            data-testid="sim-inbound-caller-input"
            value={caller}
            onChange={(e) => setCaller(e.target.value)}
            disabled={phase !== 'idle'}
          />
        </div>
        {phase === 'idle' && (
          <Button
            type="button"
            data-testid="sim-inbound-call-button"
            onClick={handleCall}
            disabled={busy || !businessNumberE164}
          >
            {busy ? 'Calling…' : 'Call now'}
          </Button>
        )}
        {phase === 'ringing' && (
          <div className="flex gap-2">
            <Button
              type="button"
              data-testid="sim-inbound-answer-button"
              onClick={handleAnswer}
              disabled={busy}
            >
              Answer
            </Button>
            <Button
              type="button"
              variant="outline"
              data-testid="sim-inbound-missed-button"
              onClick={handleNoAnswer}
              disabled={busy}
            >
              Don't pick up
            </Button>
          </div>
        )}
        {(phase === 'declined' || phase === 'done') && (
          <Button type="button" variant="outline" onClick={reset}>
            Reset
          </Button>
        )}
        {message && (
          <Alert variant="info" data-testid="sim-inbound-message">
            {message}
          </Alert>
        )}
        {error && <Alert variant="danger">{error}</Alert>}
        {!businessNumberE164 && (
          <p className="text-sm text-neutral-500">
            Waiting for a business number — run <code>pnpm demo</code> to seed one.
          </p>
        )}
      </div>
    </Card>
  );
}

export function OutOfHoursPanel({ businessNumberE164 }: { businessNumberE164: string | null }) {
  const [caller] = useState(DEFAULT_CALLER);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleForceClosedCall() {
    if (!businessNumberE164) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const original = await getOfficeHours();
      await putOfficeHours({ ...original, mode: 'always_closed' });
      try {
        const ref = generateCallRef('sim_ooh');
        const result = await simIncomingCall({
          callRef: ref,
          to: businessNumberE164,
          from: caller,
        });
        setMessage(
          result.instruction?.kind === 'reject'
            ? 'Declined — busy signal (out of hours). Office hours restored.'
            : `Unexpected instruction: ${result.instruction?.kind}`,
        );
      } finally {
        await putOfficeHours(original);
      }
    } catch (err) {
      setError(
        err instanceof DevApiError && err.status === 401
          ? 'Sign in as the demo user first — this flow toggles office hours via your session.'
          : 'Something went wrong firing the simulated call.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card data-testid="sim-outofhours-panel">
      <CardTitle>Out-of-hours call</CardTitle>
      <p className="mt-1 text-sm text-neutral-600">
        Temporarily sets office hours to "always closed", fires a simulated customer call, then
        restores your saved office hours.
      </p>
      <div className="mt-4 flex flex-col gap-3">
        <Button
          type="button"
          data-testid="sim-outofhours-call-button"
          onClick={handleForceClosedCall}
          disabled={busy || !businessNumberE164}
        >
          {busy ? 'Calling…' : 'Simulate an out-of-hours call'}
        </Button>
        {message && (
          <Alert variant="info" data-testid="sim-outofhours-message">
            {message}
          </Alert>
        )}
        {error && <Alert variant="danger">{error}</Alert>}
      </div>
    </Card>
  );
}
