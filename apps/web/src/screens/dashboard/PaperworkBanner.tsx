import { Link } from '@tanstack/react-router';
import type { JSX } from 'react';

import { paperworkLines } from './paperwork';

import { usePendingDocuments } from '@/contractors/api';
import { useInvoices } from '@/invoices/api';

/**
 * The owner's card of the invoices on the Dashboard (EQ-06 lot 8d): what waits for him there, in a line each, and where
 * to settle it, Paie › Factures or the member's file. Read only for the owner; nothing while nothing waits, nor while a
 * list is unread (Paie › Factures says a server that does not answer).
 */
export function PaperworkBanner({ enabled }: { enabled: boolean }): JSX.Element | null {
  const dues = useInvoices(enabled ? { due: ['soon', 'overdue'] } : null);
  const contests = useInvoices(enabled ? { acceptance: ['contested'] } : null);
  const pending = usePendingDocuments(enabled);
  if (!enabled) return null;
  const lines = paperworkLines(
    dues.data?.documents ?? [],
    contests.data?.documents ?? [],
    pending.data ?? null,
  );
  if (lines.length === 0) return null;

  return (
    <aside className="nv-plate db-paper nv-enter" aria-labelledby="db-paper-title">
      <div className="db-paper__body">
        <p id="db-paper-title" className="db-paper__title">
          Factures et pièces
        </p>
        <ul className="db-paper__lines">
          {lines.map((line) => (
            <li key={line.text} className="db-paper__line" data-tone={line.tone}>
              <span className="db-paper__dot" aria-hidden="true" />
              {line.kind === 'invoices' ? (
                <span>{line.text}</span>
              ) : (
                <span>
                  {line.text}{' '}
                  {line.members.map((member, index) => (
                    <span key={member.memberId}>
                      {index === 0 ? null : index === line.members.length - 1 && !line.more ? ' et ' : ', '}
                      <Link
                        to="/equipe/membres/$memberId/dossier"
                        params={{ memberId: member.memberId }}
                        className="db-paper__who"
                      >
                        {member.name}
                      </Link>
                    </span>
                  ))}
                  {line.more ? '…' : '.'}
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
      {lines.some((line) => line.kind === 'invoices') ? (
        <Link className="nv-btn nv-btn--soft nv-btn--sm db-paper__go" to="/paie/factures">
          Voir les factures
        </Link>
      ) : null}
    </aside>
  );
}
