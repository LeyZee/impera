import {
  LevelSettingsSchema,
  MePreferencesSchema,
  MyShiftChallengeSchema,
  TrophyCaseSchema,
  type LevelSettings,
  type Me,
  type MePreferences,
  type ShiftChallenge,
  type TrophyCase,
} from '@impera/contracts';
import { useQuery, useQueryClient, type QueryClient, type UseQueryResult } from '@tanstack/react-query';

/*
 * The chatter's own trophy case and the account's own preferences (ADR 0104 § 12 to § 19). Reads and writes name no
 * account: the server answers for the session.
 */

const CASE_KEY = ['rewards', 'my-trophy-case'] as const;
const PREFERENCES_KEY = ['me', 'preferences'] as const;
const JSON_HEADERS = { 'content-type': 'application/json' };

async function send<T>(
  method: 'GET' | 'POST' | 'PUT',
  url: string,
  body: unknown,
  parse: (json: unknown) => T,
) {
  const response = await fetch(url, {
    method,
    credentials: 'include',
    ...(method === 'GET' ? {} : { headers: JSON_HEADERS, body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new Error(`${method} ${url}: ${String(response.status)}`);
  return parse(await response.json());
}

/** Who plays: a chatter. The owner, a manager and a creator have no case here (§ 20). */
export const playsTheGame = (user: Me): boolean => user.role === 'operator' && user.team?.role === 'chatter';

/** The session's trophy case; read again every minute, a gain is noted by a job. */
export function useMyTrophyCase(enabled: boolean): UseQueryResult<TrophyCase> {
  return useQuery({
    queryKey: CASE_KEY,
    queryFn: () => send('GET', '/v1/rewards/my-trophy-case', null, (json) => TrophyCaseSchema.parse(json)),
    enabled,
    refetchInterval: 60_000,
    retry: false,
  });
}

/** The session's challenge for the shift under way or just ended (§ 14); `null` when there is none. */
export function useMyShiftChallenge(enabled: boolean): UseQueryResult<ShiftChallenge | null> {
  return useQuery({
    queryKey: ['rewards', 'my-shift-challenge'],
    queryFn: () =>
      send(
        'GET',
        '/v1/rewards/my-shift-challenge',
        null,
        (json) => MyShiftChallengeSchema.parse(json).challenge,
      ),
    enabled,
    refetchInterval: 60_000,
    retry: false,
  });
}

/** A member's trophies, streak and rank, on their file: the owner's and a manager's read (§ 20). */
export function useMemberTrophyCase(memberId: string, enabled: boolean): UseQueryResult<TrophyCase> {
  return useQuery({
    queryKey: ['rewards', 'member-trophy-case', memberId],
    queryFn: () =>
      send('GET', `/v1/rewards/members/${memberId}/trophy-case`, null, (json) =>
        TrophyCaseSchema.parse(json),
      ),
    enabled,
    retry: false,
  });
}

const LEVELS_KEY = ['rewards', 'level-thresholds'] as const;

/** The ranks and the thresholds the owner set (§ 16): the owner's read. */
export function useLevelSettings(enabled: boolean): UseQueryResult<LevelSettings> {
  return useQuery({
    queryKey: LEVELS_KEY,
    queryFn: () =>
      send('GET', '/v1/rewards/level-thresholds', null, (json) => LevelSettingsSchema.parse(json)),
    enabled,
    retry: false,
  });
}

/** Saves the thresholds; answers whether the server took them. */
export function useSaveLevelThresholds(): (thresholdsMinor: readonly number[]) => Promise<boolean> {
  const client = useQueryClient();
  return (thresholdsMinor) =>
    send('PUT', '/v1/rewards/level-thresholds', { thresholdsMinor }, (json) =>
      LevelSettingsSchema.parse(json),
    )
      .then((saved) => {
        client.setQueryData(LEVELS_KEY, saved);
        return true;
      })
      .catch(() => false);
}

/** Marks reveals as seen; the case the server answers replaces the one in hand. A failure is tried again next time. */
export function useMarkRevealed(): (kinds: readonly string[]) => void {
  const client = useQueryClient();
  return (kinds) => {
    void send('POST', '/v1/rewards/my-trophy-case/reveals', { kinds }, (json) => TrophyCaseSchema.parse(json))
      .then((next) => client.setQueryData(CASE_KEY, next))
      .catch(() => undefined);
  };
}

const HER_CASE_KEY = ['rewards', 'creator-space', 'trophy-case'] as const;

/** When her case is read again after a gesture: the game runs two seconds after it, the second read covers a busy worker. */
const LOOK_AGAIN_MS = [4_000, 12_000] as const;

/**
 * After a tick or a drop of hers, her case is read again a few seconds later (ADR 0107 § 14, recette 16/11 CRE-06): the
 * game, asked by the server in the same transaction, has noted a gain by then, and its reveal plays where she is.
 */
export function lookAgainAtHerCase(client: QueryClient): void {
  for (const delay of LOOK_AGAIN_MS)
    window.setTimeout(() => {
      void client.invalidateQueries({ queryKey: HER_CASE_KEY });
    }, delay);
}

/** Her own trophy case (ADR 0107 § 10), the creator's; read again every minute, a gain is noted by a job. */
export function useHerTrophyCase(enabled: boolean): UseQueryResult<TrophyCase> {
  return useQuery({
    queryKey: HER_CASE_KEY,
    queryFn: () => send('GET', '/v1/creator-space/trophy-case', null, (json) => TrophyCaseSchema.parse(json)),
    enabled,
    refetchInterval: 60_000,
    retry: false,
  });
}

/** Marks her reveals as seen (§ 11); her case as the server answers it replaces the one in hand. */
export function useMarkHerRevealed(): (kinds: readonly string[]) => void {
  const client = useQueryClient();
  return (kinds) => {
    void send('POST', '/v1/creator-space/trophy-case/reveals', { kinds }, (json) =>
      TrophyCaseSchema.parse(json),
    )
      .then((next) => client.setQueryData(HER_CASE_KEY, next))
      .catch(() => undefined);
  };
}

/** The account's preferences, as the session read them, then as it last saved them. */
export function usePreferences(user: Me): {
  readonly preferences: MePreferences;
  readonly save: (next: MePreferences) => void;
} {
  const client = useQueryClient();
  const { data } = useQuery({
    queryKey: PREFERENCES_KEY,
    queryFn: () => Promise.resolve(user.preferences),
    initialData: user.preferences,
    staleTime: Number.POSITIVE_INFINITY,
  });
  return {
    preferences: data,
    save: (next) => {
      const before = client.getQueryData<MePreferences>(PREFERENCES_KEY) ?? user.preferences;
      client.setQueryData(PREFERENCES_KEY, next);
      void send('PUT', '/v1/me/preferences', next, (json) => MePreferencesSchema.parse(json))
        .then((saved) => client.setQueryData(PREFERENCES_KEY, saved))
        .catch(() => client.setQueryData(PREFERENCES_KEY, before));
    },
  };
}
