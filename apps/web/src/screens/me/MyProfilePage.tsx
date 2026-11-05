import type { Me, TeamMember } from '@impera/contracts';
import { useState, type JSX } from 'react';

import { MeNav } from './MeNav';
import './me.css';

import { countryName } from '@/lib/country';
import { percentText } from '@/reports/model';
import { useCalendar } from '@/scheduling/api';
import { cityOf, fullDay } from '@/scheduling/time';
import { Loading, Unreachable } from '@/screens/pay/parts';
import { useMembers } from '@/screens/team/api';
import '@/screens/team/team.css';
import { Page, PageHeader, Panel } from '@/shell/layout';

/** An hour from now: the team's calendar names every creator, and so his (a planning read names only those on a shift). */
const HOUR_MS = 3_600_000;

/**
 * Moi › Profil (recette 05/11, CHAT-30): where a chatter or a manager recognises himself, his name in the team, his
 * creators, his rate in force, his country and zone, since when he is in the team. Moi opens on it; the file, a task
 * of once in a while, is the next tab; the appearance and the way out are in Moi › Préférences (D-03).
 */
export function MyProfilePage({ user }: { user: Me }): JSX.Element {
  const members = useMembers();
  const me = members.data?.find((member) => member.userId === user.id) ?? null;
  const manager = user.teamScope === 'agency';

  return (
    <Page>
      <PageHeader
        eyebrow="Moi"
        title={me?.displayName ?? 'Profil'}
        lead="Ce que l’agence sait de toi pour ton travail : tes créatrices, ton taux, ton fuseau."
        actions={<MeNav manager={manager} />}
      />
      <div className="me-profile">
        {me !== null ? (
          <Facts member={me} />
        ) : members.data !== undefined ? (
          <Panel className="nv-enter">
            <p className="tm-warn">Ta fiche d’équipe est introuvable : le propriétaire peut la vérifier.</p>
          </Panel>
        ) : members.isError ? (
          <Panel className="nv-enter">
            <Unreachable
              what="ta fiche"
              onRetry={() => {
                void members.refetch();
              }}
            />
          </Panel>
        ) : (
          <Panel className="nv-enter">
            <Loading rows={4} />
          </Panel>
        )}
      </div>
    </Page>
  );
}

function Facts({ member }: { member: TeamMember }): JSX.Element {
  const [at] = useState(() => Date.now());
  const calendar = useCalendar({
    from: new Date(at).toISOString(),
    to: new Date(at + HOUR_MS).toISOString(),
  });
  const names = (calendar.data?.creators ?? [])
    .filter((creator) => member.creatorIds.includes(creator.id))
    .map((creator) => creator.name);
  const { commission } = member;

  return (
    <Panel className="nv-enter" title="Profil">
      <dl className="tm-facts">
        <div>
          <dt>Rôle</dt>
          <dd>{member.teamRole === 'manager' ? 'Manager' : 'Chatteur'}</dd>
        </div>
        <div>
          <dt>Créatrices</dt>
          <dd>
            {member.creatorIds.length === 0 ? (
              <span className="tm-muted">Aucune créatrice confiée</span>
            ) : names.length === 0 ? (
              <span className="tm-muted">
                {calendar.isPending
                  ? '…'
                  : member.creatorIds.length === 1
                    ? '1 créatrice'
                    : `${String(member.creatorIds.length)} créatrices`}
              </span>
            ) : (
              <span className="nv-tags">
                {names.map((name) => (
                  <span key={name} className="nv-tag nv-tag--declared">
                    {name}
                  </span>
                ))}
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt>Commission</dt>
          <dd>
            {commission === null ? (
              <span className="tm-muted">Pas encore de taux</span>
            ) : (
              <>
                <span className="nv-num">{percentText(commission.rateBps)}</span>
                <span className="tm-muted"> · depuis le {fullDay(commission.effectiveFrom)}</span>
              </>
            )}
          </dd>
        </div>
        <div>
          <dt>Pays</dt>
          <dd>{countryName(member.country)}</dd>
        </div>
        <div>
          <dt>Fuseau</dt>
          <dd>
            {cityOf(member.timeZone)}
            <span className="tm-muted"> · l’heure de tes shifts</span>
          </dd>
        </div>
        <div>
          <dt>Dans l’équipe depuis</dt>
          <dd>{fullDay(member.joinedOn)}</dd>
        </div>
      </dl>
    </Panel>
  );
}
