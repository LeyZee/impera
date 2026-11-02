import {
  CONTRACTOR_DOCUMENT_KINDS,
  INVOICE_MENTION_MAX,
  INVOICE_MENTIONS_MAX,
  REGIME_NAME_MAX,
} from '@nirvana/contracts';
import { useId, useState, type JSX, type SyntheticEvent } from 'react';

import { addRegime, useRefreshPayroll } from './api';
import {
  EMPTY_REGIME,
  VAT_CHOICES,
  regimeBodyOf,
  residenceWithoutTreatyText,
  showsResidenceWithoutTreaty,
  withDocument,
  withWithholding,
  type RegimeDraft,
} from './regimes';

import { DOCUMENT_NAMES } from '@/contractors/model';
import type { InvoiceRefusal } from '@/invoices/api';
import { invoiceRefusalText } from '@/invoices/model';
import { countryFlag, countryName } from '@/lib/country';
import { Dialog } from '@/screens/team/Dialog';
import { FIRST_COUNTRIES, OTHER_COUNTRIES } from '@/screens/team/model';

/** What the code prints on every invoice already: a regime's mentions never say it again. */
export const PRINTED_BY_CODE =
  'Le texte d’un régime ne répète pas ce que le code imprime déjà : le badge « Autofacturation », le mandat, la catégorie de l’opération, la TVA et l’échéance.';

/**
 * A new billing regime (EQ-06 lot 8c), as the agency's accountant wrote it, for one country or more. Never changed once
 * written: a new text is a new regime, given to each contractor from a day on. Its key is drawn again at each change,
 * so that a retry sends the same regime under the same key.
 */
