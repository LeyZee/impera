import {
  PAYOUT_BENEFICIARY_MAX,
  PAYOUT_NOTE_MAX,
  PAYOUT_ORGANISATION_MAX,
  PAYOUT_RECEIVE_METHODS,
  PutPayoutDetailsBodySchema,
  type PayoutDestination,
  type PayoutDetails,
  type PayoutReceiveMethod,
  type PutPayoutDetailsBody,
} from '@impera/contracts';
import { useId, useState, type JSX, type SyntheticEvent } from 'react';

import {
  changedRecently,
  holderOf,
  numberOf,
  PAYOUT_ERRORS,
  RECEIVE_METHODS,
  revealPayout,
  useOwnPayout,
  useRefreshPayouts,
  writePayout,
  type PayoutOutcome,
} from './payout';
import './payout.css';

import { dayOf, longDay } from '@/scheduling/time';
import { Loading } from '@/screens/pay/parts';
import { MONEY_LEAD, useConfirmAgain } from '@/settings/services/ConfirmAgain';
import { Panel } from '@/shell/layout';
import { Failure } from '@/shell/states';

/** Each way of receiving, drawn as a pictogram readable without its word (the screen rule). */
export function MethodIcon({ method }: { method: PayoutReceiveMethod }): JSX.Element {
  return (
    <svg className="po-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {method === 'mobile_money' ? (
        <>
          <rect x="6.5" y="2.5" width="11" height="19" rx="2.5" />
          <path d="M10 18.5h4" />
          <path d="M12 7v6M10 8.5c0-.8.9-1.5 2-1.5s2 .7 2 1.5-1 1.2-2 1.5-2 .7-2 1.5.9 1.5 2 1.5 2-.7 2-1.5" />
        </>
      ) : method === 'bank_account' ? (
        <>
          <path d="M3 9.5 12 4l9 5.5" />
          <path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8" />
          <path d="M3 20.5h18" />
        </>
      ) : (
        <>
          <rect x="2.5" y="6.5" width="19" height="11" rx="2" />
          <circle cx="12" cy="12" r="2.6" />
          <path d="M6 9.5v5M18 9.5v5" />
        </>
      )}
    </svg>
  );
}

/** The details as two lines: who receives, then the number and who holds it. */
function DetailsLines({ details }: { details: PayoutDetails }): JSX.Element {
  const holder = holderOf(details);
  return (
    <dl className="po-lines">
      <div>
        <dt>Bénéficiaire</dt>
        <dd>{details.beneficiary}</dd>
      </div>
      <div>
        <dt>
          {details.method === 'mobile_money'
            ? 'Numéro'
            : details.method === 'bank_account'
              ? 'IBAN ou compte'
              : 'Ville du retrait'}
        </dt>
        <dd className="nv-num">{numberOf(details)}</dd>
      </div>
      {holder === null ? null : (
        <div>
          <dt>{details.method === 'mobile_money' ? 'Opérateur' : 'Banque'}</dt>
          <dd>{holder}</dd>
        </div>
      )}
      {details.note === null ? null : (
        <div>
          <dt>Note</dt>
          <dd>{details.note}</dd>
        </div>
      )}
    </dl>
  );
}

interface Draft {
  readonly method: PayoutReceiveMethod;
  readonly beneficiary: string;
  readonly number: string;
  readonly holder: string;
  readonly note: string;
}

function draftOf(details: PayoutDetails | null): Draft {
  if (details === null) return { method: 'mobile_money', beneficiary: '', number: '', holder: '', note: '' };
  const note = details.note ?? '';
  if (details.method === 'mobile_money')
    return {
      method: details.method,
      beneficiary: details.beneficiary,
      number: details.phone,
      holder: details.operator,
      note,
    };
  if (details.method === 'bank_account')
    return {
      method: details.method,
      beneficiary: details.beneficiary,
      number: details.account,
      holder: details.bank,
      note,
    };
  return { method: details.method, beneficiary: details.beneficiary, number: details.city, holder: '', note };
}

function bodyOf(draft: Draft): PutPayoutDetailsBody {
  const note = draft.note.trim() === '' ? null : draft.note;
  if (draft.method === 'mobile_money')
    return {
      method: draft.method,
      beneficiary: draft.beneficiary,
      phone: draft.number,
      operator: draft.holder,
      note,
    };
  if (draft.method === 'bank_account')
    return {
      method: draft.method,
      beneficiary: draft.beneficiary,
      account: draft.number,
      bank: draft.holder,
      note,
    };
  return { method: draft.method, beneficiary: draft.beneficiary, city: draft.number, note };
}

