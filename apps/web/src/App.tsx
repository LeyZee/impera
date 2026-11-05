import type { Me } from '@impera/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';

import { NewPasswordPage } from './auth/NewPasswordPage';
import { SecondFactorPage } from './auth/SecondFactorPage';
import { SignInPage } from './auth/SignInPage';
import { Unreachable } from './auth/Unreachable';
import { WelcomePage } from './auth/WelcomePage';
import { linkPageOf } from './auth/api';
import { forgetChosenPassword } from './auth/chosen-password';
import { readSession, signOut } from './auth/session';
import { watchSessionEnd } from './auth/session-end';
import { forgetDevice } from './pwa/device';
import { listenForNotificationOpens } from './pwa/notificationOpen';
import { refreshPushSubscription, turnOffPush } from './pwa/push';
import { createAppRouter, type RouterContext } from './router';
import { railOf } from './shell/nav';

type Session =
  | { status: 'loading' }
  /** `attempt` counts the failed reads in a row, so the next one waits a little longer. */
  | { status: 'unreachable'; attempt: number }
  | { status: 'signed_out' }
  /** Signed in with the password, the code not active yet: the activation is the only screen (ADR 0046). */
  | { status: 'second_factor_required' }
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
  // The session ended while the app was open (closed elsewhere, past its 12 h or 7 days): the sign-in page says so.
  const [hasEnded, setHasEnded] = useState(false);
  const isRechecking = useRef(false);
  // A sign-out she asked for: a screen's 401 in flight meanwhile is not a session that ended (relecture #538).
  const isLeaving = useRef(false);

  const refresh = useCallback(() => {
    readSession().then(
      (current) => {
        // No session any more (signed out here, revoked or expired elsewhere): the device forgets what it kept.
        if (current.kind === 'signed_out') void forgetDevice();
        // Signed in: the device's subscription is told to the server again, renewed if the server's key changed.
        if (current.kind === 'signed_in') {
          void refreshPushSubscription();
          setHasEnded(false);
          isLeaving.current = false;
          // Signed in by now: a password kept for the code's activation has nothing left to do.
          forgetChosenPassword();
        }
        setSession(
          current.kind === 'signed_in'
            ? { status: 'signed_in', user: current.user }
            : { status: current.kind },
        );
      },
      () => {
        setSession((before) => ({
          status: 'unreachable',
          attempt: before.status === 'unreachable' ? before.attempt + 1 : 0,
        }));
      },
    );
  }, []);

  /**
   * A 401 on a screen, or the app shown again after a while (recette 05/11, SEC-01): the session is read again, and
   * only a server that says « no session » leads to the sign-in page. A read that fails (offline, a server down)
   * changes nothing: the screens say it their own way, and the agenda kept offline stays readable.
   */
  const recheck = useCallback(() => {
    if (isRechecking.current || isLeaving.current) return;
    isRechecking.current = true;
    readSession()
      .then(
        (current) => {
          if (current.kind === 'signed_in' || isLeaving.current) return;
          void forgetDevice();
          forgetChosenPassword();
          setHasEnded(true);
          setSession({ status: current.kind });
        },
        () => undefined,
      )
      .finally(() => {
        isRechecking.current = false;
      });
  }, []);

  const leave = useCallback(() => {
    setSignOutFailed(false);
    setHasEnded(false);
    isLeaving.current = true;
    // While the session still opens the door: the server forgets this device before the account leaves it.
    turnOffPush()
      .then(signOut)
      .then(refresh, () => {
        // Still signed in: a 401 from now on is a session that ended again.
        isLeaving.current = false;
        setSignOutFailed(true);
      });
  }, [refresh]);

  useEffect(() => {
    if (linkPage === null) refresh();
  }, [linkPage, refresh]);
  // Only while signed in: the sign-in pages expect their own 401s (a wrong password), and nothing is left to end.
  const isSignedIn = session.status === 'signed_in';
  useEffect(() => {
    if (!isSignedIn) return undefined;
    const unwatch = watchSessionEnd(recheck);
    const onShown = () => {
      if (document.visibilityState === 'visible') recheck();
    };
    document.addEventListener('visibilitychange', onShown);
    return () => {
      unwatch();
      document.removeEventListener('visibilitychange', onShown);
    };
  }, [isSignedIn, recheck]);
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
        <span className="nv-dot nv-dot--live" role="status" aria-label="Chargement d’Impera" />
      </main>
    );
  }
  if (session.status === 'unreachable') return <Unreachable />;
  if (session.status === 'signed_out') {
    return (
      <SignInPage
        onSignedIn={refresh}
        notice={hasEnded ? 'Ta session a pris fin. Reconnecte-toi pour continuer.' : null}
      />
    );
  }
  if (session.status === 'second_factor_required') {
    return <SecondFactorPage onActivated={refresh} onSignOut={leave} />;
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
  // A touched notification opens its page here, without a reload (public/sw.js).
  useEffect(
    () =>
      listenForNotificationOpens((path) => {
        void router.navigate({ href: path });
      }),
    [router],
  );
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} context={{ user, onSignOut }} />
    </QueryClientProvider>
  );
}
