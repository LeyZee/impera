import type { AlertTriggerItem, CreatorSummary } from '@nirvana/contracts';
import { Link } from '@tanstack/react-router';
import { useId, useRef, useState, type JSX, type ReactNode } from 'react';

import { Reader } from '../Reader';
import '../tracking.css';

import {
  HISTORY_ERRORS,
  historyErrorKind,
  markAllSeen,
  markSeen,
  useHistory,
  useRefreshHistory,
  type HistoryErrorKind,
} from './api';
import './history.css';
import {
  alertChoices,
  alertsOf,
  ownedAlerts,
  type KnownAlert,
  choiceOf,
  markAllTargets,
  markedLine,
  mergeTriggers,
  reasonAddsSomething,
  whenLine,
  type AlertChoice,
} from './model';

import { useCreators } from '@/creators/api';
import { readerZone } from '@/scheduling/time';
import { useNow } from '@/scheduling/useNow';
import { useAlerts } from '@/settings/alerts/api';
import { Page, PageHeader, Panel } from '@/shell/layout';

/** The conversation a line opened, with its creator: the reader needs both, and the list may change under it. */
interface Opened {
  readonly conversationId: string;
  readonly creatorId: string;
}

/**
 * Suivi › Historique des alertes (P4-01, ADR 0024): every alert of her creators that rang, the newest first, with the
 * line the server writes, the fan and the moment; a line opens its conversation beside the list. It is not an inbox:
 * an alert that paused the agent has its line in « À traiter » too, and nothing here counts in red. « Vu » is the
 * agency's, one for the whole team.
 */
export function AlertHistoryPage({
  selected,
  onSelect,
  canDecide,
  isOwner,
  nav,
}: {
  /** The conversation open in the reader (`/suivi/alertes?conversation=<id>`). */
  selected: string | null;
  onSelect: (conversationId: string | null) => void;
  canDecide: boolean;
  /** The owner names her alerts from Réglages › Alertes too, before they have rung under a filter. */
  isOwner: boolean;
  /** Suivi's sub-views. */
  nav: ReactNode;
}): JSX.Element {
  const creatorsQuery = useCreators();
  const creators = creatorsQuery.data ?? [];
  const [creator, setCreator] = useState<string | null>(null);
  const [unseen, setUnseen] = useState(false);
  const [alert, setAlert] = useState<AlertChoice | null>(null);
  const [pages, setPages] = useState(1);
  const [opened, setOpened] = useState<Opened | null>(null);
  const scope = creator === null ? creators.map((one) => one.id) : [creator];
  const history = useHistory(scope, { unseen, alert }, pages);
  const merged = mergeTriggers(history.lists.filter((list) => scope.includes(list.creatorId)));

  const open =
    selected === null
      ? null
      : opened?.conversationId === selected
        ? opened.creatorId
        : (merged.items.find((item) => item.conversationId === selected)?.creatorId ??
          (creators.length === 1 ? (creators[0]?.id ?? null) : null));

  const filtersChange = (change: () => void): void => {
    change();
    setPages(1);
  };

  return (
    <Page className={selected === null ? 'tr-page' : 'tr-page tr-is-reading'}>
      <PageHeader
        eyebrow={creators.length === 1 ? creators[0]?.displayName : undefined}
        title="Suivi"
        lead={
          <>
            Chaque alerte qui a sonné, la plus récente d’abord. Ce qui demande une main est dans{' '}
            <Link to="/suivi" className="hi-lead-link">
              «&nbsp;À traiter&nbsp;»
            </Link>
            .
          </>
        }
        actions={nav}
      />
      {creatorsQuery.isError ? (
        <Notice
          title="Le serveur ne répond pas"
          text="La liste n’a pas pu être lue. Réessaie dans un instant."
        >
          <button
            type="button"
            className="nv-btn nv-btn--soft nv-btn--sm"
            onClick={() => {
              void creatorsQuery.refetch();
            }}
          >
            Réessayer
          </button>
        </Notice>
      ) : creatorsQuery.isPending ? (
        <Skeleton />
      ) : creators.length === 0 ? (
        <Notice
          title="Aucune créatrice pour l’instant"
          text="Ses alertes arrivent ici dès qu’une créatrice t’est confiée."
        />
      ) : (
        <div className="tr-layout">
          <div className="tr-side">
            <History
              creators={creators}
              creator={creator}
              unseen={unseen}
              alert={alert}
              isOwner={isOwner}
              items={merged.items}
              hasMore={merged.hasMore}
              pending={history.pending}
              stale={history.stale}
              error={history.error === null ? null : historyErrorKind(history.error)}
              selected={selected}
              onRetry={history.refetch}
              onCreator={(next) => {
                filtersChange(() => {
                  setCreator(next);
                });
              }}
              onUnseen={(next) => {
                filtersChange(() => {
                  setUnseen(next);
                });
              }}
              onAlert={(next) => {
                filtersChange(() => {
                  setAlert(next);
                });
              }}
              onMore={() => {
                setPages((before) => before + 1);
              }}
              onOpen={(item) => {
                setOpened({ conversationId: item.conversationId, creatorId: item.creatorId });
                onSelect(item.conversationId);
              }}
            />
          </div>
          {selected === null ? (
            <section className="nv-plate tr-reader tr-reader--idle" aria-label="Conversation">
              <p className="tr-reader__empty">Choisis une alerte à gauche : sa conversation s’ouvre ici.</p>
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
              backLabel="Toutes les alertes"
            />
          )}
        </div>
      )}
    </Page>
  );
}

