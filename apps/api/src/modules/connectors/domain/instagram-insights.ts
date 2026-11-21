import {
  META_PUBLISH_SCOPES,
  META_READ_SCOPES,
  SNAPSHOT_AGES,
  type InstagramAccountCapabilities,
  type InstagramMedia,
  type InstagramMediaRef,
  type LiveStory,
  type MediaInsightNumbers,
  type MediaInsightSnapshot,
  type SnapshotAge,
} from '@impera/contracts';

/**
 * Her Instagram account read only (ADR 0120 § 1 and § 2), pure: the port, what a grant of Meta lets the account do,
 * the readings kept by age and the steps missed, the plan of a night bounded by Meta's quota, and the amber alerts
 * (§ 6).
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Her account, read only: the port has no method that publishes, comments or sends, so no caller can. An adapter
 * throws on a refusal or an outage; it never answers with a guess.
 */
export interface InstagramInsightsPort {
  readonly capabilities: InstagramAccountCapabilities;
  /** Her media published since `since`, the ones she posted by hand from the application included. */
  listMedia(since: Date): Promise<readonly InstagramMedia[]>;
  readInsights(media: InstagramMediaRef): Promise<MediaInsightNumbers>;
  listLiveStories(): Promise<readonly LiveStory[]>;
}

export type MetaGrant =
  | { readonly accepted: true; readonly capabilities: InstagramAccountCapabilities }
  | {
      readonly accepted: false;
      readonly reason: 'asked_outside_list' | 'unexpected_scope' | 'read_scope_missing';
    };

/** Every right this connector may ever ask of Meta: the closed lists of the contracts, and nothing else. */
const ADMITTED_SCOPES: readonly string[] = [...META_READ_SCOPES, ...META_PUBLISH_SCOPES];

/**
 * What a grant lets the account do (§ 1). `asked` is what this consent asked for, `granted` what Meta says it gave,
 * read again after the exchange. A right granted that was not asked refuses the whole connection; so does a missing
 * right to read. The flag to publish needs the right to have been asked by this consent and granted.
 *
 * The closed list is held here, not by the caller: a consent that asks for a right outside the list is refused
 * whatever Meta answers, and a right granted outside the list refuses the connection whatever was asked.
 */
export function grantOf(asked: readonly string[], granted: readonly string[]): MetaGrant {
  if (asked.some((scope) => !ADMITTED_SCOPES.includes(scope))) {
    return { accepted: false, reason: 'asked_outside_list' };
  }
  if (granted.some((scope) => !ADMITTED_SCOPES.includes(scope) || !asked.includes(scope))) {
    return { accepted: false, reason: 'unexpected_scope' };
  }
  if (META_READ_SCOPES.some((scope) => !granted.includes(scope))) {
    return { accepted: false, reason: 'read_scope_missing' };
  }
  return {
    accepted: true,
    capabilities: { read: true, publish: META_PUBLISH_SCOPES.every((scope) => granted.includes(scope)) },
  };
}

const AGE_MS: Record<SnapshotAge, number> = {
  '1h': HOUR_MS,
  '24h': DAY_MS,
  '48h': 2 * DAY_MS,
  '7d': 7 * DAY_MS,
};

/** Where the window of each step ends: at the next step, and at twice its age for the last one. */
const WINDOW_END_MS: Record<SnapshotAge, number> = {
  '1h': DAY_MS,
  '24h': 2 * DAY_MS,
  '48h': 7 * DAY_MS,
  '7d': 14 * DAY_MS,
};

export interface StepsDue {
  /** The step a reading made now fills: the one whose window holds the age of the media, when it is not kept yet. */
  readonly fill: SnapshotAge | null;
  /** The steps whose window passed without a reading: kept missed, without a number. */
  readonly missed: readonly SnapshotAge[];
}

/**
 * What a media owes at `now` (§ 2, amendment of 20/11/2026). A reading fills one step at most: the one whose window,
 * from its age to the next step, holds the age of the media. A step whose window is over and that has no reading is
 * missed: a figure read later never enters it. A step already kept, read or missed, is never due again, so a job
 * replayed writes nothing.
 */
export function stepsDue(publishedAt: Date, now: Date, kept: readonly SnapshotAge[]): StepsDue {
  const age = now.getTime() - publishedAt.getTime();
  const open = SNAPSHOT_AGES.filter((step) => !kept.includes(step));
  return {
    fill: open.find((step) => age >= AGE_MS[step] && age < WINDOW_END_MS[step]) ?? null,
    missed: open.filter((step) => age >= WINDOW_END_MS[step]),
  };
}

/**
 * The rows to keep of a media at `at`: its missed steps, without a number, and the step the reading fills when
 * `numbers` is given. Without a reading (`numbers` null: the media needed none, or the quota kept it for later) only
 * the missed steps are kept, and the step still open stays due.
 */
