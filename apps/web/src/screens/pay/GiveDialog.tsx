import {
  newId,
  PaySaleDecisionIdSchema,
  SALE_WHOLE_BP,
  type HeldSale,
  type PayPeriod,
  type TeamMemberId,
} from '@impera/contracts';
import { useId, useRef, useState, type JSX, type KeyboardEvent, type PointerEvent } from 'react';

import type { PayNames } from './data';
import { Swatch } from './parts';

import { useGrowingArea } from '@/lib/growing-area';
import { decideSale, useRefreshPayroll, type PayRefusal } from '@/payroll/api';
import {
  giveWords,
  HALF_BP,
  partsOf,
  saleAmount,
  saleWhen,
  SHARE_MAX_BP,
  SHARE_MIN_BP,
  SHARE_STEP_BP,
  shareOnStep,
  shareText,
  type SaleMember,
} from '@/payroll/held-sales';
import { payRefusalText } from '@/payroll/model';
import { amountText } from '@/reports/model';
import { accountLine } from '@/scheduling/model';
import { Dialog } from '@/shell/Dialog';

/** The longest note pay keeps on a decision (`PayReasonSchema`). */
const NOTE_MAX = 500;

/** A refusal that says the sale moved under the reader: the lists are read again. */
const MOVED: ReadonlySet<string> = new Set([
  'pay_sale_not_found',
  'pay_sale_outcome_conflict',
  'pay_sale_recipient_conflict',
]);

/**
 * « Donner à… » (ADR 0101): the member who was decisive, among those on shift on the account at the sale's instant
 * (`recipients`, the server's list), the whole sale by default or a share with its author (50/50 in one gesture, or by
 * steps of 10 % on one bar), and why, which both members will read. A sale of the agent is given whole. Opened on a
 * sale already given, it starts from its give, to change the recipient or the share. The id is drawn once, so that
 * sending again after a lost answer writes nothing twice.
 */
