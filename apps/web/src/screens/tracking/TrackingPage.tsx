import type { ConversationSummary, CreatorTodo } from '@impera/contracts';
import { placeSegmentThumb } from '@impera/design-system';
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
import { fetchConversations, fetchSendingStop, todosAcrossQuery } from './api';
import { todoLabel } from './reader-model';
import {
  duration,
  groupByHand,
  HAND_TITLES,
  LIST_ORDER_LABELS,
  LIST_ORDERS,
  MODE_MEANINGS,
  mergeConversations,
  orderLines,
  readListOrder,
  searchLines,
  sharedMode,
  situationOf,
  STOP_SITUATION,
  storeListOrder,
  subline,
  type Hand,
  type ListOrder,
} from './view';
import './tracking.css';

import { fansWaiting, queueEntries, type QueueEntry } from '@/agent/queue';
import { useCreators } from '@/creators/api';
import { initialOf } from '@/lib/utils';
import { dashboardSearch } from '@/screens/dashboard/logic';
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
  liftsStop = false,
  offShift,
  selfScope = false,
  nothingListed,
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
  /** The owner lifts an emergency stop on the Dashboard; anyone else is told to warn his manager (recette CHAT-07). */
  liftsStop?: boolean;
  /**
   * A chatter off shift (EQ-13): said under the title, in place of the empty list. Told whether a conversation is still
   * listed: off shift, the server only lists the one whose handover he took, until he gives it back (ADR 0025).
   */
  offShift?: ((holdsHandover: boolean) => ReactNode) | undefined;
  /**
   * A team member whose scope is `self` (a chatter, ADR 0025): during his shift he reads every conversation of his
   * creator, outside it only the ones he holds; another person's hand is only said, he reads the fan's limits without
   * changing them, and a hand he gives back off shift leaves his list.
   */
  selfScope?: boolean;
  /** What a member whose scope is `self` sees while nothing is listed: what to do, never a blank. */
  nothingListed?: ReactNode;
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
  // The emergency stop of each creator, said above the list before any decision (recette CHAT-07).
  const stops = useQueries({
    queries: creators.map((creator) => ({
      queryKey: ['sending-stop', creator.id],
      queryFn: () => fetchSendingStop(creator.id),
      refetchInterval: REFRESH_MS,
    })),
  });
  const stoppedCreators = creators.filter((_, i) => stops[i]?.data === true);
  const isStopped = (creatorId: string): boolean =>
    stoppedCreators.some((creator) => creator.id === creatorId);
  const stoppedNames = stoppedCreators.map((creator) => creator.displayName);
  // An unread stop is never silent: « Valider » may be refused without the screen having said why (relecture #597).
  const stopUnread = stops.some((stop) => stop.isError);
  // « À traiter » of every creator followed, not only the one the Dashboard shows (SUIVI-09).
  const queue = useQuery(todosAcrossQuery);
  const now = useNow();
  const [order, setOrder] = useState<ListOrder>(readListOrder);
  const [search, setSearch] = useState('');
  const [allTodos, setAllTodos] = useState(false);
  /**
   * Said once above the list, for a member whose scope is `self`: a hand he just gave back, the conversation gone from
   * his list, or a conversation that closed to him while he read it, his shift over (EQ-13).
   */
  const [notice, setNotice] = useState<string | null>(null);

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
  // « Nothing for you » only once the queue answered: a queue in error or on its way may hide an urgency (relecture #538).
  const isQueueEmpty = queue.isSuccess && todos.length === 0;
  // The gravest first (the server's order): three lines keep the search and the list above the fold; the one open stays.
  // A fourth line is shown rather than hidden alone, so at least two hide behind « Voir les N autres ».
  // One line per failure of the agent, sorted by the screen itself (recette AGT-05).
  const entries = queueEntries(todos);
  const isOpenEntry = (entry: QueueEntry<CreatorTodo>): boolean =>
    entry.kind === 'one'
      ? entry.todo.conversationId === selected
      : entry.todos.some((t) => t.conversationId === selected);
  const openIndex = entries.findIndex(isOpenEntry);
  const shownTodos =
    allTodos || entries.length <= QUEUE_SHOWN + 1 || openIndex >= QUEUE_SHOWN
      ? entries
      : entries.slice(0, QUEUE_SHOWN);
  const hiddenTodos = entries.length - shownTodos.length;
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
        // Only what the mode means: the panels say the rest themselves (D-03).
        // Off shift or away, he decides nothing: what the mode asks of him is not his to read (EQ-13).
        lead={mode === null || offShift !== undefined ? undefined : MODE_MEANINGS[mode]}
        actions={nav}
      />
      {offShift?.(lines.length > 0)}
      {stoppedNames.length === 0 ? null : (
        <StopBanner
          names={creators.length > 1 ? stoppedNames : []}
          liftsStop={liftsStop}
          creatorId={stoppedCreators.length === 1 ? stoppedCreators[0]?.id : undefined}
        />
      )}
      {stopUnread && stoppedNames.length === 0 ? (
        <Panel className="tr-stop">
          <p className="tr-stop__in" role="status">
            <span className="nv-orb nv-tone--warn" aria-hidden="true" />
            <span>
              L’arrêt d’urgence n’a pas pu être lu.{' '}
              {'Si un envoi est refusé, c’est peut-être lui\u00a0: réessaie dans un instant.'}
            </span>
          </p>
        </Panel>
      ) : null}
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
      offShift !== undefined && lines.length === 0 && todos.length === 0 && !queue.isError ? (
        noticeOf(notice)
      ) : (creators.length === 0 || (selfScope && lines.length === 0 && isQueueEmpty)) &&
        nothingListed !== undefined ? (
        <>
          {noticeOf(notice)}
          {nothingListed}
        </>
      ) : creators.length === 0 && isQueueEmpty ? (
        <Notice
          title="Rien pour toi pour l’instant"
          text="Les conversations des créatrices qui te sont confiées arrivent ici."
        />
      ) : (
        <div className="tr-layout">
          <div className="tr-side">
            {noticeOf(notice)}
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
                  {shownTodos.map((entry) =>
                    entry.kind === 'one' ? (
                      <QueueRow
                        key={`${entry.todo.creatorId}-${entry.todo.id}`}
                        todo={entry.todo}
                        withCreator={showsCreator}
                        isOpen={isOpenEntry(entry)}
                        onOpen={() => {
                          onSelect(entry.todo.conversationId);
                        }}
                      />
                    ) : (
                      <QueueGroupRow
                        key={`group-${entry.oldest.creatorId}-${entry.cause}`}
                        group={entry}
                        withCreator={showsCreator}
                        isOpen={isOpenEntry(entry)}
                        onOpen={() => {
                          onSelect(entry.latest.conversationId);
                        }}
                      />
                    ),
                  )}
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
                  {/* Grouped by who acts (CHAT-22): the state is said by the group, not on every line. */}
                  <div role="group" aria-label="Conversations" className="tr-groups">
                    {groupByHand(shown, selfScope).map((group) => (
                      <section key={group.hand} className="tr-group" aria-label={HAND_TITLES[group.hand]}>
                        <h3 className="tr-group__title">
                          {HAND_TITLES[group.hand]}
                          {group.hand === 'yours' ? (
                            <span className="tr-group__count">{group.lines.length}</span>
                          ) : null}
                        </h3>
                        <ul className="nv-list tr-list" aria-label={HAND_TITLES[group.hand]}>
                          {group.lines.map(({ conversation, creatorId, creatorName }) => (
                            <Row
                              key={conversation.id}
                              conversation={conversation}
                              hand={group.hand}
                              selfScope={selfScope}
                              creatorName={showsCreator ? creatorName : undefined}
                              stopped={isStopped(creatorId)}
                              now={now}
                              isOpen={conversation.id === selected}
                              onOpen={() => {
                                setNotice(null);
                                onSelect(conversation.id);
                              }}
                            />
                          ))}
                        </ul>
                      </section>
                    ))}
                  </div>
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
              selfScope={selfScope}
              stopAhead={isStopped(open)}
              // Off shift, only the conversations he holds are listed: the way back says so.
              backLabel={offShift === undefined ? undefined : 'Tes conversations'}
              onClose={() => {
                onSelect(null);
              }}
              onReleased={
                selfScope
                  ? (fan) => {
                      setNotice(`Main rendue à l’agent pour ${fan}\u00a0: ta note est gardée.`);
                      onSelect(null);
                    }
                  : undefined
              }
              onClosedToYou={
                selfScope
                  ? () => {
                      setNotice(
                        'Cette conversation n’est plus ouverte pour toi\u00a0: hors de ton shift, seules celles dont tu as la main restent ici.',
                      );
                      onSelect(null);
                    }
                  : undefined
              }
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
          {/* The fan first: the chatter looks for a fan, then reads why he waits (D-03). */}
          <span className="nv-convo__name">
            {todo.title}
            <span className="tr-cause"> · {todoLabel(todo)}</span>
            {withCreator ? <span className="tr-cause"> · {todo.creatorName}</span> : null}
          </span>
          <span className="nv-convo__preview tr-why">{todo.why}</span>
        </span>
        <span className="nv-convo__side tr-wait">{duration(todo.waitingMinutes)}</span>
      </button>
    </li>
  );
}

