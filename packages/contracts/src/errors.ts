import { z } from 'zod';

/**
 * Error codes and the single error body of the HTTP API (docs/conventions/api.md § Erreurs). A code is stable
 * snake_case; its suffix decides the HTTP status: `*_not_found` 404, `*_invalid` 400, `*_unauthenticated` 401,
 * `*_forbidden` 403, `*_conflict` 409, `*_unprocessable` 422, `*_limited` 429, `service_unavailable` 503, anything
 * else 500.
 */

/** Codes produced by the HTTP layer itself; each module documents its own next to its `DomainError` subclasses. */
export const HTTP_ERROR_CODES = [
  'request_invalid',
  'route_not_found',
  /** 405: a known path asked with a method it does not answer; `Allow` lists the ones it does. */
  'method_not_allowed',
  'session_unauthenticated',
  'role_forbidden',
  'origin_forbidden',
  'payload_too_large',
  'rate_limited',
  'service_unavailable',
  'internal_error',
] as const;
export type HttpErrorCode = (typeof HTTP_ERROR_CODES)[number];

export const ErrorCodeSchema = z.string().regex(/^[a-z][a-z0-9_]*$/);

export const ApiErrorSchema = z.object({
  error: z.object({
    code: ErrorCodeSchema,
    /** French, for the operator; never a stack or a query. */
    message: z.string(),
    details: z.record(z.string(), z.unknown()),
    requestId: z.string(),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

/** Base of the errors a module throws for the unexpected; each module subclasses it (`ConversationNotFound`). */
export class DomainError extends Error {
  readonly code: string;
  /** What the client needs to act on the error (`ApiError.details`); never a secret, a query or a fan's text. */
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: string,
    message: string,
    options?: { readonly cause?: unknown; readonly details?: Readonly<Record<string, unknown>> },
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.code = code;
    this.details = options?.details ?? {};
  }
}
