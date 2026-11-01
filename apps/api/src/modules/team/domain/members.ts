import type { CreatorId, TeamMemberStatus, TeamRole, TeamScope } from '@nirvana/contracts';

import {
  CommissionDateInvalid,
  CommissionStartInvalid,
  CreatorNotFound,
  MemberLeftConflict,
  OwnerOnly,
  RoleDateInvalid,
  TeamScopeForbidden,
  TeamShareInvalid,
} from './errors';

/** Team rules (EQ-01, ADR 0023, ADR 0024), pure. A calendar day is `YYYY-MM-DD`, which sorts like the date. */

/** The day it is at `at` in `timeZone`: the agency's for rates and presets (ADR 0023 § Paie). */
export function calendarDayIn(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at);
  const get = (type: string): string => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/**
 * The e-mail as the account keeps it: Better Auth looks an account up in lower case at sign-in, so a member typed
 * « Theo@Example.test » must be stored as « theo@example.test », and the duplicate check compares that form.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** A rate or a preset applies from a day on, never to a day already worked: today at the earliest. */
export function assertStartsFromToday(effectiveFrom: string, today: string): void {
  if (effectiveFrom < today) throw new CommissionDateInvalid();
}

/**
 * A member's new rate starts on the first day of a period, the 1st or the 16th (Charles, 28/10), today at the earliest:
 * pay reads one rate per period, so no period is paid at two rates. The first rate starts the day he joins instead.
 */
export function assertStartsAPeriod(effectiveFrom: string, today: string): void {
  assertStartsFromToday(effectiveFrom, today);
  if (!startsAPeriod(effectiveFrom)) throw new CommissionStartInvalid();
}

/** The first day of a pay period: the 1st or the 16th of a month. */
function startsAPeriod(day: string): boolean {
  return day.endsWith('-01') || day.endsWith('-16');
}

/**
 * A change of role starts like a new rate (Charles, 28/10): on the 1st or the 16th, today at the earliest. Pay reads
 * the role of a period's last day, so a period is paid under one role: a chatter made a manager on the 16th has the
 * team share from that period on, never for the days before. The first role starts the day he joins instead.
 */
export function assertRoleStartsAPeriod(effectiveFrom: string, today: string): void {
  if (effectiveFrom < today || !startsAPeriod(effectiveFrom)) throw new RoleDateInvalid();
}

/** The role of a day: the latest one effective on that day, else the record's own (a member with no dated role). */
export function roleOn(
  roles: readonly { readonly teamRole: TeamRole; readonly effectiveFrom: string }[],
  day: string,
  recorded: TeamRole,
): TeamRole {
  return rateInForce(roles, day)?.teamRole ?? recorded;
}

/** A share of the team's net is a manager's; a chatter has none. */
export function assertTeamShareFits(teamRole: TeamRole, teamShareBps: number | null): void {
  if (teamShareBps !== null && teamRole !== 'manager') throw new TeamShareInvalid();
}

/** A member who left keeps his record, his statements and his invoices, but nothing of it changes any more. */
export function assertStillInTeam(status: TeamMemberStatus): void {
  if (status === 'left') throw new MemberLeftConflict();
}

/** The notes and the presets: the owner and the active managers only. */
export function assertReadsTeam(scope: TeamScope): void {
  if (scope === 'self') throw new TeamScopeForbidden();
}

/** Members, rates and presets are written by the owner only; the route guard and the policies say so too. */
export function assertOwnerScope(scope: TeamScope): void {
  if (scope !== 'owner') throw new OwnerOnly();
}

/** The rate (or the role) of a day: the latest one effective on that day, or `null` before the first one starts. */
export function rateInForce<T extends { readonly effectiveFrom: string }>(
  rates: readonly T[],
  day: string,
): T | null {
  let found: T | null = null;
  for (const rate of rates) {
    if (rate.effectiveFrom <= day && (found === null || rate.effectiveFrom > found.effectiveFrom))
      found = rate;
  }
  return found;
}

/** The presets offered on a day: for each name, its rate in force that day; by name. */
export function presetsInForce<T extends { readonly name: string; readonly effectiveFrom: string }>(
  presets: readonly T[],
  day: string,
): T[] {
  const byName = new Map<string, T[]>();
  for (const preset of presets) byName.set(preset.name, [...(byName.get(preset.name) ?? []), preset]);
  return [...byName.values()]
    .map((versions) => rateInForce(versions, day))
    .filter((preset): preset is T => preset !== null)
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

/** Each creator once, in the order given. */
export function uniqueCreatorIds(ids: readonly CreatorId[]): CreatorId[] {
  return [...new Set(ids)];
}

/** Refuses a creator that does not exist, naming the missing ones. */
export function assertCreatorsExist(asked: readonly CreatorId[], known: ReadonlySet<CreatorId>): void {
  const missing = asked.filter((id) => !known.has(id));
  if (missing.length > 0) throw new CreatorNotFound(missing);
}

/** Leaving empties the member's creators and ends his sessions (EQ-14 does the rest of the departure). */
export function leavesTeam(from: TeamMemberStatus, to: TeamMemberStatus): boolean {
  return from !== 'left' && to === 'left';
}
