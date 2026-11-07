import type { JSX } from 'react';

import { PublicBrand } from './PublicBrand';

import { useOnline } from '@/pwa/online';

/**
 * The server does not answer before any session is known: not a sign-in matter, so no sign-in form. Amber, as on the
 * Dashboard: a warning, the red stays the urgencies'. The app asks again on its own. Without a network, it says so:
 * the server is not the one silent (CREA-04). A server that answers with an error of its own says so (EXT-12).
 */
export function Unreachable({ answered = false }: { readonly answered?: boolean }): JSX.Element {
  const offline = !useOnline();
  return (
    <main className="nv-aura grid min-h-dvh place-items-center px-4">
      {/* The name first, as on every public page (NAV-16): this is Impera speaking. */}
      <section className="nv-plate nv-plate--pad flex w-full max-w-sm flex-col gap-5">
        <PublicBrand page={offline ? 'Hors ligne' : answered ? 'Erreur du serveur' : 'Serveur injoignable'} />
        <div className="flex items-start gap-4" role="status">
          <span className="nv-orb nv-tone--warn shrink-0" aria-hidden="true" />
          <div className="flex flex-col gap-1">
            {offline ? (
              <>
                <h1 className="text-xl font-semibold">
                  Pas de <em className="text-[var(--nv-warning)] not-italic">réseau</em>
                </h1>
                <p className="text-sm text-[var(--nv-ink-muted)]">
                  Impera s’ouvre dès que le réseau revient.
                </p>
              </>
            ) : answered ? (
              <>
                <h1 className="text-xl font-semibold">
                  Impera a <em className="text-[var(--nv-warning)] not-italic">un problème</em>
                </h1>
                <p className="text-sm text-[var(--nv-ink-muted)]">
                  Le serveur répond, mais par une erreur. Impera réessaie tout seul et revient dès que c’est
                  réparé.
                </p>
              </>
            ) : (
              <>
                <h1 className="text-xl font-semibold">
                  Le serveur <em className="text-[var(--nv-warning)] not-italic">ne répond pas</em>
                </h1>
                <p className="text-sm text-[var(--nv-ink-muted)]">
                  Impera réessaie tout seul et revient dès qu’il répond.
                </p>
              </>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
