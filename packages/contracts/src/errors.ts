import { z } from 'zod';

/**
 * Error codes and the single error body of the HTTP API (docs/conventions/api.md § Erreurs). A code is stable
 * snake_case; its suffix decides the HTTP status: `*_not_found` 404, `*_invalid` 400, `*_unauthenticated` 401,
 * `*_forbidden` 403, `*_conflict` 409, `*_unprocessable` 422, `*_limited` 429, `*_bad_gateway` 502 (a platform Impera
 * called refused or failed), `service_unavailable` 503, anything else 500.
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
  /** 404: an id in the request points at a row that does not exist (a foreign key refused it). */
  'reference_not_found',
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

/**
 * A refusal the screen acts on by its kind (a key or a token turned down, a platform's answer): the common body, the
 * kind in `details` and its French sentence as the message (recette 05/11, MOT-13). Each module passes its own enum.
 */
export type RefusalBodySchema<K extends z.ZodType<string>> = z.ZodObject<{
  error: z.ZodObject<{
    code: typeof ErrorCodeSchema;
    message: z.ZodString;
    details: z.ZodObject<{ kind: K }>;
    requestId: z.ZodString;
  }>;
}>;

export const refusalBodySchema = <K extends z.ZodType<string>>(kind: K): RefusalBodySchema<K> =>
  z.object({
    error: z.object({
      code: ErrorCodeSchema,
      message: z.string().min(1),
      details: z.object({ kind }),
      requestId: z.string(),
    }),
  });

/** The kind and the sentence of a refusal read in the common body, as the screens show them. */
export const refusalOf = <K extends string>(body: {
  readonly error: { readonly message: string; readonly details: { readonly kind: K } };
}): { readonly kind: K; readonly message: string } => ({
  kind: body.error.details.kind,
  message: body.error.message,
});

/** Thrown for a refusal of that shape: the error handler writes it in the common body (`details.kind`). */
export class RefusalError extends DomainError {
  constructor(code: string, refusal: { readonly kind: string; readonly message: string }) {
    super(code, refusal.message, { details: { kind: refusal.kind } });
  }
}
