import {
  CustomOrderListSchema,
  CustomOrderViewSchema,
  type AdvanceCustomOrderBody,
  type CreatorId,
  type CustomOrderId,
  type CustomOrderView,
  type DecideCustomOrderBody,
} from '@impera/contracts';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

/**
 * `/v1/creators/:id/custom-orders` (ADR 0159 § A.3): read by the owner and an active manager who follows her; her
 * answer and each step entered by the owner alone. Every answer is parsed with the contract: a shape the page does not
 * expect reads as « Le serveur ne répond pas », never as a guess.
 */

export type CustomOrdersErrorKind =
  'session_expired' | 'forbidden' | 'not_found' | 'conflict' | 'refused' | 'unavailable';

export const CUSTOM_ORDERS_ERRORS: Readonly<Record<CustomOrdersErrorKind, string>> = {
  session_expired: 'Ta session a expiré. Reconnecte-toi, puis recommence : rien n’a été enregistré.',
  forbidden: 'Seul le compte propriétaire répond pour elle.',
  not_found: 'Cette commande n’existe plus.',
  conflict: 'Cette commande a déjà changé entre-temps. La liste est rechargée : rien n’a été enregistré.',
  refused: 'Ce prix ne passe pas : au moins 1 €. Rien n’a été enregistré.',
  unavailable: 'Le serveur ne répond pas. Réessaie dans un instant : rien n’a été enregistré.',
};

export class CustomOrdersError extends Error {
  readonly kind: CustomOrdersErrorKind;

  constructor(kind: CustomOrdersErrorKind, detail: string) {
    super(`${CUSTOM_ORDERS_ERRORS[kind]} (${detail})`);
    this.name = 'CustomOrdersError';
    this.kind = kind;
  }
}

export const customOrdersErrorKind = (error: unknown): CustomOrdersErrorKind =>
  error instanceof CustomOrdersError ? error.kind : 'unavailable';

const base = (creatorId: CreatorId): string => `/v1/creators/${encodeURIComponent(creatorId)}/custom-orders`;

async function call(url: string, what: string, init: RequestInit = {}): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, { credentials: 'include', ...init });
  } catch {
    throw new CustomOrdersError('unavailable', `${what}: réseau`);
  }
  const detail = `${what}: ${String(response.status)}`;
  if (response.status === 401) throw new CustomOrdersError('session_expired', detail);
  if (response.status === 403) throw new CustomOrdersError('forbidden', detail);
  if (response.status === 404) throw new CustomOrdersError('not_found', detail);
  if (response.status === 409) throw new CustomOrdersError('conflict', detail);
  if (response.status === 400) throw new CustomOrdersError('refused', detail);
  if (!response.ok) throw new CustomOrdersError('unavailable', detail);
  return response.json().catch(() => null);
}

export type CustomOrdersScope = 'active' | 'all';

export const customOrdersQueryKey = (creatorId: CreatorId): readonly string[] => ['custom-orders', creatorId];

/** Her orders, newest first: `active` until delivered, or `all`. `enabled` false reads nothing. */
export function useCustomOrders(
  creatorId: CreatorId,
  scope: CustomOrdersScope,
  enabled = true,
): UseQueryResult<readonly CustomOrderView[]> {
  return useQuery({
    queryKey: [...customOrdersQueryKey(creatorId), scope],
    enabled,
    queryFn: async () => {
      const what = 'GET custom-orders';
      const list = CustomOrderListSchema.safeParse(await call(`${base(creatorId)}?scope=${scope}`, what));
      if (list.success) return list.data.orders;
      throw new CustomOrdersError('unavailable', `${what}: réponse inattendue`);
    },
    retry: 1,
    retryDelay: 400,
  });
}

async function post(
  creatorId: CreatorId,
  orderId: CustomOrderId,
  step: 'decision' | 'advance',
  body: DecideCustomOrderBody | AdvanceCustomOrderBody,
): Promise<CustomOrderView> {
  const what = `POST custom-orders/${step}`;
  const view = CustomOrderViewSchema.safeParse(
    await call(`${base(creatorId)}/${encodeURIComponent(orderId)}/${step}`, what, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
  if (view.success) return view.data;
  throw new CustomOrdersError('unavailable', `${what}: réponse inattendue`);
}

/** Her yes at a price, or her no. */
export const decideCustomOrder = (
  creatorId: CreatorId,
  orderId: CustomOrderId,
  body: DecideCustomOrderBody,
): Promise<CustomOrderView> => post(creatorId, orderId, 'decision', body);

/** The next step: deposit received, delivered, cancelled. */
export const advanceCustomOrder = (
  creatorId: CreatorId,
  orderId: CustomOrderId,
  body: AdvanceCustomOrderBody,
): Promise<CustomOrderView> => post(creatorId, orderId, 'advance', body);
