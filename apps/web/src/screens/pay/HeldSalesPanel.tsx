import {
  newId,
  PaySaleDecisionIdSchema,
  type HeldSale,
  type PayPeriod,
  type SaleDecisionOutcome,
} from '@nirvana/contracts';
import { useId, useState, type JSX } from 'react';

import type { PayNames } from './data';

import { decideSale, useHeldSales, useRefreshPayroll, type PayRefusal } from '@/payroll/api';
import {
  decisionText,
  heldCountText,
  heldReasonText,
  outcomeLabel,
  outcomeWords,
  saleAmount,
  saleWhen,
  type SaleMember,
} from '@/payroll/held-sales';
import { payRefusalText } from '@/payroll/model';
import { useSchedulingSettings } from '@/reports/api';
import { accountLine } from '@/scheduling/model';
import { Dialog } from '@/screens/team/Dialog';
import { Panel } from '@/shell/layout';

/** The longest note pay keeps on a decision (`PayReasonSchema`). */
const NOTE_MAX = 500;

/** A refusal that says the list moved under the reader: it is read again. */
const MOVED: ReadonlySet<string> = new Set(['pay_sale_not_found', 'pay_sale_outcome_conflict']);

/**
 * Paie › Quinzaine, for the owner and an active manager (CRM-03 lot b4b, ADR 0050 §§ 3, 5, 7): the sales read on the
 * platform that the period holds without a decision, and those a decision settles, so that each can be decided and
 * taken back. They never stop a closing; a sale decided after it goes on the team's first open period. Nothing shows
 * while there is none.
 */
export function HeldSalesPanel({
  period,
  names,
  me,
  owner,
}: {
  period: PayPeriod;
  names: PayNames;
  me: { readonly id: string };
  owner: boolean;
}): JSX.Element | null {
  const held = useHeldSales(period, true);
  const settings = useSchedulingSettings();
  const [asked, setAsked] = useState<{
    readonly sale: HeldSale;
    readonly outcome: SaleDecisionOutcome;
  } | null>(null);
  const sales = held.data?.period === period ? held.data.sales : [];
  const zone = settings.data?.timeZone ?? null;
  if (sales.length === 0 || zone === null) return null;

  const memberOf = (sale: HeldSale): SaleMember | null => {
    if (sale.memberId === null) return null;
    const member = names.member(sale.memberId);
    return { name: member.name, own: member.userId === me.id };
  };

  return (
    <Panel
      className="nv-enter py-held"
      eyebrow="Ventes en attente"
      actions={<span className="py-held__count nv-num">{heldCountText(sales)}</span>}
    >
      <div className="rp-sec">
        <p className="py-quiet">
          Lues sur la plateforme, elles ne comptent pour personne tant qu’elles attendent. Elles n’empêchent
          pas la clôture : une vente décidée après elle va sur la première quinzaine ouverte.
        </p>
        <ul className="py-held__rows">
          {sales.map((sale) => {
            const member = memberOf(sale);
            const account = names.account(sale.platformAccountId);
            const reason = heldReasonText(sale, member, owner);
            const decided = decisionText(sale, member);
            return (
              <li key={`${sale.platform}:${sale.platformSaleId}:${sale.event}`} className="py-held__row">
                <div className="py-held__main">
                  <p className="py-held__who">
                    {account === null ? 'Un compte' : account.creatorName}
                    <span className="py-held__account">
                      {account === null ? '' : ` · ${accountLine(account)}`}
                    </span>
                  </p>
                  <p className="py-member__line nv-num">
                    {saleWhen(sale, zone)} · chatteur{'\u00a0'}
                    <b>{member === null ? 'non relié' : member.name}</b>
                  </p>
                </div>
                <div className="py-held__side">
                  <p className="py-held__amount nv-num">{saleAmount(sale)}</p>
                  {decided === null ? (
                    <span className="rp-chip rp-chip--warn">En attente</span>
                  ) : (
                    <span className="rp-chip">{decided}</span>
                  )}
                </div>
                {reason === null ? null : <p className="py-held__reason">{reason}</p>}
                {member?.own === true ? (
                  <p className="py-held__own">C’est une vente de ton chatteur : un autre membre en décide.</p>
                ) : sale.outcomes.length === 0 ? null : (
                  <div className="py-held__acts">
                    {sale.outcomes.map((outcome) => (
                      <button
                        key={outcome}
                        type="button"
                        className={
                          outcome === 'count'
                            ? 'nv-btn nv-btn--neon nv-btn--sm'
                            : 'nv-btn nv-btn--plain nv-btn--sm'
                        }
                        onClick={() => {
                          setAsked({ sale, outcome });
                        }}
                      >
                        {outcomeLabel(outcome, member)}
                      </button>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
      {asked === null ? null : (
        <DecideDialog
          key={`${asked.sale.platformSaleId}:${asked.outcome}`}
          period={period}
          sale={asked.sale}
          outcome={asked.outcome}
          member={memberOf(asked.sale)}
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
 * One gesture on a sale, read again before it is sent, with an optional note: a decision is taken back by another
 * gesture, never by a hold. The id is drawn once, so that sending again after a lost answer writes nothing twice.
 */
function DecideDialog({
  period,
  sale,
  outcome,
  member,
  names,
  zone,
  onClose,
}: {
  period: PayPeriod;
  sale: HeldSale;
  outcome: SaleDecisionOutcome;
  member: SaleMember | null;
  names: PayNames;
  zone: string;
  onClose: () => void;
}): JSX.Element {
  const id = useId();
  const refresh = useRefreshPayroll();
  const [decisionId] = useState(() => newId(PaySaleDecisionIdSchema));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<PayRefusal | null>(null);
  const words = outcomeWords(outcome, sale, member);
  const account = names.account(sale.platformAccountId);

  const send = async () => {
    setBusy(true);
    setRefusal(null);
    const trimmed = note.trim();
    const outcomeSent = await decideSale({
      id: decisionId,
      period,
      platform: sale.platform,
      platformSaleId: sale.platformSaleId,
      outcome,
      note: trimmed === '' ? null : trimmed,
    });
    setBusy(false);
    if (outcomeSent.kind === 'ok') {
      await refresh();
      onClose();
      return;
    }
    setRefusal(outcomeSent);
    if (outcomeSent.kind === 'refused' && MOVED.has(outcomeSent.code)) await refresh();
  };

  return (
    <Dialog className="py-dialog" title={words.title} lead={words.lead} busy={busy} onClose={onClose}>
      <div className="tm-dialog__body">
        <dl className="py-lines nv-num">
          <div>
            <dt>
              {account === null ? 'Un compte' : `${account.creatorName} · ${accountLine(account)}`}
              <small>{saleWhen(sale, zone)}</small>
            </dt>
            <dd>{saleAmount(sale)}</dd>
          </div>
        </dl>
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
            placeholder="Shift prolongé d’une heure, prévenu par message."
            onChange={(event) => {
              setNote(event.target.value);
            }}
          />
          <p className="tm-hint">Gardée avec la décision. Jamais le message ni le nom d’un fan.</p>
        </div>
        {refusal === null ? null : (
          <p className="tm-warn sc-refusal nv-swap" role="alert">
            {payRefusalText(refusal, { memberName: () => member?.name ?? 'Un membre' })}
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
