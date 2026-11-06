import type { Logger } from './logger';

/**
 * The recette sandbox (ADR 0075): with `IMPERA_SANDBOX=1`, on a developer's machine only, Impera keeps its real
 * adapters, key verifiers and gateway, and only their base address changes, to a local fake world
 * (`pnpm sandbox:world`) that imitates Reveal's CRM API and the AI services. Nothing leaves the machine: every `fetch`
 * to a host that is not this machine fails as a network error would. The configuration refuses the sandbox in
 * production and on any non-local address (`config.ts`).
 */

/** Where `pnpm sandbox:world` listens when `IMPERA_SANDBOX_URL` is unset. */
export const DEFAULT_SANDBOX_URL = 'http://127.0.0.1:4010';

/** The response header that tells the dashboard it runs against the fake world (its banner). */
export const SANDBOX_HEADER = 'x-impera-sandbox';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** True for an http(s) address on this machine only: `localhost`, `127.0.0.1` or `::1`. */
export function isLoopbackUrl(value: string): boolean {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return (url.protocol === 'http:' || url.protocol === 'https:') && LOOPBACK_HOSTS.has(url.hostname);
}

/** The services the fake world imitates, each under its own path of the world's address. */
interface SandboxBaseUrls {
  readonly xai: string;
  readonly google: string;
  readonly mistral: string;
  readonly elevenlabs: string;
  readonly revealCrm: string;
}

export interface Sandbox {
  /** The fake world's address, `http://127.0.0.1:4010` by default. */
  readonly world: string;
  readonly baseUrls: SandboxBaseUrls;
}

/** The sandbox the configuration asks for, `null` when off. */
export function sandboxOf(config: {
  readonly IMPERA_SANDBOX: boolean;
  readonly IMPERA_SANDBOX_URL?: string | undefined;
}): Sandbox | null {
  if (!config.IMPERA_SANDBOX) return null;
  const world = (config.IMPERA_SANDBOX_URL ?? DEFAULT_SANDBOX_URL).replace(/\/+$/u, '');
  return {
    world,
    baseUrls: {
      xai: `${world}/xai`,
      google: `${world}/google`,
      mistral: `${world}/mistral`,
      elevenlabs: `${world}/elevenlabs`,
      revealCrm: `${world}/reveal-crm`,
    },
  };
}

/** The same addresses as the AI SDKs take them, with their API version (`createAppLlm`). */
export function sdkBaseUrlsOf(sandbox: Sandbox): {
  readonly xai: string;
  readonly google: string;
  readonly mistral: string;
} {
  return {
    xai: `${sandbox.baseUrls.xai}/v1`,
    google: `${sandbox.baseUrls.google}/v1beta`,
    mistral: `${sandbox.baseUrls.mistral}/v1`,
  };
}

/** The error a blocked call ends with: the shape of a network failure, so every caller reacts as to a real outage. */
export class SandboxBlockedCall extends Error {
  constructor(readonly host: string) {
    super(`blocked by the sandbox: ${host} is not this machine (ADR 0075)`);
    this.name = 'SandboxBlockedCall';
  }
}

function targetOf(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/** `fetch` that lets through calls to this machine only; any other host fails as `fetch` fails offline. */
export function guardFetch(inner: typeof fetch, onBlocked?: (host: string) => void): typeof fetch {
  return async (input, init) => {
    const target = targetOf(input);
    if (!isLoopbackUrl(target)) {
      const host = URL.canParse(target) ? new URL(target).host : 'adresse illisible';
      onBlocked?.(host);
      throw new TypeError('fetch failed', { cause: new SandboxBlockedCall(host) });
    }
    return inner(input, init);
  };
}

/**
 * Puts the guard on the process's `fetch`, before any module captures it: the adapters, the verifiers, Telegram, the
 * push services, the buckets, the exchange rates and the breached-password check all go through it. Returns the
 * function that takes it off (tests).
 */
export function installSandboxGuard(sandbox: Sandbox, logger: Logger): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = guardFetch(original, (host) => {
    logger.warn({ host }, 'sandbox: call outside this machine blocked');
  });
  logger.warn(
    { world: sandbox.world },
    'BAC À SABLE (ADR 0075) : rien n’est réel, toute adresse hors de cette machine est bloquée',
  );
  return () => {
    globalThis.fetch = original;
  };
}
