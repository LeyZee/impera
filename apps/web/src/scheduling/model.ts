import type {
  LeaveRequest,
  LeaveRequestStatus,
  MyShift,
  MyShifts,
  Planning,
  PlanningAccount,
  PlanningConflict,
  PlanningMember,
  Platform,
  Shift,
  SchedulingSettings,
  ShiftSlot,
  ShiftSwapRequest,
  ShiftSwapStatus,
  ShiftTemplate,
} from '@nirvana/contracts';
import { shiftSlotsOf } from '@nirvana/contracts';

import type { SchedulingRefusalCode } from './api';
import { clockOf, dayMonth, dayOf, daysFrom, minuteOf, rangeAt, shortDay, zonedInstant } from './time';

/**
 * The planning without React (EQ-02): where each shift sits in a week, what a conflict says, and where the member is
 * in their day (Aujourd'hui, Suivi). The server decides who is on shift; this only reads what it sent.
 */

/** What each refusal says, in the words of the screens (contracts `SCHEDULING_ERROR_CODES`). */
export const ERROR_MESSAGES: Readonly<Record<SchedulingRefusalCode, string>> = {
  shift_not_found: 'Ce shift n’existe plus : le planning est relu.',
  shift_template_not_found: 'Ce modèle de shift n’existe plus : le planning est relu.',
  member_not_found: 'Ce membre n’existe plus.',
  creator_not_found: 'Cette créatrice n’existe plus.',
  platform_account_not_found: 'Ce compte n’est pas celui de cette créatrice.',
  member_left_conflict: 'Seul un membre actif reçoit un shift.',
  member_creator_conflict: 'Ce membre ne travaille pas sur cette créatrice.',
  member_not_joined_conflict:
    'Ce membre n’est pas encore arrivé ce jour-là : place-le à partir de son arrivée.',
  shift_member_conflict: 'Ce membre est déjà sur un autre shift à ces heures.',
  shift_account_conflict: 'Ce compte a déjà quelqu’un à ces heures.',
  shift_ended_conflict: 'Ce shift est fini, ou finirait avant maintenant : il ne change plus.',
  shift_started_conflict: 'Ce shift a commencé : tu peux seulement le finir plus tôt ou l’arrêter.',
  shift_range_invalid: 'Ces heures ne vont pas : la fin vient après le début, et un shift dure 24 h au plus.',
  planning_range_invalid: 'Cette période ne se lit pas d’un coup.',
  shift_template_date_invalid: 'Un modèle de shift commence aujourd’hui au plus tôt.',
  member_on_leave_conflict: 'Ce membre est en congé à ces heures.',
  leave_request_not_found: 'Cette demande de congé n’existe plus : la liste est relue.',
  leave_request_conflict: 'Cette demande de congé a déjà été envoyée autrement : la liste est relue.',
  leave_overlap_conflict: 'Un autre congé couvre déjà une partie de ces jours.',
  leave_decided_conflict: 'Cette demande de congé a déjà eu sa réponse : la liste est relue.',
  leave_shifts_conflict:
    'Des shifts tombent encore pendant ce congé : donne-les à quelqu’un d’autre ou annule-les d’abord.',
  leave_own_decision_forbidden: 'Ton propre congé est validé par quelqu’un d’autre.',
  leave_date_invalid: 'Un congé commence aujourd’hui au plus tôt.',
  shift_swap_not_found: 'Cet échange n’existe plus : la liste est relue.',
  shift_swap_conflict: 'Cet échange a déjà été proposé autrement : la liste est relue.',
  shift_swap_open_conflict: 'Tu as déjà proposé cet échange : il attend sa réponse.',
  shift_swap_answered_conflict: 'Cet échange a déjà eu sa réponse : la liste est relue.',
  shift_swap_lapsed_conflict:
    'Cet échange ne tient plus : un des shifts a commencé, a été annulé ou a changé de mains.',
  shift_swap_revert_conflict:
    'Cet échange ne revient plus en arrière : un des shifts a commencé ou a changé de mains.',
  shift_swap_self_invalid: 'Un échange se fait avec un collègue.',
  role_forbidden: 'Ton accès au planning a changé. Recharge la page.',
  request_invalid: 'Ces valeurs ne vont pas : vérifie les heures et le jour.',
};

/**
 * The refusals that say « la liste est relue » or « le planning est relu »: what the screen showed has changed, so it
 * reads everything again. A swap that lapsed is one of them, an ordinary outcome: a proposal stays `proposed` on screen
 * until the quarter-hour job passes.
 */
