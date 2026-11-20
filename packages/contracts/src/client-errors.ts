import { z } from 'zod';

/**
 * What the dashboard says of an error of its own (OPS-18): `POST /v1/client-errors`, signed in, answered 204. The API
 * forwards it to Sentry through the same scrubber as its own errors; the browser never talks to Sentry, and no DSN is in
 * the bundle. Nothing else is sent: no address with its query, no body, no state of the screen.
 */
export const CLIENT_ERROR_MESSAGE_MAX = 300;
export const CLIENT_ERROR_STACK_MAX = 4_000;

/**
 * The route's template as the router names it (`/equipe/$memberId`), never the address typed: letters, digits and the
 * signs of a path, no query nor fragment.
 */
export const ClientErrorRouteSchema = z
  .string()
  .max(200)
  .regex(/^\/[\w\-./$:]*$/u);

/** A release as the build names it: the commit SHA, or `dev`. */
export const ClientErrorReleaseSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[\w.-]+$/u);

export const ClientErrorReportSchema = z
  .object({
    message: z.string().max(CLIENT_ERROR_MESSAGE_MAX),
    stack: z.string().max(CLIENT_ERROR_STACK_MAX),
    route: ClientErrorRouteSchema,
    release: ClientErrorReleaseSchema,
  })
  .strict();
export type ClientErrorReport = z.infer<typeof ClientErrorReportSchema>;

/** Codes of `POST /v1/client-errors` (api.md): its own limit per account. */
export const CLIENT_ERROR_ERROR_CODES = ['client_error_limited'] as const;
export type ClientErrorErrorCode = (typeof CLIENT_ERROR_ERROR_CODES)[number];
