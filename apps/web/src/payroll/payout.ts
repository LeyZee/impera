import {
  ApiErrorSchema,
  PAYOUT_DESTINATION_ERROR_CODES,
  PAYOUT_DIAL_CODES,
  PAYOUT_RECENT_CHANGE_DAYS,
  PayoutDestinationListSchema,
  PayoutDestinationSchema,
  REAUTHENTICATION_ERROR_CODE,
  type PayoutDestination,
  type PayoutDestinationErrorCode,
  type PayoutDestinationList,
  type PayoutCountry,
  type PayoutDetails,
  type PayoutReceiveMethod,
  type PutPayoutDetailsBody,
} from '@impera/contracts';
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useCallback } from 'react';

/**
 * « Où te verser » (ADR 0165): the member reads and writes his own; the owner lists the way each one receives, and
 * reveals one at a time. Nothing of it is kept by the browser (`no-store`, never in the query cache beyond the screen).
 */

const KEY = ['payroll', 'payout-destinations'] as const;
const base = (memberId: string): string => `/v1/payroll/contractors/${memberId}/payout-destination`;

async function read<T>(url: string, parse: (body: unknown) => T): Promise<T> {
  const response = await fetch(url, { credentials: 'include', cache: 'no-store' });
  if (!response.ok) throw new Error(`GET ${url}: ${String(response.status)}`);
  return parse(await response.json());
}

/** The member's own, with its details. */
export function useOwnPayout(memberId: string, enabled = true): UseQueryResult<PayoutDestination> {
  return useQuery({
    queryKey: [...KEY, 'own', memberId],
    queryFn: () => read(base(memberId), (body) => PayoutDestinationSchema.parse(body)),
    gcTime: 0,
    enabled,
  });
}

/** The owner's list: the way each member receives and his last change, never a number. */
export function usePayoutList(enabled: boolean): UseQueryResult<PayoutDestinationList> {
  return useQuery({
    queryKey: [...KEY, 'list'],
    queryFn: () => read('/v1/payroll/payout-destinations', (body) => PayoutDestinationListSchema.parse(body)),
    enabled,
  });
}

export function useRefreshPayouts(): () => Promise<void> {
  const client = useQueryClient();
  return useCallback(() => client.invalidateQueries({ queryKey: KEY }), [client]);
}

export type PayoutRefusalCode = PayoutDestinationErrorCode | 'request_invalid' | 'team_member_not_found';

export type PayoutOutcome =
  | { readonly kind: 'ok'; readonly value: PayoutDestination }
  | { readonly kind: 'refused'; readonly code: PayoutRefusalCode }
  /** 403 `reauthentication_forbidden` (EQ-15): the password and the code are asked again, then the gesture again. */
  | { readonly kind: 'reauth' }
  | { readonly kind: 'failed' };

const KNOWN: ReadonlySet<string> = new Set<string>([
  ...PAYOUT_DESTINATION_ERROR_CODES,
  'request_invalid',
  'team_member_not_found',
]);
const isKnown = (code: string): code is PayoutRefusalCode => KNOWN.has(code);

async function send(url: string, method: 'PUT' | 'POST', body: unknown): Promise<PayoutOutcome> {
  try {
    const response = await fetch(url, {
      method,
      credentials: 'include',
      cache: 'no-store',
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (response.ok) return { kind: 'ok', value: PayoutDestinationSchema.parse(await response.json()) };
    const parsed = ApiErrorSchema.safeParse(await response.json().catch(() => null));
    if (parsed.success && parsed.data.error.code === REAUTHENTICATION_ERROR_CODE) return { kind: 'reauth' };
    if (!parsed.success || !isKnown(parsed.data.error.code)) return { kind: 'failed' };
    return { kind: 'refused', code: parsed.data.error.code };
  } catch {
    return { kind: 'failed' };
  }
}

/** The member writes his own: the number as he typed it, made compact by the server. */
export const writePayout = (memberId: string, body: PutPayoutDetailsBody): Promise<PayoutOutcome> =>
  send(base(memberId), 'PUT', body);

/** The owner shows one member's, journalised. */
export const revealPayout = (memberId: string): Promise<PayoutOutcome> =>
  send(`${base(memberId)}/reveal`, 'POST', undefined);

export const PAYOUT_ERRORS: Readonly<Record<PayoutRefusalCode, string>> = {
  payout_destination_forbidden: 'Seul le membre écrit où le verser.',
  payout_destination_limited: 'Trois changements par jour au plus : réessaie demain.',
  payout_destination_unavailable:
    'Ces coordonnées ne peuvent pas être lues ni gardées ici pour l’instant : préviens le propriétaire.',
  request_invalid: 'Vérifie les numéros et les champs.',
  team_member_not_found: 'Cette fiche n’existe plus.',
};

/** Each way of receiving, as the screens say it, with its colour of the categorical palette (--nv-series-*). */
export const RECEIVE_METHODS: Readonly<
  Record<PayoutReceiveMethod, { readonly label: string; readonly short: string; readonly series: 1 | 2 | 3 }>
> = {
  mobile_money: { label: 'Mobile money', short: 'Mobile money', series: 1 },
  bank_account: { label: 'Compte bancaire', short: 'Banque', series: 2 },
  cash_pickup: { label: 'Retrait en espèces', short: 'Espèces', series: 3 },
};

/** The prefix a phone of this country starts with, as the form puts it first: « +229 ». */
export const dialPrefix = (country: PayoutCountry): string => `+${PAYOUT_DIAL_CODES[country]}`;

/** A phone as one reads it: its country code, then the rest by twos. */
export function phoneLine(phone: string, country: PayoutCountry): string {
  const prefix = dialPrefix(country);
  const known = phone.startsWith(prefix);
  const head = known ? prefix : phone.slice(0, 4);
  const rest = phone.slice(head.length).match(/.{1,2}/gu) ?? [];
  return [head, ...rest].join(' ');
}

/** The number the transfer goes to, as one reads it: the wallet by twos, the account by fours; none for cash. */
export function numberOf(details: PayoutDetails): string | null {
  if (details.method === 'mobile_money') return phoneLine(details.phone, details.country);
  if (details.method === 'bank_account') return (details.account.match(/.{1,4}/gu) ?? []).join(' ');
  return null;
}

/** Who holds it: the operator, the bank, or nothing for a pickup. */
export function holderOf(details: PayoutDetails): string | null {
  if (details.method === 'mobile_money') return details.operator;
  if (details.method === 'bank_account') return details.bank;
  return null;
}
/** A change younger than `PAYOUT_RECENT_CHANGE_DAYS`, said in amber beside « Marquer payé » (ADR 0165 § 5). */
export function changedRecently(changedAt: string | null, now: Date): boolean {
  if (changedAt === null) return false;
  return now.getTime() - Date.parse(changedAt) < PAYOUT_RECENT_CHANGE_DAYS * 86_400_000;
}
