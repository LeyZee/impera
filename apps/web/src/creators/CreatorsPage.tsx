import type { CreatorId } from '@impera/contracts';
import { Link, useBlocker, useRouteContext } from '@tanstack/react-router';
import { useState, type JSX } from 'react';

import { AccessSection } from './AccessSection';
import { LeaveConfirm } from './LeaveConfirm';
import { NewCreatorForm } from './NewCreatorForm';
import { SetupCard } from './SetupCard';
import { AgendaSection } from './agenda/AgendaSection';
import { useCreators } from './api';
import { HoursSection } from './hours/HoursSection';
import { PersonaSection } from './persona/PersonaSection';
import { AgencyRateSection } from './rate/AgencyRateSection';
import { creatorsSearch, sheetsFor, type CreatorSheet } from './search';

import { Page, PageHeader, SubNav } from '@/shell/layout';

export type CreatorTab = CreatorSheet;

/**
 * Créatrices: the sheet of each creator, starting with her persona (revue 08: the persona belongs to the creator,
 * not to the settings), then for the owner and an active manager her agenda (CR-05 lot c), and for the owner alone
 * her hours (P3-14), her access to her own space (CR-02) and the agency's percentage (CR-04). With several creators,
 * a row of chips picks one; with one, her name is enough. The owner adds a creator here. The tab and the creator live in the address (`?onglet=heures&creatrice=<id>`). Changes
 * not saved are never lost silently: leaving asks first.
 */
