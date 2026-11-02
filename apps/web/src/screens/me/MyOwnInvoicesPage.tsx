import type { Me } from '@nirvana/contracts';
import type { JSX } from 'react';

import { MeNav } from './MeNav';

import { MyInvoicesPage } from '@/screens/pay/MyInvoicesPage';
import { Loading, Unreachable } from '@/screens/pay/parts';
import { useMembers } from '@/screens/team/api';
import { Page, PageHeader, Panel } from '@/shell/layout';

/**
 * Moi › Factures (EQ-06 lot 8b, a manager's): his own invoices and credit notes, the screen a chatter reads in
 * Commissions. An active manager reads every document of the agency: the list asks for his member's alone, found by
 * his account in the team.
 */
export function MyOwnInvoicesPage({ user }: { user: Me }): JSX.Element {
  const members = useMembers();
  const me = members.data?.find((member) => member.userId === user.id) ?? null;
  if (me !== null) return <MyInvoicesPage eyebrow="Moi" actions={<MeNav />} memberId={me.id} />;

  return (
    <Page>
      <PageHeader
        eyebrow="Moi"
        title="Factures"
        lead="Les factures que l’agence émet en ton nom, et les avoirs qui les corrigent. Tu acceptes ou contestes chacune avant la fin de son délai."
        actions={<MeNav />}
      />
      <div className="py-board">
        <Panel className="nv-enter">
          {members.data !== undefined ? (
            <p className="tm-warn">Ta fiche d’équipe est introuvable : le propriétaire peut la vérifier.</p>
          ) : members.isError ? (
            <Unreachable
              what="ta fiche"
              onRetry={() => {
                void members.refetch();
              }}
            />
          ) : (
            <Loading rows={3} />
          )}
        </Panel>
      </div>
    </Page>
  );
}
