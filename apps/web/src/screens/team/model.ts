import {
  COUNTRY_CODES,
  PayPeriodSchema,
  type CommissionPreset,
  type CommissionRate,
  type CreatorSummary,
  type PayPeriod,
  type TeamMember,
  type TeamMemberErrorCode,
  type TeamMemberStatus,
  type TeamRole,
} from '@nirvana/contracts';

import { countryName } from '@/lib/country';
import { memberOf } from '@/lib/utils';
import { mondayOf, withFirstOfMonth } from '@/scheduling/time';

/**
 * Équipe › Membres, without React (EQ-01): who shows in which tab, how a status, a rate, a country and an invitation
 * read, and what each refusal of the server says. The server decides; this only says it.
 */

/** The glossary's words (« Membre de l'équipe »), as a pill. */
export const STATUS_LABELS: Readonly<Record<TeamMemberStatus, string>> = {
  active: 'Actif',
  on_leave: 'En congé',
  sick: 'Malade',
  travelling: 'En déplacement',
  suspended: 'Suspendu',
  left: 'Parti',
};

/** A status's tone: green at work, quiet while away, amber when suspended. Red stays for urgencies. */
export type StatusTone = 'ok' | 'away' | 'warn' | 'gone';
export const STATUS_TONES: Readonly<Record<TeamMemberStatus, StatusTone>> = {
  active: 'ok',
  on_leave: 'away',
  sick: 'away',
  travelling: 'away',
  suspended: 'warn',
  left: 'gone',
};

export const ROLE_LABELS: Readonly<Record<TeamRole, string>> = { chatter: 'Chatteur', manager: 'Manager' };

/** The two tabs of the list, in the plural. */
export const TAB_LABELS: Readonly<Record<TeamRole, string>> = { chatter: 'Chatteurs', manager: 'Managers' };

const fold = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();

/** Whether a member answers a search: his names, his e-mail or his country, accents and case aside. */
export function matches(member: TeamMember, query: string): boolean {
  const wanted = fold(query);
  if (wanted === '') return true;
  const haystack = [
    member.displayName,
    member.firstName,
    member.lastName,
    member.email,
    countryName(member.country),
  ];
  return haystack.some((text) => fold(text).includes(wanted));
}

export interface MemberLists {
  /** The members of the tab who answer the search and have not left, in the order below. */
  readonly current: readonly TeamMember[];
  /** Those who left, folded at the foot of the list: never deleted (EQ-14). */
  readonly gone: readonly TeamMember[];
  /** How many have not left, per tab, search aside: the counts on the tabs. */
  readonly counts: Readonly<Record<TeamRole, number>>;
}

const ORDER: readonly TeamMemberStatus[] = ['active', 'travelling', 'on_leave', 'sick', 'suspended', 'left'];

/** Split and order: at work first, then away, then suspended; by name inside each. */
export function listMembers(members: readonly TeamMember[], tab: TeamRole, query: string): MemberLists {
  const counts: Record<TeamRole, number> = { chatter: 0, manager: 0 };
  for (const member of members) if (member.status !== 'left') counts[member.teamRole] += 1;
  const shown = members
    .filter((member) => member.teamRole === tab && matches(member, query))
    .toSorted(
      (a, b) =>
        ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || a.displayName.localeCompare(b.displayName, 'fr'),
    );
  return {
    current: shown.filter((member) => member.status !== 'left'),
    gone: shown.filter((member) => member.status === 'left'),
    counts,
  };
}

/** The sentence under the title: how many are at work, away, and still to sign in. */
export function teamSummary(members: readonly TeamMember[], now: Date): string | null {
  const here = members.filter((member) => member.status !== 'left');
  if (here.length === 0) return null;
  const active = here.filter((member) => member.status === 'active').length;
  const away = here.filter((member) => STATUS_TONES[member.status] === 'away').length;
  // A dead link is no invitation waiting: it is counted apart, since it asks for a new link (EQ-06).
  const expired = here.filter((member) => invitationState(member, now).kind === 'expired').length;
  const pending = here.filter((member) => member.invitationPending).length - expired;
  const parts = [`${String(active)} actif${active > 1 ? 's' : ''}`];
  if (away > 0) parts.push(`${String(away)} absent${away > 1 ? 's' : ''}`);
  if (pending > 0) parts.push(`${String(pending)} invitation${pending > 1 ? 's' : ''} en attente`);
  if (expired > 0)
    parts.push(`${String(expired)} lien${expired > 1 ? 's' : ''} expiré${expired > 1 ? 's' : ''}`);
  return parts.join(' · ');
}

const PERCENT = new Intl.NumberFormat('fr-FR', { style: 'percent', maximumFractionDigits: 2 });

/** A rate in basis points as people read it: 1250 → « 12,5 % ». */
export const formatRate = (bps: number): string => PERCENT.format(bps / 10_000);

/**
 * A rate typed by hand, « 12,5 » or « 12.5 » (in %), in basis points; `null` when it is not one (empty, over 100 %,
 * finer than a hundredth of a point).
 */
