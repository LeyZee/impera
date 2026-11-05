import {
  newId,
  PaySaleSignalIdSchema,
  type MySale,
  type MySalesDay,
  type PayPeriod,
  type SaleSignalKind,
} from '@impera/contracts';
import { useId, useState, type JSX } from 'react';

import type { PayNames } from './data';
import { Unreachable } from './parts';

import { signalSale, useMySales, useRefreshPayroll, type PayRefusal } from '@/payroll/api';
import { payRefusalText } from '@/payroll/model';
import {
  myDayLine,
  myDayTitle,
  mySaleAmount,
  mySaleNote,
  mySalesCountText,
  mySalesIntro,
  mySalesNets,
  mySaleStateText,
  mySaleWaits,
  mySaleWhen,
  mySignalNote,
  signalLabel,
  signalWords,
} from '@/payroll/my-sales';
import { useSchedulingSettings } from '@/reports/api';
import { amountText } from '@/reports/model';
import { accountLine } from '@/scheduling/model';
import { dayOf } from '@/scheduling/time';
import { Dialog } from '@/shell/Dialog';
import { Panel } from '@/shell/layout';

/** The longest note pay keeps on a signal (`PayReasonSchema`). */
const NOTE_MAX = 500;

/** A refusal that says the line moved under the reader: the list is read again. */
const MOVED: ReadonlySet<string> = new Set([
  'pay_sale_signal_not_found',
  'pay_sale_signal_state_conflict',
  'pay_period_closed_conflict',
]);

const keyOf = (sale: Pick<MySale, 'platform' | 'platformSaleId' | 'event'>): string =>
  `${sale.platform}:${sale.platformSaleId}:${sale.event}`;

/**
 * Commissions › « Mes ventes lues » (CRM-03 lot b4c, ADR 0050 § 10): the lines of the member's own statement for the
 * period, day by day, each with its hour, account, net and where it stands, and « Ce n’est pas ma vente » on a line
 * counted for them by mistake. A signal changes no amount: a validator sees it and may exclude the line. Nothing shows
 * for a statement without a line of the platform's net (`expected`), nor while the list is empty; a read that fails is
 * said only where lines are expected. Never the sale's key nor a fan.
 */