export const READ_AGAIN: ReadonlySet<SchedulingRefusalCode> = new Set<SchedulingRefusalCode>([
  'shift_not_found',
  'shift_template_not_found',
  'leave_request_not_found',
  'leave_request_conflict',
  'leave_decided_conflict',
  'shift_swap_not_found',
  'shift_swap_conflict',
  'shift_swap_answered_conflict',
  'shift_swap_lapsed_conflict',
  'shift_swap_revert_conflict',
]);

/** A pill's tone: green when it holds, quiet while it waits, faint once over (team.css `tm-status--*`). */
export type Tone = 'ok' | 'away' | 'gone';

export const LEAVE_STATUS: Readonly<Record<LeaveRequestStatus, { label: string; tone: Tone }>> = {
  pending: { label: 'En attente', tone: 'away' },
  approved: { label: 'Validé', tone: 'ok' },
  refused: { label: 'Refusé', tone: 'gone' },
  withdrawn: { label: 'Retiré', tone: 'gone' },
  cancelled: { label: 'Annulé', tone: 'gone' },
};

/** « Le mar. 4 nov. », « Du lun. 3 au mer. 5 nov. ». */
export function leaveDaysLine(leave: Pick<LeaveRequest, 'firstDay' | 'lastDay'>): string {
  if (leave.firstDay === leave.lastDay) return `Le ${dayMonth(leave.firstDay)}`;
  return `Du ${dayMonth(leave.firstDay)} au ${dayMonth(leave.lastDay)}`;
}

/** « 1 jour », « 3 jours ». */
export function leaveLength(leave: Pick<LeaveRequest, 'firstDay' | 'lastDay'>): string {
  const days = daysFrom(leave.firstDay, leave.lastDay) + 1;
  return days === 1 ? '1 jour' : `${String(days)} jours`;
}

/**
 * What a leave's approval found in its way, once the planning of the leave says when: « Un shift de Théo tombe encore
 * pendant ce congé, le mar. 4 nov. : … », « 3 shifts de Théo tombent encore pendant ce congé, entre le mar. 4 et le
 * mer. 12 nov. : … ». Without `days` (not read yet, or not readable), the line says no day.
 */
export function inTheWayLine(name: string, count: number, days: readonly string[]): string {
  const sorted = [...days].sort();
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const when =
    first === undefined || last === undefined
      ? ''
      : first === last
        ? `, le ${dayMonth(first)}`
        : `, entre le ${dayMonth(first)} et le ${dayMonth(last)}`;
  return count === 1
    ? `Un shift de ${name} tombe encore pendant ce congé${when} : donne-le à quelqu’un d’autre ou annule-le d’abord.`
    : `${String(count)} shifts de ${name} tombent encore pendant ce congé${when} : donne-les à quelqu’un d’autre ou annule-les d’abord.`;
}

/** The leave still covers time ahead: an approved leave can be cancelled until its end, a request withdrawn. */
export const leaveAhead = (leave: Pick<LeaveRequest, 'endsAt'>, now: Date): boolean =>
  new Date(leave.endsAt).getTime() > now.getTime();

/** « jeu. 30 oct. · 23 h – 5 h · Nora Vidal »: one shift of a swap, from what the swap noted. */
export function swapShiftLine(
  startsAt: string,
  endsAt: string,
  creatorName: string | undefined,
  timeZone: string,
): string {
  const when = `${dayMonth(dayOf(startsAt, timeZone))} · ${rangeAt(startsAt, endsAt, timeZone)}`;
  return creatorName === undefined ? when : `${when} · ${creatorName}`;
}

/** Who reads a swap: the one who proposed it, the colleague asked, or the owner or a manager. */
export type SwapSide = 'requester' | 'target' | 'agency';

export interface SwapView {
  readonly title: string;
  /** The shift offered, and with an exchange the one that comes back, each with what it is to the reader. */
  readonly lines: readonly { readonly label: string; readonly text: string }[];
  readonly status: { readonly label: string; readonly tone: Tone };
}

const SWAP_TONES: Readonly<Record<ShiftSwapStatus, Tone>> = {
  proposed: 'away',
  accepted: 'ok',
  declined: 'gone',
  withdrawn: 'gone',
  lapsed: 'gone',
  reverted: 'gone',
};

/**
 * A swap in the words of its reader (ADR 0031). A withdrawal by the agency is said as such, never by whom; a swap that
 * lapsed says why in general terms, since the shift that moved may not be the reader's.
 */
