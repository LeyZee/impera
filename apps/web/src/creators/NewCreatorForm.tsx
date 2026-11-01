import { CreatorDisplayNameSchema, CreatorIdSchema, newId, type CreatorSummary } from '@nirvana/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useId, useRef, useState, type SyntheticEvent, type JSX } from 'react';

import { DEFAULT_ZONE, UNKNOWN_ZONE, ZoneInput } from './ZoneInput';
import { createCreator, type CreateResult } from './api';
import { Field } from './persona/fields';

import { SignInAgain } from '@/settings/services/PasswordPrompt';

/** What each refusal of `POST /v1/creators` says; nothing was created on any of them. */
const PROBLEMS: Record<Exclude<CreateResult['kind'], 'created'>, string> = {
  unknown_zone: UNKNOWN_ZONE,
  invalid: 'Ce nom n’est pas accepté : il lui faut au moins une lettre.',
  name_taken: 'Une créatrice porte déjà ce nom. Ajoute une initiale ou choisis un autre pseudo.',
  conflict: 'Cette créatrice vient d’être créée sous un autre nom. Recharge la page pour la voir.',
  expired: 'Ta session a expiré : reconnecte-toi, puis recommence. Rien n’a été créé.',
  failed: 'Rien n’a été créé : Nirvana ne répond pas. Réessaie dans un instant.',
};

/**
 * Adds a creator (owner only): her name as fans see it and the zone her day and night follow. Her persona is
 * written next, starting from the example.
 */
export function NewCreatorForm({
  onCreated,
  onCancel,
}: {
  onCreated: (creator: CreatorSummary) => void;
  /** Null when there is nothing to go back to (no creator yet). */
  onCancel: (() => void) | null;
}): JSX.Element {
  const id = useId();
  const client = useQueryClient();
  const [name, setName] = useState('');
  const [zone, setZone] = useState(DEFAULT_ZONE);
  const [busy, setBusy] = useState(false);
  // A second click lands before the re-render that disables the button: the ref stops it, the id makes it harmless.
  const sending = useRef(false);
  const [creatorId, setCreatorId] = useState(() => newId(CreatorIdSchema));
  const [problem, setProblem] = useState<keyof typeof PROBLEMS | null>(null);

  // The server refuses a name without a letter (an invisible character or punctuation alone): said before sending.
  const noLetter = name.trim() !== '' && !CreatorDisplayNameSchema.safeParse(name).success;
  const nameRefused = problem === 'name_taken' || problem === 'invalid';

  const submit = async (event: SyntheticEvent): Promise<void> => {
    event.preventDefault();
    if (name.trim() === '' || noLetter || sending.current) return;
    sending.current = true;
    setBusy(true);
    setProblem(null);
    const result = await createCreator(creatorId, name.trim(), zone.trim()).catch(() => ({
      kind: 'failed' as const,
    }));
    sending.current = false;
    setBusy(false);
    if (result.kind === 'created') {
      // The next creator typed in this form is another one: a new id.
      setCreatorId(newId(CreatorIdSchema));
      await client.invalidateQueries({ queryKey: ['creators'] });
      onCreated(result.creator);
    } else {
      setProblem(result.kind);
    }
  };

  return (
    <form
      className="nv-plate ps-head"
      onSubmit={(event) => {
        void submit(event);
      }}
    >
      <p className="ps-title">Nouvelle créatrice</p>
      <Field label="Prénom ou pseudo" id={`${id}-name`} hint="Celui que voient ses fans.">
        <input
          id={`${id}-name`}
          className="nv-glass nv-field__control ps-input"
          value={name}
          maxLength={80}
          autoFocus
          aria-invalid={noLetter || nameRefused}
          aria-describedby={noLetter ? `${id}-name-error` : nameRefused ? `${id}-problem` : undefined}
          onChange={(event) => {
            setName(event.target.value);
            // The refusal was about the name: typing another one answers it.
            if (problem === 'name_taken' || problem === 'invalid') setProblem(null);
          }}
        />
        {noLetter ? (
          <p className="ps-error" id={`${id}-name-error`}>
            Le nom doit contenir au moins une lettre.
          </p>
        ) : null}
      </Field>
      <Field label="Fuseau horaire" id={`${id}-zone`} hint="Sa journée et sa nuit suivent ce fuseau.">
        <ZoneInput id={`${id}-zone`} value={zone} onChange={setZone} invalid={problem === 'unknown_zone'} />
      </Field>
      {problem === null ? null : (
        <p className="ps-error" role="alert" id={`${id}-problem`}>
          {PROBLEMS[problem]}
        </p>
      )}
      {problem === 'expired' ? <SignInAgain /> : null}
      <div className="ps-head__actions">
        {onCancel === null ? null : (
          <button type="button" className="nv-btn nv-btn--plain nv-btn--sm" onClick={onCancel}>
            Annuler
          </button>
        )}
        <button
          type="submit"
          className="nv-btn nv-btn--neon"
          disabled={name.trim() === '' || noLetter || busy}
          aria-busy={busy}
        >
          {busy ? 'Création…' : 'Créer'}
        </button>
      </div>
    </form>
  );
}
