import type { CreatorId, CreatorSummary, PreparedScriptView } from '@impera/contracts';
import { Link, useBlocker, useNavigate, useRouteContext } from '@tanstack/react-router';
import { useCallback, useEffect, useState, type JSX } from 'react';

import { AccessSection } from './AccessSection';
import { ArchivedCreators } from './ArchivedCreators';
import { LeaveConfirm } from './LeaveConfirm';
import { NewCreatorForm } from './NewCreatorForm';
import { AgendaSection } from './agenda/AgendaSection';
import { AlertsTab } from './alerts/AlertsTab';
import { useCreators } from './api';
import { CopilotSection } from './copilot/CopilotSection';
import { CustomOrdersSection } from './custom-orders/CustomOrdersSection';
import { CustomPricesSection } from './custom-prices/CustomPricesSection';
import { DropsSection } from './drops/DropsSection';
import { FanTiersSection } from './fan-tiers/FanTiersSection';
import { HoursSection } from './hours/HoursSection';
import { IdeasSection } from './ideas/IdeasSection';
import { CreatorsList } from './overview/CreatorsList';
import { useCreatorsOverview } from './overview/api';
import { PersonaSection } from './persona/PersonaSection';
import { Segment } from './persona/fields';
import { ProfileSection } from './profile/ProfileSection';
import { AgencyRateSection } from './rate/AgencyRateSection';
import { RequestsSection } from './requests/RequestsSection';
import { ScriptsSection } from './scripts/ScriptsSection';
import { PreparedScriptsView } from './scripts/prepared/PreparedScriptsView';
import { ScriptsToCopyView } from './scripts/prepared/ScriptsToCopyView';
import { usePreparedScripts } from './scripts/prepared/api';
import {
  CREATOR_TABS,
  accountCardId,
  creatorsSearch,
  rememberCreatorTab,
  sheetSearch,
  sheetsFor,
  tabOf,
  type CreatorSheet,
  type CreatorTabName,
} from './search';
import { TelegramChannelSection } from './telegram/TelegramChannelSection';
import { VaultPage } from './vault/VaultPage';
import './sheet.css';

import { AgentSwitch } from '@/agent/AgentSwitch';
import { canSwitch } from '@/agent/state';
import { StructuresView } from '@/scripts/StructuresPage';
import { CreatorSetupBlock } from '@/setup/SetupBlocks';
import { CrownArt } from '@/shell/art/EmptyArt';
import { Page, PageHeader, SubNav } from '@/shell/layout';
import { Empty, Failure, Skeleton, SkeletonCard } from '@/shell/states';
import { StockSection } from '@/stock/StockOverview';

export type CreatorTab = CreatorSheet;

/** What each tab of her sheet is called (ADR 0149 § 1). */
const TAB_LABELS: Readonly<Record<CreatorTabName, string>> = {
  persona: 'Persona',
  ai: 'IA',
  media: 'Médias',
  scripts: 'Scripts',
  agenda: 'Agenda',
  alerts: 'Alertes',
  account: 'Compte',
};

/** The views inside a tab, in their order, and what the tab's selector is called; a tab of one page has none. */
const TAB_VIEWS: Partial<
  Readonly<
    Record<
      CreatorTabName,
      { readonly label: string; readonly views: readonly (readonly [CreatorSheet, string])[] }
    >
  >
> = {
  media: {
    label: 'Vue de ses médias',
    views: [
      // Two coffres (ADR 0162): Reveal's, synchronised, and Impera's, what she dropped by use.
      ['vault', 'Coffre Reveal'],
      ['content', 'Dépôts'],
      ['stock', 'Coffre Impera'],
    ],
  },
  scripts: {
    label: 'Vue de ses scripts',
    views: [
      ['scripts', 'Scripts'],
      // Short, so four views share a phone's width; the view itself says « dans Reveal ».
      ['copy', 'À copier'],
      ['structures', 'Structures'],
      ['custom', 'Sur mesure'],
    ],
  },
  agenda: {
    label: 'Vue de son agenda',
    views: [
      ['agenda', 'Agenda'],
      ['ideas', 'Idées du jour'],
      ['requests', 'Demandes'],
    ],
  },
};

