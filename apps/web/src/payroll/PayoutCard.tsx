import {
  PAYOUT_CITY_MAX,
  PAYOUT_COUNTRIES,
  PAYOUT_DIAL_CODES,
  PAYOUT_EMAIL_MAX,
  PAYOUT_NAME_MAX,
  PAYOUT_NOTE_MAX,
  PAYOUT_ORGANISATION_MAX,
  PAYOUT_RECEIVE_METHODS,
  PutPayoutDetailsBodySchema,
  type PayoutCountry,
  type PayoutDestination,
  type PayoutDetails,
  type PayoutReceiveMethod,
  type PutPayoutDetailsBody,
} from '@impera/contracts';
import { useEffect, useId, useState, type JSX, type SyntheticEvent } from 'react';

import {
  changedRecently,
  dialPrefix,
  holderOf,
  numberOf,
  PAYOUT_ERRORS,
  RECEIVE_METHODS,
  revealPayout,
  useOwnPayout,
  usePayoutList,
  useRefreshPayouts,
  phoneLine,
  writePayout,
  type PayoutOutcome,
} from './payout';
import './payout.css';

import { countryFlag, countryName } from '@/lib/country';
import { dayOf, longDay } from '@/scheduling/time';
import { Loading } from '@/screens/pay/parts';
import { FIRST_COUNTRIES } from '@/screens/team/model';
import { MONEY_LEAD, useConfirmAgain } from '@/settings/services/ConfirmAgain';
import { Select } from '@/shell/Select';
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

/** One line of the details, with its copy button for the owner, who pastes it into WorldRemit field by field. */
function Line({
  label,
  value,
  copy,
  numeric = false,
}: {
  label: string;
  value: string;
  /** What the clipboard takes (spaces dropped from a number); `null` when the line is not copied. */
  copy: string | null;
  numeric?: boolean;
}): JSX.Element {
  const [copied, setCopied] = useState(false);
  // « Copié » says the gesture worked, then gives the button back.
  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => {
      setCopied(false);
    }, 2000);
    return () => {
      clearTimeout(timer);
    };
  }, [copied]);
  return (
    <div>
      <dt>{label}</dt>
      <dd className={numeric ? 'nv-num' : undefined}>
        <span>{value}</span>
        {copy === null ? null : (
          <button
            type="button"
            className="nv-btn nv-btn--plain nv-btn--sm po-copy"
            aria-label={copied ? `${label} copié` : `Copier ${label.toLowerCase()}`}
            onClick={() => {
              void navigator.clipboard.writeText(copy).then(
                () => {
                  setCopied(true);
                },
                () => undefined,
              );
            }}
          >
            {copied ? 'Copié' : 'Copier'}
          </button>
        )}
      </dd>
    </div>
  );
}

/**
 * The details in the order WorldRemit asks them: who receives, where, how to reach him, then the number and who holds
 * it. `copyable`: each line gets its own copy button, never one for everything (Sécurité, 21/11).
 */
function DetailsLines({ details, copyable }: { details: PayoutDetails; copyable: boolean }): JSX.Element {
  const holder = holderOf(details);
  const number = numberOf(details);
  const copy = (value: string): string | null => (copyable ? value : null);
  return (
    <dl className="po-lines">
      <Line
        label="Pays"
        value={`${countryFlag(details.country)}  ${countryName(details.country)}`}
        copy={null}
      />
      <Line label="Prénom" value={details.firstName} copy={copy(details.firstName)} />
      <Line label="Nom" value={details.lastName} copy={copy(details.lastName)} />
      <Line label="Ville" value={details.city} copy={copy(details.city)} />
      <Line
        label="Téléphone de contact"
        value={phoneLine(details.contactPhone, details.country)}
        copy={copy(details.contactPhone)}
        numeric
      />
      {details.email === null ? null : (
        <Line label="E-mail" value={details.email} copy={copy(details.email)} />
      )}
      {number === null ? null : (
        <Line
          label={details.method === 'mobile_money' ? 'Numéro mobile money' : 'IBAN ou RIB'}
          value={number}
          copy={copy(number.replace(/\s/gu, ''))}
          numeric
        />
      )}
      {holder === null ? null : (
        <Line
          label={details.method === 'mobile_money' ? 'Opérateur' : 'Banque'}
          value={holder}
          copy={copy(holder)}
        />
      )}
      {details.note === null ? null : <Line label="Note" value={details.note} copy={null} />}
    </dl>
  );
}

