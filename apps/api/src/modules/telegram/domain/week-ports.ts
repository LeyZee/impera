import type {
  ChannelPlannedPost,
  ChannelPlannedPostId,
  ChannelPostDraft,
  ChannelPostState,
  ChannelReview,
  CreatorId,
} from '@impera/contracts';

import type { PlannedSlot } from './week-plan';

/** ADR 0162: the ports of her channel's week. The adapters live in `infra/`, the composition root wires them. */

/** A post about to be written in the plan: the slot, and its key that makes the plan replayable. */
export interface NewPlannedPost extends PlannedSlot {
  readonly creatorId: CreatorId;
  readonly week: string;
  readonly planKey: string;
  readonly replacesId: ChannelPlannedPostId | null;
}

export interface WeekPostChange {
  readonly draft?: ChannelPostDraft | null;
  readonly mediaId?: string | null;
  readonly why?: string | null;
  readonly repost?: boolean;
  readonly locked?: boolean;
  readonly review?: ChannelReview | null;
  readonly reviewedBy?: string | null;
  readonly state?: ChannelPostState;
  readonly reason?: string | null;
}

/** Her channel's week, read and written one creator at a time, in her transaction (`withTenantJob`). */
export interface ChannelWeekStore {
  /** Inserts the posts whose key is not there yet; the ones already planned stay as they are. Returns the new ones. */
  plan(creatorId: CreatorId, posts: readonly NewPlannedPost[]): Promise<readonly ChannelPlannedPost[]>;
  week(creatorId: CreatorId, week: string): Promise<readonly ChannelPlannedPost[]>;
  find(creatorId: CreatorId, id: ChannelPlannedPostId): Promise<ChannelPlannedPost | null>;
  /** Writes a change on a post still `planned`; false when it moved meanwhile (sent, removed by someone else). */
  update(creatorId: CreatorId, id: ChannelPlannedPostId, change: WeekPostChange): Promise<boolean>;
  /** Her posts still `planned` whose hour has come, oldest first. */
  due(creatorId: CreatorId, now: Date, limit: number): Promise<readonly ChannelPlannedPost[]>;
  /** Posts still `planned` without a text yet, whose hour comes before `until`, soonest first. */
  toWrite(creatorId: CreatorId, until: Date, limit: number): Promise<readonly ChannelPlannedPost[]>;
  /**
   * Takes a due post out of `planned` before Telegram is called (as `failed`, « Envoi en cours »), with the text and
   * visual it goes out with: false when someone else took it (a replay). A crash after it never sends it twice.
   */
  claim(
    creatorId: CreatorId,
    id: ChannelPlannedPostId,
    draft: ChannelPostDraft,
    mediaId: string | null,
  ): Promise<boolean>;
  /** A claimed post that Telegram took. */
  markSent(
    creatorId: CreatorId,
    id: ChannelPlannedPostId,
    telegramMessageId: number,
    at: Date,
  ): Promise<void>;
  /** A claimed post that Telegram refused, or whose answer was lost, with the amber line. */
  markFailed(creatorId: CreatorId, id: ChannelPlannedPostId, reason: string): Promise<void>;
  /** The last posts that went out on her channel, newest first (the chat reads them, § 4.5). */
  lastSent(creatorId: CreatorId, limit: number): Promise<readonly ChannelPlannedPost[]>;
}

/** What Telegram is asked to publish on her channel; the bot's token is read by the adapter, never here. */
export type ChannelOutgoing =
  | { readonly kind: 'text'; readonly html: string }
  | { readonly kind: 'photo' | 'video'; readonly file: ChannelFile; readonly html: string }
  | { readonly kind: 'poll'; readonly question: string; readonly options: readonly string[] };

/** A visual the code allows for her channel (ADR 0162 § 5.2): public, never sold, described and validated. */
interface ChannelVisual {
  readonly mediaId: string;
  readonly kind: 'photo' | 'video';
  /** Its validated description (ADR 0083), what the voice reads to choose and to write. */
  readonly description: string;
}

/** A visual's file, fetched by the media module and uploaded to Telegram: no address of the storage ever leaves. */
export interface ChannelFile {
  readonly bytes: Uint8Array;
  readonly filename: string;
  readonly mime: string;
}

/** Her visuals the code allows, from the media module; wired by the composition root, matched by shape. */
export interface ChannelVisualsSource {
  /** The evening's candidates: the day's public feed video, the teaser of a new session, her Telegram stock. */
  eveningCandidates(creatorId: CreatorId, day: string): Promise<readonly ChannelVisual[]>;
  /** Her Telegram stock not yet sent on the channel, oldest first. */
  telegramStock(creatorId: CreatorId): Promise<readonly ChannelVisual[]>;
  /** Its file; `gone` when it is no longer there, `too_big` above what a bot may send (50 MB). */
  file(creatorId: CreatorId, mediaId: string): Promise<ChannelFile | 'gone' | 'too_big'>;
}
