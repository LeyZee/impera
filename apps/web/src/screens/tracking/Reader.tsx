import type { DraftView } from '@nirvana/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type JSX } from 'react';

import { FanSheet } from './FanSheet';
import {
  approveDraft,
  ConversationGone,
  fetchConversation,
  giveBack,
  rejectDraft,
  takeOver,
  type ConversationRead,
  type Decision,
} from './api';
import { draftsOf, threadOf, whyHuman } from './reader-model';
import { bringIntoView, useEndInView } from './scroll';
import { bubblesFromText, bubblesProblem, MODE_LABELS, STATE_LABELS, statusClass } from './view';

import { initialOf } from '@/lib/utils';

/** The reader follows the conversation more closely than the list: a draft or a fan's message shows up quickly. */
const REFRESH_MS = 10_000;

/** What `ReleaseBodySchema` accepts for the note left when giving the hand back. */
const NOTE_MAX = 300;

/**
 * One conversation, read in Nirvana (decided by Charles on 19/10, « Valider dans Suivi »): the thread, the drafts
 * waiting for a person, and who has the hand. Nobody writes to a fan from here: a person who takes over answers in
 * Reveal, and gives the hand back once done.
 */
export function Reader({
  creatorId,
  conversationId,
  canDecide,
  onClose,
  backLabel = 'Toutes les conversations',
}: {
  creatorId: string;
  conversationId: string;
  /** Owners and chatters decide; a creator reads. */
  canDecide: boolean;
  onClose: () => void;
  /** Where the phone's back button leads: the list the reader was opened from. */
  backLabel?: string;
}): JSX.Element {
  const key = ['conversation', creatorId, conversationId];
  const query = useQuery({
    queryKey: key,
    queryFn: () => fetchConversation(creatorId, conversationId),
    refetchInterval: (q) => (q.state.error instanceof ConversationGone ? false : REFRESH_MS),
    retry: (count, error) => !(error instanceof ConversationGone) && count < 1,
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

  const back = (
    <button type="button" className="nv-btn nv-btn--plain nv-btn--sm tr-back" onClick={onClose}>
      ← {backLabel}
    </button>
  );

  return (
    <section className="nv-plate tr-reader" aria-label="Conversation">
      {query.data === undefined ? back : null}
      {query.error instanceof ConversationGone ? (
        <p className="tr-reader__empty">Cette conversation n’existe plus.</p>
      ) : query.isError && query.data === undefined ? (
        <div className="tr-reader__empty" role="status">
          <p className="tr-warn">Le serveur ne répond pas</p>
          <p>La conversation n’a pas pu être lue. Nirvana réessaie tout seul.</p>
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
          settle={settle}
        />
      )}
    </section>
  );
}

function Loaded({
  back,
  read,
  stale,
  creatorId,
  canDecide,
  settle,
}: {
  /** The way back to the list, kept with the fan's name at the top of the screen on a phone. */
  back: JSX.Element;
  read: ConversationRead;
  /** The last read failed: what shows is the previous answer, and the screen says so. */
  stale: boolean;
  creatorId: string;
  canDecide: boolean;
  settle: () => Promise<void>;
}): JSX.Element {
  const { detail } = read;
  const name = detail.fanDisplayName.trim() === '' ? 'Fan sans nom' : detail.fanDisplayName;
  const drafts = draftsOf(read);
  const isHuman = drafts.state === 'human';
  const why = isHuman ? whyHuman(read) : null;
  const [hand, setHand] = useState<{ pending: boolean; error: string | null }>({
    pending: false,
    error: null,
  });
  /** A decision that came too late: said here, since the draft it was about leaves the screen. */
  const [outdated, setOutdated] = useState<string | null>(null);

  const [note, setNote] = useState('');

  const toggleHand = async (): Promise<void> => {
    setHand({ pending: true, error: null });
    setOutdated(null);
    const kept = note.trim();
    const result = await (isHuman
      ? giveBack(creatorId, detail.id, kept === '' ? undefined : kept)
      : takeOver(creatorId, detail.id));
    if (result.ok) setNote('');
    // A takeover or a release that came too late: what shows is read again at once, as after a success.
    if (result.ok || result.outdated) await settle();
    setHand({ pending: false, error: result.ok ? null : result.message });
  };

  const decided = async (decision: Decision): Promise<string | null> => {
    if (decision.ok) {
      setOutdated(null);
      await settle();
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
      type="button"
      className="nv-btn nv-btn--soft nv-btn--sm"
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
              <span className={`nv-status ${statusClass(drafts.state)}`}>
                <span className="nv-status__dot" />
                {STATE_LABELS[drafts.state]}
              </span>
              <span className="nv-meta">{MODE_LABELS[detail.mode]}</span>
            </span>
          </span>
          {canDecide && !isHuman ? handButton : null}
        </header>
      </div>
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
      {isHuman ? (
        <div className="tr-hand">
          <p>
            {why === null ? 'Un humain a la main.' : `${why}.`} Il répond dans Reveal ; l’agent n’écrit plus à
            ce fan jusqu’à ce qu’on lui rende la main.
          </p>
          {canDecide ? (
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
              {handButton}
            </div>
          ) : null}
        </div>
      ) : null}
      <FanSheet
        creatorId={creatorId}
        fanId={detail.fanId}
        conversationId={detail.id}
        desire={detail.desire}
        canDecide={canDecide}
      />
      <div className="tr-reader__body" ref={bodyRef}>
        {read.isPartial ? (
          <p className="tr-more">Seuls les derniers messages sont affichés ; le reste se lit dans Reveal.</p>
        ) : null}
        <div className="nv-thread">
          {threadOf(read).map((item) =>
            item.kind === 'note' ? (
              <p key={item.id} className="tr-note">
                {item.text}
              </p>
            ) : (
              <div key={item.id} className={`nv-bubble nv-bubble--${item.from}`}>
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
              </div>
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
            blocked={!canDecide ? 'reader' : isHuman ? 'human' : null}
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
  decided,
}: {
  draft: DraftView;
  creatorId: string;
  conversationId: string;
  /** Why this person cannot decide now: a human has the hand, or she only reads (a creator); null when she can. */
  blocked: 'human' | 'reader' | null;
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
        <div className="nv-draft-panel__actions">
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
            {pending ? 'Envoi au serveur…' : isChanged ? 'Envoyer la retouche' : 'Valider'}
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
