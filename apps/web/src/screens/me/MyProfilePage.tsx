import type { Me, TeamMember } from '@impera/contracts';
import type { JSX } from 'react';

import { MeNav } from './MeNav';
import './me.css';

import { useCreators } from '@/creators/api';
import { countryName } from '@/lib/country';
import { percentText } from '@/reports/model';
import { playsTheGame } from '@/rewards/api';
import { cityOf, fullDay } from '@/scheduling/time';
import { Loading, Unreachable } from '@/screens/pay/parts';
import { useMembers } from '@/screens/team/api';
import '@/screens/team/team.css';
import { Page, PageHeader, Panel } from '@/shell/layout';

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
    <Page width="narrow">
      <PageHeader
        eyebrow="Moi"
        // The tab's name, as on every tab of Moi; his own name is the card's (recette visuelle 16/11, CHA-12).
        title="Profil"
        lead="Ce que l’agence sait de toi pour ton travail : tes créatrices, ton taux, ton fuseau."
        tabs={<MeNav manager={manager} trophies={playsTheGame(user)} />}
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
  // The creators of his list, by name, whatever his shifts of the hour (recette 16/11, CHT-31): the list he reads.
  const creators = useCreators();
  const names = (creators.data ?? [])
    .filter((creator) => member.creatorIds.includes(creator.id))
    .map((creator) => creator.displayName)
    .toSorted((left, right) => left.localeCompare(right, 'fr'));
  const { commission } = member;

  return (
    <Panel className="nv-enter" title={member.displayName}>
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
                {creators.isPending
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
            <span className="tm-muted"> · celui de ton téléphone, repris à chaque ouverture</span>
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
