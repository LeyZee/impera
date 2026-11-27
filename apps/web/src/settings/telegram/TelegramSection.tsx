import type { TelegramBot, TelegramChat, TelegramOverview } from '@impera/contracts';
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';

import { ReauthRequired } from '../services/api';

import { BotSheet, type SheetMode } from './BotSheet';
import { Reauth } from './Reauth';
import { TelegramForbidden, TelegramOff, fetchOverview, removeBot, removeChat } from './api';
import { botLine, chatChoices, chatLine, goneChats, goneLine, initials, plural } from './model';
import './telegram.css';

import { Empty, Failure } from '@/shell/states';

/** The page refreshes on its own: a bot removed from a channel turns orange without a reload. */
const REFRESH_MS = 30_000;
const OFFLINE = 'Le serveur ne répond pas. Réessaie dans un instant.';

type Load =
  | { kind: 'loading' }
  | { kind: 'failed' }
  | { kind: 'off' }
  | { kind: 'forbidden' }
  | { kind: 'ready'; overview: TelegramOverview };

/**
 * Réglages › Bots Telegram (ADR 0080, 27/11/2026): the bots that publish in the creators' channels, and the channels
 * they found. The agency's alerts left Telegram for the Impera notifications. Nothing here ever shows a token.
 */
export function TelegramSection(): JSX.Element {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [sheet, setSheet] = useState<SheetMode | null>(null);
  const [now, setNow] = useState(() => new Date());
  /** Only the latest refresh may land: an older answer arriving late would show a stale state. */
  const latest = useRef(0);

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
      if (error instanceof TelegramOff) {
        setLoad({ kind: 'off' });
        return;
      }
      if (error instanceof TelegramForbidden) {
        setLoad({ kind: 'forbidden' });
        return;
      }
      setLoad((current) => (current.kind === 'ready' ? current : { kind: 'failed' }));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    // Neither a sheet open nor a page the server refuses (not the owner) is read again on a timer.
    if (sheet !== null || load.kind === 'forbidden') return undefined;
    const timer = window.setInterval(() => void refresh(), REFRESH_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [refresh, sheet, load.kind]);

  const closeSheet = useCallback(() => {
    setSheet(null);
    void refresh();
  }, [refresh]);

  if (load.kind !== 'ready') {
    return (
      <section className="tg-page" aria-busy={load.kind === 'loading'}>
        {load.kind === 'failed' ? <Failure onRetry={() => void refresh()} /> : null}
        {load.kind === 'forbidden' ? (
          <div className="nv-plate tg-cover">
            <div>
              <p className="tg-cover__title">Seul le propriétaire règle les bots Telegram</p>
              <p className="tg-cover__sub">Les bots des canaux des modèles se règlent depuis son compte.</p>
            </div>
          </div>
        ) : null}
        {load.kind === 'off' ? (
          <div className="nv-plate tg-cover" data-state="warn">
            <div>
              <p className="tg-cover__title">Telegram n’est pas activé sur ce serveur</p>
              <p className="tg-cover__sub">
                C’est un réglage d’installation, fait une seule fois par la personne qui héberge Impera.
              </p>
            </div>
          </div>
        ) : null}
      </section>
    );
  }

  const { overview } = load;
  const openAdd = (): void => {
    setSheet({ kind: 'add' });
  };
  const lede = (
    <p className="tg-lede">
      Les bots qui publient dans le canal Telegram de chaque modèle. Les alertes de l’agence arrivent en
      notification Impera, plus ici.
    </p>
  );
  const sheetView =
    sheet === null ? null : <BotSheet mode={sheet} onChanged={() => void refresh()} onClose={closeSheet} />;

  if (overview.bots.length === 0) {
    return (
      <section className="tg-page">
        {lede}
        <Empty
          plate
          icon={<TelegramGlyph />}
          title="Aucun bot pour l’instant"
          action={
            <button type="button" className="nv-btn nv-btn--neon" onClick={openAdd}>
              Ajouter un bot
            </button>
          }
        >
          Un bot Telegram se crée en une minute avec @BotFather, puis tu le fais administrateur du canal de la
          modèle. Impera te guide pas à pas.
        </Empty>
        {sheetView}
      </section>
    );
  }

  return (
    <section className="tg-page">
      {lede}
      <BotsList
        overview={overview}
        now={now}
        onSheet={setSheet}
        onChanged={() => void refresh()}
        onAdd={openAdd}
      />
      {sheetView}
    </section>
  );
}

