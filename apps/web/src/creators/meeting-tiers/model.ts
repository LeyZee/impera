import { MeetingTierSettingsSchema, type MeetingTierSettings } from '@impera/contracts';

export type MeetingTierKey = keyof MeetingTierSettings;

/** The units the owner thinks the relationship in (Charles, 27/11); stored in hours whatever he picks. */
export type DurationUnit = 'days' | 'weeks' | 'months';

/** Hours in one unit: a week is 7 days, a month 30 days (said under the fields). */
export const HOURS_PER_UNIT: Readonly<Record<DurationUnit, number>> = {
  days: 24,
  weeks: 7 * 24,
  months: 30 * 24,
};

export const UNIT_OPTIONS: readonly { readonly value: DurationUnit; readonly label: string }[] = [
  { value: 'days', label: 'jours' },
  { value: 'weeks', label: 'semaines' },
  { value: 'months', label: 'mois' },
];

/**
 * The three durations, rising, in the words of the glossary (« Palier de rencontre », guide 26/11). While nothing is
 * set the first starts in days, the second in weeks, the third in months (Charles, 27/11): `textsOf`.
 */
export const MEETING_TIER_FIELDS: readonly (readonly [MeetingTierKey, string])[] = [
  ['newFanHours', 'Plus nouveau après'],
  ['closeFanHours', 'Proche après'],
  ['veryCloseFanHours', 'Très proche après'],
];

/** A duration as typed: a number in a unit. */
export interface DurationText {
  readonly amount: string;
  readonly unit: DurationUnit;
}

export type MeetingTierTexts = Readonly<Record<MeetingTierKey, DurationText>>;

const amountText = (amount: number): string => String(Number(amount.toFixed(4))).replace('.', ',');

/** A stored duration in the largest unit it falls on exactly; in days otherwise. */
export function durationTextOf(hours: number): DurationText {
  for (const unit of ['months', 'weeks', 'days'] as const) {
    if (hours % HOURS_PER_UNIT[unit] === 0) return { amount: String(hours / HOURS_PER_UNIT[unit]), unit };
  }
  return { amount: amountText(hours / HOURS_PER_UNIT.days), unit: 'days' };
}

/** What the fields show: her durations, or empty fields in their first units when none is set. */
export function textsOf(settings: MeetingTierSettings | null): MeetingTierTexts {
  const textOf = (hours: number | undefined, unit: DurationUnit): DurationText =>
    hours === undefined ? { amount: '', unit } : durationTextOf(hours);
  return {
    newFanHours: textOf(settings?.newFanHours, 'days'),
    closeFanHours: textOf(settings?.closeFanHours, 'weeks'),
    veryCloseFanHours: textOf(settings?.veryCloseFanHours, 'months'),
  };
}

/** A duration typed, in hours; `null` when its number does not read. */
export function hoursOf(text: DurationText): number | null {
  const trimmed = text.amount.trim();
  if (!/^\d+(?:[.,]\d+)?$/u.test(trimmed)) return null;
  return Number(trimmed.replace(',', '.')) * HOURS_PER_UNIT[text.unit];
}

export const sameTexts = (a: MeetingTierTexts, b: MeetingTierTexts): boolean =>
  MEETING_TIER_FIELDS.every(([key]) => a[key].amount === b[key].amount && a[key].unit === b[key].unit);

/**
 * The durations typed, in hours, or why they cannot be saved, in his words; compared once converted. The three left
 * empty remove them: no fan then goes past the second tier.
 */
export function meetingTiersOf(
  texts: MeetingTierTexts,
): { readonly settings: MeetingTierSettings | null } | { readonly problem: string } {
  if (MEETING_TIER_FIELDS.every(([key]) => texts[key].amount.trim() === '')) return { settings: null };
  const newFan = hoursOf(texts.newFanHours);
  const close = hoursOf(texts.closeFanHours);
  const veryClose = hoursOf(texts.veryCloseFanHours);
  if (
    newFan === null ||
    close === null ||
    veryClose === null ||
    newFan === 0 ||
    close === 0 ||
    veryClose === 0
  )
    return { problem: 'Indique dans chaque champ une durée plus grande que zéro.' };
  const read = MeetingTierSettingsSchema.safeParse({
    newFanHours: newFan,
    closeFanHours: close,
    veryCloseFanHours: veryClose,
  });
  return read.success
    ? { settings: read.data }
    : { problem: 'Chaque durée doit être plus longue que la précédente.' };
}