function History({
  creators,
  creator,
  unseen,
  alert,
  isOwner,
  items,
  hasMore,
  pending,
  stale,
  error,
  selected,
  onRetry,
  onCreator,
  onUnseen,
  onAlert,
  onMore,
  onOpen,
}: {
  creators: readonly CreatorSummary[];
  creator: string | null;
  unseen: boolean;
  alert: AlertChoice | null;
  isOwner: boolean;
  items: readonly AlertTriggerItem[];
  hasMore: boolean;
  pending: boolean;
  /** The lines shown are those of the previous filter or depth, while the new read comes. */
  stale: boolean;
  error: HistoryErrorKind | null;
  selected: string | null;
  onRetry: () => void;
  onCreator: (creatorId: string | null) => void;
  onUnseen: (unseen: boolean) => void;
  onAlert: (alert: AlertChoice | null) => void;
  onMore: () => void;
  onOpen: (item: AlertTriggerItem) => void;
}): JSX.Element {
  const id = useId();
  const now = useNow();
  const zone = readerZone();
  const refresh = useRefreshHistory();
  const owned = useAlerts({ enabled: isOwner });
  // Her alerts named once read, so that the filter still offers them when it narrows the list to one.
  const named = useRef(new Map<string, KnownAlert>());
  for (const one of [...ownedAlerts(owned.data?.custom ?? []), ...alertsOf(items)])
    named.current.set(`${one.groupId} ${one.creatorId}`, one);
  const choices = alertChoices([...named.current.values()], creator, alert);
  const [marking, setMarking] = useState<ReadonlySet<string>>(new Set());
  const [markingAll, setMarkingAll] = useState(false);
  const [said, setSaid] = useState<{ readonly text: string; readonly failed: boolean } | null>(null);
  const names = new Map(creators.map((one) => [one.id, one.displayName]));
  const several = creators.length > 1;
  const anyUnseen = items.some((item) => item.seenAt === null);

  const seeOne = async (item: AlertTriggerItem): Promise<void> => {
    setMarking((before) => new Set([...before, item.id]));
    setSaid(null);
    try {
      await markSeen(item.creatorId, item.id);
    } catch (failure) {
      setSaid({ text: HISTORY_ERRORS[historyErrorKind(failure)], failed: true });
    }
    await refresh();
    setMarking((before) => new Set([...before].filter((one) => one !== item.id)));
  };

  const seeAll = async (): Promise<void> => {
    setMarkingAll(true);
    setSaid(null);
    const targets = markAllTargets(items);
    const answers = await Promise.allSettled(
      targets.map((target) => markAllSeen({ ...target, ...(alert === null ? {} : { alert }) })),
    );
    await refresh();
    setMarkingAll(false);
    const failure = answers.find((answer) => answer.status === 'rejected');
    setSaid(
      failure === undefined
        ? {
            text: markedLine(
              answers.reduce(
                (total, answer) => total + (answer.status === 'fulfilled' ? answer.value : 0),
                0,
              ),
            ),
            failed: false,
          }
        : { text: HISTORY_ERRORS[historyErrorKind(failure.reason)], failed: true },
    );
  };

  return (
    <Panel
      className="tr-panel hi-panel"
      actions={
        anyUnseen ? (
          <button
            type="button"
            className="nv-btn nv-btn--soft nv-btn--sm"
            // While another filter is read, the lines shown are the old one's: their newest is no `untilId` for it.
            disabled={markingAll || stale}
            aria-busy={markingAll}
            onClick={() => {
              void seeAll();
            }}
          >
            {markingAll ? 'Marquage…' : 'Tout marquer comme vu'}
          </button>
        ) : undefined
      }
    >
      <div className="hi-filters" role="group" aria-label="Filtres">
        <button
          type="button"
          className="nv-chip"
          aria-pressed={unseen}
          onClick={() => {
            onUnseen(!unseen);
          }}
        >
          Non vues
        </button>
        <label className="sr-only" htmlFor={`${id}-alert`}>
          Alerte
        </label>
        <select
          id={`${id}-alert`}
          className="nv-field__control nv-glass hi-select"
          value={alert ?? ''}
          onChange={(event) => {
            onAlert(choiceOf(event.target.value));
          }}
        >
          <option value="">Toutes les alertes</option>
          {choices.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </select>
        {several ? (
          <>
            <label className="sr-only" htmlFor={`${id}-creator`}>
              Créatrice
            </label>
            <select
              id={`${id}-creator`}
              className="nv-field__control nv-glass hi-select"
              value={creator ?? ''}
              onChange={(event) => {
                onCreator(creators.find((one) => one.id === event.target.value)?.id ?? null);
              }}
            >
              <option value="">Toutes les créatrices</option>
              {creators.map((one) => (
                <option key={one.id} value={one.id}>
                  {one.displayName}
                </option>
              ))}
            </select>
          </>
        ) : null}
      </div>

      {said === null ? null : (
        <p
          className={said.failed ? 'hi-said hi-said--failed' : 'hi-said'}
          role={said.failed ? 'alert' : 'status'}
        >
          {said.text}
        </p>
      )}

      {error !== null && items.length === 0 ? (
        <div className="hi-empty">
          <p>{HISTORY_ERRORS[error]}</p>
          {error === 'unavailable' ? (
            <button type="button" className="nv-btn nv-btn--soft nv-btn--sm" onClick={onRetry}>
              Réessayer
            </button>
          ) : null}
        </div>
      ) : pending && items.length === 0 ? (
        <Skeleton bare />
      ) : items.length === 0 ? (
        <p className="hi-empty">
          {alert !== null
            ? unseen
              ? 'Rien de nouveau pour cette alerte.'
              : 'Cette alerte n’a pas encore sonné.'
            : unseen
              ? 'Tout est vu.'
              : 'Aucune alerte n’a encore sonné. Elles se règlent dans Réglages › Alertes.'}
        </p>
      ) : (
        <div className="nv-scroll">
          <ul className="nv-list tr-list hi-list" aria-label="Alertes" aria-busy={stale}>
            {items.map((item) => (
              <Line
                key={item.id}
                item={item}
                creatorName={several ? names.get(item.creatorId) : undefined}
                when={whenLine(item.at, now, zone)}
                isOpen={item.conversationId === selected}
                marking={marking.has(item.id)}
                onOpen={() => {
                  onOpen(item);
                }}
                onSeen={() => {
                  void seeOne(item);
                }}
              />
            ))}
          </ul>
          {error === null ? null : (
            <p className="hi-said hi-said--failed" role="alert">
              {HISTORY_ERRORS[error]}
            </p>
          )}
          {hasMore ? (
            <div className="hi-more">
              <button
                type="button"
                className="nv-btn nv-btn--plain nv-btn--sm"
                disabled={stale}
                onClick={onMore}
              >
                Voir plus
              </button>
            </div>
          ) : null}
        </div>
      )}
    </Panel>
  );
}

/** One trigger: her alert, the line the server wrote, the fan and the moment; « Vu » or « Marquer comme vu ». */
function Line({
  item,
  creatorName,
  when,
  isOpen,
  marking,
  onOpen,
  onSeen,
}: {
  item: AlertTriggerItem;
  /** Shown when the account follows several creators. */
  creatorName: string | undefined;
  when: string;
  isOpen: boolean;
  marking: boolean;
  onOpen: () => void;
  onSeen: () => void;
}): JSX.Element {
  const fan = item.fanDisplayName.trim() === '' ? 'Fan sans nom' : item.fanDisplayName;
  const seen = item.seenAt !== null;
  return (
    <li className="hi-line nv-enter" data-seen={seen ? 'true' : undefined}>
      <button
        type="button"
        className="nv-convo tr-row hi-line__open"
        aria-current={isOpen ? 'true' : undefined}
        onClick={onOpen}
      >
        <span className="hi-line__mark" aria-hidden="true" />
        <span className="nv-convo__main">
          <span className="nv-convo__name hi-line__name">
            {seen ? null : <span className="sr-only">Non vue : </span>}
            {item.alertName}
            {item.pausedAgent ? <span className="nv-tag hi-line__tag">Agent en pause</span> : null}
          </span>
          {reasonAddsSomething(item) ? <span className="hi-line__reason">{item.reason}</span> : null}
          <span className="nv-convo__preview">
            {creatorName === undefined ? fan : `${fan} · ${creatorName}`}
          </span>
        </span>
        <span className="nv-convo__side">
          <span className="nv-convo__time">{when}</span>
          {seen ? <span className="hi-line__seen">Vu</span> : null}
        </span>
      </button>
      {seen ? null : (
        <button
          type="button"
          className="hi-line__see"
          disabled={marking}
          aria-busy={marking}
          aria-label={`Marquer comme vu : ${item.alertName}, ${fan}`}
          onClick={onSeen}
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path
              d="M3.5 8.5l3 3 6-7"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      )}
    </li>
  );
}

function Skeleton({ bare = false }: { bare?: boolean }): JSX.Element {
  const bones = (
    <div className="tr-skeleton" aria-hidden="true">
      <i />
      <i />
      <i />
    </div>
  );
  return bare ? bones : <Panel className="tr-panel">{bones}</Panel>;
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
