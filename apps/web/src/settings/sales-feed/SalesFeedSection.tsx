import type { Platform, SalesFeedOverview, SalesFeedStatus } from '@impera/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';

import { CheckPanel } from './CheckPanel';
import { ImportPanel } from './ImportPanel';
import { KeyForm } from './KeyForm';
import { ModelLinks, TeamLink } from './Links';
import {
  connectWebhook,
  disconnect,
  disconnectWebhook,
  fetchFeeds,
  fetchOverview,
  newModelsQuery,
  type FeedResult,
} from './api';
import { platformName, shownOf, type Notice } from './shown';
import { capabilityLabel, dotOf, lineOf, quarantineLine, webhookViewOf } from './view';

import { PasswordPrompt, SignInAgain } from '@/settings/services/PasswordPrompt';
import { isForbidden, isSessionExpired, ReauthRequired, type ShownError } from '@/settings/services/api';
import '@/settings/services/services.css';
import './sales-feed.css';

/** The page refreshes on its own: a key revoked at Reveal turns red without a reload. */
const REFRESH_MS = 30_000;

type Load<T> =
  | { kind: 'loading' }
  | { kind: 'failed'; error: ShownError; isForbidden: boolean }
  | { kind: 'ready'; value: T };

/**
 * Réglages › Ventes (CRM-01, ADR 0050 §§ 3–5): the key of each platform's sales feed, its webhook, the creators to
 * import from it (CRM-07, ADR 0069), the owner's links of its models and its team, and the reliability check (CRM-02,
 * § 8). Nothing on this page ever shows the
 * key, even masked.
 */
