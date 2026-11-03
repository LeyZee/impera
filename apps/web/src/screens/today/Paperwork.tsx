import type { BillingRegime, InvoiceListItem, Me } from '@impera/contracts';
import { Link } from '@tanstack/react-router';
import type { JSX } from 'react';

import { useBillingRegimes, useContractorFile } from '@/contractors/api';
import { DOCUMENT_NAMES, fileReminders, regimeInForce, type FileReminder } from '@/contractors/model';
import '@/contractors/contractors.css';
import { useInvoices } from '@/invoices/api';
import { deadlineText, kindLabel, periodText } from '@/invoices/model';
import { useSchedulingSettings } from '@/reports/api';
import { amountText } from '@/reports/model';
import { useMembers } from '@/screens/team/api';
import { Panel, PanelSection } from '@/shell/layout';

/**
 * What waits for the chatter on his invoices, on Aujourd'hui (EQ-06 lot 8d): each document to accept or contest
 * before its delay ends, and each document of his file whose renewal is due from `remindFrom` on. Shown only when
 * something waits: the day's shift stays first, and an empty card would be noise.
 */
export function Paperwork({ user }: { user: Me }): JSX.Element | null {
  const members = useMembers();
  const me = members.data?.find((member) => member.userId === user.id) ?? null;
  const file = useContractorFile(me?.id ?? null);
  const regimes = useBillingRegimes();
  // His own, named: the server scopes a chatter to himself, but an owner or an active manager would get everyone's.
  const pending = useInvoices(me === null ? null : { acceptance: ['pending'], memberId: me.id });
  const timeZone = useSchedulingSettings().data?.timeZone ?? null;

  const invoices = pending.data?.documents ?? [];
  const reminders =
    file.data === undefined || regimes.data === undefined
      ? []
      : fileReminders(file.data, regimeOf(file.data, regimes.data.regimes));
  if (timeZone === null || (invoices.length === 0 && reminders.length === 0)) return null;

  return (
    <Panel className="nv-enter" eyebrow="Factures" title="À faire pour tes factures">
      <PanelSection>
        <ul className="cf-list">
          {invoices.map((item) => (
            <InvoiceLine key={item.id} item={item} timeZone={timeZone} />
          ))}
          {reminders.map((reminder) => (
            <ReminderLine key={reminder.kind} reminder={reminder} />
          ))}
        </ul>
      </PanelSection>
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

function InvoiceLine({ item, timeZone }: { item: InvoiceListItem; timeZone: string }): JSX.Element {
  const deadline = deadlineText(item.acceptance, timeZone);
  return (
    <li className="cf-item">
      <div className="cf-item__main">
        <p className="cf-item__name">
          {kindLabel(item)} <span className="nv-num">{item.number}</span>
        </p>
        <p className="cf-item__sub">
          {periodText(item)}
          {deadline === null ? null : ` · ${deadline}`}
        </p>
      </div>
      <span className="nv-num">{amountText(item.inclVatMinor, 'EUR')}</span>
      <div className="cf-item__acts">
        <Link to="/commissions/factures" className="nv-btn nv-btn--soft nv-btn--sm">
          Accepter ou contester
        </Link>
      </div>
    </li>
  );
}

function ReminderLine({ reminder }: { reminder: FileReminder }): JSX.Element {
  return (
    <li className="cf-item cf-item--doc" data-remind="true">
      <div className="cf-item__main">
        <p className="cf-item__name">{DOCUMENT_NAMES[reminder.kind]}</p>
        <p className="cf-item__sub">{reminder.text}</p>
      </div>
      <span />
      <div className="cf-item__acts">
        <Link to="/moi/dossier" className="nv-btn nv-btn--soft nv-btn--sm">
          Mon dossier
        </Link>
      </div>
    </li>
  );
}
