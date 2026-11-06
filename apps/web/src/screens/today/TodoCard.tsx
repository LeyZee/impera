import type { BillingRegime, InvoiceListItem, Me } from '@impera/contracts';
import { Link } from '@tanstack/react-router';
import type { JSX, ReactNode } from 'react';

import { useBillingRegimes, useContractorFile, useContractTexts } from '@/contractors/api';
import { fileToDos, regimeInForce, type FileToDo } from '@/contractors/model';
import { useInvoices } from '@/invoices/api';
import { deadlineText, kindLabel, periodText } from '@/invoices/model';
import { reportToDos, type MyReports } from '@/reports/MyReports';
import { useSchedulingSettings } from '@/reports/api';
import { amountText, signedAmountText } from '@/reports/model';
import { platformName, swapShiftLine } from '@/scheduling/model';
import { readerZone } from '@/scheduling/time';
import { useNow } from '@/scheduling/useNow';
import { useMembers } from '@/screens/team/api';
import { Panel } from '@/shell/layout';
import './today.css';
import '@/reports/reports.css';

/**
 * Aujourd'hui's « À faire » (D-03): everything that waits on the chatter in one list and one shape, the reports first
 * (a report to make, one sent back), then the invoices to accept or contest before their delay ends, then what his
 * file still asks for (a text to accept, a document to file or renew). Each line says what, when, and where it is done.
 * Shown only when something waits: the day's shift stays first, and an empty card would be noise.
 */
export function TodoCard({
  user,
  reports,
  heroShiftId,
  onReport,
}: {
  user: Me;
  reports: MyReports;
  heroShiftId: string | null;
  onReport: (shiftId: string) => void;
}): JSX.Element | null {
  const members = useMembers();
  const me = members.data?.find((member) => member.userId === user.id) ?? null;
  const file = useContractorFile(me?.id ?? null);
  const regimes = useBillingRegimes();
  const texts = useContractTexts();
  // His own, named: the server scopes a chatter to himself, but an owner or an active manager would get everyone's.
  const pending = useInvoices(me === null ? null : { acceptance: ['pending'], memberId: me.id });
  const timeZone = useSchedulingSettings().data?.timeZone ?? null;
  const zone = me?.timeZone ?? readerZone();
  const now = useNow();

  const list = reports.list;
  const accounts = new Map((list?.accounts ?? []).map((account) => [account.id, account]));
  const toDo = list === undefined ? [] : reportToDos(list, heroShiftId, now);
  const invoices = timeZone === null ? [] : (pending.data?.documents ?? []);
  const fromFile =
    file.data === undefined || regimes.data === undefined
      ? []
      : // The texts, once read, join the documents: a texts' read that fails never hides the rest.
        fileToDos(file.data, regimeOf(file.data, regimes.data.regimes), texts.data?.texts ?? []);
  if (toDo.length + invoices.length + fromFile.length === 0) return null;

  let index = 0;
  return (
    <Panel className="td-todo nv-enter" eyebrow="À faire">
      <ul className="rp-todo td-todo__list">
        {toDo.map(({ shift, report }) => {
          const account = accounts.get(shift.platformAccountId);
          // Neither to make nor sent back: its gap with the platform waits for him (ADR 0073 § 5).
          const gap =
            report !== null && report.status !== 'rejected' && report.check?.state === 'complete'
              ? report.check
              : null;
          return (
            <Line
              key={shift.id}
              index={index++}
              tone={report === null ? 'due' : 'back'}
              title={
                report === null ? (
                  'Rapport à faire'
                ) : gap !== null ? (
                  // The amount inside the sentence: a line that breaks never leaves a « · » alone at its end.
                  <>
                    Écart de{' '}
                    <span className="nv-num">{signedAmountText(gap.gapMinor, report.amount.currency)}</span>{' '}
                    avec {account === undefined ? 'la plateforme' : platformName(account.platform)}
                  </>
                ) : (
                  'Rapport renvoyé par l’agence'
                )
              }
              sub={swapShiftLine(shift.startsAt, shift.endsAt, account?.creatorName, zone)}
              note={gap === null ? (report?.reviewNote ?? null) : null}
              go={report === null ? 'Faire' : gap === null ? 'Reprendre' : 'Expliquer'}
              onClick={() => {
                onReport(shift.id);
              }}
            />
          );
        })}
        {timeZone === null
          ? null
          : invoices.map((item) => (
              <InvoiceLine key={item.id} index={index++} item={item} timeZone={timeZone} />
            ))}
        {fromFile.map((one) => (
          <FileLine key={one.key} index={index++} toDo={one} />
        ))}
      </ul>
    </Panel>
  );
}

/** The regime of the file's day, as the list of regimes gives it; `null` without one. */
function regimeOf(
  file: Parameters<typeof regimeInForce>[0],
  regimes: readonly BillingRegime[],
): BillingRegime | null {
  const assigned = regimeInForce(file);
  return assigned === null ? null : (regimes.find((regime) => regime.id === assigned.regimeId) ?? null);
}

/** One line of « À faire »: a mark, what and when, and the chip that says the gesture. A button or a link. */
function Line({
  index,
  tone,
  title,
  sub,
  note = null,
  go,
  to,
  onClick,
}: {
  index: number;
  tone: 'due' | 'back' | 'quiet';
  title: ReactNode;
  sub: ReactNode;
  note?: string | null;
  go: string;
  to?: '/commissions/factures' | '/moi/dossier';
  onClick?: () => void;
}): JSX.Element {
  const body = (
    <>
      <span className="rp-todo__mark" aria-hidden="true" />
      <span className="rp-todo__text">
        <span className="rp-todo__title">{title}</span>
        <span className="rp-todo__sub td-todo__sub">{sub}</span>
        {note === null ? null : <span className="rp-todo__note">« {note} »</span>}
      </span>
      <span className="rp-todo__go">{go}</span>
    </>
  );
  return (
    <li className="nv-enter" style={{ '--nv-i': index }}>
      {to === undefined ? (
        <button type="button" className="rp-todo__one nv-tap" data-tone={tone} onClick={onClick}>
          {body}
        </button>
      ) : (
        <Link to={to} className="rp-todo__one nv-tap" data-tone={tone}>
          {body}
        </Link>
      )}
    </li>
  );
}

function InvoiceLine({
  index,
  item,
  timeZone,
}: {
  index: number;
  item: InvoiceListItem;
  timeZone: string;
}): JSX.Element {
  const deadline = deadlineText(item.acceptance, timeZone);
  return (
    <Line
      index={index}
      tone="due"
      title={
        <>
          {kindLabel(item)} <span className="nv-num">{item.number}</span> à accepter
        </>
      }
      sub={`${amountText(item.inclVatMinor, 'EUR')} · ${periodText(item)}${deadline === null ? '' : ` · ${deadline}`}`}
      go="Répondre"
      to="/commissions/factures"
    />
  );
}

function FileLine({ index, toDo }: { index: number; toDo: FileToDo }): JSX.Element {
  return (
    <Line
      index={index}
      tone={toDo.key.startsWith('reminder-') ? 'quiet' : 'due'}
      title={toDo.title}
      sub={toDo.text}
      go={toDo.go === 'text' ? 'Lire' : 'Déposer'}
      to="/moi/dossier"
    />
  );
}
