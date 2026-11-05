import { PERSONA_OPTIONS, type CreatorId, type CreatorPersonaSheet } from '@impera/contracts';
import type { JSX } from 'react';

import { useCreators, useMyPersona } from './api';
import { physiqueSummary } from './persona/model';

import '@/creators/persona/persona.css';
import './my-persona.css';
import { MeNav } from '@/screens/me/MeNav';
import { Page, PageHeader } from '@/shell/layout';

const languageLabel = (value: string): string =>
  PERSONA_OPTIONS.languages.find((option) => option.value === value)?.label ?? value;
const lengthLabel = (value: string): string =>
  PERSONA_OPTIONS.messageLength.find((option) => option.value === value)?.label ?? value;
const capitalsLabel = (value: string): string =>
  PERSONA_OPTIONS.capitals.find((option) => option.value === value)?.label ?? value;

/** One line of a block: what she reads, or `null` when nothing is written there (the line is then left out). */
interface Row {
  readonly label: string;
  readonly value: string | null;
}

const list = (entries: readonly string[] | undefined): string | null =>
  entries === undefined || entries.length === 0 ? null : entries.join(', ');
const text = (value: string | null | undefined): string | null =>
  value === null || value === undefined || value.trim() === '' ? null : value;

/**
 * A block of her sheet: only the lines written, as a list of terms (label, then value), so that a half-filled sheet
 * never reads « rien d'écrit » ten times over (Extension's review of #531). A block with nothing says it once.
 */
function Block({ title, rows }: { title: string; rows: readonly Row[] }): JSX.Element {
  const written = rows.filter((row): row is { label: string; value: string } => row.value !== null);
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
    </section>
  );
}

function Sheet({ sheet }: { sheet: CreatorPersonaSheet }): JSX.Element {
  const { details, lifestyle, tastes, intimate, writing_style: style, limits } = sheet;
  const samples = sheet.sample_replies.map((sample, index) => ({
    label: sample.situation ?? (index === 0 ? 'Comme tu réponds' : `Autre réponse (${String(index + 1)})`),
    value: `« ${sample.reply} »`,
  }));
  return (
    <>
      <Block
        title="Qui tu es"
        rows={[
          { label: 'Prénom', value: text(details.first_name) },
          { label: 'Langues', value: list(details.languages.map(languageLabel)) },
          { label: 'Physique', value: text(physiqueSummary(details)) },
          { label: 'Loisirs', value: list(details.hobbies) },
          { label: 'Caractère', value: list(details.personality) },
        ]}
      />
      <Block
        title="Tes limites"
        rows={[
          { label: 'Ce que tu ne fais jamais', value: list(limits.never_do) },
          { label: 'Ce que tu ne montres jamais', value: list(limits.never_show) },
          { label: 'Ce que tu ne dis jamais', value: list(limits.never_say) },
          { label: 'Ce qui te dégoûte', value: list(limits.disgusts) },
        ]}
      />
      <Block
        title="Ta vie"
        rows={[
          { label: 'Ce que tu fais', value: text(lifestyle?.occupation) },
          { label: 'Où tu vis', value: text(lifestyle?.area) },
          { label: 'Tes journées', value: text(lifestyle?.routine) },
          { label: 'Tes projets', value: text(lifestyle?.goals) },
        ]}
      />
      <Block
        title="Tes goûts"
        rows={[
          { label: 'Tu aimes', value: list(tastes?.likes) },
          { label: 'Tu n’aimes pas', value: list(tastes?.dislikes) },
        ]}
      />
      <Block
        title="L’intime"
        rows={[
          { label: 'Ce qui t’excite', value: list(intimate?.turn_ons) },
          { label: 'Tes fantasmes', value: list(intimate?.fantasies) },
          { label: 'Ta façon de sexter', value: text(intimate?.sexting_style) },
        ]}
      />
      <Block
        title="Ta façon d’écrire"
        rows={[
          { label: 'Tes messages', value: style === null ? null : lengthLabel(style.message_length) },
          { label: 'Les majuscules', value: style === null ? null : capitalsLabel(style.capitals) },
          { label: 'Tes emojis', value: list(style?.emojis_preferred) },
          { label: 'Jamais ces emojis', value: list(style?.emojis_forbidden) },
          { label: 'Ta ponctuation', value: text(style?.punctuation) },
          ...samples,
        ]}
      />
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
  if (sheet.isError) return <Failed retry={() => void sheet.refetch()} />;
  if (sheet.isPending) return <Loading />;
  return sheet.data === null ? <Preparing /> : <Sheet sheet={sheet.data} />;
}

/**
 * Moi › Persona, the creator's own (ADR 0042 § 8), in reading only (recette CREA-01, Charles 05/11 « go recos »): who
 * she is, her limits, her life, her tastes and her way of writing, as the agency wrote them. Never its strategies,
 * follow-ups or notifications, never a word about who answers for her (ADR 0063); the agency changes the sheet.
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
        lead="Ta fiche : qui tu es, ce que tu aimes, tes limites et ta façon d’écrire. Quelque chose ne te ressemble pas ? Dis-le à l’agence, elle la met à jour."
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
