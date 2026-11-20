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
 * the readings kept by age, the plan of a night bounded by Meta's quota, and the amber alerts (§ 6).
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

/**
 * The ages a reading made at `now` is kept at (§ 2): every age the media has passed and that has no reading yet. An
 * age already kept is never due again, so a later reading does not replace it and a job replayed writes nothing.
 */
export function agesDue(publishedAt: Date, now: Date, kept: readonly SnapshotAge[]): SnapshotAge[] {
  const age = now.getTime() - publishedAt.getTime();
  return SNAPSHOT_AGES.filter((step) => age >= AGE_MS[step] && !kept.includes(step));
}

/** The readings to keep of one reading of a media: one per age due, each with the real instant of the reading. */
export function snapshotsOf(
  media: Pick<InstagramMedia, 'ref' | 'publishedAt'>,
  numbers: MediaInsightNumbers,
  readAt: Date,
  kept: readonly SnapshotAge[],
): MediaInsightSnapshot[] {
  return agesDue(new Date(media.publishedAt), readAt, kept).map((age) => ({
    mediaRef: media.ref,
    age,
    readAt: readAt.toISOString(),
    numbers,
  }));
}

/** The part of Meta's hourly quota at which a job stops and waits, 0 to 1: it never runs up to the limit. */
const QUOTA_CEILING = 0.8;

/** The calls a job may still make this hour before it nears Meta's quota; 0 once near. */
export function callsLeft(callsThisHour: number, hourlyLimit: number): number {
  return Math.max(0, Math.floor(hourlyLimit * QUOTA_CEILING) - callsThisHour);
}

export interface ReadingPlan {
  /** The media to read now, the most recent first: a young media is the one whose age is about to pass. */
  readonly toRead: readonly InstagramMediaRef[];
  /** The media with an age due that wait for a later run: more than zero puts the job in amber. */
  readonly deferred: number;
}

/**
 * The plan of one run (§ 2): only the media with an age due are read, one call each, and never more than `budget`
 * calls. What does not fit waits for a later run; the plan is a finite list, so a job never loops on the quota.
 */
export function planReadings(
  media: readonly Pick<InstagramMedia, 'ref' | 'publishedAt'>[],
  keptOf: (media: InstagramMediaRef) => readonly SnapshotAge[],
  now: Date,
  budget: number,
): ReadingPlan {
  const due = media
    .filter((one) => agesDue(new Date(one.publishedAt), now, keptOf(one.ref)).length > 0)
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  const room = Math.max(0, Math.floor(budget));
  return { toRead: due.slice(0, room).map((one) => one.ref), deferred: Math.max(0, due.length - room) };
}

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
