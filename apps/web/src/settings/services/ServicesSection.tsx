import type { ProviderNextAction, ProviderOverview, ProviderStatus } from '@nirvana/contracts';
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';

import { ConnectSheet } from './ConnectSheet';
import { PasswordPrompt, SignInAgain } from './PasswordPrompt';
import {
  disconnect,
  fetchOverview,
  isForbidden,
  isSessionExpired,
  ReauthRequired,
  showError,
  verifyNow,
  type ShownError,
} from './api';
import { GUIDES, isDashboardProvider, type DashboardProvider } from './guide';
import { checkedAgo, dotOf, dotOfNext, leadOf, shortStateOf, verifyNotice } from './view';
import './services.css';

/** The list refreshes on its own: a key revoked while the page is open turns red without a reload. */
const REFRESH_MS = 30_000;

type Load =
  | { kind: 'loading' }
  | { kind: 'failed'; error: ShownError; isForbidden: boolean }
  | { kind: 'ready'; overview: ProviderOverview };
type Sheet = { provider: DashboardProvider; isReplace: boolean } | null;
/** `warning`: nothing failed in Nirvana, the provider did not answer and the last verification stands. */
type Notice = ShownError & { tone: 'error' | 'warning' };

/**
 * Réglages › Modèles IA › Services (fiche P3-03, ADR 0016): what to do now, then one line per service. Connecting
 * happens in a sheet; nothing on this page ever shows a key.
 */
