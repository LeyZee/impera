import type { TelegramLinkCode, TelegramPrivateLink } from '@impera/contracts';
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';

import { ReauthRequired } from '../services/api';

import { Reauth } from './Reauth';
import {
  LinkRateLimited,
  LinkUnavailable,
  fetchPrivateLink,
  requestLinkCode,
  unlinkPrivateChat,
} from './api';
import { hourLabel } from './model';
import './telegram.css';
import './private-chat.css';

/** While a code waits, the link is read again this often: the bot tells the CRM nothing (SEC-05 lot 2). */
const POLL_MS = 3_000;
const OFFLINE = 'Le serveur ne répond pas. Réessaie dans un instant.';

type Load =
  | { kind: 'loading' }
  | { kind: 'failed' }
  | { kind: 'unavailable' }
  | { kind: 'ready'; link: TelegramPrivateLink };

/** What waits for the password and the code before it runs again. */
type Pending = 'code' | 'unlink' | null;

const two = (n: number): string => String(n).padStart(2, '0');

/** « 06/11/2026 », in her browser's time like the rest of the page. */
export function linkedDay(iso: string): string {
  const at = new Date(iso);
  return `${two(at.getDate())}/${two(at.getMonth() + 1)}/${String(at.getFullYear())}`;
}

/**
 * « Mon chat privé » (SEC-05 lot 2, ADR 0068 § 4): the account's own private chat with the agency's bot, where the
 * « mot de passe oublié » link will go and nothing else. A one-time code links it; the bot tells the CRM nothing, so
 * the link is read again while the code waits. Nothing here shows a chat's id.
 */