export function snapshotsOf(
  media: Pick<InstagramMedia, 'ref' | 'publishedAt'>,
  numbers: MediaInsightNumbers | null,
  at: Date,
  kept: readonly SnapshotAge[],
): MediaInsightSnapshot[] {
  const due = stepsDue(new Date(media.publishedAt), at, kept);
  const row = (age: SnapshotAge, read: MediaInsightNumbers | null): MediaInsightSnapshot => ({
    mediaRef: media.ref,
    age,
    readAt: at.toISOString(),
    numbers: read,
  });
  const rows = due.missed.map((age) => row(age, null));
  if (numbers !== null && due.fill !== null) rows.push(row(due.fill, numbers));
  return rows;
}

/** The part of Meta's hourly quota at which a job stops and waits, 0 to 1: it never runs up to the limit. */
const QUOTA_CEILING = 0.8;

/** The calls a job may still make this hour before it nears Meta's quota; 0 once near. */
export function callsLeft(callsThisHour: number, hourlyLimit: number): number {
  return Math.max(0, Math.floor(hourlyLimit * QUOTA_CEILING) - callsThisHour);
}

/**
 * The calls left for the readings of a run once its listings are paid: each page of `listMedia` and the one call of
 * `listLiveStories` count against Meta's quota like a reading does.
 */
export function readingBudget(left: number, mediaPagesListed: number, storiesListed: boolean): number {
  return Math.max(0, Math.floor(left) - mediaPagesListed - (storiesListed ? 1 : 0));
}

export interface ReadingPlan {
  /** The media to read now, the most recent first: a young media is the one whose window closes soonest. */
  readonly toRead: readonly InstagramMediaRef[];
  /** The media with a step to fill that wait for a later run: more than zero puts the job in amber. */
  readonly deferred: number;
}

/**
 * The plan of one run (§ 2): only the media with a step to fill now are read, one call each, and never more than
 * `budget` calls. What does not fit waits for a later run; the plan is a finite list, so a job never loops on the
 * quota. A media that only has missed steps costs no call: `snapshotsOf` marks them without a reading.
 */
export function planReadings(
  media: readonly Pick<InstagramMedia, 'ref' | 'publishedAt'>[],
  keptOf: (media: InstagramMediaRef) => readonly SnapshotAge[],
  now: Date,
  budget: number,
): ReadingPlan {
  const due = media
    .filter((one) => stepsDue(new Date(one.publishedAt), now, keptOf(one.ref)).fill !== null)
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  const room = Math.max(0, Math.floor(budget));
  return { toRead: due.slice(0, room).map((one) => one.ref), deferred: Math.max(0, due.length - room) };
}

/** A media as the readings need it: its name, its kind and its hour, never its caption. */
type ReadableMedia = Pick<InstagramMedia, 'ref' | 'kind' | 'publishedAt'>;

/** A media with the steps already kept of it, read or missed. */
export interface KeptMedia extends ReadableMedia {
  readonly kept: readonly SnapshotAge[];
}

/** The rows to keep of one media after a run. */
interface MediaSnapshots {
  readonly media: ReadableMedia;
  readonly snapshots: readonly MediaInsightSnapshot[];
}

/** Where the readings are kept, one creator at a time. A step kept is never written again. */
export interface MediaInsightStore {
  /** Her media published since `since`, and the older ones that still have a step open, with their steps kept. */
  keptOf(creatorId: string, since: Date): Promise<readonly KeptMedia[]>;
  /** Keeps the rows; a step already kept is left as it is. Answers how many rows were really added. */
  record(creatorId: string, rows: readonly MediaSnapshots[]): Promise<number>;
}

/** How far back a run lists her media: the end of the last window. An older media has nothing left to read. */
export const LISTING_WINDOW_MS = WINDOW_END_MS['7d'];

/** Whether the day of `now`, cut at `dayStart`, has its story: one of her stories online was published since. */
export function dayHasStory(stories: readonly Pick<LiveStory, 'publishedAt'>[], dayStart: Date): boolean {
  return stories.some((story) => Date.parse(story.publishedAt) >= dayStart.getTime());
}

/** The days before a token expires under which the account turns amber (§ 6). */
const TOKEN_WARNING_DAYS = 7;

export type TokenState = 'valid' | 'expiring' | 'expired';

/** The state of the sealed token: amber under seven days, expired once its instant is reached (§ 6). */
export function tokenState(expiresAt: Date, now: Date): TokenState {
  const left = expiresAt.getTime() - now.getTime();
  if (left <= 0) return 'expired';
  return left < TOKEN_WARNING_DAYS * DAY_MS ? 'expiring' : 'valid';
}

/** A reading that fails two nights in a row is an amber alert (§ 6); one failed night is not. */
export function readingFailureAlert(failedNightsInARow: number): boolean {
  return failedNightsInARow >= 2;
}