export function ServicesSection(): JSX.Element {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [sheet, setSheet] = useState<Sheet>(null);
  const [menu, setMenu] = useState<DashboardProvider | null>(null);
  const [confirming, setConfirming] = useState<DashboardProvider | null>(null);
  /** A removal waiting for the password (ADR 0016). */
  const [reauthFor, setReauthFor] = useState<DashboardProvider | null>(null);
  const [verifying, setVerifying] = useState<DashboardProvider | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [notice, setNotice] = useState<Notice | null>(null);
  /** Only the latest refresh may land: an older answer arriving late would show a stale state. */
  const latest = useRef(0);
  /**
   * One password prompt on the page at a time: a sheet carries its own, so a row's prompt never shows while a
   * sheet is open. Read from a ref because a removal's answer can arrive after a sheet was opened.
   */
  const isSheetOpen = useRef(false);
  useEffect(() => {
    isSheetOpen.current = sheet !== null;
  }, [sheet]);

  const refresh = useCallback(async (): Promise<void> => {
    latest.current += 1;
    const ticket = latest.current;
    try {
      const overview = await fetchOverview();
      if (ticket !== latest.current) return;
      setLoad({ kind: 'ready', overview });
      setNow(new Date());
    } catch (error) {
      if (ticket !== latest.current) return;
      const shown = showError(error);
      setLoad((current) =>
        current.kind === 'ready'
          ? current
          : { kind: 'failed', error: shown, isForbidden: isForbidden(error) },
      );
      // The list already on screen stays, but an expired session must not go unnoticed.
      if (isSessionExpired(error)) setNotice({ ...shown, tone: 'error' });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (sheet !== null || menu !== null || confirming !== null || reauthFor !== null) return undefined;
    const timer = window.setInterval(() => void refresh(), REFRESH_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [refresh, sheet, menu, confirming, reauthFor]);

  useEffect(() => {
    if (menu === null) return undefined;
    const close = (): void => {
      setMenu(null);
    };
    window.addEventListener('click', close);
    return () => {
      window.removeEventListener('click', close);
    };
  }, [menu]);

  /** Removes a key; a sign-in too old for it (ADR 0016) asks for the password, then removes it. */
  const remove = (provider: DashboardProvider): void => {
    disconnect(provider).then(
      () => refresh(),
      (error: unknown) => {
        if (error instanceof ReauthRequired && !isSheetOpen.current) {
          setReauthFor(provider);
          return;
        }
        const lead = `${GUIDES[provider].name} n’a pas été déconnecté.`;
        setNotice({
          ...(error instanceof ReauthRequired
            ? { message: `${lead} Réessaie pour confirmer ton mot de passe.`, isSessionExpired: false }
            : showError(error, lead)),
          tone: 'error',
        });
      },
    );
  };

  const open = (provider: DashboardProvider, isReplace: boolean): void => {
    setMenu(null);
    setConfirming(null);
    setReauthFor(null);
    setSheet({ provider, isReplace });
  };

  const finishSheet = useCallback(
    (next: DashboardProvider | null) => {
      setSheet(next === null ? null : { provider: next, isReplace: false });
      void refresh();
    },
    [refresh],
  );

  if (load.kind !== 'ready') {
    return (
      <section className="sv-page" aria-busy={load.kind === 'loading'}>
        {load.kind === 'failed' ? (
          <div className="nv-plate sv-next">
            <p className="sv-lead">
              {load.isForbidden
                ? 'Seul le propriétaire règle les modèles IA'
                : load.error.isSessionExpired
                  ? 'Ta session a expiré'
                  : 'Le serveur ne répond pas'}
            </p>
            <p className="sv-muted">
              {load.isForbidden || load.error.isSessionExpired
                ? load.error.message
                : 'L’état des clés n’a pas pu être lu. Réessaie dans un instant.'}
            </p>
            {load.isForbidden ? null : load.error.isSessionExpired ? (
              <SignInAgain />
            ) : (
              <button
                type="button"
                className="nv-btn nv-btn--soft sv-self-start"
                onClick={() => void refresh()}
              >
                Réessayer
              </button>
            )}
          </div>
        ) : null}
      </section>
    );
  }

  const { services, next } = load.overview;
  const lines = services.filter((s): s is ProviderStatus & { provider: DashboardProvider } =>
    isDashboardProvider(s.provider),
  );
  const nextProvider = next.kind === 'all_set' ? null : next.provider;
  const nextDot = dotOfNext(next);

  return (
    <section className="sv-page">
      <p className="sv-lede">
        Chaque service a sa clé, vérifiée chez son fournisseur puis gardée chiffrée. Aucune ne se relit, même
        ici.
      </p>

      <div className="nv-plate sv-next" aria-live="polite">
        <div className="sv-next__head">
          <span className="sv-dot sv-dot--big" data-dot={nextDot} />
          <div className="sv-next__text">
            <p className="sv-lead">{leadOf(next, services)}</p>
            <p className="sv-muted">{next.detail}</p>
          </div>
          <NextButton next={next} onOpen={open} />
        </div>
      </div>

      <div className="nv-plate sv-list">
        {lines.map((status, index) => {
          const provider = status.provider;
          const guide = GUIDES[provider];
          const isVerifying = verifying === provider;
          const isNext = nextProvider === provider;
          const ago = checkedAgo(status.verifiedAt, now);
          const isFromEnvironment = status.source === 'environment';
          // The service the top explains says it in two words here: the full sentence is just above.
          const short = isNext ? shortStateOf(status) : null;
          const line = isVerifying
            ? 'Vérification…'
            : isFromEnvironment
              ? 'Clé lue depuis l’environnement'
              : (short ??
                (status.state === 'connected' && ago !== null
                  ? `${status.message} · ${ago}`
                  : status.message));
          const isSaved = status.source === 'dashboard';
          return (
            <div className="sv-row" key={provider} style={{ animationDelay: `${String(index * 40)}ms` }}>
              <span className="sv-dot" data-dot={dotOf(status, isVerifying)} />
              <div className="sv-row__name">
                {guide.name}
                <small>{guide.tag}</small>
                {/* Only outside production: a quiet chip, not a sentence about the server (REG-08). */}
                {isFromEnvironment ? <span className="nv-tag sv-dev">Mode développement</span> : null}
              </div>
              <div className="sv-row__act">
                {isSaved ? (
                  <button
                    type="button"
                    id={`sv-more-${provider}`}
                    className="sv-more"
                    aria-label={`Options de ${guide.name}`}
                    aria-haspopup="menu"
                    aria-expanded={menu === provider}
                    onClick={(event) => {
                      event.stopPropagation();
                      setConfirming(null);
                      setMenu(menu === provider ? null : provider);
                    }}
                  >
                    ⋯
                  </button>
                ) : isNext ? null : (
                  <button
                    type="button"
                    className="nv-btn nv-btn--soft nv-btn--sm"
                    onClick={() => {
                      open(provider, false);
                    }}
                  >
                    Connecter
                  </button>
                )}
              </div>
              <p className="sv-row__line" data-state={status.state}>
                {line}
              </p>
              {menu === provider ? (
                <RowMenu
                  provider={provider}
                  onClose={() => {
                    setMenu(null);
                  }}
                  onVerify={() => {
                    setMenu(null);
                    setNotice(null);
                    setVerifying(provider);
                    verifyNow(provider)
                      .then(
                        (after) => {
                          const unanswered = verifyNotice(provider, status, after);
                          if (unanswered !== null)
                            setNotice({ message: unanswered, isSessionExpired: false, tone: 'warning' });
                          return refresh();
                        },
                        (error: unknown) => {
                          setNotice({
                            ...showError(error, `La vérification de ${guide.name} n’a pas abouti.`),
                            tone: 'error',
                          });
                        },
                      )
                      .finally(() => {
                        setVerifying(null);
                      });
                  }}
                  onReplace={() => {
                    open(provider, true);
                  }}
                  onDisconnect={() => {
                    setMenu(null);
                    setConfirming(provider);
                  }}
                />
              ) : null}
              {reauthFor === provider && sheet === null ? (
                <div className="nv-confirm sv-confirm">
                  <PasswordPrompt
                    lead={`Pour déconnecter ${guide.name}, confirme ton mot de passe.`}
                    onConfirmed={() => {
                      setReauthFor(null);
                      remove(provider);
                    }}
                    onCancel={() => {
                      setReauthFor(null);
                    }}
                  />
                </div>
              ) : null}
              {confirming === provider ? (
                <div className="nv-confirm sv-confirm">
                  <p>
                    <b>Déconnecter {guide.name} ?</b> {guide.offConsequence} La clé est effacée de Nirvana.
                    Chez {guide.vendor}, elle reste valide tant que tu ne la supprimes pas.
                  </p>
                  {/* As every confirmation of Réglages: « Garder » first, the destructive action on the right. */}
                  <div className="nv-confirm__actions">
                    <button
                      type="button"
                      className="nv-btn nv-btn--soft nv-btn--sm"
                      onClick={() => {
                        setConfirming(null);
                      }}
                    >
                      Garder
                    </button>
                    <button
                      type="button"
                      className="nv-btn nv-btn--soft nv-btn--destructive nv-btn--sm"
                      onClick={() => {
                        setConfirming(null);
                        setNotice(null);
                        remove(provider);
                      }}
                    >
                      Déconnecter
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {notice === null ? null : (
        <>
          <p className="sv-notice" role="alert" data-tone={notice.tone}>
            {notice.message}
          </p>
          {notice.isSessionExpired ? <SignInAgain /> : null}
        </>
      )}

      {sheet === null ? null : (
        <ConnectSheet
          key={sheet.provider}
          provider={sheet.provider}
          isReplace={sheet.isReplace}
          services={services}
          onChanged={() => void refresh()}
          onFinish={finishSheet}
        />
      )}
    </section>
  );
}

/**
 * The ⋯ menu of a saved service. Focus goes to its first item; arrows move, Escape and Tab close it and give focus
 * back to the ⋯ button.
 */
function RowMenu({
  provider,
  onClose,
  onVerify,
  onReplace,
  onDisconnect,
}: {
  provider: DashboardProvider;
  onClose: () => void;
  onVerify: () => void;
  onReplace: () => void;
  onDisconnect: () => void;
}): JSX.Element {
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    menu.current?.querySelector<HTMLElement>('[role=menuitem]')?.focus();
  }, []);
  const backToButton = (): void => {
    onClose();
    document.getElementById(`sv-more-${provider}`)?.focus();
  };
  return (
    <div
      ref={menu}
      className="sv-menu nv-glass nv-glass--thick"
      role="menu"
      onKeyDown={(event) => {
        if (event.key === 'Escape' || event.key === 'Tab') {
          event.preventDefault();
          event.stopPropagation();
          backToButton();
          return;
        }
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        event.preventDefault();
        const items = [...(menu.current?.querySelectorAll<HTMLElement>('[role=menuitem]') ?? [])];
        const at = items.findIndex((item) => item === document.activeElement);
        const step = event.key === 'ArrowDown' ? 1 : -1;
        items[(at + step + items.length) % items.length]?.focus();
      }}
    >
      <button type="button" role="menuitem" onClick={onVerify}>
        Vérifier maintenant
      </button>
      <button type="button" role="menuitem" onClick={onReplace}>
        Remplacer la clé
      </button>
      <button type="button" role="menuitem" className="sv-danger" onClick={onDisconnect}>
        Déconnecter
      </button>
    </div>
  );
}

function NextButton({
  next,
  onOpen,
}: {
  next: ProviderNextAction;
  onOpen: (provider: DashboardProvider, isReplace: boolean) => void;
}): JSX.Element | null {
  if (next.kind === 'all_set' || !isDashboardProvider(next.provider)) return null;
  const provider = next.provider;
  const guide = GUIDES[provider];
  if (next.kind === 'top_up') {
    return guide.topUpUrl === null ? null : (
      <a className="nv-btn nv-btn--neon" href={guide.topUpUrl} target="_blank" rel="noreferrer">
        Recharger ↗
      </a>
    );
  }
  return (
    <button
      type="button"
      className="nv-btn nv-btn--neon"
      onClick={() => {
        onOpen(provider, next.kind === 'replace_key');
      }}
    >
      {next.kind === 'connect' ? `Connecter ${guide.name}` : 'Remplacer la clé'}
    </button>
  );
}
