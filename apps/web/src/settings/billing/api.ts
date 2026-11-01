import {
  AGENCY_LOGO_MAX_BYTES,
  AgencyLogoRefusalSchema,
  AgencyLogoSchema,
  ApiErrorSchema,
  BillingSettingsViewSchema,
  type AgencyLogo,
  type AgencyLogoRefusal,
  type BillingSettingsView,
  type UpdateBillingSettingsBody,
} from '@nirvana/contracts';
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useCallback } from 'react';
import { z } from 'zod';

import { PAYROLL_KEY } from '@/payroll/api';

/**
 * `/v1/payroll/billing-settings` as Réglages › Facturation reads and writes it (EQ-06), the owner's alone: every answer
 * parsed with the contract, every refusal said by its code.
 */

const BASE = '/v1/payroll/billing-settings';
const BILLING_KEY = [...PAYROLL_KEY, 'billing-settings'] as const;

/** The settings and their logo: `settings` is `null` until the first save, and no invoice leaves until then. */
export function useBillingSettings(): UseQueryResult<BillingSettingsView> {
  return useQuery({
    queryKey: BILLING_KEY,
    queryFn: async () => {
      const response = await fetch(BASE, { credentials: 'include' });
      if (!response.ok) throw new Error(`GET ${BASE}: ${String(response.status)}`);
      return BillingSettingsViewSchema.parse(await response.json());
    },
    retry: 1,
    retryDelay: 400,
  });
}

/** The address of a kept logo: its fingerprint is its name, so the browser keeps it for good. */
export const logoUrl = (sha256: string): string => `${BASE}/logos/${sha256}`;

/** What a write may be refused for, as the screen words it. */
export type BillingRefusal =
  | { readonly kind: 'logo'; readonly reason: AgencyLogoRefusal }
  | { readonly kind: 'logo_missing' }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'failed' };

export type BillingOutcome<T> = { readonly kind: 'ok'; readonly value: T } | BillingRefusal;

const DetailsSchema = z.object({ reason: AgencyLogoRefusalSchema });

async function refusalOf(response: Response): Promise<BillingRefusal> {
  const parsed = ApiErrorSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) return { kind: 'failed' };
  const { code, details } = parsed.data.error;
  if (code === 'agency_logo_invalid') {
    const reason = DetailsSchema.safeParse(details);
    return reason.success ? { kind: 'logo', reason: reason.data.reason } : { kind: 'failed' };
  }
  if (code === 'payload_too_large') return { kind: 'logo', reason: 'too_heavy' };
  if (code === 'agency_logo_not_found') return { kind: 'logo_missing' };
  if (code === 'request_invalid') return { kind: 'invalid' };
  if (code === 'role_forbidden' || code === 'payroll_forbidden') return { kind: 'forbidden' };
  return { kind: 'failed' };
}

/** What every invoice issued from now on copies; one issued before keeps its own. */
export async function saveBillingSettings(
  body: UpdateBillingSettingsBody,
): Promise<BillingOutcome<BillingSettingsView>> {
  try {
    const response = await fetch(BASE, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) return await refusalOf(response);
    return { kind: 'ok', value: BillingSettingsViewSchema.parse(await response.json()) };
  } catch {
    return { kind: 'failed' };
  }
}

/**
 * A PNG sent as it is (`image/png`): the server reads it whole before keeping it, and the same bytes give the same
 * logo. A file over the limit is refused here, never sent.
 */
export async function addLogo(file: Blob): Promise<BillingOutcome<AgencyLogo>> {
  if (file.size > AGENCY_LOGO_MAX_BYTES) return { kind: 'logo', reason: 'too_heavy' };
  try {
    const response = await fetch(`${BASE}/logos`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'image/png' },
      body: file,
    });
    if (!response.ok) return await refusalOf(response);
    return { kind: 'ok', value: AgencyLogoSchema.parse(await response.json()) };
  } catch {
    return { kind: 'failed' };
  }
}

/** After a save: the page shows what the server answered, without reading it again. */
export function useKeepBillingSettings(): (view: BillingSettingsView) => void {
  const client = useQueryClient();
  return useCallback((view) => client.setQueryData(BILLING_KEY, view), [client]);
}
