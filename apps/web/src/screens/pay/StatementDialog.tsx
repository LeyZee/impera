import {
  containsIban,
  PAYMENT_REFERENCE_MAX,
  type CommissionStatement,
  type ExchangeRate,
  type PaymentMethod,
  type PayrollPeriod,
} from '@nirvana/contracts';
import { useId, useState, type JSX } from 'react';

import { EntryForm, type EntryAdded } from './EntryForm';
import { useCfaFrancs, type PayNames } from './data';
import { Chip, Delta, MoneyPath, Swatch } from './parts';

import { payStatement, useLatestPayPeriod, useRefreshPayroll, type PayRefusal } from '@/payroll/api';
import {
  changeBps,
  computedText,
  dayMonthText,
  fcfaText,
  momentAt,
  PAID_BY,
  payRefusalText,
  rateText,
  shortHash,
  statementChips,
  whoName,
} from '@/payroll/model';
import {
  amountInput,
  amountText,
  parseAmount,
  percentText,
  periodLine,
  periodTitle,
  previousPeriod,
  signedAmountText,
} from '@/reports/model';
import { dayOf, longDay } from '@/scheduling/time';
import { useNow } from '@/scheduling/useNow';
import { Dialog } from '@/screens/team/Dialog';

type Mode = 'read' | 'pay' | 'check' | 'adjust';

/**
 * A statement opened from its row (EQ-05): the path of the money account by account, then what adds up to what is
 * paid; folded, the rules it copied and its revision. Its one gesture: « Valider ce relevé », or for the owner
 * « Marquer payé » in two steps (fill, read again). A validated or paid statement no longer changes: « Ajuster » adds
 * an adjustment on the member's next period to validate.
 */