/**
 * One failure of the agent behind several fans (recette AGT-05): the cause first, how many fans wait, the sentence and
 * the longest wait of them; it opens the latest. A missing persona names its creator; the others are everyone's.
 */
function QueueGroupRow({
  group,
  withCreator,
  isOpen,
  onOpen,
}: {
  group: Extract<QueueEntry<CreatorTodo>, { kind: 'group' }>;
  withCreator: boolean;
  isOpen: boolean;
  onOpen: () => void;
}): JSX.Element {
  const { oldest } = group;
  return (
    <li>
      <button
        type="button"
        className="nv-convo tr-row tr-row--open"
        aria-current={isOpen ? 'true' : undefined}
        onClick={onOpen}
      >
        <span className={`nv-dot nv-tone--${oldest.tone}`} aria-hidden="true" />
        <span className="nv-convo__main">
          <span className="nv-convo__name">
            {todoLabel(oldest)}
            <span className="tr-cause"> · {fansWaiting(group.todos.length)}</span>
            {withCreator && group.cause === 'persona_inactive' ? (
              <span className="tr-cause"> · {oldest.creatorName}</span>
            ) : null}
          </span>
          <span className="nv-convo__preview tr-why">{oldest.why}</span>
        </span>
        <span className="nv-convo__side tr-wait">{duration(oldest.waitingMinutes)}</span>
      </button>
    </li>
  );
}

