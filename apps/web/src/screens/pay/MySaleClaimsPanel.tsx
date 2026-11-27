import { newId, SaleClaimIdSchema, type SaleClaim, type SaleClaimShift } from '@impera/contracts';
import { useId, useState, type JSX } from 'react';

import { ShiftLine } from './ClaimShiftLine';
import { Unreachable } from './parts';

import { useGrowingArea } from '@/lib/growing-area';
import {
  answerSaleClaim,
  createSaleClaim,
  useMySaleClaims,
  useRefreshPayroll,
  type PayRefusal,
} from '@/payroll/api';
import { payRefusalText } from '@/payroll/model';
import {
  CLAIM_NOTE_MAX,
  CLAIM_STATE_LABELS,
  claimAnswerText,
  claimBlockedText,
  claimShiftLine,
  claimShiftParts,
  quoted,
} from '@/payroll/sale-claims';
import { useSchedulingSettings } from '@/reports/api';
import '@/scheduling/exchanges.css';
import { Dialog } from '@/shell/Dialog';
import { Panel } from '@/shell/layout';

/** The refusals that say the list moved under the member: it is read again. */
const MOVED: ReadonlySet<string> = new Set([
  'sale_claim_not_found',
  'sale_claim_shift_conflict',
  'sale_claims_too_many_conflict',
  'sale_claim_answered_conflict',
  'pay_period_closed_conflict',
]);

/**
 * Commissions, « J'ai été décisif sur une vente » (ADR 0101 §§ 18, 20, trou 15): the member signals one of his ended
 * shifts with a note, then follows it until a manager answers; he withdraws it while it waits. He never sees a sale
 * here, nor an amount, nor who made one: only his shift and the answer.
 */
