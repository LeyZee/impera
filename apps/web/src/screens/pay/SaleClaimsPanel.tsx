import type { PayPeriod, PendingSaleClaim } from '@impera/contracts';
import { useId, useState, type JSX } from 'react';

import { ShiftLine } from './ClaimShiftLine';
import type { PayNames } from './data';
import { Unreachable } from './parts';

import { useGrowingArea } from '@/lib/growing-area';
import { answerSaleClaim, usePendingSaleClaims, useRefreshPayroll, type PayRefusal } from '@/payroll/api';
import { payRefusalText } from '@/payroll/model';
import { CLAIM_NOTE_MAX, claimShiftLine, pendingCountText, quoted } from '@/payroll/sale-claims';
import { useSchedulingSettings } from '@/reports/api';
import { periodLine } from '@/reports/model';
import { dayOf } from '@/scheduling/time';
import { initialsOf } from '@/settings/sales-feed/importing';
import { Dialog } from '@/shell/Dialog';
import { Panel } from '@/shell/layout';

const MOVED: ReadonlySet<string> = new Set(['sale_claim_not_found', 'sale_claim_answered_conflict']);

/**
 * Paie › Quinzaine, « Signalements de chatteurs » (ADR 0101 § 19, trou 15), for the owner and an active manager, just
 * above « Ventes en attente »: a chatter says he was decisive on a sale of one of his shifts. « Voir les ventes de ce
 * shift » opens « Donner une vente » on its day; the validator gives the sale there, then answers « Réglé », or « Pas
 * retenu » with a word. A claim of the reader's own is shown without a gesture: another validator answers it.
 */
