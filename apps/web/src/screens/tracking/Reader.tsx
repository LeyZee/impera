import type { DraftView } from '@impera/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, useEffect, useRef, useState, type JSX } from 'react';

import { FanSheet } from './FanSheet';
import {
  approveDraft,
  ConversationClosed,
  ConversationGone,
  fetchConversation,
  giveBack,
  rejectDraft,
  takeOver,
  type ConversationRead,
  type Decision,
} from './api';
import {
  draftsOf,
  endsRun,
  graveHandoffOf,
  messageTime,
  stoppedText,
  threadOf,
  whyHuman,
} from './reader-model';
import { bringIntoView, useEndInView } from './scroll';
import { useThreeColumns } from './useThreeColumns';
import {
  bubblesFromText,
  bubblesProblem,
  MODE_LABELS,
  READER_STATE_LABELS,
  situationOf,
  STOP_SITUATION,
} from './view';

import { initialOf } from '@/lib/utils';

/** The reader follows the conversation more closely than the list: a draft or a fan's message shows up quickly. */
const REFRESH_MS = 10_000;

/** A read that will answer the same until something else changes: gone, or no longer open to this reader. */
const isFinal = (error: unknown): boolean =>
  error instanceof ConversationGone || error instanceof ConversationClosed;

/** What `ReleaseBodySchema` accepts for the note left when giving the hand back. */
const NOTE_MAX = 300;

/**
 * One conversation, read in Impera (decided by Charles on 19/10, « Valider dans Suivi »): the thread, the drafts
 * waiting for a person, and who has the hand. Nobody writes to a fan from here: a person who takes over answers in
 * Reveal, and gives the hand back once done.
 */