export function StatementDialog({
  statement,
  period,
  names,
  previousNet,
  me,
  owner,
  canValidateNow,
  paying,
  onValidate,
  onClose,
}: {
  statement: CommissionStatement;
  period: PayrollPeriod;
  names: PayNames;
  /** The member's net the period before, for the change; `null` without a statement then. */
  previousNet: number | null;
  me: { readonly id: string; readonly name: string };
  owner: boolean;
  /** The period has ended and nothing blocks it: a draft the reader may validate can be. */
  canValidateNow: boolean;
  /** Opened on « Marquer payé » from the row. */
  paying: boolean;
  onValidate: (statement: CommissionStatement) => void;
  onClose: () => void;
}): JSX.Element {
  const member = names.member(statement.memberId);
  const [mode, setMode] = useState<Mode>(paying ? 'pay' : 'read');
  const [busy, setBusy] = useState(false);
  const [adjusted, setAdjusted] = useState<EntryAdded | null>(null);
  const own = member.userId === me.id;
  const zone = statement.window.timeZone;
  const status = statementChips(statement, period.ended).map((chip) => chip.label);
  const now = useNow();
  const who = (userId: string | null): string =>
    userId === null ? 'le propriétaire' : whoName(userId, me, names.members);

  return (
    <Dialog
      className="py-dialog"
      title={
        <>
          <Swatch color={member.color} />
          {member.name}
        </>
      }
      lead={
        <>
          Relevé de commissions · {periodTitle(statement.window.period)}
          <Chip chip={{ label: status.join(' · '), tone: 'neutral' }} />
        </>
      }
      busy={busy}
      onClose={onClose}
    >
      {mode === 'read' ? (
        <div className="tm-dialog__body py-read">
          <div className="py-dialog__hero">
            <div className="py-hero">
              <p className="py-hero__label">{statement.status === 'paid' ? 'Versé' : 'À verser'}</p>
              <p className="py-hero__value nv-num">{amountText(statement.payableMinor, 'EUR')}</p>
            </div>
            <p className="py-hero__note nv-num">
              net {amountText(statement.netMinor, 'EUR')}{' '}
              <Delta
                bps={changeBps(statement.netMinor, previousNet)}
                title={
                  previousNet === null
                    ? 'Pas de relevé la quinzaine d’avant'
                    : `${amountText(previousNet, 'EUR')} de net la quinzaine d’avant`
                }
              />{' '}
              vs {periodTitle(previousPeriod(statement.window.period), false)}
            </p>
          </div>
          <div className="py-read__scroll">
            <MoneyPath statement={statement} names={names} you={false} />
            <details className="nv-disclosure py-fold">
              <summary>
                <span className="nv-disclosure__title">Règles et calcul</span>
                <span className="nv-disclosure__sum nv-num">
                  révision {statement.revision} · calculé {computedText(statement.computedAt, zone, now)}
                </span>
              </summary>
              <dl className="nv-disclosure__body py-rules nv-num">
                <dt>Taux de {member.name}</dt>
                <dd>
                  {percentText(statement.rules.commissionRateBps)}
                  {statement.rules.teamShareBps === null
                    ? ''
                    : `, part d’équipe ${percentText(statement.rules.teamShareBps)}`}
                </dd>
                <dt>Paliers</dt>
                <dd>
                  {statement.rules.bonusTiers.length === 0
                    ? 'aucun'
                    : statement.rules.bonusTiers
                        .map(
                          (tier) =>
                            `${tier.label} ${amountText(tier.thresholdMinor, 'EUR')} → ${signedAmountText(tier.bonusMinor, 'EUR')}`,
                        )
                        .join(' · ')}
                </dd>
                <dt>Objectif</dt>
                <dd>
                  {statement.rules.collectiveGoal === null
                    ? 'aucun'
                    : `${amountText(statement.rules.collectiveGoal.targetMinor, 'EUR')} : ${statement.rules.collectiveGoal.tiers
                        .map(
                          (tier) =>
                            `${percentText(tier.reachedBps)} → ${signedAmountText(tier.bonusMinor, 'EUR')}`,
                        )
                        .join(' · ')} par chatteur`}
                </dd>
                {statement.rules.exchangeRates.map((rate) => (
                  <RateRule key={rate.currency} rate={rate} />
                ))}
                <dt>Minimum</dt>
                <dd>
                  {statement.rules.final
                    ? 'aucun : dernier relevé, tout est versé'
                    : amountText(statement.rules.minimumPayoutMinor, 'EUR')}
                </dd>
                <dt>Moteur</dt>
                <dd>
                  {statement.engineVersion} · empreinte {shortHash(statement.inputsHash)}
                </dd>
              </dl>
            </details>
            {adjusted === null ? null : (
              <p className="py-quiet nv-swap" role="status">
                {adjusted.text}
              </p>
            )}
          </div>
          <Foot
            statement={statement}
            own={own}
            owner={owner}
            canValidateNow={canValidateNow}
            who={who}
            onClose={onClose}
            onValidate={() => {
              onValidate(statement);
            }}
            onPay={() => {
              setMode('pay');
            }}
            onAdjust={
              own || statement.status === 'draft'
                ? null
                : () => {
                    setAdjusted(null);
                    setMode('adjust');
                  }
            }
          />
        </div>
      ) : mode === 'adjust' ? (
        <EntryForm
          kind="adjustment"
          members={names.members.filter((one) => one.id === statement.memberId)}
          corrects={statement}
          pagePeriod={null}
          busy={busy}
          onBusy={setBusy}
          onDone={(added) => {
            setAdjusted(added);
            setMode('read');
          }}
          onCancel={() => {
            setMode('read');
          }}
        />
      ) : (
        <PayForm
          statement={statement}
          memberName={member.name}
          mode={mode}
          busy={busy}
          onBusy={setBusy}
          onMode={setMode}
          onCancel={
            paying
              ? onClose
              : () => {
                  setMode('read');
                }
          }
        />
      )}
    </Dialog>
  );
}

function RateRule({ rate }: { rate: ExchangeRate }): JSX.Element {
  return (
    <>
      <dt>Taux du dollar</dt>
      <dd>
        {rateText(rate.rateMicros, rate.currency)}, BCE, {dayMonthText(rate.day)}
      </dd>
    </>
  );
}

