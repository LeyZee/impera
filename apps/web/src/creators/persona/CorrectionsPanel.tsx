import type { PersonaCorrection, PersonaCorrectionSection } from '@impera/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type JSX } from 'react';

import { CORRECTION_SECTION_LABELS, correctionsKey, markCorrectionDone, useCorrections } from './corrections';

const DAY = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });

/**
 * Above her persona, for the owner and a manager (recette CREA-01 b): the corrections she proposed from Moi › Persona
 * and the agency has not handled yet. Each opens the tab of its section; the owner, who alone changes her persona,
 * marks it handled once her sheet says it (or once they talked it over). Nothing shows while none waits.
 */
export function CorrectionsPanel({
  creatorId,
  creatorName,
  canMark,
  onShowSection,
}: {
  creatorId: string;
  creatorName: string | null;
  canMark: boolean;
  onShowSection: (section: PersonaCorrectionSection) => void;
}): JSX.Element | null {
  const client = useQueryClient();
  const corrections = useCorrections(creatorId);
  const [marking, setMarking] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const open = (corrections.data ?? []).filter((one) => one.state === 'open');
  if (open.length === 0) return null;

  const mark = async (one: PersonaCorrection): Promise<void> => {
    if (marking !== null) return;
    setMarking(one.id);
    setFailed(false);
    const done = await markCorrectionDone(creatorId, one.id);
    setMarking(null);
    if (done === null) {
      setFailed(true);
      return;
    }
    client.setQueryData<PersonaCorrection[]>(correctionsKey(creatorId), (before = []) =>
      before.map((other) => (other.id === done.id ? done : other)),
    );
    void client.invalidateQueries({ queryKey: correctionsKey(creatorId) });
  };

  const who = creatorName === null || creatorName.trim() === '' ? 'la créatrice' : creatorName;
  return (
    <section className="nv-plate ps-corrections" aria-labelledby="ps-corrections-title">
      <header className="ps-corrections__head">
        <h3 className="ps-corrections__title" id="ps-corrections-title">
          Corrections proposées par {who}
        </h3>
        <span className="ps-corrections__count">
          <span className="ps-dot" data-dot="warn" aria-hidden="true" />
          {open.length === 1 ? '1 à traiter' : `${String(open.length)} à traiter`}
        </span>
      </header>
      <p className="ps-muted ps-corrections__lead">
        Elle les a envoyées depuis sa fiche. Mets sa persona à jour, puis marque la correction comme traitée.
      </p>
      <ul className="ps-corrections__list">
        {open.map((one) => (
          <li key={one.id} className="ps-corrections__item">
            <div className="ps-corrections__body">
              <p className="ps-corrections__meta">
                <button
                  type="button"
                  className="ps-corrections__section"
                  onClick={() => {
                    onShowSection(one.section);
                  }}
                >
                  {CORRECTION_SECTION_LABELS[one.section].agency}
                </button>
                <span aria-hidden="true">·</span>
                <span>{`Le ${DAY.format(new Date(one.createdAt))}`}</span>
              </p>
              <p className="ps-corrections__text">{one.text}</p>
            </div>
            {canMark ? (
              <button
                type="button"
                className="nv-btn nv-btn--soft nv-btn--sm ps-corrections__done"
                aria-disabled={marking !== null ? true : undefined}
                onClick={() => {
                  void mark(one);
                }}
              >
                {marking === one.id ? 'Un instant…' : 'Traitée'}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {failed ? (
        <p className="ps-corrections__problem" role="alert">
          La correction n’a pas pu être marquée. Réessaie dans un instant.
        </p>
      ) : null}
    </section>
  );
}
