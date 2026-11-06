import { CreatorDisplayNameSchema, type CreatorSummary } from '@impera/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type JSX } from 'react';

import { renameCreator, type RenameResult } from '../api';
import { Field } from '../persona/fields';

import { PasswordPrompt, SignInAgain } from '@/settings/services/PasswordPrompt';

/** What each refusal of `PATCH /v1/creators/:creatorId` says; her name is unchanged on every one. */
const PROBLEMS: Record<Exclude<RenameResult['kind'], 'renamed' | 'reauth'>, string> = {
  invalid: 'Ce nom n’est pas accepté : il lui faut au moins une lettre.',
  name_taken: 'Une créatrice porte déjà ce nom. Ajoute une initiale ou choisis un autre pseudo.',
  forbidden: 'Seul le compte propriétaire renomme une créatrice.',
  not_found: 'Cette créatrice n’existe plus.',
  expired: 'Ta session a expiré : reconnecte-toi, puis recommence. Son nom n’a pas changé.',
  failed: 'Son nom n’a pas changé : Impera ne répond pas. Réessaie dans un instant.',
};

/**
 * Her name, changed by the owner alone (ADR 0071 § 1): a typo at her creation is no longer final. Only the name
 * everyone reads in Impera changes, never her Reveal handle nor her persona. A sign-in over 10 minutes old asks for the
 * password first.
 */
export function NameEditor({
  creatorId,
  displayName,
  onRenamed,
}: {
  creatorId: string;
  displayName: string;
  onRenamed?: (creator: CreatorSummary) => void;
}): JSX.Element {
  const id = useId();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(displayName);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const [reauth, setReauth] = useState(false);
  const [problem, setProblem] = useState<keyof typeof PROBLEMS | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Focus follows the editor: into the field when it opens, back to « Renommer » when it closes.
  const opener = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open) document.getElementById(`${id}-name`)?.focus();
    else if (wasOpen.current) opener.current?.focus();
    wasOpen.current = open;
  }, [open, id]);

  const typed = name.trim();
  const unchanged = typed === '' || typed === displayName;
  // The server refuses a name without a letter: said before sending.
  const noLetter = typed !== '' && !CreatorDisplayNameSchema.safeParse(typed).success;

  async function save(): Promise<void> {
    if (unchanged || noLetter || sending.current) return;
    sending.current = true;
    setBusy(true);
    setProblem(null);
    const result = await renameCreator(creatorId, typed);
    sending.current = false;
    setBusy(false);
    if (result.kind === 'renamed') {
      setOpen(false);
      setNotice(
        `Renommée : ${result.creator.displayName}. Son pseudo Reveal et sa persona n’ont pas changé.`,
      );
      onRenamed?.(result.creator);
      await client.invalidateQueries({ queryKey: ['creators'] });
    } else if (result.kind === 'reauth') {
      setReauth(true);
    } else {
      setProblem(result.kind);
    }
  }

  if (!open) {
    return (
      <div className="ps-stack">
        <div className="ps-head__actions">
          <p className="ps-muted">Nom : {displayName}</p>
          <button
            ref={opener}
            type="button"
            className="nv-btn nv-btn--plain nv-btn--sm"
            onClick={() => {
              setName(displayName);
              setNotice(null);
              setOpen(true);
            }}
          >
            Renommer
          </button>
        </div>
        {notice === null ? null : (
          <p className="ps-muted" role="status">
            {notice}
          </p>
        )}
      </div>
    );
  }

  const nameRefused = noLetter || problem === 'name_taken' || problem === 'invalid';
  return (
    <form
      className="ps-stack"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <Field
        label="Prénom ou pseudo"
        id={`${id}-name`}
        hint="Celui que lit toute l’équipe dans Impera. Son pseudo Reveal et sa persona ne changent pas."
      >
        <input
          id={`${id}-name`}
          className="nv-glass nv-field__control ps-input"
          value={name}
          maxLength={80}
          aria-invalid={nameRefused}
          aria-describedby={noLetter ? `${id}-no-letter` : undefined}
          onChange={(event) => {
            setName(event.target.value);
            setProblem(null);
          }}
        />
      </Field>
      {noLetter ? (
        <p className="ps-error" id={`${id}-no-letter`}>
          Le nom doit contenir au moins une lettre.
        </p>
      ) : null}
      {problem === null ? null : (
        <p className="ps-error" role="alert">
          {PROBLEMS[problem]}
        </p>
      )}
      {problem === 'expired' ? <SignInAgain /> : null}
      {reauth ? (
        <PasswordPrompt
          lead="Pour la renommer, confirme ton mot de passe et ton code."
          onConfirmed={() => {
            setReauth(false);
            void save();
          }}
          onCancel={() => {
            setReauth(false);
          }}
        />
      ) : null}
      <div className="ps-head__actions">
        <button
          type="button"
          className="nv-btn nv-btn--plain nv-btn--sm"
          disabled={busy}
          onClick={() => {
            setOpen(false);
            setProblem(null);
            setReauth(false);
          }}
        >
          Annuler
        </button>
        <button
          type="submit"
          className="nv-btn nv-btn--soft nv-btn--sm"
          disabled={unchanged || noLetter || busy || reauth}
          aria-busy={busy}
        >
          {busy ? 'Enregistrement…' : 'Enregistrer le nom'}
        </button>
      </div>
    </form>
  );
}
