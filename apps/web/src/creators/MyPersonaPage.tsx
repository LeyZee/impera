import { MyPersonaSchema, PERSONA_OPTIONS, type CreatorPersonaSheet } from '@impera/contracts';
import { useQuery } from '@tanstack/react-query';
import type { JSX, ReactNode } from 'react';

import { useCreators } from './api';
import { physiqueSummary } from './persona/model';

import { MeNav } from '@/screens/me/MeNav';
import { Page, PageHeader } from '@/shell/layout';

/** `GET /v1/creators/:id/persona/mine`: her sheet in force, as she reads it. */
async function fetchMyPersona(creatorId: string): Promise<CreatorPersonaSheet | null> {
  const response = await fetch(`/v1/creators/${creatorId}/persona/mine`, { credentials: 'include' });
  if (!response.ok) throw new Error(`GET persona/mine: ${String(response.status)}`);
  return MyPersonaSchema.parse(await response.json()).sheet;
}

const languageLabel = (value: string): string =>
  PERSONA_OPTIONS.languages.find((option) => option.value === value)?.label ?? value;
const lengthLabel = (value: string): string =>
  PERSONA_OPTIONS.messageLength.find((option) => option.value === value)?.label ?? value;
const capitalsLabel = (value: string): string =>
  PERSONA_OPTIONS.capitals.find((option) => option.value === value)?.label ?? value;

function Block({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <section className="nv-plate ps-head">
      <h2 className="ps-title">{title}</h2>
      {children}
    </section>
  );
}

/** One line of her sheet; nothing written, the line says so instead of staying blank. */
function Line({ label, value }: { label: string; value: string | null }): JSX.Element {
  return (
    <p>
      <span className="ps-muted">{label} : </span>
      {value === null || value === '' ? <span className="ps-muted">rien d’écrit</span> : value}
    </p>
  );
}

const list = (entries: readonly string[]): string | null =>
  entries.length === 0 ? null : entries.join(', ');

function Sheet({ sheet }: { sheet: CreatorPersonaSheet }): JSX.Element {
  const { details, lifestyle, tastes, intimate, writing_style: style, limits } = sheet;
  return (
    <>
      <Block title="Qui tu es">
        <Line label="Prénom" value={details.first_name} />
        <Line label="Langues" value={details.languages.map(languageLabel).join(', ')} />
        <Line label="Physique" value={physiqueSummary(details)} />
        <Line label="Loisirs" value={list(details.hobbies)} />
        <Line label="Caractère" value={list(details.personality)} />
      </Block>
      <Block title="Ta vie">
        <Line label="Ce que tu fais" value={lifestyle?.occupation ?? null} />
        <Line label="Où tu vis" value={lifestyle?.area ?? null} />
        <Line label="Tes journées" value={lifestyle?.routine ?? null} />
        <Line label="Tes projets" value={lifestyle?.goals ?? null} />
      </Block>
      <Block title="Tes goûts">
        <Line label="Tu aimes" value={list(tastes?.likes ?? [])} />
        <Line label="Tu n’aimes pas" value={list(tastes?.dislikes ?? [])} />
      </Block>
      <Block title="L’intime">
        <Line label="Ce qui t’excite" value={list(intimate?.turn_ons ?? [])} />
        <Line label="Tes fantasmes" value={list(intimate?.fantasies ?? [])} />
        <Line label="Ta façon de sexter" value={intimate?.sexting_style ?? null} />
      </Block>
      <Block title="Ta façon d’écrire">
        <Line label="Tes messages" value={style === null ? null : lengthLabel(style.message_length)} />
        <Line label="Les majuscules" value={style === null ? null : capitalsLabel(style.capitals)} />
        <Line label="Tes emojis" value={list(style?.emojis_preferred ?? [])} />
        <Line label="Jamais ces emojis" value={list(style?.emojis_forbidden ?? [])} />
        <Line label="Ta ponctuation" value={style?.punctuation ?? null} />
        {sheet.sample_replies.map((sample, index) => (
          <p key={index}>
            <span className="ps-muted">{sample.situation ?? 'Comme tu réponds'} : </span>« {sample.reply} »
          </p>
        ))}
      </Block>
      <Block title="Tes limites">
        <Line label="Ce que tu ne fais jamais" value={list(limits.never_do)} />
        <Line label="Ce que tu ne montres jamais" value={list(limits.never_show)} />
        <Line label="Ce que tu ne dis jamais" value={list(limits.never_say)} />
        <Line label="Ce qui te dégoûte" value={list(limits.disgusts)} />
      </Block>
    </>
  );
}

/**
 * Moi › Persona, the creator's own (ADR 0042 § 8), in reading only (recette CREA-01, Charles 05/11 « go recos »): who
 * she is, her tastes, her limits and her way of writing, as the agency wrote them. Never its strategies, follow-ups
 * or notifications, never a word about who answers for her (ADR 0063); the agency changes the sheet.
 */
export function MyPersonaPage(): JSX.Element {
  const creators = useCreators();
  // Her account holds exactly one creator (ADR 0042 § 2, checked by the base); the list is hers alone.
  const own = creators.data?.[0];
  const sheet = useQuery({
    queryKey: ['my-persona', own?.id],
    queryFn: () => fetchMyPersona(own?.id ?? ''),
    enabled: own !== undefined,
    retry: 1,
  });
  const failed = creators.isError || sheet.isError;
  const pending = creators.isPending || (own !== undefined && sheet.isPending);

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
          {failed ? (
            <div className="nv-plate ps-head">
              <p className="ps-title">Ta fiche ne se charge pas</p>
              <p className="ps-muted">Le serveur ne répond pas. Réessaie dans un instant.</p>
              <button
                type="button"
                className="nv-btn nv-btn--soft ps-self-start"
                onClick={() => {
                  void creators.refetch();
                  void sheet.refetch();
                }}
              >
                Réessayer
              </button>
            </div>
          ) : pending ? (
            <div aria-busy="true">
              <div className="nv-plate ps-head ps-skeleton" />
              <div className="nv-plate ps-panel ps-skeleton ps-skeleton--tall" />
            </div>
          ) : sheet.data === null || sheet.data === undefined ? (
            <div className="nv-plate ps-head">
              <p className="ps-title">Ta fiche est en préparation</p>
              <p className="ps-muted">
                L’agence la remplit avec toi. Elle s’affichera ici dès qu’elle sera prête.
              </p>
            </div>
          ) : (
            <Sheet sheet={sheet.data} />
          )}
        </section>
      </div>
    </Page>
  );
}
