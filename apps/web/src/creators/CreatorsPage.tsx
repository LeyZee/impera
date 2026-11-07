import type { CreatorId } from '@impera/contracts';
import { Link, useBlocker, useRouteContext } from '@tanstack/react-router';
import { useState, type JSX } from 'react';

import { AccessSection } from './AccessSection';
import { ArchivedCreators } from './ArchivedCreators';
import { LeaveConfirm } from './LeaveConfirm';
import { NewCreatorForm } from './NewCreatorForm';
import { AgendaSection } from './agenda/AgendaSection';
import { useCreators } from './api';
import { HoursSection } from './hours/HoursSection';
import { IdeasSection } from './ideas/IdeasSection';
import { CreatorsList } from './overview/CreatorsList';
import { PersonaSection } from './persona/PersonaSection';
import { ProfileSection } from './profile/ProfileSection';
import { AgencyRateSection } from './rate/AgencyRateSection';
import { RequestsSection } from './requests/RequestsSection';
import { ScriptsSection } from './scripts/ScriptsSection';
import { creatorsSearch, sheetsFor, type CreatorSheet } from './search';

import { Page, PageHeader, SubNav } from '@/shell/layout';

export type CreatorTab = CreatorSheet;

/**
 * Créatrices: first the list of the creators, one card each with what the agency needs to know of her (« ok
 * liste-créatrices », Charles, 06/11), where the owner adds one; then, once one is picked, her sheet, starting with her
 * persona (revue 08: the persona belongs to the creator, not to the settings), then for the owner and an active manager
 * her agenda (CR-05 lot c), and for the owner alone her hours (P3-14), her access to her own space (CR-02) and the
 * agency's percentage (CR-04). Always the list first, even with one creator. The tab and the creator live in the
 * address (`?onglet=heures&creatrice=<id>`): no creator, or one the list does not hold, is the list. Changes not saved
 * are never lost silently: leaving asks first.
 */
