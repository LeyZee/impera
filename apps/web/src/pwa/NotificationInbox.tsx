import { useQuery } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { useMemo, type JSX } from 'react';

import { byDay, clockOfInstant, FAMILY_OF, FAMILY_WORDS, familyCounts, headline, inboxQuery } from './inbox';

import { Panel, PanelSection } from '@/shell/layout';
import { Failure, Skeleton, SkeletonCard } from '@/shell/states';

/**
 * « Tes notifications » (trou 9 du 21/11): the last seven days of the account, the ones kept without ringing included,
 * which the morning recap says « t’attendent dans Impera ». At the top of /notifications, above the device and the
 * quiet hours: the answer first, then a bar of what they were about, then each line, by day, a touch away from its page.
 */
export function NotificationInbox({ now = new Date() }: { now?: Date }): JSX.Element {
  const inbox = useQuery(inboxQuery);
  const router = useRouter();
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

  const quiet = items.filter((item) => item.quiet).length;
  return (
    <Panel title="Tes notifications" eyebrow="7 derniers jours" className="nv-inbox">
      <PanelSection className="nv-inbox__head">
        <p className="nv-inbox__answer" data-quiet={quiet > 0 ? 'some' : 'none'}>
          {headline(items)}
        </p>
        {items.length === 0 ? (
          <p className="nv-notif__hint">
            Quand Impera te préviendra de quelque chose, ça restera ici une semaine.
          </p>
        ) : (
          <>
            <div
              className="nv-inbox__bar"
              role="img"
              aria-label={counts.map((c) => `${FAMILY_WORDS[c.family]} ${String(c.count)}`).join(', ')}
            >
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
              {counts.map((c) => (
                <li key={c.family} data-family={c.family}>
                  <span className="nv-inbox__dot" aria-hidden="true" />
                  {FAMILY_WORDS[c.family]} <span className="nv-num">{c.count}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </PanelSection>
      {days.map((day) => (
        <PanelSection key={day.key} label={day.label} className="nv-inbox__day">
          <ul className="nv-inbox__list">
            {day.items.map((item, index) => (
              <li key={item.id} style={{ '--nv-i': index }}>
                <a
                  className="nv-inbox__item"
                  href={item.url}
                  data-family={FAMILY_OF[item.reason]}
                  onClick={(event) => {
                    event.preventDefault();
                    void router.navigate({ href: item.url });
                  }}
                >
                  <span className="nv-inbox__dot" aria-hidden="true" />
                  <span className="nv-inbox__title">{item.title}</span>
                  {item.quiet ? <span className="nv-inbox__tag">Sans sonner</span> : null}
                  <time className="nv-inbox__time nv-num" dateTime={item.at}>
                    {clockOfInstant(item.at)}
                  </time>
                </a>
              </li>
            ))}
          </ul>
        </PanelSection>
      ))}
    </Panel>
  );
}
