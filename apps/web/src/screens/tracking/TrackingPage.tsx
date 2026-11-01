import type { ConversationSummary, CreatorTodo } from '@nirvana/contracts';
import { placeSegmentThumb } from '@nirvana/design-system';
import { useQueries, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';

import { Reader } from './Reader';
import { fetchConversations, fetchTodosAcross } from './api';
import { todoLabel } from './reader-model';
import {
  duration,
  LIST_ORDER_LABELS,
  LIST_ORDERS,
  MODE_MEANINGS,
  mergeConversations,
  orderLines,
  readListOrder,
  searchLines,
  sharedMode,
  STATE_LABELS,
  statusClass,
  storeListOrder,
  subline,
  type ListOrder,
} from './view';
import './tracking.css';

import { useCreators } from '@/creators/api';
import { initialOf } from '@/lib/utils';
import { Page, PageHeader, Panel } from '@/shell/layout';

const REFRESH_MS = 30_000;

/** The lines of « À traiter » shown before « Voir les N autres ». */
const QUEUE_SHOWN = 3;

/** Arrow keys of a radio group and the way they move. */
const STEPS: Readonly<Record<string, 1 | -1>> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

/**
 * Suivi : d'abord ce qui attend un humain (la file « à traiter », calculée par le serveur), puis toutes les
 * conversations ; une conversation ouverte se lit à droite, et ses brouillons s'y valident (Charles, 19/10 :
 * « Valider dans Suivi »). Personne n'écrit à un fan d'ici : reprendre la main, c'est continuer dans Reveal.
 */
export function TrackingPage({
  selected,
  selectedCreator = null,
  onSelect,
  canDecide,
  canAddCreator,
  offShift,
  nav,
}: {
  /** The conversation open in the reader (`/suivi?conversation=<id>`), or null for the list alone. */
  selected: string | null;
  /** The creator the link names for it (`&creatrice=<id>`), read first when she is one of this account's. */
  selectedCreator?: string | null;
  onSelect: (conversationId: string | null) => void;
  /** Owners and chatters decide on drafts and take over; a creator reads. */
  canDecide: boolean;
  /** Créatrices is in the account's rail: the owner adds a creator from there; a team member waits for his. */
  canAddCreator: boolean;
  /**
   * A chatter off shift (EQ-13): said under the title, in place of the empty list. Told whether a conversation is still
   * listed: off shift, the server only lists the one whose handover he took, until he gives it back (ADR 0025).
   */
  offShift?: ((holdsHandover: boolean) => ReactNode) | undefined;
  /** Suivi's sub-views, for whoever reads the history of the alerts too (P4-01); a chatter has none. */
  nav?: ReactNode;
}): JSX.Element {
  const creatorsQuery = useCreators();
  const creators = creatorsQuery.data ?? [];
  const queries = useQueries({
    queries: creators.map((creator) => ({
      queryKey: ['conversations', creator.id],
      queryFn: () => fetchConversations(creator.id),
      refetchInterval: REFRESH_MS,
    })),
  });
  // « À traiter » of every creator followed, not only the one the Dashboard shows (SUIVI-09). Under ['dashboard'], so a
  // decision in the reader, which reads the Dashboard again, reads this queue again too.
  const queue = useQuery({
    queryKey: ['dashboard', 'todos-across'],
    queryFn: fetchTodosAcross,
    refetchInterval: REFRESH_MS,
  });
  const now = useNow();
  const [order, setOrder] = useState<ListOrder>(readListOrder);
  const [search, setSearch] = useState('');
  const [allTodos, setAllTodos] = useState(false);

  const isLoading = creatorsQuery.isPending || queries.some((q) => q.isPending);
  const failed = queries.filter((q) => q.isError);
  const lines = mergeConversations(
    creators.map((creator, i) => ({
      creatorId: creator.id,
      creatorName: creator.displayName,
      items: queries[i]?.data?.items ?? [],
    })),
  );
  const hasMore = queries.some((q) => q.data?.hasMore === true);
  // The order only offers itself once a fan has a desire score: before that, « Chauds d'abord » would sort nothing.
  const canOrder = lines.some((l) => l.conversation.desire !== null);
  const shown = searchLines(orderLines(lines, canOrder ? order : 'recent'), search);
  const isSearching = search.trim() !== '';
  const showsCreator = creators.length > 1;
  const mode = sharedMode(lines);
  const retry = (): void => {
    if (creatorsQuery.isError) void creatorsQuery.refetch();
    for (const q of failed) void q.refetch();
    if (queue.isError) void queue.refetch();
  };
  // Each line of the queue carries its creator: its conversation opens with her id.
  const todos = queue.data?.items ?? [];
  // The gravest first (the server's order): three lines keep the search and the list above the fold; the one open stays.
  // A fourth line is shown rather than hidden alone, so at least two hide behind « Voir les N autres ».
  const openIndex = todos.findIndex((t) => t.conversationId === selected);
  const shownTodos =
    allTodos || todos.length <= QUEUE_SHOWN + 1 || openIndex >= QUEUE_SHOWN
      ? todos
      : todos.slice(0, QUEUE_SHOWN);
  const hiddenTodos = todos.length - shownTodos.length;
  const open =
    selected === null
      ? null
      : (lines.find((l) => l.conversation.id === selected)?.creatorId ??
        creators.find((c) => c.id === selectedCreator)?.id ??
        todos.find((t) => t.conversationId === selected)?.creatorId ??
        null);

  return (
    <Page className={selected === null ? 'tr-page' : 'tr-page tr-is-reading'}>
      <PageHeader
        eyebrow={creators.length === 1 ? creators[0]?.displayName : undefined}
        title="Suivi"
        lead={
          mode === null
            ? 'Ce qui attend un humain, puis les conversations et qui a la main.'
            : `Ce qui attend un humain, puis les conversations et qui a la main. ${MODE_MEANINGS[mode]}`
        }
        actions={nav}
      />
      {offShift?.(lines.length > 0)}
      {creatorsQuery.isError || (failed.length > 0 && lines.length === 0) ? (
        <Notice
          title="Le serveur ne répond pas"
          text="La liste n’a pas pu être lue. Réessaie dans un instant."
        >
          <button type="button" className="nv-btn nv-btn--soft nv-btn--sm" onClick={retry}>
            Réessayer
          </button>
        </Notice>
      ) : isLoading && lines.length === 0 ? (
        <Panel className="tr-panel">
          <div className="tr-skeleton" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
        </Panel>
      ) : creators.length === 0 && canAddCreator ? (
        <Notice
          title="Aucune créatrice pour l’instant"
          text="Ajoute ta première créatrice : ses conversations arriveront ici dès que sa session Reveal sera reliée."
        >
          <Link to="/creatrices" className="nv-btn nv-btn--soft nv-btn--sm">
            Aller à Créatrices
          </Link>
        </Notice>
      ) : // Off shift with nothing listed: the banner above says it all, never « no conversation yet ».
      offShift !== undefined && lines.length === 0 && todos.length === 0 ? null : creators.length === 0 ? (
        <Notice
          title="Rien pour toi pour l’instant"
          text="Les conversations des créatrices qui te sont confiées arrivent ici."
        />
      ) : (
        <div className="tr-layout">
          <div className="tr-side">
            {/* An unread queue is never silent: an urgency may be missing from it. */}
            {queue.isError ? (
              <Panel className="tr-panel" eyebrow="À traiter">
                <p className="tr-queue-error tr-warn">
                  « À traiter » n’a pas pu être lu : une urgence peut manquer ici.
                </p>
                <button type="button" className="nv-btn nv-btn--soft nv-btn--sm" onClick={retry}>
                  Réessayer
                </button>
              </Panel>
            ) : null}
            {todos.length === 0 ? null : (
              <Panel className="tr-panel" eyebrow="À traiter">
                <ul className="nv-list tr-list" aria-label="À traiter">
                  {shownTodos.map((todo) => (
                    <QueueRow
                      key={`${todo.creatorId}-${todo.id}`}
                      todo={todo}
                      withCreator={showsCreator}
                      isOpen={todo.conversationId === selected}
                      onOpen={() => {
                        onSelect(todo.conversationId);
                      }}
                    />
                  ))}
                </ul>
                {hiddenTodos === 0 ? null : (
                  <p className="tr-more tr-more--action">
                    <button
                      type="button"
                      className="nv-btn nv-btn--plain nv-btn--sm"
                      onClick={() => {
                        setAllTodos(true);
                      }}
                    >
                      {`Voir les ${String(hiddenTodos)} autres`}
                    </button>
                  </p>
                )}
              </Panel>
            )}
            {lines.length === 0 ? (
              <Notice
                title="Aucune conversation pour l’instant"
                text="Elles apparaissent ici dès que le premier fan écrit sur Reveal."
              />
            ) : (
              <Panel
                className="tr-panel"
                eyebrow={todos.length === 0 ? undefined : 'Toutes les conversations'}
              >
                {canOrder ? (
                  <OrderControl
                    order={order}
                    onChange={(next) => {
                      setOrder(next);
                      storeListOrder(next);
                    }}
                  />
                ) : null}
                <label className="tr-search">
                  <span className="sr-only">Chercher un fan par son pseudo</span>
                  <input
                    type="search"
                    className="nv-field__control"
                    placeholder="Chercher un fan"
                    value={search}
                    onChange={(event) => {
                      setSearch(event.target.value);
                    }}
                  />
                </label>
                <div className="nv-scroll">
                  {isSearching && shown.length === 0 ? (
                    <p className="tr-more">Aucun fan ne porte ce pseudo dans la liste.</p>
                  ) : null}
                  <ul className="nv-list tr-list" aria-label="Conversations">
                    {shown.map(({ conversation, creatorName }) => (
                      <Row
                        key={conversation.id}
                        conversation={conversation}
                        creatorName={showsCreator ? creatorName : undefined}
                        now={now}
                        isOpen={conversation.id === selected}
                        onOpen={() => {
                          onSelect(conversation.id);
                        }}
                      />
                    ))}
                  </ul>
                  {hasMore ? (
                    <p className="tr-more">
                      {isSearching
                        ? 'Seules les plus récentes sont affichées : la recherche ne porte que sur elles.'
                        : canOrder && order === 'hot'
                          ? 'Seules les plus récentes sont affichées : le classement ne porte que sur elles.'
                          : 'Seules les plus récentes sont affichées.'}
                    </p>
                  ) : null}
                </div>
              </Panel>
            )}
          </div>
          {selected === null ? (
            <section className="nv-plate tr-reader tr-reader--idle" aria-label="Conversation">
              <p className="tr-reader__empty">
                Choisis une conversation à gauche : elle s’ouvre ici, avec son brouillon s’il y en a un.
              </p>
            </section>
          ) : open === null ? (
            <section className="nv-plate tr-reader" aria-label="Conversation">
              <p className="tr-reader__empty">Cette conversation n’est pas dans la liste.</p>
            </section>
          ) : (
            <Reader
              key={selected}
              creatorId={open}
              conversationId={selected}
              canDecide={canDecide}
              onClose={() => {
                onSelect(null);
              }}
            />
          )}
        </div>
      )}
    </Page>
  );
}

/**
 * « Récents · Chauds d'abord » above the list (P3-12): a choice of the reader, remembered on the device, never the
 * default. « À traiter » stays above it whatever the order.
 */
function OrderControl({
  order,
  onChange,
}: {
  order: ListOrder;
  onChange: (order: ListOrder) => void;
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLSpanElement>(null);
  const placed = useRef(false);
  const index = LIST_ORDERS.indexOf(order);
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const step = STEPS[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const next = LIST_ORDERS[(index + step + LIST_ORDERS.length) % LIST_ORDERS.length] ?? order;
    ref.current?.querySelector<HTMLButtonElement>(`[data-order="${next}"]`)?.focus();
    onChange(next);
  };

  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return;
    // First paint in place; later changes slide.
    placeSegmentThumb(
      element,
      index,
      LIST_ORDERS.length,
      placed.current ? (thumbRef.current ?? undefined) : undefined,
    );
    placed.current = true;
  }, [index]);

  return (
    <div className="tr-order">
      <div
        className="nv-seg nv-glass nv-glass--thin"
        role="radiogroup"
        aria-label="Ordre de la liste"
        ref={ref}
        onKeyDown={onKeyDown}
      >
        <span className="nv-seg__thumb nv-glass nv-glass--thin" ref={thumbRef} aria-hidden="true" />
        {LIST_ORDERS.map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            className="nv-seg__opt"
            data-order={option}
            aria-checked={option === order}
            tabIndex={option === order ? 0 : -1}
            onClick={() => {
              onChange(option);
            }}
          >
            {LIST_ORDER_LABELS[option]}
          </button>
        ))}
      </div>
    </div>
  );
}

