import { z } from 'zod';

// Quotes a key is often copied with, from a .env, a JSON sample or a chat: straight, curly, French, backtick.
const QUOTE_PAIRS: readonly (readonly [string, string])[] = [
  ['"', '"'],
  ["'", "'"],
  ['`', '`'],
  ['“', '”'],
  ['‘', '’'],
  ['«', '»'],
];

/**
 * A key or token as it was meant, from what was pasted: spaces around trimmed, a leading `Bearer ` (copied from an
 * `Authorization` header) dropped, then one pair of surrounding quotes dropped. No key of Reveal, xAI, Google,
 * Mistral, ElevenLabs or Telegram starts with `Bearer` or a quote (recette 07/11, Bilan, remarque 6).
 */
export function cleanPastedSecret(pasted: string): string {
  let secret = pasted.trim().replace(/^bearer(?:\s+|$)/iu, '');
  for (const [open, close] of QUOTE_PAIRS) {
    if (secret.length >= 2 && secret.startsWith(open) && secret.endsWith(close)) {
      secret = secret.slice(open.length, secret.length - close.length);
      break;
    }
  }
  return secret.trim();
}

/** A pasted key or token field: cleaned as {@link cleanPastedSecret} says, then bounded. */
export function pastedSecret(
  max: number,
): z.ZodPipe<z.ZodPipe<z.ZodString, z.ZodTransform<string, string>>, z.ZodString> {
  return z
    .string()
    .max(max * 2)
    .transform(cleanPastedSecret)
    .pipe(z.string().min(1).max(max));
}
