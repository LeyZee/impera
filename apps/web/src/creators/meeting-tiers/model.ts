import { MeetingTierSettingsSchema, type MeetingTierSettings } from '@impera/contracts';

export type MeetingTierKey = keyof MeetingTierSettings;

/** The three durations, rising, in the words of the glossary (« Palier de rencontre », guide 26/11). */
export const MEETING_TIER_FIELDS: readonly (readonly [MeetingTierKey, string])[] = [
  ['newFanHours', 'Heures avant de ne plus être nouveau'],
  ['closeFanHours', 'Heures avant d’être proche'],
  ['veryCloseFanHours', 'Heures avant d’être très proche'],
];

export type MeetingTierTexts = Readonly<Record<MeetingTierKey, string>>;

const hoursText = (hours: number): string => String(hours).replace('.', ',');

/** What the fields show: her durations, or nothing when none is set. */
export const textsOf = (settings: MeetingTierSettings | null): MeetingTierTexts => ({
  newFanHours: settings === null ? '' : hoursText(settings.newFanHours),
  closeFanHours: settings === null ? '' : hoursText(settings.closeFanHours),
  veryCloseFanHours: settings === null ? '' : hoursText(settings.veryCloseFanHours),
});

/** A duration typed in hours, a comma or a dot for a fraction; `null` when it does not read. */
function hoursOf(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+(?:[.,]\d+)?$/u.test(trimmed)) return null;
  return Number(trimmed.replace(',', '.'));
}

/**
 * The durations typed, or why they cannot be saved, in his words. The three left empty remove them: no fan then goes
 * past the second tier.
 */
export function meetingTiersOf(
  texts: MeetingTierTexts,
): { readonly settings: MeetingTierSettings | null } | { readonly problem: string } {
  if (MEETING_TIER_FIELDS.every(([key]) => texts[key].trim() === '')) return { settings: null };
  const newFan = hoursOf(texts.newFanHours);
  const close = hoursOf(texts.closeFanHours);
  const veryClose = hoursOf(texts.veryCloseFanHours);
  if (newFan === null || close === null || veryClose === null || newFan === 0)
    return { problem: 'Un nombre d’heures par palier, plus que zéro.' };
  const read = MeetingTierSettingsSchema.safeParse({
    newFanHours: newFan,
    closeFanHours: close,
    veryCloseFanHours: veryClose,
  });
  return read.success
    ? { settings: read.data }
    : { problem: 'Chaque durée est plus longue que la précédente.' };
}
