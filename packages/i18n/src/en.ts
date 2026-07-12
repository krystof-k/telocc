/**
 * English copy — the source of truth. Every user-facing string (UI, plus API-side
 * email/SMS/disclosure text) goes through this namespaced object. `cs.ts` lands later
 * as a translation of the same keys (decisions.md #1).
 */
export const en = {
  common: {
    appName: 'Telocc',
    save: 'Save',
    cancel: 'Cancel',
    loading: 'Loading…',
  },
  auth: {
    signInTitle: 'Sign in to Telocc',
    emailLabel: 'Email address',
    sendMagicLink: 'Send me a sign-in link',
    magicLinkSent: 'If that address has an account, a sign-in link is on its way.',
  },
  onboarding: {
    createOrgTitle: 'Set up your organisation',
    orgNameLabel: 'Organisation name',
    businessCapacityDeclaration:
      'I confirm this account is used in a business capacity, not as a consumer.',
  },
  verification: {
    title: 'Verify your personal number',
    emergencyDisclosure:
      'Emergency numbers (112, 150, 155, 156, 158) cannot be dialled through Telocc. Always use your personal phone directly for emergencies.',
    sendPin: 'Send verification code',
    enterPin: 'Enter the 6-digit code',
    confirm: 'Confirm',
  },
  calls: {
    title: 'Call log',
    status: {
      answered: 'Answered',
      missed: 'Missed',
      declined: 'Declined',
      failed: 'Failed',
      blocked: 'Blocked',
      emergency_refused: 'Emergency number refused',
      destination_blocked: 'Destination blocked',
    },
  },
  settings: {
    title: 'Settings',
    officeHours: 'Office hours',
    dangerZone: 'Danger zone',
    exportData: 'Export my data',
    deleteAccount: 'Delete account',
  },
} as const;

export type Messages = typeof en;
