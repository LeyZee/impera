import type { CreatorSummary } from '@nirvana/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type JSX } from 'react';

import { UNKNOWN_ZONE, ZoneInput } from './ZoneInput';
import { moveCreator, type MoveResult } from './api';
import { Field } from './persona/fields';

import { cityOf } from '@/scheduling/time';
import { PasswordPrompt, SignInAgain } from '@/settings/services/PasswordPrompt';

/** What each refusal of `PATCH /v1/creators/:creatorId` says; her zone is unchanged on every one. */
const PROBLEMS: Record<Exclude<MoveResult['kind'], 'moved' | 'reauth'>, string> = {
  unknown_zone: UNKNOWN_ZONE,
  forbidden: 'Seul le compte propriétaire change le fuseau d’une créatrice.',
  not_found: 'Cette créatrice n’existe plus.',
  expired: 'Ta session a expiré : reconnecte-toi, puis recommence. Son fuseau n’a pas changé.',
  failed: 'Son fuseau n’a pas changé : Nirvana ne répond pas. Réessaie dans un instant.',
};

/**
 * Her zone, changed by the owner alone (the screen is the owner's): a mistake at her creation is no longer final.
 * Her hours, her quiet hours and her night are read on the new clock from the moment it is saved; nothing past is
 * computed again. A sign-in over 10 minutes old asks for the password first.
 */
export function ZoneEditor({
  creatorId,
  timeZone,
  onMoved,
}: {
  creatorId: string;
  timeZone: string;
  onMoved: (creator: CreatorSummary) => void;
}): JSX.Element {
  const id = useId();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [zone, setZone] = useState(timeZone);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const [reauth, setReauth] = useState(false);
  const [problem, setProblem] = useState<keyof typeof PROBLEMS | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Focus follows the editor: into the field when it opens, back to « Changer de fuseau » when it closes.
  const opener = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open) document.getElementById(`${id}-zone`)?.focus();
    else if (wasOpen.current) opener.current?.focus();
    wasOpen.current = open;
  }, [open, id]);

  const typed = zone.trim();
  const unchanged = typed === '' || typed === timeZone;

  async function save(): Promise<void> {
    if (unchanged || sending.current) return;
    sending.current = true;
    setBusy(true);
    setProblem(null);
    const result = await moveCreator(creatorId, typed);
    sending.current = false;
    setBusy(false);
    if (result.kind === 'moved') {
      setOpen(false);
      setNotice(
        `Fuseau changé : ${cityOf(result.creator.timezone)}. Ses heures suivent ce fuseau dès maintenant.`,
      );
      onMoved(result.creator);
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
          <p className="ps-muted">Fuseau : {cityOf(timeZone)}</p>
          <button
            ref={opener}
            type="button"
            className="nv-btn nv-btn--plain nv-btn--sm"
            onClick={() => {
              setZone(timeZone);
              setNotice(null);
              setOpen(true);
            }}
          >
            Changer de fuseau
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

  return (
    <form
      className="ps-stack"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <Field
        label="Fuseau"
        id={`${id}-zone`}
        hint="Ses heures d’activité, ses heures calmes et sa nuit suivront ce fuseau. Rien de passé n’est recalculé."
      >
        <ZoneInput
          id={`${id}-zone`}
          value={zone}
          invalid={problem === 'unknown_zone'}
          onChange={(next) => {
            setZone(next);
            setProblem(null);
          }}
        />
      </Field>
      {problem === null ? null : (
        <p className="ps-error" role="alert">
          {PROBLEMS[problem]}
        </p>
      )}
      {problem === 'expired' ? <SignInAgain /> : null}
      {reauth ? (
        <PasswordPrompt
          lead="Pour changer son fuseau, confirme ton mot de passe."
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
          disabled={unchanged || busy || reauth}
          aria-busy={busy}
        >
          {busy ? 'Enregistrement…' : 'Enregistrer le fuseau'}
        </button>
      </div>
    </form>
  );
}
