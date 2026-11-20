import { Link } from '@tanstack/react-router';
import { useState, type JSX } from 'react';

import { backupBannerOf, useBackupStatus } from './backups';
import { paperworkLines } from './paperwork';
import { reportItems, TODO_SHOWN, todoItems, type TodoItem } from './todo';

import { usePendingDocuments } from '@/contractors/api';
import { useInvoices } from '@/invoices/api';
import { useReports } from '@/reports/api';
import { useNow } from '@/scheduling/useNow';

/**
 * « À faire » (pilotage 12/11, W3): one card for what waits on the reader, in place of a banner per subject. The
 * owner reads the daily export, the invoices and the documents to check (OPS-02, EQ-06 lot 8d); whoever reviews the
 * team's reports reads those that wait (ADR 0073). Each line leads where it is settled. Nothing while nothing waits,
 * nor while a list is unread: the screen it leads to says a server that does not answer.
 */
export function TodoCard({
  forOwner,
  reviewsReports,
}: {
  forOwner: boolean;
  reviewsReports: boolean;
}): JSX.Element | null {
  const status = useBackupStatus(forOwner);
  const dues = useInvoices(forOwner ? { due: ['soon', 'overdue'] } : null);
  const contests = useInvoices(forOwner ? { acceptance: ['contested'] } : null);
  const pending = usePendingDocuments(forOwner);
  const open = useReports(null, reviewsReports);
  const now = useNow();
  // The most pressing lines first; the rest one tap away, so the figures stay close on a busy day.
  const [isOpen, setIsOpen] = useState(false);

  const items = todoItems(
    forOwner && status !== undefined ? backupBannerOf(status) : null,
    forOwner
      ? paperworkLines(dues.data?.documents ?? [], contests.data?.documents ?? [], pending.data ?? null)
      : [],
    reviewsReports && open.data !== undefined ? reportItems(open.data.reports, now) : [],
  );
  if (items.length === 0) return null;
  const shown = isOpen ? items : items.slice(0, TODO_SHOWN);
  const hidden = items.length - shown.length;

  return (
    <section className="nv-plate db-todo nv-enter" aria-labelledby="db-todo-title">
      <header className="db-todo__head">
        <h2 id="db-todo-title" className="db-todo__title">
          À faire
        </h2>
        <span className="db-todo__count nv-num" aria-label={`${String(items.length)} à traiter`}>
          {items.length}
        </span>
      </header>
      <ul className="db-todo__list">
        {shown.map((item) => (
          <li key={item.key} className="db-todo__item" data-tone={item.tone}>
            <Row item={item} />
          </li>
        ))}
      </ul>
      {hidden === 0 ? null : (
        <button
          type="button"
          className="nv-btn nv-btn--plain nv-btn--sm db-todo__more"
          onClick={() => {
            setIsOpen(true);
          }}
        >
          {hidden === 1 ? 'Et 1 autre' : `Et ${String(hidden)} autres`}
        </button>
      )}
    </section>
  );
}

function Row({ item }: { item: TodoItem }): JSX.Element {
  const body = (
    <>
      <span className="db-todo__dot" aria-hidden="true" />
      <span className="db-todo__body">
        <span className="db-todo__text nv-num">{item.title}</span>
        {item.detail.map((line) => (
          <span key={line} className="db-todo__detail">
            {line}
          </span>
        ))}
        {item.members.length === 0 ? null : (
          <span className="db-todo__who">
            {item.members.map((member) => (
              <Link
                key={member.memberId}
                to="/equipe/membres/$memberId/dossier"
                params={{ memberId: member.memberId }}
                className="nv-btn nv-btn--soft nv-btn--sm"
              >
                {member.name}
              </Link>
            ))}
            {item.more ? <span aria-hidden="true">…</span> : null}
          </span>
        )}
      </span>
    </>
  );
  if (item.to === null) return <div className="db-todo__row">{body}</div>;
  return (
    <Link to={item.to} className="db-todo__row db-todo__row--link">
      {body}
      <span className="db-todo__where">{item.where}</span>
      <svg
        className="db-todo__go"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="m9 6 6 6-6 6" />
      </svg>
    </Link>
  );
}