export function swapViewOf(
  swap: ShiftSwapRequest,
  side: SwapSide,
  names: { readonly member: (id: string) => string; readonly creator: (id: string) => string | undefined },
  timeZone: string,
): SwapView {
  const requester = names.member(swap.requesterId);
  const target = names.member(swap.targetMemberId);
  const exchange = swap.targetShiftStartsAt !== null && swap.targetShiftEndsAt !== null;
  const offered = swapShiftLine(
    swap.shiftStartsAt,
    swap.shiftEndsAt,
    names.creator(swap.creatorId),
    timeZone,
  );
  const back =
    swap.targetShiftStartsAt === null || swap.targetShiftEndsAt === null
      ? null
      : swapShiftLine(
          swap.targetShiftStartsAt,
          swap.targetShiftEndsAt,
          swap.targetCreatorId === null ? undefined : names.creator(swap.targetCreatorId),
          timeZone,
        );
  const title =
    side === 'requester'
      ? exchange
        ? `Échange avec ${target}`
        : `Ton shift pour ${target}`
      : side === 'target'
        ? exchange
          ? `${requester} te propose un échange`
          : `${requester} te propose son shift`
        : exchange
          ? `Échange entre ${requester} et ${target}`
          : `${requester} donne son shift à ${target}`;
  const labels = swapLabels(swap.status, side, requester, target);
  return {
    title,
    lines: [
      { label: labels.offered, text: offered },
      ...(back === null ? [] : [{ label: labels.back, text: back }]),
    ],
    status: { label: swapStatusLabel(swap, side, requester, target), tone: SWAP_TONES[swap.status] },
  };
}

/**
 * The words before each shift of a swap. They follow its status: a proposal speaks in the conditional, an accepted
 * swap in the past (the shift offered is no longer the requester's), and any other end names the shifts as proposed.
 */
function swapLabels(
  status: ShiftSwapStatus,
  side: SwapSide,
  requester: string,
  target: string,
): { readonly offered: string; readonly back: string } {
  if (side === 'agency') return { offered: `Shift de ${requester}`, back: `Shift de ${target}` };
  if (status === 'proposed') {
    return side === 'requester'
      ? { offered: 'Ton shift', back: `Celui de ${target}` }
      : { offered: 'Tu prendrais', back: 'Tu lui donnerais' };
  }
  if (status === 'accepted') {
    return side === 'requester'
      ? { offered: 'Tu as donné', back: 'Tu as reçu' }
      : { offered: 'Tu as pris', back: 'Tu lui as donné' };
  }
  return { offered: 'Proposé', back: 'En retour' };
}

function swapStatusLabel(swap: ShiftSwapRequest, side: SwapSide, requester: string, target: string): string {
  switch (swap.status) {
    case 'proposed':
      return side === 'target' ? 'À toi de répondre' : `En attente de ${target}`;
    case 'accepted':
      return side === 'target' ? 'Tu as accepté' : `Accepté par ${target}`;
    case 'declined':
      return side === 'target' ? 'Tu as refusé' : `Refusé par ${target}`;
    case 'withdrawn':
      if (swap.withdrawnByAgency) return 'Retiré par l’agence';
      return side === 'requester' ? 'Tu l’as retiré' : `Retiré par ${requester}`;
    case 'lapsed':
      return 'Tombé : un des shifts a changé entre-temps';
    case 'reverted':
      return 'Annulé par l’agence';
  }
}

/**
 * Where a refusal comes from in a swap: a proposal, the acceptance of a shift given (`take`, nothing comes back to the
 * requester), or the acceptance of an exchange (`exchange`, where both members receive a shift).
 */
export type SwapStep = 'propose' | 'take' | 'exchange';

/**
 * What a refusal says in a swap, where the general words would mislead: a colleague busy elsewhere is never named by
 * their shift (ADR 0031), and the leave of someone else is never said. When an exchange is accepted, the shift or the
 * leave in the way may be either member's, so the words blame neither.
 */
