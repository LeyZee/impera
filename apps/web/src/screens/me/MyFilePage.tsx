import type { Me } from '@nirvana/contracts';
import type { JSX } from 'react';

import { FileBoard } from './FileBoard';
import { MeNav } from './MeNav';

import { Loading, Unreachable } from '@/screens/pay/parts';
import { useMembers } from '@/screens/team/api';
import { Page, PageHeader, Panel } from '@/shell/layout';

/**
 * Moi › Dossier (EQ-06 lot 8b, a chatter's and a manager's): what the agency needs to issue his invoices in his name,
 * his identity, his contract and mandate, and the documents of his regime. He fills, accepts and files; the owner
 * checks.
 */
export function MyFilePage({ user }: { user: Me }): JSX.Element {
  const members = useMembers();
  const me = members.data?.find((member) => member.userId === user.id) ?? null;
  const manager = user.teamScope === 'agency';

  return (
    <Page>
      <PageHeader
        eyebrow="Moi"
        title="Dossier"
        lead="Ce qu’il faut pour que l’agence émette tes factures en ton nom : ton identité, ton contrat et ton mandat, les pièces de ton régime."
        actions={manager ? <MeNav /> : undefined}
      />
      <div className="py-board">
        {me !== null ? (
          <FileBoard memberId={me.id} name={me.displayName} reader={{ self: true, checks: false }} />
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
