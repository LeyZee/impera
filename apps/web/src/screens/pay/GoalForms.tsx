import {
  collectiveGoalLastDay,
  BonusTierSetIdSchema,
  CollectiveGoalIdSchema,
  newId,
  type BonusTier,
  type BonusTierSet,
  type CollectiveGoal,
  type CollectiveTier,
  type PayPeriod,
} from '@nirvana/contracts';
import { useId, useState, type JSX, type ReactNode } from 'react';

import { addBonusTiers, addCollectiveGoal, useRefreshPayroll, type PayRefusal } from '@/payroll/api';
import { bonusTiersInOrder, goalTiersInOrder, parseTarget, payRefusalText } from '@/payroll/model';
import {
  amountInput,
  amountText,
  parseAmount,
  parsePercent,
  percentText,
  periodLine,
  periodTitle,
  signedAmountText,
} from '@/reports/model';
import { longDay } from '@/scheduling/time';
import { Dialog } from '@/screens/team/Dialog';

/** The most tiers a goal and a set keep (`CollectiveTiersSchema`, `BonusTiersSchema`). */
const GOAL_TIERS_MAX = 10;
const BONUS_TIERS_MAX = 20;
/** A collective tier up to 1 000 % of the target (`CollectiveTierSchema`). */
const REACHED_MAX_BPS = 100_000;
const LABEL_MAX = 60;

const STEPS = ['Remplir', 'Relire'] as const;

/** « 80 », « 112,5 »: a percent as its field shows it back. */
const percentInput = (bps: number): string =>
  (bps / 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 });

/** « 1er – 15 novembre »: a period on a chip. */
const periodChip = (period: PayPeriod): string => periodTitle(period).replace(/\s\d{4}$/u, '');

/** Two steps, as everywhere pay writes: the steps, then the form or its recap. */
function Steps({ step }: { step: 0 | 1 }): JSX.Element {
  return (
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
  );
}

/** The second step's foot: back to the form, or send. */
function CheckFoot({
  busy,
  label,
  onBack,
  onSend,
}: {
  busy: boolean;
  label: string;
  onBack: () => void;
  onSend: () => void;
}): JSX.Element {
  return (
    <div className="tm-dialog__foot">
      <button type="button" className="nv-btn nv-btn--plain" disabled={busy} onClick={onBack}>
        Modifier
      </button>
      <button
        type="button"
        className="nv-btn nv-btn--neon"
        data-autofocus
        disabled={busy}
        aria-busy={busy}
        onClick={onSend}
      >
        {busy ? 'Enregistrement…' : label}
      </button>
    </div>
  );
}

function Refusal({ refusal }: { refusal: PayRefusal | null }): JSX.Element | null {
  if (refusal === null) return null;
  return (
    <p className="tm-warn sc-refusal nv-swap" role="alert">
      {payRefusalText(refusal, { memberName: () => 'Un membre' })}
    </p>
  );
}

/** A row of tiers being typed: its fields as typed, and a key that stays while rows come and go. */
interface GoalRow {
  readonly key: number;
  readonly reached: string;
  readonly bonus: string;
}

/** A goal's rows read: each tier, or `null` for a row that is not one. */
function goalTiersOf(rows: readonly GoalRow[]): (CollectiveTier | null)[] {
  return rows.map((row) => {
    const reachedBps = parsePercent(row.reached, REACHED_MAX_BPS);
    const bonusMinor = parseAmount(row.bonus);
    return reachedBps === null || reachedBps === 0 || bonusMinor === null || bonusMinor === 0
      ? null
      : { reachedBps, bonusMinor };
  });
}

/**
 * The period's collective goal (owner, EQ-05): the team's net to reach, and for each share of it the bonus each
 * chatter gets. Added only: a new goal replaces the period's until its first validation. With no tier, no goal.
 */
