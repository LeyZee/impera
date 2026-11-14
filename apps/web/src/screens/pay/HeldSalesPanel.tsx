import {
  newId,
  PaySaleDecisionIdSchema,
  type HeldSale,
  type PayPeriod,
  type Platform,
  type SaleDecisionOutcome,
  type SaleExcludeReason,
  type TeamImportOverview,
} from '@impera/contracts';
import { useQueries } from '@tanstack/react-query';
import { Fragment, useId, useState, type JSX } from 'react';

import { GiveDialog } from './GiveDialog';
import type { PayNames } from './data';
import { Unreachable } from './parts';

import { useGrowingArea } from '@/lib/growing-area';
import { decideSale, useHeldSales, useRefreshPayroll, type PayRefusal } from '@/payroll/api';
import {
  decidedWhyText,
  decisionText,
  heldCountText,
  heldInOrder,
  heldReasonText,
  lineChatter,
  notePlaceholder,
  outcomeLabel,
  outcomeWords,
  outcomesShown,
  refundAlone,
  ownLineText,
  saleAmount,
  saleSellerText,
  saleWhen,
  signalChipText,
  signalText,
  type SaleMember,
} from '@/payroll/held-sales';
import { payRefusalText } from '@/payroll/model';
import { useSchedulingSettings } from '@/reports/api';
import { accountLine } from '@/scheduling/model';
import { fetchTeamImport, teamImportKey } from '@/settings/sales-feed/api';
import { Dialog } from '@/shell/Dialog';
import { Panel } from '@/shell/layout';

/** The longest note pay keeps on a decision (`PayReasonSchema`). */
const NOTE_MAX = 500;

/**
 * How long the platform's team, read only to name a chatter not linked, is taken as it is: the route reads the platform
 * live (ADR 0076), under the rate the sales feed shares, so the pay screen must not read it again at each visit. A name
 * read ten minutes ago is good enough, and pay never depends on it: without it the line says « compte Reveal non relié ».
 */
const TEAM_NAMES_STALE_MS = 10 * 60_000;

/** A refusal that says the list moved under the reader: it is read again. */
/** A line of the list, by what it is on its platform: a sale or one of its refunds. */
const saleKey = (sale: HeldSale): string => `${sale.platform}:${sale.platformSaleId}:${sale.event}`;

const MOVED: ReadonlySet<string> = new Set([
  'pay_sale_not_found',
  'pay_sale_outcome_conflict',
  'pay_sale_recipient_conflict',
]);

/**
 * Paie › Quinzaine, for the owner and an active manager (CRM-03 lot b4b, ADR 0050 §§ 3, 5, 7): the sales read on the
 * platform that the period holds without a decision, and those a decision settles, so that each can be decided and
 * taken back. They never stop a closing; a sale decided after it goes on the team's first open period. Nothing shows
 * while there is none, nor to a reader the server would refuse (`reads`); a read that fails says so, since an empty
 * panel would read as « nothing waits » before a closing.
 */
export function HeldSalesPanel({
  period,
  names,
  me,
  reads,
}: {
  period: PayPeriod;
  names: PayNames;
  me: { readonly id: string };
  /** The owner or an active manager: the only readers of the list. */
  reads: boolean;
}): JSX.Element | null {
  const held = useHeldSales(period, reads);
  const settings = useSchedulingSettings();
  const read = held.data?.period === period ? held.data : undefined;
  const sales = heldInOrder(read?.sales ?? []);
  const zone = settings.data?.timeZone ?? null;
  // The platform's team names a chatter not linked (ADR 0076): read only for a line that needs it, by the same readers.
  const unnamed: Platform[] = [
    ...new Set(
      sales.flatMap((sale) =>
        sale.memberId === null && sale.platformChatterId !== null ? [sale.platform] : [],
      ),
    ),
  ];
  const teams = useQueries({
    queries: unnamed.map((platform) => ({
      queryKey: teamImportKey(platform),
      queryFn: () => fetchTeamImport(platform),
      retry: false,
      staleTime: TEAM_NAMES_STALE_MS,
    })),
  });
  const teamOf = (platform: Platform): TeamImportOverview | undefined =>
    teams[unnamed.indexOf(platform)]?.data;
  if (reads && read === undefined && held.isError)
    return (
      <Panel className="nv-enter py-held" eyebrow="Ventes en attente">
        <Unreachable
          what="la liste des ventes en attente"
          onRetry={() => {
            void held.refetch();
          }}
        />
      </Panel>
    );
  if (sales.length === 0 || zone === null) return null;

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
          {sales.some((sale) => sale.signal !== null)
            ? ' Une vente signalée par son chatteur compte pour lui tant qu’elle n’est pas écartée.'
            : null}
        </p>
        <SaleCards period={period} sales={sales} names={names} me={me} zone={zone} teamOf={teamOf} />
      </div>
    </Panel>
  );
}

