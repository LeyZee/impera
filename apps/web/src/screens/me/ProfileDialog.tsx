import {
  AGENCY_LEGAL_FORM_MAX,
  BILLING_EMAIL_MAX,
  LEGAL_NAME_MAX,
  POSTAL_ADDRESS_MAX,
  RCS_CITY_MAX,
  TAX_ID_MAX,
  type ContractorFile,
} from '@impera/contracts';
import { useId, useState, type JSX, type ReactNode, type SyntheticEvent } from 'react';

import { Refusal, useFileSend } from './FileParts';

import { saveProfile } from '@/contractors/api';
import {
  isFrench,
  profileBodyOf,
  profileDraftOf,
  profileFields,
  profileProblems,
  suggestedVat,
  type ContractorStatus,
  type ProfileDraft,
  type ProfileField,
} from '@/contractors/model';
import { countryName } from '@/lib/country';
import { useGrowingArea } from '@/lib/growing-area';
import { Dialog } from '@/shell/Dialog';

const STATUSES: readonly (readonly [ContractorStatus, string])[] = [
  ['individual', 'Entrepreneur individuel'],
  ['company', 'Société'],
];

const LABELS: Readonly<Record<ProfileField, string>> = {
  legalName: 'Nom',
  address: 'Adresse',
  taxId: 'Identifiant fiscal',
  businessId: 'SIREN ou SIRET',
  vatNumber: 'N° de TVA intracommunautaire',
  legalForm: 'Forme de la société',
  shareCapital: 'Capital social',
  rcsCity: 'Ville du RCS',
  email: 'E-mail des factures',
};

const MAX: Readonly<Record<ProfileField, number>> = {
  legalName: LEGAL_NAME_MAX,
  address: POSTAL_ADDRESS_MAX,
  taxId: TAX_ID_MAX,
  businessId: 20,
  vatNumber: 20,
  legalForm: AGENCY_LEGAL_FORM_MAX,
  shareCapital: 20,
  rcsCity: RCS_CITY_MAX,
  email: BILLING_EMAIL_MAX,
};

/** What each field says under it until it is tried: what the invoice prints from it. */
function hintOf(field: ProfileField, draft: ProfileDraft, taxIdRequired: boolean): string | undefined {
  switch (field) {
    case 'legalName':
      return draft.status === 'company'
        ? 'La raison sociale, telle que sur le Kbis.'
        : draft.status === 'individual'
          ? 'Ton nom et ton prénom : la facture ajoute « EI » après.'
          : 'Ton nom et ton prénom, tels que sur ta pièce d’identité.';
    case 'address':
      return 'Imprimée sur chaque facture, ligne par ligne.';
    case 'taxId':
      return taxIdRequired
        ? 'Ton régime le demande. Au Bénin, ton IFU.'
        : 'Facultatif sous ton régime. Au Bénin, ton IFU.';
    case 'vatNumber':
      return 'Seulement si tu factures la TVA.';
    case 'email':
      return 'Là où tu reçois tes factures.';
    case 'businessId':
    case 'legalForm':
    case 'shareCapital':
    case 'rcsCity':
      return undefined;
  }
}

/**
 * The contractor fills his own file: who his invoices are in the name of. Any change of identity goes back through
 * the owner's check before his next invoice; the server checks the SIREN and the VAT number again.
 */