export function RegimeDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const id = useId();
  const refresh = useRefreshPayroll();
  const [draft, setDraft] = useState<RegimeDraft>(EMPTY_REGIME);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<InvoiceRefusal | null>(null);
  const checked = regimeBodyOf(draft, key);
  const problems = tried && !checked.ok ? checked.problems : {};
  const change = (next: RegimeDraft): void => {
    setDraft(next);
    setKey(crypto.randomUUID());
  };

  const submit = async (event: SyntheticEvent): Promise<void> => {
    event.preventDefault();
    setTried(true);
    if (!checked.ok || busy) return;
    setBusy(true);
    setRefusal(null);
    const outcome = await addRegime(checked.body);
    setBusy(false);
    if (outcome.kind === 'ok') {
      await refresh();
      onClose();
      return;
    }
    setRefusal(outcome);
  };

  const hint = (field: keyof typeof problems, quiet: string): JSX.Element => (
    <p
      id={`${id}-${field}-hint`}
      className={problems[field] === undefined ? 'tm-hint' : 'tm-hint tm-hint--error'}
    >
      {problems[field] ?? quiet}
    </p>
  );
  const invalid = (field: keyof typeof problems): 'true' | undefined =>
    problems[field] === undefined ? undefined : 'true';
  const treaty = draft.withholding === 'treaty_exempt';

  return (
    <Dialog
      title="Nouveau régime"
      lead="Tel que ton comptable l’a écrit. Une fois écrit, un régime ne change plus : un nouveau texte est un nouveau régime, attribué à partir d’un jour."
      busy={busy}
      className="bf-regime-dialog"
      onClose={onClose}
    >
      <form className="tm-dialog__body" noValidate onSubmit={(event) => void submit(event)}>
        <div className="nv-field tm-field" data-invalid={invalid('name')}>
          <label className="nv-field__label" htmlFor={`${id}-name`}>
            Nom
          </label>
          <input
            id={`${id}-name`}
            className="nv-field__control nv-glass"
            maxLength={REGIME_NAME_MAX}
            value={draft.name}
            autoComplete="off"
            aria-invalid={problems.name !== undefined}
            aria-describedby={`${id}-name-hint`}
            onChange={(event) => {
              change({ ...draft, name: event.target.value });
            }}
          />
          {hint('name', 'Celui que le comptable lui donne, par exemple « Prestataire Bénin ».')}
        </div>

        <fieldset className="nv-field tm-field bf-fieldset" data-invalid={invalid('countries')}>
          <legend className="nv-field__label">Pays</legend>
          {draft.countries.length === 0 ? null : (
            <ul className="bf-countries" aria-label="Pays du régime">
              {draft.countries.map((code) => (
                <li key={code} className="bf-country">
                  <span>{`${countryFlag(code)}  ${countryName(code)}`}</span>
                  <button
                    type="button"
                    className="nv-btn nv-btn--plain nv-btn--sm"
                    aria-label={`Retirer ${countryName(code)}`}
                    onClick={() => {
                      change({ ...draft, countries: draft.countries.filter((one) => one !== code) });
                    }}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
          <label className="sr-only" htmlFor={`${id}-country`}>
            Ajouter un pays
          </label>
          <select
            id={`${id}-country`}
            className="nv-field__control nv-glass tm-select"
            value=""
            aria-describedby={`${id}-countries-hint`}
            onChange={(event) => {
              const code = event.target.value;
              if (code !== '' && !draft.countries.includes(code))
                change({ ...draft, countries: [...draft.countries, code] });
            }}
          >
            <option value="">Ajouter un pays…</option>
            <optgroup label="Les plus fréquents">
              {FIRST_COUNTRIES.filter((code) => !draft.countries.includes(code)).map((code) => (
                <option key={code} value={code}>
                  {`${countryFlag(code)}  ${countryName(code)}`}
                </option>
              ))}
            </optgroup>
            <optgroup label="Tous les pays">
              {OTHER_COUNTRIES.filter((one) => !draft.countries.includes(one.code)).map((one) => (
                <option key={one.code} value={one.code}>
                  {`${countryFlag(one.code)}  ${one.name}`}
                </option>
              ))}
            </optgroup>
          </select>
          {hint('countries', 'Chaque prestataire reçoit un régime de son pays.')}
        </fieldset>

        <fieldset className="nv-field tm-field bf-fieldset" data-invalid={invalid('rate')}>
          <legend className="nv-field__label">TVA</legend>
          <div className="bf-choices">
            {VAT_CHOICES.map((choice) => (
              <label key={choice.value} className="bf-choice">
                <input
                  type="radio"
                  name={`${id}-vat`}
                  value={choice.value}
                  checked={draft.vat === choice.value}
                  onChange={() => {
                    change({ ...draft, vat: choice.value });
                  }}
                />
                <span>
                  <span className="bf-choice__label">{choice.label}</span>
                  <span className="bf-choice__hint">{choice.hint}</span>
                </span>
              </label>
            ))}
          </div>
          {draft.vat === 'exempt' ? null : (
            <>
              <label className="nv-field__label" htmlFor={`${id}-rate`}>
                Taux
              </label>
              <div className="bf-days">
                <input
                  id={`${id}-rate`}
                  className="nv-field__control nv-glass nv-num"
                  inputMode="decimal"
                  autoComplete="off"
                  value={draft.rate}
                  aria-invalid={problems.rate !== undefined}
                  aria-describedby={`${id}-rate-hint`}
                  onChange={(event) => {
                    change({ ...draft, rate: event.target.value });
                  }}
                />
                <span>%</span>
              </div>
              {hint('rate', 'Celui que le comptable donne.')}
            </>
          )}
        </fieldset>

        <fieldset className="nv-field tm-field bf-fieldset">
          <legend className="nv-field__label">Retenue à la source (art. 182 B du CGI)</legend>
          <div className="bf-choices">
            <label className="bf-choice">
              <input
                type="radio"
                name={`${id}-withholding`}
                checked={treaty}
                onChange={() => {
                  change(withWithholding(draft, 'treaty_exempt'));
                }}
              />
              <span>
                <span className="bf-choice__label">Écartée par la convention fiscale</span>
                <span className="bf-choice__hint">
                  Le versement attend l’attestation de résidence fiscale de l’année du virement.
                </span>
              </span>
            </label>
            <label className="bf-choice">
              <input
                type="radio"
                name={`${id}-withholding`}
                checked={!treaty}
                onChange={() => {
                  change(withWithholding(draft, 'none'));
                }}
              />
              <span>
                <span className="bf-choice__label">Pas due</span>
                <span className="bf-choice__hint">Un prestataire établi en France, par exemple.</span>
              </span>
            </label>
          </div>
        </fieldset>

        <fieldset className="nv-field tm-field bf-fieldset" data-invalid={invalid('documents')}>
          <legend className="nv-field__label">Pièces demandées</legend>
          <div className="bf-choices">
            {CONTRACTOR_DOCUMENT_KINDS.map((kind) => {
              const locked = kind === 'tax_residence' && treaty;
              return (
                <label key={kind} className="bf-choice">
                  <input
                    type="checkbox"
                    checked={draft.documents.includes(kind)}
                    disabled={locked}
                    onChange={(event) => {
                      change(withDocument(draft, kind, event.target.checked));
                    }}
                  />
                  <span>
                    <span className="bf-choice__label">{DOCUMENT_NAMES[kind]}</span>
                    {locked ? (
                      <span className="bf-choice__hint">
                        Exigée sous convention : sans l’attestation de l’année, le versement attend.
                      </span>
                    ) : null}
                  </span>
                </label>
              );
            })}
            <label className="bf-choice">
              <input
                type="checkbox"
                checked={draft.taxIdRequired}
                onChange={(event) => {
                  change({ ...draft, taxIdRequired: event.target.checked });
                }}
              />
              <span>
                <span className="bf-choice__label">Identifiant fiscal exigé</span>
                <span className="bf-choice__hint">Sans lui, la facture ne part pas.</span>
              </span>
            </label>
          </div>
          {problems.documents === undefined ? null : hint('documents', '')}
          {showsResidenceWithoutTreaty(draft) ? (
            <p className="tm-hint cf-amber">{residenceWithoutTreatyText}</p>
          ) : null}
        </fieldset>

        <fieldset className="nv-field tm-field bf-fieldset" data-invalid={invalid('mentions')}>
          <legend className="nv-field__label">Mentions imprimées</legend>
          <p className="tm-hint">{PRINTED_BY_CODE}</p>
          <ol className="bf-mentions">
            {draft.mentions.map((mention, index) => (
              <li key={index} className="bf-mention">
                <label className="sr-only" htmlFor={`${id}-mention-${String(index)}`}>
                  {`Mention ${String(index + 1)}`}
                </label>
                <textarea
                  id={`${id}-mention-${String(index)}`}
                  className="nv-field__control nv-glass"
                  rows={2}
                  maxLength={INVOICE_MENTION_MAX}
                  value={mention}
                  onChange={(event) => {
                    change({
                      ...draft,
                      mentions: draft.mentions.map((one, at) => (at === index ? event.target.value : one)),
                    });
                  }}
                />
                <button
                  type="button"
                  className="nv-btn nv-btn--plain nv-btn--sm"
                  aria-label={`Retirer la mention ${String(index + 1)}`}
                  disabled={draft.mentions.length === 1}
                  onClick={() => {
                    change({ ...draft, mentions: draft.mentions.filter((_one, at) => at !== index) });
                  }}
                >
                  ×
                </button>
              </li>
            ))}
          </ol>
          {draft.mentions.length >= INVOICE_MENTIONS_MAX ? null : (
            <button
              type="button"
              className="nv-btn nv-btn--soft nv-btn--sm tm-self-start"
              onClick={() => {
                change({ ...draft, mentions: [...draft.mentions, ''] });
              }}
            >
              Ajouter une mention
            </button>
          )}
          {problems.mentions === undefined ? null : hint('mentions', '')}
        </fieldset>

        {refusal === null ? null : (
          <p className="tm-warn sc-refusal nv-swap" role="alert">
            {invoiceRefusalText(refusal)}
          </p>
        )}
        <div className="tm-dialog__foot">
          <button type="button" className="nv-btn nv-btn--plain" disabled={busy} onClick={onClose}>
            Annuler
          </button>
          <button type="submit" className="nv-btn nv-btn--neon" disabled={busy} aria-busy={busy}>
            {busy ? 'Envoi…' : 'Écrire ce régime'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
