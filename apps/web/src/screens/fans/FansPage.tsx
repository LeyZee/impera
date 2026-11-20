import {
  FAN_LAPSED_DAYS_DEFAULT,
  type AgencyPeriod,
  type FanListFilter,
  type FanListItem,
  type FanListSort,
} from '@impera/contracts';
import { Link } from '@tanstack/react-router';
import { useDeferredValue, useEffect, useId, useState, type JSX, type ReactNode } from 'react';

import { FANS_ERRORS, fansErrorKind, useFans } from './api';
import './fans.css';
import {
  EMPTY_LINES,
  FILTERS,
  PERIOD_LABELS,
  SORT_LABELS,
  countLine,
  filterLabel,
  holderLine,
  paidLines,
  shortWhen,
  shownStates,
  STATE_WORDS,
} from './model';

import { useCreators } from '@/creators/api';
import { Select } from '@/shell/Select';
import { Page, PageHeader, Panel } from '@/shell/layout';
import { Failure, Skeleton, SkeletonCard } from '@/shell/states';

const PERIODS: readonly AgencyPeriod[] = ['week', 'month', 'quarter'];
const SORTS: readonly FanListSort[] = ['last_message', 'paid', 'last_payment'];

/**
 * Chatting › Fans (ADR 0124): every fan the CRM knows for one creator, for the owner and an active manager of her list.
 * His pseudonym, who holds him, his states and what he paid; a line opens his conversation in Suivi. Read only: nothing
 * here writes, and no button acts.
 */
export function FansPage({
  nav,
  scoped = null,
}: {
  nav?: ReactNode;
  /** The creator the menu's selector is set on (ADR 0134 § 3), or null on « Toutes »: the list then asks which one. */
  scoped?: string | null;
}): JSX.Element {
  const creatorsQuery = useCreators();
  const creators = creatorsQuery.data ?? [];
  const [chosen, setChosen] = useState<string | null>(null);
  const creatorId = scoped ?? chosen ?? creators[0]?.id ?? null;
  const creator = creators.find((one) => one.id === creatorId);
  const id = useId();

  return (
    <Page className="fa-page">
      <PageHeader
        eyebrow="Suivi"
        title="Fans"
        tabs={nav}
        lead={`Chaque fan que le CRM connaît pour ${creator?.displayName ?? 'elle'}, qui le tient et ce qu’il a payé. Une ligne ouvre sa conversation dans Suivi.`}
        actions={
          creators.length > 1 && creatorId !== null && scoped === null ? (
            <>
              <label className="sr-only" htmlFor={`${id}-creator`}>
                Créatrice
              </label>
              <Select<string>
                id={`${id}-creator`}
                className="fa-select"
                value={creatorId}
                options={creators.map((one) => ({ value: one.id, label: one.displayName }))}
                onChange={(next) => {
                  setChosen(next);
                }}
              />
            </>
          ) : undefined
        }
      />
      {creatorsQuery.isError ? (
        <Failure
          onRetry={() => {
            void creatorsQuery.refetch();
          }}
        />
      ) : creatorsQuery.isPending ? (
        <Skeleton>
          <SkeletonCard lines={5} />
        </Skeleton>
      ) : creatorId === null ? (
        <Panel className="fa-panel">
          <p className="fa-empty">
            Aucune créatrice pour l’instant : ses fans arrivent ici dès qu’une t’est confiée.
          </p>
        </Panel>
      ) : (
        <FanList key={creatorId} creatorId={creatorId} />
      )}
    </Page>
  );
}