const NUMBER_LABELS: Readonly<
  Record<PayoutReceiveMethod, { readonly label: string; readonly hint: string }>
> = {
  mobile_money: { label: 'Numéro mobile money', hint: 'Avec l’indicatif du pays : +229 01 23 45 67.' },
  bank_account: { label: 'IBAN ou numéro de compte', hint: 'Recopie-le de ton relevé de banque.' },
  cash_pickup: { label: 'Ville du retrait', hint: 'La ville où tu retires l’argent en agence.' },
};

/** The member's form: the way he receives first, as three tiles, then what that way needs. */
function PayoutForm({
  memberId,
  current,
  onDone,
  onCancel,
}: {
  memberId: string;
  current: PayoutDetails | null;
  onDone: () => void;
  onCancel: (() => void) | null;
}): JSX.Element {
  const id = useId();
  const refresh = useRefreshPayouts();
  const confirm = useConfirmAgain();
  const [draft, setDraft] = useState<Draft>(() => draftOf(current));
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const parsed = PutPayoutDetailsBodySchema.safeParse(bodyOf(draft));
  const problems = new Map<string, string>();
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = String(issue.path[0] ?? '');
      if (!problems.has(field)) problems.set(field, issue.message);
    }
  }
  const numberField =
    draft.method === 'mobile_money' ? 'phone' : draft.method === 'bank_account' ? 'account' : 'city';
  const problemOf = (field: string, words: string): string | null =>
    tried && problems.has(field) ? words : null;
  const set = (field: keyof Draft) => (event: { target: { value: string } }) => {
    setDraft({ ...draft, [field]: event.target.value });
  };

  const save = (): void => {
    if (!parsed.success || busy) return;
    setBusy(true);
    setRefusal(null);
    void writePayout(memberId, bodyOf(draft)).then(async (outcome: PayoutOutcome) => {
      setBusy(false);
      if (outcome.kind === 'ok') {
        await refresh();
        onDone();
        return;
      }
      if (outcome.kind === 'reauth') {
        confirm.ask(save);
        return;
      }
      setRefusal(
        outcome.kind === 'refused'
          ? PAYOUT_ERRORS[outcome.code]
          : 'Le serveur ne répond pas : rien n’a été enregistré.',
      );
    });
  };
  const submit = (event: SyntheticEvent): void => {
    event.preventDefault();
    setTried(true);
    save();
  };

  const prompt = confirm.prompt({ lead: MONEY_LEAD, layout: 'inline', onBusyChange: setBusy });
  if (prompt !== null) return <div className="po-form">{prompt}</div>;

  const numberLabel = NUMBER_LABELS[draft.method];
  const numberProblem = problemOf(numberField, problems.get(numberField) ?? '');
  return (
    <form className="po-form" noValidate onSubmit={submit} aria-busy={busy}>
      <fieldset className="po-methods">
        <legend className="nv-field__label">Comment tu reçois l’argent</legend>
        <div className="po-methods__row">
          {PAYOUT_RECEIVE_METHODS.map((method) => (
            <button
              key={method}
              type="button"
              className="po-method"
              style={{ '--_c': `var(--nv-series-${String(RECEIVE_METHODS[method].series)})` }}
              aria-pressed={draft.method === method}
              onClick={() => {
                setDraft({ ...draft, method, number: draft.method === method ? draft.number : '' });
              }}
            >
              <MethodIcon method={method} />
              <span>{RECEIVE_METHODS[method].label}</span>
            </button>
          ))}
        </div>
      </fieldset>
      <div className="nv-field" data-invalid={problemOf('beneficiary', '') === null ? undefined : 'true'}>
        <label className="nv-field__label" htmlFor={`${id}-beneficiary`}>
          Nom du bénéficiaire
        </label>
        <input
          id={`${id}-beneficiary`}
          className="nv-field__control nv-glass"
          autoComplete="name"
          maxLength={PAYOUT_BENEFICIARY_MAX}
          value={draft.beneficiary}
          aria-invalid={problemOf('beneficiary', '') !== null}
          onChange={set('beneficiary')}
        />
        <p className={problemOf('beneficiary', '') === null ? 'tm-hint' : 'tm-hint tm-hint--error'}>
          {problemOf('beneficiary', '') === null
            ? 'Tel qu’il est écrit sur sa pièce d’identité.'
            : 'Écris le nom de la personne qui reçoit.'}
        </p>
      </div>
      <div className="po-pair">
        <div className="nv-field" data-invalid={numberProblem === null ? undefined : 'true'}>
          <label className="nv-field__label" htmlFor={`${id}-number`}>
            {numberLabel.label}
          </label>
          <input
            id={`${id}-number`}
            className="nv-field__control nv-glass nv-num"
            inputMode={draft.method === 'mobile_money' ? 'tel' : 'text'}
            autoComplete="off"
            spellCheck={false}
            maxLength={60}
            value={draft.number}
            aria-invalid={numberProblem !== null}
            onChange={set('number')}
          />
          <p className={numberProblem === null ? 'tm-hint' : 'tm-hint tm-hint--error'}>
            {numberProblem === null || numberProblem === '' ? numberLabel.hint : numberProblem}
          </p>
        </div>
        {draft.method === 'cash_pickup' ? null : (
          <div
            className="nv-field"
            data-invalid={
              problemOf(draft.method === 'mobile_money' ? 'operator' : 'bank', '') === null
                ? undefined
                : 'true'
            }
          >
            <label className="nv-field__label" htmlFor={`${id}-holder`}>
              {draft.method === 'mobile_money' ? 'Opérateur' : 'Banque'}
            </label>
            <input
              id={`${id}-holder`}
              className="nv-field__control nv-glass"
              maxLength={PAYOUT_ORGANISATION_MAX}
              value={draft.holder}
              onChange={set('holder')}
            />
            <p className="tm-hint">
              {draft.method === 'mobile_money' ? 'MTN, Moov…' : 'Le nom de ta banque.'}
            </p>
          </div>
        )}
      </div>
      <div className="nv-field">
        <label className="nv-field__label" htmlFor={`${id}-note`}>
          Note pour l’agence <span className="po-optional">facultatif</span>
        </label>
        <input
          id={`${id}-note`}
          className="nv-field__control nv-glass"
          maxLength={PAYOUT_NOTE_MAX}
          value={draft.note}
          onChange={set('note')}
        />
      </div>
      {refusal === null ? null : <p className="tm-hint tm-hint--error">{refusal}</p>}
      <p className="tm-hint">
        Chaque changement sonne sur ton téléphone et s’affiche à l’agence : si ce n’est pas toi, préviens ton
        responsable.
      </p>
      <div className="po-form__foot">
        {onCancel === null ? null : (
          <button type="button" className="nv-btn nv-btn--plain" disabled={busy} onClick={onCancel}>
            Annuler
          </button>
        )}
        <button type="submit" className="nv-btn nv-btn--neon" disabled={busy} aria-busy={busy}>
          {busy ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </div>
    </form>
  );
}

