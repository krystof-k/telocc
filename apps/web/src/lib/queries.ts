/**
 * TanStack Query key factories + query hooks over `./api.ts` (design.md §11,
 * decisions.md #17 — see the header comment in `api.ts` for why these wrap plain
 * fetch instead of a `hono/client` RPC client).
 */
import { useQuery } from '@tanstack/react-query';
import { getBusinessNumber, getKyc, getMe, getOfficeHours, listCalls } from './api.ts';

export const queryKeys = {
  me: ['me'] as const,
  kyc: ['kyc'] as const,
  businessNumber: ['business-number'] as const,
  officeHours: ['office-hours'] as const,
  calls: (filters: { direction?: string; from?: string; to?: string; cursor?: string }) =>
    ['calls', filters] as const,
};

export function useMe() {
  return useQuery({ queryKey: queryKeys.me, queryFn: getMe });
}

export function useKyc(enabled = true) {
  return useQuery({ queryKey: queryKeys.kyc, queryFn: getKyc, enabled });
}

export function useBusinessNumber(enabled = true) {
  return useQuery({ queryKey: queryKeys.businessNumber, queryFn: getBusinessNumber, enabled });
}

export function useOfficeHours(enabled = true) {
  return useQuery({ queryKey: queryKeys.officeHours, queryFn: getOfficeHours, enabled });
}

export function useCalls(params: {
  direction?: 'inbound' | 'outbound';
  from?: string;
  to?: string;
  cursor?: string;
}) {
  return useQuery({
    queryKey: queryKeys.calls(params),
    queryFn: () => listCalls(params),
  });
}
