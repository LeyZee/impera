import { Link } from '@tanstack/react-router';
import type { JSX } from 'react';

import { useMemberSetups } from './api';
import { firstPayoutGaps, gapCount, type FirstPayoutGaps } from './first-payout';
import './setup.css';

import { usePayoutList } from '@/payroll/payout';
import { useMembers } from '@/screens/team/api';

/**
 * Every gap before the first transfer, read for the owner (recette PARC-01): `null` while a list is unread or when the
 * other reads are not his. The setups give each paid member's reasons as they stand now; the team gives the names.
 */
export function useFirstPayoutGaps(owner: boolean): FirstPayoutGaps | null {
  const setups = useMemberSetups(owner);
  const payouts = usePayoutList(owner);
  const members = useMembers(owner);
  if (!owner || setups.data === undefined || members.data === undefined) return null;
  const names = new Map(members.data.map((member) => [member.id, member.displayName] as const));
  return firstPayoutGaps(
    setups.data,
    payouts.data?.destinations ?? null,
    (id) => names.get(id) ?? 'Un membre',
  );
}

/**
 * « Avant ton premier versement », on top of Paie: what the agency settles once, then each member and every gap of
 * his, all at once, each leading where it is settled. Gone once nothing is left.
 */
export function FirstPayoutCard({ gaps }: { gaps: FirstPayoutGaps }): JSX.Element | null {
  const count = gapCount(gaps);
  if (count === 0) return null;
  return (
    <section className="nv-plate su-card nv-enter" aria-labelledby="fp-title">
      <header className="su-head">
        <h2 id="fp-title" className="nv-h3">
          Avant ton premier versement
        </h2>
        <p className="su-count nv-num">
          {count === 1 ? '1 chose à régler' : `${String(count)} choses à régler`}
        </p>
      </header>
      <p className="su-step__hint fp-lead">
        Tout ce qui bloquerait un versement, d’un coup. La liste se vide à mesure.
      </p>
      <ul className="su-list">
        {gaps.agency.length === 0 ? null : (
          <Row label="L’agence" gaps={gaps.agency}>
            <Link to="/reglages/facturation" className="nv-btn nv-btn--soft nv-btn--sm su-go">
              Régler
            </Link>
          </Row>
        )}
        {gaps.members.map((member) => (
          <Row key={member.memberId} label={member.name} gaps={member.gaps}>
            <Link
              to="/equipe/membres/$memberId/dossier"
              params={{ memberId: member.memberId }}
              className="nv-btn nv-btn--soft nv-btn--sm su-go"
              aria-label={`Son dossier : ${member.name}`}
            >
              Son dossier
            </Link>
          </Row>
        ))}
      </ul>
    </section>
  );
}

function Row({
  label,
  gaps,
  children,
}: {
  label: string;
  gaps: readonly string[];
  children: JSX.Element;
}): JSX.Element {
  return (
    <li className="su-step su-step--todo fp-row">
      <svg className="su-mark" viewBox="0 0 20 20" aria-hidden="true">
        <circle cx="10" cy="10" r="8.25" />
      </svg>
      <div className="su-step__text">
        <span className="su-step__label">{label}</span>
        <ul className="fp-gaps">
          {gaps.map((gap) => (
            <li key={gap} className="su-step__hint">
              {gap}
            </li>
          ))}
        </ul>
      </div>
      {children}
    </li>
  );
}