export function SaleClaimsPanel({
  period,
  names,
  me,
  reads,
  onShowDay,
}: {
  /** The period on screen: only a claim of this one opens its day in « Donner une vente ». */
  period: PayPeriod;
  names: PayNames;
  me: { readonly id: string };
  /** The owner or an active manager. */
  reads: boolean;
  /** Opens « Donner une vente » on `day`, or `null` when the period's panel is not there to open. */
  onShowDay: ((day: string) => void) | null;
}): JSX.Element | null {
  const pending = usePendingSaleClaims(reads);
  const settings = useSchedulingSettings();
  const refresh = useRefreshPayroll();
  const [busy, setBusy] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<{ readonly id: string; readonly refusal: PayRefusal } | null>(null);
  const [refusing, setRefusing] = useState<PendingSaleClaim | null>(null);
  const zone = settings.data?.timeZone ?? null;
  if (!reads) return null;
  if (pending.isError)
    return (
      <Panel className="nv-enter py-held py-claims" title="Signalements de chatteurs">
        <Unreachable
          what="les signalements des chatteurs"
          onRetry={() => {
            void pending.refetch();
          }}
        />
      </Panel>
    );
  const claims = pending.data?.claims ?? [];
  if (claims.length === 0 || zone === null) return null;

  const settle = async (claim: PendingSaleClaim) => {
    setBusy(claim.id);
    setRefusal(null);
    const sent = await answerSaleClaim(claim.id, { outcome: 'settled', note: null });
    setBusy(null);
    if (sent.kind === 'ok') {
      await refresh();
      return;
    }
    setRefusal({ id: claim.id, refusal: sent });
    if (sent.kind === 'refused' && MOVED.has(sent.code)) await refresh();
  };

  return (
    <Panel
      className="nv-enter py-held py-claims"
      title="Signalements de chatteurs"
      actions={
        <span className="nv-tag nv-tag--tint nv-num py-claims__count">{pendingCountText(claims.length)}</span>
      }
    >
      <div className="rp-sec">
        <p className="py-quiet">
          Un chatteur dit avoir été décisif sur une vente pendant son shift. Retrouve-la, donne-la s’il a
          raison, puis réponds-lui : rien ne bouge dans la paie tant que tu ne donnes pas la vente.
        </p>
        <ul className="py-held__rows">
          {claims.map((claim) => {
            const own = names.member(claim.memberId).userId === me.id;
            const day = dayOf(claim.shift.startsAt, zone);
            const failed = refusal?.id === claim.id ? refusal.refusal : null;
            return (
              <li key={claim.id} className="py-held__row py-claim">
                <div className="py-held__main">
                  <p className="py-held__who">
                    <span className="nv-avatar nv-avatar--sm" aria-hidden="true">
                      {initialsOf(claim.memberName)}
                    </span>
                    {claim.memberName}
                  </p>
                  <ShiftLine shift={claim.shift} zone={zone} />
                  <p className="py-claim__note">{quoted(claim.note)}</p>
                  {failed === null ? null : (
                    <p className="tm-warn sc-refusal nv-swap" role="alert">
                      {payRefusalText(failed, { memberName: () => claim.memberName })}
                    </p>
                  )}
                </div>
                <div className="py-held__side">
                  {own ? (
                    <p className="py-held__reason">Le tien : un autre valideur y répond.</p>
                  ) : (
                    <div className="py-held__acts">
                      {claim.period === period && onShowDay !== null ? (
                        <button
                          type="button"
                          className="nv-btn nv-btn--plain nv-btn--sm"
                          onClick={() => {
                            onShowDay(day);
                          }}
                        >
                          Voir les ventes de ce shift
                        </button>
                      ) : (
                        <p className="py-held__reason">Quinzaine {periodLine(claim.period)}</p>
                      )}
                      <button
                        type="button"
                        className="nv-btn nv-btn--plain nv-btn--sm"
                        disabled={busy !== null}
                        onClick={() => {
                          setRefusing(claim);
                        }}
                      >
                        Pas retenu
                      </button>
                      <button
                        type="button"
                        className="nv-btn nv-btn--soft nv-btn--sm"
                        disabled={busy !== null}
                        aria-busy={busy === claim.id}
                        onClick={() => {
                          void settle(claim);
                        }}
                      >
                        <svg viewBox="0 0 16 16" aria-hidden="true" className="py-claims__icon">
                          <path d="m3.5 8.5 3 3 6-7" />
                        </svg>
                        Réglé
                      </button>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
      {refusing === null ? null : (
        <NotRetainedDialog
          claim={refusing}
          zone={zone}
          refresh={refresh}
          onClose={() => {
            setRefusing(null);
          }}
        />
      )}
    </Panel>
  );
}

function NotRetainedDialog({
  claim,
  zone,
  refresh,
  onClose,
}: {
  claim: PendingSaleClaim;
  zone: string;
  refresh: () => Promise<void>;
  onClose: () => void;
}): JSX.Element {
  const id = useId();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<PayRefusal | null>(null);
  const noteArea = useGrowingArea(note);
  const trimmed = note.trim();
  const send = async () => {
    if (trimmed === '') return;
    setBusy(true);
    setRefusal(null);
    const sent = await answerSaleClaim(claim.id, { outcome: 'not_retained', note: trimmed });
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
      title={`Pas retenu pour ${claim.memberName}`}
      lead={`${claimShiftLine(claim.shift, zone)}. Ton mot lui est montré tel quel.`}
      busy={busy}
      onClose={onClose}
    >
      <div className="tm-dialog__body">
        <div className="nv-field tm-field">
          <label className="nv-field__label" htmlFor={`${id}-note`}>
            Pourquoi
          </label>
          <textarea
            ref={noteArea}
            id={`${id}-note`}
            className="nv-field__control nv-glass sc-note grow-area"
            rows={2}
            maxLength={CLAIM_NOTE_MAX}
            value={note}
            placeholder="La vente est arrivée avant ton shift, sur la relance de l’IA."
            onChange={(event) => {
              setNote(event.target.value);
            }}
          />
        </div>
        {refusal === null ? null : (
          <p className="tm-warn sc-refusal nv-swap" role="alert">
            {payRefusalText(refusal, { memberName: () => claim.memberName })}
          </p>
        )}
        <div className="tm-dialog__foot">
          <button type="button" className="nv-btn nv-btn--plain" disabled={busy} onClick={onClose}>
            Annuler
          </button>
          <button
            type="button"
            className="nv-btn nv-btn--neon"
            disabled={busy || trimmed === ''}
            aria-busy={busy}
            onClick={() => {
              void send();
            }}
          >
            {busy ? 'Envoi…' : 'Envoyer'}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