/** A line of « À traiter »: whose fan when several creators are followed, what it is, why it waits, since when. */
function QueueRow({
  todo,
  withCreator,
  isOpen,
  onOpen,
}: {
  todo: CreatorTodo;
  withCreator: boolean;
  isOpen: boolean;
  onOpen: () => void;
}): JSX.Element {
  return (
    <li>
      <button
        type="button"
        className="nv-convo tr-row tr-row--open"
        aria-current={isOpen ? 'true' : undefined}
        onClick={onOpen}
      >
        <span className={`nv-dot nv-tone--${todo.tone}`} aria-hidden="true" />
        <span className="nv-convo__main">
          <span className="nv-convo__name">
            {withCreator ? `${todo.creatorName} · ` : ''}
            {todoLabel(todo)} · {todo.title}
          </span>
          <span className="nv-convo__preview tr-why">{todo.why}</span>
        </span>
        <span className="nv-convo__side tr-wait">{duration(todo.waitingMinutes)}</span>
      </button>
    </li>
  );
}

function Row({
  conversation,
  creatorName,
  now,
  isOpen,
  onOpen,
}: {
  conversation: ConversationSummary;
  /** Shown beside his pseudo when the account sees several creators, never cut. */
  creatorName: string | undefined;
  now: Date;
  isOpen: boolean;
  onOpen: () => void;
}): JSX.Element {
  const name = conversation.fanDisplayName.trim() === '' ? 'Fan sans nom' : conversation.fanDisplayName;
  const line = subline(conversation, now);
  return (
    <li className="nv-enter">
      <button
        type="button"
        className="nv-convo tr-row tr-row--open"
        aria-current={isOpen ? 'true' : undefined}
        onClick={onOpen}
      >
        <span className="nv-avatar nv-avatar--sm" aria-hidden="true">
          {initialOf(name)}
        </span>
        <span className="nv-convo__main">
          <span className="nv-convo__name tr-row__name">
            <span className="tr-row__pseudo">{name}</span>
            {creatorName === undefined ? null : (
              <span className="nv-tag nv-tag--declared tr-row__creator">{creatorName}</span>
            )}
          </span>
          <span className="nv-convo__preview">
            {line.band === null ? line.text : `${line.text} · ${line.band}`}
          </span>
        </span>
        <span className="nv-convo__side">
          <span className={`nv-status ${statusClass(conversation.state)}`}>
            <span className="nv-status__dot" />
            {STATE_LABELS[conversation.state]}
          </span>
          {conversation.unreadCount > 0 ? (
            <span className="tr-unread">
              {conversation.unreadCount} non lu{conversation.unreadCount > 1 ? 's' : ''}
            </span>
          ) : null}
        </span>
      </button>
    </li>
  );
}

function Notice({
  title,
  text,
  children,
}: {
  title: string;
  text: string;
  children?: JSX.Element;
}): JSX.Element {
  return (
    <Panel className="nv-coming">
      <div className="nv-coming__in tr-notice">
        <h2>{title}</h2>
        <p>{text}</p>
        {children}
      </div>
    </Panel>
  );
}

/** The clock the « il y a » lines read, ticking every minute. */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(new Date());
    }, 60_000);
    return () => {
      window.clearInterval(timer);
    };
  }, []);
  return now;
}
