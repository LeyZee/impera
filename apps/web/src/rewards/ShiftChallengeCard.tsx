import type { Me, ShiftChallenge } from '@impera/contracts';
import type { JSX } from 'react';

import { playsTheGame, useMyShiftChallenge } from './api';
import './rewards.css';

import { amountText } from '@/reports/model';
import { Panel } from '@/shell/layout';

const WEEKDAY = new Intl.DateTimeFormat('fr-FR', { weekday: 'long' });

/** How far the shift's net is from its target, from 0 to 100; a net under zero reads as nothing. */
export const challengePercent = (challenge: Pick<ShiftChallenge, 'netMinor' | 'targetMinor'>): number =>
  Math.round(Math.max(0, Math.min(1, challenge.netMinor / challenge.targetMinor)) * 100);

/**
 * Aujourd'hui › « Défi du shift » (ADR 0104 § 14): one challenge a shift, the chatter's own median on the same
 * weekday and slot, nobody else's figure. Nothing shows without one. Met or not, it has no effect on pay (§ 17), and
 * the card says so. The way there wears the blue of every progress, and turns to gold once it is met.
 */
export function ShiftChallengeCard({ user }: { user: Me }): JSX.Element | null {
  const challenge = useMyShiftChallenge(playsTheGame(user)).data;
  if (challenge === undefined || challenge === null) return null;
  const { currency, targetMinor, netMinor, met } = challenge;
  const percent = challengePercent(challenge);
  const weekday = WEEKDAY.format(new Date(challenge.shiftStartsAt));
  const left = targetMinor - netMinor;
  return (
    <Panel className="nv-enter rw-challenge" eyebrow="Défi du shift">
      <div className="rw-challenge__body" data-met={met}>
        <p className="rw-challenge__title">
          {met ? 'Défi réussi' : `Fais mieux que ton ${weekday} habituel`}
        </p>
        <p className="rw-challenge__figures nv-num">
          <b>{amountText(Math.max(0, netMinor), currency)}</b> sur {amountText(targetMinor, currency)}
        </p>
        <div
          className="nv-gauge rw-challenge__gauge"
          role="progressbar"
          aria-label="Avancée du défi"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          style={{ '--nv-gauge-value': `${String(percent)}%` }}
        >
          <span className="nv-gauge__fill" />
        </div>
        <p className="rw-challenge__note">
          {met
            ? `Tu as dépassé ta médiane des ${weekday}s sur ce créneau.`
            : `Encore ${amountText(left, currency)} de net pour passer ta médiane des ${weekday}s sur ce créneau.`}{' '}
          Sans effet sur ta paie.
        </p>
      </div>
    </Panel>
  );
}
