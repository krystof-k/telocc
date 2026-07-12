/**
 * The three core simulator flows (docs/brief.md "Local demo", docs/testing.md "E2E
 * scope" #2-4): inbound customer call while open (forward, then answered/missed), an
 * out-of-hours call (declined busy), and the full appless outbound path (dial-in → DTMF
 * → bridge), plus the emergency-refusal walkthrough the brief calls out by name. Every
 * flow drives `/dev/sim/*` — the real signed-webhook path — and asserts the resulting
 * `calls` row through the authenticated API (`GET /api/calls`), which is what the
 * product's own Calls page and dashboard read.
 *
 * Office hours are forced to `always_open`/`always_closed` around the inbound tests
 * rather than relying on whatever the real wall-clock happens to be against the seeded
 * Mon-Fri 09:00-17:00 schedule (docs/design.md §12) — `office-hours-and-routing.spec.ts`
 * is the dedicated test for the schedule-driven settings walk. Each test restores the
 * org's office hours afterwards (shared demo-org state, not reset between test files).
 *
 * Uses the suite-wide authenticated `storageState` (`e2e/global-setup.ts`) — no
 * per-test login, and every request here goes through `page.request` (which shares the
 * context's cookie jar), so no browser navigation is even needed for most assertions.
 */
import { expect, test } from '@playwright/test';
import {
  DEMO_BUSINESS_NUMBER,
  DEMO_PERSONAL_NUMBER,
  getOfficeHours,
  setOfficeHoursMode,
  simDtmf,
  simHangup,
  simIncomingCall,
  simLegAnswered,
  simLegEnded,
  waitForCall,
} from './helpers.ts';

const CUSTOMER_NUMBER = '+420600555444';

test('inbound customer call while open forwards, and answering logs an answered row', async ({
  page,
}) => {
  const base = await getOfficeHours(page.request);
  await setOfficeHoursMode(page.request, 'always_open', base);
  try {
    const { callRef, result } = await simIncomingCall(page.request, {
      to: DEMO_BUSINESS_NUMBER,
      from: CUSTOMER_NUMBER,
    });
    expect(result.instruction?.kind).toBe('forward');

    await simLegAnswered(page.request, callRef);
    await simHangup(page.request, callRef, 42);

    const call = await waitForCall(page.request, (c) => c.providerCallRef === callRef);
    expect(call.direction).toBe('inbound');
    expect(call.status).toBe('answered');
    expect(call.durationSeconds).toBe(42);
    expect(call.fromE164).toBe(CUSTOMER_NUMBER);
    expect(call.toE164).toBe(DEMO_BUSINESS_NUMBER);
  } finally {
    await setOfficeHoursMode(page.request, base.mode, base);
  }
});

test('inbound customer call while open, not picked up, logs a missed row', async ({ page }) => {
  const base = await getOfficeHours(page.request);
  await setOfficeHoursMode(page.request, 'always_open', base);
  try {
    const { callRef, result } = await simIncomingCall(page.request, {
      to: DEMO_BUSINESS_NUMBER,
      from: CUSTOMER_NUMBER,
    });
    expect(result.instruction?.kind).toBe('forward');

    await simLegEnded(page.request, callRef, 'no_answer');
    await simHangup(page.request, callRef, 0);

    const call = await waitForCall(page.request, (c) => c.providerCallRef === callRef);
    expect(call.direction).toBe('inbound');
    expect(call.status).toBe('missed');
  } finally {
    await setOfficeHoursMode(page.request, base.mode, base);
  }
});

test('inbound customer call while closed is declined busy', async ({ page }) => {
  const base = await getOfficeHours(page.request);
  await setOfficeHoursMode(page.request, 'always_closed', base);
  try {
    const { callRef, result } = await simIncomingCall(page.request, {
      to: DEMO_BUSINESS_NUMBER,
      from: CUSTOMER_NUMBER,
    });
    expect(result.instruction?.kind).toBe('reject');

    const call = await waitForCall(page.request, (c) => c.providerCallRef === callRef);
    expect(call.direction).toBe('inbound');
    expect(call.status).toBe('declined');
    expect(call.reason).toBe('out_of_hours');
  } finally {
    await setOfficeHoursMode(page.request, base.mode, base);
  }
});

test('appless outbound: dial-in from the verified number collects DTMF and bridges', async ({
  page,
}) => {
  const { callRef, result } = await simIncomingCall(page.request, {
    to: DEMO_BUSINESS_NUMBER,
    from: DEMO_PERSONAL_NUMBER,
  });
  expect(result.instruction?.kind).toBe('collectDigits');

  const dtmfResult = await simDtmf(page.request, { callRef, digits: '601234567' });
  expect(dtmfResult.instruction?.kind).toBe('bridge');

  await simLegAnswered(page.request, callRef);
  await simHangup(page.request, callRef, 77);

  const call = await waitForCall(page.request, (c) => c.providerCallRef === callRef);
  expect(call.direction).toBe('outbound');
  expect(call.status).toBe('answered');
  expect(call.durationSeconds).toBe(77);
  expect(call.fromE164).toBe(DEMO_PERSONAL_NUMBER);
});

test('appless outbound: the target not answering logs a missed row', async ({ page }) => {
  const { callRef, result } = await simIncomingCall(page.request, {
    to: DEMO_BUSINESS_NUMBER,
    from: DEMO_PERSONAL_NUMBER,
  });
  expect(result.instruction?.kind).toBe('collectDigits');

  const dtmfResult = await simDtmf(page.request, { callRef, digits: '601234567' });
  expect(dtmfResult.instruction?.kind).toBe('bridge');

  await simLegEnded(page.request, callRef, 'no_answer');
  await simHangup(page.request, callRef, 0);

  const call = await waitForCall(page.request, (c) => c.providerCallRef === callRef);
  expect(call.direction).toBe('outbound');
  expect(call.status).toBe('missed');
});

test('dialling 112 through the appless outbound path is refused and logged', async ({ page }) => {
  const { callRef, result } = await simIncomingCall(page.request, {
    to: DEMO_BUSINESS_NUMBER,
    from: DEMO_PERSONAL_NUMBER,
  });
  expect(result.instruction?.kind).toBe('collectDigits');

  const dtmfResult = await simDtmf(page.request, { callRef, digits: '112' });
  expect(dtmfResult.instruction?.kind).toBe('refuseTone');

  const call = await waitForCall(page.request, (c) => c.providerCallRef === callRef);
  expect(call.direction).toBe('outbound');
  expect(call.status).toBe('emergency_refused');
});
