import { err, ok, type AiProvider, type Result } from '@impera/contracts';

import { PROVIDER_PROFILES } from './catalog';

/** Below this a paste is surely cut; real keys from the three consoles are 39 characters or more. */
const MIN_KEY_LENGTH = 20;

export type KeyShapeError =
  { readonly kind: 'too_short' } | { readonly kind: 'wrong_provider'; readonly belongsTo: AiProvider };

/** The provider whose prefix this key carries, if any. */
export function detectProvider(key: string): AiProvider | undefined {
  return PROVIDER_PROFILES.find((p) => p.keyPrefix !== null && key.startsWith(p.keyPrefix))?.provider;
}

/**
 * Checks done before any network call, so an obvious mistake gets an instant answer. No key of the three consoles
 * holds a space: one copied across a line break or with a stray space still works.
 */
export function checkKeyShape(provider: AiProvider, key: string): Result<string, KeyShapeError> {
  const trimmed = key.replace(/\s+/g, '');
  if (trimmed.length < MIN_KEY_LENGTH) return err({ kind: 'too_short' });
  const owner = detectProvider(trimmed);
  if (owner !== undefined && owner !== provider) return err({ kind: 'wrong_provider', belongsTo: owner });
  return ok(trimmed);
}