export function PrivateChat({
  owner,
  onAddBot,
  frame,
}: {
  /** The owner adds the bots: with none, he is sent to them; anyone else asks him. */
  owner: boolean;
  onAddBot?: () => void;
  /** The page's own frame around the block; nothing at all is shown where the server does not serve it. */
  frame: (body: JSX.Element) => JSX.Element;
}): JSX.Element | null {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [code, setCode] = useState<TelegramLinkCode | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [noBot, setNoBot] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const latest = useRef(0);
  /** Whether the last answer was linked: a change to linked while a code waits is what the bot did. */
  const wasLinked = useRef<boolean | null>(null);

  const read = useCallback(async (): Promise<void> => {
    latest.current += 1;
    const ticket = latest.current;
    try {
      const link = await fetchPrivateLink();
      if (ticket !== latest.current) return;
      // Linked since the last answer: the code goes; the state line says it, once.
      if (link.linked && wasLinked.current === false) setCode(null);
      wasLinked.current = link.linked;
      setLoad({ kind: 'ready', link });
    } catch (reason) {
      if (ticket !== latest.current) return;
      if (reason instanceof LinkUnavailable) {
        setLoad({ kind: 'unavailable' });
        return;
      }
      setLoad((current) => (current.kind === 'ready' ? current : { kind: 'failed' }));
    }
  }, []);

  useEffect(() => {
    void read();
  }, [read]);

  const expired = code !== null && Date.parse(code.expiresAt) <= now;
  const waiting = code !== null && !expired;

  // Read again while the code waits, and when she comes back from Telegram.
  useEffect(() => {
    if (!waiting) return undefined;
    const timer = window.setInterval(() => {
      setNow(Date.now());
      void read();
    }, POLL_MS);
    const back = (): void => {
      if (document.visibilityState === 'visible') void read();
    };
    document.addEventListener('visibilitychange', back);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', back);
    };
  }, [waiting, read]);

  const failed = (reason: unknown, then: Pending): void => {
    if (reason instanceof ReauthRequired) {
      setPending(then);
      return;
    }
    if (reason instanceof LinkRateLimited) {
      setError('Trop de codes demandés d’un coup. Réessaie dans une minute.');
      return;
    }
    setError(OFFLINE);
  };

  const askCode = (): void => {
    setBusy(true);
    setError(null);
    setNotice(null);
    requestLinkCode()
      .then((answer) => {
        if (answer === 'no_bot') {
          setNoBot(true);
          return;
        }
        setNoBot(false);
        setCode(answer);
        setNow(Date.now());
      })
      .catch((reason: unknown) => {
        failed(reason, 'code');
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const unlink = (): void => {
    setBusy(true);
    setError(null);
    setNotice(null);
    unlinkPrivateChat()
      .then((link) => {
        setConfirming(false);
        setCode(null);
        wasLinked.current = link.linked;
        setLoad({ kind: 'ready', link });
        setNotice('Ce chat est délié : il ne recevra plus rien d’Impera.');
      })
      .catch((reason: unknown) => {
        failed(reason, 'unlink');
      })
      .finally(() => {
        setBusy(false);
      });
  };

  if (load.kind === 'unavailable') return null;
  if (load.kind === 'loading') {
    return frame(<div className="pc-skeleton" aria-busy="true" aria-label="Chargement de ton chat privé" />);
  }
  if (load.kind === 'failed') {
    return frame(
      <div className="pc-chat">
        <p className="pc-lead">Ton chat privé n’a pas pu être lu. {OFFLINE}</p>
        <button type="button" className="nv-btn nv-btn--soft nv-btn--sm pc-start" onClick={() => void read()}>
          Réessayer
        </button>
      </div>,
    );
  }

  const { link } = load;
  const reauth =
    pending === null ? null : (
      <Reauth
        hint={
          pending === 'code'
            ? 'Pour lier ton Telegram, confirme ton mot de passe et ton code.'
            : 'Pour délier ton Telegram, confirme ton mot de passe et ton code.'
        }
        onConfirmed={() => {
          const then = pending;
          setPending(null);
          if (then === 'code') askCode();
          else unlink();
        }}
        onCancel={() => {
          setPending(null);
        }}
      />
    );
  const said = (
    <>
      {notice === null ? null : (
        <p className="pc-notice" role="status">
          {notice}
        </p>
      )}
      {error === null ? null : (
        <p className="pc-error" role="alert">
          {error}
        </p>
      )}
    </>
  );

  if (link.linked) {
    return frame(
      <div className="pc-chat">
        <div className="pc-state">
          <span className="pc-state__dot" aria-hidden="true">
            <span className="tg-state-dot" data-tone="ok" />
          </span>
          <p className="pc-state__line">
            Relié à <b>@{link.botUsername}</b>
            {link.linkedAt === null ? null : (
              <>
                {' '}
                depuis le <span className="nv-num">{linkedDay(link.linkedAt)}</span>
              </>
            )}
          </p>
        </div>
        <p className="pc-lead">
          Si tu oublies ton mot de passe, le lien pour en choisir un nouveau arrive dans ce chat. Il n’y
          reçoit rien d’autre.
        </p>
        {said}
        {reauth ??
          (confirming ? (
            <div className="pc-confirm" role="group" aria-label="Délier ton Telegram">
              <p className="pc-lead">
                Délier ce chat ? Tu ne pourras plus y recevoir le lien « mot de passe oublié ».
              </p>
              <div className="pc-actions">
                <button
                  type="button"
                  className="nv-btn nv-btn--soft nv-btn--sm"
                  disabled={busy}
                  onClick={() => {
                    setConfirming(false);
                  }}
                >
                  Annuler
                </button>
                <button
                  type="button"
                  className="nv-btn nv-btn--soft nv-btn--destructive nv-btn--sm"
                  disabled={busy}
                  aria-busy={busy}
                  onClick={unlink}
                >
                  Délier
                </button>
              </div>
            </div>
          ) : (
            <div className="pc-actions">
              <button
                type="button"
                className="nv-btn nv-btn--soft nv-btn--sm"
                onClick={() => {
                  setNotice(null);
                  setConfirming(true);
                }}
              >
                Délier
              </button>
            </div>
          ))}
      </div>,
    );
  }

  return frame(
    <div className="pc-chat">
      <p className="pc-lead">
        Si tu oublies ton mot de passe, le bot de l’agence t’envoie en privé le lien pour en choisir un
        nouveau. Ce chat ne reçoit rien d’autre.
      </p>
      {said}
      {noBot ? (
        <div className="pc-nobot">
          <p className="pc-lead">
            {owner
              ? 'Aucun bot Telegram n’est branché : ajoute-le d’abord dans « Bots et groupes ».'
              : 'Aucun bot Telegram n’est branché pour l’agence : demande au propriétaire de l’ajouter.'}
          </p>
          {owner && onAddBot !== undefined ? (
            <button type="button" className="nv-btn nv-btn--soft nv-btn--sm pc-start" onClick={onAddBot}>
              Bots et groupes
            </button>
          ) : null}
        </div>
      ) : null}
      {reauth ??
        (waiting ? (
          <div className="pc-code">
            <ol className="pc-steps">
              <li>
                <span className="pc-steps__num nv-num" aria-hidden="true">
                  1
                </span>
                <span className="pc-steps__text">
                  Ouvre la conversation avec <b>@{code.botUsername}</b> : le code part tout seul.
                </span>
              </li>
              <li>
                <span className="pc-steps__num nv-num" aria-hidden="true">
                  2
                </span>
                <span className="pc-steps__text">
                  Le bot te répond « C’est fait » ; cette page le dit aussi, toute seule.
                </span>
              </li>
            </ol>
            <a
              className="nv-btn nv-btn--neon pc-open"
              href={code.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              Ouvrir Telegram
            </a>
            <div className="pc-typed">
              <p className="pc-typed__label">Ou écris au bot :</p>
              <p className="pc-typed__code nv-num">/start {code.code}</p>
              <p className="pc-typed__until">
                Valable jusqu’à <span className="nv-num">{hourLabel(code.expiresAt)}</span>
              </p>
            </div>
            <p className="pc-wait" role="status">
              <span className="pc-wait__spinner" aria-hidden="true" />
              En attente du bot…
            </p>
          </div>
        ) : noBot ? null : (
          <>
            {expired ? <p className="pc-lead">Ce code a expiré : demande-en un nouveau.</p> : null}
            <button
              type="button"
              className="nv-btn nv-btn--soft nv-btn--sm pc-start"
              disabled={busy}
              aria-busy={busy}
              onClick={askCode}
            >
              {expired ? 'Nouveau code' : 'Lier mon Telegram'}
            </button>
          </>
        ))}
    </div>,
  );
}