function FanList({ creatorId }: { creatorId: string }): JSX.Element {
  const id = useId();
  const [filter, setFilter] = useState<FanListFilter>('all');
  const [sort, setSort] = useState<FanListSort>('last_message');
  const [period, setPeriod] = useState<AgencyPeriod>('month');
  const [search, setSearch] = useState('');
  const q = useDeferredValue(search);
  const fans = useFans({ creatorId, filter, sort, period, q });
  const now = useNow();
  const pages = fans.data?.pages ?? [];
  const items = pages.flatMap((page) => page.items);
  const first = pages[0];
  const stale = fans.isPlaceholderData;

  return (
    <Panel className="fa-panel">
      <div className="fa-tools">
        <label className="fa-search">
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
      </div>
      <div className="fa-chips" role="group" aria-label="Filtres">
        {FILTERS.map((one) => (
          <button
            key={one}
            type="button"
            className="nv-chip"
            aria-pressed={filter === one}
            onClick={() => {
              setFilter(one);
            }}
          >
            {filterLabel(one, FAN_LAPSED_DAYS_DEFAULT)}
          </button>
        ))}
      </div>
      <div className="fa-bar">
        <p className="fa-count" aria-live="polite">
          {/* Its line kept while it reads or fails, so the selectors never jump. */}
          {first === undefined ? '\u00a0' : countLine(first.total)}
        </p>
        <label className="sr-only" htmlFor={`${id}-period`}>
          Période
        </label>
        <Select<AgencyPeriod>
          id={`${id}-period`}
          className="fa-select"
          value={period}
          options={PERIODS.map((one) => ({ value: one, label: PERIOD_LABELS[one] ?? one }))}
          onChange={setPeriod}
        />
        <label className="sr-only" htmlFor={`${id}-sort`}>
          Trier par
        </label>
        <Select<FanListSort>
          id={`${id}-sort`}
          className="fa-select"
          value={filter === 'big_payers' ? 'paid' : sort}
          disabled={filter === 'big_payers'}
          options={SORTS.map((one) => ({ value: one, label: SORT_LABELS[one] }))}
          onChange={setSort}
        />
      </div>

      {fans.isError && items.length === 0 ? (
        fansErrorKind(fans.error) === 'unavailable' ? (
          // The server is silent: the app's one way to say it (ETA-04), inside the list's card.
          <Failure
            inline
            onRetry={() => {
              void fans.refetch();
            }}
          />
        ) : (
          <p className="fa-empty" role="alert">
            {FANS_ERRORS[fansErrorKind(fans.error)]}
          </p>
        )
      ) : fans.isPending ? (
        <Skeleton className="fa-skeleton">
          {[0, 1, 2].map((row) => (
            <i key={row} className="nv-skeleton__bar fa-skeleton__row" />
          ))}
        </Skeleton>
      ) : items.length === 0 ? (
        <p className="fa-empty">{q.trim() === '' ? EMPTY_LINES[filter] : 'Aucun fan ne porte ce pseudo.'}</p>
      ) : (
        <>
          <div className="fa-head" aria-hidden="true">
            <span>Fan</span>
            <span>États</span>
            <span>Tenu par</span>
            <span>Dernier message</span>
            <span>Dernier paiement</span>
            <span className="fa-num">Sur la période</span>
            <span className="fa-num">Depuis toujours</span>
          </div>
          <ul className="nv-list fa-list" aria-label="Fans" aria-busy={stale}>
            {items.map((item) => (
              <Line key={item.fanId} item={item} creatorId={creatorId} now={now} />
            ))}
          </ul>
          {fans.hasNextPage ? (
            <div className="fa-more">
              <button
                type="button"
                className="nv-btn nv-btn--soft nv-btn--sm"
                disabled={fans.isFetchingNextPage}
                aria-busy={fans.isFetchingNextPage}
                onClick={() => {
                  void fans.fetchNextPage();
                }}
              >
                {fans.isFetchingNextPage ? 'Lecture…' : 'Voir la suite'}
              </button>
            </div>
          ) : null}
        </>
      )}
      {first === undefined ? null : (
        <p className="fa-note">
          {first.sharedFansKnown
            ? 'Seuls les fans qui ont écrit depuis le branchement de Reveal sont listés.'
            : 'Seuls les fans qui ont écrit depuis le branchement de Reveal sont listés. Les fans communs à plusieurs créatrices ne se lisent pas encore\u00a0: Reveal ne dit pas si un fan est le même d’un compte à l’autre.'}
        </p>
      )}
    </Panel>
  );
}

function Line({ item, creatorId, now }: { item: FanListItem; creatorId: string; now: Date }): JSX.Element {
  const name = item.displayName.trim() === '' ? 'Fan sans nom' : item.displayName;
  const { shown, more } = shownStates(item.states);
  // On a phone, one state and the count of the others (avis Design 16/11, fans-1).
  const phoneMore = Math.max(0, item.states.length - 1);
  const cells = (
    <>
      <span className="fa-name">{name}</span>
      <span className="fa-states">
        {shown.map((state, index) => (
          <span
            key={state}
            className={`nv-tag fa-tag fa-tag--${STATE_WORDS[state].tone}${index > 0 ? ' fa-tag--second' : ''}`}
          >
            {STATE_WORDS[state].label}
          </span>
        ))}
        {more > 0 ? <span className="nv-tag fa-tag fa-more-wide">+{more}</span> : null}
        {phoneMore > 0 ? <span className="nv-tag fa-tag fa-more-phone">+{phoneMore}</span> : null}
      </span>
      <span className="fa-holder">{holderLine(item)}</span>
      <span className="fa-when">{shortWhen(item.lastMessageAt, now)}</span>
      <span className="fa-paid-at">{shortWhen(item.lastPaidAt, now)}</span>
      <Paid paid={item.paidPeriod} base="fa-period" />
      <Paid paid={item.paidEver} base="fa-ever" />
    </>
  );
  return (
    <li>
      {item.conversationId === null ? (
        <div className="fa-row">
          {cells}
          <span className="fa-chevron" aria-hidden="true" />
        </div>
      ) : (
        <Link
          to="/suivi"
          search={{ conversation: item.conversationId, creatrice: creatorId }}
          className="fa-row fa-row--open"
          aria-label={`${name} : ouvrir sa conversation dans Suivi`}
        >
          {cells}
          <span className="fa-chevron" aria-hidden="true">
            ›
          </span>
        </Link>
      )}
    </li>
  );
}

/** One line a currency, aligned right (avis Design 16/11, fans-1); « — » in grey for nothing. */
function Paid({ paid, base }: { paid: FanListItem['paidEver']; base: string }): JSX.Element {
  const zero = paid.eurMinor === 0 && paid.usdMinor === 0;
  return (
    <span className={zero ? `fa-num ${base} fa-zero` : `fa-num ${base}`}>
      {paidLines(paid).map((line) => (
        <span key={line} className="fa-amount">
          {line}
        </span>
      ))}
    </span>
  );
}

/** The clock the « il y a » words read, ticking every minute. */
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
