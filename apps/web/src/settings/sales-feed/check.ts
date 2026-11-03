import {
  payPeriodLastDay,
  payPeriodOfDay,
  SALES_FEED_CHECK_MAX_DAYS,
  type SalesFeedCheckChatter,
  type SalesFeedCheckDay,
  type SalesFeedCheckNote,
  type SalesFeedCheckReport,
  type SalesFeedCheckTotals,
  type SalesFeedCheckVerdict,
  type SalesFeedChatterLink,
  type SalesFeedModelLink,
} from '@impera/contracts';

import { chatterName, dayTime, modelLabel } from './view';

/**
 * The view rules of the reliability check (CRM-02, ADR 0050 § 8), kept out of the component so they are tested: the
 * days a check can cover, the export's text, the money and the sentences of the report.
 */

/**
 * The zone the platform counts its days in. The report gives it back (`timeZone`); before the first check the page
 * needs it to offer days already over, and Reveal counts in Paris time.
 */
export const PLATFORM_DAY_ZONE = 'Europe/Paris';

const DAY_MS = 86_400_000;

/** `YYYY-MM-DD` of an instant in a zone. */
export function dayIn(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

const utc = (day: string): number => Date.parse(`${day}T00:00:00Z`);
const isoOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
export const addDays = (day: string, days: number): string => isoOf(utc(day) + days * DAY_MS);

/** The last day over in the platform's zone: today still moves, the server refuses it. */
export const lastDayOver = (now: Date, timeZone: string = PLATFORM_DAY_ZONE): string =>
  addDays(dayIn(now, timeZone), -1);

export interface DayRange {
  readonly from: string;
  readonly to: string;
}

/**
 * The two last fortnights over, newest first: the 1st to the 15th, then the 16th to the month's end, as the pay
 * counts them (ADR 0023). On the 16th, the 1st–15th is over; on the 1st, the 16th–end of last month is.
 */
export function fortnightsOver(now: Date, timeZone: string = PLATFORM_DAY_ZONE): [DayRange, DayRange] {
  const today = dayIn(now, timeZone);
  const [year, month, day] = today.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined) throw new Error(`day ${today}`);
  const monthStart = (y: number, m: number): string => isoOf(Date.UTC(y, m - 1, 1));
  const monthEnd = (y: number, m: number): string => isoOf(Date.UTC(y, m, 0));
  const firstHalf = (y: number, m: number): DayRange => ({
    from: monthStart(y, m),
    to: addDays(monthStart(y, m), 14),
  });
  const secondHalf = (y: number, m: number): DayRange => ({
    from: addDays(monthStart(y, m), 15),
    to: monthEnd(y, m),
  });
  const previous = month === 1 ? { y: year - 1, m: 12 } : { y: year, m: month - 1 };
  return day >= 16
    ? [firstHalf(year, month), secondHalf(previous.y, previous.m)]
    : [secondHalf(previous.y, previous.m), firstHalf(previous.y, previous.m)];
}

const MONTH_DAY = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', timeZone: 'UTC' });
const MONTH_DAY_YEAR = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

/** « 1er novembre », « 16 octobre » (a calendar day, read in UTC so no zone moves it). */
export function dayLabel(day: string, withYear = false): string {
  const text = (withYear ? MONTH_DAY_YEAR : MONTH_DAY).format(new Date(utc(day)));
  return text.replace(/^1 /u, '1er ');
}

/** « du 16 au 31 octobre », « du 25 octobre au 7 novembre », « le 3 novembre ». */
export function rangeLabel({ from, to }: DayRange): string {
  if (from === to) return `le ${dayLabel(from)}`;
  const sameMonth = from.slice(0, 7) === to.slice(0, 7);
  const start = sameMonth ? (dayLabel(from).split(' ')[0] ?? '') : dayLabel(from);
  return `du ${start} au ${dayLabel(to)}`;
}

/** Why a range cannot be checked, or `null`: the days over, in order, 31 at most (the server says the same). */
export function rangeProblem(range: DayRange, lastOver: string): string | null {
  if (range.from === '' || range.to === '') return 'Choisis le premier et le dernier jour.';
  if (range.from > range.to) return 'Le premier jour vient après le dernier.';
  if (range.to > lastOver) return 'Choisis des jours déjà terminés : la journée en cours bouge encore.';
  if ((utc(range.to) - utc(range.from)) / DAY_MS >= SALES_FEED_CHECK_MAX_DAYS) {
    return `${String(SALES_FEED_CHECK_MAX_DAYS)} jours au plus par vérification.`;
  }
  return null;
}

