import type { CreatorOnDuty } from '@nirvana/contracts';
import type { JSX } from 'react';

import { useCreatorOnDuty } from '@/scheduling/api';
import '@/scheduling/scheduling.css';
import { clockAt, dayOf, dayWordOf, longDay, rangeAt, readerZone, untilOf } from '@/scheduling/time';
import { useNow } from '@/scheduling/useNow';
import { ServerSilent } from '@/shell/ServerSilent';
import { Page, PageHeader, Panel } from '@/shell/layout';

/**
 * Aujourd'hui, the creator's (CR-02, ADR 0042 § 8): her day. Who answers her fans is one quiet card, as on the
 * prototype Charles validated on 02/11 (« pas sur la frise : une seule ligne discrète »), by their display name alone
 * (ADR 0023: nothing else of the team). Her tasks (CR-05) and her last sales (CR-04) come first once they exist. Read
 * in her own time, the browser's.
 */
export function CreatorTodayPage(): JSX.Element {
  const onDuty = useCreatorOnDuty();
  const now = useNow();
  const zone = readerZone();
  const today = dayOf(now, zone);

  return (
    <Page>
      <PageHeader eyebrow={longDay(today)} title="Aujourd’hui" lead="Ta journée, et qui répond à tes fans." />
      {onDuty.isError ? (
        <ServerSilent
          text="Le planning n’a pas pu être lu. Rien ici n’est à jour en attendant."
          onRetry={() => {
            void onDuty.refetch();
          }}
        />
      ) : onDuty.data === undefined ? (
        <div className="sc-today">
          <Panel className="sc-fans">
            <div className="sc-skeleton" aria-hidden="true">
              <i />
              <i />
            </div>
          </Panel>
        </div>
      ) : (
        <div className="sc-today">
          <Panel className="sc-fans nv-enter">
            <h2 className="sc-fans__title">Qui répond à tes fans</h2>
            <p className="sc-fans__line">
              {onDuty.data.current.length === 0 ? (
                onDuty.data.next[0] === undefined ? (
                  'Personne n’est prévu dans les prochaines 24 heures.'
                ) : (
                  `Personne en ce moment. Le prochain commence ${untilOf(new Date(onDuty.data.next[0].startsAt).getTime() - now.getTime())}.`
                )
              ) : (
                <>
                  En ce moment :{' '}
                  <Names
                    shifts={onDuty.data.current}
                    say={(shift) => `jusqu’à ${clockAt(shift.endsAt, zone)}`}
                    handles={handlesShown(onDuty.data)}
                  />
                  .
                </>
              )}
            </p>
            {onDuty.data.next.length === 0 ? null : (
              <p className="sc-fans__line">
                Ensuite :{' '}
                <Names
                  shifts={onDuty.data.next}
                  say={(shift) =>
                    `${dayWordOf(shift.startsAt, zone, today).toLowerCase()} ${rangeAt(shift.startsAt, shift.endsAt, zone)}`
                  }
                  handles={handlesShown(onDuty.data)}
                />
                .
              </p>
            )}
          </Panel>
        </div>
      )}
    </Page>
  );
}

/** Her account is named only when several are on shift for her: one account goes without saying. */
const handlesShown = (list: { current: readonly CreatorOnDuty[]; next: readonly CreatorOnDuty[] }): boolean =>
  new Set([...list.current, ...list.next].map((shift) => shift.handle)).size > 1;

/** « **Iris** jusqu’à 18 h, **Théo** aujourd’hui 18 h – 0 h »: each name, then when. */
function Names({
  shifts,
  say,
  handles,
}: {
  shifts: readonly CreatorOnDuty[];
  say: (shift: CreatorOnDuty) => string;
  handles: boolean;
}): JSX.Element {
  return (
    <>
      {shifts.map((shift, index) => (
        <span key={`${shift.handle}-${shift.startsAt}`}>
          {index === 0 ? null : ', '}
          <b>{shift.displayName}</b> <span className="nv-num">{say(shift)}</span>
          {handles ? ` sur @${shift.handle}` : null}
        </span>
      ))}
    </>
  );
}