interface Draft {
  readonly method: PayoutReceiveMethod;
  readonly country: PayoutCountry;
  readonly firstName: string;
  readonly lastName: string;
  readonly city: string;
  readonly contactPhone: string;
  readonly email: string;
  /** The mobile money number or the account. */
  readonly number: string;
  /** The operator or the bank. */
  readonly holder: string;
  readonly note: string;
}

/** Where the agency's chatters mostly live (Charles, 27/10): the form starts there. */
const FIRST_COUNTRY: PayoutCountry = 'BJ';

function draftOf(details: PayoutDetails | null): Draft {
  if (details === null) {
    const prefix = `${dialPrefix(FIRST_COUNTRY)} `;
    return {
      method: 'mobile_money',
      country: FIRST_COUNTRY,
      firstName: '',
      lastName: '',
      city: '',
      contactPhone: prefix,
      email: '',
      number: prefix,
      holder: '',
      note: '',
    };
  }
  const who = {
    method: details.method,
    country: details.country,
    firstName: details.firstName,
    lastName: details.lastName,
    city: details.city,
    contactPhone: details.contactPhone,
    email: details.email ?? '',
    note: details.note ?? '',
  };
  if (details.method === 'mobile_money') return { ...who, number: details.phone, holder: details.operator };
  if (details.method === 'bank_account') return { ...who, number: details.account, holder: details.bank };
  return { ...who, number: '', holder: '' };
}

function bodyOf(draft: Draft): PutPayoutDetailsBody {
  const who = {
    country: draft.country,
    firstName: draft.firstName,
    lastName: draft.lastName,
    city: draft.city,
    contactPhone: draft.contactPhone,
    email: draft.email.trim() === '' ? null : draft.email,
    note: draft.note.trim() === '' ? null : draft.note,
  };
  if (draft.method === 'mobile_money')
    return { method: draft.method, ...who, phone: draft.number, operator: draft.holder };
  if (draft.method === 'bank_account')
    return { method: draft.method, ...who, account: draft.number, bank: draft.holder };
  return { method: draft.method, ...who };
}

/** A phone still holding only a prefix follows the country; one he typed stays as it is. */
const followsCountry = (phone: string, from: PayoutCountry): boolean =>
  phone.trim() === '' || phone.trim() === dialPrefix(from);

const COUNTRY_OPTIONS = [
  ...FIRST_COUNTRIES.filter((code): code is PayoutCountry => code in PAYOUT_DIAL_CODES).map((code) => ({
    value: code,
    label: `${countryFlag(code)}  ${countryName(code)}`,
    group: 'Les plus fréquents',
  })),
  ...PAYOUT_COUNTRIES.filter((code) => !FIRST_COUNTRIES.includes(code))
    .map((code) => ({
      value: code,
      label: `${countryFlag(code)}  ${countryName(code)}`,
      group: 'Tous les pays',
    }))
    .toSorted((a, b) => a.label.localeCompare(b.label, 'fr')),
];