/** Whole fortnight: the 1st to the 15th, or the 16th to the month's end, as pay counts them (ADR 0023, ADR 0050 § 8). */
export function isWholeFortnight({ from, to }: DayRange): boolean {
  if (from === '' || to === '') return false;
  const period = payPeriodOfDay(from);
  return from === period && to === payPeriodLastDay(period);
}

/** The export goes up as text, 2 000 000 characters at most (the contract's bound). */
export const EXPORT_MAX_CHARS = 2_000_000;

/**
 * The export's bytes as text: UTF-8 first (its BOM dropped), Windows-1252 when they are not UTF-8, as a French
 * spreadsheet often saves a CSV. Read wrong, « Revenu modèle » would lose its è and the column would go unseen.
 */
export function decodeExport(bytes: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

/**
 * Integer cents of the platform's currency, written in euros: Reveal counts in euros (its statistics say `EUR`), the
 * only platform with a check so far.
 */
const EUROS = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
export const money = (cents: number): string => EUROS.format(cents / 100);

/** « +1,20 € », « −0,50 € »: how far a source is from the register. */
export function gap(cents: number): string {
  const text = EUROS.format(Math.abs(cents) / 100);
  return cents < 0 ? `−${text}` : `+${text}`;
}

export type Figure = keyof SalesFeedCheckTotals;
export const FIGURES: readonly { readonly key: Figure; readonly label: string }[] = [
  { key: 'net', label: 'Net' },
  { key: 'agency', label: 'Part agence' },
  { key: 'creator', label: 'Part créatrice' },
  { key: 'grossInclVat', label: 'Brut TTC' },
];

/** One figure of a source next to the register's: `null` when the source does not give it (never compared). */
export function figureGap(
  register: SalesFeedCheckTotals,
  other: SalesFeedCheckTotals,
  key: Figure,
): number | null {
  const mine = register[key];
  const theirs = other[key];
  return mine === null || theirs === null ? null : theirs - mine;
}

export interface VerdictView {
  readonly dot: 'ok' | 'low';
  readonly title: string;
  readonly line: string;
}

/**
 * The verdict's sentence. Amber, not red, for a difference: nothing is broken, the switch to the platform's net
 * simply stays closed until the gap is explained (ADR 0050 § 8).
 */
export function verdictOf(verdict: SalesFeedCheckVerdict): VerdictView {
  switch (verdict) {
    case 'match':
      return {
        dot: 'ok',
        title: 'Les chiffres concordent au centime',
        line: 'Le registre, les statistiques et l’export disent la même chose, jour par jour, et membre par membre face aux statistiques.',
      };
    case 'mismatch':
      return {
        dot: 'low',
        title: 'Des chiffres ne concordent pas',
        line: 'Les écarts sont détaillés ci-dessous. Tant qu’ils ne sont pas expliqués, aucun compte ne passe sur le net de la plateforme.',
      };
    case 'incomplete':
      return {
        dot: 'low',
        title: 'Ce qui a été comparé concorde, mais pas tout',
        line: 'Une source manque ou une partie n’a pas pu être comparée : les notes disent quoi.',
      };
  }
}

/**
 * What a report says of the switch to the platform's net (CRM-03): the server decides (`clean`), this only says why a
 * report that agrees cannot carry it. `null` when there is nothing to add to the verdict, or before the server said.
 */
export function switchLine(
  report: Pick<SalesFeedCheckReport, 'from' | 'to' | 'verdict' | 'notes'>,
  clean: boolean | null,
): { readonly tone: 'ok' | 'low'; readonly text: string } | null {
  if (clean === true) {
    return {
      tone: 'ok',
      text: 'Une quinzaine entière, et tout concorde : la bascule du compte pourra s’appuyer sur ce rapport.',
    };
  }
  if (clean === null || report.verdict !== 'match') return null;
  if (!isWholeFortnight(report)) {
    return {
      tone: 'low',
      text: 'Tout concorde, mais pas sur une quinzaine entière (du 1er au 15, ou du 16 à la fin du mois) : la bascule ne s’appuiera pas sur ce rapport.',
    };
  }
  return {
    tone: 'low',
    text: 'Tout concorde, mais une note ci-dessus reste à régler : la bascule ne s’appuiera pas sur ce rapport.',
  };
}

/** How long before the check the register had last been read: « juste avant », « 3 min avant », then the day. */
export function readBefore(registerReadAt: string, generatedAt: string): string {
  const minutes = Math.floor((Date.parse(generatedAt) - Date.parse(registerReadAt)) / 60_000);
  if (minutes < 1) return 'juste avant';
  if (minutes < 60) return `${String(minutes)} min avant`;
  if (minutes < 24 * 60) return `${String(Math.floor(minutes / 60))} h avant`;
  return `le ${dayTime(registerReadAt)}`;
}

export const plural = (count: number, one: string, many: string): string =>
  `${String(count)} ${count > 1 ? many : one}`;

/** What the owner should know beside the figures, in the page's words; never a fan's data. */
export function noteText(
  note: SalesFeedCheckNote,
  platform: string,
  chatters: readonly SalesFeedChatterLink[],
  memberName: (memberId: string) => string | null = () => null,
  reported: readonly SalesFeedCheckChatter[] = [],
): string {
  switch (note.kind) {
    case 'refund_without_sale':
      return `${plural(note.count, 'remboursement porte', 'remboursements portent')} sur des ventes d’avant ces jours : ${platform} les retire du jour de leur vente, hors de la période, et ils ne sont comparés nulle part.`;
    case 'bot_not_linked_to_agent': {
      const chatter = chatters.find((one) => one.platformChatterId === note.platformChatterId);
      const name = chatter === undefined ? note.platformChatterId : chatterName(chatter);
      // A bot linked to a member is the worse case: the agent's sales would pay that member a commission. The link
      // is the one the report saw (a kept report is read again later), named after the member it points to now.
      const row = reported.find((one) => one.platformChatterId === note.platformChatterId);
      const linkedTo = row === undefined ? (chatter?.link?.kind ?? null) : row.link;
      if (linkedTo === 'member') {
        const member = chatter?.link?.kind === 'member' ? memberName(chatter.link.memberId) : null;
        const whom = member === null ? 'un membre' : `« ${member} »`;
        return `Le compte bot « ${name} » est relié à ${whom} : ses ventes lui compteraient. Relie-le à l’agent dans « Équipe ${platform} ».`;
      }
      return `Le compte bot « ${name} » n’est pas relié à l’agent : ses ventes ne compteraient pour personne. Relie-le dans « Équipe ${platform} ».`;
    }
    case 'export_unknown_model':
      return `L’export nomme « ${note.model} », qui n’est ni un identifiant ni un pseudo de modèle de ${platform} : ses lignes sont laissées de côté.`;
    case 'export_rows_outside':
      return `${plural(note.count, 'ligne de l’export tombe', 'lignes de l’export tombent')} hors des jours vérifiés : laissées de côté.`;
    case 'stats_unavailable':
      return `Les statistiques de ${platform} n’ont pas pu être lues : le registre n’est comparé qu’à l’export.`;
    case 'register_starts_after':
      return note.firstLineAt === null
        ? `Le registre n’a encore aucune vente lue : la lecture de ${platform} n’a pas remonté l’historique. Ce n’est pas un écart ; réessaie quand elle l’aura fait.`
        : `Le registre commence le ${dayTime(note.firstLineAt)} : les jours d’avant ne peuvent pas concorder, ce n’est pas un écart. Choisis des jours plus récents, ou attends que la lecture remonte plus loin.`;
  }
}

/** « Messalina (@messa) », the platform's handle alone for a model it no longer lists. */
export function dayModelLabel(day: SalesFeedCheckDay, models: readonly SalesFeedModelLink[]): string {
  const model = models.find((one) => one.platformModelId === day.platformModelId);
  if (model !== undefined) return modelLabel(model);
  return day.handle === null ? day.platformModelId : `@${day.handle}`;
}

/** The days to read first: those where a source differs, in date order. */
export const daysInGap = (days: readonly SalesFeedCheckDay[]): SalesFeedCheckDay[] =>
  days.filter((day) => day.differs.length > 0);

/**
 * A team member's line: the platform's name for them, and who they are in Impera. The line `null` gathers the sales
 * no chatter made, which count for nobody.
 */
export function chatterLine(
  row: SalesFeedCheckChatter,
  chatters: readonly SalesFeedChatterLink[],
  memberName: (memberId: string) => string | null,
): { name: string; link: string } {
  if (row.platformChatterId === null) {
    // What these sales are (subscriptions, Mass DM…) is said once seen on a real export, not before.
    return { name: 'Sans chatteur', link: 'Ne compte pour personne' };
  }
  const chatter = chatters.find((one) => one.platformChatterId === row.platformChatterId);
  const name = chatter === undefined ? row.platformChatterId : chatterName(chatter);
  if (row.link === 'agent') return { name, link: 'L’agent' };
  if (row.link === 'member') {
    const memberId = chatter?.link?.kind === 'member' ? chatter.link.memberId : null;
    const member = memberId === null ? null : memberName(memberId);
    return { name, link: member ?? 'Un membre' };
  }
  return { name, link: 'Relié à personne' };
}
