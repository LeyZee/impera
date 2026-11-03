import type { CreatorOnDuty } from '@nirvana/contracts';
import type { JSX } from 'react';

import { useCreatorOnDuty } from '@/scheduling/api';
import { progressOf } from '@/scheduling/model';
import '@/scheduling/scheduling.css';
import { dayOf, dayWordOf, lengthOf, longDay, rangeAt, readerZone, untilOf } from '@/scheduling/time';
import { useNow } from '@/scheduling/useNow';
import { ServerSilent } from '@/shell/ServerSilent';
import { Page, PageHeader, Panel } from '@/shell/layout';

/**
 * Aujourd'hui, the creator's (CR-02, ADR 0042 § 8): who chats for her now, and who takes over in the next 24 hours,
 * by their display name and her account (ADR 0023: nothing else of the team). Read in her own time, the browser's. Her
 * last sales join it with Ventes (CR-04).
 */
export function CreatorTodayPage(): JSX.Element {
  const onDuty = useCreatorOnDuty();
  const now = useNow();
  const zone = readerZone();
  const today = dayOf(now, zone);

  return (
    <Page>
      <PageHeader
        eyebrow={longDay(today)}
        title="Aujourd’hui"
        lead="Qui chatte pour toi en ce moment, et qui prend la suite."
      />
      {onDuty.isError ? (
        <ServerSilent
          text="Le planning n’a pas pu être lu. Rien ici n’est à jour en attendant."
          onRetry={() => {
            void onDuty.refetch();
          }}
        />
      ) : onDuty.data === undefined ? (
        <div className="sc-today">
          <Panel className="sc-hero">
            <div className="sc-skeleton" aria-hidden="true">
              <i />
              <i />
              <i />
            </div>
          </Panel>
        </div>
      ) : (
        <div className="sc-today">
          {onDuty.data.current.length === 0 ? (
            <Panel className="sc-hero sc-hero--none nv-enter">
              <p className="sc-hero__kicker">Personne en poste</p>
              <h2 className="sc-hero__title">Pas de shift en ce moment</h2>
              <p className="sc-hero__note">
                {onDuty.data.next[0] === undefined
                  ? 'Aucun shift n’est prévu dans les prochaines 24 heures.'
                  : `Le prochain commence ${untilOf(new Date(onDuty.data.next[0].startsAt).getTime() - now.getTime())}.`}
              </p>
            </Panel>
          ) : (
            onDuty.data.current.map((shift) => (
              <OnShift key={`${shift.handle}-${shift.startsAt}`} shift={shift} now={now} zone={zone} />
            ))
          )}
          {onDuty.data.next.length === 0 ? null : (
            <Panel className="sc-next nv-enter">
              <p className="nv-eyebrow">Ensuite</p>
              <ul className="sc-next__list">
                {onDuty.data.next.map((shift) => (
                  <li key={`${shift.handle}-${shift.startsAt}`} className="sc-next__row">
                    <div className="sc-next__main">
                      <p className="sc-next__who">{shift.displayName}</p>
                      <p className="sc-next__where">@{shift.handle}</p>
                    </div>
                    <div className="sc-next__side">
                      <p className="sc-next__hours nv-num">
                        {dayWordOf(shift.startsAt, zone, today)} ·{' '}
                        {rangeAt(shift.startsAt, shift.endsAt, zone)}
                      </p>
                      <p className="sc-next__in">
                        {untilOf(new Date(shift.startsAt).getTime() - now.getTime())}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      )}
    </Page>
  );
}

/** One member on shift for her: his name, her account, his hours and what is left of them. */
function OnShift({ shift, now, zone }: { shift: CreatorOnDuty; now: Date; zone: string }): JSX.Element {
  const progress = progressOf(shift, now);
  return (
    <Panel className="sc-hero sc-hero--on nv-enter">
      <div className="sc-hero__top">
        <span className="nv-status sc-state sc-state--on">
          <span className="nv-dot nv-tone--ok nv-dot--live" />
          En poste
        </span>
        <span className="sc-hero__when nv-num">
          encore {lengthOf(new Date(shift.endsAt).getTime() - now.getTime())}
        </span>
      </div>
      <div className="sc-hero__who">
        <h2 className="sc-hero__title">{shift.displayName}</h2>
        <p className="sc-hero__where">@{shift.handle}</p>
      </div>
      <p className="sc-hero__hours nv-num">{rangeAt(shift.startsAt, shift.endsAt, zone)}</p>
      <div
        className="nv-gauge sc-hero__gauge"
        role="progressbar"
        aria-label={`Avancée du shift de ${shift.displayName}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
        style={{ '--nv-gauge-value': `${String(Math.round(progress * 1000) / 10)}%` }}
      >
        <span className="nv-gauge__fill" />
      </div>
    </Panel>
  );
}