export function ProfileDialog({
  file,
  taxIdRequired,
  onClose,
}: {
  file: ContractorFile;
  /** The regime in force asks for his tax identifier. */
  taxIdRequired: boolean;
  onClose: () => void;
}): JSX.Element {
  const id = useId();
  const { busy, refusal, send } = useFileSend(onClose);
  const [draft, setDraft] = useState<ProfileDraft>(() => profileDraftOf(file.profile, file.country));
  const [tried, setTried] = useState(false);
  const addressArea = useGrowingArea(draft.address);
  const french = isFrench(file.country);
  const fields = profileFields(draft, file.country);
  const problems = tried ? profileProblems(draft, file.country, taxIdRequired) : {};
  const vat = suggestedVat(draft);

  const set = (field: ProfileField) => (value: string) => {
    setDraft((before) => ({ ...before, [field]: value }));
  };

  const submit = (event: SyntheticEvent): void => {
    event.preventDefault();
    setTried(true);
    if (busy) return;
    const body = profileBodyOf(draft, file.country, taxIdRequired);
    if (body === null) {
      // The first wrong field takes the focus, after the render that marks it.
      requestAnimationFrame(() => {
        document.querySelector<HTMLElement>('.cf-profile [aria-invalid="true"]')?.focus();
      });
      return;
    }
    send(() => saveProfile(file.memberId, body));
  };

  return (
    <Dialog
      title={file.profile === null ? 'Remplir ton dossier' : 'Modifier ton dossier'}
      lead={`Tes factures sont émises à ce nom. Pays : ${countryName(file.country)}, celui de ta fiche.`}
      busy={busy}
      className="cf-profile"
      onClose={onClose}
    >
      <form className="tm-dialog__body" noValidate onSubmit={submit}>
        {french ? (
          <div className="nv-field tm-field">
            <span className="nv-field__label" id={`${id}-status`}>
              Tu factures comme
            </span>
            <div className="tm-choices" role="radiogroup" aria-labelledby={`${id}-status`}>
              {STATUSES.map(([one, label]) => (
                <button
                  key={one}
                  type="button"
                  role="radio"
                  className="nv-chip"
                  aria-checked={draft.status === one}
                  onClick={() => {
                    setDraft((before) => ({ ...before, status: one }));
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {fields.map((field) => (
          <Field
            key={field}
            id={`${id}-${field}`}
            label={LABELS[field]}
            hint={hintOf(field, draft, taxIdRequired)}
            problem={problems[field]}
            after={
              field === 'vatNumber' && vat !== null ? (
                <button
                  type="button"
                  className="nv-btn nv-btn--plain nv-btn--sm"
                  onClick={() => {
                    set('vatNumber')(vat);
                  }}
                >
                  Prendre {vat}
                </button>
              ) : null
            }
          >
            {field === 'address' ? (
              <textarea
                ref={addressArea}
                id={`${id}-${field}`}
                className="nv-field__control nv-glass grow-area"
                rows={3}
                maxLength={MAX[field]}
                value={draft[field]}
                autoComplete="street-address"
                aria-invalid={problems[field] !== undefined}
                aria-describedby={`${id}-${field}-hint`}
                data-autofocus={file.profile === null ? undefined : true}
                onChange={(event) => {
                  set(field)(event.target.value);
                }}
              />
            ) : (
              <input
                id={`${id}-${field}`}
                className={
                  field === 'businessId' || field === 'vatNumber' || field === 'shareCapital'
                    ? 'nv-field__control nv-glass nv-num'
                    : 'nv-field__control nv-glass'
                }
                type={field === 'email' ? 'email' : 'text'}
                inputMode={field === 'businessId' || field === 'shareCapital' ? 'numeric' : undefined}
                maxLength={MAX[field]}
                value={draft[field]}
                autoComplete={field === 'email' ? 'email' : field === 'legalName' ? 'name' : 'off'}
                aria-invalid={problems[field] !== undefined}
                aria-describedby={`${id}-${field}-hint`}
                data-autofocus={file.profile === null && field === 'legalName' ? true : undefined}
                onChange={(event) => {
                  set(field)(event.target.value);
                }}
              />
            )}
          </Field>
        ))}
        {file.profile?.verifiedAt == null ? null : (
          <p className="tm-hint">
            Un changement repasse par la vérification du propriétaire avant ta prochaine facture.
          </p>
        )}
        <Refusal refusal={refusal} />
        <div className="tm-dialog__foot">
          <button type="button" className="nv-btn nv-btn--plain" disabled={busy} onClick={onClose}>
            Annuler
          </button>
          <button type="submit" className="nv-btn nv-btn--neon" disabled={busy} aria-busy={busy}>
            {busy ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function Field({
  id,
  label,
  hint,
  problem,
  after,
  children,
}: {
  id: string;
  label: string;
  hint: string | undefined;
  problem: string | undefined;
  after: ReactNode;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="nv-field tm-field" data-invalid={problem === undefined ? undefined : 'true'}>
      <label className="nv-field__label" htmlFor={id}>
        {label}
      </label>
      {children}
      <p id={`${id}-hint`} className={problem === undefined ? 'tm-hint' : 'tm-hint tm-hint--error'}>
        {problem ?? hint}
      </p>
      {after}
    </div>
  );
}
