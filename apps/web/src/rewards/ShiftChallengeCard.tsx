import type { Me, ShiftChallenge } from '@impera/contracts';
import type { JSX } from 'react';

import { GameGauge } from './GameGauge';
import { playsTheGame, useMyShiftChallenge } from './api';
import './rewards.css';

import { amountText } from '@/reports/model';
import { Panel } from '@/shell/layout';

/** The weekday of an instant in a zone: the shift's day is the member's, never the device's (recette CHT-07). */
const weekdayIn = (at: Date, zone: string): string =>
  new Intl.DateTimeFormat('fr-FR', { weekday: 'long', timeZone: zone }).format(at);

/** How far the shift's net is from its target, from 0 to 100; a net under zero reads as nothing. */
export const challengePercent = (challenge: Pick<ShiftChallenge, 'netMinor' | 'targetMinor'>): number =>
  Math.round(Math.max(0, Math.min(1, challenge.netMinor / challenge.targetMinor)) * 100);

/**
 * Aujourd'hui › « Défi du shift » (ADR 0104 § 14): one challenge a shift, the chatter's own median on the same
 * weekday and slot, nobody else's figure. Nothing shows without one. Met or not, it has no effect on pay (§ 17), and
 * the card says so. The way there wears the blue of every progress, and turns to gold once it is met.
 */
export function ShiftChallengeCard({
  user,
  zone,
}: {
  user: Me;
  /** The zone the page reads its hours in: the member's own, as the shift card beside it. */
  zone: string;
}): JSX.Element | null {
  const challenge = useMyShiftChallenge(playsTheGame(user)).data;
  if (challenge === undefined || challenge === null) return null;
  const { currency, targetMinor, netMinor, met } = challenge;
  const percent = challengePercent(challenge);
  const weekday = weekdayIn(new Date(challenge.shiftStartsAt), zone);
  const left = targetMinor - netMinor;
  return (
    <Panel className="nv-enter rw-challenge" eyebrow="Défi du shift">
      <div className="rw-challenge__body" data-met={met}>
        <p className="rw-challenge__title">
          {met ? 'Défi réussi' : `Fais mieux que ton ${weekday} habituel`}
        </p>
        <p className="rw-challenge__figures nv-num">
          <b>{amountText(Math.max(0, netMinor), currency)}</b> sur {amountText(targetMinor, currency)} de net
        </p>
        <GameGauge
          userId={user.id}
          name="challenge"
          scope={challenge.shiftStartsAt}
          percent={percent}
          label="Avancée du défi"
          className="rw-challenge__gauge"
        />
        <p className="rw-challenge__note">
          {met
            ? `Tu as dépassé ton ${weekday} habituel sur ce créneau.`
            : `Encore ${amountText(left, currency)} de net pour passer ton ${weekday} habituel sur ce créneau.`}{' '}
          Sans effet sur ta paie.
        </p>
      </div>
    </Panel>
  );
}
