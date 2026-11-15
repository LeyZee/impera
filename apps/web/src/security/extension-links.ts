import {
  ApiErrorSchema,
  ExtensionLinkCreatedSchema,
  ExtensionLinkListSchema,
  REAUTHENTICATION_ERROR_CODE,
  type ExtensionLink,
  type ExtensionLinkCreated,
} from '@impera/contracts';

/**
 * « Relier l'extension » (VEI-01 lot b, ADR 0066 § 7): one link per browser where a person watches Instagram, three
 * at most. The token is shown once, at its creation; the server keeps its hash only.
 */

/** `reauth`: the sign-in is over 10 minutes old, the page asks for the password and a code, then links again. */
export type LinkFailure = 'full' | 'forbidden' | 'reauth' | 'failed';

export const LINK_FAILURES: Readonly<Record<LinkFailure, string>> = {
  full: 'Trois navigateurs sont déjà reliés : délies-en un d’abord.',
  forbidden: 'Ce compte ne peut pas relier d’extension.',
  reauth: 'Confirme ton mot de passe et ton code pour relier ce navigateur.',
  failed: 'Le serveur ne répond pas. Réessaie dans un instant.',
};

export class ExtensionLinkError extends Error {
  readonly kind: LinkFailure;

  constructor(kind: LinkFailure) {
    super(LINK_FAILURES[kind]);
    this.name = 'ExtensionLinkError';
    this.kind = kind;
  }
}

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(`/v1/trends/extension-links${path}`, {
    credentials: 'include',
    ...init,
  }).catch(() => null);
  if (response === null) throw new ExtensionLinkError('failed');
  if (response.status === 403) {
    const error = ApiErrorSchema.safeParse(await response.json().catch(() => null));
    throw new ExtensionLinkError(
      error.data?.error.code === REAUTHENTICATION_ERROR_CODE ? 'reauth' : 'forbidden',
    );
  }
  if (response.status === 409) throw new ExtensionLinkError('full');
  return response;
}

/** The person's live links, the oldest first. */
export async function fetchExtensionLinks(): Promise<readonly ExtensionLink[]> {
  const response = await call('');
  if (!response.ok) throw new ExtensionLinkError('failed');
  const parsed = ExtensionLinkListSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new ExtensionLinkError('failed');
  return parsed.data.items;
}

/** A new link for this label (the same label linked again replaces the old one), its token shown once. */
export async function createExtensionLink(label: string): Promise<ExtensionLinkCreated> {
  const response = await call('', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ label }),
  });
  if (!response.ok) throw new ExtensionLinkError('failed');
  const parsed = ExtensionLinkCreatedSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new ExtensionLinkError('failed');
  return parsed.data;
}

/** Unlinks a browser: its extension sends nothing more. A link already gone counts as unlinked. */
export async function revokeExtensionLink(id: string): Promise<void> {
  const response = await call(`/${id}`, { method: 'DELETE' });
  if (!response.ok && response.status !== 404) throw new ExtensionLinkError('failed');
}