export function CreatorsPage({
  tab,
  creatorId,
  onCreator,
}: {
  tab: CreatorTab;
  /** The creator in the address; none, or one the list does not hold, shows the list. */
  creatorId: CreatorId | null;
  onCreator: (id: CreatorId) => void;
}): JSX.Element {
  const { user } = useRouteContext({ from: '__root__' });
  const query = useCreators();
  const creators = query.data ?? [];
  const [adding, setAdding] = useState(false);
  /** The persona or the hours on screen hold changes not saved. */
  const [dirty, setDirty] = useState(false);
  // Any navigation, a tab, « ← Créatrices », a link of the menu or a step back included, waits for the same confirmation; a
  // reload or a closed tab gets the browser's own.
  const blocker = useBlocker({
    shouldBlockFn: () => true,
    disabled: !dirty,
    enableBeforeUnload: dirty,
    withResolver: true,
  });
  const isOwner = user.role === 'owner';
  const current = creators.find((creator) => creator.id === creatorId);
  // Added from the list; with no creator yet, the owner is asked for one first: the persona needs her.
  const showForm = isOwner && current === undefined && (adding || (query.isSuccess && creators.length === 0));
  const selected = current?.id ?? null;
  const listing = current === undefined && !showForm;
  // The router keeps each member to their sheets (`sheetsFor`); here they also need a creator.
  const sheets = sheetsFor(user);
  /** The sheet a card of the list opens, and the one on screen: the address's, when this member opens it. */
  const shown: CreatorTab = sheets.includes(tab) ? tab : (sheets[0] ?? 'persona');

  const leaving = blocker.status === 'blocked';
  const stay = (): void => {
    if (blocker.status === 'blocked') blocker.reset();
  };
  const leave = (): void => {
    if (blocker.status === 'blocked') blocker.proceed();
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
    if (listing) return <CreatorsList creators={creators} sheet={shown} isOwner={isOwner} />;
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
    if (shown === 'ideas' && current !== undefined) {
      return (
        <IdeasSection
          key={current.id}
          creatorId={current.id}
          creatorName={current.displayName}
          timezone={current.timezone}
        />
      );
    }
    if (shown === 'requests' && current !== undefined) {
      return (
        <RequestsSection
          key={current.id}
          creatorId={current.id}
          creatorName={current.displayName}
          timezone={current.timezone}
          isOwner={isOwner}
        />
      );
    }
    if (shown === 'scripts' && current !== undefined) {
      return (
        <ScriptsSection
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
    if (shown === 'profile' && current !== undefined) {
      return <ProfileSection key={current.id} creatorId={current.id} creatorName={current.displayName} />;
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
        readsCorrections={user.teamScope === 'owner' || user.teamScope === 'agency'}
        creatorName={current?.displayName ?? null}
        timezone={current?.timezone ?? null}
        onDirty={setDirty}
      />
    );
  };
  // Persona · Agenda · Heures d'activité · Accès · Pourcentage are the views of the sheet, in the header like every
  // section's sub-tabs (NAV-10); they say where one is.
  const switchShown = sheets.length > 1 && current !== undefined && !showForm && query.isSuccess;
  const labels: Readonly<Record<CreatorSheet, string>> = {
    persona: 'Persona',
    agenda: 'Agenda',
    ideas: 'Idées du jour',
    requests: 'Demandes',
    scripts: 'Scripts',
    hours: 'Heures d’activité',
    access: 'Accès',
    rate: 'Pourcentage',
    profile: 'Profil',
  };
  // Her agenda right after her persona: the sheet a manager opens most (CR-05 lot c).
  const order: readonly CreatorSheet[] = [
    'persona',
    'agenda',
    'ideas',
    'requests',
    'scripts',
    'hours',
    'access',
    'rate',
    'profile',
  ];

  const lead = isOwner
    ? 'Tes créatrices d’un coup d’œil. Ouvre-en une pour sa fiche : persona, agenda, idées du jour, demandes, scripts, heures d’activité, accès, pourcentage et profil.'
    : sheets.includes('agenda')
      ? 'Les créatrices qui te sont confiées. Ouvre-en une pour son agenda, ses idées du jour, ses demandes et ses scripts.'
      : 'Les créatrices qui te sont confiées. Ouvre-en une pour sa persona.';

  return (
    <Page>
      {current === undefined ? (
        <PageHeader
          title="Créatrices"
          {...(showForm ? {} : { lead })}
          actions={
            isOwner && !showForm && query.isSuccess ? (
              <>
                {/* The script structures are the agency's, asked of every creator: a screen of their own (SC-01 c). */}
                <Link to="/creatrices/structures" className="nv-btn nv-btn--soft nv-btn--sm">
                  Structures de script
                </Link>
                <button
                  type="button"
                  className="nv-btn nv-btn--neon nv-btn--sm"
                  onClick={() => {
                    setAdding(true);
                  }}
                >
                  Ajouter une créatrice
                </button>
              </>
            ) : undefined
          }
        />
      ) : (
        <PageHeader
          eyebrow={
            <Link
              to="/creatrices"
              search={creatorsSearch(shown, null)}
              className="nv-btn nv-btn--plain nv-btn--sm"
            >
              ← Créatrices
            </Link>
          }
          title={current.displayName}
          actions={
            switchShown ? (
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
            ) : undefined
          }
        />
      )}
      {/* One child of the page: the sheet follows the switch, never pushed to the foot of the screen (CREA-03). */}
      <div className="ps-sheet">
        {leaving ? <LeaveConfirm onLeave={leave} onStay={stay} /> : null}
        {body()}
        {/* The archived creators, folded at the foot of the list, the owner's alone (ADR 0071 § 2). */}
        {isOwner && listing && query.isSuccess ? <ArchivedCreators onRestored={onCreator} /> : null}
      </div>
    </Page>
  );
}
