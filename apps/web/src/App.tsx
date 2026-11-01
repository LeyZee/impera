import type { Me } from '@nirvana/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { useCallback, useEffect, useState, type JSX } from 'react';

import { NewPasswordPage } from './auth/NewPasswordPage';
import { SignInPage } from './auth/SignInPage';
import { Unreachable } from './auth/Unreachable';
import { WelcomePage } from './auth/WelcomePage';
import { linkPageOf } from './auth/api';
import { fetchCurrentUser, signOut } from './auth/session';
import { createAppRouter, type RouterContext } from './router';
import { railOf } from './shell/nav';

type Session =
  | { status: 'loading' }
  /** `attempt` counts the failed reads in a row, so the next one waits a little longer. */
  | { status: 'unreachable'; attempt: number }
  | { status: 'signed_out' }
  | { status: 'signed_in'; user: Me };

/**
 * When the app asks again while the server does not answer: quickly at first (a local server still starting), then
 * every 30 s, as the Dashboard does.
 */
const RETRY_MS = [3_000, 10_000, 30_000] as const;

/**
 * Route guard: nothing of the dashboard renders without a session (P0-07a). Only a 401 means « no session »: a server
 * that does not answer says so, and is asked again, instead of sending a signed-in user to the sign-in form.
 */
export function App(): JSX.Element {
  const [session, setSession] = useState<Session>({ status: 'loading' });
  // An invitation link (EQ-10) opens its own page before any session is read, signed in or not: using it opens the
  // member's session in place of the one before.
  const [linkPage, setLinkPage] = useState(() => linkPageOf(window.location.pathname));
  // A sign-out the server did not make: the session stays open, and the page says so instead of doing nothing.
  const [signOutFailed, setSignOutFailed] = useState(false);

  const refresh = useCallback(() => {
    fetchCurrentUser().then(
      (user) => {
        setSession(user === null ? { status: 'signed_out' } : { status: 'signed_in', user });
      },
      () => {
        setSession((before) => ({
          status: 'unreachable',
          attempt: before.status === 'unreachable' ? before.attempt + 1 : 0,
        }));
      },
    );
  }, []);

  const leave = useCallback(() => {
    setSignOutFailed(false);
    signOut().then(refresh, () => {
      setSignOutFailed(true);
    });
  }, [refresh]);

  useEffect(() => {
    if (linkPage === null) refresh();
  }, [linkPage, refresh]);
  useEffect(() => {
    if (session.status !== 'unreachable') return undefined;
    const timer = setTimeout(refresh, RETRY_MS[Math.min(session.attempt, RETRY_MS.length - 1)]);
    return () => {
      clearTimeout(timer);
    };
  }, [session, refresh]);

  if (linkPage !== null) {
    const Page = linkPage === 'invitation' ? WelcomePage : NewPasswordPage;
    return (
      <Page
        onSignedIn={(me) => {
          // The app reads the new session as after a sign-in, and opens on the member's first screen.
          window.history.replaceState(null, '', me === null ? '/' : railOf(me).home);
          setLinkPage(null);
        }}
        onLeave={() => {
          window.history.replaceState(null, '', '/');
          setLinkPage(null);
        }}
      />
    );
  }
  if (session.status === 'loading') {
    // A breathing dot while the session is read: the page is not blank, and says nothing it does not know yet.
    return (
      <main className="nv-aura grid min-h-dvh place-items-center" aria-busy="true">
        <span className="nv-dot nv-dot--live" role="status" aria-label="Chargement de Nirvana" />
      </main>
    );
  }
  if (session.status === 'unreachable') return <Unreachable />;
  if (session.status === 'signed_out') {
    return <SignInPage onSignedIn={refresh} />;
  }
  return (
    <>
      <SignedIn user={session.user} onSignOut={leave} />
      {signOutFailed ? (
        <p className="nv-signout-failed nv-glass nv-glass--thick" role="alert">
          La déconnexion n’a pas abouti : réessaie.
        </p>
      ) : null}
    </>
  );
}

/** The dashboard itself: one router per signed-in user, so a new session starts on a clean state. */
function SignedIn({ user, onSignOut }: RouterContext): JSX.Element {
  const [router] = useState(() => createAppRouter({ user, onSignOut }));
  const [queryClient] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} context={{ user, onSignOut }} />
    </QueryClientProvider>
  );
}
