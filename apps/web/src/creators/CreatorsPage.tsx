import type { CreatorId, CreatorSummary } from '@impera/contracts';
import { Link, useBlocker, useRouteContext } from '@tanstack/react-router';
import { useState, type JSX } from 'react';

import { AccessSection } from './AccessSection';
import { ArchivedCreators } from './ArchivedCreators';
import { LeaveConfirm } from './LeaveConfirm';
import { NewCreatorForm } from './NewCreatorForm';
import { AgendaSection } from './agenda/AgendaSection';
import { AlertsTab } from './alerts/AlertsTab';
import { useCreators } from './api';
import { CustomPricesSection } from './custom-prices/CustomPricesSection';
import { DropsSection } from './drops/DropsSection';
import { HoursSection } from './hours/HoursSection';
import { IdeasSection } from './ideas/IdeasSection';
import { LinksSection } from './links/LinksSection';
import { CreatorsList } from './overview/CreatorsList';
import { useCreatorsOverview } from './overview/api';
import { PersonaSection } from './persona/PersonaSection';
import { ProfileSection } from './profile/ProfileSection';
import { AgencyRateSection } from './rate/AgencyRateSection';
import { RequestsSection } from './requests/RequestsSection';
import { ScriptsSection } from './scripts/ScriptsSection';
import { ScriptsTab } from './scripts/prepared/ScriptsTab';
import { creatorsSearch, sheetsFor, type CreatorSheet } from './search';
import { TelegramChannelSection } from './telegram/TelegramChannelSection';

import { AgentSwitch } from '@/agent/AgentSwitch';
import { canSwitch } from '@/agent/state';
import { CreatorSetupBlock } from '@/setup/SetupBlocks';
import { Page, PageHeader, SubNav } from '@/shell/layout';
import { Failure, Skeleton, SkeletonCard } from '@/shell/states';

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
  folderId = null,
  onFolder,
}: {
  tab: CreatorTab;
  /** The creator in the address; none, or one the list does not hold, shows the list. */
  creatorId: CreatorId | null;
  onCreator: (id: CreatorId) => void;
  /** Her vault folder opened in Scripts, from the address (`dossier`). */
  folderId?: string | null;
  onFolder?: (id: string | null) => void;
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
          <Failure onRetry={() => void query.refetch()} />
        </section>
      );
    }
    if (query.isPending) {
      // The list waits in the shape of its cards, so nothing jumps when they arrive (recette 11/11, ADM-21).
      if (creatorId === null)
        return (
          <Skeleton label="Chargement des créatrices…">
            <div className="cl-grid">
              <SkeletonCard lines={2} height={136} />
              <SkeletonCard lines={2} height={136} />
            </div>
          </Skeleton>
        );
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
    if (listing)
      return <CreatorsList creators={creators} sheet={shown} isOwner={isOwner} switches={canSwitch(user)} />;
    if (shown === 'agenda' && current !== undefined) {
      return (
        <AgendaSection
          key={current.id}
          creatorId={current.id}
          creatorName={current.displayName}
          timezone={current.timezone}
          canValidate={isOwner}
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
      // Two views (ADR 0149 § 1): her scripts in preparation and their editor, then what is to copy into Reveal, which
      // ends on the screen that was here before (her vault and the scripts she sent).
      return (
        <ScriptsTab
          key={current.id}
          creatorId={current.id}
          creatorName={current.displayName}
          sent={
            <ScriptsSection
              creatorId={current.id}
              creatorName={current.displayName}
              timezone={current.timezone}
              isOwner={isOwner}
              folderId={folderId}
              {...(onFolder === undefined ? {} : { onFolder })}
            />
          }
        />
      );
    }
    if (shown === 'custom' && current !== undefined) {
      return (
        <CustomPricesSection
          key={current.id}
          creatorId={current.id}
          creatorName={current.displayName}
          onDirty={setDirty}
        />
      );
    }
    if (shown === 'content' && current !== undefined) {
      return (
        <DropsSection
          key={current.id}
          creatorId={current.id}
          creatorName={current.displayName}
          timezone={current.timezone}
        />
      );
    }
    if (shown === 'telegram' && current !== undefined) {
      return <TelegramChannelSection key={current.id} creatorId={current.id} onDirty={setDirty} />;
    }
    if (shown === 'alerts' && current !== undefined) {
      return <AlertsTab key={current.id} creatorId={current.id} creatorName={current.displayName} />;
    }
    if (shown === 'links' && current !== undefined) {
      return (
        <LinksSection
          key={current.id}
          creatorId={current.id}
          creatorName={current.displayName}
          canEdit={isOwner}
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
    custom: 'Sur mesure',
    content: 'Contenu',
    telegram: 'Canal Telegram',
    alerts: 'Alertes',
    links: 'Liens',
    hours: 'Heures d’activité',
    access: 'Accès',
    rate: 'Part de l’agence',
    profile: 'Profil',
  };
  // Her agenda right after her persona: the sheet a manager opens most (CR-05 lot c).
  const order: readonly CreatorSheet[] = [
    'persona',
    'agenda',
    'ideas',
    'requests',
    'scripts',
    'custom',
    'content',
    'telegram',
    'alerts',
    'links',
    'hours',
    'access',
    'rate',
    'profile',
  ];

  const lead = isOwner
    ? 'Tes créatrices d’un coup d’œil. Ouvre-en une pour sa fiche et tous ses réglages.'
    : sheets.includes('agenda')
      ? 'Les créatrices qui te sont confiées. Ouvre-en une pour sa fiche.'
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
          // Her AI's switch (ADR 0148 § 1) next to her name, on every tab of her sheet: the same setting as the
          // Dashboard's control (avis Design, 19/11: in the header, not as a card of the tab).
          actions={showForm ? undefined : <CreatorAgentSwitch creator={current} user={user} />}
          tabs={
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
        {/* Her « Mise en route » (pilotage plan W1) above whichever sheet is open, until all is done. */}
        {isOwner && current !== undefined && !showForm ? (
          <CreatorSetupBlock key={`${current.id}:${shown}`} creatorId={current.id} />
        ) : null}
        {body()}
        {/* The archived creators, folded at the foot of the list, the owner's alone (ADR 0071 § 2). */}
        {isOwner && listing && query.isSuccess ? <ArchivedCreators onRestored={onCreator} /> : null}
      </div>
    </Page>
  );
}

/** Her switch on her sheet, from her card of the list (`GET /v1/dashboard/creators`): nothing until it is read. */
function CreatorAgentSwitch({
  creator,
  user,
}: {
  creator: CreatorSummary;
  user: { readonly role: string; readonly teamScope: string | null };
}): JSX.Element | null {
  const overview = useCreatorsOverview();
  const card = overview.data?.find((one) => one.creatorId === creator.id);
  if (card === undefined) return null;
  return (
    <AgentSwitch
      creatorId={creator.id}
      creatorName={creator.displayName}
      zone={creator.timezone}
      state={card}
      read={overview.dataUpdatedAt}
      variant="header"
      readOnly={!canSwitch(user)}
    />
  );
}
