import type {
  LinkSalesFeedChatterBody,
  Platform,
  SalesFeedErrorKind,
  TeamImportCounts,
  TeamImportLinksBody,
  TeamImportLinksResult,
  TeamImportOverview,
  TeamImportRowErrorKind,
  TeamPlatformRemoval,
} from '@impera/contracts';

import { SalesFeedTeamForbidden, SalesFeedTeamLinked, SalesFeedTeamListUnavailable } from '../domain/errors';
import type { Clock } from '../domain/ports';
import { errorKindOf, type PlatformSalesFeed } from '../domain/sales-feed';
import {
  teamImportOverview,
  type LiveTeam,
  type TeamImportStore,
  type TeamLinkRequest,
} from '../domain/team-import';

export interface TeamImportDeps {
  readonly store: TeamImportStore;
  readonly clock: Clock;
  /** The feed of the saved key, `null` without one that works, with the reason kept with the key. */
  readonly live: (
    platform: Platform,
  ) => Promise<{ readonly feed: PlatformSalesFeed | null; readonly error: SalesFeedErrorKind | null }>;
}

/** The team imported from a platform after review (ADR 0076): the owner's and an active manager's screen. */
export interface TeamImport {
  overview(platform: Platform, userId: string): Promise<TeamImportOverview>;
  counts(platform: Platform, userId: string): Promise<TeamImportCounts>;
  /** The batch (§ 1): each row checked against the live list and the viewer's rights; a refused one leaves the rest. */
  link(platform: Platform, userId: string, body: TeamImportLinksBody): Promise<TeamImportLinksResult>;
  dismiss(
    platform: Platform,
    userId: string,
    platformChatterId: string,
    dismissed: boolean,
  ): Promise<TeamImportOverview>;
  /** What a successful reading of the list saw, kept for the badges and the removal alerts (§ 5, § 6). */
  recordReading(platform: Platform, feed: PlatformSalesFeed): Promise<void>;
  /** Each active member linked to an account removed or gone on a platform (§ 5): Équipe shows them. */
  removals(userId: string): Promise<TeamPlatformRemoval[]>;
}

const ROW_ERRORS: Readonly<Record<TeamImportRowErrorKind, string>> = {
  own_link: 'Le lien vers ta propre fiche est au propriétaire',
  external_owner_only: 'Relier le compte d’un prestataire à un membre est réservé au propriétaire',
  external_no_agent: 'Le compte d’un prestataire se relie à un membre ou à personne, jamais à l’agent',
  not_listed: 'Ce compte n’est plus dans la liste de la plateforme',
  member_unknown: 'Ce membre n’existe pas ou est parti',
};

export const teamLinkOf = (link: LinkSalesFeedChatterBody): TeamLinkRequest['link'] =>
  link.kind === 'none' ? null : link.kind === 'agent' ? { kind: 'agent' } : link;

export function createTeamImport(deps: TeamImportDeps): TeamImport {
  const { store, clock } = deps;

  /** The owner or an active manager, checked before the platform is asked or anything is written (§ 8). */
  async function allowed(userId: string): Promise<void> {
    if ((await store.viewer(userId)) === null) throw new SalesFeedTeamForbidden();
  }

  async function read(platform: Platform, userId: string): Promise<TeamImportOverview> {
    await allowed(userId);
    const { feed, error } = await deps.live(platform);
    let live: LiveTeam = { chatters: null, handles: new Map(), listError: error, sessionChatterId: null };
    if (feed !== null) {
      const [chatters, models] = await Promise.all([feed.listChatters(), feed.listModels()]);
      if (chatters.ok) await store.recordReading(platform, chatters.value, clock.now());
      live = {
        chatters: chatters.ok ? chatters.value : null,
        handles: new Map(models.ok ? models.value.map((model) => [model.platformModelId, model.handle]) : []),
        listError: chatters.ok ? null : errorKindOf(chatters.failure),
        // The captured session's account is not known by its id yet (ADR 0050 § 5, to check at the first real call):
        // until then an account named « bot » is proposed unticked.
        sessionChatterId: null,
      };
    }
    const context = await store.context(userId, platform);
    if (context === null) throw new SalesFeedTeamForbidden();
    return teamImportOverview(context, live);
  }

  return {
    overview: read,

    async counts(platform, userId) {
      const counts = await store.counts(userId, platform);
      if (counts === null) throw new SalesFeedTeamForbidden();
      return counts;
    },

    async link(platform, userId, body) {
      await allowed(userId);
      const { feed } = await deps.live(platform);
      const listed = feed === null ? null : await feed.listChatters();
      // Without the live list, nothing says whether an account is a provider's: the batch waits for it (503).
      if (listed?.ok !== true) throw new SalesFeedTeamListUnavailable();
      const live = new Map(listed.value.map((chatter) => [chatter.platformChatterId, chatter]));
      // An account the platform no longer lists can still lose its link (« Personne »), never get one.
      const known = body.items.filter(
        (item) => live.has(item.platformChatterId) || item.link.kind === 'none',
      );
      const outcomes = await store.link(
        userId,
        platform,
        known.map((item) => ({
          platformChatterId: item.platformChatterId,
          link: teamLinkOf(item.link),
          isExternal: live.get(item.platformChatterId)?.isExternal === true,
        })),
      );
      if (outcomes === null) throw new SalesFeedTeamForbidden();
      const byId = new Map(known.map((item, index) => [item.platformChatterId, outcomes[index]]));
      const results = body.items.map((item): TeamImportLinksResult['results'][number] => {
        const outcome = byId.get(item.platformChatterId);
        const kind: TeamImportRowErrorKind | null =
          outcome === undefined ? 'not_listed' : outcome.ok ? null : outcome.kind;
        return kind === null
          ? { platformChatterId: item.platformChatterId, ok: true }
          : {
              platformChatterId: item.platformChatterId,
              ok: false,
              error: { kind, message: ROW_ERRORS[kind] },
            };
      });
      return { results, overview: await read(platform, userId) };
    },

    async dismiss(platform, userId, platformChatterId, dismissed) {
      await allowed(userId);
      const done = await store.dismiss(userId, platform, platformChatterId, dismissed);
      if (done === 'forbidden') throw new SalesFeedTeamForbidden();
      if (done === 'linked') throw new SalesFeedTeamLinked();
      return read(platform, userId);
    },

    removals: (userId) => store.removals(userId),

    async recordReading(platform, feed) {
      const chatters = await feed.listChatters();
      if (chatters.ok) await store.recordReading(platform, chatters.value, clock.now());
    },
  };
}
