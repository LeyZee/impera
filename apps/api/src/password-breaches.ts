import { createHash } from 'node:crypto';

import { DomainError } from '@impera/contracts';

/**
 * Whether a password appears in a known data breach (ADR 0046 § 4), through the Pwned Passwords range API with
 * k-anonymity: only the first 5 characters of the password's SHA-1 leave the server, never the password nor its whole
 * hash. Answers `true` for a known password. Throws `PasswordCheckUnavailable` when the service cannot answer: a
 * password nobody could check is refused rather than accepted.
 */
export type PasswordBreachCheck = (password: string) => Promise<boolean>;

const RANGE_URL = 'https://api.pwnedpasswords.com/range/';
const TIMEOUT_MS = 5_000;
/** A padded answer is about 40 KB; anything far beyond is not the service's. */
const MAX_BYTES = 512 * 1024;

/** 503: the page says to try again in a moment, the password is neither accepted nor called unsafe. */
export class PasswordCheckUnavailable extends DomainError {
  constructor(cause?: unknown) {
    // `reason` lets the page say what does not answer, rather than « the server » (recette 05/11, CHAT-10).
    super('service_unavailable', 'La vérification du mot de passe ne répond pas : réessaie dans un instant', {
      cause,
      details: { reason: 'password_check' },
    });
  }
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

async function textUpTo(response: Response, maxBytes: number): Promise<string> {
  const length = Number(response.headers.get('content-length') ?? '0');
  if (length > maxBytes) throw new Error('answer too large');
  const text = await response.text();
  if (Buffer.byteLength(text) > maxBytes) throw new Error('answer too large');
  return text;
}

/** How many times the suffix appears in a range answer (`SUFFIX:COUNT` per line; padding lines count 0). */
export function breachCountOf(answer: string, suffix: string): number {
  for (const line of answer.split(/\r?\n/u)) {
    const [candidate, count] = line.trim().split(':');
    if (candidate?.toUpperCase() !== suffix) continue;
    const parsed = Number(count);
    if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error('unreadable count');
    return parsed;
  }
  return 0;
}

export function createPwnedPasswordsCheck(
  options: { readonly fetch?: FetchLike; readonly timeoutMs?: number } = {},
): PasswordBreachCheck {
  const send: FetchLike = options.fetch ?? ((url, init) => fetch(url, init));
  return async (password) => {
    const sha1 = createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();
    try {
      const response = await send(`${RANGE_URL}${sha1.slice(0, 5)}`, {
        signal: AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS),
        // The answer is padded with fake suffixes, so its size tells nothing about the prefix.
        headers: { 'add-padding': 'true', 'user-agent': 'Impera password check' },
      });
      if (response.status !== 200) {
        await response.body?.cancel();
        throw new Error(`answered ${String(response.status)}`);
      }
      return breachCountOf(await textUpTo(response, MAX_BYTES), sha1.slice(5)) > 0;
    } catch (error) {
      throw new PasswordCheckUnavailable(error);
    }
  };
}