/** One text field of the form, its hint turning into its problem once he tried to save. */
function TextField({
  id,
  label,
  hint,
  problem,
  value,
  onChange,
  maxLength,
  optional = false,
  numeric = false,
  inputMode,
  autoComplete = 'off',
}: {
  id: string;
  label: string;
  hint: string | null;
  problem: string | null;
  value: string;
  onChange: (value: string) => void;
  maxLength: number;
  optional?: boolean;
  numeric?: boolean;
  inputMode?: 'tel' | 'email' | 'text';
  autoComplete?: string;
}): JSX.Element {
  const said = problem ?? hint;
  return (
    <div className="nv-field" data-invalid={problem === null ? undefined : 'true'}>
      <label className="nv-field__label" htmlFor={id}>
        {label} {optional ? <span className="po-optional">facultatif</span> : null}
      </label>
      <input
        id={id}
        className={numeric ? 'nv-field__control nv-glass nv-num' : 'nv-field__control nv-glass'}
        inputMode={inputMode}
        autoComplete={autoComplete}
        spellCheck={false}
        maxLength={maxLength}
        value={value}
        aria-invalid={problem !== null}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
      {said === null ? null : (
        <p className={problem === null ? 'tm-hint' : 'tm-hint tm-hint--error'}>{said}</p>
      )}
    </div>
  );
}

