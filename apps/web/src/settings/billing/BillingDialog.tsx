import {
  AGENCY_LEGAL_FORM_MAX,
  DOCUMENT_REMINDER_MAX_DAYS,
  INVOICE_DUE_MAX_DAYS,
  INVOICE_DUE_MIN_DAYS,
  LEGAL_NAME_MAX,
  PAYMENT_TERMS_MAX,
  POSTAL_ADDRESS_MAX,
  RCS_CITY_MAX,
  SERVICE_DESCRIPTION_MAX,
  type AgencyLogo,
  type BillingSettingsView,
} from '@impera/contracts';
import { useId, useLayoutEffect, useRef, useState, type JSX, type ReactNode } from 'react';

import { addLogo, logoUrl, saveBillingSettings, useKeepBillingSettings, type BillingRefusal } from './api';
import {
  ALL_STEPS,
  FIELDS_OF,
  LOGO_HINT,
  LOGO_REFUSALS,
  MONTHS,
  STEP_TITLES,
  bodyOf,
  closeChoiceText,
  draftOf,
  logoLine,
  logoWarning,
  problemsOf,
  suggestedVat,
  wrongSteps,
  type BillingDraft,
  type DraftField,
  type StepKey,
} from './model';

import { Dialog } from '@/screens/team/Dialog';

/** The legal forms a French agency most often has: a suggestion, never a list to choose from. */
const LEGAL_FORMS = ['SAS', 'SASU', 'SARL', 'EURL', 'SA', 'SNC'] as const;

/** What a refused save says, and what to do. */
function refusalText(refusal: BillingRefusal): string {
  switch (refusal.kind) {
    case 'logo':
      return LOGO_REFUSALS[refusal.reason];
    case 'logo_missing':
      return 'Le serveur ne trouve plus ce logo : dépose-le à nouveau, ou enregistre sans logo.';
    case 'invalid':
      return 'Le serveur a refusé un champ : relis chaque étape, puis enregistre à nouveau.';
    case 'forbidden':
      return 'Seul le propriétaire de l’agence règle la facturation.';
    case 'failed':
      return 'Le serveur ne répond pas : rien n’a été enregistré. Réessaie dans un instant.';
  }
}

/**
 * The form of Réglages › Facturation, one step at a time: all six the first time, a card's own steps afterwards (plus
 * any whose saved value would be refused, so that the save goes through). Every save sends the whole settings; the
 * logo is sent alone as soon as it is picked, and kept only once saved.
 */
