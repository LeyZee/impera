import {
  ContentDropIdSchema,
  type ContentDrop,
  type CreatorContent,
  type DropCategory,
  type DropMediaKind,
  type DropState,
  type ScriptMoment,
  type ScriptSegment,
  type ShotMoment,
  type UserRole,
} from '@impera/contracts';

import { ContentDropForbidden } from '../domain/errors';
import type { AgencyContentStore, ScriptVersions } from '../domain/ports';

/**
 * The agency's reads of her content, for both doors (ADR 0026 § 1): the route and the MCP server call these, never the
 * store, so that the rule of who reads lives here once. Who reads is checked here (the owner and the team, never her
 * own account nor another role); the store then keeps the team's scope (a chatter in `self` is refused) and her RLS.
 */
export interface ContentReader {
  readonly userId: string;
  readonly role: UserRole;
}

/** At most this many drops a page (ADR 0026 § 5: 50 items a call at most, no bulk export). */
const DROPS_PAGE_MAX = 50;

function agencyOnly(reader: ContentReader): void {
  if (reader.role !== 'owner' && reader.role !== 'operator') throw new ContentDropForbidden();
}

/** `GET /v1/creators/:creatorId/content`: her requests and her latest drops, as the agency's screen reads them. */
export async function agencyContent(
  store: AgencyContentStore,
  reader: ContentReader,
  creatorId: string,
): Promise<CreatorContent> {
  agencyOnly(reader);
  return store.content(creatorId, reader.userId);
}

/** A drop of hers without a medium nor where it lies: what it is, where it stands, how many files of each kind. */
interface DropDigest {
  readonly id: string;
  readonly category: DropCategory;
  readonly state: DropState;
  /** What she wrote with it: her words, free text. */
  readonly sentence: string | null;
  readonly requestId: string | null;
  /** Her sent script's number (`S014`); `null` for another drop or a script being filled. */
  readonly scriptNumber: number | null;
  readonly files: Readonly<Record<DropMediaKind, number>>;
  readonly createdAt: Date;
}

export interface DropsPage {
  readonly drops: readonly DropDigest[];
  /** The `after` of the next page; `null` when this one is the last. */
  readonly next: string | null;
}

function digestOf(drop: ContentDrop): DropDigest {
  const files: Record<DropMediaKind, number> = { image: 0, video: 0, audio: 0 };
  for (const file of drop.files) files[file.kind] += 1;
  return {
    id: drop.id,
    category: drop.category,
    state: drop.state,
    sentence: drop.sentence,
    requestId: drop.requestId,
    scriptNumber: drop.scriptNumber,
    files,
    createdAt: new Date(drop.createdAt),
  };
}

/**
 * Her drops, newest first, a page at a time (MCP `drops_list`): never a medium, its key nor its address. `after` is the
 * last drop of the page before; one that is not an id of hers gives an empty page, one withdrawn since keeps its place.
 */
export async function creatorDrops(
  store: AgencyContentStore,
  reader: ContentReader,
  creatorId: string,
  page: { readonly after: string | null; readonly limit?: number },
): Promise<DropsPage> {
  agencyOnly(reader);
  const limit = Math.min(Math.max(Math.trunc(page.limit ?? DROPS_PAGE_MAX), 1), DROPS_PAGE_MAX);
  if (page.after !== null && !ContentDropIdSchema.safeParse(page.after).success)
    return { drops: [], next: null };
  // One more than the page says whether another follows.
  const drops = await store.dropsPage(creatorId, reader.userId, page.after, limit + 1);
  const shown = drops.slice(0, limit).map(digestOf);
  return { drops: shown, next: drops.length > limit ? (shown.at(-1)?.id ?? null) : null };
}

/** A script of hers (MCP `scripts_list`): which structure it shoots and where it stands, never a medium. */
export interface ScriptDigest {
  readonly dropId: string;
  readonly scriptNumber: number | null;
  /** The structure's name in its frozen version: the agency's words; `null` for a script that names no version. */
  readonly name: string | null;
  /** Jour or Nuit, as her request fixed it, else the structure's (`both`); `null` without a version. */
  readonly moment: ShotMoment | ScriptMoment | null;
  /** How many stages and bridges its version has. */
  readonly stages: number;
  readonly bridges: number;
  readonly state: DropState;
  readonly dueOn: string;
  readonly exportedAt: Date | null;
  readonly createdAt: Date;
}

interface ScriptReads {
  readonly store: AgencyContentStore;
  readonly versions: ScriptVersions;
}

/** Her scripts asked and dropped, newest first, each with its structure's name and size (MCP `scripts_list`). */
export async function creatorScripts(
  deps: ScriptReads,
  reader: ContentReader,
  creatorId: string,
): Promise<readonly ScriptDigest[]> {
  agencyOnly(reader);
  const entries = await deps.store.scriptDrops(creatorId, reader.userId);
  return Promise.all(
    entries.map(async (entry): Promise<ScriptDigest> => {
      const version = entry.versionId === null ? null : await deps.versions.frozen(entry.versionId);
      const segments = version?.segments ?? [];
      return {
        dropId: entry.dropId,
        scriptNumber: entry.scriptNumber,
        name: version?.name ?? null,
        moment: entry.moment ?? version?.moment ?? null,
        stages: segments.filter((segment) => segment.kind === 'stage').length,
        bridges: segments.filter((segment) => segment.kind === 'bridge').length,
        state: entry.state,
        dueOn: entry.dueOn,
        exportedAt: entry.exportedAt,
        createdAt: entry.createdAt,
      };
    }),
  );
}

/** The steps of a script of hers (MCP `script_steps_get`, `read:script_content`): its frozen version, the agency's words. */
export interface ScriptSteps {
  readonly dropId: string;
  readonly name: string;
  readonly moment: ShotMoment | ScriptMoment;
  readonly segments: readonly ScriptSegment[];
}

/** `null` for a drop that is not a script of hers, or a script that names no frozen version. */
export async function creatorScriptSteps(
  deps: ScriptReads,
  reader: ContentReader,
  creatorId: string,
  dropId: string,
): Promise<ScriptSteps | null> {
  agencyOnly(reader);
  if (!ContentDropIdSchema.safeParse(dropId).success) return null;
  const entry = (await deps.store.scriptDrops(creatorId, reader.userId)).find(
    (each) => each.dropId === dropId,
  );
  if (entry?.versionId === undefined || entry.versionId === null) return null;
  const version = await deps.versions.frozen(entry.versionId);
  if (version === null) return null;
  return { dropId, name: version.name, moment: entry.moment ?? version.moment, segments: version.segments };
}