/** Who made a sale, as the cards name them, and whether it is the reader; `null` for a chatter not linked or the agent. */
export function saleMemberOf(
  sale: HeldSale,
  names: PayNames,
  me: { readonly id: string },
): SaleMember | null {
  if (sale.memberId === null) return null;
  const member = names.member(sale.memberId);
  return { name: member.name, own: member.userId === me.id };
}

/**
 * The cards of sales to decide (CRM-03 lot b4b, ADR 0101), one a sale: who and when, its net and where it stands, why
 * it waits, what was decided and why, and the gestures the server offers, each opening its sheet. Shared by « Ventes en
 * attente » and « Donner une vente ».
 */
export function SaleCards({
  period,
  sales,
  names,
  me,
  zone,
  teamOf = () => undefined,
}: {
  period: PayPeriod;
  sales: readonly HeldSale[];
  names: PayNames;
  me: { readonly id: string };
  zone: string;
  /** The platform's team, to name a chatter not linked (ADR 0076); none read, the line says so. */
  teamOf?: (platform: Platform) => TeamImportOverview | undefined;
}): JSX.Element {
  const uid = useId();
  const [asked, setAsked] = useState<{
    readonly sale: HeldSale;
    readonly outcome: SaleDecisionOutcome;
  } | null>(null);
  // The open sheet reads its sale in the list as it is now: after a refusal « la vente a bougé » the list is read
  // again, and the sheet shows the fresh sale and its recipients; one gone from the list stays as it was opened.
  const opened =
    asked === null ? null : (sales.find((one) => saleKey(one) === saleKey(asked.sale)) ?? asked.sale);
  const nameOf = (memberId: string): string => names.member(memberId).name;

  return (
    <>
      <ul className="py-held__rows">
        {sales.map((sale, index) => {
          const member = saleMemberOf(sale, names, me);
          // Each gesture names its sale to a screen reader, out of the list too.
          const about = (part: string): string => `${uid}-${String(index)}-${part}`;
          const account = names.account(sale.platformAccountId);
          const reason = heldReasonText(sale, member, zone);
          const signalled = signalText(sale, member);
          const decided = decisionText(sale, member, nameOf);
          const why = decidedWhyText(sale);
          const chatter = sale.byAgent
            ? { lead: 'vendue par', name: 'l’IA' }
            : lineChatter(sale, member, teamOf(sale.platform));
          const shown = outcomesShown(sale);
          return (
            <li key={saleKey(sale)} className="py-held__row">
              <div className="py-held__main">
                <p className="py-held__who" id={about('who')}>
                  {account === null ? 'Un compte' : account.creatorName}
                  <span className="py-held__account">
                    {account === null ? '' : ` · ${accountLine(account)}`}
                  </span>
                </p>
                <p className="py-member__line nv-num" id={about('when')}>
                  {saleWhen(sale, zone)} · {chatter.lead}
                  {'\u00a0'}
                  <b>{chatter.name}</b>
                </p>
              </div>
              <div className="py-held__side">
                <p className="py-held__amount nv-num" id={about('amount')}>
                  {saleAmount(sale)}
                </p>
                {decided === null ? (
                  sale.reason === null && sale.signal === null ? null : (
                    <span className="rp-chip rp-chip--warn">
                      {signalled === null ? 'En attente' : signalChipText(sale)}
                    </span>
                  )
                ) : (
                  <span className="rp-chip">{decided}</span>
                )}
              </div>
              {reason === null ? null : <p className="py-held__reason">{reason}</p>}
              {signalled === null ? null : <p className="py-held__reason">{signalled}</p>}
              {why === null ? null : <p className="py-held__reason py-gift">{why}</p>}
              {member?.own === true ? (
                <p className="py-held__own">{ownLineText(sale)}</p>
              ) : shown.length === 0 ? null : (
                <div className="py-held__acts">
                  {shown.map((outcome, place) => (
                    <Fragment key={outcome}>
                      {/* On a phone, taking a decision back goes on its own line, under the other gestures. */}
                      {outcome === 'withdraw' && place > 0 ? (
                        <span className="py-held__break" aria-hidden="true" />
                      ) : null}
                      <button
                        type="button"
                        aria-describedby={`${about('who')} ${about('when')} ${about('amount')}`}
                        // Red is the one gesture a held line waits for; in a list of sales, « Donner à… » stays plain.
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
                    </Fragment>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {asked === null || opened === null ? null : asked.outcome === 'give' ? (
        <GiveDialog
          key={`${saleKey(asked.sale)}:give`}
          period={period}
          sale={opened}
          member={saleMemberOf(opened, names, me)}
          names={names}
          zone={zone}
          onClose={() => {
            setAsked(null);
          }}
        />
      ) : (
        <DecideDialog
          key={`${saleKey(asked.sale)}:${asked.outcome}`}
          period={period}
          sale={opened}
          outcome={asked.outcome}
          member={saleMemberOf(opened, names, me)}
          names={names}
          zone={zone}
          onClose={() => {
            setAsked(null);
          }}
        />
      )}
    </>
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
  const noteArea = useGrowingArea(note);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<PayRefusal | null>(null);
  // ADR 0101 § 8: « Écarter » asks why, but on a refund without a sale on the register, which no one sold.
  const asksWhy = outcome === 'exclude' && !refundAlone(sale);
  const [why, setWhy] = useState<SaleExcludeReason | null>(null);
  const [touched, setTouched] = useState(false);
  const words = outcomeWords(outcome, sale, member);
  const account = names.account(sale.platformAccountId);

  const send = async () => {
    setTouched(true);
    if (asksWhy && why === null) return;
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
      recipientMemberId: null,
      shareBp: null,
      excludeReason: outcome === 'exclude' ? (why ?? 'other') : null,
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
        <dl className="py-lines py-lines--recap nv-num">
          <div>
            <dt>
              {account === null ? 'Un compte' : `${account.creatorName} · ${accountLine(account)}`}
              <small>
                {saleWhen(sale, zone)}
                {sale.event === 'sale' ? ` · ${saleSellerText(sale, member)}` : ''}
              </small>
            </dt>
            <dd>{saleAmount(sale)}</dd>
          </div>
        </dl>
        {asksWhy ? (
          <div className="nv-field tm-field" data-invalid={touched && why === null ? 'true' : undefined}>
            <span className="nv-field__label" id={`${id}-why`}>
              Pourquoi
            </span>
            <div className="tm-choices" role="radiogroup" aria-labelledby={`${id}-why`}>
              <button
                type="button"
                role="radio"
                className="nv-chip"
                aria-checked={why === 'agent_decisive'}
                data-autofocus
                onClick={() => {
                  setWhy('agent_decisive');
                }}
              >
                L’IA a été décisive
              </button>
              <button
                type="button"
                role="radio"
                className="nv-chip"
                aria-checked={why === 'other'}
                onClick={() => {
                  setWhy('other');
                }}
              >
                Une autre raison
              </button>
            </div>
            <p className="tm-hint">
              {touched && why === null
                ? 'Choisis une raison.'
                : why === 'agent_decisive'
                  ? 'La vente comptera pour l’IA dans le Dashboard, jamais en paie : l’IA n’est personne.'
                  : 'L’IA décisive compte pour elle dans le Dashboard, jamais en paie.'}
            </p>
          </div>
        ) : null}
        <div className="nv-field tm-field">
          <label className="nv-field__label" htmlFor={`${id}-note`}>
            Note (facultatif)
          </label>
          <textarea
            ref={noteArea}
            id={`${id}-note`}
            className="nv-field__control nv-glass sc-note grow-area"
            rows={2}
            maxLength={NOTE_MAX}
            value={note}
            placeholder={notePlaceholder(outcome, why)}
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
            data-autofocus={asksWhy ? undefined : true}
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
