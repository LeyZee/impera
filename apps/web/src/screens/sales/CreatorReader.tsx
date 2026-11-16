import { useEffect, useRef, type JSX } from 'react';

import { ConversationGone, useCreatorConversation, useCreatorMessages } from './api';
import { fanName, threadOf } from './view';

import { initialOf } from '@/lib/utils';
import { readerZone } from '@/scheduling/time';
import { useNow } from '@/scheduling/useNow';
import { bringIntoView } from '@/screens/tracking/scroll';
import { Empty, Failure, Skeleton } from '@/shell/states';

/**
 * One of her conversations, read only (ADR 0042 § 2: she never writes to a fan from here). Her fan's messages on one
 * side, hers as he saw them on the other, never who wrote them (ADR 0021); no draft, no note, no button that acts.
 * Opens on the last message, like any messenger.
 */
export function CreatorReader({
  conversationId,
  fallbackName,
  onClose,
}: {
  conversationId: string;
  /** His pseudo from the list, shown while the conversation is read. */
  fallbackName: string | null;
  onClose: () => void;
}): JSX.Element {
  const conversation = useCreatorConversation(conversationId);
  const messages = useCreatorMessages(conversationId);
  const now = useNow();
  const zone = readerZone();
  const bodyRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const opened = useRef(false);
  const loaded = messages.data !== undefined;
  useEffect(() => {
    if (!loaded || opened.current) return;
    opened.current = true;
    bringIntoView(bodyRef.current, null, endRef.current);
  }, [loaded]);

  const gone = conversation.error instanceof ConversationGone || messages.error instanceof ConversationGone;
  const name =
    conversation.data === undefined
      ? (fallbackName ?? 'Conversation')
      : fanName(conversation.data.fan.displayName);
  const days =
    messages.data === undefined
      ? []
      : threadOf(
          messages.data.pages.map((page) => page.items),
          now,
          zone,
        );

  return (
    <section className="nv-plate vt-reader" aria-label={`Conversation avec ${name}`}>
      <div className="vt-reader__top">
        <button type="button" className="nv-btn nv-btn--plain nv-btn--sm vt-back" onClick={onClose}>
          ← Tes fans
        </button>
        <header className="vt-reader__head">
          <span className="nv-avatar" aria-hidden="true">
            {initialOf(name)}
          </span>
          <span className="vt-reader__who">
            <h2 className="nv-h3">{name}</h2>
            <span className="nv-meta">Lecture seule</span>
          </span>
        </header>
      </div>
      {gone ? (
        <Empty title="Cette conversation n’est plus disponible." />
      ) : (conversation.isError && conversation.data === undefined) ||
        (messages.isError && messages.data === undefined) ? (
        <Failure
          inline
          className="vt-reader__state"
          onRetry={() => {
            void conversation.refetch();
            void messages.refetch();
          }}
        />
      ) : messages.data === undefined ? (
        <Skeleton label="Chargement de la conversation…" className="vt-reader__state">
          <i className="nv-skeleton__bar" />
          <i className="nv-skeleton__bar" />
          <i className="nv-skeleton__bar" />
        </Skeleton>
      ) : (
        <div className="vt-reader__body" ref={bodyRef}>
          {messages.hasNextPage ? (
            <button
              type="button"
              className="nv-btn nv-btn--plain nv-btn--sm vt-older"
              disabled={messages.isFetchingNextPage}
              onClick={() => void messages.fetchNextPage()}
            >
              {messages.isFetchingNextPage ? 'Chargement…' : 'Messages plus anciens'}
            </button>
          ) : null}
          {days.length === 0 ? <Empty title="Aucun message pour l’instant." /> : null}
          {days.map((day) => (
            <div key={day.day} className="vt-day">
              <p className="vt-day__label">{day.label}</p>
              <div className="nv-thread">
                {day.bubbles.map((bubble) => (
                  <div key={bubble.id} className={`nv-bubble nv-bubble--${bubble.from} vt-bubble`}>
                    {/* The side of a bubble is only seen: a screen reader hears who speaks. */}
                    <span className="sr-only">{bubble.from === 'fan' ? `${name} : ` : 'Toi : '}</span>
                    {bubble.text === '' ? null : <span>{bubble.text}</span>}
                    {bubble.media.map((media, index) => (
                      <span key={index} className="vt-media">
                        <em>{media.label}</em>
                        {media.description === null ? null : ` · ${media.description}`}
                      </span>
                    ))}
                    {bubble.paid === null ? null : <span className="vt-paid">{bubble.paid}</span>}
                    <span className="vt-time nv-num">{bubble.time}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
          <div ref={endRef} />
        </div>
      )}
    </section>
  );
}