export function MySaleClaimsPanel(): JSX.Element | null {
  const claims = useMySaleClaims(true);
  const settings = useSchedulingSettings();
  const refresh = useRefreshPayroll();
  const [asking, setAsking] = useState(false);
  const [withdrawing, setWithdrawing] = useState<SaleClaim | null>(null);
  const zone = settings.data?.timeZone ?? null;
  if (claims.isError)
    return (
      <Panel className="nv-enter py-claims" eyebrow="Une vente grâce à moi">
        <Unreachable
          what="tes signalements"
          onRetry={() => {
            void claims.refetch();
          }}
        />
      </Panel>
    );
  if (claims.data === undefined || zone === null) return null;
  const { claims: mine, shifts } = claims.data;
  const blocked = claimBlockedText(mine, shifts);

  return (
    <Panel className="nv-enter py-claims" eyebrow="Une vente grâce à moi">
      <div className="rp-sec">
        <p className="py-quiet">
          Un fan a acheté pendant le shift d’un autre, mais c’est toi qui lui as donné envie ? Signale ton
          shift : ton manager retrouve la vente et te la donne.
        </p>
        <div className="py-claims__ask">
          <button
            type="button"
            className="nv-btn nv-btn--soft nv-btn--sm"
            disabled={blocked !== null}
            onClick={() => {
              setAsking(true);
            }}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true" className="py-claims__icon">
              <path d="M8 2.5 9.6 6l3.9.4-2.9 2.6.8 3.8L8 10.9l-3.4 1.9.8-3.8L2.5 6.4 6.4 6z" />
            </svg>
            Signaler un shift
          </button>
          {blocked === null ? null : <p className="tm-hint">{blocked}</p>}
        </div>
        {mine.length === 0 ? null : (
          <ul className="py-held__rows">
            {mine.map((claim) => {
              const answer = claimAnswerText(claim);
              return (
                <li key={claim.id} className="py-held__row py-claim">
                  <div className="py-held__main">
                    <ShiftLine shift={claim.shift} zone={zone} />
                    <p className="nv-note">{quoted(claim.note)}</p>
                    {answer === null ? null : <p className="py-held__reason">{answer}</p>}
                  </div>
                  <div className="py-held__side">
                    <span className="nv-tag nv-tag--tint py-claim__state" data-state={claim.state}>
                      {CLAIM_STATE_LABELS[claim.state]}
                    </span>
                    {claim.state === 'waiting' ? (
                      <div className="py-held__acts">
                        <button
                          type="button"
                          className="nv-btn nv-btn--plain nv-btn--sm"
                          onClick={() => {
                            setWithdrawing(claim);
                          }}
                        >
                          Retirer
                        </button>
                      </div>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {asking ? (
        <ClaimDialog
          shifts={shifts}
          zone={zone}
          refresh={refresh}
          onClose={() => {
            setAsking(false);
          }}
        />
      ) : null}
      {withdrawing === null ? null : (
        <WithdrawDialog
          claim={withdrawing}
          zone={zone}
          refresh={refresh}
          onClose={() => {
            setWithdrawing(null);
          }}
        />
      )}
    </Panel>
  );
}

function ClaimDialog({
  shifts,
  zone,
  refresh,
  onClose,
}: {
  shifts: readonly SaleClaimShift[];
  zone: string;
  refresh: () => Promise<void>;
  onClose: () => void;
}): JSX.Element {
  const id = useId();
  // One id for the claim, kept across a retry: the same claim sent twice is one.
  const [claimId] = useState(() => newId(SaleClaimIdSchema));
  const [picked, setPicked] = useState<string | null>(
    shifts.length === 1 ? (shifts[0]?.shiftId ?? null) : null,
  );
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<PayRefusal | null>(null);
  const noteArea = useGrowingArea(note);
  const trimmed = note.trim();
  const shift = shifts.find((one) => one.shiftId === picked);

  const send = async () => {
    if (shift === undefined || trimmed === '') return;
    setBusy(true);
    setRefusal(null);
    const sent = await createSaleClaim({ id: claimId, shiftId: shift.shiftId, note: trimmed });
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
    <Dialog
      className="py-dialog"
      title="Une vente grâce à moi"
      lead="Choisis ton shift et dis à ton manager quel fan et ce qui s’est passé. Il retrouve la vente et décide."
      busy={busy}
      onClose={onClose}
    >
      <div className="tm-dialog__body">
        <div className="nv-field tm-field">
          <span className="nv-field__label" id={`${id}-shift`}>
            Ton shift
          </span>
          <div className="sc-options py-claims__shifts" role="radiogroup" aria-labelledby={`${id}-shift`}>
            {shifts.map((one) => {
              const { when, where } = claimShiftParts(one, zone);
              const checked = picked === one.shiftId;
              return (
                <button
                  key={one.shiftId}
                  type="button"
                  role="radio"
                  className="sc-option"
                  aria-checked={checked}
                  onClick={() => {
                    setPicked(one.shiftId);
                    setRefusal(null);
                  }}
                >
                  <span className="sc-option__text">
                    <span className="sc-option__title nv-num py-claims__when">{when}</span>
                    <span className="sc-option__sub">{where}</span>
                  </span>
                  <svg
                    className="py-claims__check"
                    viewBox="0 0 16 16"
                    aria-hidden="true"
                    data-on={checked ? 'true' : undefined}
                  >
                    <path d="M3.5 8.5l3 3 6-7" />
                  </svg>
                </button>
              );
            })}
          </div>
        </div>
        <div className="nv-field tm-field">
          <label className="nv-field__label" htmlFor={`${id}-note`}>
            Ce qui s’est passé
          </label>
          <textarea
            ref={noteArea}
            id={`${id}-note`}
            className="nv-field__control nv-glass sc-note grow-area"
            rows={3}
            maxLength={CLAIM_NOTE_MAX}
            value={note}
            placeholder="Le fan au pseudo en « m », je l’ai chauffé tout le shift, il a acheté le pack juste après."
            onChange={(event) => {
              setNote(event.target.value);
            }}
          />
          <p className="tm-hint">Lu par ton manager seulement. Le pseudo du fan, jamais ses messages.</p>
        </div>
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
            disabled={busy || shift === undefined || trimmed === ''}
            aria-busy={busy}
            onClick={() => {
              void send();
            }}
          >
            {busy ? 'Envoi…' : 'Envoyer à mon manager'}
          </button>
        </div>
      </div>
    </Dialog>
  );
}

function WithdrawDialog({
  claim,
  zone,
  refresh,
  onClose,
}: {
  claim: SaleClaim;
  zone: string;
  refresh: () => Promise<void>;
  onClose: () => void;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<PayRefusal | null>(null);
  const send = async () => {
    setBusy(true);
    setRefusal(null);
    const sent = await answerSaleClaim(claim.id, { outcome: 'withdrawn', note: null });
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
    <Dialog
      className="py-dialog"
      title="Retirer ton signalement ?"
      lead={`${claimShiftLine(claim.shift, zone)}. Il reste au journal, marqué « Retiré ».`}
      busy={busy}
      onClose={onClose}
    >
      <div className="tm-dialog__body">
        {refusal === null ? null : (
          <p className="tm-warn sc-refusal nv-swap" role="alert">
            {payRefusalText(refusal, { memberName: () => 'Un membre' })}
          </p>
        )}
        <div className="tm-dialog__foot">
          <button type="button" className="nv-btn nv-btn--plain" disabled={busy} onClick={onClose}>
            Garder
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
            {busy ? 'Retrait…' : 'Retirer'}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
