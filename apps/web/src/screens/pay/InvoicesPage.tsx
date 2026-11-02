import { TeamMemberIdSchema, type InvoiceListItem, type Me, type PayPeriod } from '@nirvana/contracts';
import type { UseQueryResult } from '@tanstack/react-query';
import { useId, useState, type JSX, type ReactNode } from 'react';

import { AnswerDialog, DetailDialog, InvoiceRow, SettleDialog } from './InvoiceRow';
import { InvoiceYears } from './InvoiceYears';
import { PayNav } from './PayNav';
import { useAgencyToday, useCurrentPeriod } from './data';
import { Empty, Loading, PeriodArrows, Unreachable } from './parts';

import { useInvoices, useInvoiceYears } from '@/invoices/api';
import { statementPeriodOf } from '@/invoices/model';
import '@/payroll/pay.css';
import { useSchedulingSettings } from '@/reports/api';
import '@/reports/reports.css';
import { periodTitle, previousPeriod } from '@/reports/model';
import '@/scheduling/scheduling.css';
import { useMembers } from '@/screens/team/api';
import '@/screens/team/team.css';
import { Page, PageHeader, Panel } from '@/shell/layout';

/** What the reader opened on a document: an answer to his own, the end of a contest, or its detail. */
type Opened =
  | { readonly kind: 'answer'; readonly item: InvoiceListItem; readonly answer: 'accept' | 'contest' }
  | { readonly kind: 'settle'; readonly item: InvoiceListItem }
  | { readonly kind: 'detail'; readonly item: InvoiceListItem };

/** How the list of documents is read: one quinzaine for the team, or one member over a year. */
export interface InvoicesFilter {
  readonly quinzaine?: PayPeriod;
  readonly membre?: string;
}

/**
 * Paie › Factures (EQ-06 lot 8, the owner's and an active manager's): the contests to settle first, then the invoices
 * whose due date nears or is past, then every document of a quinzaine, or of one member over a year. Each leads to its
 * statement, where a blocked payout is said and the payment recorded. The owner alone ends a contest.
 */
