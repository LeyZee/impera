import {
  LANGUAGES,
  PERSONA_OPTIONS,
  PERSONA_SHEET,
  type CreatorId,
  type PersonaCorrection,
  type PersonaSheet,
  type SheetQuestion,
  type SheetSection,
} from '@impera/contracts';
import type { JSX } from 'react';

import { useCreators, useMyPersona } from './api';
import { herLabel, rubricsOf } from './my-persona';
import { ProposeCorrection } from './persona/ProposeCorrection';
import { useCorrections } from './persona/corrections';
import { panelTitle, type Answer } from './persona/model';
import { ageLine } from './persona/sheet';

import '@/creators/persona/persona.css';
import './my-persona.css';
import { MeNav } from '@/screens/me/MeNav';
import { Page, PageHeader } from '@/shell/layout';
import { Failure } from '@/shell/states';

const languageLabel = (value: string): string =>
  PERSONA_OPTIONS.languages.find((option) => option.value === value)?.label ?? value;

/** What each panel needs to show her corrections and take a new one (recette CREA-01 b). */
interface Correcting {
  readonly creatorId: CreatorId;
  readonly corrections: readonly PersonaCorrection[];
}

/**
 * One answer as she reads it, or `null` when nothing is written (the line is then left out). Her age, never her date
 * of birth written back to her; her time zone is not in her sheet, and not shown here.
 */
function answerOf(question: SheetQuestion, value: Answer | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    const known = value.filter((one) => LANGUAGES.some((language) => language === one));
    return known.length === 0 ? null : known.map(languageLabel).join(', ');
  }
  if (typeof value === 'number') {
    const shown = value.toLocaleString('fr-FR');
    return question.key === 'height_m' ? `${shown} m` : question.key === 'weight_kg' ? `${shown} kg` : shown;
  }
  if (typeof value !== 'string' || value.trim() === '') return null;
  return question.kind === 'date' ? (ageLine(value)?.replace(' aujourd’hui', '') ?? null) : value;
}

/** An answer as she reads it: cut on its rubrics in capitals when it has some, each under its own title (CRE-03). */
function Value({ value }: { value: string }): JSX.Element {
  const rubrics = rubricsOf(value);
  if (rubrics === null) return <>{value}</>;
  return (
    <dl className="mp-rubrics">
      {rubrics.map((rubric, index) => (
        <div key={`${String(index)}-${rubric.title ?? ''}`} className="mp-rubrics__one">
          {rubric.title === null ? null : <dt>{rubric.title}</dt>}
          <dd>{rubric.text}</dd>
        </div>
      ))}
    </dl>
  );
}

/** « 4 réponses », what a folded panel holds without opening it. */
const answersLine = (count: number): string =>
  count === 0 ? 'Rien d’écrit pour l’instant.' : count === 1 ? '1 réponse' : `${String(count)} réponses`;

/**
 * A panel of her sheet, Desirali's title over the lines written, as a list of terms (label, then value), so that a
 * half-filled sheet never reads « rien d'écrit » ten times over (Extension's review of #531). Folded, with what it holds
 * on its line, the first panel open (recette visuelle 16/11, CRE-03): her sheet reads as sections, not a wall of
 * text. « Proposer une correction » at its foot, inside the fold.
 */
function Panel({
  section,
  sheet,
  correcting,
  open,
}: {
  section: SheetSection;
  sheet: PersonaSheet;
  correcting: Correcting;
  open: boolean;
}): JSX.Element {
  const title = panelTitle(section.key);
  const answers: Readonly<Record<string, Answer>> = sheet[section.key];
  const written = section.questions.flatMap((question) => {
    if (question.kind === 'timezone') return [];
    const value = answerOf(question, answers[question.key]);
    return value === null
      ? []
      : [{ label: question.kind === 'date' ? 'Âge' : herLabel(question.key, question.label), value }];
  });
  return (
    <section className="nv-plate mp-block mp-block--fold" aria-label={title}>
      <details className="nv-disclosure mp-fold" open={open}>
        <summary className="mp-fold__head">
          <h2 className="nv-h2 mp-block__title">{title}</h2>
          <span className="nv-disclosure__sum">{answersLine(written.length)}</span>
        </summary>
        <div className="mp-fold__body">
          {written.length === 0 ? null : (
            <dl className="mp-fields">
              {written.map((row) => (
                <div key={row.label} className="mp-fields__row">
                  <dt>{row.label}</dt>
                  <dd>
                    <Value value={row.value} />
                  </dd>
                </div>
              ))}
            </dl>
          )}
          <ProposeCorrection
            creatorId={correcting.creatorId}
            section={section.key}
            title={title}
            corrections={correcting.corrections}
          />
        </div>
      </details>
    </section>
  );
}

/** Her seven panels, in Desirali's order (ADR 0079 § 6). */
function Sheet({ sheet, correcting }: { sheet: PersonaSheet; correcting: Correcting }): JSX.Element {
  return (
    <>
      {PERSONA_SHEET.map((section, index) => (
        <Panel key={section.key} section={section} sheet={sheet} correcting={correcting} open={index === 0} />
      ))}
    </>
  );
}

function Failed({ retry }: { retry: () => void }): JSX.Element {
  return <Failure onRetry={retry} />;
}

const Loading = (): JSX.Element => (
  <div aria-busy="true">
    <div className="nv-plate mp-block ps-skeleton" />
    <div className="nv-plate mp-block ps-skeleton ps-skeleton--tall" />
  </div>
);

const Preparing = (): JSX.Element => (
  <div className="nv-plate mp-block">
    <p className="mp-block__title">Ta fiche est en préparation</p>
    <p className="ps-muted">L’agence la remplit avec toi. Elle s’affichera ici dès qu’elle sera prête.</p>
  </div>
);

function OwnSheet({ creatorId }: { creatorId: CreatorId }): JSX.Element {
  const sheet = useMyPersona(creatorId);
  // Her corrections never hold the sheet back: unread, the blocks show none and still take a new one.
  const corrections = useCorrections(creatorId);
  if (sheet.isError) return <Failed retry={() => void sheet.refetch()} />;
  if (sheet.isPending) return <Loading />;
  return sheet.data === null ? (
    <Preparing />
  ) : (
    <Sheet sheet={sheet.data} correcting={{ creatorId, corrections: corrections.data ?? [] }} />
  );
}

/**
 * Moi › Persona, the creator's own (ADR 0042 § 8), in reading only (recette CREA-01, Charles 05/11 « go recos »): the
 * seven panels of her sheet (ADR 0079 § 6), as the agency wrote them. Never its strategies,
 * follow-ups or notifications, never a word about who answers for her (ADR 0063); the agency changes the sheet, she
 * proposes a correction under a panel (CREA-01 b).
 */
export function MyPersonaPage(): JSX.Element {
  const creators = useCreators();
  // Her account holds exactly one creator (ADR 0042 § 2, checked by the base); the list is hers alone.
  const own = creators.data?.[0];

  return (
    <Page width="narrow">
      <PageHeader
        eyebrow="Moi"
        title="Persona"
        lead={
          'Ta fiche, panneau par panneau : ouvre-en un pour le lire. Une erreur\u00a0? Propose une correction dedans.'
        }
        tabs={<MeNav creator />}
      />
      <div className="ps-sheet">
        <section className="ps-page">
          {creators.isError ? (
            <Failed retry={() => void creators.refetch()} />
          ) : creators.isPending ? (
            <Loading />
          ) : own === undefined ? (
            <Preparing />
          ) : (
            <OwnSheet creatorId={own.id} />
          )}
        </section>
      </div>
    </Page>
  );
}
