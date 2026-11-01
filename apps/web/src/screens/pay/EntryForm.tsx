import {
  BonusIdSchema,
  newId,
  PayAdjustmentIdSchema,
  PenaltyIdSchema,
  type BonusId,
  type CommissionStatement,
  type CommissionStatementId,
  type PayAdjustmentId,
  type PayPeriod,
  type PenaltyId,
  type TeamMember,
  type TeamMemberId,
} from '@nirvana/contracts';
import { useId, useState, type JSX } from 'react';

import { useCurrentPeriod, useFirstOpenPeriod } from './data';

import {
  addAdjustment,
  addBonus,
  addPenalty,
  useRefreshPayroll,
  type PayOutcome,
  type PayRefusal,
} from '@/payroll/api';
import {
  ENTRY_KIND_LABELS,
  payRefusalText,
  periodsBetween,
  signedPercentText,
  type EntryKind,
} from '@/payroll/model';
import {
  amountText,
  parseAmount,
  parsePercent,
  percentText,
  periodLine,
  periodTitle,
  signedAmountText,
} from '@/reports/model';

const NBSP = '\u00a0';

/** The longest reason pay keeps (`PayReasonSchema`). */
const REASON_MAX = 500;

const KINDS: readonly EntryKind[] = ['bonus', 'fixed', 'percent', 'adjustment'];
const STEPS = ['Remplir', 'Relire'] as const;

/** What the neon of the second step says. */
const ADD_LABELS: Readonly<Record<EntryKind, string>> = {
  bonus: 'Ajouter la prime',
  fixed: 'Ajouter le malus',
  percent: 'Ajouter le malus',
  adjustment: 'Ajouter l’ajustement',
};

/** « 1er – 15 novembre »: a period on a chip, its year said by the screen around it. */
const periodChip = (period: PayPeriod): string => periodTitle(period).replace(/\s\d{4}$/u, '');

/** An amount as typed, for its kind: euros for a bonus, a fixed penalty or an adjustment, basis points for a percent. */
type Typed =
  | { readonly kind: 'bonus' | 'fixed'; readonly minor: number }
  | { readonly kind: 'percent'; readonly bps: number }
  | { readonly kind: 'adjustment'; readonly minor: number };

/** The typed amount, or `null` when it is not one: never 0, never above the slip guard, an adjustment signed. */
function typedOf(kind: EntryKind, text: string, taking: boolean): Typed | null {
  if (kind === 'percent') {
    const bps = parsePercent(text);
    return bps === null || bps === 0 ? null : { kind, bps };
  }
  const minor = parseAmount(text);
  if (minor === null || minor === 0) return null;
  return kind === 'adjustment' ? { kind, minor: taking ? -minor : minor } : { kind, minor };
}

/** « 30,00 € », « 10 % », « −12,40 € »: what the recap says. */
const amountShown = (typed: Typed): string =>
  typed.kind === 'percent'
    ? percentText(typed.bps)
    : typed.kind === 'adjustment'
      ? signedAmountText(typed.minor, 'EUR')
      : amountText(typed.minor, 'EUR');

/** The write of each kind; the period it landed on when the server took it. */
async function sendEntry(
  typed: Typed,
  entry: {
    readonly ids: {
      readonly bonus: BonusId;
      readonly penalty: PenaltyId;
      readonly adjustment: PayAdjustmentId;
    };
    readonly memberId: TeamMemberId;
    readonly period: PayPeriod;
    readonly reason: string;
    readonly corrects: CommissionStatementId | null;
  },
): Promise<PayOutcome<PayPeriod>> {
  const { ids, memberId, period, reason } = entry;
  switch (typed.kind) {
    case 'bonus':
      return landed(
        await addBonus({ id: ids.bonus, memberId, period, amountMinor: typed.minor, reason }),
        (bonus) => bonus.period,
      );
    case 'fixed':
    case 'percent':
      return landed(
        await addPenalty({
          id: ids.penalty,
          memberId,
          fromPeriod: period,
          toPeriod: period,
          amount:
            typed.kind === 'percent'
              ? { kind: 'percent', bps: typed.bps }
              : { kind: 'fixed', amountMinor: typed.minor },
          reason,
        }),
        (penalty) => penalty.fromPeriod,
      );
    case 'adjustment':
      return landed(
        await addAdjustment({
          id: ids.adjustment,
          memberId,
          amountMinor: typed.minor,
          reason,
          correctsStatementId: entry.corrects,
        }),
        (adjustment) => adjustment.period,
      );
  }
}