export function swapRefusalText(
  code: SchedulingRefusalCode,
  step: SwapStep,
  colleague: string,
  shiftId: string | null,
): string {
  if (code === 'shift_member_conflict') {
    if (step === 'exchange')
      return 'L’un de vous deux est déjà sur un autre shift à ces heures : l’échange ne peut pas se faire.';
    if (step === 'take') return 'Tu es déjà sur un autre shift à ces heures : tu ne peux pas le prendre.';
    return shiftId === null
      ? `${colleague} est déjà sur un autre shift à ces heures.`
      : 'Le shift rendu tombe sur un autre de tes shifts.';
  }
  if (code === 'member_on_leave_conflict') {
    if (step === 'exchange') return 'Un congé tombe sur ces heures : l’échange ne peut pas se faire.';
    if (step === 'take') return 'Tu es en congé à ces heures : tu ne peux pas le prendre.';
    return 'Tu es en congé quand tombe le shift rendu.';
  }
  if (code === 'member_left_conflict') return `${colleague} ne peut plus recevoir de shift.`;
  return ERROR_MESSAGES[code];
}

const PLATFORMS: Readonly<Record<Platform, string>> = {
  reveal: 'Reveal',
  onlyfans: 'OnlyFans',
  instagram: 'Instagram',
  nirvana: 'Nirvana',
};

export const platformName = (platform: Platform): string => PLATFORMS[platform];

/** « @nora sur Reveal ». */
export const accountLine = (account: { readonly platform: Platform; readonly handle: string }): string =>
  `@${account.handle} sur ${platformName(account.platform)}`;

export type Phase = 'later' | 'live' | 'past';

/** Where a shift is in time: to come, under way, or over. */
export function phaseOf(shift: Pick<Shift, 'startsAt' | 'endsAt'>, now: Date): Phase {
  const at = now.getTime();
  if (new Date(shift.endsAt).getTime() <= at) return 'past';
  return new Date(shift.startsAt).getTime() <= at ? 'live' : 'later';
}

/** A shift in one day of the grid. */
export interface Chip {
  readonly shift: Shift;
  readonly member: PlanningMember | null;
  /** It started on an earlier day of the range, before this one. */
  readonly continued: boolean;
  /** It ends on a later day: a night shift. */
  readonly overnight: boolean;
}

export interface GridRow {
  readonly account: PlanningAccount;
  /** Each day of the range, in order, with its shifts by start. */
  readonly days: ReadonlyMap<string, readonly Chip[]>;
}

/**
 * The week as rows of accounts and columns of days, read in `timeZone`. A shift sits on the day it starts; one that
 * started before the range sits on its first day, marked as continued, so a Sunday night shows on Monday morning.
 */
export function gridOf(planning: Planning, days: readonly string[], timeZone: string): GridRow[] {
  const first = days[0];
  const members = new Map(planning.members.map((member) => [member.id, member]));
  const accounts = [...planning.accounts].sort(
    (a, b) => a.creatorName.localeCompare(b.creatorName, 'fr') || a.handle.localeCompare(b.handle, 'fr'),
  );
  const shifts = [...planning.shifts].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return accounts.map((account) => {
    const cells = new Map<string, Chip[]>(days.map((day) => [day, []]));
    for (const shift of shifts) {
      if (shift.platformAccountId !== account.id) continue;
      const startDay = dayOf(shift.startsAt, timeZone);
      // An end at midnight sharp belongs to the day before: 18 h – 0 h is one day's shift.
      const endDay = dayOf(new Date(new Date(shift.endsAt).getTime() - 60_000), timeZone);
      const continued = first !== undefined && startDay < first;
      const day = continued ? first : startDay;
      cells.get(day)?.push({
        shift,
        member: members.get(shift.memberId) ?? null,
        continued,
        overnight: endDay > day,
      });
    }
    return { account, days: cells };
  });
}

/** Past this many créneaux a day (slots under four hours), the cells stack their shifts instead of lining them up. */
export const LINED_SLOTS_MAX = 6;

/** One créneau of one day on one account (EQ-01): the shifts that start in it, and what of it is left to fill. */
export interface SlotCell {
  readonly slot: ShiftSlot;
  /** Its first and last instants, read at the agency's: a créneau over a change of time is an hour shorter or longer. */
  readonly from: Date;
  readonly to: Date;
  readonly chips: readonly Chip[];
  /** A shift of the account overlaps it, whether it starts in it or earlier (a long shift covers the next one). */
  readonly covered: boolean;
  /**
   * The first stretch of it still ahead with nobody on the account, from now at the minute for the créneau under way;
   * `null` when nothing of it is left to fill. A shift stopped under way, or a short one, leaves one.
   */
  readonly open: { readonly from: Date; readonly to: Date } | null;
}

/**
 * The days of one account cut into the agency's créneaux, so that one créneau sits at the same height all week and a
 * stretch with nobody shows. A day of créneaux begins at the first one: a shift goes to the créneau that holds its
 * start, so one at 2 h belongs to the night before when the créneaux begin at 5 h. One that starts before the
 * week's first créneau (carried over, or early on Monday) goes to it. `null` when the créneaux are too many to line
 * up.
 */
