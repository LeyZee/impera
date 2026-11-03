import type { Me } from '@impera/contracts';
import { Link } from '@tanstack/react-router';
import type { JSX } from 'react';

import { TeamNav } from './TeamNav';
import { useMembers } from './api';

import { FileBoard } from '@/screens/me/FileBoard';
import { Loading, Unreachable } from '@/screens/pay/parts';
import { Page, PageHeader, Panel } from '@/shell/layout';

/**
 * Équipe › Membres › Dossier (EQ-06 lot 8b, the owner's alone): a member's file as his invoices print it. The owner
 * checks the identity as he reads it, sets the prefix, gives a regime from a day on and reviews each document once,
 * never on his own file.
 */
export function MemberFilePage({ user, memberId }: { user: Me; memberId: string }): JSX.Element {
  const members = useMembers();
  const member = members.data?.find((one) => one.id === memberId) ?? null;
  const name = member?.displayName ?? 'Ce membre';

  return (
    <Page>
      <PageHeader
        eyebrow="Équipe"
        title={member === null ? 'Dossier' : `Dossier de ${member.displayName}`}
        lead="Ce que ses factures impriment, et ce qui les laisse partir : son identité vérifiée, son régime, son mandat, ses pièces."
        actions={<TeamNav inMember />}
      />
      <div className="py-board">
        <Link
          to="/equipe/membres"
          search={{ membre: memberId }}
          className="nv-btn nv-btn--plain nv-btn--sm cf-back"
        >
          Sa fiche
        </Link>
        {member !== null ? (
          <FileBoard
            memberId={member.id}
            name={name}
            reader={{ self: false, checks: member.userId !== user.id }}
          />
        ) : members.data !== undefined ? (
          <Panel className="nv-enter">
            <p className="tm-warn">Ce membre n’existe pas, ou plus.</p>
          </Panel>
        ) : members.isError ? (
          <Panel className="nv-enter">
            <Unreachable
              what="la liste des membres"
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
