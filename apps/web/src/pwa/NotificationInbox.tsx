import { useQuery } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { useMemo, useState, type JSX } from 'react';

import {
  byDay,
  clockOfInstant,
  FAMILY_ICON,
  FAMILY_OF,
  FAMILY_WORDS,
  familyCounts,
  headline,
  inboxQuery,
  type InboxFamily,
} from './inbox';

import { NavIcon } from '@/shell/NavIcon';
import { useLit } from '@/shell/figures/figures';
import { Panel, PanelSection } from '@/shell/layout';
import { Failure, Skeleton, SkeletonCard } from '@/shell/states';

/**
 * « Tes notifications » (trou 9 du 21/11): the last seven days of the account, the ones kept without ringing included,
 * which the morning recap says « t’attendent dans Impera ». At the top of /notifications, above the device and the
 * quiet hours: how many this week first, then a bar of what they were about (a family lit by hover, finger or keyboard
 * dims the others and their lines), then each line by day, its family's icon, a touch away from its page.
 */
export function NotificationInbox({ now: given }: { now?: Date }): JSX.Element {
  const [now] = useState(() => given ?? new Date());
  const inbox = useQuery(inboxQuery);
  const router = useRouter();
  const { lit, row } = useLit();
  const items = inbox.data?.items;
  const days = useMemo(() => (items === undefined ? [] : byDay(items, now)), [items, now]);
  const counts = useMemo(() => (items === undefined ? [] : familyCounts(items)), [items]);

  if (items === undefined) {
    return inbox.isError ? (
      <Failure
        onRetry={() => {
          void inbox.refetch();
        }}
      />
    ) : (
      <Skeleton label="Chargement de tes notifications…">
        <SkeletonCard lines={3} />
      </Skeleton>
    );
  }

  const litFamily: InboxFamily | null = lit === null ? null : (counts[lit]?.family ?? null);
  const answer = headline(items);
  return (
    <Panel eyebrow="Tes 7 derniers jours" className="nv-inbox">
      <div className="nv-inbox__body" data-lit={litFamily ?? undefined}>
        <PanelSection className="nv-inbox__head">
          <p className="nv-inbox__answer">
            <span className="nv-inbox__big">{answer.big}</span>
            {answer.small === null ? null : <span className="nv-inbox__small">{answer.small}</span>}
          </p>
          {items.length === 0 ? (
            <p className="nv-notif__hint">
              Quand Impera te préviendra de quelque chose, ça restera ici une semaine.
            </p>
          ) : (
            <>
              <div className="nv-inbox__bar" aria-hidden="true">
                {counts.map((c, index) => (
                  <span
                    key={c.family}
                    className="nv-inbox__seg"
                    data-family={c.family}
                    style={{ flexGrow: c.count, '--nv-i': index }}
                  />
                ))}
              </div>
              <ul className="nv-inbox__legend">
                {counts.map((c, index) => (
                  <li key={c.family}>
                    <button
                      type="button"
                      className="nv-inbox__key"
                      data-family={c.family}
                      aria-pressed={lit === index}
                      {...row(index)}
                    >
                      <span className="nv-inbox__icon" aria-hidden="true">
                        <NavIcon name={FAMILY_ICON[c.family]} />
                      </span>
                      {FAMILY_WORDS[c.family]} <span className="nv-num">{c.count}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </PanelSection>
        {days.map((day) => (
          <PanelSection key={day.key} label={day.label} className="nv-inbox__day">
            <ul className="nv-inbox__list">
              {day.items.map((item, index) => {
                const family = FAMILY_OF[item.reason];
                return (
                  <li key={item.id} style={{ '--nv-i': index }}>
                    <a
                      className="nv-inbox__item"
                      href={item.url}
                      data-family={family}
                      onClick={(event) => {
                        event.preventDefault();
                        void router.navigate({ href: item.url });
                      }}
                    >
                      <span className="nv-inbox__icon" title={FAMILY_WORDS[family]}>
                        <NavIcon name={FAMILY_ICON[family]} />
                      </span>
                      <span className="nv-inbox__text">
                        <span className="nv-inbox__title">{item.title}</span>
                        {item.quiet ? <span className="nv-inbox__tag">Sans sonner</span> : null}
                      </span>
                      <time className="nv-inbox__time nv-num" dateTime={item.at}>
                        {clockOfInstant(item.at)}
                      </time>
                      <svg className="nv-inbox__go" viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M9 6l6 6-6 6" />
                      </svg>
                    </a>
                  </li>
                );
              })}
            </ul>
          </PanelSection>
        ))}
      </div>
    </Panel>
  );
}
