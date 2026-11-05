import type { Me } from '@impera/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { useCallback, useEffect, useState, type JSX } from 'react';

import { NewPasswordPage } from './auth/NewPasswordPage';
import { SecondFactorPage } from './auth/SecondFactorPage';
import { SignInPage } from './auth/SignInPage';
import { Unreachable } from './auth/Unreachable';
import { WelcomePage } from './auth/WelcomePage';
import { linkPageOf } from './auth/api';
import { readSession, signOut } from './auth/session';
import { forgetDevice } from './pwa/device';
import { keepSession, keptSession } from './pwa/keptSession';
import { listenForNotificationOpens } from './pwa/notificationOpen';
import { isOnline } from './pwa/online';
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
  | { status: 'signed_in'; user: Me }
  /** No network, and the creator's session kept on this device: her app opens on what it kept (CREA-04). */
  | { status: 'offline'; user: Me; attempt: number };

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
    readSession().then(
      (current) => {
        // No session any more (signed out here, revoked or expired elsewhere): the device forgets what it kept.
        if (current.kind === 'signed_out') void forgetDevice();
        // Signed in: the device's subscription is told to the server again, renewed if the server's key changed.
        if (current.kind === 'signed_in') {
          void refreshPushSubscription();
          keepSession(current.user);
        }
        setSession(
          current.kind === 'signed_in'
            ? { status: 'signed_in', user: current.user }
            : { status: current.kind },
        );
      },
      () => {
        setSession((before) => {
          const attempt =
            before.status === 'unreachable' || before.status === 'offline' ? before.attempt + 1 : 0;
          // No network: her kept session opens her app; « Le serveur ne répond pas » only with a network (CREA-04).
          const kept = isOnline() ? null : keptSession();
          if (kept !== null) return { status: 'offline', user: kept, attempt };
          // Back on the network while it was open offline: it stays open, and asks again.
          if (before.status === 'offline') return { ...before, attempt };
          return { status: 'unreachable', attempt };
        });
      },
    );
  }, []);

  const leave = useCallback(() => {
    setSignOutFailed(false);
    // While the session still opens the door: the server forgets this device before the account leaves it.
    turnOffPush()
      .then(signOut)
      .then(refresh, () => {
        setSignOutFailed(true);
      });
  }, [refresh]);

  useEffect(() => {
    if (linkPage === null) refresh();
  }, [linkPage, refresh]);
  useEffect(() => {
    if (session.status !== 'unreachable' && session.status !== 'offline') return undefined;
    const timer = setTimeout(refresh, RETRY_MS[Math.min(session.attempt, RETRY_MS.length - 1)]);
    // The network is back: asked at once, not at the next try.
    addEventListener('online', refresh);
    return () => {
      clearTimeout(timer);
      removeEventListener('online', refresh);
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
    return <SignInPage onSignedIn={refresh} />;
  }
  if (session.status === 'second_factor_required') {
    return <SecondFactorPage onActivated={refresh} onSignOut={leave} />;
  }
  return (
    <>
      {/* The same user kept offline then read again keeps the same app: only another user makes a new one. */}
      <SignedIn key={JSON.stringify(session.user)} user={session.user} onSignOut={leave} />
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