export function InvoicesPage({
  user,
  chosen,
  member,
  onFilter,
}: {
  user: Me;
  chosen: PayPeriod | null;
  member: string | null;
  onFilter: (filter: InvoicesFilter) => void;
}): JSX.Element {
  const id = useId();
  const owner = user.role === 'owner';
  const current = useCurrentPeriod();
  const today = useAgencyToday();
  const timeZone = useSchedulingSettings().data?.timeZone ?? null;
  const members = useMembers();
  const [opened, setOpened] = useState<Opened | null>(null);

  // A member read over a year, else the team by quinzaine: the one shown first is the last one ended, documents being
  // issued at a period's validation.
  const memberId = member === null ? undefined : TeamMemberIdSchema.safeParse(member).data;
  const whose = memberId === undefined ? {} : { memberId };
  const period =
    memberId === undefined ? (chosen ?? (current === null ? null : previousPeriod(current))) : null;
  const contests = useInvoices({ acceptance: ['contested'], ...whose });
  const dues = useInvoices({ due: ['soon', 'overdue'], ...whose });
  const byPeriod = useInvoices(period === null ? null : { period });
  const byMember = useInvoiceYears(whose, memberId === undefined ? null : today);

  const team = members.data ?? [];
  const nameOf = (memberId: string): string =>
    team.find((one) => one.id === memberId)?.displayName ?? 'Un membre';
  const mine = (memberId: string): boolean => team.find((one) => one.id === memberId)?.userId === user.id;

  const row = (item: InvoiceListItem, listed: PayPeriod | null, zone: string): JSX.Element => (
    <InvoiceRow
      item={item}
      who={nameOf(item.memberId)}
      reader={{ contractor: mine(item.memberId), agency: true, owner }}
      timeZone={zone}
      statementPeriod={statementPeriodOf(item, listed)}
      onAnswer={(answer) => {
        setOpened({ kind: 'answer', item, answer });
      }}
      onSettle={() => {
        setOpened({ kind: 'settle', item });
      }}
      onDetail={() => {
        setOpened({ kind: 'detail', item });
      }}
    />
  );

  const list = (items: readonly InvoiceListItem[], listed: PayPeriod | null, zone: string): JSX.Element => (
    <ul className="iv-list">
      {items.map((item, index) => (
        <li key={item.id} className="nv-enter" style={{ '--nv-i': Math.min(index, 8) }}>
          {row(item, listed, zone)}
        </li>
      ))}
    </ul>
  );

  const chosenName = memberId === undefined ? null : nameOf(memberId);

  return (
    <Page>
      <PageHeader
        eyebrow="Paie"
        title="Factures"
        lead="Les factures et avoirs émis au nom de chaque membre : les contestations à trancher, les échéances, puis chaque quinzaine."
        actions={<PayNav />}
      />
      <div className="py-board">
        {timeZone === null ? null : (
          <>
            <Waiting
              query={contests}
              title="Contestations à trancher"
              what="la liste des contestations"
              lead={owner ? null : 'Le propriétaire les tranche.'}
            >
              {(items) => list(items, null, timeZone)}
            </Waiting>
            <Waiting
              query={dues}
              title="Échéances proches ou passées"
              what="la liste des échéances"
              lead={null}
            >
              {(items) => list(items, null, timeZone)}
            </Waiting>
          </>
        )}
        <Panel
          className="nv-enter iv-docs"
          eyebrow="Documents"
          title={
            period === null ? (
              chosenName === null ? (
                'Quinzaine'
              ) : (
                `${chosenName}, sur l’année`
              )
            ) : (
              <span className="nv-swap nv-num" key={period} aria-live="polite">
                {periodTitle(period)}
              </span>
            )
          }
          actions={
            <div className="iv-filter">
              <label className="sr-only" htmlFor={`${id}-member`}>
                Membre
              </label>
              <select
                id={`${id}-member`}
                className="nv-field__control nv-glass tm-select"
                value={memberId ?? ''}
                onChange={(event) => {
                  const value = event.target.value;
                  onFilter(value === '' ? (period === null ? {} : { quinzaine: period }) : { membre: value });
                }}
              >
                <option value="">Toute l’équipe</option>
                {team.map((one) => (
                  <option key={one.id} value={one.id}>
                    {one.displayName}
                  </option>
                ))}
              </select>
              {period === null ? null : (
                <PeriodArrows
                  period={period}
                  current={current}
                  onPeriod={(next) => {
                    onFilter({ quinzaine: next });
                  }}
                />
              )}
            </div>
          }
        >
          {memberId === undefined ? (
            byPeriod.isError && byPeriod.data === undefined ? (
              <Unreachable
                what="la liste des documents"
                onRetry={() => {
                  void byPeriod.refetch();
                }}
              />
            ) : byPeriod.data === undefined || timeZone === null ? (
              <Loading rows={3} />
            ) : byPeriod.data.documents.length === 0 ? (
              <Empty
                whisper="Aucun document sur cette quinzaine."
                text="Les factures s’émettent à la validation des relevés, pour chaque membre au dossier complet."
              />
            ) : (
              <div className="rp-sec">{list(byPeriod.data.documents, period, timeZone)}</div>
            )
          ) : timeZone === null ? (
            <Loading rows={3} />
          ) : (
            <InvoiceYears
              years={byMember}
              today={today}
              what="la liste des documents"
              first={`${chosenName ?? 'Ce membre'} n’a aucun document sur les dix dernières années : ses factures s’émettent à la validation de ses relevés, une fois son dossier complet.`}
              older="Le serveur ne répond pas : les documents plus anciens n’ont pas pu être lus."
              row={(item) => row(item, null, timeZone)}
            />
          )}
        </Panel>
      </div>
      {opened?.kind === 'answer' ? (
        <AnswerDialog
          item={opened.item}
          answer={opened.answer}
          onClose={() => {
            setOpened(null);
          }}
        />
      ) : null}
      {opened?.kind === 'settle' ? (
        <SettleDialog
          item={opened.item}
          who={nameOf(opened.item.memberId)}
          onClose={() => {
            setOpened(null);
          }}
        />
      ) : null}
      {opened?.kind === 'detail' && timeZone !== null ? (
        <DetailDialog
          item={opened.item}
          who={nameOf(opened.item.memberId)}
          timeZone={timeZone}
          onClose={() => {
            setOpened(null);
          }}
        />
      ) : null}
    </Page>
  );
}

/**
 * A list of what waits (contests, due dates): shown only when something waits, never an empty plate; a server that
 * does not answer is said, never taken for « nothing ».
 */
function Waiting({
  query,
  title,
  what,
  lead,
  children,
}: {
  query: UseQueryResult<{ readonly documents: readonly InvoiceListItem[] }>;
  title: string;
  what: string;
  lead: string | null;
  children: (items: readonly InvoiceListItem[]) => ReactNode;
}): JSX.Element | null {
  if (query.isError && query.data === undefined)
    return (
      <Panel className="nv-enter" title={title}>
        <Unreachable
          what={what}
          onRetry={() => {
            void query.refetch();
          }}
        />
      </Panel>
    );
  const items = query.data?.documents ?? [];
  if (items.length === 0) return null;
  return (
    <Panel className="nv-enter" title={title}>
      <div className="rp-sec">
        {lead === null ? null : <p className="py-quiet">{lead}</p>}
        {children(items)}
      </div>
    </Panel>
  );
}