export function MySalesPanel({
  period,
  names,
  expected,
  now,
}: {
  period: PayPeriod;
  names: PayNames;
  /** The statement has a line of the platform's net: the list should have something. */
  expected: boolean;
  now: Date;
}): JSX.Element | null {
  const uid = useId();
  const mine = useMySales(period);
  const settings = useSchedulingSettings();
  const [asked, setAsked] = useState<{ readonly sale: MySale; readonly kind: SaleSignalKind } | null>(null);
  const pages = (mine.data?.pages ?? []).filter((page) => page.period === period);
  const first = pages[0];
  const zone = settings.data?.timeZone ?? null;
  if (first === undefined) {
    if (!expected || !mine.isError) return null;
    return (
      <Panel className="nv-enter py-mine" eyebrow="Mes ventes lues">
        <Unreachable
          what="tes ventes lues"
          onRetry={() => {
            void mine.refetch();
          }}
        />
      </Panel>
    );
  }
  const items = pages.flatMap((page) => page.items);
  if (zone === null || (items.length === 0 && first.days.length === 0)) return null;

  const today = dayOf(now, zone);
  // The days of the lines read so far, in their order; a day's head sums it whole, from the server.
  const dayOfSale = (sale: MySale): string | null =>
    sale.occurredAt === null ? null : dayOf(sale.occurredAt, zone);
  const sums = new Map<string | null, MySalesDay>(first.days.map((day) => [day.day, day]));
  const groups: { readonly day: string | null; readonly sales: MySale[] }[] = [];
  for (const sale of items) {
    const day = dayOfSale(sale);
    const last = groups.at(-1);
    if (last?.day === day) last.sales.push(sale);
    else groups.push({ day, sales: [sale] });
  }
  const nets = mySalesNets(first.days);

  return (
    <Panel
      className="nv-enter py-mine"
      eyebrow="Mes ventes lues"
      actions={
        <span className="py-held__count nv-num">
          {[mySalesCountText(first.days), ...nets.map((net) => amountText(net.netMinor, net.currency))].join(
            ' · ',
          )}
        </span>
      }
    >
      <div className="rp-sec">
        <p className="py-quiet">
          {mySalesIntro(
            items.map((sale) => sale.platform),
            first.closed,
          )}
        </p>
        <div className="py-mine__days">
          {groups.map((group, groupIndex) => (
            <details
              key={group.day ?? 'none'}
              className="py-mine__day"
              open={group.day === today ? true : undefined}
            >
              <summary className="py-mine__head">
                <span className="py-mine__title">{myDayTitle(group.day)}</span>
                <span className="py-mine__sum nv-num">{myDayLine(sums.get(group.day))}</span>
              </summary>
              <ul className="py-held__rows">
                {group.sales.map((sale, index) => {
                  // Each gesture names its line to a screen reader, out of the list too; by its place, never its key.
                  const about = (part: string): string =>
                    `${uid}-${String(groupIndex)}-${String(index)}-${part}`;
                  const account = names.account(sale.platformAccountId);
                  const note = mySaleNote(sale, first.closed);
                  const signal = mySignalNote(sale);
                  const kind: SaleSignalKind | null = !sale.open
                    ? null
                    : sale.state === 'counted'
                      ? 'signal'
                      : sale.state === 'signalled'
                        ? 'withdraw'
                        : null;
                  return (
                    <li key={keyOf(sale)} className="py-held__row">
                      <div className="py-held__main">
                        <p className="py-held__who" id={about('who')}>
                          {account === null ? 'Un compte' : account.creatorName}
                          <span className="py-held__account">
                            {account === null ? '' : ` · ${accountLine(account)}`}
                          </span>
                        </p>
                        <p className="py-member__line nv-num" id={about('when')}>
                          {mySaleWhen(sale, zone)}
                        </p>
                      </div>
                      <div className="py-held__side">
                        <p
                          className={
                            sale.state === 'excluded' || sale.state === 'removed'
                              ? 'py-held__amount py-mine__gone nv-num'
                              : 'py-held__amount nv-num'
                          }
                          id={about('amount')}
                        >
                          {mySaleAmount(sale)}
                        </p>
                        <span className={mySaleWaits(sale) ? 'rp-chip rp-chip--warn' : 'rp-chip'}>
                          {mySaleStateText(sale)}
                        </span>
                      </div>
                      {note === null ? null : (
                        <p className="py-held__reason">
                          {note}
                          {signal === null ? null : <span className="py-mine__note"> {signal}</span>}
                        </p>
                      )}
                      {kind === null ? null : (
                        <div className="py-held__acts">
                          <button
                            type="button"
                            aria-describedby={`${about('who')} ${about('when')} ${about('amount')}`}
                            className="nv-btn nv-btn--plain nv-btn--sm"
                            onClick={() => {
                              setAsked({ sale, kind });
                            }}
                          >
                            {signalLabel(kind, sale.event)}
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </details>
          ))}
        </div>
        {mine.hasNextPage ? (
          <button
            type="button"
            className="nv-btn nv-btn--plain nv-btn--sm"
            disabled={mine.isFetchingNextPage}
            aria-busy={mine.isFetchingNextPage}
            onClick={() => {
              void mine.fetchNextPage();
            }}
          >
            {mine.isFetchingNextPage ? 'Lecture…' : 'Ventes plus anciennes'}
          </button>
        ) : null}
        {mine.isFetchNextPageError ? (
          <p className="tm-warn" role="alert">
            Le serveur ne répond pas : tes ventes plus anciennes n’ont pas pu être lues.
          </p>
        ) : null}
      </div>
      {asked === null ? null : (
        <SignalDialog
          key={`${keyOf(asked.sale)}:${asked.kind}`}
          period={period}
          sale={asked.sale}
          kind={asked.kind}
          names={names}
          zone={zone}
          onClose={() => {
            setAsked(null);
          }}
        />
      )}
    </Panel>
  );
}

/**
 * A signal on a line, or its withdrawal, read again before it is sent, with an optional note on a signal. The id is
 * drawn once, so that sending again after a lost answer writes nothing twice.
 */
function SignalDialog({
  period,
  sale,
  kind,
  names,
  zone,
  onClose,
}: {
  period: PayPeriod;
  sale: MySale;
  kind: SaleSignalKind;
  names: PayNames;
  zone: string;
  onClose: () => void;
}): JSX.Element {
  const id = useId();
  const refresh = useRefreshPayroll();
  const [signalId] = useState(() => newId(PaySaleSignalIdSchema));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<PayRefusal | null>(null);
  const words = signalWords(kind, sale.event);
  const account = names.account(sale.platformAccountId);

  const send = async () => {
    setBusy(true);
    setRefusal(null);
    const trimmed = note.trim();
    const sent = await signalSale({
      id: signalId,
      period,
      platform: sale.platform,
      platformSaleId: sale.platformSaleId,
      event: sale.event,
      kind,
      note: kind === 'signal' && trimmed !== '' ? trimmed : null,
    });
    setBusy(false);
    if (sent.kind === 'ok') {
      await refresh();
      onClose();
      return;
    }
    setRefusal(sent);
    if (sent.kind === 'refused' && MOVED.has(sent.code)) await refresh();
  };

  return (
    <Dialog className="py-dialog" title={words.title} lead={words.lead} busy={busy} onClose={onClose}>
      <div className="tm-dialog__body">
        <dl className="py-lines nv-num">
          <div>
            <dt>
              {account === null ? 'Un compte' : `${account.creatorName} · ${accountLine(account)}`}
              <small>
                {myDayTitle(sale.occurredAt === null ? null : dayOf(sale.occurredAt, zone))} ·{' '}
                {mySaleWhen(sale, zone)}
              </small>
            </dt>
            <dd>{mySaleAmount(sale)}</dd>
          </div>
        </dl>
        {kind === 'signal' ? (
          <div className="nv-field tm-field">
            <label className="nv-field__label" htmlFor={`${id}-note`}>
              Note (facultatif)
            </label>
            <textarea
              id={`${id}-note`}
              className="nv-field__control nv-glass sc-note"
              rows={2}
              maxLength={NOTE_MAX}
              value={note}
              placeholder="Vendue pendant le shift de Léa, je l’ai seulement relayée."
              onChange={(event) => {
                setNote(event.target.value);
              }}
            />
            <p className="tm-hint">Lue par le valideur. Jamais le message ni le nom d’un fan.</p>
          </div>
        ) : null}
        {refusal === null ? null : (
          <p className="tm-warn sc-refusal nv-swap" role="alert">
            {payRefusalText(refusal, { memberName: () => 'Un membre' })}
          </p>
        )}
        <div className="tm-dialog__foot">
          <button type="button" className="nv-btn nv-btn--plain" disabled={busy} onClick={onClose}>
            Annuler
          </button>
          <button
            type="button"
            className="nv-btn nv-btn--neon"
            data-autofocus
            disabled={busy}
            aria-busy={busy}
            onClick={() => {
              void send();
            }}
          >
            {busy ? 'Enregistrement…' : words.confirm}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