/** What the statement says about its state, and the one gesture it allows the reader. */
function Foot({
  statement,
  own,
  owner,
  canValidateNow,
  who,
  onClose,
  onValidate,
  onPay,
  onAdjust,
}: {
  statement: CommissionStatement;
  own: boolean;
  owner: boolean;
  canValidateNow: boolean;
  who: (userId: string | null) => string;
  onClose: () => void;
  onValidate: () => void;
  onPay: () => void;
  /** « Ajuster », on a statement validated or paid that is not the reader's. */
  onAdjust: (() => void) | null;
}): JSX.Element {
  const zone = statement.window.timeZone;
  const validate = statement.status === 'draft' && statement.canValidate && canValidateNow;
  const pay = statement.status === 'validated' && owner && statement.payableMinor > 0;
  const said =
    statement.status === 'paid' && statement.payment !== null
      ? `Payé le ${longDay(statement.payment.paidOn)}${PAID_BY[statement.payment.method]}${
          statement.payment.reference === null ? '' : `, référence ${statement.payment.reference}`
        }${statement.paidBy === null ? '' : `, marqué par ${who(statement.paidBy)}`}.`
      : statement.status === 'validated' && statement.validatedAt !== null
        ? `Validé le ${momentAt(statement.validatedAt, zone)}${
            statement.validatedBy === null ? '' : ` par ${who(statement.validatedBy)}`
          }.${statement.payableMinor === 0 ? ' Rien à verser : le total part en report.' : owner ? '' : ' Le propriétaire le marque payé une fois le transfert fait.'}`
        : own
          ? 'Ton relevé : un autre membre de l’agence le valide.'
          : statement.status === 'draft'
            ? 'À valider : il suit chaque rapport validé jusqu’à sa validation.'
            : 'Validé, il ne change plus : une erreur se corrige par un ajustement.';
  return (
    <div className="py-dialog__foot">
      <p className="py-quiet">{said}</p>
      <button type="button" className="nv-btn nv-btn--plain" onClick={onClose}>
        Fermer
      </button>
      {onAdjust === null ? null : (
        <button type="button" className="nv-btn nv-btn--soft" onClick={onAdjust}>
          Ajuster
        </button>
      )}
      {validate ? (
        <button type="button" className="nv-btn nv-btn--neon" data-autofocus onClick={onValidate}>
          Valider ce relevé
        </button>
      ) : pay ? (
        <button type="button" className="nv-btn nv-btn--neon" data-autofocus onClick={onPay}>
          Marquer payé
        </button>
      ) : null}
    </div>
  );
}

const STEPS = ['Remplir', 'Relire'] as const;

/** How the owner pays: WorldRemit, the one method of `PAYMENT_METHODS`, so the form asks nothing about it. */
const PAY_BY: PaymentMethod = 'worldremit';

/**
 * « Marquer payé » (owner): the day (today by default, never after, never before the period's first day), the amount
 * sent (what is to pay, another one is refused), the method and the transfer's reference, optional and never an IBAN.
 * Then read again, then sent.
 */
