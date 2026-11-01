import { newId, PayoutMinimumIdSchema, type PayPeriod } from '@nirvana/contracts';
import { useId, useState, type JSX } from 'react';

import { addPayoutMinimum, usePayrollSettings, useRefreshPayroll, type PayRefusal } from '@/payroll/api';
import { payRefusalText, rulePeriods } from '@/payroll/model';
import '@/payroll/pay.css';
import { amountInput, amountText, parseAmount, periodLine, periodTitle } from '@/reports/model';
import { useAgencyToday } from '@/screens/pay/data';
import { Dialog } from '@/screens/team/Dialog';

const STEPS = ['Remplir', 'Relire'] as const;

/** How many periods ahead a new minimum may start. */
const MINIMUM_PERIODS = 4;

/** « 1er – 15 novembre »: a period on a chip. */
const periodChip = (period: PayPeriod): string => periodTitle(period).replace(/\s\d{4}$/u, '');

/**
 * The payout minimum in Réglages › Règles de paie (EQ-05, owner): below it a statement pays nothing and carries its
 * total over. A new minimum starts with a fortnight that has not begun (PAIE-22): the fortnights already worked keep
 * theirs. A member's final statement has none.
 */
export function MinimumPayout(): JSX.Element {
  const settings = usePayrollSettings();
  const today = useAgencyToday();
  const [open, setOpen] = useState(false);
  const data = settings.data;

  return (
    <div className="nv-plate rp-account nv-enter">
      <div className="rp-account__head">
        <div className="rp-account__who">
          <p className="rp-account__name">Minimum de versement</p>
          <p className="rp-account__handle">pour toute l’équipe</p>
        </div>
        {data === undefined || today === null ? null : (
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
          <div className="rp-account__now">
            <p className="tm-warn">Le serveur ne répond pas : le minimum n’a pas pu être lu.</p>
            <button
              type="button"
              className="nv-btn nv-btn--soft nv-btn--sm tm-self-start"
              onClick={() => {
                void settings.refetch();
              }}
            >
              Réessayer
            </button>
          </div>
        ) : (
          <div className="sc-skeleton" aria-hidden="true">
            <i />
          </div>
        )
      ) : (
        <div className="rp-account__now">
          <span className="rp-chip rp-chip--ok">En vigueur</span>
          <p className="rp-account__rules nv-num">
            {data.minimumPayoutMinor === 0 ? 'Aucun minimum' : amountText(data.minimumPayoutMinor, 'EUR')}
          </p>
          {data.nextMinimum === null ? null : (
            <p className="rp-account__since">
              {`Puis ${
                data.nextMinimum.minimumPayoutMinor === 0
                  ? 'aucun minimum'
                  : amountText(data.nextMinimum.minimumPayoutMinor, 'EUR')
              } à partir de la quinzaine ${periodLine(data.nextMinimum.fromPeriod)}.`}
            </p>
          )}
          <p className="rp-account__since">
            Sous ce total, un relevé ne verse rien et reporte tout sur la quinzaine suivante. Un nouveau
            minimum part d’une quinzaine qui n’a pas commencé ; le relevé final d’un membre qui part verse
            tout.
          </p>
        </div>
      )}
      {open && data !== undefined && today !== null ? (
        <MinimumDialog
          minimum={data.minimumPayoutMinor}
          periods={rulePeriods(today, MINIMUM_PERIODS)}
          today={today}
          onClose={() => {
            setOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

function MinimumDialog({
  minimum,
  periods,
  today,
  onClose,
}: {
  minimum: number;
  /** The periods the minimum may start with: not begun yet, in order (PAIE-22). */
  periods: readonly PayPeriod[];
  /** Today in the agency's zone: on the 1st or the 16th, today's period has not begun and may take the minimum. */
  today: string;
  onClose: () => void;
}): JSX.Element {
  const id = useId();
  const refresh = useRefreshPayroll();
  const [minimumId] = useState(() => newId(PayoutMinimumIdSchema));
  const [from, setFrom] = useState<PayPeriod | undefined>(periods[0]);
  const [amount, setAmount] = useState(amountInput(minimum));
  const [touched, setTouched] = useState(false);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<PayRefusal | null>(null);
  const minor = parseAmount(amount);
  const step = checking ? 1 : 0;

  const send = async (): Promise<void> => {
    if (minor === null || from === undefined || busy) return;
    setBusy(true);
    setRefusal(null);
    const outcome = await addPayoutMinimum({ id: minimumId, fromPeriod: from, minimumPayoutMinor: minor });
    await refresh();
    setBusy(false);
    if (outcome.kind === 'ok') {
      onClose();
      return;
    }
    setRefusal(outcome);
    setChecking(false);
  };

  return (
    <Dialog title="Minimum de versement" lead="Pour toute l’équipe" busy={busy} onClose={onClose}>
      <div className="tm-dialog__body">
        <ol className="tm-steps" aria-label="Étapes">
          {STEPS.map((title, index) => (
            <li
              key={title}
              data-state={index < step ? 'done' : index === step ? 'now' : 'later'}
              aria-current={index === step ? 'step' : undefined}
            >
              <span className="tm-steps__num">{String(index + 1)}</span>
              {title}
            </li>
          ))}
        </ol>
        {checking && minor !== null && from !== undefined ? (
          <>
            <p className="py-recap nv-enter">
              À partir de la quinzaine {periodLine(from)},{' '}
              {minor === 0 ? (
                <>
                  <b>aucun minimum</b> : chaque relevé verse son total, même petit.
                </>
              ) : (
                <>
                  sous <b className="nv-num">{amountText(minor, 'EUR')}</b>, un relevé ne verse rien et
                  reporte son total sur la quinzaine suivante.
                </>
              )}
            </p>
            <p className="tm-hint">
              {from === today
                ? 'La quinzaine du jour commence aujourd’hui : elle prend ce minimum. Celles d’avant gardent le leur : une règle de paie ne change pas en cours de route.'
                : `Les quinzaines déjà commencées gardent leur minimum, ${amountText(minimum, 'EUR')} pour celle en cours : une règle de paie ne change pas en cours de route.`}
            </p>
            <div className="tm-dialog__foot">
              <button
                type="button"
                className="nv-btn nv-btn--plain"
                disabled={busy}
                onClick={() => {
                  setChecking(false);
                }}
              >
                Modifier
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
                {busy ? 'Enregistrement…' : 'Enregistrer le minimum'}
              </button>
            </div>
          </>
        ) : (
          <form
            className="tm-dialog__body"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              setTouched(true);
              if (minor !== null && from !== undefined) setChecking(true);
            }}
          >
            <div className="nv-field tm-field">
              <span className="nv-field__label" id={`${id}-from`}>
                À partir de la quinzaine
              </span>
              <div className="tm-choices" role="radiogroup" aria-labelledby={`${id}-from`}>
                {periods.map((one) => (
                  <button
                    key={one}
                    type="button"
                    role="radio"
                    className="nv-chip nv-num"
                    aria-checked={from === one}
                    onClick={() => {
                      setFrom(one);
                    }}
                  >
                    {periodChip(one)}
                  </button>
                ))}
              </div>
            </div>
            <div className="nv-field rp-amount" data-invalid={touched && minor === null ? 'true' : undefined}>
              <label className="nv-field__label" htmlFor={`${id}-minimum`}>
                Minimum
              </label>
              <div className="rp-amount__box">
                <input
                  id={`${id}-minimum`}
                  className="nv-field__control nv-glass rp-amount__input nv-num"
                  inputMode="decimal"
                  autoComplete="off"
                  value={amount}
                  data-autofocus
                  aria-invalid={touched && minor === null}
                  onChange={(event) => {
                    setAmount(event.target.value);
                  }}
                />
                <span className="rp-amount__sign" aria-hidden="true">
                  €
                </span>
              </div>
              <p className={touched && minor === null ? 'tm-hint tm-hint--error' : 'tm-hint'}>
                {touched && minor === null
                  ? 'Un montant en euros, deux décimales au plus.'
                  : 'À 0, chaque relevé verse son total, même petit.'}
              </p>
            </div>
            {refusal === null ? null : (
              <p className="tm-warn sc-refusal nv-swap" role="alert">
                {payRefusalText(refusal, { memberName: () => 'Un membre' })}
              </p>
            )}
            <div className="tm-dialog__foot">
              <button type="button" className="nv-btn nv-btn--plain" onClick={onClose}>
                Annuler
              </button>
              <button type="submit" className="nv-btn nv-btn--neon">
                Vérifier
              </button>
            </div>
          </form>
        )}
      </div>
    </Dialog>
  );
}