export function BillingDialog({
  view,
  title,
  steps: asked,
  onClose,
}: {
  view: BillingSettingsView;
  title: string;
  steps: readonly StepKey[];
  onClose: () => void;
}): JSX.Element {
  const id = useId();
  const keep = useKeepBillingSettings();
  const body = useRef<HTMLFormElement>(null);
  const setup = view.settings === null;
  const [steps] = useState<readonly StepKey[]>(() => {
    const wrong = setup ? [] : wrongSteps(draftOf(view.settings));
    return ALL_STEPS.filter((step) => asked.includes(step) || wrong.includes(step));
  });
  const [draft, setDraft] = useState<BillingDraft>(() => draftOf(view.settings));
  const [logo, setLogo] = useState<AgencyLogo | null>(view.logo);
  const [index, setIndex] = useState(0);
  const [shown, setShown] = useState<ReadonlySet<StepKey>>(
    () => new Set(setup ? [] : wrongSteps(draftOf(view.settings))),
  );
  const [busy, setBusy] = useState(false);
  // A logo being read by the server: nothing is saved nor left meanwhile, or the save would keep the logo before it.
  const [reading, setReading] = useState(false);
  const [refusal, setRefusal] = useState<BillingRefusal | null>(null);

  const step = steps[index] ?? 'agency';
  const last = index === steps.length - 1;
  const problems = shown.has(step) ? problemsOf(draft, FIELDS_OF[step]) : {};

  // Each step opens on its first field; a step that cannot go on, on its first problem. In the commit that shows the
  // step, before it is painted (#342).
  useLayoutEffect(() => {
    const form = body.current;
    if (form === null) return;
    (
      form.querySelector<HTMLElement>('[aria-invalid="true"]') ??
      form.querySelector<HTMLElement>('[data-autofocus], input:not([type="file"]), textarea, select')
    )?.focus();
  }, [index, shown]);

  const set = (field: DraftField) => (value: string) => {
    setDraft((before) => ({ ...before, [field]: value }));
  };

  const save = async (): Promise<void> => {
    const sent = bodyOf(draft);
    if (sent === null) {
      const wrong = wrongSteps(draft);
      setShown(new Set(wrong));
      const first = steps.findIndex((one) => wrong.includes(one));
      if (first >= 0) setIndex(first);
      return;
    }
    setBusy(true);
    setRefusal(null);
    const outcome = await saveBillingSettings(sent);
    setBusy(false);
    if (outcome.kind === 'ok') {
      keep(outcome.value);
      onClose();
      return;
    }
    setRefusal(outcome);
  };

  const next = (): void => {
    if (busy || reading) return;
    if (Object.keys(problemsOf(draft, FIELDS_OF[step])).length > 0) {
      setShown((before) => new Set([...before, step]));
      return;
    }
    if (last) {
      void save();
      return;
    }
    setIndex(index + 1);
  };

  return (
    <Dialog
      title={title}
      lead="Pour chaque facture émise à partir de maintenant"
      busy={busy}
      className="bf-dialog bf"
      onClose={onClose}
    >
      <form
        ref={body}
        className="tm-dialog__body bf-step"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          next();
        }}
      >
        {steps.length > 1 ? (
          <ol className="bf-progress" aria-label="Étapes">
            {steps.map((one, at) => (
              <li
                key={one}
                data-state={at < index ? 'done' : at === index ? 'now' : 'later'}
                aria-current={at === index ? 'step' : undefined}
              >
                <span className="bf-progress__num">{String(at + 1)}</span>
                <span className="bf-progress__title">{STEP_TITLES[one]}</span>
              </li>
            ))}
          </ol>
        ) : null}
        {step === 'agency' ? (
          <AgencyStep id={id} draft={draft} problems={problems} set={set} />
        ) : step === 'registration' ? (
          <RegistrationStep id={id} draft={draft} problems={problems} set={set} />
        ) : step === 'service' ? (
          <ServiceStep id={id} draft={draft} problems={problems} set={set} />
        ) : step === 'payment' ? (
          <PaymentStep id={id} draft={draft} problems={problems} set={set} />
        ) : step === 'reminder' ? (
          <ReminderStep id={id} draft={draft} problems={problems} set={set} />
        ) : (
          <LogoStep
            logo={draft.logoSha256 === null ? null : logo}
            busy={busy}
            reading={reading}
            onReading={setReading}
            onLogo={(kept) => {
              setLogo(kept);
              setDraft((before) => ({ ...before, logoSha256: kept?.sha256 ?? null }));
            }}
          />
        )}
        {refusal === null ? null : (
          <p className="tm-warn nv-swap" role="alert">
            {refusalText(refusal)}
          </p>
        )}
        <div className="tm-dialog__foot">
          {index === 0 ? (
            <button type="button" className="nv-btn nv-btn--plain" disabled={busy} onClick={onClose}>
              Annuler
            </button>
          ) : (
            <button
              type="button"
              className="nv-btn nv-btn--plain"
              disabled={busy || reading}
              onClick={() => {
                setIndex(index - 1);
              }}
            >
              Retour
            </button>
          )}
          <button type="submit" className="nv-btn nv-btn--neon" disabled={busy || reading} aria-busy={busy}>
            {busy ? 'Enregistrement…' : last ? 'Enregistrer' : 'Continuer'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

interface StepProps {
  readonly id: string;
  readonly draft: BillingDraft;
  readonly problems: Partial<Record<DraftField, string>>;
  readonly set: (field: DraftField) => (value: string) => void;
}

/** A labelled field: its problem in amber under it once the step was tried, its hint otherwise. */
function Field({
  id,
  field,
  label,
  hint,
  problems,
  after,
  children,
}: {
  id: string;
  field: DraftField;
  label: string;
  hint?: ReactNode;
  problems: StepProps['problems'];
  /** What follows the hint or the problem: a value to take over. */
  after?: ReactNode;
  children: ReactNode;
}): JSX.Element {
  const problem = problems[field];
  return (
    <div className="nv-field bf-field" data-invalid={problem === undefined ? undefined : 'true'}>
      <label className="nv-field__label" htmlFor={`${id}-${field}`}>
        {label}
      </label>
      {children}
      {problem === undefined ? (
        hint === undefined ? null : (
          <div className="tm-hint" id={`${id}-${field}-hint`}>
            {hint}
          </div>
        )
      ) : (
        <p className="tm-hint tm-hint--error" id={`${id}-${field}-hint`}>
          {problem}
        </p>
      )}
      {after}
    </div>
  );
}

/** The props every text control of a step shares. */
function control(
  { id, draft, problems, set }: StepProps,
  field: DraftField,
  hinted: boolean,
): {
  id: string;
  className: string;
  value: string;
  'aria-invalid': boolean;
  'aria-describedby': string | undefined;
  onChange: (event: { target: { value: string } }) => void;
} {
  return {
    id: `${id}-${field}`,
    className: 'nv-field__control nv-glass',
    value: draft[field],
    'aria-invalid': problems[field] !== undefined,
    'aria-describedby': hinted || problems[field] !== undefined ? `${id}-${field}-hint` : undefined,
    onChange: (event) => {
      set(field)(event.target.value);
    },
  };
}

function AgencyStep(props: StepProps): JSX.Element {
  const { id, problems } = props;
  return (
    <>
      <Field id={id} field="legalName" label="Raison sociale" problems={problems}>
        <input
          {...control(props, 'legalName', false)}
          maxLength={LEGAL_NAME_MAX}
          autoComplete="organization"
        />
      </Field>
      <div className="bf-pair">
        <Field id={id} field="legalForm" label="Forme juridique" problems={problems}>
          <input
            {...control(props, 'legalForm', false)}
            maxLength={AGENCY_LEGAL_FORM_MAX}
            list={`${id}-forms`}
            autoComplete="off"
          />
          <datalist id={`${id}-forms`}>
            {LEGAL_FORMS.map((form) => (
              <option key={form} value={form} />
            ))}
          </datalist>
        </Field>
        <Field id={id} field="shareCapital" label="Capital social" problems={problems}>
          <div className="bf-unit">
            <input {...control(props, 'shareCapital', false)} inputMode="decimal" autoComplete="off" />
            <span className="bf-unit__sign" aria-hidden="true">
              €
            </span>
          </div>
        </Field>
      </div>
      <Field
        id={id}
        field="address"
        label="Adresse du siège"
        hint="Telle que sur le Kbis : le numéro et la rue, puis le code postal et la ville."
        problems={problems}
      >
        <textarea {...control(props, 'address', true)} rows={3} maxLength={POSTAL_ADDRESS_MAX} />
      </Field>
    </>
  );
}

function RegistrationStep(props: StepProps): JSX.Element {
  const { id, draft, problems, set } = props;
  const suggested = suggestedVat(draft);
  return (
    <>
      <div className="bf-pair">
        <Field id={id} field="siren" label="SIREN" hint="Neuf chiffres, sur le Kbis." problems={problems}>
          <input
            {...control(props, 'siren', true)}
            className="nv-field__control nv-glass nv-num"
            inputMode="numeric"
            autoComplete="off"
          />
        </Field>
        <Field
          id={id}
          field="rcsCity"
          label="Ville du RCS"
          hint="Le greffe d’immatriculation."
          problems={problems}
        >
          <input {...control(props, 'rcsCity', true)} maxLength={RCS_CITY_MAX} autoComplete="off" />
        </Field>
      </div>
      <Field
        id={id}
        field="vatNumber"
        label="TVA intracommunautaire"
        hint="Le numéro de l’agence, sur ses avis de TVA."
        problems={problems}
        after={
          suggested === null ? null : (
            <p className="tm-hint bf-suggest">
              D’après le SIREN : <span className="nv-num">{suggested}</span>
              <button
                type="button"
                className="bf-link"
                onClick={() => {
                  set('vatNumber')(suggested);
                }}
              >
                Le reprendre
              </button>
            </p>
          )
        }
      >
        <input
          {...control(props, 'vatNumber', true)}
          className="nv-field__control nv-glass nv-num"
          autoCapitalize="characters"
          autoComplete="off"
        />
      </Field>
      <Field
        id={id}
        field="fiscalYearEndMonth"
        label="Clôture de l’exercice"
        hint="Le mois que ton comptable confirme. Chaque PDF émis ensuite est gardé dix ans après la clôture de son exercice."
        problems={problems}
      >
        <select
          {...control(props, 'fiscalYearEndMonth', true)}
          className="nv-field__control nv-glass tm-select"
        >
          {MONTHS.map((month, at) => (
            <option key={month} value={String(at + 1)}>
              {closeChoiceText(at + 1)}
            </option>
          ))}
        </select>
      </Field>
    </>
  );
}

function ServiceStep(props: StepProps): JSX.Element {
  const { id, draft, problems } = props;
  return (
    <Field
      id={id}
      field="serviceDescription"
      label="Désignation de la prestation"
      hint={
        <span className="bf-hint-row">
          <span>
            Ce que chaque facture dit avoir été fourni, au-dessus de ses lignes. Écris-la avec ton comptable.
          </span>
          <span className="bf-count">
            {String(draft.serviceDescription.trim().length)}/{String(SERVICE_DESCRIPTION_MAX)}
          </span>
        </span>
      }
      problems={problems}
    >
      <textarea
        {...control(props, 'serviceDescription', true)}
        rows={4}
        maxLength={SERVICE_DESCRIPTION_MAX}
      />
    </Field>
  );
}

/** How long before a document's end its renewal is reminded, to the contractor and to the owner (`remindFrom`). */
function ReminderStep(props: StepProps): JSX.Element {
  const { id, problems } = props;
  return (
    <Field
      id={id}
      field="documentReminderDays"
      label="Rappel des pièces"
      hint={`De 1 à ${String(DOCUMENT_REMINDER_MAX_DAYS)} jours : le prestataire et toi lisez le rappel ce nombre de jours avant la fin d’une pièce. L’attestation de résidence fiscale garde le 1er décembre de son année.`}
      problems={problems}
    >
      <div className="bf-days">
        <input
          {...control(props, 'documentReminderDays', true)}
          className="nv-field__control nv-glass nv-num"
          inputMode="numeric"
          autoComplete="off"
        />
        <span>jours avant la fin</span>
      </div>
    </Field>
  );
}

function PaymentStep(props: StepProps): JSX.Element {
  const { id, draft, problems } = props;
  return (
    <>
      <Field
        id={id}
        field="dueDays"
        label="Échéance"
        hint={`De ${String(INVOICE_DUE_MIN_DAYS)} à ${String(INVOICE_DUE_MAX_DAYS)} jours : chaque facture imprime sa date d’émission plus ce délai.`}
        problems={problems}
      >
        <div className="bf-days">
          <input
            {...control(props, 'dueDays', true)}
            className="nv-field__control nv-glass nv-num"
            inputMode="numeric"
            autoComplete="off"
          />
          <span>jours après l’émission</span>
        </div>
      </Field>
      <Field
        id={id}
        field="paymentTerms"
        label="Conditions de paiement"
        hint={
          <>
            <span className="bf-hint-row">
              <span>Imprimées sous l’échéance. Elles disent, et ton comptable valide le texte :</span>
              <span className="bf-count">
                {String(draft.paymentTerms.trim().length)}/{String(PAYMENT_TERMS_MAX)}
              </span>
            </span>
            <ul className="bf-musts">
              <li>qu’aucun escompte n’est accordé pour un paiement anticipé ;</li>
              <li>le taux des pénalités de retard, au moins trois fois le taux d’intérêt légal ;</li>
              <li>l’indemnité forfaitaire de 40 € pour frais de recouvrement.</li>
            </ul>
          </>
        }
        problems={problems}
      >
        <textarea {...control(props, 'paymentTerms', true)} rows={4} maxLength={PAYMENT_TERMS_MAX} />
      </Field>
    </>
  );
}

/**
 * The logo, sent as soon as it is picked: the server reads it whole and says why it refuses one. Kept by the next save
 * only; « Ne pas imprimer de logo » prints the legal name alone. While the server reads it, the dialog saves nothing
 * (`reading`); once read, the focus goes back to the button that picks one, disabled meanwhile.
 */
function LogoStep({
  logo,
  busy,
  reading,
  onReading,
  onLogo,
}: {
  logo: AgencyLogo | null;
  busy: boolean;
  reading: boolean;
  onReading: (reading: boolean) => void;
  onLogo: (logo: AgencyLogo | null) => void;
}): JSX.Element {
  const file = useRef<HTMLInputElement>(null);
  const pick = useRef<HTMLButtonElement>(null);
  const read = useRef(false);
  const [refused, setRefused] = useState<{ readonly name: string; readonly refusal: BillingRefusal } | null>(
    null,
  );
  const warning = logo === null ? null : logoWarning(logo);

  // A disabled button loses the focus: it gets it back in the commit that enables it again.
  useLayoutEffect(() => {
    if (reading) {
      read.current = true;
      return;
    }
    if (!read.current) return;
    read.current = false;
    pick.current?.focus();
  }, [reading]);

  const send = async (picked: File): Promise<void> => {
    setRefused(null);
    onReading(true);
    const outcome = await addLogo(picked);
    onReading(false);
    if (outcome.kind === 'ok') {
      onLogo(outcome.value);
      return;
    }
    setRefused({ name: picked.name, refusal: outcome });
  };

  return (
    <div className="bf-step" aria-busy={reading}>
      <div className="bf-paper bf-paper--logo">
        {logo === null ? (
          <p className="bf-paper__none">Aucun logo : la facture imprime la raison sociale seule.</p>
        ) : (
          <img src={logoUrl(logo.sha256)} alt="Le logo choisi" />
        )}
      </div>
      {logo === null ? null : <p className="tm-hint nv-num">{logoLine(logo)}</p>}
      {warning === null ? null : <p className="tm-warn">{warning}</p>}

      <p className="tm-hint">{LOGO_HINT}</p>
      <input
        ref={file}
        type="file"
        accept="image/png"
        hidden
        aria-label="Fichier du logo"
        onChange={(event) => {
          const picked = event.target.files?.[0];
          // Emptied, so that the same file picked again after a fix is sent again.
          event.target.value = '';
          if (picked !== undefined) void send(picked);
        }}
      />
      {refused === null ? null : (
        <p className="tm-warn nv-swap" role="alert">
          « {refused.name} » n’est pas gardé. {refusalText(refused.refusal)}
        </p>
      )}
      <div className="bf-logo-actions">
        <button
          ref={pick}
          type="button"
          className="nv-btn nv-btn--soft"
          data-autofocus
          disabled={busy || reading}
          aria-busy={reading}
          onClick={() => {
            file.current?.click();
          }}
        >
          {reading ? 'Lecture du fichier…' : logo === null ? 'Choisir un PNG' : 'Choisir un autre PNG'}
        </button>
        {logo === null ? null : (
          <button
            type="button"
            className="nv-btn nv-btn--plain"
            disabled={busy || reading}
            onClick={() => {
              setRefused(null);
              onLogo(null);
            }}
          >
            Ne pas imprimer de logo
          </button>
        )}
      </div>
    </div>
  );
}
