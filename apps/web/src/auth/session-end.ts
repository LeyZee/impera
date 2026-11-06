import { ApiErrorSchema } from '@impera/contracts';

/**
 * A session closed elsewhere (« Fermer ses sessions », « Fermer les autres », a member who left) or past its 12 h or
 * 7 days answers 401 to the next call, whatever the screen (recette 05/11, SEC-01). The screens make their own calls
 * with `fetch` and each read that 401 its own way (« Injoignable », « Le serveur ne répond pas »): rather than teach
 * every one of them, the signed-in app watches the answers of `/v1` once, here, and goes back to the sign-in page.
 */

/** The error code of a request made without a session (`SessionUnauthenticated` on the server). */
const SESSION_GONE = 'session_unauthenticated';

function pathOf(input: RequestInfo | URL): string {
  const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  return new URL(href, window.location.origin).pathname;
}

/**
 * Whether a 401 says the session is gone. Under `/v1/auth`, a 401 is also a wrong password or a wrong code (a
 * confirmation, the activation): only its code tells. Elsewhere every 401 is a missing session, even one a proxy
 * answered without our error body.
 */
export async function endsSession(path: string, response: Response): Promise<boolean> {
  if (response.status !== 401 || !path.startsWith('/v1/')) return false;
  const body = ApiErrorSchema.safeParse(await response.json().catch(() => null));
  if (body.success) return body.data.error.code === SESSION_GONE;
  return !path.startsWith('/v1/auth/');
}

/**
 * Wraps `fetch` while the app is signed in: an answer that ends the session calls `onEnded` (once per answer; the
 * caller reads the session again before doing anything). The answer itself reaches the screen unchanged. Returns
 * the undo, which puts the browser's `fetch` back.
 */
export function watchSessionEnd(onEnded: () => void, target: Pick<Window, 'fetch'> = window): () => void {
  const original = target.fetch;
  const watched: typeof fetch = async (input, init) => {
    // Called on its window: the browser's `fetch` refuses any other `this` (« Illegal invocation »).
    const response = await original.call(target, input, init);
    if (response.status === 401) {
      void endsSession(pathOf(input), response.clone()).then((ended) => {
        if (ended) onEnded();
      });
    }
    return response;
  };
  target.fetch = watched;
  return () => {
    if (target.fetch === watched) target.fetch = original;
  };
}