const landed = <T,>(outcome: PayOutcome<T>, periodOf: (value: T) => PayPeriod): PayOutcome<PayPeriod> =>
  outcome.kind === 'ok' ? { kind: 'ok', value: periodOf(outcome.value) } : outcome;

/** What was added, for the screen that opened the form: the period it landed on, and a sentence. */
export interface EntryAdded {
  readonly period: PayPeriod;
  readonly text: string;
}

/**
 * « Ajouter » in Primes et malus, and « Ajuster » on a validated statement (EQ-05): a bonus, a fixed penalty, a penalty
 * in percent or an adjustment, for a member who is never the reader, in two steps (fill, read again). A bonus or a
 * penalty goes on a period still open for the member; an adjustment on the one the server chooses, their next to
 * validate, which the form says before sending. The reason is always asked: the member reads it with their statement.
 */
export function EntryForm({
  kind,
  onKind,
  members,
  corrects,
  pagePeriod,
  busy,
  onBusy,
  onDone,
  onCancel,
}: {
  kind: EntryKind;
  /** Absent when the kind is fixed (« Ajuster »). */
  onKind?: (kind: EntryKind) => void;
  /** Who it may be for: active members, never the reader. */
  members: readonly TeamMember[];
  /** « Ajuster »: the statement corrected, its member fixed. */
  corrects?: CommissionStatement;
  /** The period on screen, chosen first when it is open for the member. */
  pagePeriod: PayPeriod | null;
  busy: boolean;
  onBusy: (busy: boolean) => void;
  onDone: (added: EntryAdded) => void;
  onCancel: () => void;
}): JSX.Element {
  const id = useId();
  const refresh = useRefreshPayroll();
  const current = useCurrentPeriod();
  // One id per kind for the life of the form: sent again after a server that did not answer, it records nothing twice.
  const [ids] = useState(() => ({
    bonus: newId(BonusIdSchema),
    penalty: newId(PenaltyIdSchema),
    adjustment: newId(PayAdjustmentIdSchema),
  }));
  const [memberId, setMemberId] = useState<string>(corrects?.memberId ?? '');
  const [picked, setPicked] = useState<PayPeriod | null>(null);
  const [amount, setAmount] = useState('');
  const [taking, setTaking] = useState(false);
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const [checking, setChecking] = useState(false);
  const [refusal, setRefusal] = useState<PayRefusal | null>(null);

  const member = members.find((one) => one.id === memberId) ?? null;
  const name = member?.displayName ?? 'le membre';
  const firstOpen = useFirstOpenPeriod(member, corrects?.window.period ?? null);
  const choices =
    firstOpen === undefined || current === null
      ? []
      : periodsBetween(firstOpen, current > firstOpen ? current : firstOpen);
  const period =
    kind === 'adjustment'
      ? (firstOpen ?? null)
      : picked !== null && choices.includes(picked)
        ? picked
        : pagePeriod !== null && choices.includes(pagePeriod)
          ? pagePeriod
          : (choices.at(-1) ?? null);

  const percent = kind === 'percent';
  const typed = typedOf(kind, amount, taking);
  const trimmed = reason.trim();
  const reasonValid = trimmed.length > 0;
  const ready = member !== null && period !== null && typed !== null && reasonValid;
  const shown = typed === null ? '' : amountShown(typed);

  const send = async (): Promise<void> => {
    if (member === null || period === null || typed === null || !reasonValid || busy) return;
    onBusy(true);
    setRefusal(null);
    const outcome = await sendEntry(typed, {
      ids,
      memberId: member.id,
      period,
      reason: trimmed,
      corrects: corrects?.id ?? null,
    });
    // Read again before the form is free: a second send would go on what is already written.
    await refresh();
    onBusy(false);
    if (outcome.kind === 'ok') {
      onDone({
        period: outcome.value,
        text: `${ENTRY_KIND_LABELS[kind]} de ${shown} pour ${name} ajouté${kind === 'bonus' ? 'e' : ''} sur la quinzaine ${periodLine(outcome.value)}.`,
      });
      return;
    }
    setRefusal(outcome);
    setChecking(false);
  };

  return (
    <div className="tm-dialog__body">
      <ol className="tm-steps" aria-label="Étapes">
        {STEPS.map((title, index) => {
          const step = checking ? 1 : 0;
          return (
            <li
              key={title}
              data-state={index < step ? 'done' : index === step ? 'now' : 'later'}
              aria-current={index === step ? 'step' : undefined}
            >
              <span className="tm-steps__num">{String(index + 1)}</span>
              {title}
            </li>
          );
        })}
      </ol>
      {checking && member !== null && period !== null ? (
        <>
          <p className="py-recap nv-enter">
            {kind === 'adjustment' ? (
              <>
                Ajustement de <b className="nv-num">{shown}</b> pour <b>{name}</b>, sur sa quinzaine{' '}
                {periodLine(period)}, la prochaine à valider
              </>
            ) : (
              <>
                {kind === 'bonus' ? 'Prime' : 'Malus'} de <b className="nv-num">{shown}</b>
                {percent ? ' de son net' : ''} pour <b>{name}</b>, sur la quinzaine {periodLine(period)}
              </>
            )}
            {' : « '}
            {trimmed}
            {' »'}
          </p>
          <p className="tm-hint">
            {kind === 'adjustment'
              ? `${corrects === undefined ? '' : `Il corrige son relevé ${periodLine(corrects.window.period)}, qui ne change plus. `}Un ajustement ne s’annule pas : une erreur se corrige par un autre.`
              : kind === 'bonus'
                ? 'Elle s’annule tant que son relevé de la quinzaine n’est pas validé.'
                : `Plafonné à sa part plus ses primes : son relevé reste au moins à 0${NBSP}€.`}{' '}
            {name} le lira avec son relevé.
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
              {busy ? 'Enregistrement…' : ADD_LABELS[kind]}
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
            if (ready) setChecking(true);
          }}
        >
          {onKind === undefined ? null : (
            <div className="nv-field tm-field">
              <span className="nv-field__label" id={`${id}-kind`}>
                Quoi
              </span>
              <div className="tm-choices" role="radiogroup" aria-labelledby={`${id}-kind`}>
                {KINDS.map((one) => (
                  <button
                    key={one}
                    type="button"
                    role="radio"
                    className="nv-chip"
                    aria-checked={kind === one}
                    onClick={() => {
                      onKind(one);
                    }}
                  >
                    {ENTRY_KIND_LABELS[one]}
                  </button>
                ))}
              </div>
            </div>
          )}
          {corrects === undefined ? (
            <div className="nv-field tm-field" data-invalid={touched && member === null ? 'true' : undefined}>
              <label className="nv-field__label" htmlFor={`${id}-member`}>
                Pour
              </label>
              <select
                id={`${id}-member`}
                className="nv-field__control nv-glass tm-select"
                value={memberId}
                disabled={members.length === 0}
                aria-invalid={touched && member === null}
                onChange={(event) => {
                  setMemberId(event.target.value);
                }}
              >
                <option value="" disabled>
                  Choisir un membre
                </option>
                {members.map((one) => (
                  <option key={one.id} value={one.id}>
                    {one.displayName}
                  </option>
                ))}
              </select>
              <p className={touched && member === null ? 'tm-hint tm-hint--error' : 'tm-hint'}>
                {members.length === 0
                  ? 'Aucun autre membre actif dans l’équipe.'
                  : 'Personne ne saisit pour soi : ton nom n’est pas dans la liste.'}
              </p>
            </div>
          ) : null}
          {member === null ? null : kind === 'adjustment' ? (
            <p className="tm-hint">
              {firstOpen === undefined
                ? 'Recherche de la quinzaine…'
                : `Il va sur la quinzaine ${periodLine(firstOpen)} : la prochaine de ${name} à valider.`}
            </p>
          ) : (
            <div className="nv-field tm-field">
              <span className="nv-field__label" id={`${id}-period`}>
                Quinzaine
              </span>
              {choices.length === 0 ? (
                <p className="tm-hint">Recherche des quinzaines ouvertes…</p>
              ) : (
                <div className="tm-choices" role="radiogroup" aria-labelledby={`${id}-period`}>
                  {choices.map((one) => (
                    <button
                      key={one}
                      type="button"
                      role="radio"
                      className="nv-chip nv-num"
                      aria-checked={period === one}
                      onClick={() => {
                        setPicked(one);
                      }}
                    >
                      {periodChip(one)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {kind === 'adjustment' ? (
            <div className="nv-field tm-field">
              <span className="nv-field__label" id={`${id}-way`}>
                Sur son total
              </span>
              <div className="tm-choices" role="radiogroup" aria-labelledby={`${id}-way`}>
                {[false, true].map((one) => (
                  <button
                    key={String(one)}
                    type="button"
                    role="radio"
                    className="nv-chip"
                    aria-checked={taking === one}
                    onClick={() => {
                      setTaking(one);
                    }}
                  >
                    {one ? 'Retirer' : 'Ajouter'}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <div className="nv-field rp-amount" data-invalid={touched && typed === null ? 'true' : undefined}>
            <label className="nv-field__label" htmlFor={`${id}-amount`}>
              {percent ? 'Pourcentage de son net' : 'Montant'}
            </label>
            <div className="rp-amount__box">
              <input
                id={`${id}-amount`}
                className="nv-field__control nv-glass rp-amount__input nv-num"
                inputMode="decimal"
                autoComplete="off"
                placeholder={percent ? '0' : '0,00'}
                value={amount}
                aria-invalid={touched && typed === null}
                aria-describedby={`${id}-amount-hint`}
                onChange={(event) => {
                  setAmount(event.target.value);
                }}
              />
              <span className="rp-amount__sign" aria-hidden="true">
                {percent ? '%' : '€'}
              </span>
            </div>
            <p
              id={`${id}-amount-hint`}
              className={touched && typed === null ? 'tm-hint tm-hint--error' : 'tm-hint'}
            >
              {touched && typed === null
                ? percent
                  ? 'Un pourcentage entre 0 et 100, deux décimales au plus.'
                  : 'Un montant en euros, jusqu’à 50 000 €, deux décimales au plus.'
                : kind === 'bonus'
                  ? 'Ajoutée à son total de la quinzaine.'
                  : kind === 'adjustment'
                    ? `${taking ? 'Retiré de' : 'Ajouté à'} son total, ${shown === '' ? 'en euros' : shown}.`
                    : `Plafonné à sa part plus ses primes${typed?.kind === 'percent' ? ` : ${signedPercentText(-typed.bps)} de son net` : ''}.`}
            </p>
          </div>
          <div className="nv-field tm-field" data-invalid={touched && !reasonValid ? 'true' : undefined}>
            <label className="nv-field__label" htmlFor={`${id}-reason`}>
              Motif
            </label>
            <textarea
              id={`${id}-reason`}
              className="nv-field__control nv-glass sc-note"
              rows={2}
              maxLength={REASON_MAX}
              value={reason}
              placeholder={
                kind === 'bonus'
                  ? 'A formé un nouveau aux relances, deux soirs.'
                  : kind === 'adjustment'
                    ? 'Rapport du 28 oct. compté deux fois.'
                    : 'Shift commencé avec 40 minutes de retard.'
              }
              aria-invalid={touched && !reasonValid}
              onChange={(event) => {
                setReason(event.target.value);
              }}
            />
            <p className={touched && !reasonValid ? 'tm-hint tm-hint--error' : 'tm-hint'}>
              {touched && !reasonValid
                ? 'Le motif est obligatoire.'
                : 'Lu par le membre avec son relevé. Jamais le message ni le nom d’un fan.'}
            </p>
          </div>
          {refusal === null ? null : (
            <p className="tm-warn sc-refusal nv-swap" role="alert">
              {payRefusalText(refusal, { memberName: () => name })}
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