export function slotRowOf(
  row: GridRow,
  shifts: readonly Pick<Shift, 'startsAt' | 'endsAt'>[],
  days: readonly string[],
  settings: Pick<SchedulingSettings, 'timeZone' | 'slotStartMinute' | 'slotLengthMinutes'>,
  now: Date,
): ReadonlyMap<string, readonly SlotCell[]> | null {
  const slots = shiftSlotsOf(settings);
  if (slots.length > LINED_SLOTS_MAX) return null;
  const length = settings.slotLengthMinutes;
  const zone = settings.timeZone;
  // Both ends are wall-clock minutes of the agency, so the créneaux of a week follow each other without a gap.
  const windows = days.flatMap((day) =>
    slots.map((slot, index) => ({
      day,
      slot,
      from: zonedInstant(day, settings.slotStartMinute + index * length, zone),
      to: zonedInstant(day, settings.slotStartMinute + (index + 1) * length, zone),
    })),
  );
  const placed = windows.map((): Chip[] => []);
  for (const chips of row.days.values()) {
    for (const chip of chips) {
      const start = new Date(chip.shift.startsAt).getTime();
      const at = windows.findIndex((window) => window.from.getTime() <= start && start < window.to.getTime());
      placed[at === -1 ? (start < (windows[0]?.from.getTime() ?? 0) ? 0 : windows.length - 1) : at]?.push(
        chip,
      );
    }
  }
  const spans = shifts
    .map((shift) => ({ from: new Date(shift.startsAt).getTime(), to: new Date(shift.endsAt).getTime() }))
    .sort((a, b) => a.from - b.from);
  const ahead = Math.ceil(now.getTime() / 60_000) * 60_000;
  const cells = windows.map((window, index): SlotCell => {
    const from = window.from.getTime();
    const to = window.to.getTime();
    return {
      slot: window.slot,
      from: window.from,
      to: window.to,
      chips: placed[index] ?? [],
      covered: spans.some((span) => span.from < to && span.to > from),
      open: gapIn(Math.max(from, ahead), to, spans),
    };
  });
  return new Map(
    days.map((day, index) => [day, cells.slice(index * slots.length, (index + 1) * slots.length)]),
  );
}

/** The first stretch of [from, to) that no span covers, or `null`; `spans` sorted by start. */
function gapIn(
  from: number,
  to: number,
  spans: readonly { readonly from: number; readonly to: number }[],
): { from: Date; to: Date } | null {
  let at = from;
  for (const span of spans) {
    if (at >= to) return null;
    if (span.to <= at) continue;
    if (span.from > at) return { from: new Date(at), to: new Date(Math.min(span.from, to)) };
    at = span.to;
  }
  return at < to ? { from: new Date(at), to: new Date(to) } : null;
}

/** « Lun. 26 · 23 h – 5 h · Théo est déjà sur un autre shift »: one occurrence a template could not place. */
export interface ConflictLine {
  readonly key: string;
  readonly when: string;
  readonly what: string;
  /** The account is left with nobody (on leave, busy elsewhere), or it already has someone: a double, not a gap. */
  readonly toFill: boolean;
  /** The shift in the way, to open it; none when the member is on leave (ADR 0031). */
  readonly shiftId: string | null;
  /** A shift to fill, when the member is on leave: its account and hours at the agency's, and who is away. */
  readonly fill: Fill | null;
}

/** What « Pourvoir » opens the new-shift panel on: the account, the day and hours of the agency, who is away. */
export interface Fill {
  readonly accountId: string;
  readonly day: string;
  readonly startMinute: number;
  readonly endMinute: number;
  readonly awayMemberId: string;
  readonly awayName: string;
}