/**
 * Créatrices: first the list of the creators, one card each with what the agency needs to know of her (« ok
 * liste-créatrices », Charles, 06/11), where the owner adds one; then, once one is picked, her sheet in seven tabs (ADR
 * 0149 § 1): her persona (revue 08: the persona belongs to the creator, not to the settings), her AI (her hours, P3-14),
 * her media (her vault, her other drops), her scripts, her agenda (CR-05 lot c, with her ideas of the day and what the
 * agency asks of her), her alerts and her account (her Telegram channel, her access to her own space, CR-02, the
 * agency's percentage, CR-04, her profile). The views inside a tab are one segmented selector, never a second bar of
 * tabs (ADR 0149 § 3). Always the list first, even with one creator. The tab, the view and the creator live in the
 * address (`?onglet=medias&vue=depots&creatrice=<id>`): no creator, or one the list does not hold, is the list.
 * Changes not saved are never lost silently: leaving asks first.
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
  /** Her vault folder opened in Médias, from the address (`dossier`). */
  folderId?: string | null;
  onFolder?: (id: string | null) => void;
}): JSX.Element {
  const { user } = useRouteContext({ from: '__root__' });
  const query = useCreators();
  const creators = query.data ?? [];
  const [adding, setAdding] = useState(false);
  const navigate = useNavigate();
  /** The persona, the hours or a card of Compte on screen holds changes not saved: which ones. */
  const [unsaved, setUnsaved] = useState<readonly string[]>([]);
  const dirty = unsaved.length > 0;
  // Stable ones: a section tells its state from an effect that follows the callback it was given.
  const mark = useCallback((what: string, now: boolean): void => {
    setUnsaved((before) =>
      now === before.includes(what) ? before : now ? [...before, what] : before.filter((one) => one !== what),
    );
  }, []);
  const setDirty = useCallback(
    (now: boolean): void => {
      mark('sheet', now);
    },
    [mark],
  );
  const setTelegramDirty = useCallback(
    (now: boolean): void => {
      mark('telegram', now);
    },
    [mark],
  );
  const setRateDirty = useCallback(
    (now: boolean): void => {
      mark('rate', now);
    },
    [mark],
  );
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
  const shownTab = tabOf(shown);
  // The tab of her sheet on screen is the one Créatrices opens on next time, on this device (ADR 0149 § 2).
  // A script opened from « À copier dans Reveal », for « Scripts » to open at once; forgotten on leaving « Scripts ».
  const [opening, setOpening] = useState<PreparedScriptView | null>(null);
  useEffect(() => {
    if (shown !== 'scripts') return undefined;
    return () => {
      setOpening(null);
    };
  }, [shown, selected]);
  const onSheet = current !== undefined;
  useEffect(() => {
    if (onSheet) rememberCreatorTab(shown);
  }, [onSheet, shown]);

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
          <Empty plate art={<CrownArt />} title="Aucune créatrice ne t’est confiée">
            Le propriétaire choisit les créatrices de chaque compte. Demande-lui de t’en confier une.
          </Empty>
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
    if (shown === 'vault' && current !== undefined) {
      return (
        <section className="ps-page" aria-label={`Coffre de ${current.displayName}`}>
          <VaultPage
            key={current.id}
            creatorId={current.id}
            creatorName={current.displayName}
            isOwner={isOwner}
            folderId={folderId}
            {...(onFolder === undefined ? {} : { onFolder })}
          />
        </section>
      );
    }
    if (shown === 'scripts' && current !== undefined) {
      // Her scripts in preparation and their editor (ADR 0149 § 1); the editor sends to « À copier dans Reveal ».
      return (
        <PreparedScriptsView
          key={`${current.id}:${opening?.id ?? ''}`}
          creatorId={current.id}
          creatorName={current.displayName}
          opening={opening}
          onCopy={() => {
            setOpening(null);
            void navigate({ to: '/creatrices', search: creatorsSearch('copy', current.id) });
          }}
        />
      );
    }
    if (shown === 'copy' && current !== undefined) {
      // What is ready to copy by hand, then the scripts she sent; a script opened here shows in « Scripts ».
      return (
        <ScriptsToCopyView
          key={current.id}
          creatorId={current.id}
          creatorName={current.displayName}
          sent={
            <ScriptsSection
              creatorId={current.id}
              creatorName={current.displayName}
              timezone={current.timezone}
            />
          }
          onOpen={(script) => {
            setOpening(script);
            void navigate({ to: '/creatrices', search: creatorsSearch('scripts', current.id) });
          }}
        />
      );
    }
    if (shown === 'custom' && current !== undefined) {
      // Her orders first, read by an active manager too; her grid, the owner's alone, below (trous béants point 6).
      return (
        <div className="cso-sheet">
          <CustomOrdersSection
            key={`orders-${current.id}`}
            creatorId={current.id}
            creatorName={current.displayName}
            timezone={current.timezone}
            canAnswer={isOwner}
          />
          {isOwner ? (
            <CustomPricesSection
              key={current.id}
              creatorId={current.id}
              creatorName={current.displayName}
              onDirty={setDirty}
            />
          ) : null}
        </div>
      );
    }
    if (shown === 'structures' && current !== undefined) return <StructuresView />;
    if (shown === 'stock' && current !== undefined)
      return <StockSection key={current.id} creatorId={current.id} creatorName={current.displayName} />;
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
    if (shownTab === 'account' && current !== undefined) {
      // One page, a card per subject (ADR 0149 § 1): an address of before lands on its card (`#part`). The short
      // ones first; her Telegram channel, the longest with its own cards, closes the page.
      return (
        <div className="cr-account" key={current.id}>
          <div id={accountCardId('access')} className="cr-account__card">
            <AccessSection creatorId={current.id} creatorName={current.displayName} />
          </div>
          <div id={accountCardId('rate')} className="cr-account__card">
            <AgencyRateSection
              creatorId={current.id}
              creatorName={current.displayName}
              onDirty={setRateDirty}
            />
          </div>
          {isOwner ? (
            <div id="paliers" className="cr-account__card">
              <FanTiersSection creatorId={current.id} />
            </div>
          ) : null}
          <div id={accountCardId('profile')} className="cr-account__card">
            <ProfileSection creatorId={current.id} creatorName={current.displayName} />
          </div>
          <div id={accountCardId('telegram')} className="cr-account__card">
            <TelegramChannelSection creatorId={current.id} onDirty={setTelegramDirty} />
          </div>
        </div>
      );
    }
    if (shown === 'alerts' && current !== undefined) {
      return <AlertsTab key={current.id} creatorId={current.id} creatorName={current.displayName} />;
    }
    return shown === 'hours' && current !== undefined ? (
      // Her AI: the copilot of the extension first, its switches decide what her chatters get beside Reveal; then her
      // hours (trous béants, 21/11: the switches had no screen, the drafts were off for every creator).
      <div className="cr-ai" key={current.id}>
        <CopilotSection creatorId={current.id} creatorName={current.displayName} />
        <HoursSection creatorId={current.id} creatorName={current.displayName} onDirty={setDirty} />
      </div>
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
  // The seven tabs of her sheet, in the header like every section's sub-tabs (NAV-10); they say where one is. Each
  // opens on the first of its views this member opens.
  const switchShown = sheets.length > 1 && current !== undefined && !showForm && query.isSuccess;
  const tabs = CREATOR_TABS.flatMap((name) => {
    const first = sheets.find((sheet) => tabOf(sheet) === name);
    return first === undefined ? [] : [{ name, first }];
  });
  // The views of the tab on screen this member opens: one alone needs no selector.
  const views = (TAB_VIEWS[shownTab]?.views ?? []).filter(([sheet]) => sheets.includes(sheet));
  const viewsLabel = TAB_VIEWS[shownTab]?.label ?? '';

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
                items={tabs.map(({ name, first }) => ({
                  to: '/creatrices',
                  search: sheetSearch(sheets, first, selected),
                  current: shownTab === name,
                  label: TAB_LABELS[name],
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
        {switchShown && views.length > 1 ? (
          <div className="cr-views">
            <ViewsSelector
              label={viewsLabel}
              value={shown}
              views={views}
              // Scripts says how many of hers wait to be copied, on the view that holds them.
              {...(shownTab === 'scripts' ? { readyOf: current.id } : {})}
              onChange={(sheet) =>
                void navigate({ to: '/creatrices', search: creatorsSearch(sheet, selected) })
              }
            />
          </div>
        ) : null}
        {body()}
        {/* The archived creators, folded at the foot of the list, the owner's alone (ADR 0071 § 2). */}
        {isOwner && listing && query.isSuccess ? <ArchivedCreators onRestored={onCreator} /> : null}
      </div>
    </Page>
  );
}

/** The views of the tab on screen; with `readyOf`, « À copier » carries the count of her scripts ready to copy. */
function ViewsSelector({
  label,
  value,
  views,
  readyOf,
  onChange,
}: {
  label: string;
  value: CreatorSheet;
  views: readonly (readonly [CreatorSheet, string])[];
  readyOf?: CreatorId;
  onChange: (sheet: CreatorSheet) => void;
}): JSX.Element {
  return readyOf === undefined ? (
    <Segment<CreatorSheet>
      label={label}
      value={value}
      options={views.map(([sheet, name]) => ({ value: sheet, label: name }))}
      onChange={onChange}
    />
  ) : (
    <ScriptsViewsSelector label={label} value={value} views={views} creatorId={readyOf} onChange={onChange} />
  );
}

function ScriptsViewsSelector({
  label,
  value,
  views,
  creatorId,
  onChange,
}: {
  label: string;
  value: CreatorSheet;
  views: readonly (readonly [CreatorSheet, string])[];
  creatorId: CreatorId;
  onChange: (sheet: CreatorSheet) => void;
}): JSX.Element {
  const scripts = usePreparedScripts(creatorId);
  const ready = (scripts.data ?? []).filter((one) => one.state === 'ready_to_copy').length;
  return (
    <Segment<CreatorSheet>
      label={label}
      value={value}
      options={views.map(([sheet, name]) => ({
        value: sheet,
        label: sheet === 'copy' && ready > 0 ? `${name} · ${String(ready)}` : name,
      }))}
      onChange={onChange}
    />
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