function PayForm({
  statement,
  memberName,
  mode,
  busy,
  onBusy,
  onMode,
  onCancel,
}: {
  statement: CommissionStatement;
  memberName: string;
  mode: 'pay' | 'check';
  busy: boolean;
  onBusy: (busy: boolean) => void;
  onMode: (mode: Mode) => void;
  onCancel: () => void;
}): JSX.Element {
  const id = useId();
  const cfa = useCfaFrancs(statement.memberId);
  const refresh = useRefreshPayroll();
  const latest = useLatestPayPeriod();
  const today = dayOf(new Date(), statement.window.timeZone);
  const firstDay = statement.window.period;
  const [day, setDay] = useState(today);
  const [amount, setAmount] = useState(amountInput(statement.payableMinor));
  const [reference, setReference] = useState('');
  const [touched, setTouched] = useState(false);
  const [refusal, setRefusal] = useState<PayRefusal | null>(null);

  const sentMinor = parseAmount(amount);
  const dayValid = /^\d{4}-\d{2}-\d{2}$/u.test(day) && day >= firstDay && day <= today;
  const amountValid = sentMinor === statement.payableMinor;
  const referenceValid = !containsIban(reference);
  const ready = dayValid && amountValid && referenceValid;
  const step = mode === 'pay' ? 0 : 1;

  const send = async (): Promise<void> => {
    if (!ready || busy) return;
    onBusy(true);
    setRefusal(null);
    const trimmed = reference.trim();
    const outcome = await payStatement(statement.id, {
      revision: statement.revision,
      paidOn: day,
      method: PAY_BY,
      sentMinor: statement.payableMinor,
      ...(trimmed === '' ? {} : { reference: trimmed }),
    });
    // Read again before « Marquer payé » is free: a second click would pay what is already paid.
    await refresh();
    // Paid meanwhile, from another tab or by a second click that went first: it reads as paid, without a word.
    const paidMeanwhile =
      outcome.kind === 'refused' &&
      outcome.code === 'commission_statement_status_conflict' &&
      (await latest(statement.window.period))?.statements.find((one) => one.id === statement.id)?.status ===
        'paid';
    onBusy(false);
    if (outcome.kind === 'ok' || paidMeanwhile) {
      onMode('read');
      return;
    }
    setRefusal(outcome);
    onMode('pay');
  };

  return (
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
      {mode === 'check' ? (
        <>
          <p className="py-recap nv-enter">
            <b className="nv-num">{amountText(statement.payableMinor, 'EUR')}</b> versés à <b>{memberName}</b>{' '}
            le {longDay(day)}
            {PAID_BY[PAY_BY]}
            {reference.trim() === '' ? '' : `, référence ${reference.trim()}`}, pour la quinzaine{' '}
            {periodLine(statement.window.period)}.
          </p>
          {cfa ? (
            <p className="tm-hint nv-num">
              {fcfaText(statement.payableMinor)} (1 € = 655,957 FCFA, parité fixe). Indicatif : le montant
              envoyé reste en euros.
            </p>
          ) : null}
          <p className="tm-hint">Payé, le relevé ne change plus. Une erreur se corrige par un ajustement.</p>
          <div className="tm-dialog__foot">
            <button
              type="button"
              className="nv-btn nv-btn--plain"
              disabled={busy}
              onClick={() => {
                onMode('pay');
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
              {busy ? 'Enregistrement…' : 'Marquer payé'}
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
            if (ready) onMode('check');
          }}
        >
          <div className="tm-pair">
            <div className="nv-field tm-field" data-invalid={touched && !dayValid ? 'true' : undefined}>
              <label className="nv-field__label" htmlFor={`${id}-day`}>
                Payé le
              </label>
              <input
                id={`${id}-day`}
                type="date"
                className="nv-field__control nv-glass nv-num"
                value={day}
                min={firstDay}
                max={today}
                data-autofocus
                aria-invalid={touched && !dayValid}
                onChange={(event) => {
                  setDay(event.target.value);
                }}
              />
              {touched && !dayValid ? (
                <p className="tm-hint tm-hint--error">Un jour du {longDay(firstDay)} à aujourd’hui.</p>
              ) : null}
            </div>
            <div className="nv-field tm-field" data-invalid={touched && !amountValid ? 'true' : undefined}>
              <label className="nv-field__label" htmlFor={`${id}-amount`}>
                Montant envoyé, en euros
              </label>
              <div className="py-money">
                <input
                  id={`${id}-amount`}
                  className="nv-field__control nv-glass nv-num"
                  inputMode="decimal"
                  autoComplete="off"
                  value={amount}
                  aria-invalid={touched && !amountValid}
                  onChange={(event) => {
                    setAmount(event.target.value);
                  }}
                />
                <span className="py-money__sign" aria-hidden="true">
                  €
                </span>
              </div>
              <p className={touched && !amountValid ? 'tm-hint tm-hint--error' : 'tm-hint'}>
                Celui à verser : {amountText(statement.payableMinor, 'EUR')}. Un autre montant est refusé.
              </p>
            </div>
          </div>
          <div className="nv-field tm-field" data-invalid={touched && !referenceValid ? 'true' : undefined}>
            <label className="nv-field__label" htmlFor={`${id}-reference`}>
              Référence WorldRemit, facultative
            </label>
            <input
              id={`${id}-reference`}
              className="nv-field__control nv-glass nv-num"
              autoComplete="off"
              maxLength={PAYMENT_REFERENCE_MAX}
              value={reference}
              aria-invalid={touched && !referenceValid}
              onChange={(event) => {
                setReference(event.target.value);
              }}
            />
            <p className={touched && !referenceValid ? 'tm-hint tm-hint--error' : 'tm-hint'}>
              {touched && !referenceValid
                ? 'Ceci contient un IBAN : garde seulement la référence du transfert.'
                : 'Celle que WorldRemit donne au transfert. Jamais un IBAN, un numéro de compte ni de téléphone.'}
            </p>
          </div>
          {refusal === null ? null : (
            <p className="tm-warn sc-refusal nv-swap" role="alert">
              {payRefusalText(refusal, { memberName: () => memberName, statement })}
            </p>
          )}
          <div className="tm-dialog__foot">
            <button type="button" className="nv-btn nv-btn--plain" onClick={onCancel}>
              Annuler
            </button>
            <button type="submit" className="nv-btn nv-btn--neon">
              Vérifier
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