export function conflictLines(
  conflicts: readonly PlanningConflict[],
  templates: readonly ShiftTemplate[],
  planning: Planning,
  timeZone: string,
): ConflictLine[] {
  const members = new Map(planning.members.map((member) => [member.id, member.displayName]));
  const accounts = new Map(planning.accounts.map((account) => [account.id, account]));
  return [...conflicts]
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .map((conflict) => {
      const template = templates.find((one) => one.id === conflict.templateId);
      const who = template === undefined ? undefined : members.get(template.memberId);
      const account = template === undefined ? undefined : accounts.get(template.platformAccountId);
      const where = account === undefined ? '' : ` · ${account.creatorName}`;
      const what = whatOf(conflict, who, account);
      const agency = planning.settings.timeZone;
      return {
        key: `${conflict.templateId}-${conflict.startsAt}`,
        when: `${shortDay(dayOf(conflict.startsAt, timeZone))} · ${rangeAt(conflict.startsAt, conflict.endsAt, timeZone)}${where}`,
        what: what.charAt(0).toUpperCase() + what.slice(1),
        toFill: conflict.reason !== 'account_taken',
        shiftId: conflict.reason === 'member_on_leave' ? null : conflict.shiftId,
        fill:
          conflict.reason !== 'member_on_leave' || template === undefined
            ? null
            : {
                accountId: template.platformAccountId,
                day: dayOf(conflict.startsAt, agency),
                startMinute: minuteOf(conflict.startsAt, agency),
                endMinute: minuteOf(conflict.endsAt, agency),
                awayMemberId: template.memberId,
                awayName: who ?? 'Son membre',
              },
      };
    });
}

/**
 * The title over the template lines: only an account left with nobody is « à pourvoir »; one that already has someone
 * is a double to sort out (« 1 shift à pourvoir · 1 en double »).
 */
export function conflictTitle(lines: readonly Pick<ConflictLine, 'toFill'>[]): string {
  const fill = lines.filter((line) => line.toFill).length;
  const double = lines.length - fill;
  const shifts = (count: number): string => (count === 1 ? '1 shift' : `${String(count)} shifts`);
  return [
    fill === 0 ? null : `${shifts(fill)} à pourvoir`,
    double === 0 ? null : fill === 0 ? `${shifts(double)} en double` : `${String(double)} en double`,
  ]
    .filter((part) => part !== null)
    .join(' · ');
}

function whatOf(
  conflict: PlanningConflict,
  who: string | undefined,
  account: PlanningAccount | undefined,
): string {
  switch (conflict.reason) {
    case 'member_busy':
      return `${who ?? 'Son membre'} est déjà sur un autre shift`;
    case 'account_taken':
      return `le compte${account === undefined ? '' : ` @${account.handle}`} a déjà quelqu’un`;
    case 'member_on_leave':
      return `${who ?? 'Son membre'} est en congé`;
  }
}

/** « Chaque mardi, 23 h – 5 h ». */
export function templateLine(template: Pick<ShiftTemplate, 'weekday' | 'startMinute' | 'endMinute'>): string {
  const day = WEEKDAYS[template.weekday - 1] ?? '';
  return `Chaque ${day}, ${clockOf(template.startMinute)} – ${clockOf(template.endMinute)}`;
}

const WEEKDAYS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'] as const;

/** Where the member is in their day, for Aujourd'hui: one state, the most pressing first. */
export type DayState =
  /** On shift now (`current`); `next` may follow it. */
  | { readonly kind: 'on'; readonly shift: MyShift; readonly next: MyShift | null }
  /** The shift is over, its creator still open until `accessEndsAt`. */
  | { readonly kind: 'ended'; readonly shift: MyShift; readonly next: MyShift | null }
  /** The next shift's start margin is open: its creator already is. */
  | { readonly kind: 'soon'; readonly shift: MyShift }
  | { readonly kind: 'later'; readonly shift: MyShift }
  | { readonly kind: 'none' };

export function dayStateOf(mine: MyShifts, now: Date): DayState {
  if (mine.current !== null) return { kind: 'on', shift: mine.current, next: mine.next };
  if (mine.ended !== null) return { kind: 'ended', shift: mine.ended, next: mine.next };
  if (mine.next === null) return { kind: 'none' };
  return new Date(mine.next.accessStartsAt).getTime() <= now.getTime()
    ? { kind: 'soon', shift: mine.next }
    : { kind: 'later', shift: mine.next };
}

/** Whether the member's creators are open in Nirvana now (ADR 0025): what Suivi says « Tu n'es pas en poste » about. */
export function accessOpen(mine: MyShifts, now: Date): boolean {
  const state = dayStateOf(mine, now);
  return state.kind === 'on' || state.kind === 'ended' || state.kind === 'soon';
}

/** How far a shift under way has gone, from 0 to 1. */
export function progressOf(shift: Pick<Shift, 'startsAt' | 'endsAt'>, now: Date): number {
  const start = new Date(shift.startsAt).getTime();
  const end = new Date(shift.endsAt).getTime();
  if (end <= start) return 1;
  return Math.min(1, Math.max(0, (now.getTime() - start) / (end - start)));
}