/** The answer first: how he is paid, in large, with its pictogram; « À remplir » in amber before he wrote it. */
function Answer({ destination, zone }: { destination: PayoutDestination; zone: string }): JSX.Element {
  const details = destination.details;
  if (details === null) {
    return (
      <div className="po-answer" data-tone="warn">
        <p className="po-answer__value">À remplir</p>
        <p className="po-answer__sub">Sans ça, l’agence ne peut pas t’envoyer ta commission.</p>
      </div>
    );
  }
  const method = RECEIVE_METHODS[details.method];
  return (
    <div className="po-answer" style={{ '--_c': `var(--nv-series-${String(method.series)})` }}>
      <span className="po-answer__badge">
        <MethodIcon method={details.method} />
      </span>
      <div>
        <p className="po-answer__value">{method.label}</p>
        <p className="po-answer__sub">
          {destination.changedAt === null ? null : `Changé le ${longDay(dayOf(destination.changedAt, zone))}`}
        </p>
      </div>
    </div>
  );
}

/**
 * Moi › Dossier: « Où te verser » (ADR 0165), written by the member himself, read back by him. The owner never writes
 * it; each change rings on the member's phone.
 */
export function MyPayoutCard({ memberId, zone }: { memberId: string; zone: string }): JSX.Element {
  const read = useOwnPayout(memberId);
  const [editing, setEditing] = useState(false);
  if (read.isError) {
    return (
      <Panel className="po-card nv-enter" eyebrow="Où te verser">
        <div className="po-sec">
          <Failure
            inline
            onRetry={() => {
              void read.refetch();
            }}
          />
        </div>
      </Panel>
    );
  }
  const destination = read.data;
  if (destination === undefined) {
    return (
      <Panel className="po-card nv-enter" eyebrow="Où te verser">
        <Loading rows={2} />
      </Panel>
    );
  }
  const details = destination.details;
  return (
    <Panel
      className="po-card nv-enter"
      eyebrow="Où te verser"
      actions={
        details === null || editing ? null : (
          <button
            type="button"
            className="nv-btn nv-btn--soft nv-btn--sm"
            onClick={() => {
              setEditing(true);
            }}
          >
            Modifier
          </button>
        )
      }
    >
      <div className="po-sec">
        <Answer destination={destination} zone={zone} />
        {details === null || editing ? (
          <PayoutForm
            memberId={memberId}
            current={details}
            onDone={() => {
              setEditing(false);
            }}
            onCancel={
              details === null
                ? null
                : () => {
                    setEditing(false);
                  }
            }
          />
        ) : (
          <DetailsLines details={details} />
        )}
      </div>
    </Panel>
  );
}

