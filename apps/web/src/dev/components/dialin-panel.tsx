/**
 * The appless-outbound simulator flow (design.md §5.2, §11 dev simulator page): dial in
 * from the verified personal number → auto-answer + DTMF collect (keypad) → bridge to
 * the target, presenting the business number as caller ID → either side hangs up, both
 * legs drop. Also the demo's "dial 112 → refusal" walkthrough (brief).
 */
import { useState } from 'react';
import { Alert } from '@/components/ui/alert.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Card, CardTitle } from '@/components/ui/card.tsx';
import {
  generateCallRef,
  simDtmf,
  simHangup,
  simIncomingCall,
  simLegAnswered,
  simLegEnded,
} from '@/dev/api.ts';

type Phase = 'idle' | 'collecting' | 'bridging' | 'refused' | 'timeout' | 'done';

const KEYPAD_ROWS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['*', '0', '#'],
];

export function DialinPanel({
  businessNumberE164,
  personalNumberE164,
}: {
  businessNumberE164: string | null;
  personalNumberE164: string | null;
}) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [callRef, setCallRef] = useState<string | null>(null);
  const [digits, setDigits] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const ready = Boolean(businessNumberE164 && personalNumberE164);

  async function handleDialIn() {
    if (!businessNumberE164 || !personalNumberE164) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const ref = generateCallRef('sim_dialin');
      const result = await simIncomingCall({
        callRef: ref,
        to: businessNumberE164,
        from: personalNumberE164,
      });
      if (result.instruction?.kind === 'collectDigits') {
        setCallRef(ref);
        setPhase('collecting');
        setDigits('');
        setMessage('Auto-answered — beep. Enter the number to call, then Send.');
      } else {
        setMessage(`Declined — busy (${result.instruction?.kind ?? 'unknown'}).`);
      }
    } catch {
      setError('Something went wrong firing the simulated dial-in.');
    } finally {
      setBusy(false);
    }
  }

  function pressKey(key: string) {
    setDigits((d) => (d + key).slice(0, 16));
  }

  async function handleSendDigits(overrideDigits?: string) {
    if (!callRef) return;
    const toSend = overrideDigits ?? digits;
    setBusy(true);
    setError(null);
    try {
      const result = await simDtmf({ callRef, digits: toSend });
      if (result.instruction?.kind === 'bridge') {
        setPhase('bridging');
        setMessage('Valid target — bridging with the business number as caller ID…');
      } else if (result.instruction?.kind === 'refuseTone') {
        setPhase('refused');
        setMessage('Refusal tone played — call blocked and logged. No dial instruction was sent.');
      } else if (result.instruction?.kind === 'hangup') {
        setPhase('timeout');
        setMessage('No digits entered in time — hung up.');
      } else {
        setMessage(`Unexpected instruction: ${result.instruction?.kind}`);
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleAnswer() {
    if (!callRef) return;
    setBusy(true);
    try {
      await simLegAnswered({ callRef });
      const duration = 15 + Math.floor(Math.random() * 60);
      await simHangup({ callRef, durationSeconds: duration });
      setPhase('done');
      setMessage(`Target answered — both legs drop on hangup (${duration}s).`);
    } finally {
      setBusy(false);
    }
  }

  async function handleBusy() {
    if (!callRef) return;
    setBusy(true);
    try {
      await simLegEnded({ callRef, legStatus: 'no_answer' });
      await simHangup({ callRef, durationSeconds: 0 });
      setPhase('done');
      setMessage('Target did not pick up — call log will show "missed".');
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setPhase('idle');
    setCallRef(null);
    setDigits('');
    setMessage(null);
  }

  return (
    <Card data-testid="sim-dialin-panel">
      <CardTitle>Appless outbound (dial-in)</CardTitle>
      <p className="mt-1 text-sm text-neutral-600">
        Simulates dialling your own business number from your verified personal phone — no app, no
        dashboard.
      </p>
      <div className="mt-4 flex flex-col gap-3">
        {phase === 'idle' && (
          <Button
            type="button"
            data-testid="sim-dialin-call-button"
            onClick={handleDialIn}
            disabled={busy || !ready}
          >
            {busy ? 'Dialling…' : `Dial in from ${personalNumberE164 ?? 'verified number'}`}
          </Button>
        )}

        {phase === 'collecting' && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <span
                data-testid="sim-dialin-digits"
                className="min-h-10 flex-1 rounded-md border border-neutral-300 bg-white px-3 py-2 font-mono text-sm"
              >
                {digits || ' '}
              </span>
              <Button type="button" variant="ghost" size="sm" onClick={() => setDigits('')}>
                Clear
              </Button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {KEYPAD_ROWS.flat().map((key) => (
                <Button
                  key={key}
                  type="button"
                  variant="outline"
                  data-testid={`sim-dialin-key-${key}`}
                  onClick={() => pressKey(key)}
                >
                  {key}
                </Button>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setDigits('601234567')}
              >
                Fill valid CZ number
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid="sim-dialin-fill-emergency"
                onClick={() => setDigits('112')}
              >
                Fill 112 (emergency)
              </Button>
            </div>
            <Button
              type="button"
              data-testid="sim-dialin-send-button"
              onClick={() => handleSendDigits()}
              disabled={busy || digits.length === 0}
            >
              Send digits
            </Button>
          </div>
        )}

        {phase === 'bridging' && (
          <div className="flex gap-2">
            <Button
              type="button"
              data-testid="sim-dialin-answer-button"
              onClick={handleAnswer}
              disabled={busy}
            >
              Target answers
            </Button>
            <Button
              type="button"
              variant="outline"
              data-testid="sim-dialin-busy-button"
              onClick={handleBusy}
              disabled={busy}
            >
              Target doesn't answer
            </Button>
          </div>
        )}

        {(phase === 'refused' || phase === 'timeout' || phase === 'done') && (
          <Button type="button" variant="outline" onClick={reset}>
            Reset
          </Button>
        )}

        {message && (
          <Alert variant="info" data-testid="sim-dialin-message">
            {message}
          </Alert>
        )}
        {error && <Alert variant="danger">{error}</Alert>}
        {!ready && (
          <p className="text-sm text-neutral-500">
            Waiting for a verified personal number and business number — run <code>pnpm demo</code>{' '}
            to seed them.
          </p>
        )}
      </div>
    </Card>
  );
}