export function Reader({
  creatorId,
  conversationId,
  canDecide,
  selfScope = false,
  stopAhead = false,
  onClose,
  onReleased,
  onClosedToYou,
  backLabel = 'Toutes les conversations',
}: {
  creatorId: string;
  conversationId: string;
  /** Owners and chatters decide; a creator reads. */
  canDecide: boolean;
  /** A team member whose scope is `self` (a chatter): see `TrackingPage`. */
  selfScope?: boolean;
  /** The stop already holds her messages (recette CHAT-07): Valider waits, the banner above the list says why. */
  stopAhead?: boolean;
  onClose: () => void;
  /**
   * The hand was given back by a member whose scope is `self` and the conversation left his list (off shift): the
   * reader closes instead of reading it again (CHAT-08). Told the fan's name for the confirmation.
   */
  onReleased?: ((fan: string) => void) | undefined;
  /**
   * The conversation is no longer open to this reader (403, a chatter whose shift ended while he read it, EQ-13): the
   * page closes the reader and says it above the list, so the phone never stays on a screen without its way back.
   */
  onClosedToYou?: (() => void) | undefined;
  /** Where the phone's back button leads: the list the reader was opened from. */
  backLabel?: string | undefined;
}): JSX.Element {
  const key = ['conversation', creatorId, conversationId];
  const query = useQuery({
    queryKey: key,
    queryFn: () => fetchConversation(creatorId, conversationId),
    refetchInterval: (q) => (isFinal(q.state.error) ? false : REFRESH_MS),
    retry: (count, error) => !isFinal(error) && count < 1,
  });
  const client = useQueryClient();
  /** After a decision: this conversation, the list and the queue are read again at once. */
  const settle = async (): Promise<void> => {
    await Promise.all([
      client.invalidateQueries({ queryKey: key }),
      client.invalidateQueries({ queryKey: ['conversations', creatorId] }),
      client.invalidateQueries({ queryKey: ['dashboard'] }),
    ]);
  };

  /**
   * His hand given back (a member whose scope is `self`): the conversation, read again, says whether it is still open
   * to him. In his shift it is, and the reader stays (EQ-13); off shift it answers 403, so the reader closes and the
   * list says it (CHAT-08). Whether it closed is the answer.
   */
  const released =
    onReleased === undefined
      ? undefined
      : async (fan: string): Promise<boolean> => {
          const stillOpen = await client
            .query({
              queryKey: key,
              queryFn: () => fetchConversation(creatorId, conversationId),
              staleTime: 0,
              retry: false,
            })
            .then(
              () => true,
              (error: unknown) => !(error instanceof ConversationClosed),
            );
          if (stillOpen) return false;
          onReleased(fan);
          void client.invalidateQueries({ queryKey: ['conversations', creatorId] });
          void client.invalidateQueries({ queryKey: ['dashboard'] });
          return true;
        };

  const closedToYou = query.error instanceof ConversationClosed;
  useEffect(() => {
    if (closedToYou) onClosedToYou?.();
  }, [closedToYou, onClosedToYou]);

  // Whatever replaces the conversation keeps the way back: on a phone the list is hidden behind the reader.
  const loaded = query.data !== undefined && !isFinal(query.error);
  const back = (
    <button type="button" className="nv-btn nv-btn--plain nv-btn--sm tr-back" onClick={onClose}>
      ← {backLabel}
    </button>
  );

  const beside = useThreeColumns();
  const reader = (
    <section className="nv-plate tr-reader" aria-label="Conversation">
      {loaded ? null : back}
      {query.error instanceof ConversationGone ? (
        <p className="tr-reader__empty">Cette conversation n’existe plus.</p>
      ) : query.error instanceof ConversationClosed ? (
        <p className="tr-reader__empty" role="status">
          Cette conversation n’est plus ouverte pour toi&nbsp;: hors de ton shift, seules celles dont tu as la
          main restent ici.
        </p>
      ) : query.isError && query.data === undefined ? (
        <div className="tr-reader__empty" role="status">
          <p className="tr-warn">Le serveur ne répond pas</p>
          <p>La conversation n’a pas pu être lue. Impera réessaie tout seul.</p>
        </div>
      ) : query.data === undefined ? (
        <div className="tr-skeleton" aria-busy="true" aria-label="Chargement de la conversation">
          <i />
          <i />
          <i />
        </div>
      ) : (
        <Loaded
          back={back}
          read={query.data}
          stale={query.isError}
          creatorId={creatorId}
          canDecide={canDecide}
          selfScope={selfScope}
          stopAhead={stopAhead}
          settle={settle}
          released={released}
          sheetBeside={beside}
        />
      )}
    </section>
  );
  if (!beside || query.data === undefined || !loaded) return reader;
  const { detail } = query.data;
  return (
    <>
      {reader}
      {/* The third column (Charles, 08/11): what is known of him stays in view while the thread scrolls. */}
      <aside className="nv-plate tr-aside" aria-label="Le fan">
        <FanSheet
          creatorId={creatorId}
          fanId={detail.fanId}
          conversationId={detail.id}
          desire={detail.desire}
          canDecide={canDecide}
          canSetLimits={canDecide && !selfScope}
          layout="aside"
        />
      </aside>
    </>
  );
}

