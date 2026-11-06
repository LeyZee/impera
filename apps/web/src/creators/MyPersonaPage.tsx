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
import { ProposeCorrection } from './persona/ProposeCorrection';
import { useCorrections } from './persona/corrections';
import { panelTitle, type Answer } from './persona/model';
import { ageLine } from './persona/sheet';

import '@/creators/persona/persona.css';
import './my-persona.css';
import { MeNav } from '@/screens/me/MeNav';
import { Page, PageHeader } from '@/shell/layout';

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

/**
 * A panel of her sheet, Desirali's title over the lines written, as a list of terms (label, then value), so that a
 * half-filled sheet never reads « rien d'écrit » ten times over (Extension's review of #531). A panel with nothing
 * says it once. « Proposer une correction » at its foot.
 */
function Panel({
  section,
  sheet,
  correcting,
}: {
  section: SheetSection;
  sheet: PersonaSheet;
  correcting: Correcting;
}): JSX.Element {
  const title = panelTitle(section.key);
  const answers: Readonly<Record<string, Answer>> = sheet[section.key];
  const written = section.questions.flatMap((question) => {
    if (question.kind === 'timezone') return [];
    const value = answerOf(question, answers[question.key]);
    return value === null ? [] : [{ label: question.kind === 'date' ? 'Âge' : question.label, value }];
  });
  return (
    <section className="nv-plate mp-block" aria-label={title}>
      <h2 className="mp-block__title">{title}</h2>
      {written.length === 0 ? (
        <p className="ps-muted">Rien d’écrit pour l’instant.</p>
      ) : (
        <dl className="mp-fields">
          {written.map((row) => (
            <div key={row.label} className="mp-fields__row">
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
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
    </section>
  );
}

/** Her seven panels, in Desirali's order (ADR 0079 § 6). */
function Sheet({ sheet, correcting }: { sheet: PersonaSheet; correcting: Correcting }): JSX.Element {
  return (
    <>
      {PERSONA_SHEET.map((section) => (
        <Panel key={section.key} section={section} sheet={sheet} correcting={correcting} />
      ))}
    </>
  );
}

function Failed({ retry }: { retry: () => void }): JSX.Element {
  return (
    <div className="nv-plate mp-block">
      <p className="mp-block__title">Ta fiche ne se charge pas</p>
      <p className="ps-muted">Le serveur ne répond pas. Réessaie dans un instant.</p>
      <button type="button" className="nv-btn nv-btn--soft ps-self-start" onClick={retry}>
        Réessayer
      </button>
    </div>
  );
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
    <Page>
      <PageHeader
        eyebrow="Moi"
        title="Persona"
        lead={
          'Ta fiche, panneau par panneau\u00a0: qui tu es, ta vie, tes goûts, ta façon de parler, tes relations, l’intime et tes zones interdites. Quelque chose ne te ressemble pas\u00a0? Propose une correction sous le panneau concerné, l’agence met ta fiche à jour.'
        }
        actions={<MeNav creator />}
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
