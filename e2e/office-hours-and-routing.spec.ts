/**
 * "Settings walk" (docs/testing.md "E2E scope" #5): edit office hours through the real
 * Settings page and observe the change take effect on the next simulated call — proving
 * the settings UI, the `/api/office-hours` route, and the inbound routing engine are
 * actually wired together end-to-end, not just individually.
 *
 * Uses the suite-wide authenticated `storageState` (`e2e/global-setup.ts`) — no
 * per-test login.
 */
import { expect, test } from '@playwright/test';
import {
  DEMO_BUSINESS_NUMBER,
  simHangup,
  simIncomingCall,
  simLegAnswered,
  waitForCall,
} from './helpers.ts';

const CUSTOMER_NUMBER = '+420600777888';

test('changing office hours in Settings changes what the next simulated call does', async ({
  page,
}) => {
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();

  const modeSelect = page.locator('#office-hours-mode');
  // Settings has more than one "Save" button (account name, office hours) — scope to
  // the one added for this test (apps/web/src/components/settings/office-hours-section.tsx,
  // an attribute-only addition — components/** isn't owned by any concurrent milestone).
  const saveButton = page.getByTestId('office-hours-save-button');

  try {
    // Force closed via the real settings UI.
    await modeSelect.selectOption('always_closed');
    await saveButton.click();
    await expect(page.getByText('Office hours saved.')).toBeVisible();

    const closed = await simIncomingCall(page.request, {
      to: DEMO_BUSINESS_NUMBER,
      from: CUSTOMER_NUMBER,
    });
    expect(closed.result.instruction?.kind).toBe('reject');
    const closedCall = await waitForCall(page.request, (c) => c.providerCallRef === closed.callRef);
    expect(closedCall.status).toBe('declined');
    expect(closedCall.reason).toBe('out_of_hours');

    // Flip to always-open via the same UI and confirm the next call forwards instead.
    await modeSelect.selectOption('always_open');
    await saveButton.click();
    await expect(page.getByText('Office hours saved.')).toBeVisible();

    const open = await simIncomingCall(page.request, {
      to: DEMO_BUSINESS_NUMBER,
      from: CUSTOMER_NUMBER,
    });
    expect(open.result.instruction?.kind).toBe('forward');
    await simLegAnswered(page.request, open.callRef);
    await simHangup(page.request, open.callRef, 10);
    const openCall = await waitForCall(page.request, (c) => c.providerCallRef === open.callRef);
    expect(openCall.status).toBe('answered');
  } finally {
    // Restore the seeded weekly schedule (design.md §12) for any later test/run.
    await modeSelect.selectOption('schedule');
    await saveButton.click();
    await expect(page.getByText('Office hours saved.')).toBeVisible();
  }
});
