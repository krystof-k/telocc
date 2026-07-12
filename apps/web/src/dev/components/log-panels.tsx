/**
 * Live-refreshing panels for the simulator page (design.md §11/§12): the call log (the
 * whole point of the demo — "watch the routing + call log fill in"), the dev mailbox
 * (magic links), the SMS outbox (PIN codes), and the raw sim event log.
 */
import { Badge } from '@/components/ui/badge.tsx';
import { Card, CardTitle } from '@/components/ui/card.tsx';
import {
  DevApiError,
  extractFirstUrl,
  getMailbox,
  getSimState,
  getSmsOutbox,
  listRecentCalls,
} from '@/dev/api.ts';
import { usePolling } from '@/dev/use-polling.ts';

function statusVariant(status: string): 'success' | 'warning' | 'danger' | 'neutral' {
  if (status === 'answered') return 'success';
  if (status === 'missed' || status === 'declined') return 'warning';
  return 'danger';
}

export function CallLogPanel() {
  const { data, error } = usePolling(listRecentCalls, 2000);

  const unauthenticated = error instanceof DevApiError && error.status === 401;

  return (
    <Card data-testid="sim-call-log">
      <CardTitle>Call log (live)</CardTitle>
      {unauthenticated ? (
        <p className="mt-3 text-sm text-neutral-500">
          Sign in as the demo user to see the live call log here (it also appears on the{' '}
          <a className="underline" href="/calls">
            Calls
          </a>{' '}
          page).
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-neutral-200">
              <tr>
                <th className="p-2 font-medium">Time</th>
                <th className="p-2 font-medium">Direction</th>
                <th className="p-2 font-medium">Status</th>
                <th className="p-2 font-medium">Reason</th>
                <th className="p-2 font-medium">From</th>
                <th className="p-2 font-medium">To</th>
                <th className="p-2 font-medium">Duration</th>
              </tr>
            </thead>
            <tbody>
              {(data ?? []).map((call) => (
                <tr key={call.id} className="border-b border-neutral-100 last:border-0">
                  <td className="p-2">{new Date(call.startedAt).toLocaleTimeString()}</td>
                  <td className="p-2">{call.direction}</td>
                  <td className="p-2">
                    <Badge variant={statusVariant(call.status)}>{call.status}</Badge>
                  </td>
                  <td className="p-2 text-neutral-500">{call.reason ?? '—'}</td>
                  <td className="p-2 font-mono text-xs">{call.fromE164 ?? '—'}</td>
                  <td className="p-2 font-mono text-xs">{call.toE164 ?? '—'}</td>
                  <td className="p-2">{call.durationSeconds}s</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data && data.length === 0 && (
            <p className="p-2 text-sm text-neutral-500">No calls yet — try a flow above.</p>
          )}
        </div>
      )}
    </Card>
  );
}

export function MailboxPanel() {
  const { data } = usePolling(getMailbox, 3000);
  const messages = [...(data ?? [])].reverse();

  return (
    <Card data-testid="sim-mailbox">
      <CardTitle>Dev mailbox (magic links)</CardTitle>
      <p className="mt-1 text-sm text-neutral-500">
        Sign-in emails land here instead of a real inbox. Click a link below to log in as that user.
      </p>
      <ul className="mt-3 flex flex-col gap-3">
        {messages.map((msg, i) => {
          const url = extractFirstUrl(msg.text);
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: mailbox has no stable id
            <li key={i} className="rounded-md border border-neutral-200 p-3 text-sm">
              <p className="font-medium">{msg.subject}</p>
              <p className="text-neutral-500">
                to {msg.to} · {new Date(msg.sentAt).toLocaleTimeString()}
              </p>
              {url && (
                <a
                  href={url}
                  data-testid="sim-mailbox-link"
                  className="mt-1 inline-block break-all text-blue-700 underline"
                >
                  {url}
                </a>
              )}
            </li>
          );
        })}
        {messages.length === 0 && <li className="text-sm text-neutral-500">No emails yet.</li>}
      </ul>
    </Card>
  );
}

export function SmsOutboxPanel() {
  const { data } = usePolling(getSmsOutbox, 3000);
  const messages = [...(data ?? [])].reverse();

  return (
    <Card data-testid="sim-sms-outbox">
      <CardTitle>SMS outbox (PIN codes)</CardTitle>
      <p className="mt-1 text-sm text-neutral-500">
        No real SMS is ever sent (brief: "no real SMS or calls"). Verification PINs sent through the
        mock provider are captured here.
      </p>
      <ul className="mt-3 flex flex-col gap-2">
        {messages.map((msg) => (
          <li key={msg.messageRef} className="rounded-md border border-neutral-200 p-2 text-sm">
            <span className="font-mono">{msg.to}</span>: {msg.body}
          </li>
        ))}
        {messages.length === 0 && <li className="text-sm text-neutral-500">No SMS sent yet.</li>}
      </ul>
    </Card>
  );
}

export function EventLogPanel() {
  const { data } = usePolling(getSimState, 2000);
  const events = [...(data ?? [])].reverse().slice(0, 20);

  return (
    <Card data-testid="sim-event-log">
      <CardTitle>Raw event log</CardTitle>
      <p className="mt-1 text-sm text-neutral-500">
        Every simulated webhook and the instruction it got back — the same signed request/response
        shape a real provider would use (design.md §4.5).
      </p>
      <ul className="mt-3 flex flex-col gap-1 font-mono text-xs">
        {events.map((event, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: event log has no stable id
          <li key={i} className="text-neutral-600">
            {new Date(event.at).toLocaleTimeString()} — {event.action} → {event.status}{' '}
            {event.instructionKind ? `(${event.instructionKind})` : ''}
          </li>
        ))}
        {events.length === 0 && <li className="text-neutral-500">No events yet.</li>}
      </ul>
    </Card>
  );
}