export function parseRate(text: string): number | null {
  const trimmed = text.trim().replace(',', '.').replace(/\s*%$/u, '');
  if (!/^\d{1,3}(\.\d{1,2})?$/u.test(trimmed)) return null;
  const bps = Math.round(Number(trimmed) * 100);
  return bps <= 10_000 ? bps : null;
}

/** The line of a rate: the preset's name when it comes from one, then the figure. */
export function rateLine(
  commission: { readonly rateBps: number; readonly presetId: string | null } | null,
  presets: readonly CommissionPreset[],
): string {
  if (commission === null) return 'Pas encore de taux';
  const preset = presets.find((p) => p.id === commission.presetId);
  return preset === undefined
    ? formatRate(commission.rateBps)
    : `${preset.name} · ${formatRate(commission.rateBps)}`;
}

/** Where the agency's chatters live (Charles, 27/10): first in the list. */
export const FIRST_COUNTRIES: readonly string[] = ['BJ', 'MG', 'FR'];

export interface Country {
  readonly code: string;
  readonly name: string;
}

/** The other countries of ISO 3166-1 (contracts `COUNTRY_CODES`), by their French name. */
export const OTHER_COUNTRIES: readonly Country[] = COUNTRY_CODES.filter(
  (code) => !FIRST_COUNTRIES.includes(code),
)
  .map((code) => ({ code, name: countryName(code) }))
  .toSorted((a, b) => a.name.localeCompare(b.name, 'fr'));

/**
 * The zone the panel proposes for a country (editable): the main one where a country has several. Unlisted countries
 * propose nothing, and the zone is picked by hand.
 */
const ZONES: Readonly<Record<string, string>> = {
  BJ: 'Africa/Porto-Novo',
  MG: 'Indian/Antananarivo',
  FR: 'Europe/Paris',
  BE: 'Europe/Brussels',
  BF: 'Africa/Ouagadougou',
  BI: 'Africa/Bujumbura',
  CA: 'America/Toronto',
  CD: 'Africa/Kinshasa',
  CF: 'Africa/Bangui',
  CG: 'Africa/Brazzaville',
  CH: 'Europe/Zurich',
  CI: 'Africa/Abidjan',
  CM: 'Africa/Douala',
  DE: 'Europe/Berlin',
  DJ: 'Africa/Djibouti',
  DZ: 'Africa/Algiers',
  ES: 'Europe/Madrid',
  GA: 'Africa/Libreville',
  GB: 'Europe/London',
  GF: 'America/Cayenne',
  GH: 'Africa/Accra',
  GN: 'Africa/Conakry',
  GP: 'America/Guadeloupe',
  HT: 'America/Port-au-Prince',
  IT: 'Europe/Rome',
  KM: 'Indian/Comoro',
  LU: 'Europe/Luxembourg',
  MA: 'Africa/Casablanca',
  MC: 'Europe/Monaco',
  ML: 'Africa/Bamako',
  MQ: 'America/Martinique',
  MU: 'Indian/Mauritius',
  NE: 'Africa/Niamey',
  NG: 'Africa/Lagos',
  PH: 'Asia/Manila',
  PT: 'Europe/Lisbon',
  RE: 'Indian/Reunion',
  RW: 'Africa/Kigali',
  SN: 'Africa/Dakar',
  TD: 'Africa/Ndjamena',
  TG: 'Africa/Lome',
  TN: 'Africa/Tunis',
  US: 'America/New_York',
  YT: 'Indian/Mayotte',
};

export const suggestedZone = (country: string): string | null => ZONES[country] ?? null;

/** Where a member's first access stands, read from his record and the clock. */
export type InvitationState =
  | { readonly kind: 'signed-in' }
  /** His password is chosen and a link to choose a new one is out: a second one would cancel it. */
  | { readonly kind: 'reset-sent'; readonly until: Date }
  | { readonly kind: 'no-link' }
  | { readonly kind: 'valid'; readonly until: Date }
  | { readonly kind: 'expired' };

export function invitationState(member: TeamMember, now: Date): InvitationState {
  const until = member.invitationExpiresAt === null ? null : new Date(member.invitationExpiresAt);
  const live = until !== null && until.getTime() > now.getTime();
  if (!member.invitationPending) {
    // An expired reset link changes nothing for him: he still signs in with his password.
    return live ? { kind: 'reset-sent', until } : { kind: 'signed-in' };
  }
  if (until === null) return { kind: 'no-link' };
  return live ? { kind: 'valid', until } : { kind: 'expired' };
}

const DAY = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', hour: 'numeric', minute: '2-digit' });

/** « jeudi 15 h 00 », in the reader's own zone. */
export const deadline = (at: Date): string => DAY.format(at).replace(':', ' h ');

/** A refusal the screen words: the module's codes, and the role guard when a manager's access changed meanwhile. */
export type TeamRefusalCode = TeamMemberErrorCode | 'role_forbidden';

