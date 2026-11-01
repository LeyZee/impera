import { PAYOUT_DELAY_MAX_BUSINESS_DAYS } from '@nirvana/contracts';
import { useId, useState, type JSX } from 'react';

import { setPayrollSettings, usePayrollSettings, useRefreshPayroll, type PayRefusal } from '@/payroll/api';
import { payoutDelayText, payRefusalText } from '@/payroll/model';
import '@/payroll/pay.css';
import { Dialog } from '@/screens/team/Dialog';

/** A whole number of business days the owner may announce, or null for a typo. */
function parseDelay(text: string): number | null {
  const value = Number(text.trim());
  return text.trim() !== '' &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= PAYOUT_DELAY_MAX_BUSINESS_DAYS
    ? value
    : null;
}

/**
 * The usual payout delay in Réglages › Règles de paie (PAIE-32, owner): how many business days after its validation a
 * statement is paid, as Commissions tells each member. A setting the owner announces, never a figure in the code; it
 * changes no amount.
 */
export function PayoutDelay(): JSX.Element {
  const settings = usePayrollSettings();
  const [open, setOpen] = useState(false);
  const data = settings.data;

  return (
    <div className="nv-plate rp-account nv-enter">
      <div className="rp-account__head">
        <div className="rp-account__who">
          <p className="rp-account__name">Délai de versement</p>
          <p className="rp-account__handle">annoncé à l’équipe dans Commissions</p>
        </div>
        {data === undefined ? null : (
          <button
            type="button"
            className="nv-btn nv-btn--soft nv-btn--sm"
            onClick={() => {
              setOpen(true);
            }}
          >
            Changer
          </button>
        )}
      </div>
      {data === undefined ? (
        settings.isError ? (
          <p className="tm-warn">Le serveur ne répond pas : le délai n’a pas pu être lu.</p>
        ) : (
          <div className="sc-skeleton" aria-hidden="true">
            <i />
          </div>
        )
      ) : (
        <div className="rp-account__now">
          <p className="rp-account__rules">
            {data.payoutDelayBusinessDays === null
              ? 'Aucun délai annoncé'
              : payoutDelayText(data.payoutDelayBusinessDays)}
          </p>
          <p className="rp-account__since">
            {data.payoutDelayBusinessDays === null
              ? 'Commissions ne dit pas quand un relevé validé est versé : annonce un délai pour éviter les questions.'
              : 'Commissions le dit à chaque membre sous ses relevés validés. Le délai ne change aucun montant.'}
          </p>
        </div>
      )}
      {open && data !== undefined ? (
        <DelayDialog
          delay={data.payoutDelayBusinessDays}
          onClose={() => {
            setOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

function DelayDialog({ delay, onClose }: { delay: number | null; onClose: () => void }): JSX.Element {
  const id = useId();
  const refresh = useRefreshPayroll();
  const [days, setDays] = useState(delay === null ? '' : String(delay));
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<PayRefusal | null>(null);
  const value = parseDelay(days);

  const send = async (next: number | null): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setRefusal(null);
    const outcome = await setPayrollSettings({ payoutDelayBusinessDays: next });
    await refresh();
    setBusy(false);
    if (outcome.kind === 'ok') {
      onClose();
      return;
    }
    setRefusal(outcome);
  };

  return (
    <Dialog title="Délai de versement" lead="Annoncé à toute l’équipe" busy={busy} onClose={onClose}>
      <form
        className="tm-dialog__body"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          setTouched(true);
          if (value !== null) void send(value);
        }}
      >
        <div className="nv-field" data-invalid={touched && value === null ? 'true' : undefined}>
          <label className="nv-field__label" htmlFor={`${id}-days`}>
            Jours ouvrés après la validation
          </label>
          <input
            id={`${id}-days`}
            className="nv-field__control nv-glass nv-num"
            inputMode="numeric"
            autoComplete="off"
            value={days}
            data-autofocus
            aria-invalid={touched && value === null}
            onChange={(event) => {
              setDays(event.target.value);
            }}
          />
          <p className={touched && value === null ? 'tm-hint tm-hint--error' : 'tm-hint'}>
            {touched && value === null
              ? `Un nombre entier de jours, de 1 à ${String(PAYOUT_DELAY_MAX_BUSINESS_DAYS)}.`
              : 'Par exemple 3 : le lundi pour un relevé validé le mercredi d’avant.'}
          </p>
        </div>
        {refusal === null ? null : (
          <p className="tm-warn sc-refusal nv-swap" role="alert">
            {payRefusalText(refusal, { memberName: () => 'Un membre' })}
          </p>
        )}
        <div className="tm-dialog__foot">
          {delay === null ? (
            <button type="button" className="nv-btn nv-btn--plain" disabled={busy} onClick={onClose}>
              Annuler
            </button>
          ) : (
            <button
              type="button"
              className="nv-btn nv-btn--plain"
              disabled={busy}
              onClick={() => {
                void send(null);
              }}
            >
              Ne plus annoncer de délai
            </button>
          )}
          <button type="submit" className="nv-btn nv-btn--neon" disabled={busy} aria-busy={busy}>
            {busy ? 'Enregistrement…' : 'Enregistrer le délai'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