/**
 * Beside « Marquer payé » (owner): how the member receives and when he last changed it, in amber when it is recent;
 * the number shows on « Afficher », one member at a time, with the password and the code, and the journal keeps it.
 */
export function PayoutTo({
  memberId,
  memberName,
  summary,
  zone,
  now,
}: {
  memberId: string;
  memberName: string;
  summary: { readonly method: PayoutReceiveMethod | null; readonly changedAt: string | null } | null;
  zone: string;
  now: Date;
}): JSX.Element {
  const confirm = useConfirmAgain();
  const [shown, setShown] = useState<PayoutDetails | null>(null);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const reveal = (): void => {
    setBusy(true);
    setRefusal(null);
    void revealPayout(memberId).then((outcome) => {
      setBusy(false);
      if (outcome.kind === 'ok') {
        setShown(outcome.value.details);
        return;
      }
      if (outcome.kind === 'reauth') {
        confirm.ask(reveal);
        return;
      }
      setRefusal(
        outcome.kind === 'refused' ? PAYOUT_ERRORS[outcome.code] : 'Le serveur ne répond pas : réessaie.',
      );
    });
  };

  if (summary?.method == null) {
    return (
      <div className="po-to" data-tone="warn">
        <p className="po-to__title">Où le verser : pas encore rempli</p>
        <p className="tm-hint">
          {memberName} le remplit dans Moi › Dossier ; toi, tu ne peux pas le saisir pour lui.
        </p>
      </div>
    );
  }
  const method = RECEIVE_METHODS[summary.method];
  const recent = changedRecently(summary.changedAt, now);
  const prompt = confirm.prompt({ lead: MONEY_LEAD, layout: 'inline', onBusyChange: setBusy });
  return (
    <div className="po-to" style={{ '--_c': `var(--nv-series-${String(method.series)})` }} aria-busy={busy}>
      <div className="po-to__head">
        <span className="po-answer__badge">
          <MethodIcon method={summary.method} />
        </span>
        <div className="po-to__what">
          <p className="po-to__title">{method.label}</p>
          {summary.changedAt === null ? null : (
            <p className={recent ? 'po-to__changed' : 'tm-hint'} data-tone={recent ? 'warn' : undefined}>
              {recent ? 'Changé récemment : ' : 'Changé le '}
              {recent
                ? `le ${longDay(dayOf(summary.changedAt, zone))}, vérifie avec ${memberName}`
                : longDay(dayOf(summary.changedAt, zone))}
            </p>
          )}
        </div>
        {shown === null && prompt === null ? (
          <button type="button" className="nv-btn nv-btn--soft nv-btn--sm" disabled={busy} onClick={reveal}>
            Afficher
          </button>
        ) : null}
      </div>
      {prompt}
      {refusal === null ? null : <p className="tm-hint tm-hint--error">{refusal}</p>}
      {shown === null ? null : (
        <div className="po-to__shown">
          <DetailsLines details={shown} />
          <button
            type="button"
            className="nv-btn nv-btn--soft nv-btn--sm"
            onClick={() => {
              void navigator.clipboard.writeText(numberOf(shown).replace(/\s/gu, '')).then(
                () => {
                  setCopied(true);
                },
                () => undefined,
              );
            }}
          >
            {copied ? 'Copié' : 'Copier le numéro'}
          </button>
        </div>
      )}
    </div>
  );
}
