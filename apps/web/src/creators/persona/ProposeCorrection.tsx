import {
  newId,
  PERSONA_CORRECTION_TEXT_MAX,
  PersonaCorrectionIdSchema,
  type PersonaCorrection,
  type PersonaCorrectionSection,
} from '@impera/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type JSX } from 'react';

import { correctionsKey, proposeCorrection } from './corrections';

const DAY = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });

/** A handled correction still shows this long under its section, so that she sees it was taken. */
const DONE_SHOWN_MS = 14 * 24 * 60 * 60 * 1000;

/** Hers under one section: the open ones, and those handled lately. */
export function sectionCorrections(
  all: readonly PersonaCorrection[],
  section: PersonaCorrectionSection,
  now: number = Date.now(),
): PersonaCorrection[] {
  return all.filter(
    (one) =>
      one.section === section &&
      (one.state === 'open' || (one.doneAt !== null && now - Date.parse(one.doneAt) < DONE_SHOWN_MS)),
  );
}

const PROBLEMS = {
  limited:
    'Beaucoup de corrections attendent déjà l’agence. Elle les lit, puis tu pourras en envoyer d’autres.',
  expired: 'Ta session a expiré. Reconnecte-toi pour envoyer ta correction.',
  failed: 'Ta correction ne part pas. Réessaie dans un instant.',
} as const;

/**
 * The foot of a block of her sheet (recette CREA-01 b): what she already proposed there, and « Proposer une
 * correction », a few sentences sent to the agency, who changes her sheet. She never edits the sheet itself.
 */
export function ProposeCorrection({
  creatorId,
  section,
  title,
  corrections,
}: {
  creatorId: string;
  section: PersonaCorrectionSection;
  /** The block's title, for the field's name read aloud. */
  title: string;
  corrections: readonly PersonaCorrection[];
}): JSX.Element {
  const client = useQueryClient();
  const fieldId = useId();
  const opener = useRef<HTMLButtonElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  // Chosen once per form: sent twice, the server keeps one.
  const [id, setId] = useState(() => newId(PersonaCorrectionIdSchema));
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<keyof typeof PROBLEMS | null>(null);
  const [sent, setSent] = useState(false);
  const shown = sectionCorrections(corrections, section);
  const empty = text.trim() === '';
  /** Set by closing the form: the button it gave way to takes the focus back once it is there again. */
  const returning = useRef(false);
  // Opened by her tap, the field is where she types; closed, she is back on the button.
  useEffect(() => {
    if (open) field.current?.focus();
    else if (returning.current) opener.current?.focus();
    returning.current = false;
  }, [open]);

  /** Closes the form; `keep` leaves what she typed for when she opens it again (Échap), else it starts afresh. */
  const close = (keep = false): void => {
    setOpen(false);
    setProblem(null);
    if (!keep) {
      setText('');
      setId(newId(PersonaCorrectionIdSchema));
    }
    returning.current = true;
  };

  const send = async (): Promise<void> => {
    if (sending || empty) return;
    setSending(true);
    setProblem(null);
    const result = await proposeCorrection(creatorId, id, section, text.trim());
    setSending(false);
    if (result.kind !== 'sent') {
      setProblem(result.kind);
      return;
    }
    client.setQueryData<PersonaCorrection[]>(correctionsKey(creatorId), (before = []) => [
      result.correction,
      ...before.filter((one) => one.id !== result.correction.id),
    ]);
    void client.invalidateQueries({ queryKey: correctionsKey(creatorId) });
    setSent(true);
    close();
  };

  return (
    <div className="mp-correct">
      {shown.length > 0 ? (
        <ul className="mp-correct__list" aria-label={`Tes corrections : ${title}`}>
          {shown.map((one) => (
            <li key={one.id} className="mp-correct__item">
              <p className="mp-correct__text">{one.text}</p>
              <p className="mp-correct__meta">
                <span
                  className="ps-dot"
                  data-dot={one.state === 'done' ? 'ok' : undefined}
                  aria-hidden="true"
                />
                {one.state === 'done' && one.doneAt !== null
                  ? `Prise en compte le ${DAY.format(new Date(one.doneAt))}`
                  : `Envoyée le ${DAY.format(new Date(one.createdAt))} · l’agence la lit`}
              </p>
            </li>
          ))}
        </ul>
      ) : null}

      <p className="sr-only" aria-live="polite">
        {sent ? 'Ta correction est envoyée à l’agence.' : ''}
      </p>

      {open ? (
        <form
          className="mp-correct__form"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <label className="nv-field" htmlFor={fieldId}>
            <span className="nv-field__label">Ce qui ne te ressemble pas</span>
            <textarea
              id={fieldId}
              ref={field}
              className="nv-field__control nv-glass mp-correct__field"
              rows={3}
              maxLength={PERSONA_CORRECTION_TEXT_MAX}
              placeholder="Par exemple : je ne bois plus de café, plutôt du thé."
              value={text}
              onChange={(event) => {
                setText(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') close(true);
              }}
            />
          </label>
          <p className="mp-correct__hint">
            L’agence met ta fiche à jour.
            <span className="mp-correct__count">
              {text.length} / {PERSONA_CORRECTION_TEXT_MAX}
            </span>
          </p>
          {problem === null ? null : (
            <p className="mp-correct__problem" role="alert">
              {PROBLEMS[problem]}
            </p>
          )}
          <div className="mp-correct__actions">
            <button
              type="button"
              className="nv-btn nv-btn--plain"
              onClick={() => {
                close();
              }}
            >
              Annuler
            </button>
            <button
              type="submit"
              className="nv-btn nv-btn--neon"
              aria-disabled={empty || sending ? true : undefined}
            >
              {sending ? 'Envoi…' : 'Envoyer à l’agence'}
            </button>
          </div>
        </form>
      ) : (
        <button
          ref={opener}
          type="button"
          className="nv-btn nv-btn--soft nv-btn--sm mp-correct__open"
          onClick={() => {
            setSent(false);
            setOpen(true);
          }}
        >
          Proposer une correction
        </button>
      )}
    </div>
  );
}