export function GoalDialog({
  period,
  started,
  goal,
  onClose,
}: {
  period: PayPeriod;
  /** PAIE-22: the period has begun (its first three days): the goal may still change, with a warning. */
  started: boolean;
  /** The goal in force, to change or withdraw. */
  goal: CollectiveGoal | null;
  onClose: () => void;
}): JSX.Element {
  const id = useId();
  const refresh = useRefreshPayroll();
  const [goalId] = useState(() => newId(CollectiveGoalIdSchema));
  const [target, setTarget] = useState(goal === null ? '' : amountInput(goal.targetMinor));
  const [rows, setRows] = useState<readonly GoalRow[]>(() =>
    goal === null
      ? [{ key: 0, reached: '', bonus: '' }]
      : goalTiersInOrder(goal.tiers).map((tier, index) => ({
          key: index,
          reached: percentInput(tier.reachedBps),
          bonus: amountInput(tier.bonusMinor),
        })),
  );
  const [touched, setTouched] = useState(false);
  const [step, setStep] = useState<'fill' | 'check' | 'withdraw'>('fill');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<PayRefusal | null>(null);

  const targetMinor = parseTarget(target);
  const tiers = goalTiersOf(rows);
  const typed = tiers.filter((tier) => tier !== null);
  const same = new Set(typed.map((tier) => tier.reachedBps)).size !== typed.length;
  const ready =
    targetMinor !== null && targetMinor > 0 && typed.length === rows.length && rows.length > 0 && !same;

  const send = async (withdraw: boolean): Promise<void> => {
    const targetSent = withdraw ? goal?.targetMinor : targetMinor;
    if (busy || targetSent === undefined || targetSent === null) return;
    setBusy(true);
    setRefusal(null);
    const outcome = await addCollectiveGoal({
      id: goalId,
      period,
      targetMinor: targetSent,
      tiers: withdraw ? [] : goalTiersInOrder(typed),
    });
    await refresh();
    setBusy(false);
    if (outcome.kind === 'ok') {
      onClose();
      return;
    }
    setRefusal(outcome);
    setStep('fill');
  };

  return (
    <Dialog
      className="py-dialog"
      title={goal === null ? 'Poser l’objectif collectif' : 'Changer l’objectif collectif'}
      lead={`Quinzaine ${periodLine(period)}`}
      busy={busy}
      onClose={onClose}
    >
      <div className="tm-dialog__body">
        <Steps step={step === 'fill' ? 0 : 1} />
        {started ? (
          <p className="tm-warn nv-swap">
            {`La quinzaine a commencé : l’équipe y travaille déjà. Son objectif change encore jusqu’au ${longDay(collectiveGoalLastDay(period))}, puis plus du tout ; préviens l’équipe de ce qui change.`}
          </p>
        ) : null}
        {step === 'withdraw' && goal !== null ? (
          <>
            <p className="py-recap nv-enter">
              Plus d’objectif collectif sur la quinzaine {periodLine(period)} : aucune prime d’équipe.
            </p>
            <p className="tm-hint">Les relevés de la quinzaine pas encore validés sont recalculés.</p>
            <CheckFoot
              busy={busy}
              label="Retirer l’objectif"
              onBack={() => {
                setStep('fill');
              }}
              onSend={() => {
                void send(true);
              }}
            />
          </>
        ) : step === 'check' && targetMinor !== null ? (
          <>
            <p className="py-recap nv-enter">
              <b className="nv-num">{amountText(targetMinor, 'EUR')}</b> de net pour l’équipe sur la quinzaine{' '}
              {periodLine(period)} :{' '}
              {goalTiersInOrder(typed).map((tier, index) => (
                <span key={tier.reachedBps}>
                  {index === 0 ? '' : ' ; '}à <b className="nv-num">{percentText(tier.reachedBps)}</b>,{' '}
                  <b className="nv-num">{signedAmountText(tier.bonusMinor, 'EUR')}</b>
                  {index === 0 ? ' par chatteur' : ''}
                </span>
              ))}
              .
            </p>
            <p className="tm-hint">
              La prime du plus haut palier atteint va à chaque chatteur, ventes ou pas, jamais à un manager.
              L’objectif d’une quinzaine se pose au plus tard son 3e jour.
            </p>
            <CheckFoot
              busy={busy}
              label={goal === null ? 'Poser l’objectif' : 'Changer l’objectif'}
              onBack={() => {
                setStep('fill');
              }}
              onSend={() => {
                void send(false);
              }}
            />
          </>
        ) : (
          <form
            className="tm-dialog__body"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              setTouched(true);
              if (ready) setStep('check');
            }}
          >
            <div
              className="nv-field rp-amount"
              data-invalid={touched && targetMinor === null ? 'true' : undefined}
            >
              <label className="nv-field__label" htmlFor={`${id}-target`}>
                Net de l’équipe à atteindre
              </label>
              <div className="rp-amount__box">
                <input
                  id={`${id}-target`}
                  className="nv-field__control nv-glass rp-amount__input nv-num"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0,00"
                  value={target}
                  data-autofocus
                  aria-invalid={touched && targetMinor === null}
                  onChange={(event) => {
                    setTarget(event.target.value);
                  }}
                />
                <span className="rp-amount__sign" aria-hidden="true">
                  €
                </span>
              </div>
              <p className={touched && targetMinor === null ? 'tm-hint tm-hint--error' : 'tm-hint'}>
                Ventes des managers comprises, comme les relevés le comptent.
              </p>
            </div>
            <TierRows
              legend="Paliers"
              heads={['Atteint à', 'Prime par chatteur']}
              rows={rows.map((row, index) => ({
                key: row.key,
                invalid: touched && tiers[index] === null,
                fields: [
                  {
                    label: 'Atteint à',
                    value: row.reached,
                    suffix: '%',
                    onChange: (value: string) => {
                      setRows(rows.map((one) => (one.key === row.key ? { ...one, reached: value } : one)));
                    },
                  },
                  {
                    label: 'Prime par chatteur',
                    value: row.bonus,
                    suffix: '€',
                    onChange: (value: string) => {
                      setRows(rows.map((one) => (one.key === row.key ? { ...one, bonus: value } : one)));
                    },
                  },
                ],
              }))}
              canAdd={rows.length < GOAL_TIERS_MAX}
              onAdd={() => {
                setRows([
                  ...rows,
                  { key: Math.max(0, ...rows.map((one) => one.key)) + 1, reached: '', bonus: '' },
                ]);
              }}
              onRemove={(key) => {
                setRows(rows.filter((one) => one.key !== key));
              }}
              hint={
                touched && rows.length === 0
                  ? { error: true, text: 'Au moins un palier : sans palier, il n’y a pas d’objectif.' }
                  : touched && typed.length !== rows.length
                    ? {
                        error: true,
                        text: 'Chaque palier : un pourcentage de la cible, et une prime en euros.',
                      }
                    : touched && same
                      ? { error: true, text: 'Deux paliers au même pourcentage.' }
                      : {
                          error: false,
                          text: 'Au-delà de 100 % aussi : 120 % de la cible, une prime plus haute.',
                        }
              }
            />
            <Refusal refusal={refusal} />
            <div className="tm-dialog__foot">
              {goal === null ? null : (
                <button
                  type="button"
                  className="nv-btn nv-btn--plain py-foot__aside"
                  onClick={() => {
                    setStep('withdraw');
                  }}
                >
                  Retirer l’objectif
                </button>
              )}
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

interface BonusRow {
  readonly key: number;
  readonly label: string;
  readonly threshold: string;
  readonly bonus: string;
}

function bonusTiersOf(rows: readonly BonusRow[]): (BonusTier | null)[] {
  return rows.map((row) => {
    const label = row.label.trim();
    const thresholdMinor = parseTarget(row.threshold);
    const bonusMinor = parseAmount(row.bonus);
    return label === '' ||
      thresholdMinor === null ||
      thresholdMinor === 0 ||
      bonusMinor === null ||
      bonusMinor === 0
      ? null
      : { label, thresholdMinor, bonusMinor };
  });
}

/**
 * New individual tiers from a period on (owner, EQ-05): for each threshold of a member's net, a bonus; the highest
 * reached counts, managers aside. Added only: they replace the set in force from their period, which must not have
 * begun (PAIE-22). With no tier, none from then on.
 */
export function TiersDialog({
  periods,
  first,
  set,
  onClose,
}: {
  /** The periods the set may start with: not begun yet (PAIE-22), in order. */
  periods: readonly PayPeriod[];
  /** The one chosen at first. */
  first: PayPeriod;
  /** The set in force, its tiers to start from. */
  set: BonusTierSet | null;
  onClose: () => void;
}): JSX.Element {
  const id = useId();
  const refresh = useRefreshPayroll();
  const [setId] = useState(() => newId(BonusTierSetIdSchema));
  const [from, setFrom] = useState(first);
  const [rows, setRows] = useState<readonly BonusRow[]>(() =>
    set === null || set.tiers.length === 0
      ? [{ key: 0, label: '', threshold: '', bonus: '' }]
      : bonusTiersInOrder(set.tiers).map((tier, index) => ({
          key: index,
          label: tier.label,
          threshold: amountInput(tier.thresholdMinor),
          bonus: amountInput(tier.bonusMinor),
        })),
  );
  const [touched, setTouched] = useState(false);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<PayRefusal | null>(null);

  const tiers = bonusTiersOf(rows);
  const typed = tiers.filter((tier) => tier !== null);
  const same = new Set(typed.map((tier) => tier.thresholdMinor)).size !== typed.length;
  const ready = typed.length === rows.length && !same;

  const send = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setRefusal(null);
    const outcome = await addBonusTiers({ id: setId, fromPeriod: from, tiers: bonusTiersInOrder(typed) });
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
    <Dialog
      className="py-dialog"
      title="Nouveaux paliers individuels"
      lead="Chaque membre touche la prime du plus haut palier atteint, sauf les managers."
      busy={busy}
      onClose={onClose}
    >
      <div className="tm-dialog__body">
        <Steps step={checking ? 1 : 0} />
        {checking ? (
          <>
            <p className="py-recap nv-enter">
              À partir de la quinzaine {periodLine(from)}
              {typed.length === 0 ? (
                ', plus aucun palier individuel.'
              ) : (
                <>
                  {' : '}
                  {bonusTiersInOrder(typed).map((tier, index) => (
                    <span key={tier.thresholdMinor}>
                      {index === 0 ? '' : ' ; '}
                      <b>{tier.label}</b> à <b className="nv-num">{amountText(tier.thresholdMinor, 'EUR')}</b>{' '}
                      de net, <b className="nv-num">{signedAmountText(tier.bonusMinor, 'EUR')}</b>
                    </span>
                  ))}
                  .
                </>
              )}
            </p>
            <p className="tm-hint">
              Les paliers partent d’une quinzaine qui n’a pas commencé : celles déjà commencées gardent les
              leurs, une règle de paie ne change pas en cours de route.
            </p>
            <CheckFoot
              busy={busy}
              label="Enregistrer les paliers"
              onBack={() => {
                setChecking(false);
              }}
              onSend={() => {
                void send();
              }}
            />
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
            <TierRows
              legend="Paliers"
              heads={['Nom', 'Net du membre', 'Prime']}
              rows={rows.map((row, index) => ({
                key: row.key,
                invalid: touched && tiers[index] === null,
                fields: [
                  {
                    label: 'Nom',
                    value: row.label,
                    maxLength: LABEL_MAX,
                    onChange: (value: string) => {
                      setRows(rows.map((one) => (one.key === row.key ? { ...one, label: value } : one)));
                    },
                  },
                  {
                    label: 'Net du membre',
                    value: row.threshold,
                    suffix: '€',
                    onChange: (value: string) => {
                      setRows(rows.map((one) => (one.key === row.key ? { ...one, threshold: value } : one)));
                    },
                  },
                  {
                    label: 'Prime',
                    value: row.bonus,
                    suffix: '€',
                    onChange: (value: string) => {
                      setRows(rows.map((one) => (one.key === row.key ? { ...one, bonus: value } : one)));
                    },
                  },
                ],
              }))}
              canAdd={rows.length < BONUS_TIERS_MAX}
              onAdd={() => {
                setRows([
                  ...rows,
                  {
                    key: Math.max(0, ...rows.map((one) => one.key)) + 1,
                    label: '',
                    threshold: '',
                    bonus: '',
                  },
                ]);
              }}
              onRemove={(key) => {
                setRows(rows.filter((one) => one.key !== key));
              }}
              hint={
                touched && typed.length !== rows.length
                  ? { error: true, text: 'Chaque palier : un nom, un net en euros, une prime en euros.' }
                  : touched && same
                    ? { error: true, text: 'Deux paliers au même net.' }
                    : {
                        error: false,
                        text: 'Le seuil est compris : à 500,00 € de net pile, le palier est atteint. Sans palier, plus aucun.',
                      }
              }
            />
            <Refusal refusal={refusal} />
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

interface TierField {
  readonly label: string;
  readonly value: string;
  readonly suffix?: string;
  readonly maxLength?: number;
  readonly onChange: (value: string) => void;
}

/** Rows of tiers to type, each with its fields and a remove; one more with « Ajouter un palier ». */
function TierRows({
  legend,
  heads,
  rows,
  canAdd,
  onAdd,
  onRemove,
  hint,
}: {
  legend: string;
  heads: readonly string[];
  rows: readonly { key: number; invalid: boolean; fields: readonly TierField[] }[];
  canAdd: boolean;
  onAdd: () => void;
  onRemove: (key: number) => void;
  hint: { error: boolean; text: ReactNode };
}): JSX.Element {
  const wide = heads.length > 2;
  return (
    <fieldset className="py-tierform">
      <legend className="nv-field__label">{legend}</legend>
      {rows.length === 0 ? null : (
        <div
          className={wide ? 'py-tierrow py-tierrow--wide py-tierrow--head' : 'py-tierrow py-tierrow--head'}
          aria-hidden="true"
        >
          {heads.map((head) => (
            <span key={head}>{head}</span>
          ))}
        </div>
      )}
      <ul className="py-tierrows">
        {rows.map((row, index) => (
          <li
            key={row.key}
            className={wide ? 'py-tierrow py-tierrow--wide' : 'py-tierrow'}
            data-invalid={row.invalid ? 'true' : undefined}
          >
            {row.fields.map((field) => (
              <span key={field.label} className="py-tierrow__field">
                <input
                  className="nv-field__control nv-glass nv-num"
                  inputMode={field.suffix === undefined ? 'text' : 'decimal'}
                  autoComplete="off"
                  aria-label={`${field.label}, palier ${String(index + 1)}`}
                  aria-invalid={row.invalid}
                  maxLength={field.maxLength}
                  value={field.value}
                  onChange={(event) => {
                    field.onChange(event.target.value);
                  }}
                />
                {field.suffix === undefined ? null : (
                  <span className="py-tierrow__suffix" aria-hidden="true">
                    {field.suffix}
                  </span>
                )}
              </span>
            ))}
            <button
              type="button"
              className="nv-btn nv-btn--plain nv-btn--sm"
              aria-label={`Retirer le palier ${String(index + 1)}`}
              onClick={() => {
                onRemove(row.key);
              }}
            >
              Retirer
            </button>
          </li>
        ))}
      </ul>
      {canAdd ? (
        <button type="button" className="nv-btn nv-btn--soft nv-btn--sm py-tierform__add" onClick={onAdd}>
          Ajouter un palier
        </button>
      ) : null}
      <p className={hint.error ? 'tm-hint tm-hint--error' : 'tm-hint'}>{hint.text}</p>
    </fieldset>
  );
}
