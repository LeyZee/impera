import {
  CLIENT_ERROR_MESSAGE_MAX,
  CLIENT_ERROR_STACK_MAX,
  ClientErrorReleaseSchema,
  ClientErrorReportSchema,
  ClientErrorRouteSchema,
  type ClientErrorReport,
} from '@impera/contracts';

/**
 * The dashboard's own errors (OPS-18): an error nobody caught, a promise rejected without a handler, a screen that could
 * not draw itself. Each is told to the API (`POST /v1/client-errors`), which forwards it to Sentry through its scrubber;
 * the browser never talks to Sentry and no DSN is in the bundle. Said of an error: its message, its stack, the route's
 * template (`/equipe/$memberId`, never the address with its ids or query) and the release. Nothing of the screen.
 */

/** Reports per page load: a screen that fails in a loop says so a few times, the API has its own limit too. */
const REPORTS_PER_PAGE = 5;

/** The commit the bundle was built from (`VITE_RELEASE`, Dockerfile), `dev` otherwise. */
const RELEASE = ClientErrorReleaseSchema.catch('dev').parse(import.meta.env['VITE_RELEASE']);

let sent = 0;
const seen = new Set<string>();

/** Lets the next page load's quota start over; for the tests. */
export function forgetSentReports(): void {
  sent = 0;
  seen.clear();
}

/** What a thrown value says of itself, `Name: message` when it is an error. */
function messageOf(error: unknown): { readonly message: string; readonly stack: string } {
  if (error instanceof Error) {
    return { message: `${error.name}: ${error.message}`, stack: error.stack ?? '' };
  }
  return { message: typeof error === 'string' ? error : 'Valeur rejetée sans erreur', stack: '' };
}

/** The report of an error, or `null` when there is nothing to say (a script of another origin hides its error). */
export function reportOf(error: unknown, route: string | undefined): ClientErrorReport | null {
  const { message, stack } = messageOf(error);
  if (message === '' || message === 'Script error.') return null;
  // Never throws: a report that cannot be made is not made, it must not become an error of its own.
  const report = ClientErrorReportSchema.safeParse({
    message: message.slice(0, CLIENT_ERROR_MESSAGE_MAX),
    stack: stack.slice(0, CLIENT_ERROR_STACK_MAX),
    route: ClientErrorRouteSchema.catch('/').parse(route),
    release: RELEASE,
  });
  return report.success ? report.data : null;
}

/** Sends a report, at most `REPORTS_PER_PAGE` per page and each error once; a report that fails is dropped in silence. */
export function reportError(
  error: unknown,
  route: string | undefined,
  send: typeof fetch = (input, init) => fetch(input, init),
): void {
  if (sent >= REPORTS_PER_PAGE) return;
  const report = reportOf(error, route);
  if (report === null) return;
  const key = `${report.route} ${report.message}`;
  if (seen.has(key)) return;
  seen.add(key);
  sent += 1;
  send('/v1/client-errors', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(report),
    keepalive: true,
  }).catch(() => undefined);
}

/**
 * Listens to the page's errors while signed in, each told with the route `route` reads at that moment. Returns how to
 * stop listening (the session ends, the router is replaced).
 */
export function listenForErrors(
  route: () => string | undefined,
  target: Pick<Window, 'addEventListener' | 'removeEventListener'> = window,
): () => void {
  const onError = (event: ErrorEvent): void => {
    reportError(event.error ?? event.message, route());
  };
  const onRejection = (event: PromiseRejectionEvent): void => {
    reportError(event.reason, route());
  };
  target.addEventListener('error', onError);
  target.addEventListener('unhandledrejection', onRejection);
  return () => {
    target.removeEventListener('error', onError);
    target.removeEventListener('unhandledrejection', onRejection);
  };
}