type Pending =
  | { kind: 'confirm'; botId: string }
  | { kind: 'reauth'; botId: string }
  | { kind: 'forget'; chatId: string }
  | null;

function BotsList({
  overview,
  now,
  onSheet,
  onChanged,
  onAdd,
}: {
  overview: TelegramOverview;
  now: Date;
  onSheet: (mode: SheetMode) => void;
  onChanged: () => void;
  onAdd: () => void;
}): JSX.Element {
  const [pending, setPending] = useState<Pending>(null);
  const [error, setError] = useState<string | null>(null);
  /** The channels whose removal is under way: their button waits, and is never pressed twice. */
  const [forgetting, setForgetting] = useState<ReadonlySet<string>>(new Set());
  const choices = chatChoices(overview.bots);
  const active = choices.filter((c) => c.isReachable).length;

  const remove = (bot: TelegramBot): void => {
    setError(null);
    removeBot(bot.id).then(onChanged, (reason: unknown) => {
      if (reason instanceof ReauthRequired) {
        setPending({ kind: 'reauth', botId: bot.id });
        return;
      }
      setError(`${bot.displayName} n’a pas été supprimé. ${OFFLINE}`);
    });
  };

  const forget = (chat: TelegramChat): void => {
    setError(null);
    const done = (): void => {
      setForgetting((all) => new Set([...all].filter((id) => id !== chat.id)));
    };
    setForgetting((all) => new Set([...all, chat.id]));
    removeChat(chat.id).then(
      (result) => {
        done();
        if (result === 'still_member') setError(`Le bot est revenu dans ${chat.title} : le canal reste.`);
        onChanged();
      },
      () => {
        done();
        setError(`${chat.title} n’a pas été retiré. ${OFFLINE}`);
      },
    );
  };

  // The page's one neon goes to the first bot to repair; with none, nothing here is lit (the page has no neon).
  const firstBroken = overview.bots.find((bot) => bot.state !== 'active')?.id ?? null;

  return (
    <>
      <section>
        <p className="tg-eyebrow">
          Bots{' '}
          <span>{`${plural(overview.bots.length, 'bot')} · ${plural(active, 'canal', 'canaux')} actif${active > 1 ? 's' : ''}`}</span>
        </p>
        <div className="nv-plate">
          <div className="nv-list">
            {overview.bots.map((bot) => {
              const line = botLine(bot);
              const botChoices = choices.filter((c) => c.bot.id === bot.id);
              const gone = goneChats(bot);
              return (
                <div className="tg-bot" key={bot.id}>
                  <div className="tg-bot__head">
                    <div className="tg-bot__icon" aria-hidden="true">
                      <TelegramGlyph />
                    </div>
                    <div className="tg-min0">
                      <div className="tg-bot__name">{bot.displayName}</div>
                      <div className="tg-bot__handle" data-warning={line.isWarning}>
                        {line.text}
                      </div>
                    </div>
                    <div className="tg-actions">
                      {bot.state === 'active' ? (
                        <span className="nv-status nv-status--sent">
                          <span className="nv-status__dot" />
                          Actif
                        </span>
                      ) : (
                        <button
                          type="button"
                          className={`nv-btn nv-btn--sm ${bot.id === firstBroken ? 'nv-btn--neon' : 'nv-btn--soft'}`}
                          onClick={() => {
                            onSheet({ kind: 'replace', bot });
                          }}
                        >
                          Réparer
                        </button>
                      )}
                    </div>
                  </div>
                  {botChoices.length === 0 && gone.length === 0 ? (
                    <p className="tg-hint tg-bot__empty">Ce bot n’est dans aucun canal.</p>
                  ) : (
                    <div className="nv-list">
                      {botChoices.map((choice) => {
                        const chatLabel = chatLine(choice, now);
                        return (
                          <div className="tg-chat" key={choice.chat.id}>
                            <span className="tg-av">{initials(choice.chat.title)}</span>
                            <div className="tg-chat__t">
                              <b>{choice.chat.title}</b>
                              <small data-warning={chatLabel.isWarning}>{chatLabel.text}</small>
                            </div>
                          </div>
                        );
                      })}
                      {gone.map((chat) => (
                        <div className="tg-chat" key={chat.id}>
                          <span className="tg-av">{initials(chat.title)}</span>
                          <div className="tg-chat__t">
                            <b>{chat.title}</b>
                            <small data-warning="true">{goneLine(chat)}</small>
                          </div>
                          <div className="tg-actions">
                            <button
                              type="button"
                              className="nv-btn nv-btn--plain nv-btn--sm nv-btn--destructive"
                              disabled={forgetting.has(chat.id)}
                              onClick={() => {
                                setPending({ kind: 'forget', chatId: chat.id });
                              }}
                            >
                              {forgetting.has(chat.id) ? 'Retrait…' : 'Retirer de la liste'}
                            </button>
                          </div>
                          {pending?.kind === 'forget' && pending.chatId === chat.id ? (
                            <div className="nv-confirm tg-full">
                              <p>
                                <b>Retirer {chat.title} de la liste ?</b>{' '}
                                <span className="tg-hint">
                                  Si tu rajoutes le bot à ce canal, il revient tout seul.
                                </span>
                              </p>
                              <div className="nv-confirm__actions">
                                <button
                                  type="button"
                                  className="nv-btn nv-btn--soft nv-btn--sm"
                                  onClick={() => {
                                    setPending(null);
                                  }}
                                >
                                  Garder
                                </button>
                                <button
                                  type="button"
                                  className="nv-btn nv-btn--soft nv-btn--destructive nv-btn--sm"
                                  onClick={() => {
                                    setPending(null);
                                    forget(chat);
                                  }}
                                >
                                  Retirer
                                </button>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="tg-bot__foot">
                    <button
                      type="button"
                      className="nv-btn nv-btn--plain nv-btn--sm"
                      disabled={bot.state !== 'active'}
                      onClick={() => {
                        onSheet({ kind: 'listen', bot });
                      }}
                    >
                      Ajouter à un canal
                    </button>
                    {/* « Réparer » above already replaces the token of a broken bot. */}
                    {bot.state === 'active' ? (
                      <button
                        type="button"
                        className="nv-btn nv-btn--plain nv-btn--sm"
                        onClick={() => {
                          onSheet({ kind: 'replace', bot });
                        }}
                      >
                        Remplacer le jeton
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="nv-btn nv-btn--plain nv-btn--sm nv-btn--destructive"
                      onClick={() => {
                        setPending({ kind: 'confirm', botId: bot.id });
                      }}
                    >
                      Supprimer
                    </button>
                    {pending?.kind === 'confirm' && pending.botId === bot.id ? (
                      <div className="nv-confirm tg-full">
                        <p>
                          <b>Supprimer {bot.displayName} ?</b>{' '}
                          <span className="tg-hint">
                            {botChoices.length === 1
                              ? 'Il ne publiera plus dans son canal. '
                              : botChoices.length > 1
                                ? `Il ne publiera plus dans ses ${plural(botChoices.length, 'canal', 'canaux')}. `
                                : ''}
                            Le bot reste dans Telegram : pour l’effacer, envoie /deletebot à @BotFather.
                          </span>
                        </p>
                        <div className="nv-confirm__actions">
                          <button
                            type="button"
                            className="nv-btn nv-btn--soft nv-btn--sm"
                            onClick={() => {
                              setPending(null);
                            }}
                          >
                            Garder
                          </button>
                          <button
                            type="button"
                            className="nv-btn nv-btn--soft nv-btn--destructive nv-btn--sm"
                            onClick={() => {
                              setPending(null);
                              remove(bot);
                            }}
                          >
                            Supprimer le bot
                          </button>
                        </div>
                      </div>
                    ) : null}
                    {pending?.kind === 'reauth' && pending.botId === bot.id ? (
                      <div className="nv-confirm tg-full">
                        <Reauth
                          onConfirmed={() => {
                            setPending(null);
                            remove(bot);
                          }}
                          onCancel={() => {
                            setPending(null);
                          }}
                        />
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>
      {error === null ? null : (
        <p className="tg-notice" role="alert">
          {error}
        </p>
      )}
      <button type="button" className="nv-btn nv-btn--soft nv-btn--sm tg-self-start" onClick={onAdd}>
        Ajouter un bot
      </button>
      <div className="tg-callout">
        <InfoGlyph />
        <span>
          Un bot peut publier dans les canaux de plusieurs modèles. Le canal d’une modèle se relie à elle
          depuis sa fiche, section Canal Telegram.
        </span>
      </div>
    </>
  );
}

function TelegramGlyph(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M21.4 4.3 2.9 11.4c-1.2.5-1.2 1.2-.2 1.5l4.7 1.5 1.8 5.6c.2.6.4.8.9.8.4 0 .6-.2.9-.5l2.3-2.2 4.7 3.5c.9.5 1.5.2 1.7-.8l3.1-14.7c.3-1.3-.5-1.9-1.4-1.3z" />
    </svg>
  );
}

function InfoGlyph(): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </svg>
  );
}