/**
 * A conversation of the list: his pseudo first, his messages without an answer and whose fan he is beside it (D-03),
 * when he wrote under it. The state shows only where it tells something: in « À toi », why a person must act; elsewhere
 * the group's title says it, but for a pause and another person's hand (CHAT-22, EQ-13).
 */
function Row({
  conversation,
  hand,
  selfScope,
  creatorName,
  stopped,
  now,
  isOpen,
  onOpen,
}: {
  conversation: ConversationSummary;
  /** The group the line is in: its state is said once, by the group. */
  hand: Hand;
  /** A member whose scope is `self`: another person's hand is said beside it, in the quiet ones. */
  selfScope: boolean;
  /** Shown beside his pseudo when the account sees several creators, never cut. */
  creatorName: string | undefined;
  /** Her emergency stop is on: a draft waits for it to be lifted, so the line never says « À valider » (CHAT-07). */
  stopped: boolean;
  now: Date;
  isOpen: boolean;
  onOpen: () => void;
}): JSX.Element {
  const name = conversation.fanDisplayName.trim() === '' ? 'Fan sans nom' : conversation.fanDisplayName;
  const line = subline(conversation, now);
  const situation =
    stopped && conversation.state === 'awaiting_approval'
      ? STOP_SITUATION
      : situationOf(conversation, selfScope);
  // Outside « À toi », only a pause and another person's hand are worth a word: the group says the rest.
  const says =
    hand === 'yours'
      ? 'pill'
      : conversation.state === 'paused' || conversation.state === 'human'
        ? 'word'
        : null;
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
            {/* What it counts: his messages since the last answer, which reading does not lower (CHAT-13). */}
            {conversation.unreadCount > 0 ? (
              <span
                className="tr-unread nv-num"
                aria-label={`${String(conversation.unreadCount)} sans réponse`}
              >
                {conversation.unreadCount}
              </span>
            ) : null}
            {creatorName === undefined ? null : (
              <span className="nv-tag nv-tag--declared tr-row__creator" title={creatorName}>
                {creatorName}
              </span>
            )}
          </span>
          <span className="nv-convo__preview">
            {line.band === null ? line.text : `${line.text} · ${line.band}`}
          </span>
        </span>
        {says === null ? null : (
          <span className="nv-convo__side">
            {says === 'pill' ? (
              <span className={`nv-status ${situation.pill}`}>
                <span className="nv-status__dot" />
                {situation.label}
              </span>
            ) : (
              <span className="nv-meta">{situation.label}</span>
            )}
          </span>
        )}
      </button>
    </li>
  );
}

/**
 * What a chatter is told once above his list: the hand he gave back went through (CHAT-08), or the conversation he read
 * closed to him (EQ-13). A non-breaking space keeps « : » on its word's line.
 */
function noticeOf(text: string | null): JSX.Element | null {
  if (text === null) return null;
  return (
    <p className="tr-released" role="status">
      {text}
    </p>
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

/**
 * The emergency stop, said before a decision (recette CHAT-07): in amber, like every warning, with what this reader can
 * do about it. `names` lists the creators it holds when Suivi shows several; empty for one creator, or all of them.
 */
function StopBanner({
  names,
  liftsStop,
  creatorId,
}: {
  names: readonly string[];
  liftsStop: boolean;
  /** The one creator stopped: the link opens her Dashboard, where her stop is lifted. */
  creatorId: string | undefined;
}): JSX.Element {
  const whom = names.length === 0 ? '' : ` pour ${names.join(', ')}`;
  // Only what is stopped: another creator followed here keeps sending (recette CHAT-07, v2).
  const whose = names.length > 1 ? 'Leurs envois' : names.length === 1 ? 'Ses envois' : 'Les envois';
  return (
    <Panel className="tr-stop">
      <p className="tr-stop__in" role="status">
        <span className="nv-orb nv-tone--warn" aria-hidden="true" />
        <span>
          <strong>L’arrêt d’urgence est actif{whom}.</strong>{' '}
          {liftsStop ? (
            <>
              Rien ne part tant qu’il n’est pas levé sur le{' '}
              <Link to="/" search={dashboardSearch('day', creatorId)} className="tr-stop__link">
                Dashboard
              </Link>
              .
            </>
          ) : (
            `${whose} sont en pause\u00a0: préviens ton responsable si ça dure.`
          )}
        </span>
      </p>
    </Panel>
  );
}