export function SalesFeedSection(): JSX.Element {
  const [load, setLoad] = useState<Load<SalesFeedStatus[]>>({ kind: 'loading' });

  const refresh = useCallback(async (): Promise<void> => {
    try {
      setLoad({ kind: 'ready', value: await fetchFeeds() });
    } catch (error) {
      setLoad({ kind: 'failed', error: shownOf(error), isForbidden: isForbidden(error) });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (load.kind !== 'ready') {
    return (
      <section className="sv-page" aria-busy={load.kind === 'loading'}>
        {load.kind === 'failed' ? <Failed load={load} onRetry={() => void refresh()} /> : null}
      </section>
    );
  }
  return (
    <section className="sv-page">
      <p className="sv-lede">
        Les ventes et les remboursements arrivent de la plateforme elle-même, sans session ouverte. La clé est
        vérifiée chez la plateforme puis gardée chiffrée ; elle ne se relit pas, même ici.
      </p>
      {load.value.map((feed) => (
        <FeedPanel key={feed.platform} platform={feed.platform} />
      ))}
    </section>
  );
}

function Failed({
  load,
  onRetry,
}: {
  load: { error: ShownError; isForbidden: boolean };
  onRetry: () => void;
}): JSX.Element {
  return (
    <div className="nv-plate sv-next">
      <p className="sv-lead">
        {load.isForbidden
          ? 'Seul le propriétaire règle la lecture des ventes'
          : load.error.isSessionExpired
            ? 'Ta session a expiré'
            : 'Le serveur ne répond pas'}
      </p>
      <p className="sv-muted">
        {load.isForbidden || load.error.isSessionExpired
          ? load.error.message
          : 'L’état de la lecture des ventes n’a pas pu être lu. Réessaie dans un instant.'}
      </p>
      {load.isForbidden ? null : load.error.isSessionExpired ? (
        <SignInAgain />
      ) : (
        <button type="button" className="nv-btn nv-btn--soft sv-self-start" onClick={onRetry}>
          Réessayer
        </button>
      )}
    </div>
  );
}

/** A sensitive action waiting for the password and the code (ADR 0016, ADR 0046 § 3), run again once confirmed. */
type Pending = 'disconnect' | 'webhook' | 'unwebhook';
const PROMPT_LEADS: Record<Pending, string> = {
  disconnect: 'Pour retirer la clé, confirme ton mot de passe et ton code.',
  webhook: 'Pour inscrire le webhook, confirme ton mot de passe et ton code.',
  unwebhook: 'Pour couper la réception instantanée, confirme ton mot de passe et ton code.',
};

/** What did not happen, before the reason. */
const LEADS: Record<Pending, string> = {
  disconnect: 'La clé n’a pas été retirée.',
  webhook: 'Le webhook n’a pas été inscrit.',
  unwebhook: 'La réception instantanée n’a pas été coupée.',
};

function FeedPanel({ platform }: { platform: Platform }): JSX.Element {
  const name = platformName(platform);
  const [load, setLoad] = useState<Load<SalesFeedOverview>>({ kind: 'loading' });
  const [now, setNow] = useState(() => new Date());
  const [isKeyOpen, setIsKeyOpen] = useState(false);
  const [isConfirmingRemove, setIsConfirmingRemove] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState<Pending | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  /** Only the latest refresh may land: an older answer arriving late would show a stale state. */
  const latest = useRef(0);
  const client = useQueryClient();

  const refresh = useCallback(async (): Promise<void> => {
    latest.current += 1;
    const ticket = latest.current;
    try {
      const overview = await fetchOverview(platform);
      if (ticket !== latest.current) return;
      setLoad({ kind: 'ready', value: overview });
      setNow(new Date());
    } catch (error) {
      if (ticket !== latest.current) return;
      const shown = shownOf(error);
      setLoad((current) =>
        current.kind === 'ready'
          ? current
          : { kind: 'failed', error: shown, isForbidden: isForbidden(error) },
      );
      if (isSessionExpired(error)) setNotice({ ...shown, tone: 'error' });
    }
  }, [platform]);

  /** A change of ours lands at once; the lists come with the next read. */
  const land = useCallback((overview: SalesFeedOverview): void => {
    latest.current += 1;
    setLoad({ kind: 'ready', value: overview });
    setNow(new Date());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Each read of the panel after the first (an import, a model set aside or linked, the refresh) reads the tab's count
  // again with it; the first one comes with the tab's own read (Bilan, #550).
  const overview = load.kind === 'ready' ? load.value : null;
  const seenOverview = useRef(false);
  useEffect(() => {
    if (overview === null) return;
    if (seenOverview.current) void client.invalidateQueries({ queryKey: newModelsQuery.queryKey });
    seenOverview.current = true;
  }, [overview, client]);

  const isIdle = !isKeyOpen && !isConfirmingRemove && pending === null && busy === null;
  useEffect(() => {
    if (!isIdle) return undefined;
    const timer = window.setInterval(() => void refresh(), REFRESH_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [refresh, isIdle]);

  /** Runs a sensitive action; a sign-in too old for it asks for the password and the code, then runs it again. */
  const run = (action: Pending): void => {
    setNotice(null);
    setBusy(action);
    const call: Promise<FeedResult | SalesFeedStatus> =
      action === 'disconnect'
        ? disconnect(platform)
        : action === 'webhook'
          ? connectWebhook(platform)
          : disconnectWebhook(platform);
    call
      .then(
        (result) => {
          if ('ok' in result && !result.ok) {
            setNotice({
              message: `${LEADS[action]} ${result.refusal.message}`,
              isSessionExpired: false,
              tone: 'error',
            });
          }
          return refresh();
        },
        (error: unknown) => {
          if (error instanceof ReauthRequired) {
            setPending(action);
            return;
          }
          setNotice({ ...shownOf(error, LEADS[action]), tone: 'error' });
        },
      )
      .finally(() => {
        setBusy(null);
      });
  };

  if (load.kind !== 'ready') {
    return (
      <div className="sf-feed" aria-busy={load.kind === 'loading'}>
        {load.kind === 'failed' ? <Failed load={load} onRetry={() => void refresh()} /> : null}
      </div>
    );
  }

  const { status, models, accounts, chatters, listError, candidates, dismissed } = load.value;
  const isConnected = status.state !== 'not_connected';
  const webhook = webhookViewOf(status.webhook, now);
  const canWebhook = status.state === 'connected';

  return (
    <div className="sf-feed">
      <div className="nv-plate sf-key">
        <div className="sf-head">
          <span className="sv-dot sv-dot--big" data-dot={dotOf(status)} />
          <div className="sf-head__text">
            <h2 className="sv-lead">
              {name} <small className="sf-sub">API CRM</small>
            </h2>
            <p className="sv-muted sf-line" data-state={status.state} aria-live="polite">
              {lineOf(status, now)}
            </p>
            {isConnected && status.capabilities.length > 0 ? (
              <ul className="sf-caps" aria-label="Accès de la clé">
                {status.capabilities.map((capability) => (
                  <li key={capability} className="nv-tag nv-tag--declared">
                    {capabilityLabel(capability)}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          {isKeyOpen ? null : (
            <div className="sf-head__act">
              {status.state === 'not_connected' ? (
                <button
                  type="button"
                  className="nv-btn nv-btn--neon"
                  onClick={() => {
                    setIsKeyOpen(true);
                  }}
                >
                  Connecter la clé
                </button>
              ) : status.state === 'needs_reconnect' ? (
                <button
                  type="button"
                  className="nv-btn nv-btn--neon"
                  onClick={() => {
                    setIsKeyOpen(true);
                  }}
                >
                  Reconnecter la clé
                </button>
              ) : (
                <button
                  type="button"
                  className="nv-btn nv-btn--soft nv-btn--sm"
                  onClick={() => {
                    setIsConfirmingRemove(false);
                    setIsKeyOpen(true);
                  }}
                >
                  Remplacer la clé
                </button>
              )}
              {isConnected ? (
                <button
                  type="button"
                  className="nv-btn nv-btn--plain nv-btn--sm"
                  disabled={busy !== null}
                  onClick={() => {
                    setPending(null);
                    setIsConfirmingRemove(true);
                  }}
                >
                  Retirer
                </button>
              ) : null}
            </div>
          )}
        </div>

        {isKeyOpen ? (
          <KeyForm
            platform={platform}
            isReplace={isConnected}
            onSaved={(saved) => {
              setIsKeyOpen(false);
              setNotice(null);
              setLoad((current) =>
                current.kind === 'ready'
                  ? { kind: 'ready', value: { ...current.value, status: saved } }
                  : current,
              );
              void refresh();
            }}
            onCancel={() => {
              setIsKeyOpen(false);
            }}
          />
        ) : null}

        {status.quarantined > 0 ? <p className="sf-warn">{quarantineLine(status.quarantined)}</p> : null}

        {isConfirmingRemove ? (
          <div className="nv-confirm sv-confirm">
            <p>
              <b>Retirer la clé de {name} ?</b> Les ventes ne remontent plus et la réception instantanée
              s’arrête aussi. Les ventes déjà enregistrées restent. Chez {name}, la clé reste valide tant que
              tu ne la supprimes pas.
            </p>
            {/* As every confirmation of Réglages: « Garder » first, the destructive action on the right. */}
            <div className="nv-confirm__actions">
              <button
                type="button"
                className="nv-btn nv-btn--soft nv-btn--sm"
                onClick={() => {
                  setIsConfirmingRemove(false);
                }}
              >
                Garder
              </button>
              <button
                type="button"
                className="nv-btn nv-btn--soft nv-btn--destructive nv-btn--sm"
                onClick={() => {
                  setIsConfirmingRemove(false);
                  run('disconnect');
                }}
              >
                Retirer la clé
              </button>
            </div>
          </div>
        ) : null}

        {canWebhook ? (
          <div className="sf-hook" data-kind={webhook.kind}>
            <div className="sf-hook__text">
              <h3 className="sf-hook__title">Réception instantanée</h3>
              <p className="sv-muted">
                {webhook.kind === 'none'
                  ? `Sans webhook, une vente arrive dans la minute. Avec, ${name} la signale en quelques secondes.`
                  : webhook.line}
              </p>
              {webhook.kind === 'rejected' ? <p className="sf-warn">{webhook.warning}</p> : null}
            </div>
            <div className="sf-hook__act">
              {webhook.kind === 'active' ? null : (
                <button
                  type="button"
                  className={
                    webhook.kind === 'rejected'
                      ? 'nv-btn nv-btn--neon nv-btn--sm'
                      : 'nv-btn nv-btn--soft nv-btn--sm'
                  }
                  disabled={busy !== null}
                  onClick={() => {
                    setPending(null);
                    run('webhook');
                  }}
                >
                  {busy === 'webhook' ? 'Inscription…' : webhook.kind === 'none' ? 'Activer' : 'Réinscrire'}
                </button>
              )}
              {webhook.kind === 'none' ? null : (
                <button
                  type="button"
                  className="nv-btn nv-btn--plain nv-btn--sm"
                  disabled={busy !== null}
                  onClick={() => {
                    setPending(null);
                    run('unwebhook');
                  }}
                >
                  {busy === 'unwebhook' ? 'Coupure…' : 'Couper'}
                </button>
              )}
            </div>
          </div>
        ) : null}

        {pending === null ? null : (
          <div className="nv-confirm sv-confirm">
            <PasswordPrompt
              lead={PROMPT_LEADS[pending]}
              onConfirmed={() => {
                const action = pending;
                setPending(null);
                run(action);
              }}
              onCancel={() => {
                setPending(null);
              }}
            />
          </div>
        )}

        {notice === null ? null : (
          <>
            <p className="sv-notice" role="alert" data-tone={notice.tone}>
              {notice.message}
            </p>
            {notice.isSessionExpired ? <SignInAgain /> : null}
          </>
        )}
      </div>

      {isConnected ? (
        <>
          {listError === null ? null : (
            <p className="sf-warn sf-list-error">
              {name} n’a pas renvoyé la liste à jour de ses modèles et de son équipe. Les liens déjà posés
              restent ; la page réessaie toute seule.
            </p>
          )}
          {/* Her creators to add first (CRM-07): what the links below are made of. */}
          <ImportPanel platform={platform} candidates={candidates} dismissed={dismissed} onChanged={land} />
          <ModelLinks platform={platform} models={models} accounts={accounts} onChanged={land} />
          <TeamLink platform={platform} />
          {/* The check reads the platform's statistics: only while the key is read (CRM-02). */}
          {status.state === 'connected' ? (
            <CheckPanel platform={platform} models={models} chatters={chatters} />
          ) : null}
        </>
      ) : null}
    </div>
  );
}