export function CreatorsPage({
  tab,
  creatorId,
  onCreator,
}: {
  tab: CreatorTab;
  /** The creator in the address; one the list does not hold reads as the first of the list. */
  creatorId: CreatorId | null;
  onCreator: (id: CreatorId) => void;
}): JSX.Element {
  const { user } = useRouteContext({ from: '__root__' });
  const query = useCreators();
  const creators = query.data ?? [];
  const [adding, setAdding] = useState(false);
  /** The persona or the hours on screen hold changes not saved. */
  const [dirty, setDirty] = useState(false);
  /** An action of this page (« Ajouter une créatrice ») waiting for the confirmation that drops those changes. */
  const [pending, setPending] = useState<(() => void) | null>(null);
  // Any navigation, a chip, a tab, a link of the menu or a step back included, waits for the same confirmation; a
  // reload or a closed tab gets the browser's own.
  const blocker = useBlocker({
    shouldBlockFn: () => true,
    disabled: !dirty,
    enableBeforeUnload: dirty,
    withResolver: true,
  });
  const isOwner = user.role === 'owner';
  // With no creator yet, the owner is asked for one first: the persona needs her.
  const showForm = isOwner && (adding || (query.isSuccess && creators.length === 0));
  const current = creators.find((creator) => creator.id === creatorId) ?? creators[0];
  const selected = current?.id ?? null;
  // The router keeps each member to their sheets (`sheetsFor`); here they also need a creator.
  const sheets = sheetsFor(user);
  const shown: CreatorTab = current !== undefined && sheets.includes(tab) ? tab : (sheets[0] ?? 'persona');

  const leaving = blocker.status === 'blocked' || pending !== null;
  const stay = (): void => {
    if (blocker.status === 'blocked') blocker.reset();
    setPending(null);
  };
  const leave = (): void => {
    if (blocker.status === 'blocked') blocker.proceed();
    pending?.();
    setPending(null);
  };

  const body = (): JSX.Element => {
    if (query.isError) {
      return (
        <section className="ps-page">
          <div className="nv-plate ps-head">
            <p className="ps-title">La liste des créatrices ne se charge pas</p>
            <p className="ps-muted">Le serveur ne répond pas. Réessaie dans un instant.</p>
            <button
              type="button"
              className="nv-btn nv-btn--soft ps-self-start"
              onClick={() => void query.refetch()}
            >
              Réessayer
            </button>
          </div>
        </section>
      );
    }
    if (query.isPending) {
      return (
        <section className="ps-page" aria-busy="true">
          <div className="nv-plate ps-head ps-skeleton" />
          <div className="nv-plate ps-panel ps-skeleton ps-skeleton--tall" />
        </section>
      );
    }
    if (!isOwner && creators.length === 0) {
      return (
        <section className="ps-page">
          <div className="nv-plate ps-head">
            <p className="ps-title">Aucune créatrice ne t’est confiée</p>
            <p className="ps-muted">
              Le propriétaire choisit les créatrices de chaque compte. Demande-lui de t’en confier une.
            </p>
          </div>
        </section>
      );
    }
    if (showForm) {
      return (
        <section className="ps-page">
          {creators.length === 0 ? (
            // The first visit: one line on where this leads, before the form (CREA-28).
            <p className="ps-muted cr-first">
              Commence par ta première créatrice : son nom, puis sa persona juste après.
            </p>
          ) : null}
          <NewCreatorForm
            onCreated={(creator) => {
              setAdding(false);
              onCreator(creator.id);
            }}
            onCancel={
              creators.length === 0
                ? null
                : () => {
                    setAdding(false);
                  }
            }
          />
        </section>
      );
    }
    if (shown === 'agenda' && current !== undefined) {
      return (
        <AgendaSection
          key={current.id}
          creatorId={current.id}
          creatorName={current.displayName}
          timezone={current.timezone}
        />
      );
    }
    if (shown === 'access' && current !== undefined) {
      return <AccessSection key={current.id} creatorId={current.id} creatorName={current.displayName} />;
    }
    if (shown === 'rate' && current !== undefined) {
      return (
        <AgencyRateSection
          key={current.id}
          creatorId={current.id}
          creatorName={current.displayName}
          onDirty={setDirty}
        />
      );
    }
    return shown === 'hours' && current !== undefined ? (
      <HoursSection
        key={current.id}
        creatorId={current.id}
        creatorName={current.displayName}
        onDirty={setDirty}
      />
    ) : (
      <PersonaSection
        key={selected ?? 'none'}
        creatorId={selected}
        canSave={isOwner}
        isOwner={isOwner}
        creatorName={current?.displayName ?? null}
        timezone={current?.timezone ?? null}
        onDirty={setDirty}
      />
    );
  };
  // Persona · Agenda · Heures d'activité · Accès · Pourcentage are the views of the sheet, in the header like every
  // section's sub-tabs (NAV-10); they say where one is: the eyebrow then says nothing more (CREA-24).
  const switchShown = sheets.length > 1 && current !== undefined && !showForm && query.isSuccess;
  const labels: Readonly<Record<CreatorSheet, string>> = {
    persona: 'Persona',
    agenda: 'Agenda',
    hours: 'Heures d’activité',
    access: 'Accès',
    rate: 'Pourcentage',
  };
  // Her agenda right after her persona: the sheet a manager opens most (CR-05 lot c).
  const order: readonly CreatorSheet[] = ['persona', 'agenda', 'hours', 'access', 'rate'];

  return (
    <Page>
      <PageHeader
        eyebrow={current === undefined || showForm || switchShown ? undefined : current.displayName}
        title="Créatrices"
        lead={
          isOwner
            ? 'La fiche de chaque créatrice : sa persona, son agenda, ses heures d’activité, son accès et le pourcentage de l’agence.'
            : sheets.includes('agenda')
              ? 'L’agenda de chaque créatrice : ce qu’elle a prévu, et les tâches que l’agence lui propose.'
              : 'La persona de chaque créatrice : ce que l’agent sait d’elle et la façon dont il parle.'
        }
        actions={
          <>
            {switchShown ? (
              <SubNav
                label="Fiche de la créatrice"
                items={order
                  .filter((sheet) => sheets.includes(sheet))
                  .map((sheet) => ({
                    to: '/creatrices',
                    search: creatorsSearch(sheet, selected),
                    current: shown === sheet,
                    label: labels[sheet],
                  }))}
              />
            ) : null}
            {/* While a creator is added, only « Annuler » leads back: a chip would change nothing on screen. */}
            {creators.length > 1 && !showForm ? (
              <div className="ps-chips cr-creators" role="radiogroup" aria-label="Créatrice">
                {creators.map((creator) => (
                  <button
                    key={creator.id}
                    type="button"
                    role="radio"
                    className="nv-chip"
                    aria-checked={creator.id === selected}
                    onClick={() => {
                      if (creator.id !== selected) onCreator(creator.id);
                    }}
                  >
                    {creator.displayName}
                  </button>
                ))}
              </div>
            ) : null}
            {isOwner && !showForm && query.isSuccess ? (
              // The script structures are the agency's, asked of every creator: a screen of their own (SC-01 c).
              <Link to="/creatrices/structures" className="nv-btn nv-btn--soft nv-btn--sm">
                Structures de script
              </Link>
            ) : null}
            {isOwner && !showForm && query.isSuccess ? (
              <button
                type="button"
                className="nv-btn nv-btn--soft nv-btn--sm"
                onClick={() => {
                  const add = (): void => {
                    setAdding(true);
                  };
                  if (dirty) setPending(() => add);
                  else add();
                }}
              >
                Ajouter une créatrice
              </button>
            ) : null}
          </>
        }
      />
      {/* One child of the page: the sheet follows the switch, never pushed to the foot of the screen (CREA-03). */}
      <div className="ps-sheet">
        {leaving ? <LeaveConfirm onLeave={leave} onStay={stay} /> : null}
        {/* What is left to set up, above every tab of her sheet; read again with each tab (CRM-07 b2). */}
        {isOwner && current !== undefined && !showForm && query.isSuccess ? (
          <SetupCard
            key={`${current.id}:${shown}`}
            creatorId={current.id}
            creatorName={current.displayName}
            timezone={current.timezone}
          />
        ) : null}
        {body()}
      </div>
    </Page>
  );
}