function Loaded({
  back,
  read,
  stale,
  creatorId,
  canDecide,
  selfScope,
  stopAhead,
  settle,
  released,
  sheetBeside,
}: {
  /** The way back to the list, kept with the fan's name at the top of the screen on a phone. */
  back: JSX.Element;
  read: ConversationRead;
  /** The last read failed: what shows is the previous answer, and the screen says so. */
  stale: boolean;
  creatorId: string;
  canDecide: boolean;
  selfScope: boolean;
  stopAhead: boolean;
  settle: () => Promise<void>;
  /** Set for a member whose scope is `self`: a hand given back closes the reader if the conversation left his list. */
  released: ((fan: string) => Promise<boolean>) | undefined;
  /** On a wide screen his sheet has its own column beside the reader (`useThreeColumns`): not drawn here again. */
  sheetBeside: boolean;
}): JSX.Element {
  const { detail } = read;
  const name = detail.fanDisplayName.trim() === '' ? 'Fan sans nom' : detail.fanDisplayName;
  const drafts = draftsOf(read);
  const isHuman = drafts.state === 'human';
  // His own hand is said to him (EQ-13): routed to him, or his takeover not given back.
  const mine = detail.heldBy === 'you';
  const why = isHuman ? whyHuman(read, mine) : null;
  // The same words as the list and « À traiter »: an idle conversation whose fan waits is « Sans réponse » (PRO-03).
  // A draft the stop holds says so, as its line does (recette CHAT-07, v2).
  const situation =
    stopAhead && drafts.state === 'awaiting_approval'
      ? STOP_SITUATION
      : situationOf(
          {
            state: drafts.state,
            lastInboundAt: detail.lastInboundAt,
            lastOutboundAt: detail.lastOutboundAt,
            heldBy: detail.heldBy,
          },
          selfScope,
        );
  // A chatter gives back his own hand, or a handoff nobody took; another person's he only reads (EQ-13).
  const canGiveBack = canDecide && !(selfScope && detail.heldBy === 'other');
  const pendingDraft = detail.openDrafts.some((draft) => draft.status === 'pending');
  // Nobody will answer him (a draft refused, the hand given back with nothing new): a person must, in Reveal (CHAT-25).
  const fanWaits =
    situation.hand === 'yours' && (drafts.state === 'idle' || drafts.state === 'paused') && !pendingDraft;
  // The agent stepped back for a reason a person must read: said at the top, in amber (CHAT-24).
  const handoff = isHuman && latestHandChange(read) === 'handoff_requested';
  const now = new Date();
  /** The emergency stop refused a decision: said at the top, in this reader's words (CHAT-07). */
  const [stopped, setStopped] = useState(false);
  const [hand, setHand] = useState<{ pending: boolean; error: string | null }>({
    pending: false,
    error: null,
  });
  /** A decision that came too late: said here, since the draft it was about leaves the screen. */
  const [outdated, setOutdated] = useState<string | null>(null);

  const [note, setNote] = useState('');
  // A grave handoff (minor, consent, distress) is given back only after a second, explicit click (PRO-26).
  const grave = isHuman ? graveHandoffOf(read) : null;
  const [confirming, setConfirming] = useState(false);
  // The focus follows the question: on the safe choice when it opens, back on the button when it closes.
  const keepRef = useRef<HTMLButtonElement>(null);
  const handRef = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(false);
  useEffect(() => {
    if (confirming) keepRef.current?.focus();
    else if (wasConfirming.current) handRef.current?.focus();
    wasConfirming.current = confirming;
  }, [confirming]);

  const toggleHand = async (): Promise<void> => {
    if (grave !== null && !confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    setHand({ pending: true, error: null });
    setOutdated(null);
    const kept = note.trim();
    const result = await (isHuman
      ? giveBack(creatorId, detail.id, kept === '' ? undefined : kept)
      : takeOver(creatorId, detail.id));
    // His hand given back off shift, the conversation left his list: the reader closes, the list says it (CHAT-08).
    if (result.ok && isHuman && released !== undefined && (await released(name))) return;
    if (result.ok) setNote('');
    // A takeover or a release that came too late: what shows is read again at once, as after a success.
    if (result.ok || result.outdated) await settle();
    setHand({ pending: false, error: result.ok ? null : result.message });
  };

  const decided = async (decision: Decision): Promise<string | null> => {
    if (decision.ok) {
      setOutdated(null);
      setStopped(false);
      await settle();
      return null;
    }
    if (decision.stopped === true) {
      setStopped(true);
      return null;
    }
    if (!decision.outdated) return decision.message;
    setOutdated(decision.message);
    await settle();
    return null;
  };

  // Like any messenger, the reader opens on the end of the thread: the draft waiting for a decision, else the last
  // message. A new draft brings it into view again only if the end of the thread was in view: a person reading higher
  // up is not pulled down. From 900 px the thread scrolls on its own, so the list beside it never moves.
  const pending = detail.openDrafts.find((draft) => draft.status === 'pending') ?? null;
  const pendingId = pending?.id ?? null;
  const bodyRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const draftRef = useRef<HTMLDivElement>(null);
  const endInView = useEndInView(endRef);
  const openedId = useRef<string | null>(null);
  useEffect(() => {
    const opening = openedId.current !== detail.id;
    openedId.current = detail.id;
    if (opening || endInView.current) bringIntoView(bodyRef.current, draftRef.current, endRef.current);
  }, [detail.id, pendingId, endInView]);

  const handButton = (
    <button
      ref={handRef}
      type="button"
      // Taking over is a rare gesture beside the state, quiet so that it is not touched by chance (D-03).
      className={`nv-btn nv-btn--sm ${isHuman ? 'nv-btn--soft' : 'nv-btn--plain'}`}
      disabled={hand.pending}
      onClick={() => void toggleHand()}
    >
      {hand.pending
        ? 'Envoi au serveur…'
        : !isHuman
          ? 'Reprendre la main'
          : note.trim() === ''
            ? 'Rendre la main à l’agent'
            : 'Rendre la main (avec la note)'}
    </button>
  );

  return (
    <>
      <div className="tr-reader__top">
        {back}
        <header className="tr-reader__head">
          <span className="nv-avatar" aria-hidden="true">
            {initialOf(name)}
          </span>
          <span className="tr-reader__who">
            <h2>{name}</h2>
            <span className="tr-reader__state">
              <span className={`nv-status ${situation.pill}`}>
                <span className="nv-status__dot" />
                {/* The reader has room for what to do about a send that failed (#537, CHAT-12). */}
                <span className="tr-reader__state-label">
                  {drafts.state === 'error' ? READER_STATE_LABELS.error : situation.label}
                </span>
              </span>
              <span className="nv-meta">{MODE_LABELS[detail.mode]}</span>
            </span>
          </span>
          {canDecide && !isHuman && !fanWaits ? handButton : null}
        </header>
        {/* With the fan's name, never scrolled away: on a phone the top stays in view above the thread (D-03). */}
        {sheetBeside ? null : (
          <FanSheet
            creatorId={creatorId}
            fanId={detail.fanId}
            conversationId={detail.id}
            desire={detail.desire}
            canDecide={canDecide}
            canSetLimits={canDecide && !selfScope}
          />
        )}
      </div>
      {stopped ? (
        <p className="tr-stopped" role="alert">
          {stoppedText(selfScope)}
        </p>
      ) : null}
      {stale ? (
        <p className="tr-warn tr-line">Le serveur ne répond pas : ce fil peut avoir changé depuis.</p>
      ) : null}
      {hand.error === null ? null : (
        <p className="tr-warn tr-line" role="alert">
          {hand.error}
        </p>
      )}
      {outdated === null ? null : (
        <p className="tr-warn tr-line" role="status">
          {outdated}
        </p>
      )}
      {fanWaits ? (
        <div className="tr-hand tr-hand--alert">
          <p>
            Personne n’a répondu à son dernier message, et l’agent n’écrira qu’à son prochain.
            {canDecide ? ' Reprends la main pour lui répondre dans Reveal.' : ''}
          </p>
          {canDecide ? <div className="tr-hand__give">{handButton}</div> : null}
        </div>
      ) : null}
      {isHuman ? (
        <div className={handoff ? 'tr-hand tr-hand--alert' : 'tr-hand'}>
          <p>
            {why === null ? (mine ? 'Tu as la main.' : 'Un humain a la main.') : `${why}.`}
            {mine
              ? ' Tu réponds dans Reveal ; l’agent n’écrit plus à ce fan jusqu’à ce que tu lui rendes la main.'
              : ' Il répond dans Reveal ; l’agent n’écrit plus à ce fan jusqu’à ce qu’on lui rende la main.'}
            {canDecide && !canGiveBack ? ' C’est à lui de la rendre.' : ''}
          </p>
          {canGiveBack ? (
            <div className="tr-hand__give">
              <label className="nv-field">
                <span className="nv-field__label">Note pour l’agent (facultatif)</span>
                <input
                  className="nv-field__control"
                  maxLength={NOTE_MAX}
                  value={note}
                  disabled={hand.pending}
                  placeholder="Ex. : anniversaire le 12 mars"
                  onChange={(event) => {
                    setNote(event.target.value);
                  }}
                />
              </label>
              {confirming && grave !== null ? (
                <div className="tr-hand__confirm" role="alert">
                  <p>
                    L’agent a passé la main pour « {grave} ». Rends-la seulement si tu as vérifié : il écrira
                    à ce fan dès son prochain message.
                  </p>
                  <div className="tr-hand__confirm-actions">
                    <button
                      ref={keepRef}
                      type="button"
                      className="nv-btn nv-btn--plain nv-btn--sm"
                      onClick={() => {
                        setConfirming(false);
                      }}
                    >
                      Garder la main
                    </button>
                    <button
                      type="button"
                      className="nv-btn nv-btn--destructive nv-btn--sm"
                      disabled={hand.pending}
                      onClick={() => void toggleHand()}
                    >
                      J’ai vérifié, rendre la main
                    </button>
                  </div>
                </div>
              ) : (
                handButton
              )}
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="tr-reader__body" ref={bodyRef}>
        {read.isPartial ? (
          <p className="tr-more">Seuls les derniers messages sont affichés ; le reste se lit dans Reveal.</p>
        ) : null}
        <div className="nv-thread">
          {threadOf(read).map((item, index, items) =>
            item.kind === 'note' ? (
              <p key={item.id} className={item.strong ? 'tr-note tr-note--strong' : 'tr-note'}>
                {item.text}
              </p>
            ) : (
              <Fragment key={item.id}>
                <div className={`nv-bubble nv-bubble--${item.from}`} title={messageTime(item.at, now)}>
                  {item.text === '' ? (
                    item.media.length === 0 ? (
                      <em>Média</em>
                    ) : null
                  ) : (
                    <span className="tr-text">{item.text}</span>
                  )}
                  {item.media.map((media, index) => (
                    <span key={index} className="tr-media">
                      <em>{media.label}</em>
                      {media.description === null ? null : ` · ${media.description}`}
                    </span>
                  ))}
                  {item.ppv === null ? null : (
                    <span className="tr-ppv">
                      Média payant · {item.ppv.price} · {item.ppv.isPaid ? 'acheté' : 'pas encore acheté'}
                    </span>
                  )}
                  {item.byHuman ? <span className="tr-ppv">Écrit par un humain</span> : null}
                  {item.byAgent ? <span className="tr-ppv">Automatique</span> : null}
                </div>
                {endsRun(items, index) ? (
                  <time dateTime={item.at} className={`nv-meta tr-time tr-time--${item.from}`}>
                    {messageTime(item.at, now)}
                  </time>
                ) : null}
              </Fragment>
            ),
          )}
          {drafts.sending.map((draft) => (
            <div key={draft.id} className="tr-draft-sending">
              {(draft.finalBubbles ?? draft.bubbles).map((bubble, i) => (
                <div key={i} className="nv-bubble nv-bubble--draft">
                  {bubble}
                </div>
              ))}
              <span className="nv-meta nv-meta--end">Envoi en cours</span>
            </div>
          ))}
          {drafts.failed === null ? null : (
            <div className="tr-draft-sending tr-draft-failed">
              {(drafts.failed.finalBubbles ?? drafts.failed.bubbles).map((bubble, i) => (
                <div key={i} className="nv-bubble nv-bubble--draft">
                  {bubble}
                </div>
              ))}
              <span className="nv-meta nv-meta--end">N’est pas parti : à envoyer dans Reveal</span>
              <CopyText bubbles={drafts.failed.finalBubbles ?? drafts.failed.bubbles} />
            </div>
          )}
          <div ref={endRef} />
        </div>
      </div>
      {/* The draft waiting for a person, pinned under the thread with its buttons: never scrolled away with it. */}
      {pending === null ? null : (
        <div className="tr-reader__foot" ref={draftRef}>
          <DraftPanel
            key={pending.id}
            draft={pending}
            creatorId={creatorId}
            conversationId={detail.id}
            blocked={!canDecide ? 'reader' : isHuman ? 'human' : stopAhead ? 'stopped' : null}
            stopped={stopped}
            decided={decided}
          />
        </div>
      )}
    </>
  );
}

/** How long « Copié » stays on the button. */
const COPIED_MS = 2_000;

/** What did not leave, copied to paste in Reveal: one bubble per line, as the chatter sends them. */
function CopyText({ bubbles }: { bubbles: readonly string[] }): JSX.Element {
  const [said, setSaid] = useState<'idle' | 'copied' | 'failed'>('idle');
  useEffect(() => {
    if (said === 'idle') return;
    const timer = window.setTimeout(() => {
      setSaid('idle');
    }, COPIED_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [said]);
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(bubbles.join('\n'));
      setSaid('copied');
    } catch {
      setSaid('failed');
    }
  };
  return (
    <button
      type="button"
      className="nv-btn nv-btn--soft nv-btn--sm tr-copy"
      aria-live="polite"
      onClick={() => void copy()}
    >
      {said === 'copied'
        ? 'Copié'
        : said === 'failed'
          ? 'Copie impossible : sélectionne le texte'
          : 'Copier le texte'}
    </button>
  );
}

type Step = 'idle' | 'editing' | 'rejecting';

/** A draft waiting for a person: send it as is, retouch it then send, or refuse it with a reason. */
function DraftPanel({
  draft,
  creatorId,
  conversationId,
  blocked,
  stopped,
  decided,
}: {
  draft: DraftView;
  creatorId: string;
  conversationId: string;
  /**
   * Why this person cannot decide now: a human has the hand, she only reads (a creator), or the stop already holds
   * every message (recette CHAT-07); null when she can.
   */
  blocked: 'human' | 'reader' | 'stopped' | null;
  /**
   * The emergency stop refused the last decision (said at the top of the reader, CHAT-07): Valider stays, since only
   * the server knows when it is lifted; its own sentence is not said twice.
   */
  stopped: boolean;
  /** What follows a decision: the sentence to show here when it was refused, null when it went through or came late. */
  decided: (decision: Decision) => Promise<string | null>;
}): JSX.Element {
  const [step, setStep] = useState<Step>('idle');
  const [text, setText] = useState(() => draft.bubbles.join('\n'));
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const edited = bubblesFromText(text);
  const problem = step === 'editing' ? bubblesProblem(text) : null;
  // An invalid text is a retouch too: the button keeps its name while it is off.
  const isChanged = edited?.join('\n') !== draft.bubbles.join('\n');

  const run = async (decide: () => Promise<Decision>): Promise<void> => {
    setPending(true);
    setError(null);
    // A refused decision leaves the draft as it was, waiting: the sentence says why, the panel stays.
    setError(await decided(await decide()));
    setPending(false);
  };

  return (
    <section className="nv-draft-panel tr-draft" aria-label="Brouillon à valider">
      <span className="nv-draft-label">Brouillon de l’agent</span>
      {step === 'editing' ? (
        <label className="nv-field">
          <span className="nv-field__label">Une bulle par ligne</span>
          <textarea
            className="nv-field__control tr-edit"
            rows={Math.min(8, Math.max(3, text.split('\n').length + 1))}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
            }}
          />
        </label>
      ) : (
        <div className="nv-thread tr-draft__bubbles">
          {draft.bubbles.map((bubble, i) => (
            <div key={i} className="nv-bubble nv-bubble--draft">
              {bubble}
            </div>
          ))}
        </div>
      )}
      {step === 'rejecting' ? (
        <label className="nv-field">
          <span className="nv-field__label">Pourquoi ? (facultatif, ça sert à entraîner l’agent)</span>
          <input
            className="nv-field__control"
            maxLength={500}
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
            }}
          />
        </label>
      ) : null}
      {problem === null ? null : (
        <p className="tr-warn tr-line" role="status">
          {problem}
        </p>
      )}
      {error === null ? null : (
        <p className="tr-warn" role="alert">
          {error}
        </p>
      )}
      {blocked === 'human' ? (
        <p className="nv-draft-panel__brief">
          Un humain a la main : rends-la à l’agent pour décider de ce brouillon.
        </p>
      ) : blocked === 'reader' ? (
        <p className="nv-draft-panel__brief">Tu lis seulement : l’équipe décide.</p>
      ) : blocked === 'stopped' ? (
        <p className="nv-draft-panel__brief tr-held">
          <span className="tr-held__dot" aria-hidden="true" />
          {'L’arrêt est actif\u00a0: ce brouillon attend qu’il soit levé pour être validé.'}
        </p>
      ) : step === 'rejecting' ? (
        <div className="nv-draft-panel__actions">
          <button
            type="button"
            className="nv-btn nv-btn--soft"
            disabled={pending}
            onClick={() =>
              void run(() =>
                rejectDraft(
                  creatorId,
                  conversationId,
                  draft.id,
                  reason.trim() === '' ? undefined : reason.trim(),
                ),
              )
            }
          >
            {pending ? 'Envoi au serveur…' : 'Refuser le brouillon'}
          </button>
          <button
            type="button"
            className="nv-btn nv-btn--plain"
            disabled={pending}
            onClick={() => {
              setStep('idle');
            }}
          >
            Annuler
          </button>
        </div>
      ) : (
        <div className={`nv-draft-panel__actions${step === 'editing' ? ' tr-draft__actions--editing' : ''}`}>
          <button
            type="button"
            className="nv-btn nv-btn--neon"
            disabled={pending || edited === null}
            onClick={() =>
              void run(() =>
                approveDraft(
                  creatorId,
                  conversationId,
                  draft.id,
                  isChanged && edited !== null ? edited : undefined,
                ),
              )
            }
          >
            {pending
              ? 'Envoi au serveur…'
              : stopped
                ? 'Réessayer'
                : isChanged
                  ? 'Envoyer la retouche'
                  : 'Valider'}
          </button>
          {step === 'editing' ? (
            <button
              type="button"
              className="nv-btn nv-btn--plain"
              disabled={pending}
              onClick={() => {
                setText(draft.bubbles.join('\n'));
                setStep('idle');
              }}
            >
              Annuler la retouche
            </button>
          ) : (
            <button
              type="button"
              className="nv-btn nv-btn--soft"
              disabled={pending}
              onClick={() => {
                setStep('editing');
              }}
            >
              Retoucher
            </button>
          )}
          <button
            type="button"
            className="nv-btn nv-btn--soft"
            disabled={pending}
            onClick={() => {
              setStep('rejecting');
            }}
          >
            Refuser
          </button>
        </div>
      )}
    </section>
  );
}

/** The latest change of hand (events come newest first): the agent stepping back, a person taking or giving it. */
function latestHandChange(read: ConversationRead): string | null {
  const event = read.events.find(
    (e) => e.type === 'handoff_requested' || e.type === 'takeover_started' || e.type === 'takeover_ended',
  );
  return event?.type ?? null;
}