/**
 * The member's form, in the order WorldRemit asks (its pages for Benin, 21/11): the way he receives, then who he is
 * and where, how to reach him, and what that way needs.
 */
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
  /** Its problem once he tried, in the words given, or the schema's own when none are. */
  const problemOf = (field: string, words?: string): string | null =>
    tried && problems.has(field) ? (words ?? problems.get(field) ?? null) : null;
  const set =
    (field: Exclude<keyof Draft, 'method' | 'country'>) =>
    (value: string): void => {
      setDraft({ ...draft, [field]: value });
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

  const prefix = dialPrefix(draft.country);
  const phoneHint = `Avec l’indicatif du pays : ${prefix} 01 23 45 67.`;
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
                if (draft.method === method) return;
                setDraft({
                  ...draft,
                  method,
                  number: method === 'mobile_money' ? `${prefix} ` : '',
                  holder: '',
                });
              }}
            >
              <MethodIcon method={method} />
              <span>{RECEIVE_METHODS[method].label}</span>
            </button>
          ))}
        </div>
      </fieldset>
      <div className="nv-field">
        <label className="nv-field__label" htmlFor={`${id}-country`}>
          Pays où tu reçois
        </label>
        <Select
          id={`${id}-country`}
          value={draft.country}
          searchLabel="Chercher un pays"
          empty="Aucun pays ne correspond."
          options={COUNTRY_OPTIONS}
          onChange={(country) => {
            const next = `${dialPrefix(country)} `;
            setDraft({
              ...draft,
              country,
              contactPhone: followsCountry(draft.contactPhone, draft.country) ? next : draft.contactPhone,
              number:
                draft.method === 'mobile_money' && followsCountry(draft.number, draft.country)
                  ? next
                  : draft.number,
            });
          }}
        />
      </div>
      <div className="po-pair">
        <TextField
          id={`${id}-first`}
          label="Prénom"
          hint="Comme sur ta pièce d’identité."
          problem={problemOf('firstName', 'Écris ton prénom, comme sur ta pièce.')}
          value={draft.firstName}
          onChange={set('firstName')}
          maxLength={PAYOUT_NAME_MAX}
          autoComplete="given-name"
        />
        <TextField
          id={`${id}-last`}
          label="Nom"
          hint="WorldRemit ne paie que ce nom-là."
          problem={problemOf('lastName', 'Écris ton nom, comme sur ta pièce.')}
          value={draft.lastName}
          onChange={set('lastName')}
          maxLength={PAYOUT_NAME_MAX}
          autoComplete="family-name"
        />
      </div>
      <div className="po-pair">
        <TextField
          id={`${id}-city`}
          label="Ville"
          hint={
            draft.method === 'cash_pickup'
              ? 'Celle où tu retires l’argent en agence.'
              : 'Ta ville, pas ton adresse.'
          }
          problem={problemOf('city', 'Écris ta ville.')}
          value={draft.city}
          onChange={set('city')}
          maxLength={PAYOUT_CITY_MAX}
          autoComplete="address-level2"
        />
        <TextField
          id={`${id}-contact`}
          label="Téléphone de contact"
          hint="WorldRemit t’y envoie la référence du virement."
          problem={problemOf('contactPhone', `Un numéro au format ${prefix}…`)}
          value={draft.contactPhone}
          onChange={set('contactPhone')}
          maxLength={24}
          numeric
          inputMode="tel"
          autoComplete="tel"
        />
      </div>
      <TextField
        id={`${id}-email`}
        label="E-mail"
        hint="Pour suivre tes virements. L’agence ne t’y écrit jamais."
        problem={problemOf('email', 'Une adresse e-mail, ou rien.')}
        value={draft.email}
        onChange={set('email')}
        maxLength={PAYOUT_EMAIL_MAX}
        optional
        inputMode="email"
        autoComplete="email"
      />
      {draft.method === 'cash_pickup' ? (
        <p className="tm-hint">
          Au guichet, tu montres ta pièce d’identité et la référence que l’agence t’envoie : rien d’autre à
          remplir.
        </p>
      ) : (
        <div className="po-pair">
          <TextField
            id={`${id}-number`}
            label={draft.method === 'mobile_money' ? 'Numéro mobile money' : 'IBAN ou RIB'}
            hint={
              draft.method === 'mobile_money'
                ? `${phoneHint} Il peut être différent de ton numéro de contact.`
                : 'Recopie-le de ton relevé : au Bénin, le RIB a 23 caractères.'
            }
            problem={problemOf(
              draft.method === 'mobile_money' ? 'phone' : 'account',
              draft.method === 'mobile_money' ? `Un numéro au format ${prefix}…` : 'Un IBAN ou un RIB.',
            )}
            value={draft.number}
            onChange={set('number')}
            maxLength={60}
            numeric
            inputMode={draft.method === 'mobile_money' ? 'tel' : 'text'}
          />
          <TextField
            id={`${id}-holder`}
            label={draft.method === 'mobile_money' ? 'Opérateur' : 'Banque'}
            hint={draft.method === 'mobile_money' ? 'MTN, Moov…' : 'Le nom de ta banque.'}
            problem={problemOf(
              draft.method === 'mobile_money' ? 'operator' : 'bank',
              draft.method === 'mobile_money' ? 'Écris ton opérateur.' : 'Écris le nom de ta banque.',
            )}
            value={draft.holder}
            onChange={set('holder')}
            maxLength={PAYOUT_ORGANISATION_MAX}
          />
        </div>
      )}
      <TextField
        id={`${id}-note`}
        label="Note pour l’agence"
        hint={null}
        problem={null}
        value={draft.note}
        onChange={set('note')}
        maxLength={PAYOUT_NOTE_MAX}
        optional
        autoComplete="off"
      />
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
          <DetailsLines details={details} copyable={false} />
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
          <DetailsLines details={shown} copyable />
        </div>
      )}
    </div>
  );
}

/**
 * The owner's line in « Marquer payé »: nothing while the list is read; a failed read says so with « Réessayer », never
 * « pas encore rempli », which would be a guess.
 */
export function PayoutLine({
  memberId,
  memberName,
  zone,
}: {
  memberId: string;
  memberName: string;
  zone: string;
}): JSX.Element | null {
  const payouts = usePayoutList(true);
  if (payouts.isPending) return null;
  if (payouts.isError) {
    return (
      <Failure
        inline
        title="Où le verser : pas lu"
        onRetry={() => {
          void payouts.refetch();
        }}
      />
    );
  }
  const summary = payouts.data.destinations.find((one) => one.memberId === memberId) ?? null;
  return (
    <PayoutTo memberId={memberId} memberName={memberName} summary={summary} zone={zone} now={new Date()} />
  );
}