/** What each refusal says, in the words of the screen (contracts `TEAM_MEMBER_ERROR_CODES`). */
export const ERROR_MESSAGES: Readonly<Record<TeamRefusalCode, string>> = {
  role_forbidden: 'Ton accès à l’équipe a changé. Recharge la page.',
  member_not_found: 'Ce membre n’existe plus. Recharge la page.',
  member_conflict: 'Un compte utilise déjà cet e-mail.',
  member_left_conflict: 'Ce membre est parti : sa fiche ne change plus.',
  commission_preset_not_found: 'Ce préréglage n’existe plus. Choisis-en un autre.',
  commission_preset_conflict: 'Ce préréglage a déjà un taux à partir de ce jour.',
  commission_rate_conflict: 'Ce membre a déjà un taux à partir de ce jour.',
  commission_date_invalid: 'Un nouveau taux commence le 1er ou le 16 d’un mois, aujourd’hui ou plus tard.',
  team_share_invalid: 'Seul un manager a une part du net de l’équipe.',
  creator_not_found: 'Une des créatrices n’existe plus. Recharge la page.',
  role_date_invalid: 'Un changement de rôle commence le 1er ou le 16 d’un mois, aujourd’hui ou plus tard.',
  role_change_conflict: 'Ce membre a déjà un rôle à partir de ce jour.',
};

/** A calendar day, `YYYY-MM-DD`, in the reader's own zone: today's date for « Arrivé le ». */
export const today = (now: Date = new Date()): string =>
  new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);

const LONG_DAY = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

/** « 27 octobre 2026 », « 1er octobre 2026 », from a calendar day. */
export const longDay = (day: string): string =>
  withFirstOfMonth(LONG_DAY.formatToParts(new Date(`${day}T12:00:00`)));

const NOTE_DAY = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });

/** « 27 oct. », « 1er nov. »: the day an internal note was written, in the reader's zone. */
export const noteDay = (iso: string): string => withFirstOfMonth(NOTE_DAY.formatToParts(new Date(iso)));

/** The rate set to start after `day`, the nearest one: `member.commission` stays the one in force until then. */
export const rateAhead = (rates: readonly CommissionRate[], day: string): CommissionRate | null =>
  rates
    .filter((rate) => rate.effectiveFrom > day)
    .reduce<CommissionRate | null>(
      (near, rate) => (near === null || rate.effectiveFrom < near.effectiveFrom ? rate : near),
      null,
    );

/** The rate set last, ahead or in force: a manager's share is offered from it. */
export const lastRate = (rates: readonly CommissionRate[]): CommissionRate | null =>
  rates.reduce<CommissionRate | null>(
    (last, rate) => (last === null || rate.effectiveFrom > last.effectiveFrom ? rate : last),
    null,
  );

/** The creators of a member, by name, in the order of the list. */
export const creatorNames = (member: TeamMember, creators: readonly CreatorSummary[]): string[] =>
  creators.filter((creator) => member.creatorIds.includes(creator.id)).map((creator) => creator.displayName);

/** `/equipe?onglet=managers&membre=<id>`: the tab and the open member survive a reload and a back. */
export interface TeamSearch {
  readonly onglet?: 'managers' | undefined;
  readonly membre?: string | undefined;
}

/** Anything else in the address is ignored: a broken link opens the list, never an error. */
export function parseTeamSearch(search: Record<string, unknown>): TeamSearch {
  const { onglet } = search;
  return { ...(onglet === 'managers' ? { onglet } : {}), ...memberOf(search) };
}

/**
 * `/equipe/planning?semaine=2026-10-26&membre=<id>`: the week shown, and the member whose shifts stand out (EQ-11),
 * survive a reload and a back.
 */
export interface PlanningSearch {
  readonly semaine?: string | undefined;
  readonly membre?: string | undefined;
}

/** A real day, said as its week's Monday; anything else opens this week. */
export function parsePlanningSearch(search: Record<string, unknown>): PlanningSearch {
  const { semaine } = search;
  const member = memberOf(search);
  if (typeof semaine !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(semaine)) return member;
  const day = new Date(`${semaine}T12:00:00Z`);
  if (Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== semaine) return member;
  return { semaine: mondayOf(semaine), ...member };
}

/** `/equipe/rapports?quinzaine=2026-10-16&membre=<id>`: the period shown and the member's fold open (EQ-11, EQ-13). */
export interface ReportsSearch {
  readonly quinzaine?: PayPeriod | undefined;
  readonly membre?: string | undefined;
}

export function parseReportsSearch(search: Record<string, unknown>): ReportsSearch {
  const period = PayPeriodSchema.safeParse(search['quinzaine']);
  return { ...(period.success ? { quinzaine: period.data } : {}), ...memberOf(search) };
}

/**
 * The days a new rate may start from (EQ-10): the 1st and the 16th of the months ahead, today included when it is
 * one; the server checks the same rule (`commission_date_invalid`).
 */
export function periodStartsFrom(from: string, count: number): string[] {
  const starts: string[] = [];
  const [year = 0, month = 1, day = 1] = from.split('-').map(Number);
  let y = year;
  let m = month;
  let d = day <= 1 ? 1 : day <= 16 ? 16 : 32;
  while (starts.length < count) {
    if (d > 16) {
      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
      d = 1;
    }
    starts.push(`${String(y)}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
    d = d === 1 ? 16 : 32;
  }
  return starts;
}
