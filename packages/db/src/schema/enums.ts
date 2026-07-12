import { pgEnum } from 'drizzle-orm/pg-core';

export const officeHoursModeEnum = pgEnum('office_hours_mode', [
  'schedule',
  'always_open',
  'always_closed',
]);

export const membershipRoleEnum = pgEnum('membership_role', ['owner']);

export const numberClassEnum = pgEnum('number_class', ['geographic', 'nomadic_910', 'mobile']);

export const businessNumberStatusEnum = pgEnum('business_number_status', [
  'requested',
  'docs_pending',
  'bundle_submitted',
  'approved',
  'rejected',
  'active',
  'porting_out',
  'released',
]);

export const bundleStatusEnum = pgEnum('bundle_status', [
  'draft',
  'submitted',
  'approved',
  'rejected',
]);

export const callSessionKindEnum = pgEnum('call_session_kind', ['inbound', 'dialin']);

export const callSessionStateEnum = pgEnum('call_session_state', [
  'forwarding',
  'collecting',
  'bridging',
  'bridged',
]);

export const callDirectionEnum = pgEnum('call_direction', ['inbound', 'outbound']);

export const callStatusEnum = pgEnum('call_status', [
  'answered',
  'missed',
  'declined',
  'failed',
  'blocked',
  'emergency_refused',
  'destination_blocked',
]);

export const auditRetentionClassEnum = pgEnum('audit_retention_class', ['security', 'lifecycle']);