export function GiveDialog({
  period,
  sale,
  member,
  names,
  zone,
  onClose,
}: {
  period: PayPeriod;
  sale: HeldSale;
  /** The member who made the sale; `null` for the agent's. */
  member: SaleMember | null;
  names: PayNames;
  zone: string;
  onClose: () => void;
}): JSX.Element {
  const id = useId();
  const refresh = useRefreshPayroll();
  const [decisionId] = useState(() => newId(PaySaleDecisionIdSchema));
  const before = sale.given;
  const [recipient, setRecipient] = useState<TeamMemberId | null>(
    before !== null && sale.recipients.includes(before.recipientMemberId)
      ? before.recipientMemberId
      : sale.recipients.length === 1
        ? (sale.recipients[0] ?? null)
        : null,
  );
  // ADR 0101 § 12: a sale of the agent is never shared.
  const shareable = !sale.byAgent && sale.memberId !== null;
  const [shared, setShared] = useState(shareable && before !== null && before.shareBp < SALE_WHOLE_BP);
  const [shareBp, setShareBp] = useState(
    before !== null && before.shareBp < SALE_WHOLE_BP ? before.shareBp : HALF_BP,
  );
  const [note, setNote] = useState(before?.note ?? '');
  const noteArea = useGrowingArea(note);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<PayRefusal | null>(null);

  const account = names.account(sale.platformAccountId);
  const recipientName = recipient === null ? null : names.member(recipient).name;
  const bp = shared ? shareBp : SALE_WHOLE_BP;
  const words = giveWords(recipientName, bp);
  const trimmed = note.trim();
  const noRecipient = recipient === null;
  const noNote = trimmed === '';

  const send = async () => {
    setTouched(true);
    if (recipient === null || noNote) return;
    setBusy(true);
    setRefusal(null);
    const sent = await decideSale({
      id: decisionId,
      period,
      platform: sale.platform,
      platformSaleId: sale.platformSaleId,
      outcome: 'give',
      note: trimmed,
      recipientMemberId: recipient,
      shareBp: bp,
      excludeReason: null,
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
                {saleWhen(sale, zone)} ·{' '}
                {sale.byAgent ? 'vendue par l’IA' : `vendue par ${member?.name ?? 'un chatteur'}`}
              </small>
            </dt>
            <dd>{saleAmount(sale)}</dd>
          </div>
        </dl>

        <div className="nv-field tm-field" data-invalid={touched && noRecipient ? 'true' : undefined}>
          <span className="nv-field__label" id={`${id}-to`}>
            À qui
          </span>
          <div className="tm-choices py-give__to" role="radiogroup" aria-labelledby={`${id}-to`}>
            {sale.recipients.map((one) => {
              const who = names.member(one);
              return (
                <button
                  key={one}
                  type="button"
                  role="radio"
                  className="nv-chip"
                  aria-checked={recipient === one}
                  data-autofocus={
                    recipient === one || (recipient === null && one === sale.recipients[0]) ? true : undefined
                  }
                  onClick={() => {
                    setRecipient(one);
                  }}
                >
                  <Swatch color={who.color} />
                  {who.name}
                </button>
              );
            })}
          </div>
          <p className="tm-hint" id={`${id}-to-hint`}>
            {touched && noRecipient
              ? 'Choisis le membre qui a convaincu le fan.'
              : 'Seuls les membres en poste sur ce compte à l’heure de la vente, marge comprise.'}
          </p>
        </div>

        {shareable ? (
          <div className="nv-field tm-field">
            <span className="nv-field__label" id={`${id}-part`}>
              Quelle part
            </span>
            <div className="tm-choices" role="radiogroup" aria-labelledby={`${id}-part`}>
              <button
                type="button"
                role="radio"
                className="nv-chip"
                aria-checked={!shared}
                onClick={() => {
                  setShared(false);
                }}
              >
                Toute la vente
              </button>
              <button
                type="button"
                role="radio"
                className="nv-chip"
                aria-checked={shared}
                onClick={() => {
                  setShared(true);
                }}
              >
                Partager
              </button>
            </div>
            {shared ? (
              <ShareBar
                id={`${id}-share`}
                labelledBy={`${id}-part`}
                value={shareBp}
                netMinor={sale.netMinor}
                currency={sale.currency}
                recipient={recipient === null ? null : names.member(recipient)}
                author={sale.memberId === null ? null : names.member(sale.memberId)}
                onChange={setShareBp}
              />
            ) : (
              <p className="tm-hint">
                Par défaut, la vente va entière au membre choisi. Partage-la seulement quand les deux ont
                vraiment compté.
              </p>
            )}
          </div>
        ) : (
          <p className="tm-hint">Une vente de l’IA se donne entière : elle ne se partage pas.</p>
        )}

        <div className="nv-field tm-field" data-invalid={touched && noNote ? 'true' : undefined}>
          <label className="nv-field__label" htmlFor={`${id}-note`}>
            Pourquoi ce membre a été décisif
          </label>
          <textarea
            ref={noteArea}
            id={`${id}-note`}
            className="nv-field__control nv-glass sc-note grow-area"
            rows={2}
            maxLength={NOTE_MAX}
            value={note}
            aria-invalid={touched && noNote}
            aria-describedby={`${id}-note-hint`}
            placeholder="A relancé le fan après le média payant et l’a convaincu de l’ouvrir."
            onChange={(event) => {
              setNote(event.target.value);
            }}
          />
          <p className="tm-hint" id={`${id}-note-hint`}>
            {touched && noNote
              ? 'Obligatoire : les deux membres la liront sur leur relevé.'
              : 'Les deux membres la liront sur leur relevé. Jamais le message ni le nom d’un fan.'}
          </p>
        </div>

        {refusal === null ? null : (
          <p className="tm-warn sc-refusal nv-swap" role="alert">
            {payRefusalText(refusal, { memberName: () => recipientName ?? 'Un membre' })}
          </p>
        )}
        <div className="tm-dialog__foot">
          <button type="button" className="nv-btn nv-btn--plain" disabled={busy} onClick={onClose}>
            Annuler
          </button>
          <button
            type="button"
            className="nv-btn nv-btn--neon"
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

/** A member as the bar names and colours them. */
interface BarMember {
  readonly name: string;
  readonly color: string | null;
}

/**
 * The share of a sale on one bar (ADR 0101 § 11): the recipient's part on the left, the author's on the right, the
 * handle between them, by steps of 10 % from 10 % to 90 %; « 50/50 » sets the half in one gesture. Each side says its
 * share and its part of the net, as the server will round it. Drawn by the page, never the browser's own slider (no
 * native control, docs/design): dragged, tapped on its track, or moved by the arrows (10 %), Home and End.
 */
function ShareBar({
  id,
  labelledBy,
  value,
  netMinor,
  currency,
  recipient,
  author,
  onChange,
}: {
  id: string;
  labelledBy: string;
  value: number;
  netMinor: number;
  currency: HeldSale['currency'];
  recipient: BarMember | null;
  author: BarMember | null;
  onChange: (bp: number) => void;
}): JSX.Element {
  const track = useRef<HTMLDivElement>(null);
  const parts = partsOf(netMinor, value);
  const left = recipient?.name ?? 'Le membre choisi';
  const right = author?.name ?? 'Son chatteur';
  const valueText = `${left} ${shareText(value)}, ${right} ${shareText(SALE_WHOLE_BP - value)}`;

  const fromPointer = (event: PointerEvent<HTMLDivElement>): void => {
    const box = track.current?.getBoundingClientRect();
    if (box === undefined || box.width === 0) return;
    const at = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
    const next = shareOnStep(at * SALE_WHOLE_BP);
    if (next !== value) onChange(next);
  };

  const onKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    const moves: Partial<Record<string, number>> = {
      ArrowRight: SHARE_STEP_BP,
      ArrowUp: SHARE_STEP_BP,
      ArrowLeft: -SHARE_STEP_BP,
      ArrowDown: -SHARE_STEP_BP,
    };
    let next: number | null = null;
    if (event.key === 'Home') next = SHARE_MIN_BP;
    else if (event.key === 'End') next = SHARE_MAX_BP;
    else {
      const move = moves[event.key];
      if (move !== undefined) next = shareOnStep(value + move);
    }
    if (next === null) return;
    event.preventDefault();
    if (next !== value) onChange(next);
  };

  return (
    <div className="py-share">
      <div className="py-share__sides nv-num" aria-hidden="true">
        <span className="py-share__side">
          <b>{left}</b> {shareText(value)}
          <small>{amountText(parts.recipient, currency)}</small>
        </span>
        <span className="py-share__side py-share__side--author">
          <b>{right}</b> {shareText(SALE_WHOLE_BP - value)}
          <small>{amountText(parts.author, currency)}</small>
        </span>
      </div>
      <div className="py-share__row">
        <div
          ref={track}
          id={id}
          className="py-share__track"
          role="slider"
          tabIndex={0}
          aria-labelledby={labelledBy}
          aria-valuemin={SHARE_MIN_BP / 100}
          aria-valuemax={SHARE_MAX_BP / 100}
          aria-valuenow={value / 100}
          aria-valuetext={valueText}
          style={{
            '--py-share': value / SALE_WHOLE_BP,
            ...(recipient?.color == null ? {} : { '--py-share-mine': recipient.color }),
            ...(author?.color == null ? {} : { '--py-share-rest': author.color }),
          }}
          onKeyDown={onKey}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            fromPointer(event);
          }}
          onPointerMove={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) fromPointer(event);
          }}
        >
          <span className="py-share__mine" aria-hidden="true" />
          <span className="py-share__rest" aria-hidden="true" />
          <span className="py-share__thumb" aria-hidden="true" />
        </div>
        <button
          type="button"
          className="nv-chip nv-num"
          aria-pressed={value === HALF_BP}
          onClick={() => {
            onChange(HALF_BP);
          }}
        >
          50/50
        </button>
      </div>
    </div>
  );
}
